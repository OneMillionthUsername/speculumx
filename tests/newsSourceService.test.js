/** @jest-environment node */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const {
  stripHtml, toPlainText, truncate, normalizeUrl, canonicalKey, parseFeed, fetchFeed,
  fetchHackerNews, mergeCandidates, capCandidates, collectCandidates,
} = await import('../services/newsSourceService.js');

const NOW = Date.parse('2026-10-01T12:00:00Z');
const day = n => new Date(NOW - n * 24 * 60 * 60 * 1000).toUTCString();

const rss = (items) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Feed</title>${items}</channel></rss>`;

const response = (body, status = 200, headers = {}) => ({
  status, headers: { 'content-type': 'application/xml', ...headers }, body: Buffer.from(body),
});

describe('text helpers', () => {
  it('strips tags, decodes entities and collapses whitespace', () => {
    expect(stripHtml('<p>Tom &amp; Jerry&nbsp;&mdash; <b>fun</b>\n\n&#8220;ok&#8221;</p>')).toBe('Tom & Jerry — fun “ok”');
    expect(stripHtml('Es ist <i>neu</i>. <p>Zweiter</p><p>Absatz</p>')).toBe('Es ist neu. Zweiter Absatz');
  });

  it('removes tags that only appear after decoding', () => {
    expect(toPlainText('&lt;b&gt;fett&lt;/b&gt; und normal')).toBe('fett und normal');
    expect(toPlainText('&lt;script&gt;alert(1)&lt;/script&gt;Hallo')).toBe('Hallo');
  });

  it('truncates at a word boundary with an ellipsis', () => {
    expect(truncate('kurz', 20)).toBe('kurz');
    const cut = truncate('ein sehr langer Satz mit vielen Wörtern darin', 25);
    expect(cut.length).toBeLessThanOrEqual(25);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toMatch(/\s…$/);
  });
});

describe('URL handling', () => {
  it('removes tracking parameters and the fragment', () => {
    expect(normalizeUrl('https://example.org/a?utm_source=x&id=7&fbclid=abc#top')).toBe('https://example.org/a?id=7');
  });

  it('rejects non-http URLs, garbage and over-long URLs', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('mailto:a@b.c')).toBeNull();
    expect(normalizeUrl('nonsense')).toBeNull();
    expect(normalizeUrl(`https://example.org/${'a'.repeat(1000)}`)).toBeNull();
  });

  it('treats scheme, www, trailing slash and parameter order as the same page', () => {
    const key = canonicalKey('https://www.Example.org/post/?b=2&a=1&utm_medium=x');
    expect(key).toBe(canonicalKey('http://example.org/post?a=1&b=2'));
    expect(canonicalKey('https://example.org/other')).not.toBe(key);
  });
});

describe('parseFeed', () => {
  it('reads RSS 2.0 items', () => {
    const items = parseFeed(rss(`
      <item><title>Neues &amp; Wichtiges</title><link>https://example.org/a?utm_source=rss</link>
        <pubDate>${day(1)}</pubDate><description><![CDATA[<p>Kurzfassung mit <b>Markup</b></p>]]></description></item>`),
    { name: 'Test' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Neues & Wichtiges',
      url: 'https://example.org/a',
      host: 'example.org',
      sources: ['Test'],
      points: null,
      summary: 'Kurzfassung mit Markup',
    });
    expect(items[0].published).toBeInstanceOf(Date);
  });

  it('reads Atom entries and prefers the alternate link', () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>Atom Titel</title>
        <link rel="self" href="https://example.org/self"/>
        <link rel="alternate" href="https://example.org/real"/>
        <updated>2026-09-30T10:00:00Z</updated><summary>Zusammenfassung</summary></entry></feed>`;
    const items = parseFeed(xml, { name: 'Atom' });
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://example.org/real');
    expect(items[0].summary).toBe('Zusammenfassung');
  });

  it('reads dc:date from RSS 1.0 style feeds', () => {
    const xml = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
      xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <item><title>RDF</title><link>https://example.org/rdf</link><dc:date>2026-09-30T10:00:00Z</dc:date></item></rdf:RDF>`;
    expect(parseFeed(xml, { name: 'RDF' })).toHaveLength(1);
  });

  it('tolerates bare ampersands, HTML entities and a BOM', () => {
    const xml = `${String.fromCharCode(0xFEFF)}  ${rss(`<item><title>A & B&nbsp;C</title><link>https://example.org/amp</link><pubDate>${day(1)}</pubDate></item>`)}`;
    const items = parseFeed(xml, { name: 'Messy' });
    expect(items[0].title).toBe('A & B C');
  });

  it('drops items without title, usable link or date', () => {
    const items = parseFeed(rss(`
      <item><link>https://example.org/no-title</link><pubDate>${day(1)}</pubDate></item>
      <item><title>No link</title><pubDate>${day(1)}</pubDate></item>
      <item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>${day(1)}</pubDate></item>
      <item><title>No date</title><link>https://example.org/no-date</link></item>
      <item><title>Fine</title><link>https://example.org/fine</link><pubDate>${day(1)}</pubDate></item>`),
    { name: 'Test' });
    expect(items.map(i => i.title)).toEqual(['Fine']);
  });

  it('throws on a document that is not XML', () => {
    expect(() => parseFeed('<html><body><p>Not a feed', { name: 'Broken' })).toThrow();
  });
});

describe('fetchFeed', () => {
  it('keeps only items inside the age window, newest first, capped per feed', async () => {
    const body = rss([0.5, 2, 9, 3, 1].map((age, i) => `
      <item><title>Item ${i}</title><link>https://example.org/${i}</link><pubDate>${day(age)}</pubDate></item>`).join(''));
    const fetchFn = jest.fn().mockResolvedValue(response(body));
    const items = await fetchFeed({ name: 'F', url: 'https://example.org/feed' }, { fetchFn, now: NOW, days: 7, perFeedMax: 3 });
    expect(items.map(i => i.title)).toEqual(['Item 0', 'Item 4', 'Item 1']);
  });

  it('fails on a non-200 response', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response('nope', 404));
    await expect(fetchFeed({ name: 'F', url: 'https://example.org/feed' }, { fetchFn, now: NOW })).rejects.toThrow('HTTP 404');
  });
});

describe('fetchHackerNews', () => {
  const hit = (overrides) => ({
    objectID: '1', title: 'Story', url: 'https://example.org/story', points: 300, num_comments: 120,
    created_at_i: Math.floor(NOW / 1000) - 3600, ...overrides,
  });

  it('queries the last 7 days by points and returns stories sorted by points', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(JSON.stringify({
      hits: [hit({ objectID: '1', points: 200 }), hit({ objectID: '2', url: 'https://example.org/b', points: 900 })],
    })));
    const items = await fetchHackerNews({ fetchFn, now: NOW, days: 7, minPoints: 150 });

    const requested = new URL(fetchFn.mock.calls[0][0]);
    expect(requested.hostname).toBe('hn.algolia.com');
    expect(requested.searchParams.get('tags')).toBe('story');
    const since = Math.floor((NOW - 7 * 24 * 3600 * 1000) / 1000);
    expect(requested.searchParams.get('numericFilters')).toBe(`created_at_i>${since},points>=150`);
    expect(items.map(i => i.points)).toEqual([900, 200]);
    expect(items[0]).toMatchObject({ sources: ['Hacker News'], comments: 120, discussion: 'https://news.ycombinator.com/item?id=2' });
  });

  it('skips Ask/Show/Tell HN and posts without an external link', async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(JSON.stringify({
      hits: [
        hit({ objectID: '1', title: 'Ask HN: Anyone?', url: 'https://example.org/ask' }),
        hit({ objectID: '2', title: 'Show HN: My thing', url: 'https://example.org/show' }),
        hit({ objectID: '3', url: null }),
        hit({ objectID: '4', url: 'javascript:alert(1)' }),
        hit({ objectID: '5', title: 'Real news', url: 'https://example.org/real' }),
      ],
    })));
    const items = await fetchHackerNews({ fetchFn, now: NOW });
    expect(items.map(i => i.title)).toEqual(['Real news']);
  });
});

describe('mergeCandidates', () => {
  const base = { published: new Date(NOW), summary: '', discussion: null, comments: null };

  it('merges the same page from several sources and keeps the HN signal', () => {
    const merged = mergeCandidates([
      { ...base, title: 'A', url: 'https://www.example.org/a/', host: 'example.org', sources: ['heise'], points: null, summary: 'feed summary' },
      { ...base, title: 'A (HN)', url: 'https://example.org/a?utm_source=hn', host: 'example.org', sources: ['Hacker News'], points: 640, comments: 210, discussion: 'https://news.ycombinator.com/item?id=9' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      title: 'A', sources: ['heise', 'Hacker News'], points: 640, comments: 210, summary: 'feed summary',
      discussion: 'https://news.ycombinator.com/item?id=9',
    });
  });

  it('keeps different pages apart', () => {
    const merged = mergeCandidates([
      { ...base, title: 'A', url: 'https://example.org/a', sources: ['x'], points: null },
      { ...base, title: 'B', url: 'https://example.org/b', sources: ['x'], points: null },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('capCandidates', () => {
  const make = (source, n, extra = {}) => Array.from({ length: n }, (_, i) => ({
    title: `${source} ${i}`, url: `https://${source}.example/${i}`, sources: [source], points: null,
    published: new Date(NOW - i * 3600 * 1000), ...extra,
  }));

  it('returns the list unchanged when it is short enough', () => {
    const list = make('a', 3);
    expect(capCandidates(list, 10)).toBe(list);
  });

  it('puts HN-backed stories first and shares the rest across sources', () => {
    const popular = make('hn', 10, { points: 500 }).map((c, i) => ({ ...c, points: 500 - i }));
    const list = [...popular, ...make('a', 20), ...make('b', 20)];
    const capped = capCandidates(list, 20);
    expect(capped).toHaveLength(20);
    expect(capped.slice(0, 8).every(c => c.points !== null)).toBe(true);
    expect(capped.filter(c => c.sources[0] === 'a').length).toBeGreaterThanOrEqual(5);
    expect(capped.filter(c => c.sources[0] === 'b').length).toBeGreaterThanOrEqual(5);
  });
});

describe('collectCandidates', () => {
  let fetchFn;
  beforeEach(() => {
    fetchFn = jest.fn(async (url) => {
      if (url.startsWith('https://hn.algolia.com')) return response(JSON.stringify({ hits: [] }));
      if (url.includes('broken')) throw new Error('getaddrinfo ENOTFOUND');
      return response(rss(`<item><title>T</title><link>https://example.org/t</link><pubDate>${day(1)}</pubDate></item>`));
    });
  });

  it('keeps going when a source fails and reports it', async () => {
    const { candidates, report } = await collectCandidates({
      fetchFn,
      now: NOW,
      feeds: [
        { id: 'ok', name: 'OK feed', url: 'https://example.org/feed' },
        { id: 'broken', name: 'Broken feed', url: 'https://broken.example/feed' },
      ],
    });
    expect(candidates).toHaveLength(1);
    expect(report.find(r => r.source === 'OK feed')).toMatchObject({ ok: true, count: 1 });
    expect(report.find(r => r.source === 'Broken feed')).toMatchObject({ ok: false, error: 'getaddrinfo ENOTFOUND' });
    expect(report.find(r => r.source === 'Hacker News')).toMatchObject({ ok: true, count: 0 });
  });

  it('tries a failed source once more', async () => {
    let calls = 0;
    const flaky = jest.fn(async (url) => {
      if (url.startsWith('https://hn.algolia.com') && calls++ === 0) throw new Error('Timeout after 10000 ms');
      return fetchFn(url);
    });
    const { report } = await collectCandidates({ fetchFn: flaky, now: NOW, feeds: [] });
    expect(report).toEqual([{ source: 'Hacker News', ok: true, count: 0 }]);
    expect(flaky).toHaveBeenCalledTimes(2);
  });
});
