/**
 * Simple in-memory cache with TTL and basic LRU protections for single-instance use.
 * Not suitable for multi-process deployments (use Redis or similar there).
 *
 * Exposes `set`, `get`, `del`, `clear` and `getStats` helpers. Values are
 * deep-frozen on storage to prevent accidental mutation by callers.
 */

const store = new Map();

function now() {
  return Date.now();
}

const DEFAULT_TTL = Number(process.env.POSTS_CACHE_TTL_MS || 3600000); // 60 minutes default
const MAX_ENTRIES = Number(process.env.POSTS_CACHE_MAX_ENTRIES || 500);
// Max total bytes for cached serialized values (0 = disabled)
const MAX_BYTES = Number(process.env.POSTS_CACHE_MAX_BYTES || 0);

let totalBytes = 0;

function ensureLimit() {
  // Evict oldest entries while we exceed entry count or byte size limits
  while (store.size > MAX_ENTRIES || (MAX_BYTES > 0 && totalBytes > MAX_BYTES)) {
    const firstKey = store.keys().next().value;
    const entry = store.get(firstKey);
    if (!entry) break;
    if (typeof entry.size === 'number') totalBytes -= entry.size;
    store.delete(firstKey);
  }
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const val of Object.values(obj)) {
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

function sizeOf(value) {
  try {
    const s = JSON.stringify(value);
    return Buffer.byteLength(s, 'utf8');
  } catch (_e) {
    return 0;
  }
}

function set(key, value, ttlMs = DEFAULT_TTL) {
  const expires = ttlMs > 0 ? now() + ttlMs : null;
  const newSize = sizeOf(value);
  // If replacing existing entry, remove its size contribution
  const existing = store.get(key);
  if (existing && typeof existing.size === 'number') {
    totalBytes -= existing.size;
  }
  store.set(key, { value: deepFreeze(value), expires, size: newSize });
  totalBytes += newSize;
  ensureLimit();
}

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expires && entry.expires < now()) {
    // subtract size when evicting expired entry
    if (typeof entry.size === 'number') totalBytes -= entry.size;
    store.delete(key);
    return null;
  }
  return entry.value;
}

function del(key) {
  const entry = store.get(key);
  if (entry && typeof entry.size === 'number') totalBytes -= entry.size;
  store.delete(key);
}

// Remove every entry whose key starts with `prefix` (e.g. all 'posts:' lists)
function delByPrefix(prefix) {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) del(key);
  }
}

function clear() {
  store.clear();
  totalBytes = 0;
}

export default {
  set,
  get,
  del,
  delByPrefix,
  clear,
  getStats: () => ({ entries: store.size, totalBytes }),
};
