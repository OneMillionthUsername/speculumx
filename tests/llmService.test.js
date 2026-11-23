/** @jest-environment node */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.unstable_mockModule('../utils/logger.js', () => ({ default: logger }));
jest.unstable_mockModule('../config/config.js', () => ({
  ANTHROPIC_API_KEY: '',
  GEMINI_API_KEY: 'test-key',
}));
jest.unstable_mockModule('@google/genai', () => ({ GoogleGenAI: jest.fn() }));

const { createLlmService } = await import('../services/llmService.js');

const apiError = (status, message) => Object.assign(new Error(message), { status });
// What Node's fetch throws when undici gives up after 300 s without response headers (journal, 23.11.)
const headersTimeout = () => new TypeError('fetch failed', {
  cause: Object.assign(new Error('Headers Timeout Error'), { name: 'HeadersTimeoutError', code: 'UND_ERR_HEADERS_TIMEOUT' }),
});
// What the SDK throws when its httpOptions.timeout fires (checked against @google/genai 1.42.0)
const sdkAbort = () => new globalThis.DOMException('This operation was aborted', 'AbortError');
const warnings = () => logger.warn.mock.calls.map(([line]) => line).join('\n');

describe('llmService', () => {
  let anthropic;
  let gemini;
  beforeEach(() => {
    Object.values(logger).forEach(fn => fn.mockClear());
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

  it('moves to the next Gemini model when fetch gives up without response headers', async () => {
    gemini.models.generateContent
      .mockRejectedValueOnce(headersTimeout())
      .mockResolvedValueOnce({ text: 'second' });
    const result = await service({ anthropic: false }).generateText({ system: 's', prompt: 'p' });
    expect(result).toEqual({ text: 'second', model: 'gem-2' });
    expect(warnings()).toMatch(/gem-1 failed after [\d.]+ s: TypeError: fetch failed \(cause: UND_ERR_HEADERS_TIMEOUT Headers Timeout Error\)/);
  });

  it('turns its own timeout into a readable error and moves to the next model', async () => {
    gemini.models.generateContent
      .mockRejectedValueOnce(sdkAbort())
      .mockResolvedValueOnce({ text: 'second' });
    const result = await service({ anthropic: false }).generateText({ system: 's', prompt: 'p', timeoutMs: 90_000 });
    expect(result.model).toBe('gem-2');
    expect(warnings()).toMatch(/gem-1 failed after [\d.]+ s: TimeoutError: Gemini model gem-1 timed out after 90 s/);
  });

  it('keeps the cause in the error and the log when the last Gemini model fails too', async () => {
    gemini.models.generateContent.mockImplementation(() => Promise.reject(headersTimeout()));
    const error = await service({ anthropic: false }).generateText({ system: 's', prompt: 'p' }).catch(e => e);
    expect(error.cause.code).toBe('UND_ERR_HEADERS_TIMEOUT');
    expect(gemini.models.generateContent).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenLastCalledWith(expect.stringMatching(/gem-2 failed.*UND_ERR_HEADERS_TIMEOUT/));
  });

  it('moves on when a model rejects the thinking config, but not on another bad request', async () => {
    gemini.models.generateContent
      .mockRejectedValueOnce(apiError(400, 'Thinking level MINIMAL is not supported'))
      .mockResolvedValueOnce({ text: 'second' });
    expect((await service({ anthropic: false }).generateText({ system: 's', prompt: 'p' })).model).toBe('gem-2');

    gemini.models.generateContent.mockReset();
    gemini.models.generateContent.mockRejectedValue(apiError(400, 'INVALID_ARGUMENT'));
    await expect(service({ anthropic: false }).generateText({ system: 's', prompt: 'p' })).rejects.toThrow('INVALID_ARGUMENT');
    expect(gemini.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it('passes the timeout and the thinking level to every Gemini call', async () => {
    gemini.models.generateContent
      .mockRejectedValueOnce(apiError(503, 'unavailable'))
      .mockResolvedValueOnce({ text: 'ok', usageMetadata: { promptTokenCount: 9000, thoughtsTokenCount: 1200, candidatesTokenCount: 300 } });
    await service({ anthropic: false }).generateText({ system: 's', prompt: 'p', timeoutMs: 120_000, thinkingLevel: 'MEDIUM' });
    for (const [request] of gemini.models.generateContent.mock.calls) {
      expect(request.config).toMatchObject({ httpOptions: { timeout: 120_000 }, thinkingConfig: { thinkingLevel: 'MEDIUM' } });
      expect(request.config.thinkingConfig).not.toHaveProperty('thinkingBudget');
    }
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/gem-2 answered in [\d.]+ s \(prompt 9000, thinking 1200, output 300 tokens\)/));
  });

  it('defaults to a 240 s limit and LOW thinking, and can leave both to the SDK and the model', async () => {
    gemini.models.generateContent.mockResolvedValue({ text: 'ok' });
    await service({ anthropic: false }).generateText({ system: 's', prompt: 'p' });
    expect(gemini.models.generateContent.mock.calls[0][0].config).toMatchObject({
      httpOptions: { timeout: 240_000 }, thinkingConfig: { thinkingLevel: 'LOW' },
    });

    await service({ anthropic: false }).generateText({ system: 's', prompt: 'p', timeoutMs: 0, thinkingLevel: null });
    const { config } = gemini.models.generateContent.mock.calls[1][0];
    expect(config).not.toHaveProperty('httpOptions');
    expect(config).not.toHaveProperty('thinkingConfig');
  });

  it('logs the cause of a Claude failure', async () => {
    anthropic.messages.create.mockImplementation(() => Promise.reject(headersTimeout()));
    gemini.models.generateContent.mockResolvedValue({ text: 'ok' });
    await service().generateText({ system: 's', prompt: 'p' });
    expect(warnings()).toMatch(/Claude model claude-a failed after [\d.]+ s: .*UND_ERR_HEADERS_TIMEOUT/);
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
