/** @jest-environment node */
import { describe, it, expect, jest } from '@jest/globals';
import express from 'express';

// sitemapRoutes only needs the readiness flag from app.js; importing the real
// app would start the whole server initialisation.
jest.unstable_mockModule('../app.js', () => ({
  isAppReady: () => true,
}));

const mockGetAllPosts = jest.fn();
jest.unstable_mockModule('../databases/mariaDB.js', () => ({
  DatabaseService: { getAllPosts: mockGetAllPosts },
}));

const { default: sitemapRouter } = await import('../routes/sitemapRoutes.js');
const request = (await import('supertest')).default;

function buildApp() {
  const app = express();
  app.use('/', sitemapRouter);
  return app;
}

describe('GET /sitemap.xml', () => {
  it('lists only existing static pages and published posts', async () => {
    mockGetAllPosts.mockResolvedValue([
      { id: 1, slug: 'erster-post', published: true, created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date('2026-02-01T00:00:00Z') },
      { id: 2, slug: 'entwurf', published: false, created_at: new Date('2026-01-02T00:00:00Z') },
    ]);

    const res = await request(buildApp())
      .get('/sitemap.xml')
      .set('Host', 'speculumx.at')
      .set('X-Forwarded-Proto', 'https');

    expect(res.status).toBe(200);
    const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    expect(locs).toEqual([
      'https://speculumx.at/',
      'https://speculumx.at/about',
      'https://speculumx.at/posts',
      'https://speculumx.at/blogpost/archive',
      'https://speculumx.at/blogpost/erster-post',
    ]);
    // lastmod reflects the last content change, not the creation date
    expect(res.text).toContain('<lastmod>2026-02-01T00:00:00.000Z</lastmod>');
  });
});
