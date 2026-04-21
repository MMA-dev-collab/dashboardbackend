const prisma = require('../../config/database');
const { NotFoundError, BadRequestError } = require('../../utils/errors');

const LEVEL_THRESHOLDS = [0, 100, 250, 500, 800, 1200, 1700, 2300, 3000, 4000];
const DAILY_XP_CAP = 500;
const DIMINISHING_THRESHOLD = 300;

class XpService {
  calculateLevel(totalXp) {
    let level = 1;
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (totalXp >= LEVEL_THRESHOLDS[i]) {
        level = i + 1;
        break;
      }
    }
    return level;
  }

  getXpForLevel(level) {
    const idx = level - 1;
    if (idx < LEVEL_THRESHOLDS.length) return LEVEL_THRESHOLDS[idx];
    const last = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
    return last + (level - LEVEL_THRESHOLDS.length) * 1500;
  }

  getXpToNextLevel(currentLevel, totalXp) {
    const nextThreshold = this.getXpForLevel(currentLevel + 1);
    const currentThreshold = this.getXpForLevel(currentLevel);
    return {
      needed: nextThreshold - currentThreshold,
      progress: totalXp - currentThreshold,
      remaining: nextThreshold - totalXp,
      progressPct: Math.min(100, Math.round(((totalXp - currentThreshold) / (nextThreshold - currentThreshold)) * 100)),
    };
  }

  async getUserProfile(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, totalXp: true, currentLevel: true, firstName: true, lastName: true, profilePicture: true },
    });
    if (!user) throw new NotFoundError('User not found');

    const xpInfo = this.getXpToNextLevel(user.currentLevel, user.totalXp);
    return {
      ...user,
      xpToNextLevel: xpInfo,
    };
  }

  async getXpLogs(userId, { page = 1, limit = 20, source } = {}) {
    const where = { userId };
    if (source) where.source = source;

    const [logs, total] = await Promise.all([
      prisma.xpLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.xpLog.count({ where }),
    ]);

    return {
      data: logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getLeaderboard({ type = 'global', limit = 20 } = {}) {
    if (type === 'weekly') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const weeklyXp = await prisma.xpLog.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: weekAgo }, amount: { gt: 0 } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: limit,
      });

      const userIds = weeklyXp.map(w => w.userId);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, profilePicture: true, currentLevel: true },
      });

      const userMap = new Map(users.map(u => [u.id, u]));
      return weeklyXp.map((w, i) => ({
        rank: i + 1,
        ...userMap.get(w.userId),
        weeklyXp: w._sum.amount,
      }));
    }

    const users = await prisma.user.findMany({
      where: { totalXp: { gt: 0 } },
      select: { id: true, firstName: true, lastName: true, profilePicture: true, currentLevel: true, totalXp: true },
      orderBy: { totalXp: 'desc' },
      take: limit,
    });

    return users.map((u, i) => ({ rank: i + 1, ...u }));
  }

  async getStreak(userId) {
    let streak = await prisma.streak.findUnique({ where: { userId } });
    if (!streak) {
      streak = await prisma.streak.create({ data: { userId } });
    }
    return streak;
  }

  async getMultipliers(userId) {
    const streak = await this.getStreak(userId);
    const todayTasks = await prisma.growthTask.count({
      where: { userId, status: 'COMPLETED', completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    });
    const allTasksToday = await prisma.growthTask.count({
      where: { userId, scheduledDate: { equals: new Date(new Date().setHours(0, 0, 0, 0)) } },
    });

    return {
      streakMultiplier: streak.multiplier,
      scheduleBonus: todayTasks === allTasksToday && allTasksToday > 0 ? 1.1 : 1.0,
      fullDayCompletion: todayTasks === allTasksToday && allTasksToday > 0,
      activeMultipliers: [
        { name: 'Streak', value: streak.multiplier },
        ...(todayTasks === allTasksToday && allTasksToday > 0 ? [{ name: 'Full Day', value: 1.1 }] : []),
      ],
    };
  }

  getStreakMultiplier(currentStreak) {
    if (currentStreak >= 7) return 2.0;
    if (currentStreak >= 5) return 1.5;
    if (currentStreak >= 3) return 1.2;
    return 1.0;
  }

  async grantXp(userId, amount, source, referenceId = null, multiplier = 1.0, description = null) {
    return prisma.$transaction(async (tx) => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayXp = await tx.xpLog.aggregate({
        where: { userId, createdAt: { gte: todayStart }, amount: { gt: 0 } },
        _sum: { amount: true },
      });

      let earnedToday = todayXp._sum.amount || 0;
      if (earnedToday >= DAILY_XP_CAP) {
        return { granted: 0, reason: 'Daily XP cap reached', totalXp: 0 };
      }

      let adjustedAmount = amount * multiplier;
      if (earnedToday + adjustedAmount > DAILY_XP_CAP) {
        if (earnedToday >= DIMINISHING_THRESHOLD) {
          adjustedAmount = Math.floor(adjustedAmount * 0.5);
        }
        adjustedAmount = Math.min(adjustedAmount, DAILY_XP_CAP - earnedToday);
      }

      if (adjustedAmount <= 0) {
        return { granted: 0, reason: 'No XP to grant', totalXp: 0 };
      }

      await tx.xpLog.create({
        data: { userId, amount: adjustedAmount, source, referenceId, multiplier, description },
      });

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { totalXp: { increment: adjustedAmount } },
        select: { totalXp: true, currentLevel: true },
      });

      const newLevel = this.calculateLevel(updatedUser.totalXp);
      if (newLevel !== updatedUser.currentLevel) {
        await tx.user.update({
          where: { id: userId },
          data: { currentLevel: newLevel },
        });
      }

      return { granted: adjustedAmount, newLevel, totalXp: updatedUser.totalXp };
    });
  }

  async applyStreakBonus(userId) {
    return prisma.$transaction(async (tx) => {
      let streak = await tx.streak.findUnique({ where: { userId } });
      if (!streak) {
        streak = await tx.streak.create({ data: { userId } });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (!streak.lastActiveDate) {
        await tx.streak.update({
          where: { userId },
          data: { currentStreak: 1, longestStreak: 1, lastActiveDate: today, multiplier: 1.0 },
        });
        return { streak: 1, multiplier: 1.0 };
      }

      const lastDate = new Date(streak.lastActiveDate);
      lastDate.setHours(0, 0, 0, 0);

      const diffDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        return { streak: streak.currentStreak, multiplier: streak.multiplier };
      }

      if (diffDays === 1) {
        const newStreak = streak.currentStreak + 1;
        const newMultiplier = this.getStreakMultiplier(newStreak);
        await tx.streak.update({
          where: { userId },
          data: {
            currentStreak: newStreak,
            longestStreak: Math.max(newStreak, streak.longestStreak),
            lastActiveDate: today,
            multiplier: newMultiplier,
          },
        });
        return { streak: newStreak, multiplier: newMultiplier };
      }

      await tx.streak.update({
        where: { userId },
        data: { currentStreak: 1, lastActiveDate: today, multiplier: 1.0 },
      });
      return { streak: 1, multiplier: 1.0 };
    });
  }
}

module.exports = new XpService();
