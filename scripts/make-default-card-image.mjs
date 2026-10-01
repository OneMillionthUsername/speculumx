/* Renders the static fallback image for cards (last resort when no licensed image exists and the
   AI illustration fails): soft colour fields in the palette of the "soft" theme and a mirror ring
   (speculum). Writes public/assets/img/card-default.webp plus the -344 and -688 variants that
   views/index.ejs expects.
   Usage: node scripts/make-default-card-image.mjs
   To use a different picture (e.g. an AI illustration you like better), replace the three files. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'assets', 'img');

const W = 1032;
const H = 930;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="70"/></filter>
    <radialGradient id="mirror" cx="38%" cy="32%" r="75%">
      <stop offset="0" stop-color="#fffaf0" stop-opacity="0.95"/>
      <stop offset="0.55" stop-color="#f9e2a6" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#e6a487" stop-opacity="0.35"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#fbf1d8"/>
  <g filter="url(#soft)">
    <circle cx="170" cy="150" r="300" fill="#a9cdea"/>
    <circle cx="900" cy="120" r="280" fill="#f6d46f"/>
    <circle cx="880" cy="830" r="300" fill="#efae6e"/>
    <circle cx="130" cy="800" r="270" fill="#e6a487"/>
  </g>
  <circle cx="516" cy="465" r="250" fill="url(#mirror)" stroke="#a4491b" stroke-opacity="0.35" stroke-width="6"/>
  <circle cx="516" cy="465" r="205" fill="none" stroke="#fffaf0" stroke-opacity="0.7" stroke-width="3"/>
  <path d="M370 330 A200 200 0 0 1 560 262" fill="none" stroke="#fffaf0" stroke-opacity="0.85" stroke-width="14" stroke-linecap="round"/>
</svg>`;

await fs.mkdir(outDir, { recursive: true });
const source = sharp(Buffer.from(svg));
await source.clone().webp({ quality: 80 }).toFile(path.join(outDir, 'card-default.webp'));
await source.clone().resize(688, 620).webp({ quality: 80 }).toFile(path.join(outDir, 'card-default-688.webp'));
await source.clone().resize(344, 310).webp({ quality: 80 }).toFile(path.join(outDir, 'card-default-344.webp'));
console.log(`Written to ${outDir}`);
