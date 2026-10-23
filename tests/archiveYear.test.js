/** @jest-environment node */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';

// The archive routes take ?year= from the query string. Invalid values used to become NaN, which the MariaDB
// connector wrote into the SQL as a bare token ("Unknown column 'NaN'") and the request ended in a 500.
// They must answer 400 without touching the database, and valid years must reach it as numbers.

const getArchivedPostsPaginated = jest.fn();
const getArchivedPosts = jest.fn();
const getArchivedYears = jest.fn();
const passThrough = (req, res, next) => next();

jest.unstable_mockModule('../controllers/postController.js', () => ({
  default: { getArchivedPosts, getArchivedYears },
  getAllPostsPaginated: jest.fn(),
  getPostsByCategoryPaginated: jest.fn(),
  getPostsByTagPaginated: jest.fn(),
  getArchivedPostsPaginated,
  searchPostSuggestions: jest.fn(),
  PAGE_SIZE: 10,
}));
jest.unstable_mockModule('../controllers/commentController.js', () => ({ default: {} }));
jest.unstable_mockModule('../databases/mariaDB.js', () => ({ DatabaseService: {} }));
jest.unstable_mockModule('../utils/csrf.js', () => ({ default: passThrough }));
jest.unstable_mockModule('../utils/limiters.js', () => ({ globalLimiter: passThrough, strictLimiter: passThrough, COMMENT_LIMIT_MESSAGE: '' }));
jest.unstable_mockModule('../middleware/authMiddleware.js', () => ({ authenticateToken: passThrough, requireAdmin: passThrough }));
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { parseArchiveYear } = await import('../utils/requestUtils.js');
const { default: postRouter } = await import('../routes/postRoutes.js');
const { default: postApiRouter } = await import('../routes/postApiRoutes.js');
const { default: simpleCache } = await import('../utils/simpleCache.js');
const request = (await import('supertest')).default;

const app = express();
// Answer with the view name and pagination params instead of rendering EJS
app.use((req, res, next) => {
  res.render = (view, options = {}) => res.send(JSON.stringify({ view, extraParams: options.pagination?.extraParams }));
  next();
});
app.use('/blogpost', postRouter);
app.use('/api/blogpost', postApiRouter);

const INVALID = ['abc', 'Infinity', '2024.5', '-1', '0x7E8', '2024.0', '1e3', '1969', String(new Date().getFullYear() + 2)];

describe('parseArchiveYear', () => {
  it('treats a missing or empty value as "no filter"', () => {
    expect(parseArchiveYear(undefined)).toEqual({ year: undefined, valid: true });
    expect(parseArchiveYear('')).toEqual({ year: undefined, valid: true });
    expect(parseArchiveYear('   ')).toEqual({ year: undefined, valid: true });
  });

  it('accepts plain years and normalises surrounding whitespace', () => {
    expect(parseArchiveYear('2025')).toEqual({ year: 2025, valid: true });
    expect(parseArchiveYear(' 2024 ')).toEqual({ year: 2024, valid: true });
  });

  it.each(INVALID)('rejects %p', (raw) => {
    expect(parseArchiveYear(raw)).toEqual({ year: undefined, valid: false });
  });

  it('rejects repeated parameters (arrays) and objects', () => {
    expect(parseArchiveYear(['2024', '2025']).valid).toBe(false);
    expect(parseArchiveYear({ a: '2024' }).valid).toBe(false);
  });
});

describe('GET /blogpost/archive', () => {
  beforeEach(() => {
    simpleCache.clear();
    getArchivedPostsPaginated.mockReset().mockResolvedValue({ posts: [{ id: 1, title: 'T', content: '<p>x</p>' }], total: 1 });
    getArchivedYears.mockReset().mockResolvedValue([2025]);
  });

  it.each([...INVALID, '<script>alert(1)</script>'])('answers 400 for year=%p without querying', async (raw) => {
    const res = await request(app).get('/blogpost/archive').query({ year: raw }).expect(400);
    expect(JSON.parse(res.text).view).toBe('error');
    expect(getArchivedPostsPaginated).not.toHaveBeenCalled();
  });

  it('passes a valid year as a number and builds pagination from it', async () => {
    const res = await request(app).get('/blogpost/archive').query({ year: ' 2025' }).expect(200);
    expect(getArchivedPostsPaginated).toHaveBeenCalledWith(2025, 1);
    expect(JSON.parse(res.text).extraParams).toBe('&year=2025');
  });

  it('lists all years for an empty value', async () => {
    await request(app).get('/blogpost/archive?year=').expect(200);
    expect(getArchivedPostsPaginated).toHaveBeenCalledWith(undefined, 1);
  });
});

describe('GET /api/blogpost/archive', () => {
  beforeEach(() => {
    simpleCache.clear();
    getArchivedPosts.mockReset().mockResolvedValue([{ id: 1, title: 'T' }]);
    getArchivedYears.mockReset().mockResolvedValue([2025]);
  });

  it.each(INVALID)('answers 400 for year=%p without querying or caching', async (raw) => {
    await request(app).get('/api/blogpost/archive').query({ year: raw }).expect(400);
    expect(getArchivedPosts).not.toHaveBeenCalled();
    expect(simpleCache.getStats().entries).toBe(0);
  });

  it('caches by the normalised year, so whitespace variants share one entry', async () => {
    await request(app).get('/api/blogpost/archive').query({ year: '2025' }).expect(200);
    await request(app).get('/api/blogpost/archive').query({ year: ' 2025 ' }).expect(200);
    expect(getArchivedPosts).toHaveBeenCalledTimes(1);
    expect(getArchivedPosts).toHaveBeenCalledWith(2025);
    expect(simpleCache.get('posts:archive:2025')).not.toBeNull();
  });
});
