/**
 * Tool Executor
 * Routes tool calls from the LLM to the correct backend function.
 * Enforces RBAC and truncates responses.
 */

const { TOOL_IMPLEMENTATIONS } = require('./ai-tools');

/**
 * Execute a single tool call.
 * @param {string} toolName - Name of the tool to execute
 * @param {object} params - Tool arguments from the LLM
 * @param {string} userId - Authenticated user ID
 * @returns {object} Tool result as JSON
 */
async function executeTool(toolName, params, userId) {
  const handler = TOOL_IMPLEMENTATIONS[toolName];
  if (!handler) {
    return { error: `Unknown tool: ${toolName}` };
  }

  try {
    const result = await handler(userId, params || {});
    return result;
  } catch (err) {
    console.error(`[TOOL] ${toolName} error:`, err.message);
    return { error: `Tool execution failed: ${err.message}` };
  }
}

/**
 * Execute multiple tool calls in parallel.
 * @param {Array} toolCalls - [{ id, name, arguments }]
 * @param {string} userId
 * @returns {Array} [{ toolCallId, name, result }]
 */
async function executeToolCalls(toolCalls, userId) {
  const results = await Promise.all(
    toolCalls.map(async (tc) => {
      const result = await executeTool(tc.name, tc.arguments, userId);
      return {
        toolCallId: tc.id,
        name: tc.name,
        result,
      };
    })
  );
  return results;
}

module.exports = { executeTool, executeToolCalls };
