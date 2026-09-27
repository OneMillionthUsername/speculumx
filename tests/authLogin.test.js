/** @jest-environment node */
import { describe, it, expect, jest } from '@jest/globals';
import express from 'express';

const mockAuthenticateAdmin = jest.fn();
const mockAuthEvent = jest.fn();
jest.unstable_mockModule('../controllers/adminController.js', () => ({
  default: { authenticateAdmin: mockAuthenticateAdmin },
}));
jest.unstable_mockModule('../utils/csrf.js', () => ({
  default: (req, res, next) => next(),
}));
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, auth: () => {}, authEvent: mockAuthEvent },
}));

const { default: authRouter } = await import('../routes/authRoutes.js');
const { AdminAccountLockedException } = await import('../models/customExceptions.js');
const request = (await import('supertest')).default;

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/auth', authRouter);
  return app;
}

// Each test uses its own client IP so the login rate limit (5 per 15 min) never interferes
function login(ip) {
  return request(buildApp())
    .post('/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ username: 'admin', password: 'secret' });
}

describe('POST /auth/login', () => {
  it('answers 401 for a locked or deactivated account instead of 500', async () => {
    mockAuthenticateAdmin.mockRejectedValue(new AdminAccountLockedException());

    const res = await login('203.0.113.41');

    expect(res.status).toBe(401);
    expect(mockAuthEvent).toHaveBeenCalledWith('AUTH_LOGIN_LOCKED', expect.objectContaining({ ip: '203.0.113.41' }), 'WARN');
    expect(mockAuthEvent).not.toHaveBeenCalledWith('AUTH_LOGIN_ERROR', expect.anything(), 'ERROR');
  });

  it('gives a locked account the same answer as a wrong password', async () => {
    mockAuthenticateAdmin.mockRejectedValue(new AdminAccountLockedException());
    const locked = await login('203.0.113.42');

    mockAuthenticateAdmin.mockResolvedValue(null);
    const wrongPassword = await login('203.0.113.43');

    expect(locked.body).toEqual({ success: false, error: 'Invalid credentials' });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual(locked.body);
  });

  it('still answers 500 for unexpected errors', async () => {
    mockAuthenticateAdmin.mockRejectedValue(new Error('Connection refused'));

    const res = await login('203.0.113.44');

    expect(res.status).toBe(500);
  });
});
