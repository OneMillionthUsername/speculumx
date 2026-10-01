/* Shared text utilities usable in both browser and server (ESM only). */

// Decode common HTML entities (named + numeric). Safe to use before inserting
// into templates that will escape output again.
export function decodeHtmlEntities(input = '') {
  let s = String(input);
  // numeric decimal entities
  s = s.replace(/&#(\d+);/g, (_, dec) => {
    try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return _; }
  });
  // numeric hex entities
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return _; }
  });
  // selected named entities
  const map = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&apos;': '\'',
    '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—', '&hellip;': '…',
    '&lsquo;': '‘', '&rsquo;': '’', '&ldquo;': '“', '&rdquo;': '”',
    '&laquo;': '«', '&raquo;': '»',
    '&auml;': 'ä', '&ouml;': 'ö', '&uuml;': 'ü', '&Auml;': 'Ä', '&Ouml;': 'Ö', '&Uuml;': 'Ü', '&szlig;': 'ß',
  };
  return s.replace(/(&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;|&ndash;|&mdash;|&hellip;|&lsquo;|&rsquo;|&ldquo;|&rdquo;|&laquo;|&raquo;|&auml;|&ouml;|&uuml;|&Auml;|&Ouml;|&Uuml;|&szlig;)/g, m => map[m] || m);
}

export function stripHtmlToText(input = '') {
  const decoded = decodeHtmlEntities(String(input));
  return decoded
    .replace(/<[^>]*>/g, ' ')
    .replace(/<[^>]*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractFirstImageUrl(htmlContent = '') {
  const decoded = decodeHtmlEntities(String(htmlContent));
  const quotedMatch = decoded.match(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i);
  if (quotedMatch && quotedMatch[2]) return quotedMatch[2].trim();

  const unquotedMatch = decoded.match(/<img\b[^>]*\bsrc\s*=\s*([^\s"'<>]+)/i);
  return unquotedMatch && unquotedMatch[1] ? unquotedMatch[1].trim() : '';
}

// Strip HTML tags and decode entities to produce a plain-text excerpt.
// Used server-side via withExcerpts() before rendering templates.
export function createExcerpt(htmlContent = '', maxLen = 150) {
  const txt = stripHtmlToText(htmlContent);
  if (!txt) return '';
  const excerpt = txt.length > maxLen ? txt.substring(0, maxLen).trimEnd() : txt;
  return excerpt.endsWith('...') ? excerpt : `${excerpt}...`;
}

// Frequent function words that only occur in one of the two languages (words like "in", "so",
// "was", "an", "will", "man" or "also" exist in both and are left out on purpose).
const GERMAN_WORDS = new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'einen', 'einem', 'einer',
  'zu', 'den', 'dem', 'des', 'von', 'mit', 'sich', 'auf', 'für', 'im', 'auch', 'als', 'es', 'wie', 'bei', 'aus',
  'nach', 'oder', 'wird', 'werden', 'sind', 'wir', 'ich', 'sie', 'er', 'noch', 'nur', 'über', 'durch', 'dass',
  'aber', 'wenn', 'hat', 'haben', 'kann', 'diese', 'dieser', 'doch', 'schon', 'sehr', 'zum', 'zur', 'vom']);
const ENGLISH_WORDS = new Set(['the', 'and', 'of', 'to', 'is', 'it', 'that', 'for', 'with', 'on', 'are', 'be', 'this',
  'by', 'not', 'or', 'have', 'from', 'at', 'which', 'but', 'they', 'you', 'we', 'has', 'can', 'their', 'there',
  'would', 'been', 'what', 'about', 'its', 'were', 'these', 'those', 'into', 'than', 'then', 'when', 'just', 'your']);

/**
 * Language of a post or teaser text: 'en' when English function words clearly outnumber German ones,
 * otherwise 'de' (the language of the site). The browser needs the right language to hyphenate a text
 * (CSS `hyphens: auto` uses the patterns of the element's `lang`).
 * @param {string} htmlOrText
 * @returns {'de'|'en'}
 */
export function detectLanguage(htmlOrText = '') {
  // The opening of a post decides; stripHtmlToText copes with a tag cut off at the end
  const words = stripHtmlToText(String(htmlOrText).slice(0, 20000)).toLowerCase().match(/[a-zäöüß]+/g) || [];
  let de = 0;
  let en = 0;
  for (const word of words.slice(0, 600)) {
    if (GERMAN_WORDS.has(word)) de++;
    else if (ENGLISH_WORDS.has(word)) en++;
  }
  return en >= 5 && en > de * 2 ? 'en' : 'de';
}

// Pre-compute plain-text excerpts (and the language, for hyphenation) on a posts array before passing to templates.
export const withExcerpts = (posts) => Array.isArray(posts)
  ? posts.map(p => ({ ...p, excerpt: createExcerpt(p.content), lang: detectLanguage(p.content) }))
  : posts;

// Clean pasted HTML content: strip inline styles, unwrap presentational wrappers,
// remove AI-generated container divs (Gemini, ChatGPT), while keeping semantic HTML.
export function cleanPostContent(html = '') {
  let s = String(html);

  // 1. Unwrap Gemini/AI wrapper divs (class="markdown markdown-main-panel ...")
  s = s.replace(/<div\b[^>]*class="[^"]*markdown[^"]*"[^>]*>([\s\S]*?)<\/div>\s*$/i, '$1');

  // 2. Remove all style attributes
  s = s.replace(/\s*style="[^"]*"/gi, '');

  // 3. Unwrap spans that only served as style carriers (no meaningful attributes left)
  //    <span>text</span> → text
  s = s.replace(/<span\b(?:\s+(?:class="[^"]*"))?\s*>([\s\S]*?)<\/span>/gi, '$1');

  // 4. Remove empty class attributes left behind
  s = s.replace(/\s*class=""/g, '');

  // 5. Remove AI-specific attributes (id, dir, aria-*, data-*)
  s = s.replace(/\s*(?:id|dir|aria-\w+|data-[\w-]+)="[^"]*"/gi, '');

  // 6. Remove Gemini-specific classes from remaining elements
  s = s.replace(/\s*class="[^"]*(?:ng-tns|ng-star|ng-trigger|ng-animate|gds-title|code-block-decoration|formatted-code|animated-opacity|markdown-main)[^"]*"/gi, '');

  // 7. Clean up empty wrapper divs left behind
  s = s.replace(/<div\s*>\s*<\/div>/gi, '');
  s = s.replace(/<div\s*>\s*(<(?:div|p|h[1-6]|ul|ol|hr|pre|blockquote|table)\b)/gi, '$1');
  s = s.replace(/(<\/(?:div|p|h[1-6]|ul|ol|hr|pre|blockquote|table)>)\s*<\/div>/gi, '$1');

  // 8. Collapse excessive whitespace between tags
  s = s.replace(/>\s{2,}</g, '> <');

  // 9. Remove leading/trailing whitespace
  s = s.trim();

  return s;
}

// Minimal HTML escaper for text content
export function escapeHtml(str = '') {
  const s = String(str);
  const map = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return s.replace(/[&<>"']/g, ch => map[ch]);
}
