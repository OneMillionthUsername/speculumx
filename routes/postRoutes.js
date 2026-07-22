/**
 * Fehler im Controller als Exceptions werfen
 * in der Route abfangen und an das Frontend zurückgeben
 */

/**
 * Routes for blog posts and related API endpoints.
 *
 * - Serves both HTML (server-side rendered) and JSON API variants.
 * - Provides ETag handling, caching, and content negotiation.
 * - Exports `getAllHandler` for integration testing.
 *
 * Handler functions map controller-layer exceptions to appropriate HTTP
 * responses (e.g. 404 for not found, 500 for server errors).
 */

import express from 'express';
import categoryController from '../controllers/categoryController.js';
import postController, { getAllPostsPaginated, getPostsByCategoryPaginated, getPostsByTagPaginated, getArchivedPostsPaginated, PAGE_SIZE } from '../controllers/postController.js';
import commentsController from '../controllers/commentController.js';
import { PostControllerException } from '../models/customExceptions.js';
import { convertBigInts, incrementViews, createSlug, parseTags, getSsrAdmin, applySsrNoCache } from '../utils/utils.js';
import simpleCache from '../utils/simpleCache.js';
import csrfProtection from '../utils/csrf.js';
import { globalLimiter, strictLimiter } from '../utils/limiters.js';
import validationService from '../services/validationService.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import { validateId, validateSlug } from '../middleware/validationMiddleware.js';
import logger from '../utils/logger.js';
import { escapeAllStrings } from '../utils/utils.js';
import { withExcerpts } from '../public/assets/js/shared/text.js';

const postRouter = express.Router();

function parsePage(req) {
  return Math.max(1, parseInt(req.query && req.query.page) || 1);
}

function buildPagination(currentPage, total, baseUrl, extraParams) {
  return {
    currentPage,
    totalPages: Math.ceil(total / PAGE_SIZE),
    baseUrl,
    extraParams: extraParams || '',
  };
}

function isPageOutOfRange(page, total) {
  if (page <= 1) return false;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages === 0) return true;
  return page > totalPages;
}

function renderPaginationNotFound(req, res) {
  const isAdmin = getSsrAdmin(res);
  const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
  applySsrNoCache(res, { varyCookie: true });
  return res.status(404).render('notFound', { isAdmin, csrfToken });
}

async function buildReadPostViewData(req, res, post) {
  const isAdmin = getSsrAdmin(res);
  // lade comments
  let comments = [];
  try {
    if (post && post.id) {
      comments = await commentsController.fetchCommentsByPostId(Number(post.id));
    }
  } catch (_e) {
    comments = [];
  }
  const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
  const status = req && req.query ? String(req.query.comment || '') : '';
  const commentStatus = status === 'ok' || status === 'error' || status === 'deleted' ? status : null;
  const commentMessage = commentStatus === 'ok'
    ? 'Kommentar gespeichert.'
    : commentStatus === 'deleted'
      ? 'Kommentar gelöscht.'
      : (commentStatus === 'error' ? 'Kommentar konnte nicht gespeichert werden.' : null);
  // SEO: individueller Seitentitel + Meta-Description pro Blogpost,
  // sonst zeigt Google für alle Beiträge nur den generischen Site-Titel an.
  const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const pageTitle = post && post.title ? `${post.title} – Sub specie aeternitatis` : undefined;
  const metaDescription = post ? stripHtml(post.description || post.content).slice(0, 160) || undefined : undefined;
  return { isAdmin, comments, csrfToken, commentCount: comments.length, commentStatus, commentMessage, usePrism: true, pageTitle, metaDescription };
}

// commentsRouter.all();
async function getAllHandler(req, res) {
  const requestId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  logger.debug(`[${requestId}] GET /all: Request received`, {
    headers: {
      'user-agent': req.get('User-Agent'),
      'referer': req.get('Referer'),
      'x-forwarded-for': req.get('X-Forwarded-For'),
      'host': req.get('Host'),
    },
    query: req.query,
    ip: req.ip,
    method: req.method,
    url: req.originalUrl,
  });
  
  try {
    const page = parsePage(req);
    const { posts, total } = await getAllPostsPaginated(page);
    if (isPageOutOfRange(page, total)) {
      logger.debug(`[${requestId}] GET /all: page out of range page=${page} total=${total}`);
      return renderPaginationNotFound(req, res);
    }
    const response = convertBigInts(posts) || [];
    const pagination = buildPagination(page, total, '/blogpost/all');
    
    const safePosts = withExcerpts(Array.isArray(response) ? response.map(p => escapeAllStrings(p, ['content', 'description'])) : response);
    const isAdmin = getSsrAdmin(res);
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    applySsrNoCache(res, { varyCookie: true });
    return res.render('listCurrentPosts', { posts: safePosts, isAdmin, csrfToken, pagination });
    
  } catch (error) {
    logger.debug(`[${requestId}] GET /all: Error occurred`, {
      error_message: error.message,
      error_name: error.name,
      error_stack: error.stack,
      error_type: typeof error,
    });
    console.error('Error loading blog posts', error);
    logger.error(`[${requestId}] GET /all route error: ${error.message}`);
    const isAdmin = getSsrAdmin(res);
    applySsrNoCache(res, { varyCookie: true });
    res.status(500).render('error', { message: 'Serverfehler beim Laden der Blogposts', isAdmin });
  }
}

postRouter.get('/all', globalLimiter, csrfProtection, getAllHandler);

postRouter.get('/admin/drafts',
  globalLimiter,
  csrfProtection,
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const [drafts, unpublished] = await Promise.all([
        postController.getDrafts(),
        postController.getUnpublishedPosts(),
      ]);
      const isAdmin = getSsrAdmin(res);
      const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
      applySsrNoCache(res, { varyCookie: true });
      return res.render('adminDrafts', { drafts, unpublished, isAdmin, csrfToken });
    } catch (error) {
      logger.error('Error loading drafts/unpublished posts:', error.message);
      const isAdmin = getSsrAdmin(res);
      const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
      applySsrNoCache(res, { varyCookie: true });
      return res.status(500).render('error', { message: 'Serverfehler beim Laden der Entwürfe', isAdmin, csrfToken });
    }
  });

// Fallback: /tag?q=xxx → /tag/:tag (when JS doesn't intercept the form)
postRouter.get('/tag', globalLimiter, (req, res) => {
  const tag = req.query.q;
  if (tag) {
    return res.redirect(`/blogpost/tag/${encodeURIComponent(tag.trim())}`);
  }
  return res.redirect('/blogpost/all');
});

postRouter.get('/tag/:tag', globalLimiter, csrfProtection, async (req, res) => {
  const tag = req.params.tag;
  try {
    const page = parsePage(req);
    const { posts, total } = await getPostsByTagPaginated(tag, page);
    if (isPageOutOfRange(page, total)) {
      return renderPaginationNotFound(req, res);
    }
    const response = convertBigInts(posts) || posts;
    const safeResponse = Array.isArray(response) ? response.map(p => escapeAllStrings(p, ['content', 'description'])) : response;
    const isAdmin = getSsrAdmin(res);
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    const pagination = buildPagination(page, total, `/blogpost/tag/${tag}`);
    applySsrNoCache(res, { varyCookie: true });
    return res.render('listCurrentPosts', { posts: withExcerpts(safeResponse), isAdmin, csrfToken, activeTag: tag, pagination });
  } catch (error) {
    console.error('Error loading blog posts by tag', error);
    const isAdmin = getSsrAdmin(res);
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    applySsrNoCache(res, { varyCookie: true });
    res.status(500).render('error', { message: 'Serverfehler beim Laden der Blogposts nach Tag', isAdmin, csrfToken });
  }
});

postRouter.get('/category/:categorySlug', globalLimiter, csrfProtection, async (req, res) => {
  const categorySlug = req.params.categorySlug;
  try {
    const page = parsePage(req);
    const { posts, total } = await getPostsByCategoryPaginated(categorySlug, page);
    if (isPageOutOfRange(page, total)) {
      return renderPaginationNotFound(req, res);
    }
    const response = convertBigInts(posts) || posts;
    const safeResponse = Array.isArray(response) ? response.map(p => escapeAllStrings(p, ['content', 'description'])) : response;
    const isAdmin = getSsrAdmin(res);
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    const pagination = buildPagination(page, total, `/blogpost/category/${categorySlug}`);
    applySsrNoCache(res, { varyCookie: true });
    return res.render('listCurrentPosts', { posts: withExcerpts(safeResponse), isAdmin, csrfToken, category: categorySlug, pagination });
  } catch (error) {
    console.error('Error loading blog posts by category', error);
    const isAdmin = getSsrAdmin(res);
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    applySsrNoCache(res, { varyCookie: true });
    res.status(500).render('error', { message: 'Serverfehler beim Laden der Blogposts nach Kategorie', isAdmin, csrfToken });
  }
});

// Export handler for integration tests
export { getAllHandler };
// Spezifische Routen VOR parametrische Routen
postRouter.get('/most-read', globalLimiter, csrfProtection, async (req, res) => {
  const requestId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  logger.debug(`[${requestId}] GET /most-read: Request received ${req.originalUrl} accept=${req.get('Accept')} xreq=${req.get('X-Requested-With')} host=${req.get('Host')}`);
  try {
    const cacheKey = 'posts:mostRead';
    let posts = simpleCache.get(cacheKey);
    if (posts) {
      logger.debug(`[${requestId}] GET /most-read: Cache hit for ${cacheKey}, returning cached posts_count=${Array.isArray(posts) ? posts.length : 'unknown'}`);
    } else {
      logger.debug(`[${requestId}] GET /most-read: Cache miss for ${cacheKey} - loading from controller`);
      try {
        posts = await postController.getMostReadPosts();
      } catch (ctlErr) {
        // If the controller threw because there were no valid published posts,
        // try a direct, efficient DB query that selects the top published
        // posts ordered by views. This avoids loading the entire posts set.
        if (ctlErr instanceof PostControllerException) {
          logger.debug(`[${requestId}] GET /most-read: Controller threw PostControllerException - attempting direct DB fallback query`);
          try {
            const dbModule = await import('../databases/mariaDB.js');
            let conn;
            try {
              conn = await dbModule.getDatabasePool().getConnection();
              const rows = await conn.query('SELECT id, slug, title, content, views, created_at FROM posts WHERE published = 1 ORDER BY views DESC LIMIT 5');
              posts = Array.isArray(rows) ? rows.map(p => convertBigInts(p)) : [];
              logger.debug(`[${requestId}] GET /most-read: Direct DB fallback returned ${Array.isArray(posts) ? posts.length : 'null'} rows`);
            } finally {
              if (conn && typeof conn.release === 'function') conn.release();
            }
          } catch (_fallbackErr) {
            // fallback failed - leave posts as empty array and allow outer logic
            posts = [];
          }
        } else {
          // Non-controller errors should bubble out to be handled by outer try/catch
          throw ctlErr;
        }
      }

      // Cache most-read for a short period to keep results relatively fresh while
      // avoiding DB pressure from many concurrent visitors. TTL: 60 seconds.
      simpleCache.set(cacheKey, posts, 60 * 1000);
      logger.debug(`[${requestId}] GET /most-read: Cached ${cacheKey} posts_count=${Array.isArray(posts) ? posts.length : 'unknown'} ttl_ms=${60 * 1000}`);
    }
    const response = convertBigInts(posts) || posts;

    // Render HTML view for browsers (SSR-only)
    try {
      const safePosts = withExcerpts(Array.isArray(response) ? response.map(p => escapeAllStrings(p, ['content', 'description'])) : response);
      const isAdmin = getSsrAdmin(res);
      const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
      applySsrNoCache(res, { varyCookie: true });
      return res.render('mostReadPosts', { posts: safePosts, isAdmin, csrfToken });
    } catch (_e) {
      const isAdmin = getSsrAdmin(res);
      const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
      applySsrNoCache(res, { varyCookie: true });
      return res.render('mostReadPosts', { posts: withExcerpts(response), isAdmin, csrfToken });
    }
  } catch (error) {
    console.error('Error loading most read blog posts', error);
    // If the controller indicates there are simply no valid published posts,
    // log at WARN level to avoid noisy error logs. For other errors, keep ERROR.
    if (error instanceof PostControllerException) {
      logger.warn(`[${requestId}] GET /most-read route: ${error && error.message ? error.message : String(error)}`);
    } else {
      logger.error(`[${requestId}] GET /most-read route error: ${error && error.message ? error.message : String(error)}`);
    }
    // If the client expects HTML (regular browser navigation), render the
    // `mostReadPosts` view with a friendly message. For API/JS clients, return
    // JSON. When there are simply no most-read posts (PostControllerException),
    // return an empty array with 200 for API/XHR clients so the frontend can
    // gracefully fall back instead of logging noisy 404s.
    const message = (error instanceof PostControllerException)
      ? 'No most-read blog posts found'
      : 'Server error while loading most-read blog posts';
    // Render a friendly page for browsers. When there are simply no most-read
    // posts, return 200 so the browser doesn't treat the page as a missing
    // resource. Server errors still return 500.
    const isAdmin = getSsrAdmin(res);
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    applySsrNoCache(res, { varyCookie: true });
    return res.status(error instanceof PostControllerException ? 200 : 500).render('mostReadPosts', { posts: null, errorMessage: message, isAdmin, csrfToken });
  }
});
// Admin-only endpoint to clear the most-read cache
postRouter.post('/admin/cache/clear-most-read', globalLimiter, csrfProtection, authenticateToken, requireAdmin, async (req, res) => {
  try {
    simpleCache.del('posts:mostRead');
    // Return 204 No Content to avoid exposing payload
    return res.status(204).end();
  } catch (error) {
    console.error('Error clearing most-read cache:', error);
    return res.status(500).json({ error: 'Failed to clear cache' });
  }
});
// Numeric ID route should come BEFORE the slug route to avoid numeric slugs being
// misinterpreted as human-readable slugs. Example: /blogpost/59 -> id route.
postRouter.get('/id/:postId', 
  globalLimiter, 
  csrfProtection,
  validateId,
  async (req, res) => {
    const postId = req.params.postId;
    try {
      const post = await postController.getPostById(postId);
      const categories = await categoryController.getAllCategories();
      // Only increment views if we got a valid post object
      if (post && post.id) {
        incrementViews(req, post.id);
      }
      const safe = convertBigInts(post) || post;
      try {
        const sanitized = escapeAllStrings(safe, ['content', 'description']);
        // viewData aus `safe` bauen: pageTitle/metaDescription werden von EJS
        // selbst escaped, sonst käme es zu doppeltem Escaping im <title>.
        const viewData = await buildReadPostViewData(req, res, safe, categories);
        // Prevent caching of personalized HTML (admin vs non-admin)
        applySsrNoCache(res, { varyCookie: true });
        return res.render('readPost', { post: sanitized, ...viewData });
      } catch (_e) {
        const viewData = await buildReadPostViewData(req, res, safe, categories);
        applySsrNoCache(res, { varyCookie: true });
        return res.render('readPost', { post: safe, ...viewData });
      }
    } catch (error) {
      console.error('Error loading the blog post by id', error);
      if (error instanceof PostControllerException) {
        // Render hübsche Fehlerseite für HTML-Anfragen
        const isAdmin = getSsrAdmin(res);
        const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
        applySsrNoCache(res, { varyCookie: true });
        return res.status(404).render('notFound', { isAdmin, csrfToken });
      }
      // Render generische Fehlerseite für HTML-Anfragen
      const isAdmin = getSsrAdmin(res);
      const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
      applySsrNoCache(res, { varyCookie: true });
      return res.status(500).render('error', { message: 'Serverfehler beim Laden des Blogposts', isAdmin, csrfToken });
    }
  });

// Support shorthand numeric URL: /blogpost/59
// This route must be declared BEFORE the slug route so numeric paths are
// interpreted as IDs and not validated as slugs.
postRouter.get('/:maybeId',
  globalLimiter,
  csrfProtection,
  async (req, res, next) => {
    const maybe = req.params.maybeId;
    // If this is not numeric, pass to the slug route by calling next()
    if (!/^[0-9]+$/.test(maybe)) {
      return next();
    }
    const postId = maybe;
    try {
      const post = await postController.getPostById(postId);
      const categories = await categoryController.getAllCategories();
      if (post && post.id) incrementViews(req, post.id);
      const safe = convertBigInts(post) || post;
      try {
        const sanitized = escapeAllStrings(safe, ['content', 'description']);
        // viewData aus `safe` bauen (siehe Kommentar in der /id/:postId-Route)
        const viewData = await buildReadPostViewData(req, res, safe, categories);
        applySsrNoCache(res, { varyCookie: true });
        return res.render('readPost', { post: sanitized, ...viewData });
      } catch (_e) {
        const viewData = await buildReadPostViewData(req, res, safe, categories);
        applySsrNoCache(res, { varyCookie: true });
        return res.render('readPost', { post: safe, ...viewData });
      }
    } catch (error) {
      console.error('Error loading the blog post by numeric id', error);
      if (error instanceof PostControllerException) {
        const isAdmin = getSsrAdmin(res);
        const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
        applySsrNoCache(res, { varyCookie: true });
        return res.status(404).render('notFound', { isAdmin, csrfToken });
      }
      const isAdmin = getSsrAdmin(res);
      const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
      applySsrNoCache(res, { varyCookie: true });
      return res.status(500).render('error', { message: 'Serverfehler beim Laden des Blogposts', isAdmin, csrfToken });
    }
  });

// Explicit archive route must come BEFORE the slug route so '/archive' is not
// interpreted as a slug. Register it here (after numeric id handler).
postRouter.get('/archive', globalLimiter, csrfProtection, async (req, res) => {
  try {
    const yearParam = req.query && req.query.year ? String(req.query.year).trim() : null;
    const year = yearParam ? Number(yearParam) : undefined;
    const page = parsePage(req);

    const [{ posts, total }, archiveYears] = await Promise.all([
      getArchivedPostsPaginated(year, page),
      (async () => {
        const yearsCacheKey = 'posts:archive:years';
        let years = simpleCache.get(yearsCacheKey);
        if (!years) {
          try {
            years = await postController.getArchivedYears();
            simpleCache.set(yearsCacheKey, years, 60 * 60 * 1000);
          } catch (_e) { years = []; }
        }
        return years;
      })(),
    ]);

    if (isPageOutOfRange(page, total)) {
      return renderPaginationNotFound(req, res);
    }

    if (yearParam && total === 0) {
      const isAdmin = getSsrAdmin(res);
      const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
      applySsrNoCache(res, { varyCookie: true });
      return res.status(404).render('archiv', { posts: [], archiveYears, isAdmin, csrfToken, pagination: null });
    }

    const response = convertBigInts(posts) || posts;
    const safeResponse = Array.isArray(response) ? response.map(p => escapeAllStrings(p, ['content', 'description'])) : response;
    const isAdmin = getSsrAdmin(res);
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    const extraParams = yearParam ? `&year=${yearParam}` : '';
    const pagination = buildPagination(page, total, '/blogpost/archive', extraParams);
    applySsrNoCache(res, { varyCookie: true });
    return res.render('archiv', { posts: withExcerpts(safeResponse), archiveYears, isAdmin, csrfToken, pagination });
  } catch (error) {
    console.error('Error loading archived blog posts', error);
    const isAdmin = getSsrAdmin(res);
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    applySsrNoCache(res, { varyCookie: true });
    res.status(500).render('error', { message: 'Serverfehler beim Laden des Archivs', isAdmin, csrfToken });
  }
});

// Slug-based route (human readable) - validated via validateSlug
postRouter.get('/:slug', 
  globalLimiter, 
  csrfProtection,
  validateSlug,
  async (req, res) => {
    const slug = req.params.slug;
    try {
      const post = await postController.getPostBySlug(slug);
      const categories = await categoryController.getAllCategories();
      if (post && post.id) incrementViews(req, post.id);
      const safe = convertBigInts(post) || post;
      const viewData = await buildReadPostViewData(req, res, safe, categories);
      applySsrNoCache(res, { varyCookie: true });
      return res.render('readPost', { post: safe, ...viewData });
    } catch (error) {
      console.error('Error loading the blog post by slug', error);
      if (error instanceof PostControllerException) {
        // Render hübsche Fehlerseite für HTML-Anfragen
        const isAdmin = getSsrAdmin(res);
        const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
        applySsrNoCache(res, { varyCookie: true });
        return res.status(404).render('notFound', { isAdmin, csrfToken });
      }
      // Render generische Fehlerseite für HTML-Anfragen
      const isAdmin = getSsrAdmin(res);
      const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
      applySsrNoCache(res, { varyCookie: true });
      return res.status(500).render('error', { message: 'Serverfehler beim Laden des Blogposts', isAdmin, csrfToken });
    }
  });
postRouter.post('/create', 
  strictLimiter,
  csrfProtection,
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const { title, content } = req.body || {};
    const tags = parseTags(req.body && req.body.tags);
    const slug = createSlug(title);
    try {
      const result = await postController.createPost({ title, slug, content, tags, author: req.user.full_name, category_id: req.body.category_id });
      if (!result) {
        return res.redirect(303, '/createPost?error=1');
      }
      const postId = Number(result.postId || result.id);
      res.redirect(303, `/blogpost/id/${postId}`);
      // Invalidate cached lists
      try {
        simpleCache.del('posts:all');
        simpleCache.del('posts:mostRead');
        simpleCache.del('posts:archive');
        // Also clear year-specific archive caches
        const currentYear = new Date().getFullYear();
        for (let year = 2020; year <= currentYear + 1; year++) {
          simpleCache.del(`posts:archive:${year}`);
        }
        const _id = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        logger.debug(`[${_id}] POST /create: invalidated caches posts:all, posts:mostRead, posts:archive, and year archives`);
      } catch (e) { void e; }
    } catch (error) {
      console.error('Error creating new blog post', error);
      res.redirect(303, '/createPost?error=1');
    }
  });
postRouter.post('/update/:postId',
  strictLimiter,
  csrfProtection,
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const postId = req.params.postId;
    const source = req.body || {};
    const title = source.title;
    const content = source.content;
    const updated_at = new Date();
    const tags = Array.isArray(source.tags) ? source.tags : parseTags(source.tags);
    const category_id = source.category_id ? Number(source.category_id) : 7;
    const published = source.published === 'on' || source.published === 'true' || source.published === true;
    try {
      const result = await postController.updatePost({ id: postId, title, content, tags, updated_at, category_id, published });
      if (!result) {
        return res.redirect(303, `/blogpost/update/${postId}?error=1`);
      }
      const finalId = Number(result.id ?? postId);
      res.redirect(303, `/blogpost/id/${finalId}`);
      try {
        simpleCache.del('posts:all');
        simpleCache.del('posts:mostRead');
        simpleCache.del('posts:archive');
        // Also clear year-specific archive caches
        const currentYear = new Date().getFullYear();
        for (let year = 2020; year <= currentYear + 1; year++) {
          simpleCache.del(`posts:archive:${year}`);
        }
        const _id = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        logger.debug(`[${_id}] PUT /update: invalidated caches posts:all, posts:mostRead, posts:archive, and year archives`);
      } catch (e) { void e; }
    } catch (error) {
      console.error('Error updating blog post', error);
      res.redirect(303, `/blogpost/update/${postId}?error=1`);
    }
  });
postRouter.post('/delete/:postId',
  strictLimiter,
  csrfProtection,
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    logger.debug('DELETE /delete: Route reached');
    const postId = req.params.postId;
    logger.debug('DELETE /delete: req.params: ' + JSON.stringify(req.params));
    logger.debug('DELETE /delete: Attempting to delete post ' + postId);
    logger.debug('DELETE /delete: postId type: ' + typeof postId + ', value: ' + postId);

    const referer = req.headers.referer || '';
    let returnTo = '/';
    try {
      const refUrl = new URL(referer);
      if (refUrl.hostname === req.hostname) {
        returnTo = refUrl.pathname;
      }
    } catch { /* invalid URL, use default */ }

    const wantsJson = req.headers.accept && req.headers.accept.includes('application/json');

    if (validationService.isValidIdSchema(postId) === false) {
      logger.debug('DELETE /delete: Invalid postId ' + postId);
      if (wantsJson) return res.status(400).json({ error: 'Ungültige Post-ID' });
      return res.redirect(303, returnTo);
    }
    logger.debug('DELETE /delete: postId valid, proceeding to delete');
    try {
      logger.debug('DELETE /delete: Calling postController.deletePost for ' + postId);
      const result = await postController.deletePost(postId);
      logger.debug('DELETE /delete: postController.deletePost returned ' + JSON.stringify(result));
      if (!result) {
        if (wantsJson) return res.status(404).json({ error: 'Post nicht gefunden oder konnte nicht gelöscht werden' });
        return res.redirect(303, returnTo);
      }
      try {
        simpleCache.del('posts:all');
        simpleCache.del('posts:mostRead');
        simpleCache.del('posts:archive');
        // Also clear year-specific archive caches
        const currentYear = new Date().getFullYear();
        for (let year = 2020; year <= currentYear + 1; year++) {
          simpleCache.del(`posts:archive:${year}`);
        }
        const _id = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        logger.debug('[' + _id + '] DELETE /delete: invalidated caches posts:all, posts:mostRead, posts:archive, and year archives');
      } catch (e) { void e; }
      if (wantsJson) return res.json({ success: true, returnTo });
      res.redirect(303, returnTo);
    } catch (error) {
      logger.error('Error deleting blog post', error);
      if (wantsJson) return res.status(500).json({ error: 'Interner Fehler beim Löschen' });
      res.redirect(303, returnTo);
    }
  });

export default postRouter;
