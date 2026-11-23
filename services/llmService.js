import { GoogleGenAI } from '@google/genai';
import logger from '../utils/logger.js';
import { ANTHROPIC_API_KEY, GEMINI_API_KEY } from '../config/config.js';
import { DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI_MODELS } from '../config/aiModels.js';
import { describeError, isRetryableGeminiError } from '../utils/llmErrors.js';

/**
 * Text generation for jobs that run outside a request (weekly card digest).
 *
 * Primary: Anthropic Claude, only when ANTHROPIC_API_KEY is set (optional, paid).
 * Fallback: Google Gemini on the free tier (config/aiModels.js) - this is what production uses.
 * routes/aiRoutes.js does the same for the admin editor; it is bound to an HTTP request, so the
 * chain is repeated here in a small form instead of being called through the route.
 */

// Opus 5.5 always thinks (the thinking param must stay unset); effort "low" keeps that cheap for
// a short selection task. Sonnet 5.5 is the cheaper second choice.
const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];
const CLAUDE_MAX_TOKENS = 16000;

// Defaults when the caller passes nothing; the card digest passes its own (config/cardDigest.js).
// Node's fetch gives up after 300 s without response headers (undici headersTimeout) and the SDK
// sets no limit of its own, so our limit has to stay below that to fire first with a known error.
// The SDK's own retries (httpOptions.retryOptions) stay off: the model chain is the retry.
export const DEFAULT_GEMINI_TIMEOUT_MS = 240_000;
// Gemini 3.x Flash: "LOW" is allowed on every documented model of the chain ("MINIMAL" is not on
// gemini-3.8-flash), the default there is "MEDIUM". Same reasoning as effort "low" for Claude above.
export const DEFAULT_GEMINI_THINKING_LEVEL = 'LOW';

const secondsSince = started => ((Date.now() - started) / 1000).toFixed(1);

async function loadAnthropic() {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  } catch {
    logger.warn('ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed - using Gemini');
    return null;
  }
}

function loadGemini() {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') return null;
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

/**
 * @param {Object} [deps] - Clients and model lists, overridable for tests.
 * @returns {{generateText: Function}}
 */
export function createLlmService(deps = {}) {
  let anthropic = deps.anthropic;
  let gemini = deps.gemini;
  const claudeModels = deps.claudeModels ?? CLAUDE_MODELS;
  const geminiModels = deps.geminiModels ?? [DEFAULT_GEMINI_MODEL, ...FALLBACK_GEMINI_MODELS];

  async function viaClaude(system, prompt) {
    let lastError;
    for (const model of claudeModels) {
      const started = Date.now();
      try {
        const message = await anthropic.messages.create({
          model,
          max_tokens: CLAUDE_MAX_TOKENS,
          system,
          messages: [{ role: 'user', content: prompt }],
          output_config: { effort: 'low' },
        });
        if (message.stop_reason === 'refusal') throw new Error('Claude declined the request');
        // Thinking blocks come first, the answer is the text block
        const text = (message.content || []).filter(block => block.type === 'text').map(block => block.text).join('');
        if (!text) throw new Error(`Claude returned no text (${message.stop_reason})`);
        logger.info(`Card digest: Claude model ${model} answered in ${secondsSince(started)} s`);
        return { text, model };
      } catch (error) {
        lastError = error;
        logger.warn(`Card digest: Claude model ${model} failed after ${secondsSince(started)} s: ${describeError(error)}`);
      }
    }
    throw lastError;
  }

  async function viaGemini(system, prompt, { timeoutMs, thinkingLevel }) {
    let lastError;
    for (let i = 0; i < geminiModels.length; i++) {
      const model = geminiModels[i];
      const started = Date.now();
      try {
        const response = await gemini.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            ...(thinkingLevel && { thinkingConfig: { thinkingLevel } }),
            ...(timeoutMs > 0 && { httpOptions: { timeout: timeoutMs } }),
          },
        });
        if (!response.text) {
          const reason = response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason || 'no text';
          throw new Error(`Gemini returned no text (${reason})`);
        }
        // Thinking tokens next to the duration tell a long thinking phase apart from a long queue
        const usage = response.usageMetadata || {};
        logger.info(`Card digest: Gemini model ${model} answered in ${secondsSince(started)} s `
          + `(prompt ${usage.promptTokenCount ?? '?'}, thinking ${usage.thoughtsTokenCount ?? 0}, `
          + `output ${usage.candidatesTokenCount ?? '?'} tokens)`);
        return { text: response.text, model };
      } catch (caught) {
        // Our own limit aborts with a bare DOMException "This operation was aborted"; say what happened
        const error = caught?.name === 'AbortError' && timeoutMs > 0
          ? Object.assign(new Error(`Gemini model ${model} timed out after ${timeoutMs / 1000} s`, { cause: caught }), { name: 'TimeoutError' })
          : caught;
        lastError = error;
        logger.warn(`Card digest: Gemini model ${model} failed after ${secondsSince(started)} s: ${describeError(error)}`);
        if (!isRetryableGeminiError(error) || i === geminiModels.length - 1) throw error;
      }
    }
    throw lastError;
  }

  /**
   * @param {Object} request
   * @param {string} request.system
   * @param {string} request.prompt
   * @param {number} [request.timeoutMs] - Limit per Gemini model; on a timeout the next model is tried.
   *   0 = no own limit (Node still gives up after 300 s without response headers).
   * @param {string|null} [request.thinkingLevel] - Gemini thinking level (MINIMAL/LOW/MEDIUM/HIGH),
   *   null = the model's default.
   * @returns {Promise<{text: string, model: string}>}
   * @throws {Error} When no provider is configured or all of them failed.
   */
  async function generateText({
    system, prompt, timeoutMs = DEFAULT_GEMINI_TIMEOUT_MS, thinkingLevel = DEFAULT_GEMINI_THINKING_LEVEL,
  }) {
    anthropic ??= await loadAnthropic();
    gemini ??= loadGemini();
    if (!anthropic && !gemini) throw new Error('No AI provider configured (ANTHROPIC_API_KEY or GEMINI_API_KEY)');

    if (anthropic) {
      try {
        return await viaClaude(system, prompt);
      } catch (error) {
        if (!gemini) throw error;
        logger.warn(`Card digest: Claude failed, falling back to Gemini: ${describeError(error)}`);
      }
    }
    return viaGemini(system, prompt, { timeoutMs, thinkingLevel });
  }

  return { generateText };
}

export default createLlmService();
