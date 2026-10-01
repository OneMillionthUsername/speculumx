/** @jest-environment node */
import { describe, it, expect, jest, afterEach } from '@jest/globals';

const SMTP_KEYS = ['SMTP_HOST', 'SMTP_TLS_REJECT_UNAUTHORIZED', 'SMTP_CLIENT_NAME', 'DOMAIN'];
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
    ['mixed-case localhost with whitespace', { SMTP_HOST: ' LocalHost ' }],
    ['127.0.0.1', { SMTP_HOST: '127.0.0.1' }],
    ['another address in 127.0.0.0/8', { SMTP_HOST: '127.0.0.2' }],
    ['::1', { SMTP_HOST: '::1' }],
  ])('skips certificate verification for %s', async (_label, vars) => {
    const config = await loadConfig(vars);
    expect(config.SMTP_TLS_REJECT_UNAUTHORIZED).toBe(false);
  });

  it.each([
    ['a remote host name', { SMTP_HOST: 'smtp.example.com' }],
    ['a remote IPv4 address', { SMTP_HOST: '192.0.2.10' }],
    ['a remote IPv6 address', { SMTP_HOST: '2001:db8::1' }],
  ])('verifies the certificate for %s', async (_label, vars) => {
    const config = await loadConfig(vars);
    expect(config.SMTP_TLS_REJECT_UNAUTHORIZED).toBe(true);
  });

  it('lets the env variable override the default in both directions', async () => {
    expect((await loadConfig({ SMTP_HOST: 'smtp.example.com', SMTP_TLS_REJECT_UNAUTHORIZED: 'false' })).SMTP_TLS_REJECT_UNAUTHORIZED).toBe(false);
    // A relay reached via the server's own public IP has to opt out explicitly
    expect((await loadConfig({ SMTP_HOST: '192.0.2.10', SMTP_TLS_REJECT_UNAUTHORIZED: 'false' })).SMTP_TLS_REJECT_UNAUTHORIZED).toBe(false);
    expect((await loadConfig({ SMTP_HOST: 'localhost', SMTP_TLS_REJECT_UNAUTHORIZED: 'true' })).SMTP_TLS_REJECT_UNAUTHORIZED).toBe(true);
    expect((await loadConfig({ SMTP_HOST: '192.0.2.10', SMTP_TLS_REJECT_UNAUTHORIZED: 'true' })).SMTP_TLS_REJECT_UNAUTHORIZED).toBe(true);
  });

  it('keeps verification on for a remote host when the env value is not a boolean', async () => {
    const config = await loadConfig({ SMTP_HOST: '192.0.2.10', SMTP_TLS_REJECT_UNAUTHORIZED: 'ture' });
    expect(config.SMTP_TLS_REJECT_UNAUTHORIZED).toBe(true);
  });
});

describe('SMTP_CLIENT_NAME', () => {
  afterEach(() => {
    for (const key of SMTP_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('defaults to mail.<DOMAIN>, the MX name of the server', async () => {
    const config = await loadConfig({ DOMAIN: 'speculumx.at' });
    expect(config.SMTP_CLIENT_NAME).toBe('mail.speculumx.at');
  });

  it('lets the env variable override the default', async () => {
    const config = await loadConfig({ DOMAIN: 'speculumx.at', SMTP_CLIENT_NAME: 'smtp.example.org' });
    expect(config.SMTP_CLIENT_NAME).toBe('smtp.example.org');
  });

  it('falls back to the default when the env variable is empty', async () => {
    const config = await loadConfig({ DOMAIN: 'speculumx.at', SMTP_CLIENT_NAME: '' });
    expect(config.SMTP_CLIENT_NAME).toBe('mail.speculumx.at');
  });
});
