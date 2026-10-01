import { GoogleGenAI } from '@google/genai';
import logger from '../utils/logger.js';
import { GEMINI_API_KEY } from '../config/config.js';
import { AI_IMAGE_STYLE, CARD_DIGEST } from '../config/cardDigest.js';
import { toPlainText, truncate } from './newsSourceService.js';

/**
 * Generates the illustration for a card when no image with a verified free licence exists.
 * Uses the Gemini image models (CARD_DIGEST_IMAGE_MODELS). Image generation is not part of every
 * free tier: when the key or quota does not allow it, the caller falls back to the static image.
 */

let sharedClient = null;

function getClient() {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your_gemini_api_key_here') return null;
  sharedClient ??= new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return sharedClient;
}

/**
 * Builds the final prompt: the subject comes from the LLM that selected the story, the style is
 * fixed so all cards look alike.
 * @param {string} subject
 * @returns {string}
 */
export function buildImagePrompt(subject) {
  const clean = truncate(toPlainText(subject), 300);
  return `${clean || 'An abstract symbol for news about technology and science'}. ${AI_IMAGE_STYLE}`;
}

/**
 * @param {string} subject - Short English description of the motif.
 * @param {Object} [deps]
 * @param {Object} [deps.client] - @google/genai client (for tests).
 * @param {string[]} [deps.models]
 * @returns {Promise<{buffer: Buffer, model: string}>}
 * @throws {Error} When no model returned an image.
 */
export async function generateIllustration(subject, { client = getClient(), models = CARD_DIGEST.imageModels } = {}) {
  if (!client) throw new Error('GEMINI_API_KEY is not configured');
  const prompt = buildImagePrompt(subject);
  let lastError;
  for (const model of models) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: { responseModalities: ['TEXT', 'IMAGE'] },
      });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const image = parts.find(part => part.inlineData?.data);
      if (!image) {
        const reason = response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason || 'no image part';
        throw new Error(`no image returned (${reason})`);
      }
      return { buffer: Buffer.from(image.inlineData.data, 'base64'), model };
    } catch (error) {
      lastError = error;
      logger.warn(`Card digest: image model ${model} failed: ${error.message}`);
    }
  }
  throw lastError ?? new Error('no image model configured');
}
