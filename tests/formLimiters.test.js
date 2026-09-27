/** @jest-environment node */
import { describe, it, expect, jest } from '@jest/globals';
import express from 'express';

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, auth: () => {}, authEvent: () => {} },
}));

const { commentLimiter, contactLimiter } = await import('../utils/limiters.js');
const request = (await import('supertest')).default;

// Behind Nginx: req.ip is the last X-Forwarded-For entry, so each test uses its own client IP
function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.post('/comments/:postId', commentLimiter, (req, res) => res.redirect(303, '/ok'));
  app.post('/api/comments/:postId', commentLimiter, (req, res) => res.json({ success: true }));
  app.post('/contact', contactLimiter, (req, res) => res.json({ success: true }));
  return app;
}

describe('commentLimiter', () => {
  it('allows 10 comments per client, shared between form and JSON API', async () => {
    const app = buildApp();
    const ip = '203.0.113.31';
    for (let i = 0; i < 5; i++) {
      await request(app).post('/comments/7').set('X-Forwarded-For', ip).type('form').send({ text: 'Hallo' }).expect(303);
      await request(app).post('/api/comments/7').set('X-Forwarded-For', ip).send({ text: 'Hallo' }).expect(200);
    }

    const res = await request(app).post('/api/comments/7').set('X-Forwarded-For', ip).send({ text: 'Hallo' });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Zu viele Kommentare/);
  });

  it('sends a blocked form post back to the post with a notice', async () => {
    const app = buildApp();
    const ip = '203.0.113.32';
    for (let i = 0; i < 10; i++) {
      await request(app).post('/comments/7').set('X-Forwarded-For', ip).type('form').send({ text: 'Hallo' });
    }

    const fromPost = await request(app)
      .post('/comments/7')
      .set('X-Forwarded-For', ip)
      .set('Referer', 'http://127.0.0.1/blogpost/mein-post?comment=ok')
      .type('form')
      .send({ text: 'Hallo' });
    const withoutReferer = await request(app).post('/comments/7').set('X-Forwarded-For', ip).type('form').send({ text: 'Hallo' });

    expect(fromPost.status).toBe(303);
    expect(fromPost.headers.location).toBe('/blogpost/mein-post?comment=ratelimit#comments-section');
    expect(withoutReferer.headers.location).toBe('/blogpost/id/7?comment=ratelimit#comments-section');
  });
});

describe('contactLimiter', () => {
  it('allows 5 messages per client and hour, then answers with a readable error', async () => {
    const app = buildApp();
    const ip = '203.0.113.33';
    for (let i = 0; i < 5; i++) {
      await request(app).post('/contact').set('X-Forwarded-For', ip).send({ message: 'Hallo' }).expect(200);
    }

    const res = await request(app).post('/contact').set('X-Forwarded-For', ip).send({ message: 'Hallo' });
    const otherClient = await request(app).post('/contact').set('X-Forwarded-For', '203.0.113.34').send({ message: 'Hallo' });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ success: false, error: expect.stringMatching(/Zu viele Nachrichten/) });
    expect(otherClient.status).toBe(200);
  });
});
