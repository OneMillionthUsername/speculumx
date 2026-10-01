import { GoogleGenAI } from '@google/genai';
import logger from '../utils/logger.js';
import { ANTHROPIC_API_KEY, GEMINI_API_KEY } from '../config/config.js';
import { DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI_MODELS } from '../config/aiModels.js';

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

function isRetryableGemini(error) {
  const message = String(error?.message || '').toLowerCase();
  return [429, 500, 503].includes(error?.status)
    || ['model', '404', 'not found', 'unavailable', 'deprecated', 'overloaded'].some(word => message.includes(word));
}

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
        return { text, model };
      } catch (error) {
        lastError = error;
        logger.warn(`Card digest: Claude model ${model} failed: ${error.message}`);
      }
    }
    throw lastError;
  }

  async function viaGemini(system, prompt) {
    let lastError;
    for (let i = 0; i < geminiModels.length; i++) {
      const model = geminiModels[i];
      try {
        const response = await gemini.models.generateContent({
          model,
          contents: prompt,
          config: { systemInstruction: system, responseMimeType: 'application/json' },
        });
        if (!response.text) {
          const reason = response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason || 'no text';
          throw new Error(`Gemini returned no text (${reason})`);
        }
        return { text: response.text, model };
      } catch (error) {
        lastError = error;
        logger.warn(`Card digest: Gemini model ${model} failed: ${error.message}`);
        if (!isRetryableGemini(error) || i === geminiModels.length - 1) throw error;
      }
    }
    throw lastError;
  }

  /**
   * @param {{system: string, prompt: string}} request
   * @returns {Promise<{text: string, model: string}>}
   * @throws {Error} When no provider is configured or all of them failed.
   */
  async function generateText({ system, prompt }) {
    anthropic ??= await loadAnthropic();
    gemini ??= loadGemini();
    if (!anthropic && !gemini) throw new Error('No AI provider configured (ANTHROPIC_API_KEY or GEMINI_API_KEY)');

    if (anthropic) {
      try {
        return await viaClaude(system, prompt);
      } catch (error) {
        if (!gemini) throw error;
        logger.warn(`Card digest: Claude failed, falling back to Gemini: ${error.message}`);
      }
    }
    return viaGemini(system, prompt);
  }

  return { generateText };
}

export default createLlmService();
