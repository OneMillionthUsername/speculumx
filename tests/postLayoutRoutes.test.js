/** @jest-environment node */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';

// The editor form sends the reading layout with the post (select name="layout"); the SSR routes pass it on,
// normalised, and an update without the field keeps the stored layout.

const createPost = jest.fn();
const updatePost = jest.fn();
const passThrough = (req, res, next) => next();

jest.unstable_mockModule('../controllers/postController.js', () => ({
  default: { createPost, updatePost },
  getAllPostsPaginated: jest.fn(),
  getPostsByCategoryPaginated: jest.fn(),
  getPostsByTagPaginated: jest.fn(),
  getArchivedPostsPaginated: jest.fn(),
  PAGE_SIZE: 10,
}));
jest.unstable_mockModule('../controllers/commentController.js', () => ({ default: {} }));
jest.unstable_mockModule('../databases/mariaDB.js', () => ({ DatabaseService: {} }));
jest.unstable_mockModule('../utils/csrf.js', () => ({ default: passThrough }));
jest.unstable_mockModule('../utils/limiters.js', () => ({ globalLimiter: passThrough, strictLimiter: passThrough, COMMENT_LIMIT_MESSAGE: '' }));
jest.unstable_mockModule('../middleware/authMiddleware.js', () => ({
  authenticateToken: (req, res, next) => { req.user = { full_name: 'Admin' }; next(); },
  requireAdmin: passThrough,
}));
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { default: postRouter } = await import('../routes/postRoutes.js');
const request = (await import('supertest')).default;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use('/blogpost', postRouter);

describe('post routes pass the reading layout on', () => {
  beforeEach(() => {
    createPost.mockReset().mockResolvedValue({ id: 4 });
    updatePost.mockReset().mockResolvedValue({ id: 4 });
  });

  it('creates a post with the chosen layout, unknown values become standard', async () => {
    await request(app).post('/blogpost/create').type('form').send({ title: 'Titel', content: '<p>x</p>', category_id: '1', layout: 'magazine' }).expect(303);
    expect(createPost.mock.calls[0][0]).toMatchObject({ title: 'Titel', layout: 'magazine' });

    await request(app).post('/blogpost/create').type('form').send({ title: 'Titel', content: '<p>x</p>', category_id: '1', layout: 'zigzag' }).expect(303);
    expect(createPost.mock.calls[1][0].layout).toBe('standard');
  });

  it('updates the layout when the form sends one and keeps it otherwise', async () => {
    await request(app).post('/blogpost/update/4').type('form').send({ title: 'Titel', content: '<p>x</p>', category_id: '1', layout: 'wide' }).expect(303);
    expect(updatePost.mock.calls[0][0]).toMatchObject({ id: '4', layout: 'wide' });

    await request(app).post('/blogpost/update/4').type('form').send({ title: 'Titel', content: '<p>x</p>', category_id: '1' }).expect(303);
    expect(updatePost.mock.calls[1][0]).not.toHaveProperty('layout');
  });
});
