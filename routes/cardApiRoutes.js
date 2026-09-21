import express from 'express';
import cardController from '../controllers/cardController.js';
import { requireJsonContent } from '../middleware/securityMiddleware.js';
import { globalLimiter, strictLimiter } from '../utils/limiters.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import { celebrate, Joi, Segments } from 'celebrate';
import csrfProtection from '../utils/csrf.js';
import logger from '../utils/logger.js';

/**
 * JSON-only API routes for cards.
 */
const cardApiRouter = express.Router();

cardApiRouter.get('/', globalLimiter, async (req, res) => {
  const requestId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  logger.debug(`[${requestId}] GET /api/cards: Request received from ${req.ip}`);
  try {
    const cards = await cardController.getAllCards();
    res.json(cards);
  } catch (error) {
    logger.error(`[${requestId}] GET /api/cards: Error occurred`, error);
    res.status(500).json({ error: 'Server failed to load cards' });
  }
});

cardApiRouter.get('/:id',
  globalLimiter,
  celebrate({
    [Segments.PARAMS]: Joi.object({
      id: Joi.number().integer().min(1).required(),
    }),
  }),
  async (req, res) => {
    const cardId = parseInt(req.params.id);
    const requestId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    try {
      const card = await cardController.getCardById(cardId);
      res.json(card);
    } catch (error) {
      logger.error(`[${requestId}] GET /api/cards/${cardId}: Error occurred`, error);
      res.status(500).json({ error: 'Server failed to load card' });
    }
  },
);

cardApiRouter.post('/',
  strictLimiter,
  csrfProtection,
  requireJsonContent,
  celebrate({
    [Segments.BODY]: Joi.object({
      title: Joi.string().min(1).max(255).required(),
      subtitle: Joi.string().max(500).allow('', null),
      link: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
      img_link: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
    }),
  }),
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const requestId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    try {
      const card = await cardController.createCard(req.body);
      res.status(201).json({
        success: true,
        message: 'Card created successfully',
        card: card,
      });
    } catch (error) {
      logger.error(`[${requestId}] POST /api/cards: Error occurred`, error);
      res.status(500).json({ error: 'Server failed to create card' });
    }
  },
);

cardApiRouter.put('/:id',
  strictLimiter,
  csrfProtection,
  requireJsonContent,
  celebrate({
    [Segments.PARAMS]: Joi.object({
      id: Joi.number().integer().min(1).required(),
    }),
    [Segments.BODY]: Joi.object({
      title: Joi.string().min(1).max(255).required(),
      subtitle: Joi.string().max(500).allow('', null),
      link: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
      img_link: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
      published: Joi.boolean().optional(),
    }),
  }),
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const cardId = parseInt(req.params.id);
    const requestId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    try {
      const card = await cardController.updateCard(cardId, req.body);
      res.json({ success: true, message: 'Card updated successfully', card });
    } catch (error) {
      logger.error(`[${requestId}] PUT /api/cards/${cardId}: Error occurred`, error);
      res.status(500).json({ error: 'Server failed to update card' });
    }
  },
);

cardApiRouter.delete('/:id',
  strictLimiter,
  csrfProtection,
  requireJsonContent,
  celebrate({
    [Segments.PARAMS]: Joi.object({
      id: Joi.number().integer().min(1).required(),
    }),
  }),
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const cardId = parseInt(req.params.id);
    const requestId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    try {
      await cardController.deleteCard(cardId);
      res.json({
        success: true,
        message: 'Card deleted successfully',
      });
    } catch (error) {
      logger.error(`[${requestId}] DELETE /api/cards/${cardId}: Error occurred`, error);
      res.status(500).json({ error: 'Server failed to delete card' });
    }
  },
);

export default cardApiRouter;
