/** @jest-environment node */
import { describe, it, expect, jest } from '@jest/globals';
import express from 'express';

// Keep the rate-limit handler from writing log files during tests
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    auth: () => {},
    authEvent: () => {},
  },
}));

const { getClientIp, getSafeRefererPath } = await import('../utils/requestUtils.js');
const { loginLimiter } = await import('../utils/limiters.js');
const request = (await import('supertest')).default;

function makeReq({ referer, hostname = 'speculumx.at' } = {}) {
  return {
    hostname,
    get: (name) => (name.toLowerCase() === 'referer' ? referer : undefined),
  };
}

describe('getClientIp', () => {
  it('uses req.ip and ignores a client-supplied X-Forwarded-For', () => {
    const req = { ip: '203.0.113.9', headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' } };
    expect(getClientIp(req)).toBe('203.0.113.9');
  });

  it('normalises IPv4-mapped IPv6 addresses', () => {
    expect(getClientIp({ ip: '::ffff:198.51.100.7' })).toBe('198.51.100.7');
  });

  it('falls back to the socket address, then to "unknown"', () => {
    expect(getClientIp({ socket: { remoteAddress: '192.0.2.1' } })).toBe('192.0.2.1');
    expect(getClientIp({})).toBe('unknown');
    expect(getClientIp(undefined)).toBe('unknown');
  });
});

describe('getSafeRefererPath', () => {
  it('returns path and query of a same-host referer', () => {
    const req = makeReq({ referer: 'https://speculumx.at/blogpost/all?page=2' });
    expect(getSafeRefererPath(req, '/')).toBe('/blogpost/all?page=2');
  });

  it.each([
    ['missing referer', undefined],
    ['foreign host', 'https://evil.example/phish'],
    ['protocol-relative path', 'https://speculumx.at//evil.example/phish'],
    ['backslash path', 'https://speculumx.at/\\evil.example/phish'],
    ['unparsable referer', 'not a url'],
  ])('returns the fallback for a %s', (_label, referer) => {
    expect(getSafeRefererPath(makeReq({ referer }), '/fallback')).toBe('/fallback');
  });
});

describe('loginLimiter behind one trusted proxy', () => {
  function buildApp() {
    const app = express();
    app.set('trust proxy', 1);
    app.post('/login', loginLimiter, (req, res) => res.json({ ok: true }));
    return app;
  }

  it('cannot be bypassed by rotating a spoofed X-Forwarded-For entry', async () => {
    const app = buildApp();
    // Nginx appends the real client (203.0.113.10) to whatever the client sent
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post('/login')
        .set('X-Forwarded-For', `10.0.0.${i}, 203.0.113.10`);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });

  it('keeps separate buckets for different real clients', async () => {
    const app = buildApp();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/login').set('X-Forwarded-For', '203.0.113.20');
    }
    const blocked = await request(app).post('/login').set('X-Forwarded-For', '203.0.113.20');
    const other = await request(app).post('/login').set('X-Forwarded-For', '203.0.113.21');
    expect(blocked.status).toBe(429);
    expect(other.status).toBe(200);
  });
});
