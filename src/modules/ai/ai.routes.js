/**
 * AI Assistant Routes
 *
 * Routes are deliberately thin: validate → delegate to ai.service → respond.
 *
 * Threads:
 *   GET    /ai/threads               – List all threads for user
 *   POST   /ai/threads               – Create a new thread
 *   DELETE /ai/threads/:id           – Delete a thread and its messages
 *   GET    /ai/threads/:id/messages  – Get messages for a thread
 *
 * Chat:
 *   POST   /ai/chat                  – Send message (thread-scoped)
 *
 * Legacy (floating widget):
 *   GET    /ai/history               – Get last N messages (no thread filter)
 *   DELETE /ai/history               – Clear all conversation
 *
 * Documents:
 *   GET    /ai/documents/search?q=  – Search documents for @document autocomplete
 */

const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const { success } = require('../../utils/response');
const aiService = require('./ai.service');
const logger = require('../../config/logger');

const router = Router();
router.use(authenticate);

// ═══════════════════════════════════════════════
// THREAD MANAGEMENT
// ═══════════════════════════════════════════════

// GET /ai/threads
router.get('/threads', async (req, res, next) => {
  try {
    const threads = await aiService.getThreads(req.user.id);
    success(res, threads);
  } catch (err) { next(err); }
});

// POST /ai/threads
router.post('/threads', async (req, res, next) => {
  try {
    const thread = await aiService.createThread(req.user.id, req.body.title);
    success(res, thread);
  } catch (err) { next(err); }
});

// DELETE /ai/threads/:id
router.delete('/threads/:id', async (req, res, next) => {
  try {
    await aiService.deleteThread(req.user.id, req.params.id);
    success(res, null, 'Thread deleted.');
  } catch (err) { next(err); }
});

// GET /ai/threads/:id/messages
router.get('/threads/:id/messages', async (req, res, next) => {
  try {
    const messages = await aiService.getThreadMessages(req.user.id, req.params.id);
    success(res, messages);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════
// CHAT (THREAD-SCOPED)
// ═══════════════════════════════════════════════

// POST /ai/chat
router.post('/chat', async (req, res, next) => {
  try {
    const result = await aiService.chat(req.user.id, req.body);
    success(res, result);
  } catch (err) {
    logger.error('[AI] Chat error', { error: err.message, userId: req.user?.id });
    next(err);
  }
});

// ═══════════════════════════════════════════════
// LEGACY ENDPOINTS (for floating widget)
// ═══════════════════════════════════════════════

// GET /ai/history
router.get('/history', async (req, res, next) => {
  try {
    const messages = await aiService.getHistory(req.user.id);
    success(res, messages);
  } catch (err) { next(err); }
});

// DELETE /ai/history
router.delete('/history', async (req, res, next) => {
  try {
    await aiService.clearHistory(req.user.id);
    success(res, null, 'Conversation cleared.');
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════
// DOCUMENT SEARCH
// ═══════════════════════════════════════════════

// GET /ai/documents/search?q=
router.get('/documents/search', async (req, res, next) => {
  try {
    const docs = await aiService.searchDocuments(req.user.id, req.query.q);
    success(res, docs);
  } catch (err) { next(err); }
});

module.exports = router;
