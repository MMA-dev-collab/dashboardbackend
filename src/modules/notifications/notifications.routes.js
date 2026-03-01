const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const prisma = require('../../config/database');
const { success, paginated } = require('../../utils/response');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');

const router = Router();
router.use(authenticate);

// Store active SSE connections
const sseClients = new Set();

// Setup SSE connection for instant push notifications
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  const client = { id: req.user.id, res };
  sseClients.add(client);

  req.on('close', () => {
    sseClients.delete(client);
  });
});

// Function to immediately push a new notification to a specific user via SSE
const notifyUser = (userId, notificationData) => {
    sseClients.forEach(client => {
        if (client.id === userId) {
            client.res.write(`data: ${JSON.stringify(notificationData)}\n\n`);
        }
    });
}
// Attach helper to the global router so we can trigger it from other files easily
// Usually you'd use a service / event emitter, but this works for simple SSE.
router.notifyUser = notifyUser;

// List unread notifications
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = { userId: req.user.id };
    
    // Default to hide read unless requested
    if (req.query.includeRead !== 'true') {
        where.isRead = false;
    }

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take: limit,
        include: {
          actor: { select: { id: true, firstName: true, lastName: true, profilePicture: true } }
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where }),
    ]);

    paginated(res, notifications, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// Count unread
router.get('/count', async (req, res, next) => {
    try {
        const count = await prisma.notification.count({
            where: { userId: req.user.id, isRead: false }
        });
        success(res, { count });
    } catch (err) { next(err); }
});

// Mark one as read
router.patch('/:id/read', async (req, res, next) => {
  try {
    const notification = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user.id },
      data: { isRead: true }
    });
    
    if (notification.count === 0) return res.status(404).json({ success: false, message: 'Notification not found' });
    
    success(res, null, 'Notification marked as read');
  } catch (err) { next(err); }
});

// Mark all as read
router.patch('/read-all', async (req, res, next) => {
    try {
      await prisma.notification.updateMany({
        where: { userId: req.user.id, isRead: false },
        data: { isRead: true }
      });
      success(res, null, 'All notifications marked as read');
    } catch (err) { next(err); }
});

module.exports = router;
