import express from 'express';
import cardController from '../controllers/cardController.js';
import { strictLimiter } from '../utils/limiters.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import { celebrate, Joi, Segments } from 'celebrate';
import csrfProtection from '../utils/csrf.js';
import logger from '../utils/logger.js';
import { applySsrNoCache, getSsrAdmin } from '../utils/utils.js';

/**
 * Routes for Cards (small discoverable items shown on the site).
 *
 * - `GET /create` renders the card creation form (admin only)
 * - `POST /create` creates a card via HTML form (admin only)
 * - `POST /:id/delete` deletes a card (admin only)
 */
const cardRouter = express.Router();

// GET /cards/manage - Alle Cards verwalten (Admin only)
cardRouter.get('/manage',
  strictLimiter,
  authenticateToken,
  requireAdmin,
  csrfProtection,
  async (req, res) => {
    const isAdmin = getSsrAdmin(res);
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    try {
      const cards = await cardController.getAllCardsAdmin();
      applySsrNoCache(res, { varyCookie: true });
      return res.render('adminCards', { isAdmin, csrfToken, cards });
    } catch (err) {
      logger.error('Error loading admin cards list:', err);
      applySsrNoCache(res, { varyCookie: true });
      return res.status(500).render('error', { message: 'Serverfehler beim Laden der Cards', isAdmin, csrfToken });
    }
  },
);

// GET /cards/create - Card erstellen (Admin only)
cardRouter.get('/create',
  strictLimiter,
  authenticateToken,
  requireAdmin,
  csrfProtection,
  (req, res) => {
    const isAdmin = getSsrAdmin(res);
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    const error = req.query && req.query.error ? '1' : null;
    applySsrNoCache(res, { varyCookie: true });
    return res.render('cardCreate', { isAdmin, csrfToken, error });
  },
);

// POST /cards/create - Neue Card erstellen (Admin only)
cardRouter.post('/create',
  strictLimiter,
  csrfProtection,
  celebrate({
    [Segments.BODY]: Joi.object({
      title: Joi.string().min(1).max(255).required(),
      subtitle: Joi.string().max(500).allow('', null),
      link: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
      img_link: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
      published: Joi.any().optional(),
    }).options({ allowUnknown: true }), // allowUnknown, da wir evtl. zusätzliche Felder wie _csrf haben
  }),
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const published = req.body.published === 'on' || req.body.published === true;
      await cardController.createCard({ ...req.body, published });
      return res.redirect(303, '/');
    } catch (error) {
      logger.error('Error creating card (SSR):', error);
      return res.redirect(303, '/cards/create?error=1');
    }
  },
);

// GET /cards/:id/edit - Card bearbeiten (Admin only)
cardRouter.get('/:id/edit',
  strictLimiter,
  authenticateToken,
  requireAdmin,
  csrfProtection,
  celebrate({
    [Segments.PARAMS]: Joi.object({
      id: Joi.number().integer().min(1).required(),
    }),
  }),
  async (req, res) => {
    const cardId = parseInt(req.params.id);
    const isAdmin = getSsrAdmin(res);
    const csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    const error = req.query && req.query.error ? '1' : null;
    try {
      const card = await cardController.getCardById(cardId);
      applySsrNoCache(res, { varyCookie: true });
      return res.render('cardCreate', { isAdmin, csrfToken, card, formAction: `/cards/${cardId}/update`, error });
    } catch (err) {
      logger.error('Error loading card for edit:', err);
      return res.redirect(303, '/?cardEditError=1');
    }
  },
);

// POST /cards/:id/update - Card aktualisieren (Admin only)
cardRouter.post('/:id/update',
  strictLimiter,
  csrfProtection,
  celebrate({
    [Segments.PARAMS]: Joi.object({
      id: Joi.number().integer().min(1).required(),
    }),
    [Segments.BODY]: Joi.object({
      title: Joi.string().min(1).max(255).required(),
      subtitle: Joi.string().max(500).allow('', null),
      link: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
      img_link: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
      published: Joi.boolean().truthy('on').optional(),
    }).options({ allowUnknown: true }),
  }),
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const cardId = parseInt(req.params.id);
    try {
      const published = req.body.published === 'on' || req.body.published === true;
      await cardController.updateCard(cardId, { ...req.body, published });
      return res.redirect(303, '/');
    } catch (err) {
      logger.error('Error updating card (SSR):', err);
      return res.redirect(303, `/cards/${cardId}/edit?error=1`);
    }
  },
);

// POST /cards/:id/delete - Card löschen (Admin only)
cardRouter.post('/:id/delete',
  strictLimiter,
  csrfProtection,
  celebrate({
    [Segments.PARAMS]: Joi.object({
      id: Joi.number().integer().min(1).required(),
    }),
  }),
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const cardId = parseInt(req.params.id);
    const wantsJson = req.headers.accept && req.headers.accept.includes('application/json');

    const referer = req.headers.referer || '';
    let returnTo = '/cards/manage';
    try {
      const refUrl = new URL(referer);
      if (refUrl.hostname === req.hostname) {
        returnTo = refUrl.pathname;
      }
    } catch { /* invalid URL, use default */ }

    try {
      await cardController.deleteCard(cardId);
      if (wantsJson) return res.json({ success: true, returnTo });
      return res.redirect(303, returnTo);
    } catch (error) {
      logger.error('Error deleting card (SSR):', error);
      if (wantsJson) return res.status(500).json({ error: 'Fehler beim Löschen der Card' });
      return res.redirect(303, returnTo);
    }
  },
);

export default cardRouter;
