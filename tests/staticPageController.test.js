/** @jest-environment node */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockDb = {
  getPublishedPostsForHome: jest.fn(),
  getAllCategories: jest.fn(),
  getCardsPaginated: jest.fn(),
  getPublishedCardsCount: jest.fn(),
};

jest.unstable_mockModule('../databases/mariaDB.js', () => ({
  DatabaseService: mockDb,
}));

const { default: staticPageController, excerptAtWordEnd, resolvePreviewImage } = await import('../controllers/staticPageController.js');

function createReq(query = {}) {
  return { ip: '127.0.0.1', query, get: () => undefined, csrfToken: () => 'token' };
}

function createRes() {
  const res = { locals: {} };
  res.set = jest.fn(() => res);
  res.status = jest.fn(() => res);
  res.render = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

describe('staticPageController.showHomePage', () => {
  beforeEach(() => {
    mockDb.getPublishedPostsForHome.mockResolvedValue([]);
    mockDb.getAllCategories.mockResolvedValue([]);
    mockDb.getCardsPaginated.mockResolvedValue([]);
    mockDb.getPublishedCardsCount.mockResolvedValue(0);
  });

  it('renders the home page when there are no published cards', async () => {
    const res = createRes();

    await staticPageController.showHomePage(createReq(), res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.render).toHaveBeenCalledWith('index', expect.objectContaining({ cards: [], cardsPagination: null }));
  });

  it('returns 404 for a cards page beyond the last one', async () => {
    const res = createRes();

    await staticPageController.showHomePage(createReq({ cardsPage: '2' }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('notFound', expect.any(Object));
  });
});

describe('staticPageController.showHomePage lead post', () => {
  const homePost = (n, over = {}) => ({
    id: n, slug: `post-${n}`, title: `Beitrag ${n}`, views: 10 * n, created_at: new Date(`2026-0${n}-01T10:00:00Z`),
    excerpt_source: `<p>${'Wort '.repeat(120)}</p>`, preview_source: '', ...over,
  });

  beforeEach(() => {
    mockDb.getAllCategories.mockResolvedValue([]);
    mockDb.getCardsPaginated.mockResolvedValue([]);
    mockDb.getPublishedCardsCount.mockResolvedValue(0);
  });

  it('passes the newest post as leadPost with a long teaser that ends on a whole word', async () => {
    mockDb.getPublishedPostsForHome.mockResolvedValue([homePost(3), homePost(2), homePost(1)]);
    const res = createRes();

    await staticPageController.showHomePage(createReq(), res);

    const data = res.render.mock.calls[0][1];
    expect(data.leadPost).toEqual(expect.objectContaining({ slug: 'post-3', title: 'Beitrag 3' }));
    expect(data.leadPost.excerpt.length).toBeGreaterThan(150);
    expect(data.leadPost.excerpt.length).toBeLessThanOrEqual(285);
    expect(data.leadPost.excerpt).toMatch(/Wort …$/);
    expect(data.featuredPosts.map(p => p.slug)).toEqual(['post-3', 'post-2', 'post-1']); // unchanged for the original theme
  });

  it('uses the first image of the newest post as it is stored (uploads have no -344/-688 variants)', async () => {
    const preview_source = '<p>Text</p><p><img src="/assets/media/2026/09/mein-beitrag-1.webp" alt=""></p><img src="/assets/media/2026/09/mein-beitrag-2.webp">';
    mockDb.getPublishedPostsForHome.mockResolvedValue([homePost(3, { preview_source }), homePost(2)]);
    const res = createRes();

    await staticPageController.showHomePage(createReq(), res);

    expect(res.render.mock.calls[0][1].leadPost.previewImage).toEqual({ src: '/assets/media/2026/09/mein-beitrag-1.webp', srcset: null });
  });

  it('has no leadPost without published posts', async () => {
    mockDb.getPublishedPostsForHome.mockResolvedValue([]);
    const res = createRes();

    await staticPageController.showHomePage(createReq(), res);

    expect(res.render.mock.calls[0][1].leadPost).toBeNull();
  });
});

describe('resolvePreviewImage', () => {
  it('returns the first image URL unchanged', () => {
    expect(resolvePreviewImage('<p><img class="x" src="/assets/media/2026/09/a-1.webp" alt="A"></p>')).toEqual({ src: '/assets/media/2026/09/a-1.webp', srcset: null });
    expect(resolvePreviewImage('<img src="https://example.org/a.jpg">')).toEqual({ src: 'https://example.org/a.jpg', srcset: null });
  });

  it('reduces an own absolute-path URL with a prefix to the site path', () => {
    expect(resolvePreviewImage('<img src="../assets/media/a-1.webp">').src).toBe('/assets/media/a-1.webp');
  });

  it('finds the image when the source is HTML-escaped', () => {
    expect(resolvePreviewImage('&lt;img src=&quot;/assets/media/a-1.webp&quot;&gt;').src).toBe('/assets/media/a-1.webp');
  });

  it('yields no image without an img tag or with an unusable source', () => {
    const none = { src: null, srcset: null };
    expect(resolvePreviewImage('<p>Nur Text</p>')).toEqual(none);
    expect(resolvePreviewImage('')).toEqual(none);
    expect(resolvePreviewImage(undefined)).toEqual(none);
    expect(resolvePreviewImage('<img src="data:image/png;base64,AAAA">')).toEqual(none);
    expect(resolvePreviewImage('<img src="javascript:alert(1)">')).toEqual(none);
    expect(resolvePreviewImage('<img src="bild.webp">')).toEqual(none);
  });
});

describe('excerptAtWordEnd', () => {
  it('returns short text unchanged, without markup', () => {
    expect(excerptAtWordEnd('<p>Kurzer <strong>Text</strong>.</p>', 100)).toBe('Kurzer Text.');
  });

  it('cuts at the last whole word and marks the cut', () => {
    const out = excerptAtWordEnd('eins zwei drei vier fünf sechs sieben acht neun zehn', 25);
    expect(out).toBe('eins zwei drei vier fünf …');
  });

  it('handles empty input and long words without spaces', () => {
    expect(excerptAtWordEnd('', 50)).toBe('');
    expect(excerptAtWordEnd(undefined, 50)).toBe('');
    expect(excerptAtWordEnd('x'.repeat(100), 20)).toBe(`${'x'.repeat(20)} …`);
  });
});
