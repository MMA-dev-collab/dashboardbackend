/**
 * OpenRouter Adapter
 * Handles HTTP calls to OpenRouter API (OpenAI-compatible format).
 * Translates internal tool schema ↔ OpenAI tool_calls format.
 */

const env = require('../../config/env');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

class OpenRouterAdapter {
  constructor(model) {
    this.model = model;
    this.provider = 'openrouter';
  }

  /**
   * Send a chat completion request with optional tool calling.
   * @param {Array} messages - [{role, content}]
   * @param {Array} tools - Internal tool definitions
   * @param {number} timeoutMs - Hard timeout in ms
   * @returns {{ text: string|null, toolCalls: Array|null, usage: object }}
   */
  async chat(messages, tools = [], timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body = {
        model: this.model,
        messages,
        temperature: 0.3,
        max_tokens: 2048,
      };

      // Add tools if defined
      if (tools.length > 0) {
        body.tools = tools.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          }
        }));
        body.tool_choice = 'auto';
      }

      const response = await fetch(OPENROUTER_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://egycodera.com',
          'X-Title': 'EgyCodera AI Assistant',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        const error = new Error(`OpenRouter ${response.status}: ${errBody}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      const choice = data.choices?.[0];

      if (!choice) {
        throw new Error('No response choice from OpenRouter');
      }

      const message = choice.message;

      // Parse tool calls if present
      let toolCalls = null;
      if (message.tool_calls?.length > 0) {
        toolCalls = message.tool_calls.map(tc => {
          let args = {};
          try {
            args = typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
          } catch {
            args = {};
          }
          return {
            id: tc.id,
            name: tc.function.name,
            arguments: args,
          };
        });
      }

      return {
        text: message.content || null,
        toolCalls,
        usage: data.usage || {},
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Send tool results back to the model for final response.
   * @param {Array} messages - Full conversation including tool results
   * @param {number} timeoutMs
   * @returns {{ text: string, toolCalls: null, usage: object }}
   */
  async complete(messages, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body = {
        model: this.model,
        messages,
        temperature: 0.3,
        max_tokens: 2048,
      };

      const response = await fetch(OPENROUTER_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://egycodera.com',
          'X-Title': 'EgyCodera AI Assistant',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        const error = new Error(`OpenRouter ${response.status}: ${errBody}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      const choice = data.choices?.[0];

      return {
        text: choice?.message?.content || 'I could not generate a response.',
        toolCalls: null,
        usage: data.usage || {},
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = OpenRouterAdapter;
