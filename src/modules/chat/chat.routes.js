const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const prisma = require('../../config/database');
const { success, created, paginated } = require('../../utils/response');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');

const router = Router();
router.use(authenticate);

// Store active Server-Sent Events (SSE) connections
const sseClients = new Set();

// Setup SSE connection
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

// List messages for a project (or global channel with projectId=null)
router.get('/messages', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = {};
    
    // Support filtering for Direct Messages OR Project Messages OR Global Channels
    if (req.query.receiverId) {
        // Find DMs between current user and the specified receiver
        where.OR = [
            { userId: req.user.id, receiverId: req.query.receiverId },
            { userId: req.query.receiverId, receiverId: req.user.id }
        ];
    } else if (req.query.projectId) {
        where.projectId = req.query.projectId;
        where.receiverId = null; // Ensure we aren't pulling DMs
    } else {
        where.projectId = null; // global company channel
        where.receiverId = null;
    }

    const [messages, total] = await Promise.all([
      prisma.chatMessage.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
          mentions: {
             include: { user: { select: { id: true, firstName: true, profilePicture: true } } }
          }
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.chatMessage.count({ where }),
    ]);

    paginated(res, messages, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// Send a message (REST fallback; real-time handled by socket.io)
router.post('/messages', async (req, res, next) => {
  try {
    const { content, projectId, type, receiverId, mentions } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Message content required' });
    }

    // A message shouldn't be BOTH a channel message and a DM
    if (projectId && receiverId) {
       return res.status(400).json({ success: false, message: 'Cannot set both projectId and receiverId' });
    }

    const message = await prisma.$transaction(async (tx) => {
      const msg = await tx.chatMessage.create({
        data: {
          content: content.trim(),
          projectId: projectId || null,
          receiverId: receiverId || null,
          userId: req.user.id,
          type: type || 'text',
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
          receiver: { select: { id: true, firstName: true, profilePicture: true } }
        },
      });

      // Handle Mentions and Create Notifications
      if (mentions && Array.isArray(mentions) && mentions.length > 0) {
        await tx.chatMention.createMany({
          data: mentions.map(userId => ({
            messageId: msg.id,
            userId
          }))
        });

        // Notifications for mentions
        await tx.notification.createMany({
          data: mentions.map(userId => ({
            userId,
            title: 'New Mention',
            message: `${req.user.firstName} mentioned you in a chat.`,
            type: 'chat',
            link: projectId ? `/chat?type=project&id=${projectId}` : `/chat?type=dm&id=${req.user.id}`,
            actorId: req.user.id
          }))
        });
      }

      // Notification for DM Receiver
      if (receiverId) {
        await tx.notification.create({
          data: {
             userId: receiverId,
             title: 'New Direct Message',
             message: `${req.user.firstName} sent you a message.`,
             type: 'chat',
             link: `/chat?type=dm&id=${req.user.id}`,
             actorId: req.user.id
          }
        });
      }

      // Fetch the full message with mentions included for SSE broadcast
      return tx.chatMessage.findUnique({
         where: { id: msg.id },
         include: {
           user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
           receiver: { select: { id: true, firstName: true, profilePicture: true } },
           mentions: { 
             include: { user: { select: { id: true, firstName: true, profilePicture: true } } }
           }
         }
      });
    });

    // Broadcast to SSE clients - Note: in a real app, SSE broadcast logic should be filtered 
    // so DMs only go to sender and receiver, and project messages only go to project members.
    sseClients.forEach(client => {
      // Basic check for DMs so we don't leak Private messages to the whole company stream
      let shouldSend = false;
      
      if (message.receiverId) {
         // Direct Message: only sender and receiver should get it
         if (client.id === message.userId || client.id === message.receiverId) shouldSend = true;
      } else {
         // Project or Global message. 
         // Assuming client joined this stream legally, so broadcast. (More robust auth needed here)
         shouldSend = true;
      }

      if (shouldSend) {
          client.res.write(`data: ${JSON.stringify(message)}\n\n`);
      }
    });

    created(res, message, 'Message sent');
  } catch (err) { next(err); }
});

// Delete a message
router.delete('/messages/:id', async (req, res, next) => {
  try {
    const msg = await prisma.chatMessage.findUnique({ where: { id: req.params.id } });
    if (!msg) return res.status(404).json({ success: false, message: 'Message not found' });
    if (msg.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Cannot delete another user\'s message' });
    }
    await prisma.chatMessage.delete({ where: { id: req.params.id } });
    success(res, null, 'Message deleted');
  } catch (err) { next(err); }
});

module.exports = router;
