/**
 * In-memory deduplication for post view counts.
 *
 * Prevents a single IP from incrementing the view counter for the same post
 * more than once within a 30-minute window. Also filters known bots and crawlers.
 *
 * Views are reported by a client-side beacon (see views/readPost.ejs), so most
 * crawlers never get here because they do not run JavaScript. This filter is
 * the second line of defence for those that do or that hit the endpoint directly.
 *
 * Not persistent across server restarts — acceptable tradeoff for simplicity.
 */

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ENTRIES = 10_000;

// key: `${ip}:${postId}` → timestamp of last counted view
const seen = new Map();

const BOT_PATTERN = /bot|crawler|spider|scraper|slurp|bingbot|googlebot|yandex|baidu|duckduck|facebot|whatsapp|telegram|twitterbot|linkedinbot|semrush|ahrefs|mj12|majestic|bytespider|claudebot|heritrix|firstpage|dataprovider|builtwith|soulsociety|headless/i;

// A UA that carries a URL ("+http://example.com/bot.html") is practically always a bot
const URL_IN_UA_PATTERN = /https?:\/\//i;

function isBot(userAgent) {
  if (!userAgent) return true; // no UA → treat as bot
  return BOT_PATTERN.test(userAgent) || URL_IN_UA_PATTERN.test(userAgent);
}

function evictExpired() {
  const cutoff = Date.now() - TTL_MS;
  for (const [key, ts] of seen) {
    if (ts < cutoff) seen.delete(key);
  }
}

/**
 * Returns true if this view should be counted (new unique view within TTL).
 * Side effect: records the view if returning true.
 *
 * @param {string} ip
 * @param {number|string} postId
 * @param {string|undefined} userAgent
 * @returns {boolean}
 */
function shouldCount(ip, postId, userAgent) {
  if (!ip || !postId) return false;
  if (isBot(userAgent)) return false;

  const key = `${ip}:${postId}`;
  const now = Date.now();
  const lastSeen = seen.get(key);

  if (lastSeen && (now - lastSeen) < TTL_MS) return false;

  // Evict expired entries before adding new ones if the map is getting large
  if (seen.size >= MAX_ENTRIES) evictExpired();

  seen.set(key, now);
  return true;
}

export { isBot, shouldCount };
export default { isBot, shouldCount };
