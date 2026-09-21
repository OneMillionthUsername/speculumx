import express from 'express';
import crypto from 'crypto';
import postController from '../controllers/postController.js';
import { PostControllerException } from '../models/customExceptions.js';
import { convertBigInts, parseTags, createSlug } from '../utils/utils.js';
import simpleCache from '../utils/simpleCache.js';
import { requireJsonContent } from '../middleware/securityMiddleware.js';
import csrfProtection from '../utils/csrf.js';
import { globalLimiter, strictLimiter } from '../utils/limiters.js';
import validationService from '../services/validationService.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import { validateId, validatePostBody, validateSlug } from '../middleware/validationMiddleware.js';
import logger from '../utils/logger.js';

/**
 * JSON-only API routes for blog posts.
 */
const postApiRouter = express.Router();

postApiRouter.get('/all', globalLimiter, async (req, res) => {
  const requestId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  try {
    const cacheKey = 'posts:all';
    let posts = simpleCache.get(cacheKey);
    let _controllerDuration = null;
    if (!posts) {
      const controllerStartTime = Date.now();
      posts = await postController.getAllPosts();
      const controllerEndTime = Date.now();
      _controllerDuration = controllerEndTime - controllerStartTime;
      simpleCache.set(cacheKey, posts, 60 * 1000);
    } else {
      _controllerDuration = 'cache';
    }

    const response = convertBigInts(posts) || [];

    try {
      let etag;
      try {
        const checksum = typeof postController.getPostsChecksum === 'function' ? await postController.getPostsChecksum() : null;
        if (checksum) {
          etag = `"${checksum}"`;
        }
      } catch (_innerErr) {
        // ignore
      }

      if (!etag) {
        const bodyString = JSON.stringify(response);
        const hash = crypto.createHash('sha1').update(bodyString).digest('hex');
        etag = `"${hash}"`;
      }

      const incoming = req.get('If-None-Match');
      if (incoming && incoming === etag) {
        res.status(304).set('ETag', etag).end();
        return;
      }

      res.set('ETag', etag);
      res.set('Cache-Control', 'private, max-age=30, must-revalidate');
      return res.json(response);
    } catch (err) {
      logger.error(`[${requestId}] GET /api/blogpost/all: Error computing ETag: ${err.message}`);
      return res.json(response);
    }
  } catch (error) {
    logger.error(`[${requestId}] GET /api/blogpost/all route error: ${error.message}`);
    return res.status(500).json({ error: 'Server failed to load blog posts' });
  }
});

postApiRouter.get('/most-read', globalLimiter, async (req, res) => {
  const requestId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  try {
    const cacheKey = 'posts:mostRead';
    let posts = simpleCache.get(cacheKey);
    if (!posts) {
      try {
        posts = await postController.getMostReadPosts();
      } catch (ctlErr) {
        if (ctlErr instanceof PostControllerException) {
          try {
            const dbModule = await import('../databases/mariaDB.js');
            let conn;
            try {
              conn = await dbModule.getDatabasePool().getConnection();
              const rows = await conn.query('SELECT id, slug, title, content, views, created_at FROM posts WHERE published = 1 ORDER BY views DESC LIMIT 5');
              posts = Array.isArray(rows) ? rows.map(p => convertBigInts(p)) : [];
            } finally {
              if (conn && typeof conn.release === 'function') conn.release();
            }
          } catch (_fallbackErr) {
            posts = [];
          }
        } else {
          throw ctlErr;
        }
      }
      simpleCache.set(cacheKey, posts, 60 * 1000);
    }
    const response = convertBigInts(posts) || posts;
    return res.json(response);
  } catch (error) {
    if (error instanceof PostControllerException) {
      return res.status(200).json([]);
    }
    logger.error(`[${requestId}] GET /api/blogpost/most-read route error: ${error && error.message ? error.message : String(error)}`);
    return res.status(500).json({ error: 'Server failed to load most read blog posts' });
  }
});

postApiRouter.post('/admin/cache/clear-most-read', globalLimiter, csrfProtection, authenticateToken, requireAdmin, async (req, res) => {
  try {
    simpleCache.del('posts:mostRead');
    return res.status(204).end();
  } catch (error) {
    console.error('Error clearing most-read cache:', error);
    return res.status(500).json({ error: 'Failed to clear cache' });
  }
});

postApiRouter.get('/id/:postId', globalLimiter, validateId, async (req, res) => {
  const postId = req.params.postId;
  try {
    const post = await postController.getPostById(postId);
    return res.json(convertBigInts(post) || post);
  } catch (error) {
    console.error('Error loading the blog post by id (api):', error);
    if (error instanceof PostControllerException) return res.status(404).json({ error: 'Blogpost not found' });
    return res.status(500).json({ error: 'Server failed to load the blogpost' });
  }
});

// Admin-only: fetch a post by id regardless of published status, for the edit-form prefill.
// Unlike /id/:postId (public, published-only), this also returns drafts.
postApiRouter.get('/edit/:postId', globalLimiter, validateId, authenticateToken, requireAdmin, async (req, res) => {
  const postId = req.params.postId;
  try {
    const post = await postController.getPostByIdForEdit(postId);
    return res.json(convertBigInts(post) || post);
  } catch (error) {
    console.error('Error loading the blog post by id for edit (api):', error);
    if (error instanceof PostControllerException) return res.status(404).json({ error: 'Blogpost not found' });
    return res.status(500).json({ error: 'Server failed to load the blogpost' });
  }
});

postApiRouter.get('/archive', globalLimiter, async (req, res) => {
  try {
    const yearParam = req.query && req.query.year ? String(req.query.year).trim() : null;
    const cacheKey = yearParam ? `posts:archive:${yearParam}` : 'posts:archive';
    let posts = simpleCache.get(cacheKey);
    if (!posts) {
      const year = yearParam ? Number(yearParam) : undefined;
      posts = await postController.getArchivedPosts(year);
      simpleCache.set(cacheKey, posts);
    }
    const yearsCacheKey = 'posts:archive:years';
    let archiveYears = simpleCache.get(yearsCacheKey);
    if (!archiveYears) {
      try {
        archiveYears = await postController.getArchivedYears();
        simpleCache.set(yearsCacheKey, archiveYears, 60 * 60 * 1000);
      } catch (_e) {
        archiveYears = [];
      }
    }
    const result = convertBigInts(posts) || posts;
    if (yearParam && (!result || result.length === 0)) {
      return res.status(404).json({ posts: [], archiveYears, error: 'No posts found for the requested year' });
    }
    return res.json({ posts: result, archiveYears });
  } catch (error) {
    console.error('Error loading archived blog posts (api)', error);
    return res.status(500).json({ error: 'Server failed to load archived blog posts' });
  }
});

postApiRouter.get('/:slug', globalLimiter, validateSlug, async (req, res) => {
  const slug = req.params.slug;
  try {
    const post = await postController.getPostBySlug(slug);
    return res.json(convertBigInts(post) || post);
  } catch (error) {
    console.error('Error loading the blog post by slug (api):', error);
    if (error instanceof PostControllerException) return res.status(404).json({ error: 'Blogpost not found' });
    return res.status(500).json({ error: 'Server failed to load the blogpost' });
  }
});

postApiRouter.post('/create',
  strictLimiter,
  csrfProtection,
  requireJsonContent,
  authenticateToken,
  requireAdmin,
  validatePostBody,
  async (req, res) => {
    const { title, content } = req.body;
    const tags = Array.isArray(req.body.tags) ? req.body.tags : parseTags(req.body.tags);
    const slug = createSlug(title);
    try {
      const result = await postController.createPost({ title, slug, content, tags, author: req.user.full_name, category_id: req.body.category_id });
      if (!result) {
        return res.status(400).json({ error: 'Failed to create blog post' });
      }
      res.status(201).json({ message: 'Blog post created successfully', postId: Number(result.postId), title: result.title });
      try {
        simpleCache.del('posts:all');
        simpleCache.del('posts:mostRead');
        simpleCache.del('posts:archive');
        const currentYear = new Date().getFullYear();
        for (let year = 2020; year <= currentYear + 1; year++) {
          simpleCache.del(`posts:archive:${year}`);
        }
        const _id = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        logger.debug(`[${_id}] POST /api/blogpost/create: invalidated caches posts:all, posts:mostRead, posts:archive, and year archives`);
      } catch (e) { void e; }
    } catch (error) {
      console.error('Error creating new blog post', error);
      res.status(500).json({ error: 'Server failed to create the blogpost' });
    }
  });

//TODO: Author Name wird nicht upgedated.
postApiRouter.put('/update/:postId',
  strictLimiter,
  csrfProtection,
  requireJsonContent,
  authenticateToken,
  requireAdmin,
  validateId,
  validatePostBody,
  async (req, res) => {
    const postId = req.params.postId;
    const source = req.validatedPost || req.body || {};
    const title = source.title;
    const content = source.content;
    const tags = Array.isArray(source.tags) ? source.tags : parseTags(source.tags);
    const category_id = source.category_id;
    const published = typeof source.published === 'boolean' ? source.published : source.published === 'true';
    try {
      const result = await postController.updatePost({ id: postId, title, content, tags, category_id, published });
      if (!result) {
        return res.status(400).json({ error: 'Failed to update blog post' });
      }
      res.status(200).json({ message: 'Blog post updated successfully', postId: Number(result.id ?? postId), title: result.title });
      try {
        simpleCache.del('posts:all');
        simpleCache.del('posts:mostRead');
        simpleCache.del('posts:archive');
        const currentYear = new Date().getFullYear();
        for (let year = 2020; year <= currentYear + 1; year++) {
          simpleCache.del(`posts:archive:${year}`);
        }
        const _id = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        logger.debug(`[${_id}] PUT /api/blogpost/update: invalidated caches posts:all, posts:mostRead, posts:archive, and year archives`);
      } catch (e) { void e; }
    } catch (error) {
      console.error('Error updating blog post', error);
      res.status(500).json({ error: 'Server failed to update the blogpost' });
    }
  });

postApiRouter.delete('/delete/:postId',
  strictLimiter,
  csrfProtection,
  authenticateToken,
  requireAdmin,
  validateId,
  async (req, res) => {
    const postId = req.params.postId;
    if (validationService.isValidIdSchema(postId) === false) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }
    try {
      const result = await postController.deletePost(postId);
      if (!result) {
        return res.status(400).json({ error: 'Failed to delete blog post' });
      }
      res.status(200).json({ message: 'Blog post deleted successfully', postId: Number(postId) });
      try {
        simpleCache.del('posts:all');
        simpleCache.del('posts:mostRead');
        simpleCache.del('posts:archive');
        const currentYear = new Date().getFullYear();
        for (let year = 2020; year <= currentYear + 1; year++) {
          simpleCache.del(`posts:archive:${year}`);
        }
        const _id = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        logger.debug('[' + _id + '] DELETE /api/blogpost/delete: invalidated caches posts:all, posts:mostRead, posts:archive, and year archives');
      } catch (e) { void e; }
    } catch (error) {
      logger.error('Error deleting blog post', error);
      res.status(500).json({ error: 'Server failed to delete the blogpost' });
    }
  });

export default postApiRouter;
