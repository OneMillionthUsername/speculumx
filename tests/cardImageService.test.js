/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { resolveCardImage, saveCardImage } = await import('../services/cardImageService.js');
const { DEFAULT_CARD_IMAGE } = await import('../config/cardDigest.js');

const options = { licensedImages: true, aiImages: true, userAgent: 'test-agent' };
const png = (width, height) => sharp({ create: { width, height, channels: 3, background: '#a4491b' } }).png().toBuffer();

let mediaDir;
beforeAll(() => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-'));
});
afterAll(() => {
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

describe('default card image', () => {
  it('exists with the variants that views/index.ejs derives from it', () => {
    const base = path.join(process.cwd(), 'public', DEFAULT_CARD_IMAGE.replace(/\.webp$/, ''));
    for (const suffix of ['', '-344', '-688']) {
      expect(fs.existsSync(`${base}${suffix}.webp`)).toBe(true);
    }
  });
});

describe('saveCardImage', () => {
  it('writes the base file and the -344 and -688 variants at the sizes the home page uses', async () => {
    const link = await saveCardImage(await png(1200, 900), {
      prefix: 'ai', key: 'k1', minWidth: 256, minHeight: 256, mediaDir, mediaUrl: '/assets/media/cards',
    });
    expect(link).toMatch(/^\/assets\/media\/cards\/ai-[0-9a-f]{12}\.webp$/);
    const stem = path.join(mediaDir, path.basename(link, '.webp'));
    expect(await sharp(`${stem}-344.webp`).metadata()).toMatchObject({ width: 344, height: 310, format: 'webp' });
    expect(await sharp(`${stem}-688.webp`).metadata()).toMatchObject({ width: 688, height: 620 });
    expect((await sharp(`${stem}.webp`).metadata()).width).toBe(1032);
  });

  it('rejects other file types and images that are too small', async () => {
    const base = { prefix: 'lic', key: 'k2', minWidth: 600, minHeight: 300, mediaDir, mediaUrl: '/x' };
    await expect(saveCardImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), base)).rejects.toThrow(/unsupported/);
    await expect(saveCardImage(await png(100, 100), base)).rejects.toThrow(/too small/);
  });
});

describe('resolveCardImage', () => {
  const found = { imageUrl: 'https://example.org/cover.jpg', license: 'CC0', reason: 'ok' };
  const none = { imageUrl: null, reason: 'no licence information' };

  it('uses a verified licensed image first and re-hosts it', async () => {
    const findImage = jest.fn().mockResolvedValue(found);
    const download = jest.fn().mockResolvedValue({ status: 200, body: Buffer.from('bytes') });
    const generate = jest.fn();
    const save = jest.fn().mockResolvedValue('/assets/media/cards/lic-1.webp');
    const result = await resolveCardImage({ pageUrl: 'https://example.org/a', imagePrompt: 'a mirror' },
      { options, findImage, download, generate, save });
    expect(result).toMatchObject({ img_link: '/assets/media/cards/lic-1.webp', source: 'licensed' });
    expect(generate).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(Buffer.from('bytes'), expect.objectContaining({ prefix: 'lic' }));
  });

  it('generates an illustration when no licensed image exists', async () => {
    const generate = jest.fn().mockResolvedValue({ buffer: Buffer.from('png'), model: 'img-model' });
    const save = jest.fn().mockResolvedValue('/assets/media/cards/ai-1.webp');
    const result = await resolveCardImage({ pageUrl: 'https://example.org/a', imagePrompt: 'a mirror' },
      { options, findImage: jest.fn().mockResolvedValue(none), generate, save });
    expect(result).toMatchObject({ img_link: '/assets/media/cards/ai-1.webp', source: 'ai', detail: 'img-model' });
    expect(generate).toHaveBeenCalledWith('a mirror');
  });

  it('falls through to the illustration when the licensed download fails', async () => {
    const generate = jest.fn().mockResolvedValue({ buffer: Buffer.from('png'), model: 'img-model' });
    const result = await resolveCardImage({ pageUrl: 'https://example.org/a', imagePrompt: 'a mirror' }, {
      options,
      findImage: jest.fn().mockResolvedValue(found),
      download: jest.fn().mockResolvedValue({ status: 403, body: Buffer.alloc(0) }),
      generate,
      save: jest.fn().mockResolvedValue('/assets/media/cards/ai-2.webp'),
    });
    expect(result.source).toBe('ai');
  });

  it('uses the static default image when generation fails too', async () => {
    const result = await resolveCardImage({ pageUrl: 'https://example.org/a', imagePrompt: 'a mirror' }, {
      options,
      findImage: jest.fn().mockResolvedValue(none),
      generate: jest.fn().mockRejectedValue(new Error('quota exceeded')),
      save: jest.fn(),
    });
    expect(result.img_link).toBe(DEFAULT_CARD_IMAGE);
    expect(result.source).toBe('default');
    expect(result.detail).toMatch(/no licensed image.*AI image failed: quota exceeded/);
  });

  it('uses the default image without a motif and when both sources are switched off', async () => {
    const generate = jest.fn();
    const noPrompt = await resolveCardImage({ pageUrl: 'https://example.org/a' },
      { options, findImage: jest.fn().mockResolvedValue(none), generate });
    expect(noPrompt.source).toBe('default');
    const off = await resolveCardImage({ pageUrl: 'https://example.org/a', imagePrompt: 'x' },
      { options: { ...options, licensedImages: false, aiImages: false }, findImage: jest.fn(), generate });
    expect(off).toMatchObject({ source: 'default', detail: 'image sources disabled' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('writes and generates nothing in a dry run', async () => {
    const generate = jest.fn();
    const download = jest.fn();
    const licensed = await resolveCardImage({ pageUrl: 'https://example.org/a', imagePrompt: 'x' },
      { options, dryRun: true, findImage: jest.fn().mockResolvedValue(found), download, generate });
    expect(licensed).toMatchObject({ source: 'licensed', detail: expect.stringContaining('would re-host') });
    const ai = await resolveCardImage({ pageUrl: 'https://example.org/a', imagePrompt: 'x' },
      { options, dryRun: true, findImage: jest.fn().mockResolvedValue(none), download, generate });
    expect(ai).toMatchObject({ source: 'ai', detail: expect.stringContaining('would generate') });
    expect(download).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});
