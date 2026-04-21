const prisma = require('../../config/database');
const { NotFoundError, BadRequestError, ForbiddenError } = require('../../utils/errors');
const xpService = require('../growth-xp/growth-xp.service');
const dailySummaryService = require('../growth-daily-summary/growth-daily-summary.service');
const { DEFAULT_TIMEZONE } = require('../../config/timezone');

const LOCK_TASK_THRESHOLD = 3;

class GrowthGamingService {
  async getGamingStatus(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, gamingTimeMinutes: true, timezone: true, totalGamingMinutes: true },
    });
    if (!user) throw new NotFoundError('User not found');

    const tz = user.timezone || DEFAULT_TIMEZONE;
    const summary = await dailySummaryService.getOrCreate(userId, tz);

    const incompleteCount = await prisma.growthTask.count({
      where: { userId, status: { in: ['PENDING', 'ACTIVE'] } },
    });

    const lockStatus = this._calculateLockStatus(incompleteCount, summary.finalGamingMinutes);

    return {
      availableMinutes: summary.finalGamingMinutes,
      baseMinutes: summary.baseGamingMinutes,
      soloMinutes: summary.soloMinutes,
      collabMinutes: summary.collabMinutes,
      penalties: {
        overdue: summary.overduePenalty,
        carryOver: summary.carryOverPenalty,
        lateSleep: summary.lateSleepPenalty,
        missedWake: summary.missedWakePenalty,
        total: summary.penaltyMinutes,
      },
      bonuses: {
        completedTasks: summary.completedTaskBonus,
        streak: summary.streakBonus,
        onTimeSleep: summary.onTimeSleepBonus,
        onTimeWake: summary.onTimeWakeBonus,
        total: summary.bonusMinutes,
      },
      isLocked: lockStatus.isLocked,
      lockReason: lockStatus.reason,
      incompleteTasks: incompleteCount,
    };
  }

  async getLockStatus(userId) {
    const incompleteCount = await prisma.growthTask.count({
      where: { userId, status: { in: ['PENDING', 'ACTIVE'] } },
    });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { gamingTimeMinutes: true },
    });

    return this._calculateLockStatus(incompleteCount, user?.gamingTimeMinutes || 0);
  }

  async listSessions(userId, { status } = {}) {
    const where = { userId };
    if (status) where.status = status;
    return prisma.gamingSession.findMany({
      where,
      include: { team: { select: { id: true, name: true } } },
      orderBy: { startTime: 'desc' },
    });
  }

  async createSoloSession(userId, data) {
    const lockStatus = await this.getLockStatus(userId);
    if (lockStatus.isLocked) {
      throw new ForbiddenError(`Gaming is locked: ${lockStatus.reason}`);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { gamingTimeMinutes: true },
    });

    if (user.gamingTimeMinutes < data.plannedDuration) {
      throw new BadRequestError(`Not enough gaming time. Available: ${user.gamingTimeMinutes} min, requested: ${data.plannedDuration} min`);
    }

    return prisma.gamingSession.create({
      data: {
        userId,
        sessionType: data.sessionType || 'SOLO',
        teamId: data.teamId || null,
        startTime: new Date(data.startTime),
        endTime: new Date(new Date(data.startTime).getTime() + data.plannedDuration * 60000),
        plannedDuration: data.plannedDuration,
        status: 'SCHEDULED',
        isLocked: false,
      },
    });
  }

  async startSession(sessionId, userId) {
    return prisma.$transaction(async (tx) => {
      const session = await tx.gamingSession.findFirst({ where: { id: sessionId, userId } });
      if (!session) throw new NotFoundError('Session not found');
      if (session.status !== 'SCHEDULED') throw new BadRequestError('Session cannot be started');

      const lockStatus = await this.getLockStatus(userId);
      if (lockStatus.isLocked) {
        await tx.gamingSession.update({ where: { id: sessionId }, data: { isLocked: true, lockReason: lockStatus.reason } });
        throw new ForbiddenError(`Gaming is locked: ${lockStatus.reason}`);
      }

      const user = await tx.user.findUnique({ where: { id: userId }, select: { gamingTimeMinutes: true } });
      if (user.gamingTimeMinutes < session.plannedDuration) {
        throw new BadRequestError('Not enough gaming time available');
      }

      const updated = await tx.gamingSession.update({
        where: { id: sessionId },
        data: { status: 'ACTIVE', startedAt: new Date(), isLocked: false, lockReason: null },
      });

      await tx.user.update({
        where: { id: userId },
        data: { gamingTimeMinutes: { decrement: session.plannedDuration } },
      });

      return updated;
    });
  }

  async endSession(sessionId, userId) {
    return prisma.$transaction(async (tx) => {
      const session = await tx.gamingSession.findFirst({ where: { id: sessionId, userId } });
      if (!session) throw new NotFoundError('Session not found');
      if (session.status !== 'ACTIVE') throw new BadRequestError('Session is not active');

      const endedAt = new Date();
      const actualDuration = session.startedAt
        ? Math.round((endedAt - session.startedAt) / 60000)
        : session.plannedDuration;

      const updated = await tx.gamingSession.update({
        where: { id: sessionId },
        data: { status: 'COMPLETED', endedAt, actualDuration },
      });

      const difference = session.plannedDuration - actualDuration;
      if (difference > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { gamingTimeMinutes: { increment: difference } },
        });
      } else if (difference < 0) {
        await tx.user.update({
          where: { id: userId },
          data: { gamingTimeMinutes: { decrement: Math.abs(difference) } },
        });
      }

      if (actualDuration >= 15) {
        await xpService.grantXp(userId, 5, 'GAMING', sessionId, 1.0, 'Gaming session engagement bonus');
      }

      return updated;
    });
  }

  async cancelSession(sessionId, userId) {
    const session = await prisma.gamingSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw new NotFoundError('Session not found');
    if (session.status === 'ACTIVE') throw new BadRequestError('Cannot cancel an active session — end it instead');

    return prisma.gamingSession.update({
      where: { id: sessionId },
      data: { status: 'CANCELLED' },
    });
  }

  async getSuggestions(userId) {
    const [status, teams] = await Promise.all([
      this.getGamingStatus(userId),
      prisma.growthTeamMember.findMany({
        where: { userId },
        include: { team: { include: { members: { include: { user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } } } } } } },
      }),
    ]);

    const suggestions = [];

    if (status.availableMinutes >= 30 && !status.isLocked) {
      suggestions.push({
        type: 'solo',
        title: 'Solo Gaming Available',
        description: `You have ${status.availableMinutes} minutes of gaming time available now.`,
        availableMinutes: status.availableMinutes,
      });
    }

    if (status.isLocked) {
      const tasksNeeded = Math.max(0, LOCK_TASK_THRESHOLD - (status.incompleteTasks > LOCK_TASK_THRESHOLD ? 0 : LOCK_TASK_THRESHOLD - status.incompleteTasks));
      suggestions.push({
        type: 'unlock',
        title: 'Unlock Gaming',
        description: `Complete ${tasksNeeded} more task${tasksNeeded !== 1 ? 's' : ''} to unlock gaming.`,
        tasksNeeded,
      });
    }

    for (const tm of teams) {
      suggestions.push({
        type: 'team',
        title: `${tm.team.name} — Team Session`,
        description: `Coordinate with ${tm.team.members.length} team member${tm.team.members.length !== 1 ? 's' : ''}.`,
        teamId: tm.team.id,
        memberCount: tm.team.members.length,
      });
    }

    return suggestions;
  }

  _calculateLockStatus(incompleteTaskCount, gamingTimeMinutes) {
    if (incompleteTaskCount >= LOCK_TASK_THRESHOLD) {
      return { isLocked: true, reason: `Complete at least ${incompleteTaskCount} pending task${incompleteTaskCount !== 1 ? 's' : ''} to unlock gaming`, status: 'LOCKED' };
    }
    if (gamingTimeMinutes <= 0) {
      return { isLocked: true, reason: 'No gaming time available', status: 'LOCKED' };
    }
    if (gamingTimeMinutes < 30) {
      return { isLocked: false, reason: 'Limited time available', status: 'PARTIAL' };
    }
    return { isLocked: false, reason: null, status: 'UNLOCKED' };
  }
}

module.exports = new GrowthGamingService();
