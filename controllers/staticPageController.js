import logger from '../utils/logger.js';
import { decodeHtmlEntities, withExcerpts, createExcerpt, extractFirstImageUrl, stripHtmlToText, detectLanguage } from '../public/assets/js/shared/text.js';
import { normalizeQuery, getSearchTerms, buildSnippet, splitHighlight } from '../public/assets/js/shared/search.js';
import categoryController from './categoryController.js';
import postController, { getCurrentPostsPaginated, searchPostsPaginated, PAGE_SIZE } from './postController.js';
import cardController, { CARDS_PER_PAGE } from './cardController.js';
import { DatabaseService } from '../databases/mariaDB.js';
import { applySsrNoCache, getSsrAdmin } from '../utils/utils.js';
import { getClientIp } from '../utils/requestUtils.js';
import contactMailService from '../services/contactMailService.js';

// stripHtmlToText leaves the blank that replaced a closing tag in front of punctuation ("Text .")
const plainText = (html) => stripHtmlToText(html || '').replace(/\s+([.,;:!?…)])/g, '$1').replace(/\(\s+/g, '(');

/**
 * Plain-text teaser of at most `maxLen` characters that ends on a whole word (an ellipsis marks a cut).
 * @param {string} html
 * @param {number} maxLen
 * @returns {string}
 */
export function excerptAtWordEnd(html, maxLen) {
  const text = plainText(html);
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()} …`;
}

/**
 * Source of the first image in a post's HTML, for teaser cards. Images uploaded through the editor are single
 * WebP files (routes/uploadRoutes.js); resized -344/-688 variants only exist for discovery cards, so the URL is
 * used as it is. Anything that is neither an http(s) URL nor a site path (data: URIs, a src cut off by the
 * preview length) yields no image.
 * @param {string} html
 * @returns {{src: string|null, srcset: null}}
 */
export function resolvePreviewImage(html) {
  let url = extractFirstImageUrl(html || '');
  if (!/^https?:\/\//i.test(url)) {
    const assetsIdx = url.indexOf('/assets/');
    if (assetsIdx > 0) url = url.substring(assetsIdx);
    if (!url.startsWith('/')) return { src: null, srcset: null };
  }
  return { src: url, srcset: null };
}

async function showHomePage(req, res) {
  logger.debug(`[HOME] GET / requested from ${req.ip}, User-Agent: ${req.get('User-Agent')}`);
  logger.debug('[HOME] GET / - Rendering index.ejs');
  const isAdmin = getSsrAdmin(res);
  const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;

  try {
    const posts = await DatabaseService.getPublishedPostsForHome();
    const categories = await categoryController.getAllCategories();
    const featuredPosts = (posts || []).slice(0, 3).map(p => ({
      title: decodeHtmlEntities(p.title || ''),
      slug: p.slug,
      excerpt: createExcerpt(p.excerpt_source, 150),
      lang: detectLanguage(p.excerpt_source),
      previewImage: resolvePreviewImage(p.preview_source || p.excerpt_source),
    }));

    // The newest post, shown larger as "Aktuell" by themes that have a lead card (soft)
    const newest = (posts || [])[0];
    const leadPost = newest ? {
      title: decodeHtmlEntities(newest.title || ''),
      slug: newest.slug,
      excerpt: excerptAtWordEnd(newest.excerpt_source, 280),
      lang: featuredPosts[0].lang,
      created_at: newest.created_at,
      previewImage: featuredPosts[0].previewImage,
    } : null;

    const popularPosts = (posts || [])
      .slice()
      .sort((a, b) => (b.views || 0) - (a.views || 0))
      .slice(0, 5)
      .map(p => ({
        id: p.id,
        slug: p.slug,
        title: decodeHtmlEntities(p.title || ''),
      }));

    const archiveYears = Array.from(new Set((posts || []).map(p => {
      try { return new Date(p.created_at).getFullYear(); } catch { return null; }
    }).filter(Boolean))).sort((a, b) => b - a);

    const cardsPage = Math.max(1, parseInt(req.query.cardsPage, 10) || 1);
    let cards = [];
    let cardsPagination = null;
    let total = 0;
    try {
      const result = await cardController.getCardsPaginated(cardsPage);
      cards = result.cards;
      total = result.total;
      const totalCardPages = Math.ceil(total / CARDS_PER_PAGE);
      // Page 1 must always render, even when there are no published cards
      if (cardsPage > 1 && cardsPage > totalCardPages) {
        applySsrNoCache(res, { varyCookie: true });
        return res.status(404).render('notFound', { isAdmin, csrfToken });
      }
      if (totalCardPages > 1) {
        cardsPagination = {
          currentPage: cardsPage,
          totalPages: totalCardPages,
          baseUrl: '/',
          extraParams: '',
          paramName: 'cardsPage',
        };
      }
    } catch (cardErr) {
      logger.error('[HOME] GET / - Error fetching cards:', cardErr);
      cards = [];
    }

    logger.debug('[HOME] GET / - Rendering index.ejs with featured posts:', { featured_slugs: featuredPosts.map(p => p.slug) });
    applySsrNoCache(res, { varyCookie: true });
    res.render('index', { featuredPosts, leadPost, popularPosts, archiveYears, cards, cardsPagination, isAdmin, csrfToken, categories });
    logger.debug('[HOME] GET / - Successfully rendered index.ejs');
  } catch (error) {
    logger.error('[HOME] GET / - Error rendering index.ejs:', error);
    applySsrNoCache(res, { varyCookie: true });
    res.status(500).send('Error rendering homepage');
  }
}

function showAboutPage(req, res) {
  const isAdmin = getSsrAdmin(res);
  const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
  applySsrNoCache(res, { varyCookie: true });
  res.render('about', { isAdmin, csrfToken });
}

function redirectAboutHtml(_req, res) {
  res.redirect('/about');
}

async function submitContactForm(req, res) {
  const minSubmitDelayMs = 3000;
  const honeypot = String(req.body?.website || '').trim();
  const formLoadedAtRaw = String(req.body?.formLoadedAt || '').trim();
  const formLoadedAt = Number(formLoadedAtRaw);
  const now = Date.now();
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim();
  const message = String(req.body?.message || '').trim();
  const ip = getClientIp(req);
  const userAgent = req.get('User-Agent') || 'unknown';

  if (honeypot) {
    logger.warn('[CONTACT] Honeypot triggered - dropping submission', { ip });
    return res.status(200).json({ success: true, message: 'Nachricht erfolgreich gesendet.' });
  }

  const isInvalidTimestamp = !Number.isFinite(formLoadedAt) || formLoadedAt <= 0 || formLoadedAt > now;
  const isTooFast = !isInvalidTimestamp && (now - formLoadedAt < minSubmitDelayMs);

  if (isInvalidTimestamp || isTooFast) {
    logger.warn('[CONTACT] Timing check triggered - dropping submission', {
      ip,
      isInvalidTimestamp,
      elapsedMs: isInvalidTimestamp ? null : (now - formLoadedAt),
    });
    return res.status(429).json({
      success: false,
      error: 'Bitte warte einen Moment und sende das Formular erneut.',
    });
  }

  contactMailService.sendContactMail({ name, email, message, ip, userAgent })
    .catch(error => {
      logger.error('[CONTACT] Failed to send contact email', {
        error: error && error.message ? error.message : String(error),
        ip,
      });
    });

  return res.status(200).json({ success: true, message: 'Nachricht erfolgreich gesendet.' });
}

async function showPostsPage(req, res) {
  try {
    const isAdmin = getSsrAdmin(res);
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    const page = Math.max(1, parseInt(req.query && req.query.page) || 1);
    const { posts, total } = await getCurrentPostsPaginated(page);
    const totalPages = Math.ceil(total / PAGE_SIZE);
    if (page > 1 && (totalPages === 0 || page > totalPages)) {
      applySsrNoCache(res, { varyCookie: true });
      return res.status(404).render('notFound', { isAdmin, csrfToken });
    }
    const pagination = {
      currentPage: page,
      totalPages,
      baseUrl: '/posts',
      extraParams: '',
    };
    applySsrNoCache(res, { varyCookie: true });
    return res.render('listCurrentPosts', { posts: withExcerpts(posts), isAdmin, csrfToken, pagination });
  } catch (err) {
    logger.error('[POSTS] Error rendering listCurrentPosts:', err && err.message);
    const isAdmin = getSsrAdmin(res);
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    applySsrNoCache(res, { varyCookie: true });
    return res.render('listCurrentPosts', { isAdmin, csrfToken });
  }
}

async function showSearchPage(req, res) {
  const isAdmin = getSsrAdmin(res);
  const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
  const searchQuery = normalizeQuery(req.query && req.query.q);
  const terms = getSearchTerms(searchQuery);
  const page = Math.max(1, parseInt(req.query && req.query.page, 10) || 1);
  const view = { isAdmin, csrfToken, searchQuery, terms, posts: [], total: 0, pagination: null, categories: [], searchFailed: false };

  try {
    if (terms.length > 0) {
      const { posts, total } = await searchPostsPaginated(terms, page);
      const totalPages = Math.ceil(total / PAGE_SIZE);
      if (page > 1 && (totalPages === 0 || page > totalPages)) {
        applySsrNoCache(res, { varyCookie: true });
        return res.status(404).render('notFound', { isAdmin, csrfToken });
      }
      view.total = total;
      // Highlighting is prepared as segments; the template escapes each one and wraps matches in <mark>
      view.posts = posts.map(p => ({
        ...p,
        titleParts: splitHighlight(p.title || '', terms),
        snippetParts: splitHighlight(buildSnippet(plainText(p.content), terms), terms),
      }));
      view.pagination = {
        currentPage: page,
        totalPages,
        baseUrl: '/search',
        extraParams: `&q=${encodeURIComponent(searchQuery)}`,
      };
    }
    if (view.posts.length === 0) {
      // Something to click on instead of a dead end
      view.categories = await categoryController.getAllCategories().catch(() => []);
    }
  } catch (err) {
    logger.error('[SEARCH] Error rendering searchResults:', err && err.message);
    view.searchFailed = true;
  }

  applySsrNoCache(res, { varyCookie: true });
  return res.status(view.searchFailed ? 500 : 200).render('searchResults', view);
}

function getCreateViewBaseContext(req, res) {
  const isAdmin = getSsrAdmin(res);
  const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
  const formError = req.query && req.query.error ? 'Blogpost konnte nicht gespeichert werden.' : null;
  return { isAdmin, csrfToken, formError };
}

async function renderCreatePostView(req, res, { post = null, formAction = '/blogpost/create' } = {}) {
  try {
    const { isAdmin, csrfToken, formError } = getCreateViewBaseContext(req, res);

    const categories = await categoryController.getAllCategories();
    logger.debug('[CREATEPOST] Fetched categories for createPost view', { categoryCount: Array.isArray(categories) ? categories.length : 0 });

    applySsrNoCache(res, { varyCookie: true });
    res.render('createPost', { isAdmin, post, csrfToken, formAction, formError, categories, usePrism: true, useTinyMce: true });
  } catch (err) {
    logger.error('[CREATEPOST] Error rendering createPost:', err);
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    applySsrNoCache(res, { varyCookie: true });
    res.render('createPost', {
      isAdmin: false,
      post: null,
      csrfToken,
      formAction: '/blogpost/create',
      formError: 'Blogpost konnte nicht geladen werden.',
      categories: [],
      usePrism: true,
      useTinyMce: true,
    });
  }
}

async function showCreatePostPage(req, res) {
  return renderCreatePostView(req, res, {
    post: null,
    formAction: '/blogpost/create',
  });
}

async function showUpdatePostByIdPage(req, res) {
  const postId = req.params && req.params.id;
  let serverPost = null;
  try {
    if (postId && /^[0-9]+$/.test(String(postId))) {
      serverPost = await postController.getPostByIdForEdit(postId);
    }
  } catch (fetchErr) {
    logger.debug('[UPDATEPOST] Could not fetch post by id for prefill:', fetchErr && fetchErr.message);
  }

  const fallbackEditId = postId && /^[0-9]+$/.test(String(postId)) ? Number(postId) : null;
  const effectivePostId = serverPost && serverPost.id ? Number(serverPost.id) : fallbackEditId;
  const formAction = effectivePostId ? `/blogpost/update/${effectivePostId}` : '/blogpost/create';

  return renderCreatePostView(req, res, {
    post: serverPost,
    formAction,
  });
}

function showAdminPage(req, res) {
  const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
  return res.render('adminPanel', { isAdmin: true, csrfToken });
}

export default {
  showHomePage,
  showAboutPage,
  redirectAboutHtml,
  submitContactForm,
  showPostsPage,
  showSearchPage,
  showCreatePostPage,
  showUpdatePostByIdPage,
  showAdminPage,
};
