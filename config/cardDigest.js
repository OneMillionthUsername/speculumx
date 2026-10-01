import path from 'node:path';
import { DOMAIN } from './config.js';

/**
 * Configuration of the weekly card digest (scripts/weekly-cards.mjs, services/cardDigestService.js).
 *
 * The digest collects news from Hacker News and the RSS/Atom feeds below, lets an LLM pick the
 * few that matter for the blog, and stores them as unpublished cards for review in the admin area.
 * Everything with an env variable can be changed without touching the code.
 */

function parseInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export const CARD_DIGEST = {
  // Only stories newer than this many days are considered (the job runs weekly)
  days: parseInteger(process.env.CARD_DIGEST_DAYS, 7, 1, 31),
  // Maximum number of draft cards per run
  maxCards: parseInteger(process.env.CARD_DIGEST_MAX_CARDS, 5, 1, 10),
  // Hacker News: only stories with at least this many points count as "big"
  hnMinPoints: parseInteger(process.env.CARD_DIGEST_HN_MIN_POINTS, 150, 0, 5000),
  hnMaxItems: 40,
  // Unpublished auto-generated drafts are deleted after this many days (0 = keep them)
  draftTtlDays: parseInteger(process.env.CARD_DIGEST_DRAFT_TTL_DAYS, 30, 0, 365),
  // Newest items taken from each feed
  perFeedMax: 10,
  // Upper bound for the candidate list that is sent to the LLM
  maxCandidates: parseInteger(process.env.CARD_DIGEST_MAX_CANDIDATES, 150, 20, 400),
  // Language of titles and subtitles written by the LLM
  language: process.env.CARD_DIGEST_LANGUAGE || 'Deutsch',
  // Image sources, tried in this order: (1) an image whose free licence can be verified,
  // (2) an AI-generated illustration, (3) the static default image.
  // false: skip step (1) / step (2)
  licensedImages: parseBoolean(process.env.CARD_DIGEST_LICENSED_IMAGES, true),
  aiImages: parseBoolean(process.env.CARD_DIGEST_AI_IMAGES, true),
  // Gemini image models, first one that works wins (comma separated)
  imageModels: (process.env.CARD_DIGEST_IMAGE_MODELS || 'gemini-2.5-flash-image')
    .split(',').map(model => model.trim()).filter(Boolean),
  userAgent: `speculumx-card-digest/1.0 (+https://${DOMAIN})`,
};

// Appended to every illustration prompt so all generated cards look alike and fit the soft theme.
// The constraints keep out text (garbled letters), logos and faces of real people.
export const AI_IMAGE_STYLE = 'Flat editorial illustration, abstract and symbolic, soft warm palette '
  + '(cream, ochre, terracotta, muted blue), matte paper texture, generous empty space. '
  + 'No text, no letters, no numbers, no logos, no brand marks, no recognisable people or faces.';

// Re-hosted images land next to the uploads; the Docker setup mounts public/assets/media read-write
export const CARD_MEDIA_DIR = path.join(process.cwd(), 'public', 'assets', 'media', 'cards');
export const CARD_MEDIA_URL = '/assets/media/cards';

// Shown whenever a card has no image with a verified free licence (see imageLicenseService.js)
export const DEFAULT_CARD_IMAGE = '/assets/img/card-default.webp';

// What the blog is about; the LLM selects against this (taken from the "Über mich" page)
export const BLOG_TOPICS = [
  'Programmierung und Softwareentwicklung (Sprachen, Werkzeuge, Open Source, Sicherheit, Infrastruktur)',
  'Künstliche Intelligenz, insbesondere LLMs (neue Modelle, Forschung, Auswirkungen auf Arbeit und Gesellschaft)',
  'Wissenschaft: Physik, Biologie, Mathematik, Informatik',
  'Philosophie: Erkenntnistheorie, Logik, Ethik',
  'Gesellschaft: Ideologien, Religion, Politik, Medien, Kultur, Netzpolitik',
];

/**
 * RSS/Atom feeds. A feed that is down or has changed its URL is logged and skipped; the run only
 * fails when no source at all delivers. `npm run cards:check-sources` reports every feed.
 */
export const FEEDS = [
  // Programmierung / Tech
  { id: 'heise', name: 'heise online', url: 'https://www.heise.de/rss/heise-atom.xml' },
  { id: 'golem', name: 'Golem.de', url: 'https://rss.golem.de/rss.php?feed=RSS2.0' },
  { id: 'ars', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { id: 'lwn', name: 'LWN.net', url: 'https://lwn.net/headlines/rss' },
  { id: 'register', name: 'The Register', url: 'https://www.theregister.com/headlines.atom' },
  { id: 'github', name: 'GitHub Blog', url: 'https://github.blog/feed/' },
  // KI / LLMs
  { id: 'willison', name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/' },
  { id: 'huggingface', name: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml' },
  { id: 'openai', name: 'OpenAI News', url: 'https://openai.com/news/rss.xml' },
  { id: 'deepmind', name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  { id: 'techreview', name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },
  // Wissenschaft
  { id: 'quanta', name: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/' },
  { id: 'nature', name: 'Nature', url: 'https://www.nature.com/nature.rss' },
  { id: 'science', name: 'Science (AAAS) News', url: 'https://www.science.org/rss/news_current.xml' },
  { id: 'sciencedaily', name: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/top/science.xml' },
  { id: 'spektrum', name: 'Spektrum der Wissenschaft', url: 'https://www.spektrum.de/alias/rss/spektrum-de-rss-feed/996406' },
  { id: 'standard-wissenschaft', name: 'DER STANDARD Wissenschaft', url: 'https://www.derstandard.at/rss/wissenschaft' },
  // Philosophie / Gesellschaft / Netzpolitik
  { id: 'aeon', name: 'Aeon', url: 'https://aeon.co/feed.rss' },
  { id: 'dailynous', name: 'Daily Nous', url: 'https://dailynous.com/feed/' },
  { id: 'netzpolitik', name: 'netzpolitik.org', url: 'https://netzpolitik.org/feed/' },
];
