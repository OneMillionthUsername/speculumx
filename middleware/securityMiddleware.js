import _path from 'path';
import { sanitizeInputStrings } from '../utils/utils.js';
import * as utils from '../utils/utils.js';
import logger from '../utils/logger.js';

// --- Helper: safer content-type check ---
/**
 * Middleware to enforce `Content-Type: application/json` for requests.
 * Returns `415 Unsupported Media Type` when the header doesn't match.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireJsonContent(req, res, next) {
  const contentType = (req.get('content-type') || '').toLowerCase();

  if (!contentType.startsWith('application/json')) {
    return res
      .status(415)
      .json({ error: 'Content-Type muss application/json sein' });
  }
  next(); // alles ok → nächste Middleware / Route
}
/**
 * Factory to create middleware
 * @param {string[]} whitelist - names of fields that contain HTML (e.g. ['content'])
 */
/**
 * Factory that returns middleware to sanitize incoming input objects
 * (body, query, params, cookies).
 *
 * Plain strings stay RAW — HTML escaping happens at output (EJS `<%= %>`).
 * Whitelisted rich-text fields are sanitized via DOMPurify; prototype-pollution
 * keys cause a 400 response.
 *
 * @param {string[]} whitelist - Feldnamen, die HTML erlauben (z.B. ['content']).
 * @returns {import('express').RequestHandler} Middleware-Funktion.
 */
export function createEscapeInputMiddleware(whitelist = []) {
  return function escapeInputMiddleware(req, res, next) {
    try {
      if (req.body && typeof req.body === 'object') {
        Object.assign(req.body, sanitizeInputStrings(req.body, whitelist));
      }
      if (req.query && typeof req.query === 'object') {
        Object.assign(req.query, sanitizeInputStrings(req.query, whitelist));
      }
      if (req.params && typeof req.params === 'object') {
        Object.assign(req.params, sanitizeInputStrings(req.params, whitelist));
      }
      if (req.cookies && typeof req.cookies === 'object') {
        // Exclude CSRF tokens from sanitization to prevent loops
        const csrfKeys = ['_csrf'];
        const cookiesToSanitize = Object.fromEntries(
          Object.entries(req.cookies).filter(([key]) => !csrfKeys.includes(key)),
        );
        const sanitizedCookies = sanitizeInputStrings(cookiesToSanitize, whitelist);
        Object.assign(req.cookies, sanitizedCookies);
      }
      // File-Uploads: nur die Originalnamen escapen
      if (req.file) {
        req.file.safeFilename = utils.sanitizeFilename(req.file.originalname);
      }
      if (req.files) {
        req.files.forEach(f => {
          f.safeFilename = utils.sanitizeFilename(f.originalname);
        });
      }
    } catch (err) {
      logger.error('Error in escapeInputMiddleware: %s', err.message);
      return res.status(400).json({ error: 'Ungültige Eingabedaten' });
    }
    next();
  };
}
// --- error handler (production-safe) ---
/**
 * Global error-handling middleware.
 * - Converts CSRF-related errors to 403 with a minimal message.
 * - Logs internal errors and returns a generic 500 response to clients.
 *
 * @param {Error} err - Der aufgetretene Fehler.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
export function errorHandlerMiddleware(err, req, res, _next) {
  // Special-case CSRF errors to return 403 instead of generic 500
  const msg = String(err && err.message || '').toLowerCase();
  const name = String(err && err.name || '').toLowerCase();
  const isCsrf = err && (
    err.code === 'EBADCSRFTOKEN' ||
    (err.status === 403 && (msg.includes('csrf') || name.includes('csrf'))) ||
    (name === 'forbiddenerror' && msg.includes('csrf'))
  );

  logger.debug('errorHandlerMiddleware: Caught error', {
    url: req.url,
    method: req.method,
    userAgent: req.get('User-Agent'),
    error: err.message,
    stack: err.stack,
  });

  if (isCsrf) {
    try {
      // Minimal diagnostics without leaking secrets
      const hasHeader = Boolean(req.get('x-csrf-token') || req.get('x-xsrf-token') || req.get('csrf-token'));
      const hasCookie = Boolean(req.cookies && req.cookies._csrf);
      logger.warn('CSRF error caught by global error handler', {
        url: req.originalUrl,
        method: req.method,
        hasCsrfHeader: hasHeader,
        hasCsrfCookie: hasCookie,
        cookieNames: Object.keys(req.cookies || {}),
      });
    } catch { /* ignore */ }
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }

  logger.error('Error in request processing:', {
    url: req.url,
    method: req.method,
    error: err.message,
    stack: err.stack,
  }); // internal logging only
  
  res.status(500).json({ error: 'Internal Server Error' });
}