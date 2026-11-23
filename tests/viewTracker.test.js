/** @jest-environment node */
import { describe, it, expect } from '@jest/globals';
import viewTracker, { isBot } from '../utils/viewTracker.js';

const BROWSER_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
];

describe('viewTracker.isBot', () => {
  it.each([
    ['SoulSociety/2.0'],
    ['Mozilla/5.0 (compatible; heritrix/3.4.0 +https://example.org/crawler)'],
    ['firstpage/0.1'],
    ['Mozilla/5.0 (compatible; Dataprovider.com)'],
    ['Mozilla/5.0 (compatible; BuiltWith/1.0)'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36'],
    ['SomeFetcher/1.0 (+http://example.com/about)'],
    ['Mozilla/5.0 (compatible; Archiver; https://example.net)'],
  ])('recognises %s as a bot', (ua) => {
    expect(isBot(ua)).toBe(true);
  });

  it('keeps recognising the crawlers it knew before', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isBot('Mozilla/5.0 (compatible; AhrefsBot/7.0)')).toBe(true);
  });

  it.each(BROWSER_UAS)('lets the browser through: %s', (ua) => {
    expect(isBot(ua)).toBe(false);
  });

  it('treats a missing user agent as a bot', () => {
    expect(isBot(undefined)).toBe(true);
    expect(isBot('')).toBe(true);
  });
});

describe('viewTracker.shouldCount', () => {
  const ua = BROWSER_UAS[0];

  it('counts a browser view once per IP and post', () => {
    expect(viewTracker.shouldCount('198.51.100.1', 1, ua)).toBe(true);
    expect(viewTracker.shouldCount('198.51.100.1', 1, ua)).toBe(false);
    expect(viewTracker.shouldCount('198.51.100.1', 2, ua)).toBe(true);
    expect(viewTracker.shouldCount('198.51.100.2', 1, ua)).toBe(true);
  });

  it('does not count bots or an empty user agent', () => {
    expect(viewTracker.shouldCount('198.51.100.3', 1, 'SoulSociety/2.0')).toBe(false);
    expect(viewTracker.shouldCount('198.51.100.4', 1, '')).toBe(false);
    expect(viewTracker.shouldCount('198.51.100.5', 1, undefined)).toBe(false);
  });
});
