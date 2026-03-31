const prisma = require('../config/database');
const logger = require('../config/logger');

/**
 * Shared Notification Utility
 *
 * Improvements over original:
 *  - sseClients now a Map<userId, Set<client>> — supports multiple browser tabs per user
 *  - Per-client heartbeat (25 s interval) — keeps connections alive through nginx / load balancers
 *  - Heartbeat is stopped automatically on disconnect — no memory leak
 *  - pushToUser writes to ALL active connections for a user
 *  - closeAllClients() exported for graceful server shutdown
 */

// ── SSE Client Registry ── Map<userId, Set<clientObj>> ──────────
const sseClients = new Map();

// ── Heartbeat interval (ms) ──────────────────────────────────────
const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * Register an SSE client connection.
 * Starts a per-client heartbeat timer.
 *
 * @param {{ id: string, res: import('express').Response }} client
 */
function addClient(client) {
  if (!sseClients.has(client.id)) {
    sseClients.set(client.id, new Set());
  }
  sseClients.get(client.id).add(client);

  // Heartbeat: sends SSE comment every 25 s to prevent idle disconnection
  client._heartbeat = setInterval(() => {
    try {
      client.res.write(': heartbeat\n\n');
    } catch {
      // Connection already closed — clean up
      removeClient(client);
    }
  }, HEARTBEAT_INTERVAL_MS);

  logger.debug(`[SSE] Client connected: userId=${client.id} (total connections=${countTotal()})`);
}

/**
 * Unregister an SSE client on disconnect.
 * Clears the heartbeat timer.
 *
 * @param {{ id: string, _heartbeat?: NodeJS.Timeout }} client
 */
function removeClient(client) {
  if (client._heartbeat) {
    clearInterval(client._heartbeat);
    client._heartbeat = null;
  }

  const userSet = sseClients.get(client.id);
  if (userSet) {
    userSet.delete(client);
    if (userSet.size === 0) {
      sseClients.delete(client.id);
    }
  }

  logger.debug(`[SSE] Client disconnected: userId=${client.id} (total connections=${countTotal()})`);
}

/**
 * Push a notification payload to ALL active connections for a user.
 *
 * @param {string} userId
 * @param {object} data
 */
function pushToUser(userId, data) {
  const userSet = sseClients.get(userId);
  if (!userSet || userSet.size === 0) return;

  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of userSet) {
    try {
      client.res.write(payload);
    } catch (err) {
      logger.warn(`[SSE] Failed to push to userId=${userId}`, { error: err.message });
      removeClient(client);
    }
  }
}

/**
 * Close all active SSE connections (called on graceful server shutdown).
 */
function closeAllClients() {
  let count = 0;
  for (const [, userSet] of sseClients) {
    for (const client of userSet) {
      clearInterval(client._heartbeat);
      try { client.res.end(); } catch { /* ignore */ }
      count++;
    }
  }
  sseClients.clear();
  logger.info(`[SSE] Closed ${count} active SSE connection(s) during shutdown`);
}

/**
 * Return total number of open SSE connections across all users.
 */
function countTotal() {
  let total = 0;
  for (const s of sseClients.values()) total += s.size;
  return total;
}

// ─────────────────────────────────────────────────────────────────

/**
 * Create a notification in the DB and push it via SSE.
 *
 * @param {Object} opts
 * @param {string} opts.userId    - Recipient user ID
 * @param {string} opts.title     - Notification title
 * @param {string} opts.message   - Notification body
 * @param {string} [opts.type]    - 'info' | 'success' | 'warning' | 'error' | 'task' | 'chat' | 'withdrawal'
 * @param {string} [opts.link]    - Deep-link URL within the app
 * @param {string} [opts.actorId] - The user who triggered this notification
 * @param {Object} [tx]           - Optional Prisma transaction client
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
      actor: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
    },
  });

  pushToUser(userId, notification);

  return notification;
}

/**
 * Send notifications to multiple users.
 *
 * @param {Array<Object>} notifications - Array of notification option objects
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
 * @param {string} [excludeUserId]
 * @returns {Promise<string[]>}
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

  return adminUsers.map((u) => u.userId);
}

module.exports = {
  addClient,
  removeClient,
  pushToUser,
  closeAllClients,
  countTotal,
  sendNotification,
  sendNotificationToMany,
  getAdminUserIds,
  // Expose for backward-compat (e.g. unit tests that peek at the Set)
  sseClients,
};
