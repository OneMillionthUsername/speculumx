/** @jest-environment node */
import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';

// A fake pool stands in for MariaDB so the real DatabaseService code runs without a server
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

const { initializeDatabase, closeDatabase, isMockDatabase, DatabaseService } = await import('../databases/mariaDB.js');

describe('DatabaseService queries', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('uses the (fake) connection pool, not the built-in mock mode', () => {
    expect(isMockDatabase()).toBe(false);
  });

  it('getAllCards returns an empty list when no card is published', async () => {
    mockQuery.mockResolvedValue([]);

    await expect(DatabaseService.getAllCards()).resolves.toEqual([]);
  });

  describe('auto-generated draft cards', () => {
    it('createCard stores the auto_generated flag and defaults it to 0', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 1, insertId: 5n });

      const draft = await DatabaseService.createCard({ title: 'T', link: 'https://example.org/a', img_link: '/a.webp', published: false, auto_generated: true });
      expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO cards \(title, subtitle, link, img_link, published, auto_generated\)/);
      expect(mockQuery.mock.calls[0][1]).toEqual(['T', null, 'https://example.org/a', '/a.webp', 0, 1]);
      expect(draft.card).toMatchObject({ id: 5, published: false, auto_generated: true });

      mockQuery.mockClear();
      await DatabaseService.createCard({ title: 'T', link: 'https://example.org/a', img_link: '/a.webp' });
      expect(mockQuery.mock.calls[0][1].at(-1)).toBe(0);
    });

    it('updateCard turns a published card into a normal card but keeps the marker otherwise', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 1 });

      await DatabaseService.updateCard(7, { title: 'T', link: 'https://example.org/a', img_link: '/a.webp', published: true });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toMatch(/auto_generated = IF\(\? = 1, 0, auto_generated\)/);
      // published is passed for both placeholders, the id last
      expect(params).toEqual(['T', null, 'https://example.org/a', '/a.webp', 1, 1, 7]);
    });

    it('getExpiredAutoCards selects only unpublished auto-generated cards older than the retention time', async () => {
      mockQuery.mockResolvedValue([{ id: 3n, title: 'Old', img_link: '/a.webp', created_at: new Date('2026-08-01') }]);

      const rows = await DatabaseService.getExpiredAutoCards(30);

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toMatch(/WHERE auto_generated = 1 AND published = 0 AND created_at < DATE_SUB\(NOW\(\), INTERVAL \? DAY\)/);
      expect(params).toEqual([30]);
      expect(rows).toEqual([expect.objectContaining({ id: 3, title: 'Old' })]);
    });

    it.each([0, -1, 1.5, '30', undefined])('getExpiredAutoCards rejects the retention time %p', async (days) => {
      await expect(DatabaseService.getExpiredAutoCards(days)).rejects.toThrow(/positive integer/);
    });

    it('deleteExpiredAutoCard repeats the conditions in the DELETE and reports whether it deleted', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 1 });
      await expect(DatabaseService.deleteExpiredAutoCard(3)).resolves.toBe(true);
      expect(mockQuery).toHaveBeenCalledWith('DELETE FROM cards WHERE id = ? AND auto_generated = 1 AND published = 0', [3]);

      mockQuery.mockResolvedValue({ affectedRows: 0 });
      await expect(DatabaseService.deleteExpiredAutoCard(3)).resolves.toBe(false);
    });
  });

  it('getMostReadPosts only considers published posts', async () => {
    mockQuery.mockResolvedValue([]);

    await DatabaseService.getMostReadPosts();

    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE published = 1 ORDER BY views DESC/);
  });

  it('getArchivedYears only considers published posts', async () => {
    mockQuery.mockResolvedValue([{ year: 2025 }]);

    await expect(DatabaseService.getArchivedYears()).resolves.toEqual([2025]);
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE published = 1 AND/);
  });

  it('increasePostViews does not bump updated_at', async () => {
    mockQuery.mockResolvedValue({ affectedRows: 1 });

    await DatabaseService.increasePostViews(5);

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('updated_at = updated_at'), [5]);
  });
});
