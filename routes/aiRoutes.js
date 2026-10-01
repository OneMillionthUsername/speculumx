import express from 'express';
import logger from '../utils/logger.js';
import { GoogleGenAI } from '@google/genai';
import { ANTHROPIC_API_KEY, GEMINI_API_KEY } from '../config/config.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import csrfProtection from '../utils/csrf.js';
import { DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI_MODELS } from '../config/aiModels.js';

/**
 * AI helper routes (protected admin-only endpoints).
 *
 * Primary: Anthropic Claude (claude-sonnet-4-6 → claude-haiku-4-5-20251001)
 *   — only active when ANTHROPIC_API_KEY is set and @anthropic-ai/sdk is installed
 * Fallback: Google Gemini via @google/genai, free tier
 *   (gemini-3.8-flash → 3.7-flash → 3.6-flash → 3.5-flash → 3.5-flash-lite)
 */
const router = express.Router();

// Dynamic import: SDK is optional — if not installed or key missing, Claude is simply skipped
let anthropic = null;
if (ANTHROPIC_API_KEY) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    logger.debug('Anthropic Claude SDK loaded, will be used as primary AI provider');
  } catch {
    logger.warn('ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed — falling back to Gemini');
  }
}
const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const CLAUDE_MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];

function isAvailabilityError(err) {
  const msg = String(err?.message || err?.status || '').toLowerCase();
  return (
    msg.includes('model')
    || msg.includes('404')
    || msg.includes('not found')
    || msg.includes('unavailable')
    || msg.includes('deprecated')
    || msg.includes('overloaded')
  );
}

async function tryClause(prompt, systemInstruction) {
  let lastError;
  for (const model of CLAUDE_MODELS) {
    try {
      const params = {
        model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      };
      if (systemInstruction) params.system = systemInstruction;
      const message = await anthropic.messages.create(params);
      const text = message.content?.[0]?.text ?? '';
      return { text, model };
    } catch (err) {
      lastError = err;
      const hasNext = model !== CLAUDE_MODELS[CLAUDE_MODELS.length - 1];
      if (!isAvailabilityError(err) || !hasNext) throw err;
      logger.warn('Claude model unavailable, trying next', { failedModel: model, error: err.message });
    }
  }
  throw lastError;
}

// Free-tier quotas are counted per model, so a 429 (or a transient 5xx) on one
// Gemini model is worth retrying on the next one.
function isGeminiFallbackError(err) {
  return [429, 500, 503].includes(err?.status) || isAvailabilityError(err);
}

async function tryGemini(prompt, systemInstruction, preferredModel) {
  // The full default chain always follows the requested model, so a client
  // with an outdated cached script still reaches the current models
  const candidates = [...new Set([
    preferredModel || DEFAULT_GEMINI_MODEL,
    DEFAULT_GEMINI_MODEL,
    ...FALLBACK_GEMINI_MODELS,
  ])];
  let lastError;
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    try {
      const response = await genAI.models.generateContent({
        model,
        contents: prompt,
        ...(systemInstruction && { config: { systemInstruction } }),
      });
      // `text` is undefined when the answer was blocked or had no text part;
      // report that as an error instead of handing the editor an empty string
      if (!response.text) {
        const reason = response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason || 'no text';
        throw new Error(`Gemini returned no text (${reason})`);
      }
      return { text: response.text, model };
    } catch (err) {
      lastError = err;
      const hasNext = i < candidates.length - 1;
      if (!isGeminiFallbackError(err) || !hasNext) throw err;
      logger.warn('Gemini model unavailable, trying next', { failedModel: model, nextModel: candidates[i + 1], error: err.message });
    }
  }
  throw lastError;
}

// POST /api/ai/generate
router.post('/generate', csrfProtection, authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { prompt, systemInstruction, model } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || prompt.length > 20000) {
      return res.status(400).json({ success: false, error: 'Invalid prompt. Must be a string with max 20000 characters.' });
    }

    let aiResult;

    // Claude first (if key is configured)
    if (anthropic) {
      try {
        aiResult = await tryClause(prompt, systemInstruction);
        logger.debug('AI request served by Claude', { model: aiResult.model });
      } catch (claudeErr) {
        logger.warn('Claude failed, falling back to Gemini', { error: claudeErr.message });
      }
    }

    // Gemini fallback
    if (!aiResult) {
      const preferredGeminiModel = (typeof model === 'string' && model.trim() && !model.startsWith('claude'))
        ? model.trim()
        : DEFAULT_GEMINI_MODEL;
      aiResult = await tryGemini(prompt, systemInstruction, preferredGeminiModel);
      logger.debug('AI request served by Gemini', { model: aiResult.model });
    }

    return res.json({ success: true, data: { text: aiResult.text, model: aiResult.model } });
  } catch (err) {
    logger.error('AI generate route error', {
      error: err.message,
      status: err.status || err.statusCode,
      stack: err.stack,
    });

    let statusCode = 500;
    let errorMessage = 'Internal server error';
    if (err.message?.includes('API key') || err.status === 401) {
      statusCode = 502;
      errorMessage = 'API authentication failed - check API key configuration';
    } else if (err.message?.includes('quota') || err.status === 429) {
      statusCode = 429;
      errorMessage = 'API quota exceeded - please try again later';
    } else if (err.message?.includes('model') || err.status === 404) {
      statusCode = 400;
      errorMessage = 'Model not found or unavailable';
    }

    return res.status(statusCode).json({ success: false, error: errorMessage });
  }
});

export default router;
