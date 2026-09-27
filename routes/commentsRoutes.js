import express from 'express';
import { commentLimiter, strictLimiter } from '../utils/limiters.js';
import commentsController from '../controllers/commentController.js';
import { requireAdmin, authenticateToken } from '../middleware/authMiddleware.js';
import csrfProtection from '../utils/csrf.js';
import { celebrate, Joi, Segments } from 'celebrate';
import { getClientIp, getSafeRefererRedirect } from '../utils/requestUtils.js';

/**
 * Routes for managing comments on posts.
 *
 * - `POST /:postId` creates a new comment via HTML form (CSRF-protected).
 * - `POST /:postId/:commentId/delete` deletes a comment (admin only, HTML form).
 *
 * Validation and rate limiting are applied per-route. Controller errors
 * are expected to be thrown as exceptions and are handled by the route
 * level callers.
 */
const commentsRouter = express.Router();

function buildSafeRedirect(req, fallbackPath, status) {
  return getSafeRefererRedirect(req, fallbackPath, {
    query: status ? { comment: status } : {},
    hash: 'comments-section',
  });
}

commentsRouter.post('/:postId',
  commentLimiter,
  csrfProtection,
  celebrate({
    [Segments.PARAMS]: Joi.object({
      postId: Joi.number().integer().min(1).required(),
    }),
    [Segments.BODY]: Joi.object({
      username: Joi.string().max(50).allow('', null),
      text: Joi.string().min(1).max(1000).required(),
      _csrf: Joi.string().optional(),
      website: Joi.string().allow('', null).optional(),
      formLoadedAt: Joi.string().allow('', null).optional(),
    }),
  }),
  async (req, res) => {
    const minSubmitDelayMs = 3000;
    const honeypot = String(req.body?.website || '').trim();
    const formLoadedAtRaw = String(req.body?.formLoadedAt || '').trim();
    const formLoadedAt = Number(formLoadedAtRaw);
    const now = Date.now();
    const ip = getClientIp(req);

    if (honeypot) {
      // Silent fake-success for bots that fill the honeypot field
      const redirectTarget = buildSafeRedirect(req, `/blogpost/id/${req.params.postId}`, 'ok');
      return res.redirect(303, redirectTarget);
    }

    const isInvalidTimestamp = !Number.isFinite(formLoadedAt) || formLoadedAt <= 0 || formLoadedAt > now;
    const isTooFast = !isInvalidTimestamp && (now - formLoadedAt < minSubmitDelayMs);

    if (isInvalidTimestamp || isTooFast) {
      console.warn('[COMMENT] Bot timing check triggered', {
        ip,
        isInvalidTimestamp,
        elapsedMs: isInvalidTimestamp ? null : (now - formLoadedAt),
      });
      const redirectTarget = buildSafeRedirect(req, `/blogpost/id/${req.params.postId}`, 'error');
      return res.redirect(303, redirectTarget);
    }

    try {
      const postId = Number(req.params.postId);
      const created = await commentsController.createCommentRecord(postId, req.body);
      void commentsController.sendCommentNotification({ req, postId, comment: created?.comment });
      const redirectTarget = buildSafeRedirect(req, `/blogpost/id/${postId}`, 'ok');
      return res.redirect(303, redirectTarget);
    } catch (error) {
      console.error('Error creating comment (SSR):', error);
      const redirectTarget = buildSafeRedirect(req, `/blogpost/id/${req.params.postId}`, 'error');
      return res.redirect(303, redirectTarget);
    }
  },
);

commentsRouter.post('/:postId/:commentId/delete',
  strictLimiter,
  csrfProtection,
  celebrate({
    [Segments.PARAMS]: Joi.object({
      postId: Joi.number().integer().min(1).required(),
      commentId: Joi.number().integer().min(1).required(),
    }),
  }),
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const postId = Number(req.params.postId);
      const commentId = Number(req.params.commentId);
      await commentsController.deleteCommentRecord(postId, commentId);
      const redirectTarget = buildSafeRedirect(req, `/blogpost/id/${postId}`, 'deleted');
      return res.redirect(303, redirectTarget);
    } catch (error) {
      console.error('Error deleting comment (SSR):', error);
      const redirectTarget = buildSafeRedirect(req, `/blogpost/id/${req.params.postId}`, 'error');
      return res.redirect(303, redirectTarget);
    }
  },
);

export default commentsRouter;
