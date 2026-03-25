const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const { devtrackerService, addDevClient, removeDevClient } = require('./devtracker.service');
const { success } = require('../../utils/response');
const { ForbiddenError } = require('../../utils/errors');

const router = Router();
router.use(authenticate);

// ── SSE: Real-time session broadcasts ─────────────────────────────────
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  // Send a heartbeat comment every 20s to prevent proxy timeouts
  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 20000);

  addDevClient(res);
  req.on('close', () => {
    clearInterval(keepAlive);
    removeDevClient(res);
  });
});

// ── Snapshots ─────────────────────────────────────────────────────────
router.get('/active', async (req, res, next) => {
  try {
    const sessions = await devtrackerService.getActiveSessions();
    success(res, sessions);
  } catch (err) { next(err); }
});

router.get('/project/:projectId', async (req, res, next) => {
  try {
    const session = await devtrackerService.getSessionForProject(req.params.projectId);
    success(res, session);
  } catch (err) { next(err); }
});

router.get('/history', async (req, res, next) => {
  try {
    const result = await devtrackerService.getHistory({
      projectId: req.query.projectId,
      userId: req.query.userId,
      page: req.query.page,
      limit: req.query.limit,
    });
    success(res, result);
  } catch (err) { next(err); }
});

// ── Actions ───────────────────────────────────────────────────────────
router.post('/start', async (req, res, next) => {
  try {
    const session = await devtrackerService.startSession(req.user.id, req.body);
    success(res, session, 'Session started');
  } catch (err) { next(err); }
});

router.post('/heartbeat/:sessionId', async (req, res, next) => {
  try {
    await devtrackerService.heartbeat(req.params.sessionId, req.user.id);
    success(res, null, 'Heartbeat received');
  } catch (err) { next(err); }
});

router.post('/finish/:sessionId', async (req, res, next) => {
  try {
    const result = await devtrackerService.finishSession(
      req.params.sessionId,
      req.user.id,
      req.body
    );
    success(res, result, 'Session finished');
  } catch (err) { next(err); }
});

router.post('/force-end/:sessionId', async (req, res, next) => {
  try {
    const isAdmin = req.user.roles.includes('Admin');
    if (!isAdmin) throw new ForbiddenError('Admin access required');
    const result = await devtrackerService.forceEndSession(req.params.sessionId, req.user.id);
    success(res, result, 'Session force-ended');
  } catch (err) { next(err); }
});

module.exports = router;
