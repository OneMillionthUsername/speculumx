/** @jest-environment node */
import { describe, it, expect, jest } from '@jest/globals';

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
jest.unstable_mockModule('../config/config.js', () => ({
  GEMINI_API_KEY: 'test-key',
  DOMAIN: 'example.org',
}));
jest.unstable_mockModule('@google/genai', () => ({ GoogleGenAI: jest.fn() }));

const { buildImagePrompt, generateIllustration } = await import('../services/imageGenerationService.js');

const imageResponse = data => ({
  candidates: [{ content: { parts: [{ text: 'Here is your image' }, { inlineData: { mimeType: 'image/png', data } }] } }],
});

describe('buildImagePrompt', () => {
  it('appends the fixed style with its restrictions to the motif', () => {
    const prompt = buildImagePrompt('A telescope above a field of circuits');
    expect(prompt.startsWith('A telescope above a field of circuits.')).toBe(true);
    expect(prompt).toMatch(/No text/);
    expect(prompt).toMatch(/no logos/);
    expect(prompt).toMatch(/no recognisable people/);
  });

  it('cleans markup, limits the length and has a fallback motif', () => {
    expect(buildImagePrompt('<b>Bold</b> idea')).toMatch(/^Bold idea\./);
    expect(buildImagePrompt('x'.repeat(2000)).length).toBeLessThan(700);
    expect(buildImagePrompt('')).toMatch(/^An abstract symbol/);
  });
});

describe('generateIllustration', () => {
  it('returns the image bytes of the first model that delivers one', async () => {
    const client = { models: { generateContent: jest.fn().mockResolvedValue(imageResponse(Buffer.from('PNGDATA').toString('base64'))) } };
    const result = await generateIllustration('a mirror', { client, models: ['img-1', 'img-2'] });
    expect(result.model).toBe('img-1');
    expect(result.buffer.toString()).toBe('PNGDATA');
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
    expect(client.models.generateContent.mock.calls[0][0]).toMatchObject({
      model: 'img-1', config: { responseModalities: ['TEXT', 'IMAGE'] },
    });
  });

  it('tries the next model when one fails or returns no image', async () => {
    const client = { models: { generateContent: jest.fn()
      .mockRejectedValueOnce(new Error('404 model not found'))
      .mockResolvedValueOnce({ candidates: [{ content: { parts: [{ text: 'sorry' }] }, finishReason: 'IMAGE_SAFETY' }] })
      .mockResolvedValueOnce(imageResponse(Buffer.from('ok').toString('base64'))) } };
    const result = await generateIllustration('a mirror', { client, models: ['m1', 'm2', 'm3'] });
    expect(result.model).toBe('m3');
  });

  it('throws the last error when no model delivers', async () => {
    const client = { models: { generateContent: jest.fn().mockRejectedValue(new Error('quota exceeded')) } };
    await expect(generateIllustration('a mirror', { client, models: ['m1'] })).rejects.toThrow('quota exceeded');
  });

  it('fails clearly without a configured client', async () => {
    await expect(generateIllustration('a mirror', { client: null, models: ['m1'] })).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
