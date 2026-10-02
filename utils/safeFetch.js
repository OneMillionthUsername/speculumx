import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

/**
 * HTTP client for URLs that come from the outside (feed items, links submitted to Hacker News).
 *
 * Such a URL may point at the server's own network (localhost, Docker network, cloud metadata
 * endpoint). Every connection is therefore checked at connect time: the resolved address must be
 * public. Checking inside `lookup` (not before the request) also stops DNS rebinding, and
 * redirects are followed manually so each hop is checked again. Size and time are capped.
 */

export class FetchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FetchError';
  }
}

const BLOCKED_RANGES = {
  ipv4: [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
    ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ],
  ipv6: [
    ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32],
    ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ],
};

const blocked = new net.BlockList();
for (const [family, ranges] of Object.entries(BLOCKED_RANGES)) {
  for (const [address, prefix] of ranges) blocked.addSubnet(address, prefix, family);
}

/**
 * True for an address that is reachable on the public internet.
 * @param {string} address - IPv4 or IPv6 literal.
 * @returns {boolean}
 */
export function isPublicAddress(address) {
  if (typeof address !== 'string') return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const candidate = mapped ? mapped[1] : address;
  const family = net.isIP(candidate);
  if (family === 0) return false;
  return !blocked.check(candidate, family === 6 ? 'ipv6' : 'ipv4');
}

function createGuardedLookup(isPublic) {
  return function guardedLookup(hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    dns.lookup(hostname, options, (error, address, family) => {
      if (error) return callback(error);
      const entries = Array.isArray(address) ? address : [{ address, family }];
      if (entries.length === 0 || entries.some(entry => !isPublic(entry.address))) {
        return callback(new FetchError(`Blocked non-public address for ${hostname}`));
      }
      return callback(null, address, family);
    });
  };
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const ALLOWED_PORTS = new Set(['80', '443']);

// Node tries the addresses of a dual-stack host one after another ("Happy Eyeballs") and gives each
// only 250 ms by default. The container has no IPv6 route, so IPv6 fails at once; a slow IPv4
// handshake (one lost SYN through the rootless Docker network) then failed the whole request.
const ADDRESS_ATTEMPT_TIMEOUT_MS = 2_500;

/**
 * A failed Happy-Eyeballs connect is an AggregateError with an empty message; this lists the
 * attempts instead. Other errors are returned unchanged.
 * @param {Error} error
 * @returns {Error}
 */
export function connectError(error) {
  if (error?.message || !Array.isArray(error?.errors)) return error;
  const details = error.errors.map(inner => [inner.code || inner.message, inner.address && `${inner.address}:${inner.port}`].filter(Boolean).join(' '));
  return new FetchError(`Connection failed: ${details.join(' | ')}`);
}

const DECOMPRESSORS = {
  gzip: zlib.createGunzip,
  'x-gzip': zlib.createGunzip,
  deflate: zlib.createInflate,
  br: zlib.createBrotliDecompress,
};

function decompressor(encoding) {
  const create = DECOMPRESSORS[(encoding || '').toLowerCase()];
  return create ? create() : null;
}

function requestOnce(urlString, { method, headers, maxBytes, timeoutMs, isPublic, ports }) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      return reject(new FetchError(`Invalid URL: ${urlString}`));
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return reject(new FetchError(`Unsupported protocol: ${url.protocol}`));
    }
    if (url.username || url.password) {
      return reject(new FetchError('URLs with credentials are not allowed'));
    }
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    if (!ports.has(port)) {
      return reject(new FetchError(`Port not allowed: ${port}`));
    }
    // Literal IPs skip the DNS lookup, so they are checked here
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && !isPublic(host)) {
      return reject(new FetchError(`Blocked non-public address: ${host}`));
    }

    const transport = url.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(value);
    };
    const fail = (error) => {
      finish(reject, error);
      request.destroy();
    };
    const timer = setTimeout(() => fail(new FetchError(`Timeout after ${timeoutMs} ms`)), timeoutMs);

    const request = transport.request(url, {
      method,
      headers,
      lookup: createGuardedLookup(isPublic),
      autoSelectFamilyAttemptTimeout: ADDRESS_ATTEMPT_TIMEOUT_MS,
    }, (response) => {
      const status = response.statusCode || 0;
      const responseHeaders = response.headers;
      if (method === 'HEAD' || REDIRECT_STATUS.has(status)) {
        response.resume();
        return finish(resolve, { status, headers: responseHeaders, body: Buffer.alloc(0) });
      }

      // Without a listener an aborted response would be an uncaught exception
      response.on('error', fail);
      const decoder = decompressor(responseHeaders['content-encoding']);
      const source = decoder ? response.pipe(decoder) : response;
      const chunks = [];
      let size = 0;
      source.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          fail(new FetchError(`Response larger than ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      source.on('end', () => finish(resolve, { status, headers: responseHeaders, body: Buffer.concat(chunks) }));
      source.on('error', fail);
    });
    request.on('error', error => fail(connectError(error)));
    request.end();
  });
}

/**
 * Builds a fetch function with a given address policy. Production code uses the default export;
 * the parameters exist so tests can run against a local server.
 * @param {Object} [policy]
 * @param {(address: string) => boolean} [policy.isPublic]
 * @param {Set<string>} [policy.ports] - Allowed ports as strings.
 * @returns {Function} safeFetch
 */
export function createFetcher({ isPublic = isPublicAddress, ports = ALLOWED_PORTS } = {}) {
  /**
   * Fetches a URL with SSRF protection.
   *
   * @param {string} url - http(s) URL.
   * @param {Object} [options]
   * @param {string} [options.method='GET']
   * @param {Object} [options.headers]
   * @param {number} [options.maxBytes=2097152] - Limit for the (decompressed) body.
   * @param {number} [options.timeoutMs=10000] - Limit for one request, redirects count separately.
   * @param {number} [options.maxRedirects=3]
   * @returns {Promise<{status: number, headers: Object, body: Buffer, url: string}>}
   * @throws {FetchError} For blocked targets, oversized bodies, timeouts and too many redirects.
   */
  return async function safeFetch(url, options = {}) {
    const {
      method = 'GET',
      headers = {},
      maxBytes = 2 * 1024 * 1024,
      timeoutMs = 10_000,
      maxRedirects = 3,
    } = options;
    const requestHeaders = { 'Accept-Encoding': 'gzip, deflate, br', ...headers };

    let current = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const response = await requestOnce(current, { method, headers: requestHeaders, maxBytes, timeoutMs, isPublic, ports });
      if (REDIRECT_STATUS.has(response.status) && response.headers.location) {
        current = new URL(response.headers.location, current).toString();
        continue;
      }
      return { ...response, url: current };
    }
    throw new FetchError('Too many redirects');
  };
}

export const safeFetch = createFetcher();

/**
 * Decodes a response body to text; Latin-1 feeds are the only common non-UTF-8 case.
 * @param {{body: Buffer, headers: Object}} response
 * @returns {string}
 */
export function bodyText(response) {
  const type = String(response.headers['content-type'] || '');
  return response.body.toString(/charset=["']?(iso-8859-1|latin1|windows-1252)/i.test(type) ? 'latin1' : 'utf8');
}
