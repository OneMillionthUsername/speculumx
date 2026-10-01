import { JSDOM, VirtualConsole } from 'jsdom';
import { safeFetch, bodyText } from '../utils/safeFetch.js';

/**
 * Finds an image for a linked article, but only when a free licence can be verified from
 * machine-readable data. A licence cannot be verified in general: news sites publish their
 * og:image under all rights reserved without saying so, and a missing statement is not a licence.
 * So the rule is "positive evidence or no image", and only licences that need no attribution
 * (CC0, public domain) count, because cards have no field for a credit line.
 *
 * Two kinds of evidence are accepted:
 *   1. The image comes from Wikimedia Commons and the Commons API reports CC0 / public domain.
 *   2. The page itself declares CC0 / public domain (<link rel="license">, <a rel="license">,
 *      JSON-LD "license") and nothing contradicting it, and the image is hosted on the same site.
 */

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/**
 * Classifies a licence URL.
 * @param {string} url
 * @returns {'free'|'attribution'|'restricted'|'unknown'}
 *   free: CC0 or public domain mark; attribution: CC BY / BY-SA (needs a credit line);
 *   restricted: other Creative Commons licences (NC/ND); unknown: anything else.
 */
export function evaluateLicenseUrl(url) {
  const value = String(url || '').toLowerCase();
  if (/^https?:\/\/(www\.)?creativecommons\.org\/publicdomain\/(zero|mark)\//.test(value)) return 'free';
  if (/^https?:\/\/(www\.)?creativecommons\.org\/licenses\/by(-sa)?\//.test(value)) return 'attribution';
  if (/^https?:\/\/(www\.)?creativecommons\.org\/licenses\//.test(value)) return 'restricted';
  return 'unknown';
}

function collectJsonLdLicenses(node, found, depth = 0) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    node.forEach(child => collectJsonLdLicenses(child, found, depth + 1));
    return;
  }
  if (typeof node !== 'object') return;
  if (node.license) {
    const values = Array.isArray(node.license) ? node.license : [node.license];
    for (const value of values) {
      const url = typeof value === 'string' ? value : value?.['@id'] || value?.url;
      if (url) found.push(String(url));
    }
  }
  Object.values(node).forEach(child => collectJsonLdLicenses(child, found, depth + 1));
}

function sameSite(a, b) {
  const clean = host => host.replace(/^www\./i, '').toLowerCase();
  const first = clean(a);
  const second = clean(b);
  return first === second || first.endsWith(`.${second}`) || second.endsWith(`.${first}`);
}

/**
 * Reads the preview image and the declared licences from an article page.
 * @param {string} html
 * @param {string} pageUrl
 * @returns {{imageUrl: string|null, licenseUrls: string[]}}
 */
export function extractPageMeta(html, pageUrl) {
  const document = new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document;

  let imageUrl = null;
  const selectors = [
    'meta[property="og:image:secure_url"]', 'meta[property="og:image"]',
    'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]',
  ];
  for (const selector of selectors) {
    const content = document.querySelector(selector)?.getAttribute('content');
    if (!content) continue;
    try {
      const resolved = new URL(content.trim(), pageUrl);
      if (resolved.protocol === 'https:' || resolved.protocol === 'http:') {
        imageUrl = resolved.toString();
        break;
      }
    } catch { /* try the next tag */ }
  }

  const licenseUrls = [];
  document.querySelectorAll('link[rel~="license"], a[rel~="license"]').forEach((element) => {
    const href = element.getAttribute('href');
    if (!href) return;
    try {
      licenseUrls.push(new URL(href, pageUrl).toString());
    } catch { /* ignore a broken href */ }
  });
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      collectJsonLdLicenses(JSON.parse(script.textContent), licenseUrls);
    } catch { /* invalid JSON-LD carries no evidence */ }
  });

  return { imageUrl, licenseUrls };
}

/**
 * Name of the Commons file behind an upload.wikimedia.org URL (original or thumbnail).
 * Only /wikipedia/commons/ counts: files uploaded to a single language edition are often fair use.
 * @param {string} imageUrl
 * @returns {string|null}
 */
export function wikimediaFileName(imageUrl) {
  let url;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }
  if (url.hostname !== 'upload.wikimedia.org') return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'wikipedia' || segments[1] !== 'commons') return null;
  const rest = segments.slice(2);
  const name = rest[0] === 'thumb' ? rest[3] : rest[2];
  if (!name) return null;
  try {
    return decodeURIComponent(name);
  } catch {
    return null;
  }
}

/**
 * Decides from the Commons "extmetadata" of a file whether it may be used without attribution.
 * @param {Object} metadata
 * @returns {{ok: boolean, license: string, reason: string}}
 */
export function assessCommonsMetadata(metadata = {}) {
  const value = key => String(metadata[key]?.value ?? '').trim();
  const license = value('LicenseShortName');
  if (value('NonFree').toLowerCase() === 'true') return { ok: false, license, reason: 'non-free file' };
  if (value('Restrictions')) return { ok: false, license, reason: `restrictions: ${value('Restrictions')}` };
  if (value('AttributionRequired').toLowerCase() !== 'false') {
    return { ok: false, license, reason: 'attribution required' };
  }
  if (!/^(cc0|public domain|pd\b|pdm)/i.test(license)) {
    return { ok: false, license, reason: `licence "${license || 'unknown'}" is not CC0/public domain` };
  }
  return { ok: true, license, reason: 'Wikimedia Commons: no attribution required' };
}

async function checkCommons(imageUrl, fetchFn, headers) {
  const fileName = wikimediaFileName(imageUrl);
  if (!fileName) return null;
  const query = new URLSearchParams({
    action: 'query', titles: `File:${fileName}`, prop: 'imageinfo', iiprop: 'extmetadata',
    format: 'json', formatversion: '2',
  });
  const response = await fetchFn(`${COMMONS_API}?${query}`, { headers });
  if (response.status !== 200) return { ok: false, license: '', reason: `Commons API HTTP ${response.status}` };
  const metadata = JSON.parse(bodyText(response)).query?.pages?.[0]?.imageinfo?.[0]?.extmetadata;
  if (!metadata) return { ok: false, license: '', reason: 'no Commons metadata' };
  return assessCommonsMetadata(metadata);
}

/**
 * Looks for an image on `pageUrl` that may be re-used without attribution.
 *
 * @param {string} pageUrl - The article the card links to.
 * @param {Object} [deps]
 * @param {Function} [deps.fetchFn] - safeFetch-compatible function.
 * @param {string} [deps.userAgent]
 * @returns {Promise<{imageUrl: string|null, license?: string, reason: string}>}
 *   `imageUrl` is only set when a verified free licence was found; `reason` says why or why not.
 */
export async function findLicensedImage(pageUrl, { fetchFn = safeFetch, userAgent } = {}) {
  const headers = userAgent ? { 'User-Agent': userAgent } : {};
  let page;
  try {
    page = await fetchFn(pageUrl, { headers: { ...headers, Accept: 'text/html' }, maxBytes: 1.5 * 1024 * 1024 });
  } catch (error) {
    return { imageUrl: null, reason: `page not reachable: ${error.message}` };
  }
  if (page.status !== 200 || !/html/i.test(String(page.headers['content-type'] || ''))) {
    return { imageUrl: null, reason: `page is not HTML (HTTP ${page.status})` };
  }

  const { imageUrl, licenseUrls } = extractPageMeta(bodyText(page), page.url);
  if (!imageUrl) return { imageUrl: null, reason: 'page has no preview image' };

  try {
    const commons = await checkCommons(imageUrl, fetchFn, headers);
    if (commons) {
      return commons.ok
        ? { imageUrl, license: commons.license, reason: commons.reason }
        : { imageUrl: null, license: commons.license, reason: commons.reason };
    }
  } catch (error) {
    return { imageUrl: null, reason: `Commons lookup failed: ${error.message}` };
  }

  const verdicts = licenseUrls.map(evaluateLicenseUrl);
  if (verdicts.length === 0) return { imageUrl: null, reason: 'no licence information' };
  if (!verdicts.every(verdict => verdict === 'free')) {
    return { imageUrl: null, reason: `licence is not CC0/public domain: ${licenseUrls.join(', ')}` };
  }
  if (!sameSite(new URL(imageUrl).hostname, new URL(page.url).hostname)) {
    return { imageUrl: null, reason: 'image is hosted on another site than the licence statement' };
  }
  return { imageUrl, license: licenseUrls[0], reason: 'page declares CC0/public domain' };
}
