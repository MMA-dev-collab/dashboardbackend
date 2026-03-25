const prisma = require('../../config/database');
const { BadRequestError, ConflictError, ForbiddenError, NotFoundError } = require('../../utils/errors');
const { sendNotification } = require('../../utils/notify');

// In-memory SSE client registry for devtracker broadcasts
const devtrackerClients = new Set();

function addDevClient(res) { devtrackerClients.add(res); }
function removeDevClient(res) { devtrackerClients.delete(res); }

/**
 * Broadcast a devtracker event to ALL connected SSE clients (not per-user)
 */
function broadcastDevEvent(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  devtrackerClients.forEach(res => {
    try { res.write(data); } catch (_) {}
  });
}

/**
 * Get project members who had recent activity (last 7 days) in DevSessionLog.
 * Excludes a given userId (the person who triggered the action).
 */
async function getRecentlyActiveMembers(projectId, excludeUserId) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const logs = await prisma.devSessionLog.findMany({
    where: { projectId, startedAt: { gte: sevenDaysAgo } },
    select: { userId: true },
    distinct: ['userId'],
  });
  return logs.map(l => l.userId).filter(id => id !== excludeUserId);
}

class DevtrackerService {

  /**
   * Start a dev session for a user on a project.
   * Includes membership check, duplicate session check, and race-condition-safe transaction.
   */
  async startSession(userId, { projectId, taskId, currentTask, workingOnBranch }) {
    // 1. Membership check — user must be a project partner
    const isMember = await prisma.projectPartner.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this project.');
    }

    // 2. Prevent user from opening a second active session
    const myExistingSession = await prisma.devSession.findFirst({
      where: { userId, isActive: true },
      include: { project: { select: { name: true } } },
    });
    if (myExistingSession) {
      throw new ConflictError(
        `You already have an active session on "${myExistingSession.project.name}". Please finish it first.`
      );
    }

    // 3. Atomic check + create to prevent race condition
    const session = await prisma.$transaction(async (tx) => {
      const existing = await tx.devSession.findFirst({
        where: { projectId, isActive: true },
        include: {
          user: { select: { firstName: true, lastName: true } },
        },
      });

      if (existing) {
        const elapsedMin = Math.floor((Date.now() - existing.activeStartedAt.getTime()) / 60000);
        throw new ConflictError(
          `${existing.user.firstName} ${existing.user.lastName} is already working on this project (${elapsedMin} min ago).`
        );
      }

      return tx.devSession.create({
        data: {
          projectId,
          userId,
          taskId: taskId || null,
          currentTask: currentTask || null,
          workingOnBranch: workingOnBranch || null,
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
          project: { select: { id: true, name: true } },
          task: { select: { id: true, title: true } },
        },
      });
    });

    broadcastDevEvent({ type: 'SESSION_STARTED', session });
    return session;
  }

  /**
   * Update lastHeartbeatAt to keep session alive.
   */
  async heartbeat(sessionId, userId) {
    const session = await prisma.devSession.findUnique({ where: { id: sessionId } });
    if (!session || !session.isActive) throw new NotFoundError('Active session not found');
    if (session.userId !== userId) throw new ForbiddenError('Not your session');

    return prisma.devSession.update({
      where: { id: sessionId },
      data: { lastHeartbeatAt: new Date() },
    });
  }

  /**
   * Finish a session (developer-initiated).
   */
  async finishSession(sessionId, userId, { pushedCode, changesDescription, requiresPull }) {
    const session = await prisma.devSession.findUnique({
      where: { id: sessionId },
      include: {
        project: { select: { id: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!session || !session.isActive) throw new NotFoundError('Active session not found');
    if (session.userId !== userId) throw new ForbiddenError('Not your session');

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // Close session
      await tx.devSession.update({
        where: { id: sessionId },
        data: { isActive: false, endedAt: now },
      });

      // Write immutable history log
      await tx.devSessionLog.create({
        data: {
          projectId: session.projectId,
          userId: session.userId,
          taskId: session.taskId,
          branch: session.workingOnBranch,
          startedAt: session.activeStartedAt,
          endedAt: now,
          pushedCode: !!pushedCode,
          changesDescription: changesDescription || null,
          requiresPull: !!requiresPull,
        },
      });

      // Task status update: move to "In Review" if pushed code
      if (pushedCode && session.taskId) {
        const inReviewCol = await tx.boardColumn.findFirst({
          where: {
            projectId: session.projectId,
            name: { contains: 'Review', mode: 'insensitive' },
          },
        });
        if (inReviewCol) {
          await tx.task.update({
            where: { id: session.taskId },
            data: { columnId: inReviewCol.id, version: { increment: 1 } },
          });
        }
      }
    });

    // Send smart-scoped notifications (only recent project members)
    const recipientIds = await getRecentlyActiveMembers(session.projectId, userId);
    const devName = `${session.user.firstName} ${session.user.lastName}`;

    for (const recipId of recipientIds) {
      if (pushedCode) {
        await sendNotification({
          userId: recipId,
          title: 'Code Pushed',
          message: `${devName} pushed new changes to "${session.project.name}"`,
          type: 'info',
          link: `/projects/${session.projectId}`,
          actorId: userId,
        });
      }
      if (requiresPull) {
        await sendNotification({
          userId: recipId,
          title: '⚠ Pull Required',
          message: `Update required before continuing work on "${session.project.name}"`,
          type: 'warning',
          link: `/projects/${session.projectId}`,
          actorId: userId,
        });
      }
    }

    broadcastDevEvent({ type: 'SESSION_ENDED', sessionId, projectId: session.projectId });
    return { success: true };
  }

  /**
   * Admin or system: force-terminate a session.
   * Pass adminUserId=null for auto-timeout (system).
   */
  async forceEndSession(sessionId, adminUserId) {
    const session = await prisma.devSession.findUnique({
      where: { id: sessionId },
      include: {
        project: { select: { id: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!session || !session.isActive) throw new NotFoundError('Active session not found');

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.devSession.update({
        where: { id: sessionId },
        data: { isActive: false, endedAt: now },
      });

      await tx.devSessionLog.create({
        data: {
          projectId: session.projectId,
          userId: session.userId,
          taskId: session.taskId,
          branch: session.workingOnBranch,
          startedAt: session.activeStartedAt,
          endedAt: now,
          pushedCode: false,
          requiresPull: false,
          forceEndedBy: adminUserId || null,
          forceEndedAt: now,
        },
      });
    });

    const isAutoTimeout = !adminUserId;
    const reason = isAutoTimeout
      ? `Your session on "${session.project.name}" was auto-ended due to 30 minutes of inactivity.`
      : `Your session on "${session.project.name}" was force-ended by an admin.`;

    await sendNotification({
      userId: session.userId,
      title: isAutoTimeout ? 'Session Auto-Ended' : 'Session Force-Ended',
      message: reason,
      type: 'warning',
      link: `/active-work`,
      actorId: adminUserId || null,
    });

    broadcastDevEvent({ type: 'SESSION_ENDED', sessionId, projectId: session.projectId });
    return { success: true };
  }

  /**
   * All currently active sessions (with user + project + task details).
   */
  async getActiveSessions() {
    return prisma.devSession.findMany({
      where: { isActive: true },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
      },
      orderBy: { activeStartedAt: 'asc' },
    });
  }

  /**
   * Active session for a specific project (or null).
   */
  async getSessionForProject(projectId) {
    return prisma.devSession.findFirst({
      where: { projectId, isActive: true },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
        task: { select: { id: true, title: true } },
      },
    });
  }

  /**
   * Paginated session history.
   */
  async getHistory({ projectId, userId, page = 1, limit = 20 }) {
    const skip = (page - 1) * limit;
    const where = {};
    if (projectId) where.projectId = projectId;
    if (userId) where.userId = userId;

    const [logs, total] = await Promise.all([
      prisma.devSessionLog.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          user: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
          project: { select: { id: true, name: true } },
          forceEnder: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { startedAt: 'desc' },
      }),
      prisma.devSessionLog.count({ where }),
    ]);

    return { logs, total, page: Number(page), limit: Number(limit) };
  }

  // Expose helpers for cron job
  static get broadcastDevEvent() { return broadcastDevEvent; }
  static get addDevClient() { return addDevClient; }
  static get removeDevClient() { return removeDevClient; }
}

module.exports = {
  devtrackerService: new DevtrackerService(),
  addDevClient,
  removeDevClient,
  broadcastDevEvent,
};
