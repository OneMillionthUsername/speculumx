import express from 'express';
import { requireJsonContent } from '../middleware/securityMiddleware.js';
import { commentLimiter, globalLimiter, strictLimiter } from '../utils/limiters.js';
import commentsController from '../controllers/commentController.js';
import { requireAdmin, authenticateToken } from '../middleware/authMiddleware.js';
import csrfProtection from '../utils/csrf.js';
import { celebrate, Joi, Segments } from 'celebrate';

/**
 * JSON-only API routes for comments.
 *
 * Absolute Route: /api/comments
 *
 * - GET /api/comments/:postId        → Kommentare zu einem Post
 * - POST /api/comments/:postId       → Kommentar erstellen
 * - DELETE /api/comments/:postId/:commentId → Kommentar löschen (admin)
 */
const commentsApiRouter = express.Router();

commentsApiRouter.get('/:postId',
  globalLimiter,
  celebrate({
    [Segments.PARAMS]: Joi.object({
      postId: Joi.number().integer().min(1).required(),
    }),
  }),
  commentsController.getCommentsByPostId,
);

commentsApiRouter.post('/:postId',
  commentLimiter,
  csrfProtection,
  requireJsonContent,
  celebrate({
    [Segments.PARAMS]: Joi.object({
      postId: Joi.number().integer().min(1).required(),
    }),
    [Segments.BODY]: Joi.object({
      username: Joi.string().max(50).allow('', null),
      text: Joi.string().min(1).max(1000).required(),
    }),
  }),
  commentsController.createComment,
);

commentsApiRouter.delete('/:postId/:commentId',
  strictLimiter,
  csrfProtection,
  celebrate({
    [Segments.PARAMS]: Joi.object({
      postId: Joi.number().integer().min(1).required(),
      commentId: Joi.number().integer().min(1).required(),
    }),
  }),
  requireJsonContent,
  authenticateToken,
  requireAdmin,
  commentsController.deleteComment,
);

export default commentsApiRouter;
