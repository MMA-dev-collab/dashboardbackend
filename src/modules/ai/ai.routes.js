/**
 * AI Assistant Routes
 * 
 * Threads:
 *   GET    /ai/threads             – List all threads for user
 *   POST   /ai/threads             – Create a new thread
 *   DELETE /ai/threads/:id         – Delete a thread and its messages
 *   GET    /ai/threads/:id/messages – Get messages for a thread
 * 
 * Chat:
 *   POST   /ai/chat                – Send message (thread-scoped)
 * 
 * Legacy (floating widget):
 *   GET    /ai/history             – Get last N messages (no thread filter)
 *   DELETE /ai/history             – Clear all conversation
 * 
 * Documents:
 *   GET    /ai/documents/search?q= – Search documents for @document autocomplete
 */

const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const prisma = require('../../config/database');
const { success } = require('../../utils/response');
const llmService = require('../../services/llm/llm-service');
const { TOOL_DEFINITIONS } = require('../../services/ai/ai-tools');
const { executeToolCalls } = require('../../services/ai/tool-executor');
const { buildSystemPrompt } = require('../../services/ai/ai-prompt');

const router = Router();
router.use(authenticate);

const MAX_CONTEXT_MESSAGES = 20;
const MAX_TOOL_ITERATIONS = 5;

// ═══════════════════════════════════════════════
// THREAD MANAGEMENT
// ═══════════════════════════════════════════════

// ─── GET /ai/threads ─────────────────────────
router.get('/threads', async (req, res, next) => {
  try {
    const threads = await prisma.aiThread.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { conversations: true } },
      },
    });
    success(res, threads);
  } catch (err) { next(err); }
});

// ─── POST /ai/threads ────────────────────────
router.post('/threads', async (req, res, next) => {
  try {
    const thread = await prisma.aiThread.create({
      data: {
        userId: req.user.id,
        title: req.body.title || 'New Chat',
      },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
    success(res, thread);
  } catch (err) { next(err); }
});

// ─── DELETE /ai/threads/:id ──────────────────
router.delete('/threads/:id', async (req, res, next) => {
  try {
    const thread = await prisma.aiThread.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    // Cascade delete will handle conversations via schema
    await prisma.aiThread.delete({ where: { id: req.params.id } });
    success(res, null, 'Thread deleted.');
  } catch (err) { next(err); }
});

// ─── GET /ai/threads/:id/messages ────────────
router.get('/threads/:id/messages', async (req, res, next) => {
  try {
    // Verify thread belongs to user
    const thread = await prisma.aiThread.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!thread) return res.status(404).json({ success: false, message: 'Thread not found.' });

    const messages = await prisma.aiConversation.findMany({
      where: {
        threadId: req.params.id,
        role: { in: ['user', 'assistant'] },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, role: true, content: true, metadata: true, createdAt: true },
    });
    success(res, messages);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════
// CHAT (THREAD-SCOPED)
// ═══════════════════════════════════════════════

// ─── POST /ai/chat ───────────────────────────
router.post('/chat', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { message, documentId, threadId } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required.' });
    }

    // Resolve or create thread
    let activeThreadId = threadId;
    if (!activeThreadId) {
      // Auto-create a thread with a title from the first message
      const autoTitle = message.trim().substring(0, 40) + (message.trim().length > 40 ? '...' : '');
      const newThread = await prisma.aiThread.create({
        data: { userId, title: autoTitle },
      });
      activeThreadId = newThread.id;
    } else {
      // Verify thread ownership
      const thread = await prisma.aiThread.findFirst({
        where: { id: activeThreadId, userId },
      });
      if (!thread) {
        return res.status(404).json({ success: false, message: 'Thread not found.' });
      }
    }

    // Get user roles for RBAC
    const userRoles = await prisma.userRole.findMany({
      where: { userId },
      include: { role: { select: { name: true } } },
    });
    const roleNames = userRoles.map(ur => ur.role.name);

    // Build system prompt
    const systemPrompt = buildSystemPrompt(req.user, roleNames);

    // Load recent conversation history for THIS thread
    const recentMessages = await prisma.aiConversation.findMany({
      where: { userId, threadId: activeThreadId },
      orderBy: { createdAt: 'desc' },
      take: MAX_CONTEXT_MESSAGES,
    });
    recentMessages.reverse();

    // Build messages array
    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentMessages.map(m => ({ role: m.role, content: m.content })),
    ];

    // If a document is referenced, fetch its content inline
    let userContent = message;
    if (documentId) {
      const { executeTool } = require('../../services/ai/tool-executor');
      const docResult = await executeTool('getDocumentContent', { documentId }, userId);
      if (docResult.content) {
        userContent = `${message}\n\n[Attached Document: ${docResult.documentName}]\n${docResult.content}`;
      } else if (docResult.error) {
        userContent = `${message}\n\n[Document error: ${docResult.error}]`;
      }
    }

    messages.push({ role: 'user', content: userContent });

    // Save user message to conversation (thread-scoped)
    await prisma.aiConversation.create({
      data: { userId, threadId: activeThreadId, role: 'user', content: userContent },
    });

    // ─── Tool-calling loop ───
    let response;
    let iterations = 0;
    let allToolsUsed = [];

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      response = await llmService.chat(messages, TOOL_DEFINITIONS, userId);

      // If no tool calls, we have the final answer
      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      const toolResults = await executeToolCalls(response.toolCalls, userId);
      allToolsUsed.push(...toolResults.map(r => r.name));

      // Add assistant message with tool calls to messages
      messages.push({
        role: 'assistant',
        content: response.text || '',
        tool_calls: response.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });

      // Add tool results to messages
      for (const result of toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: result.toolCallId,
          content: JSON.stringify(result.result),
        });
      }

      // Get final response with tool results
      response = await llmService.complete(messages, response.model, userId);
      break; // After tool execution + completion, we're done
    }

    const assistantMessage = response.text || 'I was unable to generate a response.';

    // Save assistant response to conversation (thread-scoped)
    await prisma.aiConversation.create({
      data: {
        userId,
        threadId: activeThreadId,
        role: 'assistant',
        content: assistantMessage,
        metadata: JSON.stringify({
          provider: response.provider,
          model: response.model,
          toolsUsed: allToolsUsed,
          latencyMs: response.latencyMs,
        }),
      },
    });

    // Update thread title if it's the first message (auto-title)
    if (!threadId) {
      // This was a newly created thread, title is already set from message
      // Update the thread's updatedAt
      await prisma.aiThread.update({
        where: { id: activeThreadId },
        data: { updatedAt: new Date() },
      });
    } else {
      await prisma.aiThread.update({
        where: { id: activeThreadId },
        data: { updatedAt: new Date() },
      });
    }

    // Prune old messages per-thread (keep last MAX_CONTEXT_MESSAGES * 2)
    const total = await prisma.aiConversation.count({ where: { userId, threadId: activeThreadId } });
    if (total > MAX_CONTEXT_MESSAGES * 3) {
      const oldest = await prisma.aiConversation.findMany({
        where: { userId, threadId: activeThreadId },
        orderBy: { createdAt: 'asc' },
        take: total - MAX_CONTEXT_MESSAGES * 2,
        select: { id: true },
      });
      await prisma.aiConversation.deleteMany({
        where: { id: { in: oldest.map(m => m.id) } },
      });
    }

    success(res, {
      message: assistantMessage,
      threadId: activeThreadId,
      provider: response.provider,
      model: response.model,
      toolsUsed: allToolsUsed,
    });
  } catch (err) {
    console.error('[AI] Chat error:', err.message);
    next(err);
  }
});

// ═══════════════════════════════════════════════
// LEGACY ENDPOINTS (for floating widget)
// ═══════════════════════════════════════════════

// ─── GET /ai/history ────────────────────────
router.get('/history', async (req, res, next) => {
  try {
    const messages = await prisma.aiConversation.findMany({
      where: { userId: req.user.id, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true, role: true, content: true, metadata: true, createdAt: true },
    });
    success(res, messages);
  } catch (err) { next(err); }
});

// ─── DELETE /ai/history ─────────────────────
router.delete('/history', async (req, res, next) => {
  try {
    await prisma.aiConversation.deleteMany({ where: { userId: req.user.id } });
    success(res, null, 'Conversation cleared.');
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════
// DOCUMENT SEARCH
// ═══════════════════════════════════════════════

// ─── GET /ai/documents/search?q= ───────────
router.get('/documents/search', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const q = req.query.q || '';

    // Get user's project IDs for RBAC
    const userProjects = await prisma.projectPartner.findMany({
      where: { userId },
      select: { projectId: true },
    });
    const projectIds = userProjects.map(p => p.projectId);

    const where = { projectId: { in: projectIds } };
    if (q) where.fileName = { contains: q };

    const docs = await prisma.document.findMany({
      where,
      select: { id: true, fileName: true, mimeType: true, project: { select: { name: true } } },
      take: 15,
      orderBy: { createdAt: 'desc' },
    });

    success(res, docs.map(d => ({ id: d.id, name: d.fileName, type: d.mimeType, project: d.project })));
  } catch (err) { next(err); }
});

module.exports = router;
