/**
 * Error handling shared by the LLM callers (services/llmService.js for the weekly card digest,
 * routes/aiRoutes.js for the admin editor): which errors are worth trying the next model for, and
 * how to log an error so its real cause ends up in the journal.
 */

// Free-tier quotas are counted per model, so a 429 (or a transient 5xx) on one Gemini model is worth
// retrying on the next one. 504 is Gemini's DEADLINE_EXCEEDED.
const RETRYABLE_STATUS = [429, 500, 502, 503, 504];
// A bad key stays bad on the next model
const AUTH_STATUS = [401, 403];

// error.cause.code of Node's "TypeError: fetch failed" (undici) and plain socket errors that are
// worth another attempt. UND_ERR_HEADERS_TIMEOUT: no response headers within 300 s (undici default).
const NETWORK_ERROR_CODES = new Set([
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH',
]);

const AVAILABILITY_WORDS = ['model', '404', 'not found', 'unavailable', 'deprecated', 'overloaded'];

/** The model is unknown, retired or overloaded (judged by the message, as the SDKs word it). */
export function isAvailabilityError(error) {
  const message = String(error?.message || error?.status || '').toLowerCase();
  return AVAILABILITY_WORDS.some(word => message.includes(word));
}

/**
 * Timeouts and connection failures: no HTTP status at all. Checked by name and code instead of
 * instanceof, so it does not depend on the undici bundled with the Node version.
 * - AbortError / TimeoutError: our own limit (httpOptions.timeout aborts with a DOMException "AbortError")
 * - TypeError "fetch failed": undici, the reason is in error.cause.code
 */
export function isNetworkOrTimeoutError(error) {
  if (!error) return false;
  if (['AbortError', 'TimeoutError'].includes(error.name)) return true;
  const code = error.cause?.code ?? error.code;
  if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) return true;
  return error.name === 'TypeError' && error.message === 'fetch failed';
}

/**
 * Whether the next Gemini model of the chain should be tried after this error.
 * Never for authentication errors; a 400 about the thinking config counts, because not every model
 * of the chain documents the same thinking levels.
 */
export function isRetryableGeminiError(error) {
  if (AUTH_STATUS.includes(error?.status)) return false;
  return RETRYABLE_STATUS.includes(error?.status)
    || isNetworkOrTimeoutError(error)
    || isAvailabilityError(error)
    || (error?.status === 400 && /thinking/i.test(String(error?.message)));
}

/**
 * One line for the log: name, message and - where Node hides the actual reason - the cause.
 * Example: "TypeError: fetch failed (cause: UND_ERR_HEADERS_TIMEOUT Headers Timeout Error)"
 */
export function describeError(error) {
  if (error === undefined || error === null) return 'unknown error';
  if (!(error instanceof Error) && typeof error !== 'object') return String(error);
  const name = error.name && error.name !== 'Error' ? `${error.name}: ` : '';
  let text = `${name}${error.message || '(no message)'}`;
  const cause = error.cause;
  if (cause !== undefined && cause !== null) {
    if (typeof cause === 'object') {
      const label = typeof cause.code === 'string' ? cause.code : cause.name;
      text += ` (cause: ${[label, cause.message].filter(Boolean).join(' ')})`;
    } else {
      text += ` (cause: ${cause})`;
    }
  }
  return text;
}
