const cron = require('node-cron');
const prisma = require('../config/database');
const { devtrackerService } = require('../modules/devtracker/devtracker.service');
const growthTasksService = require('../modules/growth-tasks/growth-tasks.service');
const xpService = require('../modules/growth-xp/growth-xp.service');
const dailySummaryService = require('../modules/growth-daily-summary/growth-daily-summary.service');
const { getUserNow, getUserTodayDate, DEFAULT_TIMEZONE } = require('../config/timezone');

/**
 * Calendar Reminder Cron Job
 * Runs every hour and checks for events starting in the next 24 hours.
 * Creates reminder notifications for all attendees.
 */
function startCalendarCron() {
  // Run every hour at minute 0
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      // Find events starting in the next 24 hours
      const upcomingEvents = await prisma.event.findMany({
        where: {
          startDate: { gte: now, lte: in24h }
        },
        include: {
          attendees: { select: { userId: true } }
        }
      });

      for (const event of upcomingEvents) {
        const userIds = event.attendees.map(a => a.userId);

        // Check which users already received a reminder for this event
        const existing = await prisma.notification.findMany({
          where: {
            link: `/calendar`,
            title: 'Event Reminder',
            message: { contains: event.id },
            userId: { in: userIds }
          },
          select: { userId: true }
        });
        const alreadyNotified = new Set(existing.map(n => n.userId));

        const newNotifs = userIds
          .filter(uid => !alreadyNotified.has(uid))
          .map(userId => ({
            userId,
            title: 'Event Reminder',
            message: `"${event.title}" starts ${event.allDay ? 'tomorrow' : 'in less than 24 hours'}. [${event.id}]`,
            type: 'info',
            link: '/calendar',
            actorId: event.createdBy
          }));

        if (newNotifs.length) {
          await prisma.notification.createMany({ data: newNotifs });
          console.log(`[CRON] Sent ${newNotifs.length} reminders for event "${event.title}"`);
        }
      }
    } catch (err) {
      console.error('[CRON] Calendar reminder error:', err.message);
    }
  });

  console.log('[CRON] Calendar reminder job scheduled (every hour)');
}

/**
 * Automation Processor Cron Job
 * Simulates processing of scheduled triggers every 5 minutes
 */
function startAutomationCron() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      console.log('[CRON] Running scheduled automations check...');
      // e.g., check for overdue tasks or sprints that need to start, 
      // and call automationService.handleTrigger('SPRINT_STARTED', ...)
    } catch (err) {
      console.error('[CRON] Automation error:', err.message);
    }
  });
  console.log('[CRON] Automation processor job scheduled (every 5 minutes)');
}

/**
 * Dev Session Auto-Timeout Cron Job
 * Runs every 5 minutes. Kills sessions with no heartbeat for 30+ minutes.
 */
function startDevSessionTimeoutCron() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 min
      const staleSessions = await prisma.devSession.findMany({
        where: { isActive: true, lastHeartbeatAt: { lt: cutoff } },
        select: { id: true },
      });

      for (const { id } of staleSessions) {
        try {
          await devtrackerService.forceEndSession(id, null); // null = system/auto-timeout
          console.log(`[CRON] Auto-ended stale dev session ${id}`);
        } catch (err) {
          console.error(`[CRON] Failed to auto-end session ${id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[CRON] Dev session timeout error:', err.message);
    }
  });
  console.log('[CRON] Dev session timeout job scheduled (every 5 minutes, 30min threshold)');
}

function startGrowthCronJobs() {
  // Daily midnight: carry over overdue tasks
  cron.schedule('0 0 * * *', async () => {
    try {
      const result = await growthTasksService.runCarryOver();
      console.log(`[CRON] Growth carry-over: ${result.processed} tasks processed`);
    } catch (err) {
      console.error('[CRON] Growth carry-over error:', err.message);
    }
  });

  // Daily midnight: reset gaming time for all users
  cron.schedule('0 0 * * *', async () => {
    try {
      const users = await prisma.user.findMany({ select: { id: true, totalGamingMinutes: true, timezone: true } });
      for (const user of users) {
        try {
          const todayTasks = await prisma.growthTask.count({
            where: { userId: user.id, status: 'COMPLETED', completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
          });
          const overdueCount = await prisma.growthTask.count({
            where: { userId: user.id, status: 'OVERDUE' },
          });
          const carryOverCount = await prisma.growthTask.count({
            where: { userId: user.id, isCarryOver: true, status: { in: ['PENDING', 'ACTIVE'] } },
          });
          const streak = await xpService.getStreak(user.id);

          const baseTime = user.totalGamingMinutes || 120;
          const penalties = (overdueCount * 15) + (carryOverCount * 10);
          const bonuses = (todayTasks * 10) + (streak.currentStreak * 5);
          const gamingTime = Math.max(0, baseTime - penalties + bonuses);

          const tz = user.timezone || DEFAULT_TIMEZONE;
          const todayDate = getUserTodayDate(tz);
          await prisma.dailySummary.upsert({
            where: { userId_date: { userId: user.id, date: todayDate } },
            update: {
              baseGamingMinutes: baseTime,
              penaltyMinutes: penalties,
              bonusMinutes: bonuses,
              finalGamingMinutes: gamingTime,
              overduePenalty: overdueCount * 15,
              carryOverPenalty: carryOverCount * 10,
              completedTaskBonus: todayTasks * 10,
              streakBonus: streak.currentStreak * 5,
              soloMinutes: baseTime > 0 ? Math.floor(gamingTime * ((user.soloGamingMinutes || 60) / baseTime)) : 0,
              collabMinutes: baseTime > 0 ? gamingTime - Math.floor(gamingTime * ((user.soloGamingMinutes || 60) / baseTime)) : 0,
            },
            create: {
              userId: user.id,
              date: todayDate,
              baseGamingMinutes: baseTime,
              penaltyMinutes: penalties,
              bonusMinutes: bonuses,
              finalGamingMinutes: gamingTime,
              overduePenalty: overdueCount * 15,
              carryOverPenalty: carryOverCount * 10,
              completedTaskBonus: todayTasks * 10,
              streakBonus: streak.currentStreak * 5,
              soloMinutes: baseTime > 0 ? Math.floor(gamingTime * ((user.soloGamingMinutes || 60) / baseTime)) : 0,
              collabMinutes: baseTime > 0 ? gamingTime - Math.floor(gamingTime * ((user.soloGamingMinutes || 60) / baseTime)) : 0,
            },
          });

          await prisma.user.update({
            where: { id: user.id },
            data: { gamingTimeMinutes: gamingTime, dailyFreeTimeMinutes: gamingTime },
          });
        } catch (err) {
          console.error(`[CRON] Gaming reset error for user ${user.id}:`, err.message);
        }
      }
      console.log('[CRON] Growth gaming time reset completed');
    } catch (err) {
      console.error('[CRON] Gaming reset error:', err.message);
    }
  });

  // Daily 00:01: update streaks
  cron.schedule('1 0 * * *', async () => {
    try {
      const streaks = await prisma.streak.findMany({ select: { userId: true } });
      for (const s of streaks) {
        try {
          await xpService.applyStreakBonus(s.userId);
        } catch (err) {
          console.error(`[CRON] Streak update error for user ${s.userId}:`, err.message);
        }
      }
      console.log('[CRON] Growth streaks updated');
    } catch (err) {
      console.error('[CRON] Streak update error:', err.message);
    }
  });

  // Every 15 min: mark overdue tasks
  cron.schedule('*/15 * * * *', async () => {
    try {
      const result = await growthTasksService.markOverdueTasks();
      if (result.marked > 0) console.log(`[CRON] Marked ${result.marked} growth tasks as overdue`);
    } catch (err) {
      console.error('[CRON] Growth overdue error:', err.message);
    }
  });

  // Every minute: check gaming session locks
  cron.schedule('* * * * *', async () => {
    try {
      const activeSessions = await prisma.gamingSession.findMany({
        where: { status: 'SCHEDULED', isLocked: false },
        select: { id: true, userId: true },
      });
      for (const session of activeSessions) {
        const incompleteCount = await prisma.growthTask.count({
          where: { userId: session.userId, status: { in: ['PENDING', 'ACTIVE'] } },
        });
        if (incompleteCount >= 3) {
          await prisma.gamingSession.update({
            where: { id: session.id },
            data: { isLocked: true, lockReason: 'Complete tasks to unlock gaming' },
          });
        }
      }
    } catch (err) {
      console.error('[CRON] Gaming lock check error:', err.message);
    }
  });

  startGrowthRoutineCron();

  console.log('[CRON] Growth system jobs scheduled');
}

function startGrowthRoutineCron() {
  cron.schedule('*/15 * * * *', async () => {
    try {
      const users = await prisma.user.findMany({
        where: {
          OR: [
            { sleepTime: { not: null } },
            { wakeTime: { not: null } },
          ],
        },
        select: { id: true, sleepTime: true, wakeTime: true, timezone: true },
      });

      for (const user of users) {
        const tz = user.timezone || DEFAULT_TIMEZONE;
        const now = getUserNow(tz);
        const date = getUserTodayDate(tz);

        if (user.wakeTime) {
          const [wh, wm] = user.wakeTime.split(':').map(Number);
          const wakeDeadline = now.clone().hour(wh).minute(wm + 30).second(0).millisecond(0);

          if (now.isAfter(wakeDeadline)) {
            const existing = await prisma.routineCheckin.findUnique({
              where: { userId_type_date: { userId: user.id, type: 'WAKE', date } },
            });
            if (!existing) {
              const deviation = Math.round(now.diff(wakeDeadline, 'minute', true));
              await prisma.$transaction(async (tx) => {
                await tx.routineCheckin.create({
                  data: {
                    userId: user.id,
                    type: 'WAKE',
                    checkinAt: new Date(),
                    isOnTime: false,
                    deviationMinutes: Math.max(0, deviation),
                    date,
                  },
                });
                const streak = await tx.streak.findUnique({ where: { userId: user.id } });
                if (streak) {
                  await tx.streak.update({
                    where: { userId: user.id },
                    data: { wakeStreak: 0, lastWakeCheckin: date },
                  });
                }
              });
              await xpService.grantXp(user.id, 15, 'PENALTY', null, 1.0, 'Missed wake check-in penalty');
              await dailySummaryService.applyRoutineDelta(user.id, tz, 'WAKE', false);
              console.log(`[CRON] Applied missed wake penalty for user ${user.id}`);
            }
          }
        }

        if (user.sleepTime) {
          const [sh, sm] = user.sleepTime.split(':').map(Number);
          const sleepDeadline = now.clone().hour(sh).minute(sm + 30).second(0).millisecond(0);

          if (now.isAfter(sleepDeadline)) {
            const existing = await prisma.routineCheckin.findUnique({
              where: { userId_type_date: { userId: user.id, type: 'SLEEP', date } },
            });
            if (!existing) {
              const deviation = Math.round(now.diff(sleepDeadline, 'minute', true));
              await prisma.$transaction(async (tx) => {
                await tx.routineCheckin.create({
                  data: {
                    userId: user.id,
                    type: 'SLEEP',
                    checkinAt: new Date(),
                    isOnTime: false,
                    deviationMinutes: Math.max(0, deviation),
                    date,
                  },
                });
                const streak = await tx.streak.findUnique({ where: { userId: user.id } });
                if (streak) {
                  await tx.streak.update({
                    where: { userId: user.id },
                    data: { sleepStreak: 0, lastSleepCheckin: date },
                  });
                }
              });
              await xpService.grantXp(user.id, 10, 'PENALTY', null, 1.0, 'Late sleep check-in penalty');
              await dailySummaryService.applyRoutineDelta(user.id, tz, 'SLEEP', false);
              console.log(`[CRON] Applied late sleep penalty for user ${user.id}`);
            }
          }
        }
      }
    } catch (err) { console.error('[CRON] Routine check-in error:', err.message); }
  });
  console.log('[CRON] Growth routine check-in job scheduled (every 15 minutes)');
}

module.exports = { startCalendarCron, startAutomationCron, startDevSessionTimeoutCron, startGrowthCronJobs, startGrowthRoutineCron };
