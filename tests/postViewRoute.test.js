/** @jest-environment node */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import cookieParser from 'cookie-parser';

const increasePostViews = jest.fn();
const fetchCommentsByPostId = jest.fn();
const getPostById = jest.fn();
const getPostBySlug = jest.fn();

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, auth: () => {}, authEvent: () => {} },
}));
jest.unstable_mockModule('../databases/mariaDB.js', () => ({
  DatabaseService: { increasePostViews },
}));
jest.unstable_mockModule('../utils/sanitizer.js', () => ({
  sanitizeHtml: jest.fn((s) => s),
}));
jest.unstable_mockModule('../controllers/commentController.js', () => ({
  default: { fetchCommentsByPostId },
}));
jest.unstable_mockModule('../controllers/postController.js', () => ({
  default: { getPostById, getPostBySlug },
  getAllPostsPaginated: jest.fn(),
  getPostsByCategoryPaginated: jest.fn(),
  getPostsByTagPaginated: jest.fn(),
  getArchivedPostsPaginated: jest.fn(),
  PAGE_SIZE: 10,
}));

const { PostControllerException } = await import('../models/customExceptions.js');
const { default: postRouter } = await import('../routes/postRoutes.js');
const { default: csrfProtection } = await import('../utils/csrf.js');
const request = (await import('supertest')).default;

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const POST = { id: 7, slug: 'ein-post', title: 'Ein Post', content: '<p>Text</p>', published: true, tags: [] };

function buildApp({ admin = false } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  // app.js sets this flag from the auth cookie for every request
  app.use((req, res, next) => { res.locals.isAdmin = admin; next(); });
  // Templates are not under test here
  app.engine('ejs', (_file, _opts, cb) => cb(null, 'rendered'));
  app.set('view engine', 'ejs');
  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true, type: 'application/x-www-form-urlencoded' }));
  app.get('/token', csrfProtection, (req, res) => res.json({ token: req.csrfToken() }));
  app.use('/blogpost', postRouter);
  app.use((err, req, res, _next) => res.status(err.code === 'EBADCSRFTOKEN' ? 403 : 500).end());
  return app;
}

// Each test uses its own client IP: viewTracker remembers IP:post pairs
async function clientWithToken(app, ip) {
  const agent = request.agent(app);
  const res = await agent.get('/token').set('X-Forwarded-For', ip).set('User-Agent', BROWSER_UA);
  return { agent, token: res.body.token };
}

function beacon(agent, ip, postId, token, ua = BROWSER_UA) {
  const req = agent.post(`/blogpost/id/${postId}/view`).set('X-Forwarded-For', ip).set('User-Agent', ua).type('form');
  return token ? req.send({ _csrf: token }) : req.send({});
}

// jest.config resets mock implementations before every test
beforeEach(() => {
  increasePostViews.mockResolvedValue({ success: true });
  fetchCommentsByPostId.mockResolvedValue([]);
  getPostById.mockResolvedValue(POST);
  getPostBySlug.mockResolvedValue(POST);
});

describe('view counting', () => {
  it('does not count when the post page is served', async () => {
    const app = buildApp();
    const ip = '203.0.113.51';

    await request(app).get('/blogpost/id/7').set('X-Forwarded-For', ip).set('User-Agent', BROWSER_UA).expect(200);
    await request(app).get('/blogpost/7').set('X-Forwarded-For', ip).set('User-Agent', BROWSER_UA).expect(200);
    await request(app).get('/blogpost/ein-post').set('X-Forwarded-For', ip).set('User-Agent', BROWSER_UA).expect(200);
    await request(app).head('/blogpost/ein-post').set('X-Forwarded-For', ip).set('User-Agent', BROWSER_UA).expect(200);

    expect(increasePostViews).not.toHaveBeenCalled();
  });

  it('counts a beacon with a valid CSRF token exactly once per lock period', async () => {
    const app = buildApp();
    const ip = '203.0.113.52';
    const { agent, token } = await clientWithToken(app, ip);

    await beacon(agent, ip, 7, token).expect(204);
    await beacon(agent, ip, 7, token).expect(204);

    expect(increasePostViews).toHaveBeenCalledTimes(1);
    expect(increasePostViews.mock.calls[0][0]).toBe(7);
  });

  it('rejects a beacon without a CSRF token', async () => {
    const app = buildApp();
    const ip = '203.0.113.53';
    const { agent } = await clientWithToken(app, ip);

    await beacon(agent, ip, 7, null).expect(403);

    expect(increasePostViews).not.toHaveBeenCalled();
  });

  it('does not count an unknown or unpublished post', async () => {
    const app = buildApp();
    const ip = '203.0.113.54';
    const { agent, token } = await clientWithToken(app, ip);
    getPostById.mockRejectedValue(new PostControllerException('Post not found'));

    await beacon(agent, ip, 999, token).expect(204);

    expect(increasePostViews).not.toHaveBeenCalled();
  });

  it('does not count a beacon from a bot user agent', async () => {
    const app = buildApp();
    const ip = '203.0.113.55';
    const { agent, token } = await clientWithToken(app, ip);

    await beacon(agent, ip, 7, token, 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/131.0.0.0 Safari/537.36').expect(204);

    expect(increasePostViews).not.toHaveBeenCalled();
  });

  it('does not count a read by a logged-in admin', async () => {
    const app = buildApp({ admin: true });
    const ip = '203.0.113.57';
    const { agent, token } = await clientWithToken(app, ip);

    await beacon(agent, ip, 7, token).expect(204);

    expect(increasePostViews).not.toHaveBeenCalled();
  });

  it('rejects an invalid post id', async () => {
    const app = buildApp();
    const ip = '203.0.113.56';
    const { agent, token } = await clientWithToken(app, ip);

    await beacon(agent, ip, 'abc', token).expect(400);

    expect(increasePostViews).not.toHaveBeenCalled();
  });
});
