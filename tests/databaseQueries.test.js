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
