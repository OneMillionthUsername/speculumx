import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock heavy dependencies used by securityMiddleware to avoid side-effects and module re-linking
jest.unstable_mockModule('../utils/utils.js', () => ({
  sanitizeInputStrings: (obj) => obj,
  sanitizeFilename: (n) => n,
}));
const mockGetAdminById = jest.fn().mockResolvedValue({ username: 'default', full_name: 'Default User' });
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

// Avoid top-level imports of app modules to prevent ESM module-linking issues.
let requireJsonContent;
let authenticateToken;
let requireAdmin;
let jwt;
const AUTH_COOKIE_NAME = 'authToken';

function makeReq({ headers = {}, cookies = {}, body = {}, params = {}, query = {} } = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), v]),
  );
  return {
    headers: normalized,
    cookies,
    body,
    params,
    query,
    get(name) {
      return this.headers[String(name).toLowerCase()] || undefined;
    },
  };
}

function makeRes() {
  return {
    statusCode: 200,
    jsonBody: undefined,
    status: jest.fn(function (code) { this.statusCode = code; return this; }),
    json: jest.fn(function (payload) { this.jsonBody = payload; return this; }),
  };
}

describe('Security middleware and auth guards', () => {
  beforeEach(() => {
    mockGetAdminById.mockResolvedValue({ username: 'default', full_name: 'Default User' });
  });

  beforeAll(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    // Ensure predictable JWT behavior for authService during tests
    process.env.NODE_ENV = 'test';

    // Dynamic imports to avoid early evaluation with wrong env
    const security = await import('../middleware/securityMiddleware.js');
    requireJsonContent = security.requireJsonContent;

    const authMw = await import('../middleware/authMiddleware.js');
    authenticateToken = authMw.authenticateToken;
    requireAdmin = authMw.requireAdmin;

    jwt = (await import('jsonwebtoken')).default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('requireJsonContent', () => {
    it('rejects when Content-Type is missing', () => {
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();

      requireJsonContent(req, res, next);

      expect(res.status).toHaveBeenCalledWith(415);
      expect(res.jsonBody).toEqual({ error: 'Content-Type muss application/json sein' });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects when Content-Type is not application/json', () => {
      const req = makeReq({ headers: { 'Content-Type': 'text/plain' } });
      const res = makeRes();
      const next = jest.fn();

      requireJsonContent(req, res, next);

      expect(res.status).toHaveBeenCalledWith(415);
      expect(res.jsonBody).toEqual({ error: 'Content-Type muss application/json sein' });
      expect(next).not.toHaveBeenCalled();
    });

    it('passes when Content-Type is application/json (with charset)', () => {
      const req = makeReq({ headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      const res = makeRes();
      const next = jest.fn();

      requireJsonContent(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(415);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('authenticateToken + requireAdmin', () => {
    it('authenticateToken returns 401 when no token is provided', () => {
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();

      authenticateToken(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.jsonBody).toEqual({ error: 'Access denied', message: 'JWT token required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('authenticateToken returns 401 with invalid token', () => {
      const req = makeReq({ headers: { Authorization: 'Bearer invalid.token.here' } });
      const res = makeRes();
      const next = jest.fn();

      authenticateToken(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res.jsonBody).toEqual({ error: 'Invalid token', message: 'Token is expired or invalid' });
      expect(next).not.toHaveBeenCalled();
    });

    it('authenticateToken attaches user from Authorization header', async () => {
      const token = jwt.sign({ id: 1, role: 'admin', iss: 'blog-app', aud: 'blog-users' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '24h' });
      const req = makeReq({ headers: { Authorization: `Bearer ${token}` } });
      const res = makeRes();
      const next = jest.fn();

      mockGetAdminById.mockResolvedValue({ username: 'alice', full_name: 'Alice' });
      await authenticateToken(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(req.user).toBeDefined();
      expect(req.user.username).toBe('alice');
      expect(req.user.role).toBe('admin');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('authenticateToken attaches user from auth cookie', async () => {
      const token = jwt.sign({ id: 2, role: 'user', iss: 'blog-app', aud: 'blog-users' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '24h' });
      const req = makeReq({ cookies: { [AUTH_COOKIE_NAME]: token } });
      const res = makeRes();
      const next = jest.fn();

      mockGetAdminById.mockResolvedValue({ username: 'bob', full_name: 'Bob' });
      await authenticateToken(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(req.user).toBeDefined();
      expect(req.user.username).toBe('bob');
      expect(req.user.role).toBe('user');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('requireAdmin returns 403 when user missing', () => {
      const req = makeReq();
      const res = makeRes();
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res.jsonBody).toEqual({
        error: 'Admin privileges required',
        message: 'Only administrators have access to this function',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('requireAdmin returns 403 for non-admin role', () => {
      const req = makeReq();
      req.user = { id: 3, username: 'charlie', role: 'user' };
      const res = makeRes();
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res.jsonBody).toEqual({
        error: 'Admin privileges required',
        message: 'Only administrators have access to this function',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('requireAdmin calls next for admin user', () => {
      const req = makeReq();
      req.user = { id: 4, username: 'diane', role: 'admin', isAdmin: true };
      const res = makeRes();
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
