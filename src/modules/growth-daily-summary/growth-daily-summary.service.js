const prisma = require('../../config/database');
const { getUserTodayDate, DEFAULT_TIMEZONE } = require('../../config/timezone');

const OVERDUE_PENALTY = 15;
const CARRY_OVER_PENALTY = 10;
const COMPLETION_BONUS = 10;
const STREAK_BONUS_PER_DAY = 5;
const LATE_SLEEP_PENALTY = 15;
const MISSED_WAKE_PENALTY = 20;
const ON_TIME_SLEEP_BONUS = 5;
const ON_TIME_WAKE_BONUS = 10;

class DailySummaryService {
  async getOrCreate(userId, tz) {
    const date = getUserTodayDate(tz);
    let summary = await prisma.dailySummary.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (!summary) {
      summary = await this.recompute(userId, tz);
    }
    return summary;
  }

  async recompute(userId, tz) {
    const date = getUserTodayDate(tz);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        totalGamingMinutes: true,
        soloGamingMinutes: true,
        collabGamingMinutes: true,
      },
    });

    const schedule = await prisma.schedule.findUnique({
      where: { userId_date: { userId, date } },
      select: { gamingMinutes: true, soloMinutes: true, collabMinutes: true },
    });

    const totalGaming = schedule?.gamingMinutes ?? user?.totalGamingMinutes ?? 120;
    const soloGaming = schedule?.soloMinutes ?? user?.soloGamingMinutes ?? 60;
    const soloRatio = totalGaming > 0 ? soloGaming / totalGaming : 0;

    const [overdueCount, carryOverCount, completedCount, streak, sleepCheckin, wakeCheckin] = await Promise.all([
      prisma.growthTask.count({ where: { userId, status: 'OVERDUE' } }),
      prisma.growthTask.count({ where: { userId, isCarryOver: true, status: { in: ['PENDING', 'ACTIVE'] } } }),
      prisma.growthTask.count({
        where: { userId, status: 'COMPLETED', completedAt: { gte: date } },
      }),
      prisma.streak.findUnique({ where: { userId } }),
      prisma.routineCheckin.findUnique({
        where: { userId_type_date: { userId, type: 'SLEEP', date } },
      }),
      prisma.routineCheckin.findUnique({
        where: { userId_type_date: { userId, type: 'WAKE', date } },
      }),
    ]);

    const streakDays = streak?.currentStreak || 0;

    const overduePenalty = overdueCount * OVERDUE_PENALTY;
    const carryOverPenalty = carryOverCount * CARRY_OVER_PENALTY;
    const lateSleepPenalty = sleepCheckin && !sleepCheckin.isOnTime ? LATE_SLEEP_PENALTY : 0;
    const missedWakePenalty = wakeCheckin && !wakeCheckin.isOnTime ? MISSED_WAKE_PENALTY : 0;

    const completedTaskBonus = completedCount * COMPLETION_BONUS;
    const streakBonus = streakDays * STREAK_BONUS_PER_DAY;
    const onTimeSleepBonus = sleepCheckin?.isOnTime ? ON_TIME_SLEEP_BONUS : 0;
    const onTimeWakeBonus = wakeCheckin?.isOnTime ? ON_TIME_WAKE_BONUS : 0;

    const totalPenalty = overduePenalty + carryOverPenalty + lateSleepPenalty + missedWakePenalty;
    const totalBonus = completedTaskBonus + streakBonus + onTimeSleepBonus + onTimeWakeBonus;
    const finalGaming = Math.max(0, totalGaming - totalPenalty + totalBonus);

    const soloMinutes = totalGaming > 0 ? Math.floor(finalGaming * soloRatio) : 0;
    const collabMinutes = totalGaming > 0 ? finalGaming - soloMinutes : 0;

    return prisma.dailySummary.upsert({
      where: { userId_date: { userId, date } },
      update: {
        baseGamingMinutes: totalGaming,
        penaltyMinutes: totalPenalty,
        bonusMinutes: totalBonus,
        finalGamingMinutes: finalGaming,
        soloMinutes,
        collabMinutes,
        overduePenalty,
        carryOverPenalty,
        lateSleepPenalty,
        missedWakePenalty,
        completedTaskBonus,
        streakBonus,
        onTimeSleepBonus,
        onTimeWakeBonus,
        sleepCheckedIn: !!sleepCheckin,
        wakeCheckedIn: !!wakeCheckin,
      },
      create: {
        userId,
        date,
        baseGamingMinutes: totalGaming,
        penaltyMinutes: totalPenalty,
        bonusMinutes: totalBonus,
        finalGamingMinutes: finalGaming,
        soloMinutes,
        collabMinutes,
        overduePenalty,
        carryOverPenalty,
        lateSleepPenalty,
        missedWakePenalty,
        completedTaskBonus,
        streakBonus,
        onTimeSleepBonus,
        onTimeWakeBonus,
        sleepCheckedIn: !!sleepCheckin,
        wakeCheckedIn: !!wakeCheckin,
      },
    });
  }

  async applyRoutineDelta(userId, tz, type, isOnTime) {
    const date = getUserTodayDate(tz);
    const penaltyField = type === 'SLEEP' ? 'lateSleepPenalty' : 'missedWakePenalty';
    const bonusField = type === 'SLEEP' ? 'onTimeSleepBonus' : 'onTimeWakeBonus';
    const checkedInField = type === 'SLEEP' ? 'sleepCheckedIn' : 'wakeCheckedIn';
    const penaltyAmount = type === 'SLEEP' ? LATE_SLEEP_PENALTY : MISSED_WAKE_PENALTY;
    const bonusAmount = type === 'SLEEP' ? ON_TIME_SLEEP_BONUS : ON_TIME_WAKE_BONUS;

    let summary = await this.getOrCreate(userId, tz);

    const delta = isOnTime ? bonusAmount : -penaltyAmount;
    const newPenalty = isOnTime ? summary[penaltyField] : summary[penaltyField] + penaltyAmount;
    const newBonus = isOnTime ? summary[bonusField] + bonusAmount : summary[bonusField];
    const newFinal = Math.max(0, summary.finalGamingMinutes + delta);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { totalGamingMinutes: true, soloGamingMinutes: true, collabGamingMinutes: true },
    });
    const schedule = await prisma.schedule.findUnique({
      where: { userId_date: { userId, date } },
      select: { gamingMinutes: true, soloMinutes: true, collabMinutes: true },
    });
    const totalGaming = schedule?.gamingMinutes ?? user?.totalGamingMinutes ?? 120;
    const soloGaming = schedule?.soloMinutes ?? user?.soloGamingMinutes ?? 60;
    const soloRatio = totalGaming > 0 ? soloGaming / totalGaming : 0;
    const newSolo = totalGaming > 0 ? Math.floor(newFinal * soloRatio) : 0;
    const newCollab = totalGaming > 0 ? newFinal - newSolo : 0;

    summary = await prisma.dailySummary.update({
      where: { userId_date: { userId, date } },
      data: {
        [penaltyField]: newPenalty,
        [bonusField]: newBonus,
        penaltyMinutes: summary.penaltyMinutes + (isOnTime ? 0 : penaltyAmount),
        bonusMinutes: summary.bonusMinutes + (isOnTime ? bonusAmount : 0),
        finalGamingMinutes: newFinal,
        soloMinutes: newSolo,
        collabMinutes: newCollab,
        [checkedInField]: true,
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { gamingTimeMinutes: newFinal },
    });

    return summary;
  }

  async applyTaskDelta(userId, tz, type) {
    const date = getUserTodayDate(tz);
    let summary = await this.getOrCreate(userId, tz);

    let delta = 0;
    let updateFields = {};

    if (type === 'COMPLETED') {
      delta = COMPLETION_BONUS;
      updateFields.completedTaskBonus = summary.completedTaskBonus + COMPLETION_BONUS;
      updateFields.bonusMinutes = summary.bonusMinutes + COMPLETION_BONUS;
    } else if (type === 'OVERDUE') {
      delta = -OVERDUE_PENALTY;
      updateFields.overduePenalty = summary.overduePenalty + OVERDUE_PENALTY;
      updateFields.penaltyMinutes = summary.penaltyMinutes + OVERDUE_PENALTY;
    } else if (type === 'CARRY_OVER') {
      delta = -CARRY_OVER_PENALTY;
      updateFields.carryOverPenalty = summary.carryOverPenalty + CARRY_OVER_PENALTY;
      updateFields.penaltyMinutes = summary.penaltyMinutes + CARRY_OVER_PENALTY;
    }

    const newFinal = Math.max(0, summary.finalGamingMinutes + delta);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { totalGamingMinutes: true, soloGamingMinutes: true, collabGamingMinutes: true },
    });
    const schedule = await prisma.schedule.findUnique({
      where: { userId_date: { userId, date } },
      select: { gamingMinutes: true, soloMinutes: true, collabMinutes: true },
    });
    const totalGaming = schedule?.gamingMinutes ?? user?.totalGamingMinutes ?? 120;
    const soloGaming = schedule?.soloMinutes ?? user?.soloGamingMinutes ?? 60;
    const soloRatio = totalGaming > 0 ? soloGaming / totalGaming : 0;
    updateFields.soloMinutes = totalGaming > 0 ? Math.floor(newFinal * soloRatio) : 0;
    updateFields.collabMinutes = totalGaming > 0 ? newFinal - updateFields.soloMinutes : 0;
    updateFields.finalGamingMinutes = newFinal;

    summary = await prisma.dailySummary.update({
      where: { userId_date: { userId, date } },
      data: updateFields,
    });

    await prisma.user.update({
      where: { id: userId },
      data: { gamingTimeMinutes: newFinal },
    });

    return summary;
  }
}

module.exports = new DailySummaryService();
