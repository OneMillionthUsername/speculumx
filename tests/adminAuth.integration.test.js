/** @jest-environment node */
import { describe, it, expect, beforeAll, jest } from '@jest/globals';
import express from 'express';
import cookieParser from 'cookie-parser';

// Mock heavy dependencies to prevent side effects during import
jest.unstable_mockModule('../utils/utils.js', () => ({
  sanitizeInputStrings: (obj) => obj,
  sanitizeFilename: (n) => n,
}));
const mockGetAdminById = jest.fn();
jest.unstable_mockModule('../databases/mariaDB.js', () => ({
  DatabaseService: {
    getAdminById: mockGetAdminById,
  },
}));
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    access: () => {},
    auth: () => {},
    rotateLogFiles: () => {},
    close: () => {},
  },
}));

// Dynamic imports after mocks
const { default: csrfProtection } = await import('../utils/csrf.js');
const { requireJsonContent } = await import('../middleware/securityMiddleware.js');
const { authenticateToken, requireAdmin } = await import('../middleware/authMiddleware.js');
const request = (await import('supertest')).default;
const jwt = (await import('jsonwebtoken')).default;

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());

  // CSRF token endpoint as in utilityRoutes
  app.get('/api/csrf-token', csrfProtection, (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
  });

  // Protected route requiring JSON, CSRF, auth, admin
  app.post('/admin/cards', csrfProtection, requireJsonContent, authenticateToken, requireAdmin, (req, res) => {
    res.status(201).json({ ok: true });
  });

  // Simple admin-only GET like debug/headers
  app.get('/debug/headers', authenticateToken, requireAdmin, (req, res) => {
    res.json({ ok: true, user: req.user.username, role: req.user.role });
  });

  return app;
}

function sign(payload) {
  return jwt.sign({ ...payload, iss: 'blog-app', aud: 'blog-users' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '24h' });
}

describe('Admin authorization integration (micro app)', () => {
  let app;
  let agent;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    app = buildTestApp();
    agent = request.agent(app); // persist cookies
  });

  beforeEach(() => {
    mockGetAdminById.mockResolvedValue({ username: 'admin', full_name: 'Admin' });
  });

  it('GET /debug/headers -> 401 without token', async () => {
    const res = await agent.get('/debug/headers');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'Access denied' });
  });

  it('GET /debug/headers -> 403 for non-admin', async () => {
    const token = sign({ id: 10, username: 'user', role: 'user' });
    const res = await agent.get('/debug/headers').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'Admin privileges required' });
  });

  it('GET /debug/headers -> 200 for admin', async () => {
    const token = sign({ id: 1, username: 'admin', role: 'admin', isAdmin: true });
    const res = await agent.get('/debug/headers').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, user: 'admin', role: 'admin' });
  });

  it('POST /admin/cards -> 403 without CSRF even if JSON', async () => {
    const token = sign({ id: 1, username: 'admin', role: 'admin', isAdmin: true });
    const res = await agent
      .post('/admin/cards')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ title: 't', subtitle: '', link: 'https://example.com', img_link: 'https://example.com/x.png' });
    expect(res.status).toBe(403);
    // No body assertion here: micro app has no global JSON error handler for CSRF
  });

  it('POST /admin/cards -> 401 with CSRF but no auth', async () => {
    // fetch token (cookie set via agent)
    const t1 = await agent.get('/api/csrf-token');
    expect(t1.status).toBe(200);
    const csrfToken = t1.body.csrfToken;
    expect(csrfToken).toBeTruthy();

    const res = await agent
      .post('/admin/cards')
      .set('x-csrf-token', csrfToken)
      .set('Content-Type', 'application/json')
      .send({ title: 't', subtitle: '', link: 'https://example.com', img_link: 'https://example.com/x.png' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'Access denied' });
  });

  it('POST /admin/cards -> 403 for non-admin even with CSRF', async () => {
    const t1 = await agent.get('/api/csrf-token');
    const csrfToken = t1.body.csrfToken;
    const userToken = sign({ id: 10, username: 'user', role: 'user' });
    const res = await agent
      .post('/admin/cards')
      .set('x-csrf-token', csrfToken)
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'application/json')
      .send({ title: 't', subtitle: '', link: 'https://example.com', img_link: 'https://example.com/x.png' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'Admin privileges required' });
  });

  it('POST /admin/cards -> 201 for admin with CSRF and JSON', async () => {
    const t1 = await agent.get('/api/csrf-token');
    const csrfToken = t1.body.csrfToken;
    const adminToken = sign({ id: 1, username: 'admin', role: 'admin', isAdmin: true });
    const res = await agent
      .post('/admin/cards')
      .set('x-csrf-token', csrfToken)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send({ title: 't', subtitle: '', link: 'https://example.com', img_link: 'https://example.com/x.png' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true });
  });
});
