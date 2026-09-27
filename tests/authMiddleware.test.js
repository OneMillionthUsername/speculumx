import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock authService before importing middleware
const mockExtract = jest.fn();
const mockVerify = jest.fn();
const mockGetAdminById = jest.fn();

jest.unstable_mockModule('../services/authService.js', () => ({
  extractTokenFromRequest: mockExtract,
  verifyToken: mockVerify,
}));

jest.unstable_mockModule('../databases/mariaDB.js', () => ({
  DatabaseService: {
    getAdminById: mockGetAdminById,
  },
}));

// Import after mocks are set up
const authMiddlewareModule = await import('../middleware/authMiddleware.js');
const { authenticateToken, requireAdmin } = authMiddlewareModule;

function createMockRes() {
  const res = {};
  res.statusCode = 200;
  res.headers = {};
  res.body = undefined;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((data) => { res.body = data; return res; });
  res.setHeader = jest.fn((k, v) => { res.headers[k.toLowerCase()] = v; });
  res.getHeader = jest.fn((k) => res.headers[k.toLowerCase()]);
  return res;
}

describe('authMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('authenticateToken', () => {
    it('returns 401 when no token present', async () => {
      const req = { headers: {}, cookies: {} };
      const res = createMockRes();
      const next = jest.fn();

      mockExtract.mockReturnValue(null);

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.body).toEqual({ error: 'Access denied', message: 'JWT token required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when token is invalid', async () => {
      const req = { headers: { authorization: 'Bearer invalid' }, cookies: {} };
      const res = createMockRes();
      const next = jest.fn();

      mockExtract.mockReturnValue('invalid');
      mockVerify.mockReturnValue(null);

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.body).toEqual({ error: 'Invalid token', message: 'Token is expired or invalid' });
      expect(next).not.toHaveBeenCalled();
    });

    it('attaches user and calls next() on valid token', async () => {
      const req = { headers: { authorization: 'Bearer valid' }, cookies: {} };
      const res = createMockRes();
      const next = jest.fn();

      mockExtract.mockReturnValue('valid');
      mockVerify.mockReturnValue({ id: 1, role: 'admin' });
      mockGetAdminById.mockResolvedValue({ username: 'admin', full_name: 'Admin User' });

      await authenticateToken(req, res, next);

      expect(req.user).toEqual({
        id: 1,
        role: 'admin',
        isAdmin: true,
        username: 'admin',
        full_name: 'Admin User',
      });
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalledWith(401);
    });

    it('returns 401 when admin not found in DB', async () => {
      const req = { headers: { authorization: 'Bearer valid' }, cookies: {} };
      const res = createMockRes();
      const next = jest.fn();

      mockExtract.mockReturnValue('valid');
      mockVerify.mockReturnValue({ id: 999, role: 'admin' });
      mockGetAdminById.mockResolvedValue(null);

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it.each([0, false])('returns 401 when the admin account is deactivated (active=%p)', async (active) => {
      const req = { headers: { authorization: 'Bearer valid' }, cookies: {} };
      const res = createMockRes();
      const next = jest.fn();

      mockExtract.mockReturnValue('valid');
      mockVerify.mockReturnValue({ id: 1, role: 'admin' });
      mockGetAdminById.mockResolvedValue({ username: 'admin', full_name: 'Admin User', active });

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(req.user).toBeUndefined();
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts an active admin account (active=1)', async () => {
      const req = { headers: { authorization: 'Bearer valid' }, cookies: {} };
      const res = createMockRes();
      const next = jest.fn();

      mockExtract.mockReturnValue('valid');
      mockVerify.mockReturnValue({ id: 1, role: 'admin' });
      mockGetAdminById.mockResolvedValue({ username: 'admin', full_name: 'Admin User', active: 1 });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('requireAdmin', () => {
    it('returns 403 when user is missing', () => {
      const req = { user: undefined };
      const res = createMockRes();
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.body).toEqual({
        error: 'Admin privileges required',
        message: 'Only administrators have access to this function',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when user is not admin', () => {
      const req = { user: { id: 2, username: 'user', role: 'user' } };
      const res = createMockRes();
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.body).toEqual({
        error: 'Admin privileges required',
        message: 'Only administrators have access to this function',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() when user is admin', () => {
      const req = { user: { id: 1, username: 'admin', role: 'admin' } };
      const res = createMockRes();
      const next = jest.fn();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });
  });
});
