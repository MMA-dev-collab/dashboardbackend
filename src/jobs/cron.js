const cron = require('node-cron');
const prisma = require('../config/database');

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

module.exports = { startCalendarCron };
