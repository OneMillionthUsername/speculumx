/** @jest-environment node */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';

// Same setup as production today: no Anthropic key, so Gemini serves every request
jest.unstable_mockModule('../config/config.js', () => ({
  ANTHROPIC_API_KEY: '',
  GEMINI_API_KEY: 'test-gemini-key',
}));
jest.unstable_mockModule('../middleware/authMiddleware.js', () => ({
  authenticateToken: (req, res, next) => next(),
  requireAdmin: (req, res, next) => next(),
}));
jest.unstable_mockModule('../utils/csrf.js', () => ({
  default: (req, res, next) => next(),
}));
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const mockGenerateContent = jest.fn();
const mockGoogleGenAI = jest.fn(() => ({ models: { generateContent: mockGenerateContent } }));
jest.unstable_mockModule('@google/genai', () => ({ GoogleGenAI: mockGoogleGenAI }));

const { default: aiRouter } = await import('../routes/aiRoutes.js');
const request = (await import('supertest')).default;
// The client is created at import time; clearMocks wipes call records before each test
const clientOptions = mockGoogleGenAI.mock.calls[0]?.[0];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRouter);
  return app;
}

function apiError(status, message) {
  return Object.assign(new Error(message), { status });
}

describe('POST /api/ai/generate (Gemini via @google/genai)', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it('creates the client with the configured API key', () => {
    expect(clientOptions).toEqual({ apiKey: 'test-gemini-key' });
  });

  it('calls the requested model with the system instruction and returns its text', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'Verbesserter Text' });

    const res = await request(buildApp())
      .post('/api/ai/generate')
      .send({ prompt: 'Text', systemInstruction: 'Du bist Lektor.', model: 'gemini-3-flash-preview' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { text: 'Verbesserter Text', model: 'gemini-3-flash-preview' } });
    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: 'gemini-3-flash-preview',
      contents: 'Text',
      config: { systemInstruction: 'Du bist Lektor.' },
    });
  });

  it('omits the config when there is no system instruction', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'ok' });

    await request(buildApp()).post('/api/ai/generate').send({ prompt: 'Text', systemInstruction: '' });

    expect(mockGenerateContent).toHaveBeenCalledWith({ model: 'gemini-3-flash-preview', contents: 'Text' });
  });

  it('moves on to the next model when the free-tier quota of one model is exhausted', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(apiError(429, 'RESOURCE_EXHAUSTED'))
      .mockResolvedValueOnce({ text: 'vom Fallback' });

    const res = await request(buildApp()).post('/api/ai/generate').send({ prompt: 'Text' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ text: 'vom Fallback', model: 'gemini-2.5-flash' });
    expect(mockGenerateContent.mock.calls.map(([params]) => params.model))
      .toEqual(['gemini-3-flash-preview', 'gemini-2.5-flash']);
  });

  it('answers 429 once every model is out of quota', async () => {
    mockGenerateContent.mockRejectedValue(apiError(429, 'RESOURCE_EXHAUSTED'));

    const res = await request(buildApp()).post('/api/ai/generate').send({ prompt: 'Text' });

    expect(res.status).toBe(429);
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
  });

  it('does not try other models for a non-availability error', async () => {
    mockGenerateContent.mockRejectedValue(apiError(400, 'INVALID_ARGUMENT'));

    const res = await request(buildApp()).post('/api/ai/generate').send({ prompt: 'Text' });

    expect(res.status).toBe(500);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('reports a blocked answer as an error instead of returning empty text', async () => {
    mockGenerateContent.mockResolvedValue({ text: undefined, promptFeedback: { blockReason: 'SAFETY' } });

    const res = await request(buildApp()).post('/api/ai/generate').send({ prompt: 'Text' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('rejects a missing prompt without calling the API', async () => {
    const res = await request(buildApp()).post('/api/ai/generate').send({});

    expect(res.status).toBe(400);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});
