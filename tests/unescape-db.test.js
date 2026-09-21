/** @jest-environment node */
import { describe, expect, it, jest } from '@jest/globals';

// Mock mariaDB to avoid DB connection at import time
jest.unstable_mockModule('../databases/mariaDB.js', () => ({
  DatabaseService: {},
  initializeDatabase: jest.fn(),
  getDatabasePool: jest.fn(),
  isMockDatabase: jest.fn(() => true),
}));

const { unescapeFixpoint } = await import('../scripts/unescape-db.mjs');

describe('unescapeFixpoint', () => {
  it('unescapes single-escaped entities', () => {
    expect(unescapeFixpoint('&quot;Test&quot; &amp; mehr')).toBe('"Test" & mehr');
  });

  it('unescapes double-escaped entities in two iterations', () => {
    expect(unescapeFixpoint('&amp;quot;')).toBe('"');
    expect(unescapeFixpoint('&amp;amp;#39;')).toBe('\'');
  });

  it('leaves unknown entities like &nbsp; untouched', () => {
    // unescapeHtml kennt nur die 5 Standard-Entities
    expect(unescapeFixpoint('a&nbsp;b')).toBe('a&nbsp;b');
  });

  it('leaves plain text unchanged', () => {
    expect(unescapeFixpoint('Normaler Text ohne Entities')).toBe('Normaler Text ohne Entities');
  });

  it('returns non-strings unchanged', () => {
    expect(unescapeFixpoint(42)).toBe(42);
    expect(unescapeFixpoint(null)).toBe(null);
  });
});
