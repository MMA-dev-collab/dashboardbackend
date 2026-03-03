const prisma = require('../config/database');

/**
 * Shared Notification Utility
 * 
 * Creates a notification in the DB and pushes it via SSE to the user in real-time.
 * This module is importable from any service or route.
 */

// SSE client registry (shared across the app via module caching)
const sseClients = new Set();

/**
 * Register an SSE client connection.
 * Called from notifications.routes.js when a user opens the SSE stream.
 */
function addClient(client) {
  sseClients.add(client);
}

/**
 * Remove an SSE client connection on disconnect.
 */
function removeClient(client) {
  sseClients.delete(client);
}

/**
 * Push a notification payload to a specific user via SSE (if connected).
 */
function pushToUser(userId, data) {
  sseClients.forEach(client => {
    if (client.id === userId) {
      client.res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  });
}

/**
 * Create a notification in the DB and push it via SSE.
 * 
 * @param {Object} opts
 * @param {string} opts.userId - Recipient user ID
 * @param {string} opts.title - Notification title
 * @param {string} opts.message - Notification body
 * @param {string} [opts.type='info'] - Type: 'info', 'success', 'warning', 'error', 'task', 'chat', 'withdrawal'
 * @param {string} [opts.link] - Deep-link URL within the app
 * @param {string} [opts.actorId] - The user who triggered this notification
 * @param {Object} [tx] - Optional Prisma transaction client (use inside $transaction)
 * @returns {Promise<Object>} The created notification
 */
async function sendNotification({ userId, title, message, type = 'info', link, actorId }, tx) {
  const db = tx || prisma;
  
  const notification = await db.notification.create({
    data: {
      userId,
      title,
      message,
      type,
      link: link || null,
      actorId: actorId || null,
    },
    include: {
      actor: { select: { id: true, firstName: true, lastName: true, profilePicture: true } }
    }
  });

  // Push via SSE for real-time delivery
  pushToUser(userId, notification);

  return notification;
}

/**
 * Send notifications to multiple users.
 * 
 * @param {Array<Object>} notifications - Array of notification objects (same shape as sendNotification opts)
 * @param {Object} [tx] - Optional Prisma transaction client
 */
async function sendNotificationToMany(notifications, tx) {
  const results = [];
  for (const notif of notifications) {
    const result = await sendNotification(notif, tx);
    results.push(result);
  }
  return results;
}

/**
 * Get all admin user IDs (users with the 'Admin' role).
 * Optionally exclude a specific user.
 * 
 * @param {string} [excludeUserId] - User ID to exclude from the result
 * @returns {Promise<string[]>} Array of admin user IDs
 */
async function getAdminUserIds(excludeUserId) {
  const adminRole = await prisma.role.findUnique({ where: { name: 'Admin' } });
  if (!adminRole) return [];

  const adminUsers = await prisma.userRole.findMany({
    where: {
      roleId: adminRole.id,
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
    select: { userId: true },
  });

  return adminUsers.map(u => u.userId);
}

module.exports = {
  addClient,
  removeClient,
  pushToUser,
  sendNotification,
  sendNotificationToMany,
  getAdminUserIds,
  sseClients,
};
