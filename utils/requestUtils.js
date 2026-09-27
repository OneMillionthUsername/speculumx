/**
 * Request helpers shared by routes and middleware.
 */

/**
 * Returns the client IP address for logging and rate limiting.
 *
 * Relies on `req.ip`, which honours the `trust proxy` setting in app.js: with
 * one trusted hop it is the address Nginx appended to X-Forwarded-For. The
 * first X-Forwarded-For entry must never be used directly — the client
 * controls it and could rotate it to evade rate limits or forge log entries.
 *
 * @param {import('express').Request} req
 * @returns {string} Client IP (IPv4-mapped IPv6 normalised) or 'unknown'.
 */
export function getClientIp(req) {
  const ip = String(req?.ip || req?.socket?.remoteAddress || '');
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip || 'unknown';
}

/**
 * Returns path and query of a same-host Referer, otherwise `fallback`.
 * Only a path is ever returned, so redirecting to it cannot leave the site.
 *
 * @param {import('express').Request} req
 * @param {string} fallback - Local path used when the Referer is missing or foreign.
 * @returns {string}
 */
export function getSafeRefererPath(req, fallback) {
  const referer = req.get('Referer');
  if (!referer) return fallback;
  try {
    const url = new URL(referer);
    if (url.hostname !== req.hostname) return fallback;
    const path = url.pathname + url.search;
    // Browsers treat "//host" and "/\host" as protocol-relative URLs
    return /^\/[/\\]/.test(path) ? fallback : path;
  } catch {
    return fallback;
  }
}

/**
 * Same-host Referer (or `fallback`) with extra query parameters and a fragment,
 * e.g. to send a form post back to its page with a status notice.
 *
 * @param {import('express').Request} req
 * @param {string} fallback - Local path used when the Referer is missing or foreign.
 * @param {{ query?: Record<string, string>, hash?: string }} [options]
 * @returns {string}
 */
export function getSafeRefererRedirect(req, fallback, { query = {}, hash = '' } = {}) {
  // The base is only needed to parse the local path; it never ends up in the result
  const url = new URL(getSafeRefererPath(req, fallback), 'http://localhost');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  url.hash = hash;
  return url.pathname + url.search + url.hash;
}
