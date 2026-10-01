/** @jest-environment node */
import { describe, it, expect, jest } from '@jest/globals';
import {
  evaluateLicenseUrl, extractPageMeta, wikimediaFileName, assessCommonsMetadata, findLicensedImage,
} from '../services/imageLicenseService.js';

const page = (head) => `<!doctype html><html><head>${head}</head><body><p>x</p></body></html>`;
const html = (body, url = 'https://example.org/article') => ({
  status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(body), url,
});
const json = value => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) });

describe('evaluateLicenseUrl', () => {
  it.each([
    ['https://creativecommons.org/publicdomain/zero/1.0/', 'free'],
    ['http://creativecommons.org/publicdomain/mark/1.0/', 'free'],
    ['https://creativecommons.org/licenses/by/4.0/', 'attribution'],
    ['https://creativecommons.org/licenses/by-sa/4.0/deed.de', 'attribution'],
    ['https://creativecommons.org/licenses/by-nc/4.0/', 'restricted'],
    ['https://creativecommons.org/licenses/by-nd/4.0/', 'restricted'],
    ['https://example.org/terms', 'unknown'],
    ['', 'unknown'],
  ])('%s -> %s', (url, expected) => {
    expect(evaluateLicenseUrl(url)).toBe(expected);
  });
});

describe('extractPageMeta', () => {
  it('prefers og:image and resolves relative URLs against the page', () => {
    const meta = extractPageMeta(page(`
      <meta name="twitter:image" content="https://example.org/twitter.jpg">
      <meta property="og:image" content="/img/cover.jpg">`), 'https://example.org/article');
    expect(meta.imageUrl).toBe('https://example.org/img/cover.jpg');
  });

  it('returns null when there is no usable image', () => {
    expect(extractPageMeta(page(''), 'https://example.org/').imageUrl).toBeNull();
    expect(extractPageMeta(page('<meta property="og:image" content="data:image/png;base64,AAAA">'), 'https://example.org/').imageUrl).toBeNull();
  });

  it('collects licences from link, a and JSON-LD', () => {
    const meta = extractPageMeta(`<!doctype html><html><head>
      <link rel="license" href="https://creativecommons.org/publicdomain/zero/1.0/">
      <script type="application/ld+json">{"@type":"Article","image":{"@type":"ImageObject","license":"https://creativecommons.org/licenses/by/4.0/"}}</script>
      <script type="application/ld+json">{ this is not json</script>
      </head><body><a rel="noopener license" href="/terms">Terms</a></body></html>`, 'https://example.org/a');
    expect(meta.licenseUrls).toEqual([
      'https://creativecommons.org/publicdomain/zero/1.0/',
      'https://example.org/terms',
      'https://creativecommons.org/licenses/by/4.0/',
    ]);
  });
});

describe('wikimediaFileName', () => {
  it.each([
    ['https://upload.wikimedia.org/wikipedia/commons/a/ab/Mount_Everest.jpg', 'Mount_Everest.jpg'],
    ['https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Mount_Everest.jpg/1200px-Mount_Everest.jpg', 'Mount_Everest.jpg'],
    ['https://upload.wikimedia.org/wikipedia/commons/a/ab/K%C3%B6ln.jpg', 'Köln.jpg'],
  ])('%s', (url, expected) => {
    expect(wikimediaFileName(url)).toBe(expected);
  });

  it('ignores files that are not on Commons', () => {
    expect(wikimediaFileName('https://upload.wikimedia.org/wikipedia/en/a/ab/Logo.png')).toBeNull();
    expect(wikimediaFileName('https://example.org/wikipedia/commons/a/ab/x.jpg')).toBeNull();
    expect(wikimediaFileName('nonsense')).toBeNull();
  });
});

describe('assessCommonsMetadata', () => {
  const md = (overrides) => Object.fromEntries(Object.entries({
    LicenseShortName: 'CC0', AttributionRequired: 'false', NonFree: 'false', ...overrides,
  }).filter(([, v]) => v !== undefined).map(([k, v]) => [k, { value: v }]));

  it('accepts CC0 and public domain', () => {
    expect(assessCommonsMetadata(md({})).ok).toBe(true);
    expect(assessCommonsMetadata(md({ LicenseShortName: 'Public domain' })).ok).toBe(true);
  });

  it.each([
    ['attribution required', md({ LicenseShortName: 'CC BY-SA 4.0', AttributionRequired: 'true' })],
    ['non-free', md({ NonFree: 'true' })],
    ['restrictions', md({ Restrictions: 'personality' })],
    ['unknown attribution flag', md({ AttributionRequired: undefined })],
    ['other licence', md({ LicenseShortName: 'Fair use' })],
  ])('rejects %s', (_label, metadata) => {
    expect(assessCommonsMetadata(metadata).ok).toBe(false);
  });
});

describe('findLicensedImage', () => {
  it('accepts a CC0 page whose image is on the same site', async () => {
    const fetchFn = jest.fn().mockResolvedValue(html(page(`
      <link rel="license" href="https://creativecommons.org/publicdomain/zero/1.0/">
      <meta property="og:image" content="https://cdn.example.org/cover.jpg">`)));
    const result = await findLicensedImage('https://example.org/article', { fetchFn });
    expect(result).toMatchObject({ imageUrl: 'https://cdn.example.org/cover.jpg', license: 'https://creativecommons.org/publicdomain/zero/1.0/' });
  });

  it.each([
    ['no licence statement', page('<meta property="og:image" content="https://example.org/c.jpg">'), /no licence information/],
    ['no image', page('<link rel="license" href="https://creativecommons.org/publicdomain/zero/1.0/">'), /no preview image/],
    ['a CC BY licence (needs a credit line)', page(`<link rel="license" href="https://creativecommons.org/licenses/by/4.0/">
      <meta property="og:image" content="https://example.org/c.jpg">`), /not CC0/],
    ['CC0 next to another licence', page(`<link rel="license" href="https://creativecommons.org/publicdomain/zero/1.0/">
      <a rel="license" href="https://example.org/all-rights-reserved">x</a>
      <meta property="og:image" content="https://example.org/c.jpg">`), /not CC0/],
    ['an image on a foreign site', page(`<link rel="license" href="https://creativecommons.org/publicdomain/zero/1.0/">
      <meta property="og:image" content="https://stock.example.net/c.jpg">`), /another site/],
  ])('gives no image for %s', async (_label, body, reason) => {
    const fetchFn = jest.fn().mockResolvedValue(html(body));
    const result = await findLicensedImage('https://example.org/article', { fetchFn });
    expect(result.imageUrl).toBeNull();
    expect(result.reason).toMatch(reason);
  });

  it('gives no image when the page cannot be loaded or is not HTML', async () => {
    const down = jest.fn().mockRejectedValue(new Error('Blocked non-public address'));
    expect((await findLicensedImage('https://example.org/a', { fetchFn: down })).reason).toMatch(/not reachable/);
    const pdf = jest.fn().mockResolvedValue({ status: 200, headers: { 'content-type': 'application/pdf' }, body: Buffer.from('%PDF') });
    expect((await findLicensedImage('https://example.org/a', { fetchFn: pdf })).imageUrl).toBeNull();
  });

  it('asks Commons for images on upload.wikimedia.org and accepts a CC0 file', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(html(page('<meta property="og:image" content="https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Nebula.jpg/1200px-Nebula.jpg">')))
      .mockResolvedValueOnce(json({ query: { pages: [{ imageinfo: [{ extmetadata: {
        LicenseShortName: { value: 'CC0' }, AttributionRequired: { value: 'false' }, NonFree: { value: 'false' },
      } }] }] } }));
    const result = await findLicensedImage('https://example.org/article', { fetchFn });
    expect(result).toMatchObject({ imageUrl: expect.stringContaining('upload.wikimedia.org'), license: 'CC0' });
    const commonsUrl = new URL(fetchFn.mock.calls[1][0]);
    expect(commonsUrl.hostname).toBe('commons.wikimedia.org');
    expect(commonsUrl.searchParams.get('titles')).toBe('File:Nebula.jpg');
  });

  it('rejects a Commons file that needs attribution', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(html(page('<meta property="og:image" content="https://upload.wikimedia.org/wikipedia/commons/a/ab/Nebula.jpg">')))
      .mockResolvedValueOnce(json({ query: { pages: [{ imageinfo: [{ extmetadata: {
        LicenseShortName: { value: 'CC BY-SA 4.0' }, AttributionRequired: { value: 'true' },
      } }] }] } }));
    const result = await findLicensedImage('https://example.org/article', { fetchFn });
    expect(result.imageUrl).toBeNull();
    expect(result.reason).toMatch(/attribution required/);
  });
});
