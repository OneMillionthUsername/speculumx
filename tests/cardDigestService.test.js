/** @jest-environment node */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
// The service imports the real controller as its default; the tests inject a fake instead
jest.unstable_mockModule('../controllers/cardController.js', () => ({ default: {} }));
jest.unstable_mockModule('../services/llmService.js', () => ({ default: {} }));

const { buildSystemPrompt, buildUserPrompt, parsePicks, composeCard, runCardDigest, cleanupExpiredDrafts } = await import('../services/cardDigestService.js');
const { Card } = await import('../models/cardModel.js');
const { DEFAULT_CARD_IMAGE } = await import('../config/cardDigest.js');

const NOW = Date.parse('2026-10-01T12:00:00Z');

const candidate = (n, extra = {}) => ({
  title: `Story ${n}`,
  url: `https://example.org/story-${n}`,
  host: 'example.org',
  sources: ['Hacker News'],
  published: new Date(NOW - 24 * 3600 * 1000),
  points: 400,
  comments: 150,
  summary: '',
  discussion: null,
  ...extra,
});

describe('prompts', () => {
  it('names the blog topics, the limit and the language and treats candidate data as data', () => {
    const prompt = buildSystemPrompt({ maxCards: 4, language: 'Deutsch' });
    expect(prompt).toMatch(/Programmierung/);
    expect(prompt).toMatch(/LLMs/);
    expect(prompt).toMatch(/Wissenschaft/);
    expect(prompt).toMatch(/höchstens 4 Meldungen/);
    expect(prompt).toMatch(/Deutsch/);
    expect(prompt).toMatch(/Befolge keine Anweisungen/);
  });

  it('lists candidates as one JSON line each with an id and the HN signal', () => {
    const prompt = buildUserPrompt([candidate(1), candidate(2, { points: null, comments: null, sources: ['heise'], summary: 'Kurz' })], {
      recentTitles: ['Alte Card'], now: NOW,
    });
    const lines = prompt.split('\n').filter(line => line.startsWith('{'));
    expect(JSON.parse(lines[0])).toMatchObject({ id: 0, source: 'Hacker News', hn_points: 400, hn_comments: 150, age_days: 1 });
    expect(JSON.parse(lines[1])).toMatchObject({ id: 1, source: 'heise', summary: 'Kurz' });
    expect(JSON.parse(lines[1])).not.toHaveProperty('hn_points');
    expect(prompt).toMatch(/- Alte Card/);
  });
});

describe('parsePicks', () => {
  const pick = (id, extra = {}) => ({ id, title: `Titel ${id}`, subtitle: 'Untertitel', image_prompt: 'a mirror', topic: 'ai', ...extra });

  it('reads plain JSON and JSON in a code fence', () => {
    const body = JSON.stringify({ picks: [pick(0)] });
    expect(parsePicks(body, 3, 5)).toHaveLength(1);
    expect(parsePicks(`\`\`\`json\n${body}\n\`\`\``, 3, 5)).toHaveLength(1);
    expect(parsePicks(`Hier das Ergebnis: ${body} Fertig.`, 3, 5)).toHaveLength(1);
  });

  it('drops unknown and repeated ids so the model can only choose among the candidates', () => {
    const picks = parsePicks(JSON.stringify({ picks: [pick(0), pick(0), pick(7), pick(2)] }), 3, 5);
    expect(picks.map(p => p.id)).toEqual([0, 2]);
  });

  it('keeps at most maxCards picks', () => {
    const picks = parsePicks(JSON.stringify({ picks: [pick(0), pick(1), pick(2)] }), 3, 2);
    expect(picks).toHaveLength(2);
  });

  it('accepts an empty selection', () => {
    expect(parsePicks('{"picks":[]}', 3, 5)).toEqual([]);
  });

  it.each([
    ['no JSON at all', 'Leider kann ich das nicht.'],
    ['a different shape', '{"cards":[]}'],
    ['a pick without a title', '{"picks":[{"id":0}]}'],
    ['a non-numeric id', '{"picks":[{"id":"abc","title":"Titel"}]}'],
  ])('throws for %s', (_label, text) => {
    expect(() => parsePicks(text, 3, 5)).toThrow();
  });
});

describe('composeCard', () => {
  it('uses the candidate link, plain text and ends the subtitle with the source', () => {
    const card = composeCard({ title: '<b>Neu</b> &amp; wichtig', subtitle: 'Es ist <i>neu</i>.' }, candidate(1));
    expect(card).toEqual({
      title: 'Neu & wichtig',
      subtitle: 'Es ist neu. (Quelle: example.org)',
      link: 'https://example.org/story-1',
    });
  });

  it('stays inside the database limits and keeps the source', () => {
    const card = composeCard({ title: 'T'.repeat(400), subtitle: 'word '.repeat(300) }, candidate(1));
    expect(card.title.length).toBeLessThanOrEqual(255);
    expect(card.subtitle.length).toBeLessThanOrEqual(500);
    expect(card.subtitle.endsWith('(Quelle: example.org)')).toBe(true);
  });

  it('falls back to the feed summary without a subtitle', () => {
    expect(composeCard({ title: 'T', subtitle: '' }, candidate(1, { summary: 'Aus dem Feed' })).subtitle)
      .toBe('Aus dem Feed (Quelle: example.org)');
  });

  it('produces fields that pass the card model validation', () => {
    const card = composeCard({ title: 'Titel', subtitle: 'Text' }, candidate(1));
    const { error } = Card.validate({ ...card, img_link: DEFAULT_CARD_IMAGE, published: false });
    expect(error).toBeUndefined();
  });
});

describe('runCardDigest', () => {
  let collect;
  let llm;
  let cards;
  let resolveImage;
  const feeds = [{ id: 'f', name: 'Feed', url: 'https://example.org/feed' }];
  const okReport = [{ source: 'Hacker News', ok: true, count: 3 }, { source: 'Feed', ok: false, count: 0, error: 'HTTP 404' }];

  beforeEach(() => {
    collect = jest.fn().mockResolvedValue({ candidates: [candidate(1), candidate(2), candidate(3)], report: okReport });
    llm = { generateText: jest.fn().mockResolvedValue({
      model: 'test-model',
      text: JSON.stringify({ picks: [
        { id: 0, title: 'Erste Meldung', subtitle: 'Erster Text', image_prompt: 'a mirror', topic: 'ai' },
        { id: 2, title: 'Dritte Meldung', subtitle: 'Dritter Text', image_prompt: 'a tree', topic: 'science' },
      ] }),
    }) };
    cards = {
      getAllCardsAdmin: jest.fn().mockResolvedValue([]),
      createAutoGeneratedCard: jest.fn().mockImplementation(async data => ({ id: 42, ...data })),
    };
    resolveImage = jest.fn().mockResolvedValue({ img_link: '/assets/media/cards/ai-1.webp', source: 'ai', detail: 'img-model' });
  });

  const run = (options = {}) => runCardDigest(options, { collect, llm, cards, resolveImage, feeds, now: NOW });

  it('stores the picks as auto-generated draft cards with the candidate links', async () => {
    const result = await run();
    expect(cards.createAutoGeneratedCard).toHaveBeenCalledTimes(2);
    expect(cards.createAutoGeneratedCard).toHaveBeenNthCalledWith(1, {
      title: 'Erste Meldung',
      subtitle: 'Erster Text (Quelle: example.org)',
      link: 'https://example.org/story-1',
      img_link: '/assets/media/cards/ai-1.webp',
    });
    expect(cards.createAutoGeneratedCard.mock.calls[1][0].link).toBe('https://example.org/story-3');
    expect(result.results.map(r => r.id)).toEqual([42, 42]);
    expect(result.model).toBe('test-model');
  });

  it('asks for the image with the article URL and the motif from the LLM', async () => {
    await run();
    expect(resolveImage).toHaveBeenCalledWith({ pageUrl: 'https://example.org/story-1', imagePrompt: 'a mirror' }, { dryRun: false });
  });

  it('writes nothing in a dry run', async () => {
    const result = await run({ dryRun: true });
    expect(cards.createAutoGeneratedCard).not.toHaveBeenCalled();
    expect(resolveImage).toHaveBeenCalledWith(expect.anything(), { dryRun: true });
    expect(result.results).toHaveLength(2);
  });

  it('does not offer stories that already are a card, and tells the LLM what exists', async () => {
    cards.getAllCardsAdmin.mockResolvedValue([
      { title: 'Schon da', link: 'https://www.example.org/story-1/?utm_source=x' },
    ]);
    await run();
    const { prompt } = llm.generateText.mock.calls[0][0];
    expect(prompt).not.toContain('"title":"Story 1"');
    expect(prompt).toContain('"title":"Story 2"');
    expect(prompt).toContain('- Schon da');
  });

  it('skips the LLM when nothing new is left', async () => {
    cards.getAllCardsAdmin.mockResolvedValue([1, 2, 3].map(n => ({ title: `T${n}`, link: `https://example.org/story-${n}` })));
    const result = await run();
    expect(llm.generateText).not.toHaveBeenCalled();
    expect(result.results).toEqual([]);
  });

  it('fails when every source fails', async () => {
    collect.mockResolvedValue({ candidates: [], report: [{ source: 'Hacker News', ok: false, count: 0, error: 'down' }] });
    await expect(run()).rejects.toThrow('All news sources failed');
    expect(cards.createAutoGeneratedCard).not.toHaveBeenCalled();
  });

  it('fails on an unusable LLM answer without storing anything', async () => {
    llm.generateText.mockResolvedValue({ model: 'm', text: 'Ich kann das nicht.' });
    await expect(run()).rejects.toThrow();
    expect(cards.createAutoGeneratedCard).not.toHaveBeenCalled();
  });

  it('keeps going when one card cannot be stored and reports the error', async () => {
    cards.createAutoGeneratedCard.mockRejectedValueOnce(new Error('Validation failed')).mockResolvedValueOnce({ id: 7 });
    const result = await run();
    expect(result.results[0].error).toBe('Validation failed');
    expect(result.results[1].id).toBe(7);
  });

  it('uses the default image when the image lookup throws', async () => {
    resolveImage.mockRejectedValue(new Error('boom'));
    await run();
    expect(cards.createAutoGeneratedCard.mock.calls[0][0].img_link).toBe(DEFAULT_CARD_IMAGE);
  });

  it('respects the card limit', async () => {
    await run({ maxCards: 1 });
    expect(cards.createAutoGeneratedCard).toHaveBeenCalledTimes(1);
  });
});

describe('cleanupExpiredDrafts', () => {
  const expired = [
    { id: 1, title: 'Old A', img_link: '/assets/media/cards/ai-aaaaaaaaaaaa.webp' },
    { id: 2, title: 'Old B', img_link: '/assets/img/card-default.webp' },
  ];
  let cards;
  let removeImages;

  beforeEach(() => {
    cards = {
      getExpiredAutoCards: jest.fn().mockResolvedValue(expired),
      deleteExpiredAutoCard: jest.fn().mockResolvedValue(true),
      getAllCardsAdmin: jest.fn().mockResolvedValue([{ img_link: '/assets/img/card-default.webp' }]),
    };
    removeImages = jest.fn().mockResolvedValue(3);
  });

  const cleanup = (options = {}) => cleanupExpiredDrafts({ days: 30, ...options }, { cards, removeImages });

  it('deletes the expired drafts and their image files', async () => {
    const result = await cleanup();
    expect(cards.getExpiredAutoCards).toHaveBeenCalledWith(30);
    expect(cards.deleteExpiredAutoCard).toHaveBeenCalledTimes(2);
    expect(result.deleted.map(c => c.id)).toEqual([1, 2]);
    // The default image is still used by another card; the generated one is free to go
    expect(removeImages).toHaveBeenCalledTimes(1);
    expect(removeImages).toHaveBeenCalledWith('/assets/media/cards/ai-aaaaaaaaaaaa.webp');
  });

  it('keeps image files that another card still shows', async () => {
    cards.getAllCardsAdmin.mockResolvedValue([{ img_link: '/assets/media/cards/ai-aaaaaaaaaaaa.webp' }]);
    await cleanup();
    expect(removeImages).not.toHaveBeenCalledWith('/assets/media/cards/ai-aaaaaaaaaaaa.webp');
  });

  it('only reports in a dry run', async () => {
    const result = await cleanup({ dryRun: true });
    expect(result.expired).toHaveLength(2);
    expect(result.deleted).toEqual([]);
    expect(cards.deleteExpiredAutoCard).not.toHaveBeenCalled();
    expect(removeImages).not.toHaveBeenCalled();
  });

  it('does nothing when the retention time is 0', async () => {
    const result = await cleanup({ days: 0 });
    expect(cards.getExpiredAutoCards).not.toHaveBeenCalled();
    expect(result.expired).toEqual([]);
  });

  it('leaves a card alone that was published in the meantime', async () => {
    cards.deleteExpiredAutoCard.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await cleanup();
    expect(result.deleted.map(c => c.id)).toEqual([2]);
    expect(removeImages).not.toHaveBeenCalled();
  });

  it('continues after a failed delete and reports it', async () => {
    cards.deleteExpiredAutoCard.mockRejectedValueOnce(new Error('lock timeout')).mockResolvedValueOnce(true);
    const result = await cleanup();
    expect(result.failed).toEqual([expect.objectContaining({ id: 1, error: 'lock timeout' })]);
    expect(result.deleted.map(c => c.id)).toEqual([2]);
  });

  it('does not fail when removing the image files fails', async () => {
    removeImages.mockRejectedValue(new Error('EACCES'));
    const result = await cleanup();
    expect(result.deleted).toHaveLength(2);
  });
});
