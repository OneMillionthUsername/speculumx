/** @jest-environment node */
import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from '@jest/globals';

const mockQuery = jest.fn();
jest.unstable_mockModule('mariadb', () => ({
  createPool: () => ({
    getConnection: async () => ({ query: mockQuery, release: () => {} }),
    end: async () => {},
  }),
}));
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { initializeDatabase, closeDatabase, DatabaseService } = await import('../databases/mariaDB.js');

const post = (over = {}) => ({ id: 1n, title: 'T', slug: 't', content: '<p>x</p>', tags: '["a"]', published: 1, views: 0n, relevance: 3n, ...over });

describe('DatabaseService search', () => {
  beforeAll(async () => { await initializeDatabase(); });
  afterAll(async () => { await closeDatabase(); });
  beforeEach(() => { mockQuery.mockReset(); });

  it('does not touch the database without terms', async () => {
    await expect(DatabaseService.searchPostsPaginated([], 10, 0)).resolves.toEqual([]);
    await expect(DatabaseService.getPostsCountBySearch([])).resolves.toBe(0);
    await expect(DatabaseService.searchPostTitles([], 5)).resolves.toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('only searches published posts and requires every term (AND across title/content/tags)', async () => {
    mockQuery.mockResolvedValue([]);

    await DatabaseService.searchPostsPaginated(['spinoza', 'ewigkeit'], 10, 20);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/WHERE published = 1 AND \(title LIKE \? ESCAPE '\|' OR content LIKE \? ESCAPE '\|' OR tags LIKE \? ESCAPE '\|'\) AND \(/);
    expect(sql).toMatch(/ORDER BY relevance DESC, created_at DESC LIMIT \? OFFSET \?$/);
    // 2 terms x (3 relevance + 3 where) placeholders, then limit and offset
    expect(params).toHaveLength(2 * 6 + 2);
    expect(params.slice(-2)).toEqual([10, 20]);
  });

  it('binds the relevance parameters before the WHERE parameters, in SQL order', async () => {
    mockQuery.mockResolvedValue([]);

    await DatabaseService.searchPostsPaginated(['aa', 'bb'], 10, 0);

    const params = mockQuery.mock.calls[0][1];
    expect(params.slice(0, 6)).toEqual(['%aa%', '%aa%', '%aa%', '%bb%', '%bb%', '%bb%']); // relevance
    expect(params.slice(6, 12)).toEqual(['%aa%', '%aa%', '%aa%', '%bb%', '%bb%', '%bb%']); // where
  });

  it('escapes LIKE wildcards in user input and never inlines it into the SQL', async () => {
    mockQuery.mockResolvedValue([{ count: 0n }]);

    await DatabaseService.getPostsCountBySearch(['100%_|\' OR 1=1 --']);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('OR 1=1');
    // "%" -> "|%", "_" -> "|_", "|" -> "||"
    expect(params[0]).toBe('%100|%|_||\' OR 1=1 --%');
  });

  it('counts published matches', async () => {
    mockQuery.mockResolvedValue([{ count: 7n }]);

    await expect(DatabaseService.getPostsCountBySearch(['ethik'])).resolves.toBe(7);
    expect(mockQuery.mock.calls[0][0]).toMatch(/^SELECT COUNT\(\*\) AS count FROM posts WHERE published = 1 AND /);
  });

  it('returns normalised posts without the internal relevance column', async () => {
    mockQuery.mockResolvedValue([post()]);

    const [result] = await DatabaseService.searchPostsPaginated(['ethik'], 10, 0);

    expect(result).not.toHaveProperty('relevance');
    expect(result.id).toBe(1);
    expect(result.tags).toEqual(['a']);
    expect(result.published).toBe(true);
  });

  it('selects only title data for the live suggestions', async () => {
    mockQuery.mockResolvedValue([post({ id: 5n, title: 'Spinoza', slug: 'spinoza', created_at: '2026-01-01' })]);

    const rows = await DatabaseService.searchPostTitles(['spinoza'], 6);

    expect(mockQuery.mock.calls[0][0]).toMatch(/^SELECT id, title, slug, created_at, /);
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/SELECT \*/);
    expect(rows).toEqual([{ id: 5, title: 'Spinoza', slug: 'spinoza', created_at: '2026-01-01' }]);
  });

  it('wraps driver errors', async () => {
    mockQuery.mockRejectedValue(new Error('boom'));

    await expect(DatabaseService.searchPostsPaginated(['ethik'], 10, 0)).rejects.toThrow(/searchPostsPaginated/);
  });
});
