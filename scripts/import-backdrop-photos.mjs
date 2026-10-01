/* Import backdrop photos for the "soft" theme.
   Usage: node scripts/import-backdrop-photos.mjs [--manifest scripts/backdrop-photos.json] [--only <id>]

   For every entry of the manifest's `photos` list the photo is downloaded (http/https) or read
   (local path), auto-rotated, converted to WebP in two sizes and written to
   public/assets/backdrops/<backdrop>/<id>-lg.webp (2400 px wide, wide screens) and -sm.webp
   (1200 px wide, narrow screens). The mean luminance is printed so too dark photos stand out, and
   the CSS block and registry entry to paste are printed at the end.

   Only photos whose licence allows free use on a website and that are not sold on their own
   (Pexels licence, Unsplash licence, Pixabay licence, CC0) should be listed. Keep the credit data
   accurate: it is shown in the page footer. */

/* global fetch */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};
const manifestPath = path.resolve(root, argValue('--manifest') || 'scripts/backdrop-photos.json');
const only = argValue('--only');

const SIZES = [
  { suffix: 'lg', width: 2400, quality: 72 },
  { suffix: 'sm', width: 1200, quality: 70 },
];
const MAX_BYTES = 40 * 1024 * 1024;

async function load(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, { redirect: 'follow', headers: { 'User-Agent': 'speculumx-backdrop-import/1.0' } });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${source}`);
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw new Error(`Not an image (${type || 'no content-type'}): ${source}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error(`Image larger than ${MAX_BYTES} bytes: ${source}`);
    return buffer;
  }
  return fs.readFile(path.resolve(root, source));
}

function validate(entry) {
  for (const key of ['backdrop', 'id', 'source', 'author', 'license', 'page']) {
    if (!entry[key] || typeof entry[key] !== 'string') throw new Error(`Manifest entry is missing "${key}": ${JSON.stringify(entry)}`);
  }
  // These become path segments
  if (!/^[a-z0-9-]+$/.test(entry.backdrop) || !/^[a-z0-9-]+$/.test(entry.id)) {
    throw new Error(`"backdrop" and "id" may only contain a-z, 0-9 and "-": ${entry.backdrop}/${entry.id}`);
  }
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const photos = (manifest.photos || []).filter(p => !only || p.id === only);
  if (photos.length === 0) {
    console.log('No photos to import (manifest.photos is empty or --only matched nothing).');
    return;
  }

  for (const entry of photos) {
    validate(entry);
    console.log(`\n${entry.backdrop}/${entry.id}  ←  ${entry.source}`);
    const input = await load(entry.source);
    const outDir = path.join(root, 'public', 'assets', 'backdrops', entry.backdrop);
    await fs.mkdir(outDir, { recursive: true });

    const base = sharp(input, { failOn: 'error' }).rotate();
    const meta = await base.metadata();
    console.log(`  source ${meta.width}x${meta.height} ${meta.format}`);

    for (const { suffix, width, quality } of SIZES) {
      const file = path.join(outDir, `${entry.id}-${suffix}.webp`);
      const info = await base.clone().resize({ width, withoutEnlargement: true }).webp({ quality }).toFile(file);
      console.log(`  ${path.relative(root, file)}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB`);
    }

    // Mean luminance of the large variant (0 = black, 1 = white) to catch photos that are too dark
    const stats = await sharp(path.join(outDir, `${entry.id}-lg.webp`)).stats();
    const [r, g, b] = stats.channels.map(c => c.mean / 255);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    console.log(`  mean luminance ${luminance.toFixed(2)}${luminance < 0.4 ? '  (dark: the page may feel heavy, consider another photo)' : ''}`);

    const focus = entry.focusY || '40%';
    console.log(`
  Paste into public/assets/css/themes/soft/backdrops.css:
    [data-backdrop="${entry.backdrop}"] {
        --bd-photo-lg: url('/assets/backdrops/${entry.backdrop}/${entry.id}-lg.webp');
        --bd-photo-sm: url('/assets/backdrops/${entry.backdrop}/${entry.id}-sm.webp');
        --bd-photo-y: ${focus};
        --bd-veil: linear-gradient(180deg, color-mix(in srgb, var(--bd-base) 8%, transparent) 0%, color-mix(in srgb, var(--bd-base) 30%, transparent) 55%, color-mix(in srgb, var(--bd-base) 55%, transparent) 100%);
        --bd-glow-opacity: 0.45;
    }
  And to the matching backdrop in config/themes.js:
    credit: { author: ${JSON.stringify(entry.author)}, license: ${JSON.stringify(entry.license)}, url: ${JSON.stringify(entry.page)} }`);
  }
}

main().catch((error) => {
  console.error(`\nImport failed: ${error.message}`);
  process.exit(1);
});
