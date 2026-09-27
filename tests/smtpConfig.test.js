/** @jest-environment node */
import { describe, it, expect, jest, afterEach } from '@jest/globals';

const SMTP_KEYS = ['SMTP_HOST', 'SMTP_TLS_REJECT_UNAUTHORIZED'];
const saved = Object.fromEntries(SMTP_KEYS.map(key => [key, process.env[key]]));

// config.js reads process.env once at import, so every case needs a fresh module
async function loadConfig(vars) {
  for (const key of SMTP_KEYS) delete process.env[key];
  Object.assign(process.env, vars);
  jest.resetModules();
  return import('../config/config.js');
}

describe('SMTP_TLS_REJECT_UNAUTHORIZED', () => {
  afterEach(() => {
    for (const key of SMTP_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it.each([
    ['the default relay on the Docker host', {}],
    ['localhost', { SMTP_HOST: 'localhost' }],
    ['127.0.0.1', { SMTP_HOST: '127.0.0.1' }],
  ])('skips certificate verification for %s', async (_label, vars) => {
    const config = await loadConfig(vars);
    expect(config.SMTP_TLS_REJECT_UNAUTHORIZED).toBe(false);
  });

  it('verifies the certificate of a remote SMTP server', async () => {
    const config = await loadConfig({ SMTP_HOST: 'smtp.example.com' });
    expect(config.SMTP_TLS_REJECT_UNAUTHORIZED).toBe(true);
  });

  it('lets the env variable override the default in both directions', async () => {
    expect((await loadConfig({ SMTP_HOST: 'smtp.example.com', SMTP_TLS_REJECT_UNAUTHORIZED: 'false' })).SMTP_TLS_REJECT_UNAUTHORIZED).toBe(false);
    expect((await loadConfig({ SMTP_HOST: 'localhost', SMTP_TLS_REJECT_UNAUTHORIZED: 'true' })).SMTP_TLS_REJECT_UNAUTHORIZED).toBe(true);
  });
});
