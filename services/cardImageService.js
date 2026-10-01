import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { CARD_DIGEST, CARD_MEDIA_DIR, CARD_MEDIA_URL, DEFAULT_CARD_IMAGE } from '../config/cardDigest.js';
import { safeFetch } from '../utils/safeFetch.js';
import { findLicensedImage } from './imageLicenseService.js';
import { generateIllustration } from './imageGenerationService.js';

/**
 * Picks the image of a card. Sources, in this order:
 *   1. an image whose free licence was verified (imageLicenseService) - re-hosted locally
 *   2. an AI-generated illustration (imageGenerationService)
 *   3. the static default image (DEFAULT_CARD_IMAGE)
 * Every failure falls through to the next source, so a card always gets an image.
 *
 * Images are stored locally, never hot-linked: the visitor's IP address is then not sent to a
 * third party, and the image cannot disappear or change. views/index.ejs expects the files
 * <name>-344.webp and <name>-688.webp next to a local img_link <name>.webp.
 */

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Converts an image to the three WebP files a card needs and stores them in the media folder.
 * @param {Buffer} buffer - JPEG, PNG or WebP data.
 * @param {Object} options
 * @param {string} options.prefix - 'lic' (licensed) or 'ai'; part of the file name.
 * @param {string} options.key - Input of the file name hash.
 * @param {number} options.minWidth
 * @param {number} options.minHeight
 * @param {string} [options.mediaDir]
 * @param {string} [options.mediaUrl]
 * @returns {Promise<string>} Local img_link, e.g. /assets/media/cards/ai-1a2b3c4d5e6f.webp
 * @throws {Error} For other file types or images that are too small.
 */
export async function saveCardImage(buffer, { prefix, key, minWidth, minHeight, mediaDir = CARD_MEDIA_DIR, mediaUrl = CARD_MEDIA_URL }) {
  const type = await fileTypeFromBuffer(buffer);
  if (!type || !ACCEPTED_TYPES.has(type.mime)) {
    throw new Error(`unsupported image type ${type?.mime ?? 'unknown'}`);
  }
  const source = sharp(buffer, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate();
  const { width, height } = await sharp(buffer).metadata();
  if (!width || !height || width < minWidth || height < minHeight) {
    throw new Error(`image too small (${width}x${height})`);
  }

  const name = `${prefix}-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`;
  await fs.mkdir(mediaDir, { recursive: true });
  const target = suffix => path.join(mediaDir, `${name}${suffix}.webp`);
  const cover = (w, h) => ({ width: w, height: h, fit: 'cover', position: 'attention' });
  await source.clone().resize(cover(344, 310)).webp({ quality: 78 }).toFile(target('-344'));
  await source.clone().resize(cover(688, 620)).webp({ quality: 78 }).toFile(target('-688'));
  await source.clone().resize({ width: 1032, withoutEnlargement: true }).webp({ quality: 78 }).toFile(target(''));
  return `${mediaUrl}/${name}.webp`;
}

/**
 * Deletes the files of a card image that this module created (AI-generated or licensed, stored as
 * <name>.webp, <name>-344.webp and <name>-688.webp). Anything else - the default image, external
 * URLs, files uploaded by hand - is left alone.
 * @param {string} imgLink - img_link of the deleted card.
 * @param {Object} [options]
 * @param {string} [options.mediaDir]
 * @param {string} [options.mediaUrl]
 * @returns {Promise<number>} Number of files removed.
 */
export async function removeCardImageFiles(imgLink, { mediaDir = CARD_MEDIA_DIR, mediaUrl = CARD_MEDIA_URL } = {}) {
  const link = String(imgLink ?? '');
  const match = /^((?:ai|lic)-[0-9a-f]{12})\.webp$/.exec(path.posix.basename(link));
  if (!match || path.posix.dirname(link) !== mediaUrl) return 0;
  let removed = 0;
  for (const suffix of ['', '-344', '-688']) {
    const file = path.join(mediaDir, `${match[1]}${suffix}.webp`);
    try {
      await fs.unlink(file);
      removed++;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return removed;
}

/**
 * @param {Object} card
 * @param {string} card.pageUrl - The article the card links to (looked at for a licensed image).
 * @param {string} [card.imagePrompt] - Motif for the AI illustration; without it step 2 is skipped.
 * @param {Object} [deps] - Overridable for tests.
 * @param {boolean} [deps.dryRun] - Look, but neither download, generate nor write anything.
 * @returns {Promise<{img_link: string, source: 'licensed'|'ai'|'default', detail: string}>}
 */
export async function resolveCardImage({ pageUrl, imagePrompt }, deps = {}) {
  const {
    options = CARD_DIGEST,
    dryRun = false,
    findImage = findLicensedImage,
    generate = generateIllustration,
    download = safeFetch,
    save = saveCardImage,
  } = deps;
  const notes = [];

  if (options.licensedImages) {
    const found = await findImage(pageUrl, { userAgent: options.userAgent });
    if (found.imageUrl) {
      if (dryRun) {
        return { img_link: DEFAULT_CARD_IMAGE, source: 'licensed', detail: `would re-host ${found.imageUrl} (${found.license})` };
      }
      try {
        const response = await download(found.imageUrl, {
          headers: { Accept: 'image/*', 'User-Agent': options.userAgent },
          maxBytes: MAX_DOWNLOAD_BYTES,
          timeoutMs: 20_000,
        });
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        const img_link = await save(response.body, { prefix: 'lic', key: found.imageUrl, minWidth: 600, minHeight: 300 });
        return { img_link, source: 'licensed', detail: `${found.license} - ${found.imageUrl}` };
      } catch (error) {
        notes.push(`licensed image unusable: ${error.message}`);
      }
    } else {
      notes.push(`no licensed image: ${found.reason}`);
    }
  }

  if (options.aiImages && imagePrompt) {
    if (dryRun) {
      return { img_link: DEFAULT_CARD_IMAGE, source: 'ai', detail: `would generate: ${imagePrompt}` };
    }
    try {
      const { buffer, model } = await generate(imagePrompt);
      const img_link = await save(buffer, { prefix: 'ai', key: `${pageUrl}\n${imagePrompt}`, minWidth: 256, minHeight: 256 });
      return { img_link, source: 'ai', detail: model };
    } catch (error) {
      notes.push(`AI image failed: ${error.message}`);
    }
  }

  return { img_link: DEFAULT_CARD_IMAGE, source: 'default', detail: notes.join('; ') || 'image sources disabled' };
}
