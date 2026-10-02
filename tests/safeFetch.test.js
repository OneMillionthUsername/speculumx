/** @jest-environment node */
import http from 'node:http';
import zlib from 'node:zlib';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { isPublicAddress, safeFetch, createFetcher, bodyText, FetchError, connectError } from '../utils/safeFetch.js';

describe('isPublicAddress', () => {
  it.each([
    '8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8',
  ])('accepts the public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.5', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1',
    '::ffff:10.0.0.1', 'not-an-ip', '',
  ])('rejects %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isPublicAddress(undefined)).toBe(false);
    expect(isPublicAddress(null)).toBe(false);
  });
});

describe('safeFetch', () => {
  it.each([
    ['a loopback IP', 'http://127.0.0.1/'],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['a private IP', 'https://10.0.0.1/'],
    ['an IPv6 loopback', 'http://[::1]/'],
    ['localhost (resolves to loopback)', 'http://localhost/'],
  ])('refuses %s', async (_label, url) => {
    await expect(safeFetch(url, { timeoutMs: 3000 })).rejects.toThrow(FetchError);
  });

  it('refuses other protocols, credentials and unusual ports', async () => {
    await expect(safeFetch('ftp://example.com/file')).rejects.toThrow(/protocol/i);
    await expect(safeFetch('https://user:secret@example.com/')).rejects.toThrow(/credentials/i);
    await expect(safeFetch('http://example.com:3306/')).rejects.toThrow(/port/i);
    await expect(safeFetch('not a url')).rejects.toThrow(/Invalid URL/);
  });
});

describe('connectError', () => {
  it('lists the attempts of a failed dual-stack connect', () => {
    const attempt = (code, address) => Object.assign(new Error(code), { code, address, port: 443 });
    const error = connectError(new AggregateError([attempt('ETIMEDOUT', '192.0.2.1'), attempt('ENETUNREACH', '2001:db8::1')]));
    expect(error).toBeInstanceOf(FetchError);
    expect(error.message).toBe('Connection failed: ETIMEDOUT 192.0.2.1:443 | ENETUNREACH 2001:db8::1:443');
  });

  it('leaves other errors alone', () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:80');
    expect(connectError(error)).toBe(error);
  });
});

// The real network path, against a local server. The default policy would (rightly) refuse
// 127.0.0.1, so these tests use a fetcher that treats 127.0.0.1 as public and 127.0.0.2 as private.
describe('safeFetch against a local server', () => {
  let server;
  let port;
  let fetcher;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/plain') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Grüße');
      } else if (req.url === '/gzip') {
        res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Type': 'text/plain' });
        res.end(zlib.gzipSync('compressed body'));
      } else if (req.url === '/latin1') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=ISO-8859-1' });
        res.end(Buffer.from('Grüße', 'latin1'));
      } else if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/plain' });
        res.end();
      } else if (req.url === '/redirect-private') {
        res.writeHead(302, { Location: `http://127.0.0.2:${port}/plain` });
        res.end();
      } else if (req.url === '/loop') {
        res.writeHead(302, { Location: '/loop' });
        res.end();
      } else if (req.url === '/big') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('x'.repeat(100_000));
      } else if (req.url === '/bomb') {
        res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Type': 'text/plain' });
        res.end(zlib.gzipSync('a'.repeat(5_000_000)));
      } else if (req.url === '/slow') {
        res.writeHead(200);
        res.write('start');
      } else {
        res.writeHead(404);
        res.end('missing');
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    fetcher = createFetcher({ isPublic: address => address === '127.0.0.1', ports: new Set([String(port)]) });
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  const url = path => `http://127.0.0.1:${port}${path}`;

  it('returns status, headers and body', async () => {
    const response = await fetcher(url('/plain'));
    expect(response.status).toBe(200);
    expect(bodyText(response)).toBe('Grüße');
    expect(response.headers['content-type']).toMatch(/text\/plain/);
  });

  it('decompresses gzip and decodes Latin-1', async () => {
    expect(bodyText(await fetcher(url('/gzip')))).toBe('compressed body');
    expect(bodyText(await fetcher(url('/latin1')))).toBe('Grüße');
  });

  it('follows redirects and reports the final URL', async () => {
    const response = await fetcher(url('/redirect'));
    expect(response.url).toBe(url('/plain'));
    expect(bodyText(response)).toBe('Grüße');
  });

  it('checks every redirect hop, so a redirect to a private address is refused', async () => {
    await expect(fetcher(url('/redirect-private'))).rejects.toThrow(/Blocked non-public/);
  });

  it('gives up on redirect loops', async () => {
    await expect(fetcher(url('/loop'), { maxRedirects: 2 })).rejects.toThrow(/Too many redirects/);
  });

  it('passes error statuses through', async () => {
    expect((await fetcher(url('/nothing'))).status).toBe(404);
  });

  it('refuses bodies above the limit, also after decompression', async () => {
    await expect(fetcher(url('/big'), { maxBytes: 1000 })).rejects.toThrow(/larger than 1000/);
    await expect(fetcher(url('/bomb'), { maxBytes: 100_000 })).rejects.toThrow(/larger than 100000/);
  });

  it('times out on a response that never ends', async () => {
    await expect(fetcher(url('/slow'), { timeoutMs: 300 })).rejects.toThrow(/Timeout/);
  });

  it('does not allow a port outside the policy', async () => {
    await expect(fetcher(`http://127.0.0.1:${port + 1}/`)).rejects.toThrow(/Port not allowed/);
  });
});
