/**
 * AI Service
 *
 * Contains all business logic for the AI assistant module.
 * Routes stay thin — they only handle HTTP plumbing.
 */
const prisma = require('../../config/database');
const llmService = require('../../services/llm/llm-service');
const { TOOL_DEFINITIONS } = require('../../services/ai/ai-tools');
const { executeToolCalls, executeTool } = require('../../services/ai/tool-executor');
const { buildSystemPrompt } = require('../../services/ai/ai-prompt');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const logger = require('../../config/logger');

const MAX_CONTEXT_MESSAGES = 20;
const MAX_TOOL_ITERATIONS = 5;

// ═══════════════════════════════════════════════
// THREAD MANAGEMENT
// ═══════════════════════════════════════════════

/**
 * List all threads for a user, ordered by most recently updated.
 */
async function getThreads(userId) {
  return prisma.aiThread.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { conversations: true } },
    },
  });
}

/**
 * Create a new conversation thread.
 */
async function createThread(userId, title = 'New Chat') {
  return prisma.aiThread.create({
    data: { userId, title },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
}

/**
 * Delete a thread (and its messages via cascade).
 * Throws NotFoundError if thread doesn't belong to user.
 */
async function deleteThread(userId, threadId) {
  const thread = await prisma.aiThread.findFirst({
    where: { id: threadId, userId },
  });
  if (!thread) throw new NotFoundError('Thread not found');

  await prisma.aiThread.delete({ where: { id: threadId } });
}

/**
 * Get all user-visible messages in a thread.
 * Throws NotFoundError if thread doesn't belong to user.
 */
async function getThreadMessages(userId, threadId) {
  const thread = await prisma.aiThread.findFirst({
    where: { id: threadId, userId },
  });
  if (!thread) throw new NotFoundError('Thread not found');

  return prisma.aiConversation.findMany({
    where: {
      threadId,
      role: { in: ['user', 'assistant'] },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, role: true, content: true, metadata: true, createdAt: true },
  });
}

// ═══════════════════════════════════════════════
// CHAT (THREAD-SCOPED)
// ═══════════════════════════════════════════════

/**
 * Handle a chat message from a user.
 * - Resolves or auto-creates a thread
 * - Builds context + system prompt
 * - Runs tool-calling loop with the LLM
 * - Persists messages and prunes old ones
 *
 * @param {string} userId
 * @param {{ message: string, documentId?: string, threadId?: string }} body
 */
async function chat(userId, { message, documentId, threadId }) {
  if (!message?.trim()) throw new BadRequestError('Message is required');

  // ── 1. Resolve or auto-create thread ────────────────────────
  let activeThreadId = threadId;
  if (!activeThreadId) {
    const autoTitle = message.trim().substring(0, 40) + (message.trim().length > 40 ? '...' : '');
    const newThread = await prisma.aiThread.create({
      data: { userId, title: autoTitle },
    });
    activeThreadId = newThread.id;
  } else {
    const thread = await prisma.aiThread.findFirst({
      where: { id: activeThreadId, userId },
    });
    if (!thread) throw new NotFoundError('Thread not found');
  }

  // ── 2. Get user roles for system prompt ─────────────────────
  const userRoles = await prisma.userRole.findMany({
    where: { userId },
    include: { role: { select: { name: true } } },
  });
  const roleNames = userRoles.map((ur) => ur.role.name);

  // ── 3. Build system prompt ───────────────────────────────────
  const userRecord = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const systemPrompt = buildSystemPrompt(userRecord, roleNames);

  // ── 4. Load recent conversation history ──────────────────────
  const recentMessages = await prisma.aiConversation.findMany({
    where: { userId, threadId: activeThreadId },
    orderBy: { createdAt: 'desc' },
    take: MAX_CONTEXT_MESSAGES,
  });
  recentMessages.reverse();

  // ── 5. Build messages array ───────────────────────────────────
  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentMessages.map((m) => ({ role: m.role, content: m.content })),
  ];

  // ── 6. Optionally inline a referenced document ────────────────
  let userContent = message;
  if (documentId) {
    const docResult = await executeTool('getDocumentContent', { documentId }, userId);
    if (docResult.content) {
      userContent = `${message}\n\n[Attached Document: ${docResult.documentName}]\n${docResult.content}`;
    } else if (docResult.error) {
      userContent = `${message}\n\n[Document error: ${docResult.error}]`;
    }
  }

  messages.push({ role: 'user', content: userContent });

  // ── 7. Save user message ─────────────────────────────────────
  await prisma.aiConversation.create({
    data: { userId, threadId: activeThreadId, role: 'user', content: userContent },
  });

  // ── 8. Tool-calling loop ─────────────────────────────────────
  let response;
  let iterations = 0;
  const allToolsUsed = [];

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    response = await llmService.chat(messages, TOOL_DEFINITIONS, userId);

    if (!response.toolCalls || response.toolCalls.length === 0) break;

    const toolResults = await executeToolCalls(response.toolCalls, userId);
    allToolsUsed.push(...toolResults.map((r) => r.name));

    messages.push({
      role: 'assistant',
      content: response.text || '',
      tool_calls: response.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    });

    for (const result of toolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: JSON.stringify(result.result),
      });
    }

    response = await llmService.complete(messages, response.model, userId);
    break;
  }

  const assistantMessage = response.text || 'I was unable to generate a response.';

  // ── 9. Save assistant response ───────────────────────────────
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

  // ── 10. Touch thread updatedAt ────────────────────────────────
  await prisma.aiThread.update({
    where: { id: activeThreadId },
    data: { updatedAt: new Date() },
  });

  // ── 11. Prune old messages (keep last MAX_CONTEXT_MESSAGES × 2) ─
  const total = await prisma.aiConversation.count({
    where: { userId, threadId: activeThreadId },
  });
  if (total > MAX_CONTEXT_MESSAGES * 3) {
    const oldest = await prisma.aiConversation.findMany({
      where: { userId, threadId: activeThreadId },
      orderBy: { createdAt: 'asc' },
      take: total - MAX_CONTEXT_MESSAGES * 2,
      select: { id: true },
    });
    await prisma.aiConversation.deleteMany({
      where: { id: { in: oldest.map((m) => m.id) } },
    });
    logger.debug(`[AI] Pruned ${oldest.length} old messages for thread ${activeThreadId}`);
  }

  return {
    message: assistantMessage,
    threadId: activeThreadId,
    provider: response.provider,
    model: response.model,
    toolsUsed: allToolsUsed,
  };
}

// ═══════════════════════════════════════════════
// LEGACY (floating widget)
// ═══════════════════════════════════════════════

/**
 * Get flat conversation history (no thread filter) — legacy widget.
 */
async function getHistory(userId) {
  return prisma.aiConversation.findMany({
    where: { userId, role: { in: ['user', 'assistant'] } },
    orderBy: { createdAt: 'asc' },
    take: 100,
    select: { id: true, role: true, content: true, metadata: true, createdAt: true },
  });
}

/**
 * Clear all conversation history for a user.
 */
async function clearHistory(userId) {
  await prisma.aiConversation.deleteMany({ where: { userId } });
}

// ═══════════════════════════════════════════════
// DOCUMENT SEARCH
// ═══════════════════════════════════════════════

/**
 * Search documents accessible to the user (for @document autocomplete).
 */
async function searchDocuments(userId, q = '') {
  const userProjects = await prisma.projectPartner.findMany({
    where: { userId },
    select: { projectId: true },
  });
  const projectIds = userProjects.map((p) => p.projectId);

  const where = { projectId: { in: projectIds } };
  if (q) where.fileName = { contains: q };

  const docs = await prisma.document.findMany({
    where,
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      project: { select: { name: true } },
    },
    take: 15,
    orderBy: { createdAt: 'desc' },
  });

  return docs.map((d) => ({
    id: d.id,
    name: d.fileName,
    type: d.mimeType,
    project: d.project,
  }));
}

module.exports = {
  getThreads,
  createThread,
  deleteThread,
  getThreadMessages,
  chat,
  getHistory,
  clearHistory,
  searchDocuments,
};
