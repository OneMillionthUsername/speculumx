/** @jest-environment node */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';

// The editor form sends the reading layout with the post (select name="layout"); the SSR routes pass it on,
// normalised, and an update without the field keeps the stored layout. After saving, an unpublished post and a
// deleted one lead to the post management list, never to the (unreadable) post itself.

const createPost = jest.fn();
const updatePost = jest.fn();
const deletePost = jest.fn();
const passThrough = (req, res, next) => next();

jest.unstable_mockModule('../controllers/postController.js', () => ({
  default: { createPost, updatePost, deletePost },
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

describe('post routes after saving or deleting', () => {
  const post = { title: 'Titel', content: '<p>x</p>', category_id: '1' };

  beforeEach(() => {
    createPost.mockReset().mockResolvedValue({ id: 4 });
    updatePost.mockReset().mockResolvedValue({ id: 4 });
    deletePost.mockReset().mockResolvedValue(true);
  });

  it('opens a published post', async () => {
    const created = await request(app).post('/blogpost/create').type('form').send({ ...post, published: 'on' }).expect(303);
    expect(created.headers.location).toBe('/blogpost/id/4');
    expect(createPost.mock.calls[0][0].published).toBe(true);

    const updated = await request(app).post('/blogpost/update/4').type('form').send({ ...post, published: 'on' }).expect(303);
    expect(updated.headers.location).toBe('/blogpost/id/4');
  });

  it('shows an unpublished post in the post management instead of a 404', async () => {
    const updated = await request(app).post('/blogpost/update/4').type('form').send(post).expect(303);
    expect(updated.headers.location).toBe('/blogpost/admin/drafts#post-4');
    expect(updatePost.mock.calls[0][0].published).toBe(false);

    // A new post with "Veröffentlicht" unticked is saved as a draft
    const created = await request(app).post('/blogpost/create').type('form').send(post).expect(303);
    expect(created.headers.location).toBe('/blogpost/admin/drafts#post-4');
    expect(createPost.mock.calls[0][0].published).toBe(false);
  });

  it('returns to the post management after deleting', async () => {
    const res = await request(app).post('/blogpost/delete/4').set('Referer', 'http://localhost/blogpost/some-post').expect(303);
    expect(res.headers.location).toBe('/blogpost/admin/drafts');

    const json = await request(app).post('/blogpost/delete/4').set('Accept', 'application/json').expect(200);
    expect(json.body).toEqual({ success: true, returnTo: '/blogpost/admin/drafts' });
  });
});
