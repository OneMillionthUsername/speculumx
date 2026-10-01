/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import ejs from 'ejs';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockDb = {
  getPublishedPostsForHome: jest.fn(),
  getAllCategories: jest.fn(),
  searchPostsPaginated: jest.fn(),
  getPostsCountBySearch: jest.fn(),
  searchPostTitles: jest.fn(),
};

jest.unstable_mockModule('../databases/mariaDB.js', () => ({ DatabaseService: mockDb }));

const { default: staticPageController } = await import('../controllers/staticPageController.js');

const createReq = (query = {}) => ({ ip: '127.0.0.1', query, get: () => undefined, csrfToken: () => 'token' });
function createRes() {
  const res = { locals: {} };
  res.set = jest.fn(() => res);
  res.status = jest.fn(() => res);
  res.render = jest.fn(() => res);
  return res;
}

const dbPost = (over = {}) => ({
  id: 1, slug: 'spinoza', title: 'Spinoza und die Ewigkeit', author: 'D.M.', views: 3, published: true, category_id: 1,
  content: '<p>Ein langer Text über die <strong>Ewigkeit</strong> und mehr.</p>', tags: ['Philosophie'],
  created_at: new Date('2026-01-02'), updated_at: new Date('2026-01-02'), ...over,
});

describe('staticPageController.showSearchPage', () => {
  beforeEach(() => {
    mockDb.getAllCategories.mockResolvedValue([]);
    mockDb.searchPostsPaginated.mockResolvedValue([dbPost()]);
    mockDb.getPostsCountBySearch.mockResolvedValue(1);
  });

  it('renders results with highlight segments and pagination that keeps the query', async () => {
    const res = createRes();

    await staticPageController.showSearchPage(createReq({ q: 'ewigkeit  & mehr' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const [view, data] = res.render.mock.calls[0];
    expect(view).toBe('searchResults');
    expect(data.searchQuery).toBe('ewigkeit & mehr');
    expect(data.terms).toEqual(['ewigkeit', 'mehr']); // the single "&" is too short to search for
    expect(data.total).toBe(1);
    expect(data.posts[0].titleParts.some(p => p.match && p.text === 'Ewigkeit')).toBe(true);
    expect(data.posts[0].snippetParts.some(p => p.match)).toBe(true);
    expect(data.pagination).toEqual({ currentPage: 1, totalPages: 1, baseUrl: '/search', extraParams: `&q=${encodeURIComponent('ewigkeit & mehr')}` });
  });

  it('does not query the database for an empty or too short search', async () => {
    for (const q of [undefined, '', '   ', 'x', ['a', 'b']]) {
      const res = createRes();
      await staticPageController.showSearchPage(createReq({ q }), res);
      expect(res.render.mock.calls[0][0]).toBe('searchResults');
      expect(res.render.mock.calls[0][1].posts).toEqual([]);
    }
    expect(mockDb.searchPostsPaginated).not.toHaveBeenCalled();
  });

  it('offers categories when nothing was found', async () => {
    mockDb.searchPostsPaginated.mockResolvedValue([]);
    mockDb.getPostsCountBySearch.mockResolvedValue(0);
    mockDb.getAllCategories.mockResolvedValue([{ id: 1, name: 'Philosophie', slug: 'philosophie', description: 'x' }]);
    const res = createRes();

    await staticPageController.showSearchPage(createReq({ q: 'nichts' }), res);

    const data = res.render.mock.calls[0][1];
    expect(data.total).toBe(0);
    expect(data.categories).toHaveLength(1);
  });

  it('answers 404 for a page beyond the last one', async () => {
    const res = createRes();

    await staticPageController.showSearchPage(createReq({ q: 'ewigkeit', page: '5' }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render.mock.calls[0][0]).toBe('notFound');
  });

  it('renders an error state with status 500 when the database fails', async () => {
    mockDb.searchPostsPaginated.mockRejectedValue(new Error('db down'));
    const res = createRes();

    await staticPageController.showSearchPage(createReq({ q: 'ewigkeit' }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.render.mock.calls[0][1].searchFailed).toBe(true);
  });
});

describe('searchResults.ejs', () => {
  const viewPath = path.resolve(process.cwd(), 'views', 'searchResults.ejs');
  const tmpl = fs.readFileSync(viewPath, 'utf8');
  const render = (data) => ejs.render(tmpl, data, { filename: viewPath });

  it('escapes titles, snippets and the query while wrapping matches in <mark>', () => {
    const html = render({
      searchQuery: '<script>alert(1)</script>',
      terms: ['script'],
      total: 1,
      posts: [{
        id: 1, slug: 'x', title: 'T', author: 'A', created_at: new Date(), tags: ['<b>tag</b>'],
        titleParts: [{ text: '<img src=x onerror=alert(1)>', match: false }, { text: 'script', match: true }],
        snippetParts: [{ text: '<script>alert(1)</script>', match: false }],
      }],
      pagination: null,
      categories: [],
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;<mark>script</mark>');
    expect(html).toContain('&lt;b&gt;tag&lt;/b&gt;');
  });

  it('shows the matching summary line', () => {
    const none = render({ searchQuery: 'xyz', terms: ['xyz'], total: 0, posts: [], categories: [] });
    expect(none).toContain('Keine Treffer');
    const short = render({ searchQuery: 'x', terms: [], total: 0, posts: [], categories: [] });
    expect(short).toContain('mindestens zwei Zeichen');
    const failed = render({ searchQuery: 'xyz', terms: ['xyz'], total: 0, posts: [], categories: [], searchFailed: true });
    expect(failed).toContain('nicht verfügbar');
  });
});
