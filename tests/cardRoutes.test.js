/** @jest-environment node */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';

// Saving, deleting or failing to open a card leads back to the card list (/cards/manage), not to the home page.

const cardController = {
  createCard: jest.fn(),
  updateCard: jest.fn(),
  deleteCard: jest.fn(),
  getCardById: jest.fn(),
};
const passThrough = (req, res, next) => next();

jest.unstable_mockModule('../controllers/cardController.js', () => ({ default: cardController }));
jest.unstable_mockModule('../databases/mariaDB.js', () => ({ DatabaseService: {} }));
jest.unstable_mockModule('../utils/csrf.js', () => ({ default: passThrough }));
jest.unstable_mockModule('../utils/limiters.js', () => ({ strictLimiter: passThrough }));
jest.unstable_mockModule('../middleware/authMiddleware.js', () => ({ authenticateToken: passThrough, requireAdmin: passThrough }));
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { default: cardRouter } = await import('../routes/cardRoutes.js');
const request = (await import('supertest')).default;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use('/cards', cardRouter);

const card = { title: 'Titel', link: 'https://example.org/a', img_link: '/assets/img/card-default.webp' };

describe('card routes return to the card list', () => {
  beforeEach(() => {
    Object.values(cardController).forEach(fn => fn.mockReset());
  });

  it('after an edit, scrolled to the edited card', async () => {
    cardController.updateCard.mockResolvedValue({ id: 5 });
    const res = await request(app).post('/cards/5/update').type('form').send({ ...card, published: 'on' }).expect(303);
    expect(res.headers.location).toBe('/cards/manage#card-5');
    expect(cardController.updateCard).toHaveBeenCalledWith(5, expect.objectContaining({ title: 'Titel', published: true }));
  });

  it('after creating a card', async () => {
    cardController.createCard.mockResolvedValue({ id: 6 });
    const res = await request(app).post('/cards/create').type('form').send(card).expect(303);
    expect(res.headers.location).toBe('/cards/manage');
  });

  it('after deleting, not to the edit page of the deleted card', async () => {
    cardController.deleteCard.mockResolvedValue(true);
    const res = await request(app).post('/cards/5/delete').set('Referer', 'http://localhost/cards/5/edit').expect(303);
    expect(res.headers.location).toBe('/cards/manage');

    const json = await request(app).post('/cards/5/delete').set('Accept', 'application/json').set('Referer', 'http://localhost/cards/5/edit').expect(200);
    expect(json.body).toEqual({ success: true, returnTo: '/cards/manage' });
  });

  it('when the card to edit cannot be loaded', async () => {
    cardController.getCardById.mockRejectedValue(new Error('Card not found'));
    const res = await request(app).get('/cards/99/edit').expect(303);
    expect(res.headers.location).toBe('/cards/manage');
  });
});
