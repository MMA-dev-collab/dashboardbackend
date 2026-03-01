/**
 * LLM Service – Orchestrator with failover & circuit breaker
 *
 * Failover chain:
 *   1. meta-llama/llama-3.3-70b-instruct:free
 *   2. mistralai/mistral-small-3.1-24b-instruct:free
 *   3. qwen/qwen-2.5-72b-instruct:free
 *
 * Retry: 429 → no retry (skip). 5xx → 1 retry w/ 2s backoff. Timeout → skip.
 * Circuit breaker: 5 failures/60s → OPEN 120s → HALF_OPEN → test.
 */

const OpenRouterAdapter = require('./openrouter-adapter');
const prisma = require('../../config/database');

const MODELS = [
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'llama-3.3-70b', timeout: 15000 },
  { id: 'mistralai/mistral-small-3.1-24b-instruct:free', label: 'mistral-small-3.1-24b', timeout: 15000 },
  { id: 'openrouter/free', label: 'openrouter', timeout: 15000 },
];

// ─── Circuit Breaker State (in-memory) ───
const circuitState = {};
const CB_FAILURE_THRESHOLD = 5;
const CB_FAILURE_WINDOW_MS = 60_000;
const CB_OPEN_DURATION_MS = 120_000;

function getCircuit(modelId) {
  if (!circuitState[modelId]) {
    circuitState[modelId] = { failures: [], state: 'CLOSED', openedAt: null };
  }
  return circuitState[modelId];
}

function recordFailure(modelId) {
  const cb = getCircuit(modelId);
  const now = Date.now();
  cb.failures.push(now);
  // Keep only failures within the window
  cb.failures = cb.failures.filter(t => now - t < CB_FAILURE_WINDOW_MS);
  if (cb.failures.length >= CB_FAILURE_THRESHOLD) {
    cb.state = 'OPEN';
    cb.openedAt = now;
    console.log(`[CIRCUIT] ${modelId} → OPEN (${cb.failures.length} failures)`);
  }
}

function recordSuccess(modelId) {
  const cb = getCircuit(modelId);
  cb.failures = [];
  cb.state = 'CLOSED';
  cb.openedAt = null;
}

function isAvailable(modelId) {
  const cb = getCircuit(modelId);
  if (cb.state === 'CLOSED') return true;
  if (cb.state === 'OPEN') {
    if (Date.now() - cb.openedAt >= CB_OPEN_DURATION_MS) {
      cb.state = 'HALF_OPEN';
      console.log(`[CIRCUIT] ${modelId} → HALF_OPEN`);
      return true;
    }
    return false;
  }
  // HALF_OPEN — allow one request
  return true;
}

// ─── LLM Call with Retry ───

async function callWithRetry(adapter, messages, tools, timeoutMs) {
  try {
    return await adapter.chat(messages, tools, timeoutMs);
  } catch (err) {
    // 429 → no retry
    if (err.status === 429) throw err;
    // Timeout → no retry
    if (err.name === 'AbortError') throw err;
    // 5xx → 1 retry with 2s backoff
    if (err.status >= 500) {
      await new Promise(r => setTimeout(r, 2000));
      return adapter.chat(messages, tools, timeoutMs);
    }
    throw err;
  }
}

// ─── Main Chat Function ───

/**
 * Try each model in order, with circuit breaker and retry logic.
 * @param {Array} messages - Conversation messages
 * @param {Array} tools - Tool definitions
 * @param {string} userId - For logging
 * @returns {{ text, toolCalls, model, provider }}
 */
async function chat(messages, tools, userId) {
  const errors = [];

  for (const modelConfig of MODELS) {
    if (!isAvailable(modelConfig.id)) {
      console.log(`[LLM] Skipping ${modelConfig.label} (circuit OPEN)`);
      continue;
    }

    const adapter = new OpenRouterAdapter(modelConfig.id);
    const start = Date.now();

    try {
      const result = await callWithRetry(adapter, messages, tools, modelConfig.timeout);
      const latencyMs = Date.now() - start;

      recordSuccess(modelConfig.id);

      // Log success
      logRequest(userId, 'openrouter', modelConfig.label, null, latencyMs, true, null);

      return {
        ...result,
        model: modelConfig.label,
        provider: 'openrouter',
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      recordFailure(modelConfig.id);
      logRequest(userId, 'openrouter', modelConfig.label, null, latencyMs, false, err.message);
      errors.push(`${modelConfig.label}: ${err.message}`);
      console.error(`[LLM] ${modelConfig.label} failed (${latencyMs}ms):`, err.message);
    }
  }

  throw new Error(`All LLM providers failed:\n${errors.join('\n')}`);
}

/**
 * Send tool results back to a specific model for final response.
 */
async function complete(messages, modelLabel, userId) {
  const modelConfig = MODELS.find(m => m.label === modelLabel) || MODELS[0];
  const adapter = new OpenRouterAdapter(modelConfig.id);
  const start = Date.now();

  try {
    const result = await adapter.complete(messages, modelConfig.timeout);
    const latencyMs = Date.now() - start;
    logRequest(userId, 'openrouter', modelConfig.label, null, latencyMs, true, null);
    return { ...result, model: modelConfig.label, provider: 'openrouter', latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    logRequest(userId, 'openrouter', modelConfig.label, null, latencyMs, false, err.message);
    throw err;
  }
}

// ─── Async Request Logger ───

function logRequest(userId, provider, model, toolsUsed, latencyMs, success, error) {
  prisma.aiRequestLog.create({
    data: {
      userId,
      provider,
      model,
      toolsUsed: toolsUsed ? JSON.stringify(toolsUsed) : null,
      latencyMs,
      success,
      error: error || null,
    }
  }).catch(err => console.error('[LOG] Failed to log AI request:', err.message));
}

module.exports = { chat, complete, MODELS };
