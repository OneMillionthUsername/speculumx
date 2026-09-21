import path from 'path';
import { DatabaseService } from '../databases/mariaDB.js';
import { sanitizeHtml } from './sanitizer.js';

/**
 * General purpose utility helpers used across the application.
 *
 * - Escaping and sanitization helpers
 * - Simple slug creation and truncation
 * - BigInt conversion helpers for DB rows
 * - Small helpers that avoid pulling large dependencies into routes
 */

const FORBIDDEN_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

// Utility zum sicheren Escapen von Dateinamen
export function sanitizeFilename(name) {
  return path.basename(name)                // Pfadbestandteile entfernen
    .replace(/[^a-zA-Z0-9._-]/g, '_')      // nur erlaubte Zeichen
    .substring(0, 255);                     // Länge begrenzen
}
export function unescapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&');
}
/**
 * Input-side sanitization: leaves plain strings RAW (escaping happens at
 * output via EJS `<%= %>`), but:
 * - sanitizes whitelisted rich-text fields (e.g. `content`) via DOMPurify
 * - throws on prototype-pollution keys (__proto__, constructor, prototype)
 *
 * Recurses into arrays/objects, mutates objects in place.
 *
 * @param {any} obj
 * @param {string[]} whitelist - field names that should be sanitized (allowed HTML)
 * @param {string[]} path
 */
export function sanitizeInputStrings(obj, whitelist = [], path = [], domPurifyInstance = null) {
  if (obj === null || obj === undefined) return obj;
  // strings
  if (typeof obj === 'string') {
    const currentKey = path[path.length - 1];
    if (currentKey && whitelist.includes(currentKey)) {
      // SANITIZE allowed HTML server-side (not raw)
      try {
        if (domPurifyInstance && typeof domPurifyInstance.sanitize === 'function') {
          // If a DOMPurify-like instance was supplied, use it (tests inject mocks this way)
          return domPurifyInstance.sanitize(obj, {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'option', 'meta', 'link'],
            ADD_ATTR: ['style', 'class', 'id', 'align'],
            ALLOW_DATA_ATTR: false,
          });
        }
        return sanitizeHtml(obj);
      } catch (error) {
        throw new Error(`Sanitization failed for key "${currentKey}": ${error.message}`);
      }
    }
    // Plain strings stay raw — escaping is the renderer's job
    return obj;
  }
  // arrays
  if (Array.isArray(obj)) {
    return obj.map((item, i) => sanitizeInputStrings(item, whitelist, [...path, String(i)], domPurifyInstance));
  }
  // objects
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      if (FORBIDDEN_KEYS.has(key)) {
        // throw to prevent prototype pollution
        throw new Error(`Forbidden key detected: "${key}"`);
      }
      obj[key] = sanitizeInputStrings(obj[key], whitelist, [...path, key], domPurifyInstance);
    }
    return obj;
  }
  return obj;
}
/**
 * Create a URL-friendly slug from a title.
 * Handles German umlauts and diacritics, strips control characters,
 * and collapses whitespace.
 */
export function createSlug(title, { maxLength = 50 /*, addHash = true */ } = {}) {
  if (!title) return '';

  // Kleinbuchstaben
  let slug = title.toLowerCase();
  // Umlaute ersetzen
  const map = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
  slug = slug.replace(/[äöüß]/g, m => map[m]);
  // Akzente entfernen
  slug = slug.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Sonderzeichen entfernen
  slug = slug.replace(/[^a-z0-9\s-]/g, '');
  // Leerzeichen und Bindestriche vereinfachen
  slug = slug.replace(/\s+/g, '-').replace(/-+/g, '-');
  // Bindestriche entfernen
  slug = slug.replace(/^-+|-+$/g, '');
  slug = truncateSlug(slug, maxLength);

  // 8. Optional Hash anhängen
  //   if (addHash) {
  //     const hash = crypto.createHash("md5").update(title).digest("hex").slice(0, 6);
  //     slug = `${slug}-${hash}`;
  //   }

  return slug;
}
// MariaDB gibt numerische Felder (z.B. id, view_count) als BigInt zurück.
// Diese Funktion konvertiert rekursiv alle BigInt-Werte zu Number, damit
// JSON.stringify und Joi-Validierung funktionieren.
// Falls das Objekt eingefroren ist (z.B. aus dem Cache), wird zuerst ein
// flacher Klon erstellt, da BigInt-Felder sonst nicht überschrieben werden können.
export function convertBigInts(obj) {
  if (typeof obj === 'bigint'){
    if (obj > Number.MAX_SAFE_INTEGER || obj < Number.MIN_SAFE_INTEGER) {
      return NaN;
    }
    return Number(obj);
  }
  if (typeof obj === 'number') return obj;
  if (typeof obj === 'string') return obj; // Nicht NaN!

  if (Array.isArray(obj)) return obj.map(convertBigInts);
  if (obj instanceof Date || (typeof Buffer !== 'undefined' && Buffer.isBuffer(obj))) return obj;
  if (obj && typeof obj === 'object') {
    const target = Object.isFrozen(obj) ? { ...obj } : obj;
    for (const key in target) {
      if (typeof target[key] === 'bigint') {
        target[key] = (target[key] > Number.MAX_SAFE_INTEGER || target[key] < Number.MIN_SAFE_INTEGER)
          ? NaN
          : Number(target[key]);
      } else if (typeof target[key] === 'object') {
        target[key] = convertBigInts(target[key]);
      }
    }
    return target;
  }
  return obj;
}
export function parseTags(tags) {
  if (Array.isArray(tags)) return tags;
  if (tags === null || typeof tags === 'undefined') return [];
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(tags)) {
    return parseTags(tags.toString('utf8'));
  }
  if (tags instanceof Uint8Array) {
    try {
      return parseTags(Buffer.from(tags).toString('utf8'));
    } catch {
      return [];
    }
  }
  if (tags && typeof tags === 'object' && Array.isArray(tags.data)) {
    try {
      return parseTags(Buffer.from(tags.data).toString('utf8'));
    } catch {
      return [];
    }
  }
  if (typeof tags === 'string' && tags.trim() !== '') {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'string') {
        return parsed.split(',').map(tag => tag.trim()).filter(Boolean);
      }
    } catch {
      return tags.split(',').map(tag => tag.trim()).filter(Boolean);
    }
  }
  return [];
}
export function truncateSlug(slug, maxLength = 50) {
  if (slug.length <= maxLength) return slug;
  const truncated = slug.slice(0, maxLength);
  const lastDash = truncated.lastIndexOf('-');
  return lastDash > 0 ? truncated.slice(0, lastDash) : truncated;
}
export function getSsrAdmin(res) {
  return Boolean(res && res.locals && res.locals.isAdmin);
}
export function applySsrNoCache(res, { varyCookie = false } = {}) {
  if (!res || typeof res.set !== 'function') return;
  res.set('Cache-Control', 'private, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  if (varyCookie) {
    res.set('Vary', 'Cookie');
  }
}
export function prefersJsonResponse(req) {
  const wantsJsonParam = req && req.query && String(req.query.format || '').toLowerCase() === 'json';
  const isAjax = (req && req.get && String(req.get('X-Requested-With') || '').toLowerCase()) === 'xmlhttprequest';
  const acceptsHtml = req && req.accepts && req.accepts('html');
  const acceptsJson = req && req.accepts && req.accepts('json');
  return Boolean(wantsJsonParam || isAjax || (!acceptsHtml && acceptsJson));
}
export async function incrementViews(req, postId) {
  const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.get('User-Agent');
  const referer = req.get('Referer');

  const { default: viewTracker } = await import('./viewTracker.js');
  if (!viewTracker.shouldCount(ipAddress, postId, userAgent)) return;

  DatabaseService.increasePostViews(postId, ipAddress, userAgent, referer).catch(err => {
    console.error('Fehler beim Tracking:', err);
  });
  // Probabilistic cache invalidation: occasionally invalidate mostRead cache
  // to ensure popular lists reflect recent view counts without deleting cache on every hit.
  try {
    const rand = Math.random();
    if (rand < 0.01) { // ~1% chance
      // Lazy-load simpleCache to avoid cyclic deps at module load time
      import('../utils/simpleCache.js').then(m => m.default).then(simpleCache => {
        try {
          console.debug('incrementViews: probabilistic cache invalidation triggered for posts:mostRead');
        } catch (_e) { /* ignore */ }
        if (simpleCache && typeof simpleCache.del === 'function') {
          try { simpleCache.del('posts:mostRead'); } catch (_e) { /* ignore */ }
        }
      }).catch(() => { /* ignore import failures */ });
    }
  } catch (_err) {
    // best-effort invalidation, ignore failures
  }
}
