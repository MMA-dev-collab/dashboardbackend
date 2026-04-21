const prisma = require('../../config/database');
const { NotFoundError, BadRequestError, ConflictError } = require('../../utils/errors');
const { getUserNow, getUserTodayDate, parseTimeInTz, minutesBetween, DEFAULT_TIMEZONE } = require('../../config/timezone');
const dailySummaryService = require('../growth-daily-summary/growth-daily-summary.service');
const xpService = require('../growth-xp/growth-xp.service');

const SLEEP_WINDOW_MINUTES = 30;
const WAKE_WINDOW_MINUTES = 30;
const LATE_SLEEP_XP_PENALTY = -10;
const MISSED_WAKE_XP_PENALTY = -15;
const ON_TIME_SLEEP_XP_BONUS = 5;
const ON_TIME_WAKE_XP_BONUS = 10;

class GrowthRoutineService {
  async getStatus(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { sleepTime: true, wakeTime: true, timezone: true },
    });
    if (!user) throw new NotFoundError('User not found');

    const tz = user.timezone || DEFAULT_TIMEZONE;
    const date = getUserTodayDate(tz);

    const [sleepCheckin, wakeCheckin, streak] = await Promise.all([
      prisma.routineCheckin.findUnique({
        where: { userId_type_date: { userId, type: 'SLEEP', date } },
      }),
      prisma.routineCheckin.findUnique({
        where: { userId_type_date: { userId, type: 'WAKE', date } },
      }),
      prisma.streak.findUnique({ where: { userId } }),
    ]);

    const sleepWindowEnd = user.sleepTime
      ? this._addMinutes(user.sleepTime, SLEEP_WINDOW_MINUTES)
      : null;
    const wakeWindowEnd = user.wakeTime
      ? this._addMinutes(user.wakeTime, WAKE_WINDOW_MINUTES)
      : null;

    return {
      timezone: tz,
      sleepTime: user.sleepTime,
      wakeTime: user.wakeTime,
      sleepWindowEnd,
      wakeWindowEnd,
      todaySleep: sleepCheckin
        ? {
            checkedIn: true,
            checkinAt: sleepCheckin.checkinAt,
            isOnTime: sleepCheckin.isOnTime,
            isEarly: sleepCheckin.isOnTime && sleepCheckin.deviationMinutes < 0,
            deviationMinutes: sleepCheckin.deviationMinutes,
          }
        : { checkedIn: false, checkinAt: null, isOnTime: null, isEarly: null, deviationMinutes: null },
      todayWake: wakeCheckin
        ? {
            checkedIn: true,
            checkinAt: wakeCheckin.checkinAt,
            isOnTime: wakeCheckin.isOnTime,
            isEarly: wakeCheckin.isOnTime && wakeCheckin.deviationMinutes < 0,
            deviationMinutes: wakeCheckin.deviationMinutes,
          }
        : { checkedIn: false, checkinAt: null, isOnTime: null, isEarly: null, deviationMinutes: null },
      sleepStreak: streak?.sleepStreak || 0,
      wakeStreak: streak?.wakeStreak || 0,
    };
  }

  async checkin(userId, type) {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { sleepTime: true, wakeTime: true, timezone: true },
      });
      if (!user) throw new NotFoundError('User not found');

      const targetTime = type === 'SLEEP' ? user.sleepTime : user.wakeTime;
      if (!targetTime) {
        throw new BadRequestError(`Please set your ${type === 'SLEEP' ? 'sleep' : 'wake'} time in settings first`);
      }

      const tz = user.timezone || DEFAULT_TIMEZONE;
      const date = getUserTodayDate(tz);
      const now = getUserNow(tz);

      const existing = await tx.routineCheckin.findUnique({
        where: { userId_type_date: { userId, type, date } },
      });
      if (existing) {
        throw new ConflictError(`You already checked in ${type.toLowerCase()} today`);
      }

      const windowMinutes = type === 'SLEEP' ? SLEEP_WINDOW_MINUTES : WAKE_WINDOW_MINUTES;
      const targetMoment = parseTimeInTz(targetTime, tz, now.format('YYYY-MM-DD'));
      const windowEnd = targetMoment.add(windowMinutes, 'minute');
      const currentMoment = getUserNow(tz);

      let isOnTime = false;
      let isEarly = false;
      let deviationMinutes = 0;

      if (currentMoment.isBefore(targetMoment)) {
        isEarly = true;
        isOnTime = false;
        deviationMinutes = -minutesBetween(currentMoment, targetMoment);
      } else if (currentMoment.isSameOrBefore(windowEnd)) {
        isOnTime = true;
        deviationMinutes = 0;
      } else {
        isOnTime = false;
        deviationMinutes = minutesBetween(windowEnd, currentMoment);
      }

      await tx.routineCheckin.create({
        data: {
          userId,
          type,
          checkinAt: new Date(),
          isOnTime: isEarly ? true : isOnTime,
          deviationMinutes,
          date,
        },
      });

      let streak = await tx.streak.findUnique({ where: { userId } });
      if (!streak) {
        streak = await tx.streak.create({ data: { userId } });
      }

      const shouldUpdateStreak = isOnTime && !isEarly;

      if (type === 'SLEEP') {
        if (shouldUpdateStreak) {
          const newStreak = (streak.sleepStreak || 0) + 1;
          await tx.streak.update({
            where: { userId },
            data: {
              sleepStreak: newStreak,
              longestSleepStreak: Math.max(newStreak, streak.longestSleepStreak || 0),
              lastSleepCheckin: date,
            },
          });
        } else if (!isOnTime) {
          await tx.streak.update({
            where: { userId },
            data: { sleepStreak: 0, lastSleepCheckin: date },
          });
        }
      } else {
        if (shouldUpdateStreak) {
          const newStreak = (streak.wakeStreak || 0) + 1;
          await tx.streak.update({
            where: { userId },
            data: {
              wakeStreak: newStreak,
              longestWakeStreak: Math.max(newStreak, streak.longestWakeStreak || 0),
              lastWakeCheckin: date,
            },
          });
        } else if (!isOnTime) {
          await tx.streak.update({
            where: { userId },
            data: { wakeStreak: 0, lastWakeCheckin: date },
          });
        }
      }

      return { type, isOnTime, isEarly, deviationMinutes, checkinAt: new Date(), tz };
    }, { timeout: 15000 });

    if (result.isEarly) {
      return {
        type: result.type,
        isOnTime: true,
        isEarly: true,
        deviationMinutes: result.deviationMinutes,
        checkinAt: result.checkinAt,
        message: `Checked in ${Math.abs(result.deviationMinutes)} minutes early`,
      };
    }

    const xpAmount = result.isOnTime
      ? (type === 'SLEEP' ? ON_TIME_SLEEP_XP_BONUS : ON_TIME_WAKE_XP_BONUS)
      : (type === 'SLEEP' ? LATE_SLEEP_XP_PENALTY : MISSED_WAKE_XP_PENALTY);

    if (xpAmount > 0) {
      await xpService.grantXp(userId, xpAmount, 'ROUTINE', null, 1.0,
        `On-time ${type.toLowerCase()} check-in bonus`);
    } else {
      await xpService.grantXp(userId, Math.abs(xpAmount), 'PENALTY', null, 1.0,
        `Late ${type.toLowerCase()} check-in penalty`);
    }

    await dailySummaryService.applyRoutineDelta(userId, result.tz, type, result.isOnTime);

    return result;
  }

  _addMinutes(timeStr, minutes) {
    const [h, m] = timeStr.split(':').map(Number);
    const total = h * 60 + m + minutes;
    const newH = Math.floor(total / 60) % 24;
    const newM = total % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  }
}

module.exports = new GrowthRoutineService();
