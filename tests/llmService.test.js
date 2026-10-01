/** @jest-environment node */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
jest.unstable_mockModule('../config/config.js', () => ({
  ANTHROPIC_API_KEY: '',
  GEMINI_API_KEY: 'test-key',
}));
jest.unstable_mockModule('@google/genai', () => ({ GoogleGenAI: jest.fn() }));

const { createLlmService } = await import('../services/llmService.js');

const apiError = (status, message) => Object.assign(new Error(message), { status });

describe('llmService', () => {
  let anthropic;
  let gemini;
  beforeEach(() => {
    anthropic = { messages: { create: jest.fn() } };
    gemini = { models: { generateContent: jest.fn() } };
  });

  const service = (extra = {}) => createLlmService({
    anthropic, gemini, claudeModels: ['claude-a', 'claude-b'], geminiModels: ['gem-1', 'gem-2'], ...extra,
  });

  it('uses Claude first, skips thinking blocks and does not set sampling parameters', async () => {
    anthropic.messages.create.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"picks":[]}' }],
    });
    const result = await service().generateText({ system: 'sys', prompt: 'p' });
    expect(result).toEqual({ text: '{"picks":[]}', model: 'claude-a' });
    const request = anthropic.messages.create.mock.calls[0][0];
    expect(request).toMatchObject({ model: 'claude-a', system: 'sys', output_config: { effort: 'low' } });
    expect(request).not.toHaveProperty('thinking');
    expect(request).not.toHaveProperty('temperature');
    expect(gemini.models.generateContent).not.toHaveBeenCalled();
  });

  it('tries the next Claude model, then Gemini, when Claude fails or refuses', async () => {
    anthropic.messages.create
      .mockRejectedValueOnce(apiError(529, 'overloaded'))
      .mockResolvedValueOnce({ stop_reason: 'refusal', content: [] });
    gemini.models.generateContent.mockResolvedValue({ text: '{"picks":[]}' });
    const result = await service().generateText({ system: 'sys', prompt: 'p' });
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ text: '{"picks":[]}', model: 'gem-1' });
    expect(gemini.models.generateContent.mock.calls[0][0].config).toMatchObject({
      systemInstruction: 'sys', responseMimeType: 'application/json',
    });
  });

  it('uses Gemini alone when no Claude client is configured', async () => {
    gemini.models.generateContent.mockResolvedValue({ text: 'ok' });
    const result = await service({ anthropic: false }).generateText({ system: 's', prompt: 'p' });
    expect(result.model).toBe('gem-1');
  });

  it('moves to the next Gemini model on a quota error but not on an auth error', async () => {
    gemini.models.generateContent
      .mockRejectedValueOnce(apiError(429, 'quota'))
      .mockResolvedValueOnce({ text: 'second' });
    expect((await service({ anthropic: false }).generateText({ system: 's', prompt: 'p' })).text).toBe('second');

    gemini.models.generateContent.mockReset();
    gemini.models.generateContent.mockRejectedValue(apiError(401, 'API key invalid'));
    await expect(service({ anthropic: false }).generateText({ system: 's', prompt: 'p' })).rejects.toThrow('API key invalid');
    expect(gemini.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it('reports a blocked Gemini answer instead of returning empty text', async () => {
    gemini.models.generateContent.mockResolvedValue({ text: '', promptFeedback: { blockReason: 'SAFETY' } });
    await expect(service({ anthropic: false, geminiModels: ['gem-1'] }).generateText({ system: 's', prompt: 'p' }))
      .rejects.toThrow(/SAFETY/);
  });

  it('fails clearly when no provider is configured', async () => {
    await expect(service({ anthropic: false, gemini: false }).generateText({ system: 's', prompt: 'p' }))
      .rejects.toThrow(/No AI provider configured/);
  });
});
