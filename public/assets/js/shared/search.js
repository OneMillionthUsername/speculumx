/* Search helpers shared by server and browser (ESM only). */

export const SEARCH_MAX_LENGTH = 100;
export const SEARCH_MAX_TERMS = 5;
export const SEARCH_MIN_TERM_LENGTH = 2;

// Fold one UTF-16 code unit to a lower-case base letter ("Ü" -> "u"), keeping the string length
// unchanged so match offsets in the folded text apply to the original text. This mirrors the
// case- and accent-insensitive matching of the database collation (utf8mb4_unicode_ci).
function foldChar(ch) {
  const base = ch.normalize('NFD').charAt(0) || ch;
  return base.toLowerCase().charAt(0) || base;
}

function foldText(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) out += foldChar(text.charAt(i));
  return out;
}

/**
 * Collapse whitespace and cap the length. Anything that is not a string (e.g. `?q=a&q=b`) yields ''.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeQuery(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH);
}

/**
 * Split a query into at most SEARCH_MAX_TERMS distinct terms of at least SEARCH_MIN_TERM_LENGTH
 * characters. A post has to match all of them.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function getSearchTerms(raw) {
  const q = normalizeQuery(raw);
  if (!q) return [];
  const seen = new Set();
  const terms = [];
  for (const part of q.split(' ')) {
    const key = foldText(part);
    if (part.length < SEARCH_MIN_TERM_LENGTH || seen.has(key)) continue;
    seen.add(key);
    terms.push(part);
    if (terms.length >= SEARCH_MAX_TERMS) break;
  }
  return terms;
}

// Merged, sorted [start, end) ranges of all term occurrences in `text`.
function findRanges(text, terms) {
  const folded = foldText(text);
  const ranges = [];
  for (const term of terms) {
    const needle = foldText(term);
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const idx = folded.indexOf(needle, from);
      if (idx === -1) break;
      ranges.push([idx, idx + needle.length]);
      from = idx + needle.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/**
 * Cut `text` into segments for highlighting. The caller renders every segment escaped and wraps
 * the ones with `match: true` in <mark>, so no HTML is ever built from user input.
 * @param {string} text
 * @param {string[]} terms
 * @returns {{ text: string, match: boolean }[]}
 */
export function splitHighlight(text, terms) {
  const source = String(text ?? '');
  const ranges = terms && terms.length ? findRanges(source, terms) : [];
  const segments = [];
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start > pos) segments.push({ text: source.slice(pos, start), match: false });
    segments.push({ text: source.slice(start, end), match: true });
    pos = end;
  }
  if (pos < source.length) segments.push({ text: source.slice(pos), match: false });
  return segments;
}

// Longest text that is scanned for the snippet; keeps very long posts cheap.
const SNIPPET_SCAN_LIMIT = 60000;

/**
 * Plain-text snippet of about `maxLen` characters around the first match. Falls back to the
 * beginning of the text when the terms only matched the title or the tags.
 * @param {string} text plain text (HTML already stripped)
 * @param {string[]} terms
 * @param {number} [maxLen]
 * @returns {string}
 */
export function buildSnippet(text, terms, maxLen = 180) {
  const source = String(text ?? '').slice(0, SNIPPET_SCAN_LIMIT);
  if (!source) return '';
  const ranges = terms && terms.length ? findRanges(source, terms) : [];
  if (ranges.length === 0) {
    return source.length > maxLen ? `${source.slice(0, maxLen).trimEnd()} …` : source;
  }
  const first = ranges[0][0];
  let start = Math.max(0, first - Math.floor(maxLen * 0.3));
  if (start > 0) {
    const space = source.indexOf(' ', start);
    if (space !== -1 && space < first) start = space + 1;
  }
  let end = Math.min(source.length, start + maxLen);
  if (end < source.length) {
    const space = source.lastIndexOf(' ', end);
    if (space > first) end = space;
  }
  return `${start > 0 ? '… ' : ''}${source.slice(start, end).trim()}${end < source.length ? ' …' : ''}`;
}
