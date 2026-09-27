import { BlockList, isIP } from 'node:net';
import rateLimit from 'express-rate-limit';
import logger from './logger.js';
import { getClientIp, getSafeRefererRedirect } from './requestUtils.js';

/**
 * Rate limiter helpers used across routes.
 * Exposes `strictLimiter`, `globalLimiter`, `loginLimiter` and the form
 * limiters `commentLimiter` / `contactLimiter` with sensible defaults and
 * expressive error messages.
 *
 * Set RATE_LIMIT_WHITELIST in .env to a comma-separated list of IPs
 * or CIDR ranges that should bypass all rate limits.
 * Examples: "203.0.113.42,10.0.0.0/8"
 */

const whitelist = new BlockList();
const whitelistEntries = (process.env.RATE_LIMIT_WHITELIST || '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean);

for (const entry of whitelistEntries) {
  if (entry.includes('/')) {
    const [subnet, prefix] = entry.split('/');
    const type = isIP(subnet) === 6 ? 'ipv6' : 'ipv4';
    whitelist.addSubnet(subnet, Number(prefix), type);
  } else {
    const type = isIP(entry) === 6 ? 'ipv6' : 'ipv4';
    whitelist.addAddress(entry, type);
  }
}

function isWhitelisted(req) {
  if (whitelistEntries.length === 0) return false;
  const ip = getClientIp(req);
  const family = isIP(ip);
  return family !== 0 && whitelist.check(ip, family === 6 ? 'ipv6' : 'ipv4');
}

// Shared handler that logs every rate-limit block; `respond` sends the 429 answer
function makeHandler(limiterName, respond = (req, res) => res.status(429).json({ error: 'Rate limit exceeded' })) {
  return (req, res, _next, _options) => {
    const ip = getClientIp(req);
    logger.warn(`[RATE-LIMIT] ${limiterName} exceeded`, {
      ip,
      method: req.method,
      url: req.originalUrl,
      userAgent: req.get('User-Agent'),
    });
    respond(req, res);
  };
}

// --- Rate limiters ---
// Basis-Konfiguration für alle Limiter.
// Kein eigener keyGenerator: der Default nutzt req.ip (respektiert 'trust proxy')
// und fasst IPv6-Adressen zu /56-Subnetzen zusammen. Ein aus X-Forwarded-For
// gelesener Key wäre vom Client frei wählbar und würde jedes Limit aushebeln.
const baseLimiterConfig = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded' },
};

// Schärfere Limits für kritische Endpoints
const strictLimiter = rateLimit({
  ...baseLimiterConfig,
  windowMs: 15 * 60 * 1000,
  max: 400,
  skip: isWhitelisted,
  handler: makeHandler('strictLimiter'),
});

const globalLimiter = rateLimit({
  ...baseLimiterConfig,
  windowMs: 15 * 60 * 1000,
  max: 1200,
  skip: isWhitelisted,
  handler: makeHandler('globalLimiter'),
});

const loginLimiter = rateLimit({
  ...baseLimiterConfig,
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: isWhitelisted,
  handler: (req, res, _next, _options) => {
    const ip = getClientIp(req);
    logger.warn('[SECURITY] Login rate-limit exceeded – possible brute-force attack', {
      ip,
      username: req.body?.username ?? null,
      userAgent: req.get('User-Agent'),
    });
    logger.authEvent('AUTH_LOGIN_RATE_LIMIT', {
      ip,
      username: req.body?.username ?? 'unknown',
      route: req.originalUrl,
      method: req.method,
      userAgent: req.get('User-Agent') || 'unknown',
    }, 'WARN');
    res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  },
});

// Öffentliche Formulare: Menschen schicken eine Handvoll, Spam-Bots hunderte.
// Formular-POST und JSON-API für Kommentare teilen sich einen Zähler.
const COMMENT_LIMIT_MESSAGE = 'Zu viele Kommentare in kurzer Zeit. Bitte versuche es später noch einmal.';

const commentLimiter = rateLimit({
  ...baseLimiterConfig,
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: isWhitelisted,
  handler: makeHandler('commentLimiter', (req, res) => {
    if (req.is('application/json')) {
      return res.status(429).json({ error: COMMENT_LIMIT_MESSAGE });
    }
    // Classic form post: back to the post, whose comments section shows the notice
    const postPath = `/blogpost/id/${Number(req.params?.postId) || ''}`;
    return res.redirect(303, getSafeRefererRedirect(req, postPath, {
      query: { comment: 'ratelimit' },
      hash: 'comments-section',
    }));
  }),
});

// Every contact message ends up as an email to the site owner
const contactLimiter = rateLimit({
  ...baseLimiterConfig,
  windowMs: 60 * 60 * 1000,
  max: 5,
  skip: isWhitelisted,
  handler: makeHandler('contactLimiter', (req, res) => res.status(429).json({
    success: false,
    error: 'Zu viele Nachrichten in kurzer Zeit. Bitte versuche es später noch einmal.',
  })),
});

export {
  strictLimiter,
  globalLimiter,
  loginLimiter,
  commentLimiter,
  contactLimiter,
  COMMENT_LIMIT_MESSAGE,
};
