import { JSDOM, VirtualConsole } from 'jsdom';
import logger from '../utils/logger.js';
import { safeFetch, bodyText } from '../utils/safeFetch.js';

/**
 * Collects news candidates for the weekly card digest from Hacker News (Algolia search API) and
 * RSS/Atom feeds. Candidates are plain objects:
 *   { title, url, host, sources[], published: Date, points, comments, summary, discussion }
 * `points`/`comments` exist only for stories that appeared on Hacker News; they are the signal for
 * "big news" because feeds carry no popularity at all.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HN_SEARCH_URL = 'https://hn.algolia.com/api/v1/search';
const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|igshid|ref_src|ref|cmp|wt_mc)$/i;
const MAX_URL_LENGTH = 1000; // cards.link is VARCHAR(1000)

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
};

function decodeEntities(text) {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec, hex, name) => {
    if (dec || hex) {
      const code = dec ? Number(dec) : Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : match;
  });
}

/**
 * Turns feed markup into plain text: removes tags, decodes entities, collapses whitespace.
 * Applied twice by toPlainText because decoding can reveal escaped tags (&lt;b&gt;).
 * @param {string} html
 * @returns {string}
 */
export function stripHtml(html) {
  // Block-level tags separate words, inline tags (<i>neu</i>.) must not leave a gap
  const withoutTags = String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(?:p|br|div|li|ul|ol|h[1-6]|tr|td|th|table|blockquote|section|article|figure|figcaption)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

export function toPlainText(text) {
  return stripHtml(stripHtml(text));
}

/**
 * Cuts text at a word boundary and appends an ellipsis.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/**
 * Removes tracking parameters and the fragment; returns null for anything that is not a usable
 * http(s) URL.
 * @param {string} value
 * @returns {string|null}
 */
export function normalizeUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  const result = url.toString();
  return result.length <= MAX_URL_LENGTH ? result : null;
}

/**
 * Key for duplicate detection: ignores scheme, "www.", a trailing slash and parameter order.
 * @param {string} value
 * @returns {string|null}
 */
export function canonicalKey(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  url.searchParams.sort();
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.hostname.replace(/^www\./i, '').toLowerCase()}${path}${url.search}`;
}

function hostOf(url) {
  return new URL(url).hostname.replace(/^www\./i, '');
}

// --- RSS / Atom -------------------------------------------------------------------------------

function childText(element, ...names) {
  for (const child of element.children) {
    if (names.includes(child.nodeName.toLowerCase())) {
      const text = child.textContent.trim();
      if (text) return text;
    }
  }
  return '';
}

function entryLink(element) {
  for (const child of element.children) {
    if (child.nodeName.toLowerCase() !== 'link') continue;
    const href = child.getAttribute('href');
    const rel = child.getAttribute('rel');
    if (href && (!rel || rel === 'alternate')) return href;
    if (!href && child.textContent.trim()) return child.textContent.trim();
  }
  const guid = childText(element, 'guid', 'id');
  return /^https?:\/\//i.test(guid) ? guid : '';
}

// Bare "&" and named entities that XML does not define (&nbsp;) would make the strict parser fail
function repairXml(xml) {
  return xml
    .replace(/^\uFEFF/, '')
    .trimStart()
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, '&amp;');
}

/**
 * Parses an RSS 2.0, RSS 1.0 (RDF) or Atom document.
 * Items without a title, a usable link or a date are dropped: without a date the age window
 * cannot be applied.
 * @param {string} xml
 * @param {{name: string}} source
 * @returns {Array<Object>} Candidates, in feed order.
 */
export function parseFeed(xml, source) {
  const document = new JSDOM(repairXml(xml), {
    contentType: 'text/xml',
    virtualConsole: new VirtualConsole(),
  }).window.document;
  const entries = [...document.getElementsByTagName('item'), ...document.getElementsByTagName('entry')];
  const items = [];
  for (const entry of entries) {
    const title = toPlainText(childText(entry, 'title'));
    const url = normalizeUrl(entryLink(entry));
    const published = new Date(childText(entry, 'pubdate', 'published', 'updated', 'dc:date'));
    if (!title || !url || Number.isNaN(published.getTime())) continue;
    items.push({
      title,
      url,
      host: hostOf(url),
      sources: [source.name],
      published,
      points: null,
      comments: null,
      summary: truncate(toPlainText(childText(entry, 'description', 'summary', 'content:encoded', 'content')), 400),
      discussion: null,
    });
  }
  return items;
}

export async function fetchFeed(source, { fetchFn = safeFetch, now = Date.now(), days = 7, perFeedMax = 10, userAgent } = {}) {
  const response = await fetchFn(source.url, {
    headers: { Accept: 'application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8', ...(userAgent && { 'User-Agent': userAgent }) },
    maxBytes: 3 * 1024 * 1024,
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  const since = now - days * MS_PER_DAY;
  return parseFeed(bodyText(response), source)
    .filter(item => item.published.getTime() >= since && item.published.getTime() <= now + MS_PER_DAY)
    .sort((a, b) => b.published - a.published)
    .slice(0, perFeedMax);
}

// --- Hacker News ------------------------------------------------------------------------------

/**
 * Top stories of the last `days` days with at least `minPoints` points (Algolia HN search).
 * Ask/Show/Tell posts and text posts without an external link are not news and are skipped.
 */
export async function fetchHackerNews({ fetchFn = safeFetch, now = Date.now(), days = 7, minPoints = 150, maxItems = 40, userAgent } = {}) {
  const since = Math.floor((now - days * MS_PER_DAY) / 1000);
  const query = new URLSearchParams({
    tags: 'story',
    numericFilters: `created_at_i>${since},points>=${minPoints}`,
    hitsPerPage: '100',
  });
  const response = await fetchFn(`${HN_SEARCH_URL}?${query}`, {
    headers: { Accept: 'application/json', ...(userAgent && { 'User-Agent': userAgent }) },
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  const hits = JSON.parse(bodyText(response)).hits || [];
  return hits
    .filter(hit => hit.title && hit.url && !/^(Ask|Show|Tell) HN:/i.test(hit.title))
    .map((hit) => {
      const url = normalizeUrl(hit.url);
      return url && {
        title: toPlainText(hit.title),
        url,
        host: hostOf(url),
        sources: ['Hacker News'],
        published: new Date(hit.created_at_i * 1000),
        points: hit.points ?? 0,
        comments: hit.num_comments ?? 0,
        summary: '',
        discussion: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.points - a.points)
    .slice(0, maxItems);
}

// --- Merging ----------------------------------------------------------------------------------

/**
 * Merges candidates that point at the same page. A feed item that also made it to Hacker News
 * keeps both sources and the HN points - the best "this matters" signal there is.
 * @param {Array<Object>} candidates
 * @returns {Array<Object>}
 */
export function mergeCandidates(candidates) {
  const byKey = new Map();
  for (const candidate of candidates) {
    const key = canonicalKey(candidate.url);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...candidate, sources: [...candidate.sources] });
      continue;
    }
    existing.sources = [...new Set([...existing.sources, ...candidate.sources])];
    if (candidate.points !== null) {
      existing.points = Math.max(existing.points ?? 0, candidate.points);
      existing.comments = Math.max(existing.comments ?? 0, candidate.comments ?? 0);
      existing.discussion = existing.discussion || candidate.discussion;
    }
    if (candidate.summary.length > existing.summary.length) existing.summary = candidate.summary;
  }
  return [...byKey.values()];
}

/**
 * Limits the list sent to the LLM. HN-backed stories come first (up to 40 % of the slots), the
 * rest is filled round-robin across sources, newest first, so one chatty feed cannot crowd out
 * the others.
 * @param {Array<Object>} candidates
 * @param {number} max
 * @returns {Array<Object>}
 */
export function capCandidates(candidates, max) {
  if (candidates.length <= max) return candidates;
  const popular = candidates.filter(c => c.points !== null).sort((a, b) => b.points - a.points);
  const picked = popular.slice(0, Math.ceil(max * 0.4));
  const queues = new Map();
  for (const candidate of candidates.filter(c => !picked.includes(c)).sort((a, b) => b.published - a.published)) {
    const source = candidate.sources[0];
    if (!queues.has(source)) queues.set(source, []);
    queues.get(source).push(candidate);
  }
  while (picked.length < max && [...queues.values()].some(queue => queue.length > 0)) {
    for (const queue of queues.values()) {
      if (picked.length >= max) break;
      if (queue.length > 0) picked.push(queue.shift());
    }
  }
  return picked;
}

/**
 * Fetches all sources in parallel. One broken source never aborts the run.
 * @param {Object} options
 * @param {Array<{id: string, name: string, url: string}>} options.feeds
 * @returns {Promise<{candidates: Array<Object>, report: Array<{source: string, ok: boolean, count: number, error?: string}>}>}
 */
export async function collectCandidates({ feeds, ...options }) {
  const jobs = [
    { name: 'Hacker News', run: () => fetchHackerNews(options) },
    ...feeds.map(feed => ({ name: feed.name, run: () => fetchFeed(feed, options) })),
  ];
  const settled = await Promise.allSettled(jobs.map(job => job.run()));
  const report = [];
  const collected = [];
  settled.forEach((result, index) => {
    const source = jobs[index].name;
    if (result.status === 'fulfilled') {
      collected.push(...result.value);
      report.push({ source, ok: true, count: result.value.length });
    } else {
      logger.warn(`Card digest: source "${source}" failed: ${result.reason?.message}`);
      report.push({ source, ok: false, count: 0, error: result.reason?.message || String(result.reason) });
    }
  });
  return { candidates: mergeCandidates(collected), report };
}
