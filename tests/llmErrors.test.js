/** @jest-environment node */
import { describe, it, expect } from '@jest/globals';
import { describeError, isNetworkOrTimeoutError, isRetryableGeminiError } from '../utils/llmErrors.js';

const apiError = (status, message) => Object.assign(new Error(message), { status });
const fetchFailed = code => new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code }) });

describe('llmErrors', () => {
  it.each(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT'])(
    'treats fetch failed with %s as a network error worth the next model', (code) => {
      expect(isNetworkOrTimeoutError(fetchFailed(code))).toBe(true);
      expect(isRetryableGeminiError(fetchFailed(code))).toBe(true);
    });

  it('treats an abort of our own limit as a timeout', () => {
    expect(isRetryableGeminiError(new globalThis.DOMException('This operation was aborted', 'AbortError'))).toBe(true);
    expect(isRetryableGeminiError(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe(true);
  });

  it('retries quota and server errors, never authentication errors', () => {
    for (const status of [429, 500, 502, 503, 504]) expect(isRetryableGeminiError(apiError(status, 'x'))).toBe(true);
    // "model" in the text would count as an availability error; the status wins
    expect(isRetryableGeminiError(apiError(401, 'API key not valid for model x'))).toBe(false);
    expect(isRetryableGeminiError(apiError(403, 'Permission denied on model x'))).toBe(false);
    expect(isRetryableGeminiError(apiError(400, 'INVALID_ARGUMENT'))).toBe(false);
    expect(isRetryableGeminiError(new Error('Gemini returned no text (SAFETY)'))).toBe(false);
  });

  it('puts the cause of a failed fetch into the log line', () => {
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('Headers Timeout Error'), { code: 'UND_ERR_HEADERS_TIMEOUT' }),
    });
    expect(describeError(error)).toBe('TypeError: fetch failed (cause: UND_ERR_HEADERS_TIMEOUT Headers Timeout Error)');
    expect(describeError(new Error('plain'))).toBe('plain');
    expect(describeError('text')).toBe('text');
    expect(describeError(undefined)).toBe('unknown error');
  });
});
