const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const prisma = require('../../config/database');
const { success, created } = require('../../utils/response');

const router = Router();
router.use(authenticate);

// ─────────────────────────────────────────────
// GET /calendar/me  – Aggregated calendar feed
// Query: ?start=ISO&end=ISO
// Returns tasks (by dueDate), projects (by date range), events (by attendance/creator)
// ─────────────────────────────────────────────
router.get('/me', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const start = req.query.start ? new Date(req.query.start) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end   = req.query.end   ? new Date(req.query.end)   : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59);

    const [tasks, projects, events] = await Promise.all([
      // Tasks assigned to user with a due date in the range
      prisma.task.findMany({
        where: {
          assigneeId: userId,
          isArchived: false,
          dueDate: { gte: start, lte: end }
        },
        select: {
          id: true, title: true, dueDate: true, priority: true, type: true,
          project: { select: { id: true, name: true } },
          column: { select: { name: true } }
        }
      }),

      // Projects the user is a partner on, with dates overlapping the range
      prisma.project.findMany({
        where: {
          partners: { some: { userId } },
          OR: [
            { startDate: { gte: start, lte: end } },
            { endDate: { gte: start, lte: end } },
            { AND: [{ startDate: { lte: start } }, { endDate: { gte: end } }] }
          ]
        },
        select: {
          id: true, name: true, status: true, startDate: true, endDate: true
        }
      }),

      // Events where user is an attendee or the creator
      prisma.event.findMany({
        where: {
          OR: [
            { attendees: { some: { userId } } },
            { createdBy: userId }
          ],
          startDate: { lte: end },
          endDate: { gte: start }
        },
        include: {
          creator: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
          attendees: {
            include: { user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } } }
          },
          project: { select: { id: true, name: true } }
        }
      })
    ]);

    // Normalise into a unified calendar format
    const calendarItems = [
      ...tasks.map(t => ({
        id: `task-${t.id}`,
        sourceId: t.id,
        title: t.title,
        start: t.dueDate,
        end: t.dueDate,
        allDay: true,
        type: 'task',
        color: t.priority === 'CRITICAL' ? '#ef4444' : t.priority === 'HIGH' ? '#f59e0b' : '#3b82f6',
        meta: { priority: t.priority, taskType: t.type, project: t.project, column: t.column?.name }
      })),
      ...projects.map(p => ({
        id: `project-${p.id}`,
        sourceId: p.id,
        title: p.name,
        start: p.startDate || p.endDate,
        end: p.endDate || p.startDate,
        allDay: true,
        type: 'project',
        color: '#10b981',
        meta: { status: p.status }
      })),
      ...events.map(e => ({
        id: `event-${e.id}`,
        sourceId: e.id,
        title: e.title,
        start: e.startDate,
        end: e.endDate,
        allDay: e.allDay,
        type: 'event',
        color: e.color || '#8b5cf6',
        meta: {
          description: e.description,
          eventType: e.type,
          project: e.project,
          creator: e.creator,
          attendees: e.attendees.map(a => a.user)
        }
      }))
    ];

    success(res, calendarItems);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// CRUD for Events (Admin-only create/update/delete)
// ─────────────────────────────────────────────

// List all events
router.get('/events', async (req, res, next) => {
  try {
    const events = await prisma.event.findMany({
      include: {
        creator: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
        attendees: {
          include: { user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } } }
        },
        project: { select: { id: true, name: true } }
      },
      orderBy: { startDate: 'asc' }
    });
    success(res, events);
  } catch (err) { next(err); }
});

// Create event
router.post('/events', async (req, res, next) => {
  try {
    const { title, description, startDate, endDate, allDay, color, type, projectId, attendeeIds } = req.body;

    const event = await prisma.event.create({
      data: {
        title,
        description: description || null,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        allDay: allDay || false,
        color: color || null,
        type: type || 'meeting',
        projectId: projectId || null,
        createdBy: req.user.id,
        attendees: attendeeIds?.length ? {
          create: attendeeIds.map(userId => ({ userId }))
        } : undefined
      },
      include: {
        creator: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
        attendees: {
          include: { user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } } }
        },
        project: { select: { id: true, name: true } }
      }
    });

    // Notify attendees
    if (attendeeIds?.length) {
      const notifs = attendeeIds
        .filter(id => id !== req.user.id)
        .map(userId => ({
          userId,
          title: 'New Event',
          message: `You've been invited to "${event.title}"`,
          type: 'info',
          link: '/calendar',
          actorId: req.user.id
        }));
      if (notifs.length) {
        await prisma.notification.createMany({ data: notifs });
      }
    }

    created(res, event, 'Event created successfully');
  } catch (err) { next(err); }
});

// Update event
router.patch('/events/:id', async (req, res, next) => {
  try {
    const { title, description, startDate, endDate, allDay, color, type, projectId, attendeeIds } = req.body;

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description || null;
    if (startDate !== undefined) updateData.startDate = new Date(startDate);
    if (endDate !== undefined) updateData.endDate = new Date(endDate);
    if (allDay !== undefined) updateData.allDay = allDay;
    if (color !== undefined) updateData.color = color || null;
    if (type !== undefined) updateData.type = type;
    if (projectId !== undefined) updateData.projectId = projectId || null;

    const event = await prisma.$transaction(async (tx) => {
      const updated = await tx.event.update({
        where: { id: req.params.id },
        data: updateData
      });

      // Sync attendees if provided
      if (attendeeIds !== undefined) {
        await tx.eventAttendee.deleteMany({ where: { eventId: req.params.id } });
        if (attendeeIds.length) {
          await tx.eventAttendee.createMany({
            data: attendeeIds.map(userId => ({ eventId: req.params.id, userId }))
          });
        }
      }

      return tx.event.findUnique({
        where: { id: req.params.id },
        include: {
          creator: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
          attendees: {
            include: { user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } } }
          },
          project: { select: { id: true, name: true } }
        }
      });
    });

    success(res, event, 'Event updated successfully');
  } catch (err) { next(err); }
});

// Delete event
router.delete('/events/:id', async (req, res, next) => {
  try {
    await prisma.event.delete({ where: { id: req.params.id } });
    success(res, null, 'Event deleted successfully');
  } catch (err) { next(err); }
});

module.exports = router;
