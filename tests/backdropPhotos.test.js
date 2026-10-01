/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from '@jest/globals';
import { THEMES } from '../config/themes.js';

// A photo backdrop needs three things to stay in step: the CSS block that points at the files, the
// files themselves, and the credit that the footer shows (licence compliance).

const publicDir = path.resolve(process.cwd(), 'public');
const css = fs.readFileSync(path.join(publicDir, 'assets/css/themes/soft/backdrops.css'), 'utf8');

function photoBlocks() {
  const blocks = {};
  for (const match of css.matchAll(/\[data-backdrop="([\w-]+)"\]\s*\{([^}]*--bd-photo-lg[^}]*)\}/g)) {
    const urls = [...match[2].matchAll(/--bd-photo-(lg|sm):\s*url\('([^']+)'\)/g)].map(m => ({ size: m[1], url: m[2] }));
    blocks[match[1]] = urls;
  }
  return blocks;
}

const blocks = photoBlocks();
const registry = Object.fromEntries(THEMES.soft.backdrops.map(b => [b.id, b]));

describe('photo backdrops', () => {
  it('has at least one photo backdrop', () => {
    expect(Object.keys(blocks).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(blocks))('%s: both image files exist, are WebP and stay a sensible size', (id, urls) => {
    expect(urls.map(u => u.size).sort()).toEqual(['lg', 'sm']);
    for (const { url } of urls) {
      expect(url).toMatch(/^\/assets\/backdrops\/[a-z0-9-]+\/[a-z0-9-]+-(lg|sm)\.webp$/);
      const file = path.join(publicDir, url);
      expect(fs.existsSync(file)).toBe(true);
      const { size } = fs.statSync(file);
      expect(size).toBeGreaterThan(10 * 1024);
      expect(size).toBeLessThan(1.2 * 1024 * 1024);
    }
  });

  it.each(Object.keys(blocks))('%s: is listed in the registry with a complete credit', (id) => {
    expect(registry[id]).toBeDefined();
    const credit = registry[id].credit;
    expect(credit).toBeDefined();
    expect(credit.author).toBeTruthy();
    expect(credit.license).toBeTruthy();
    expect(credit.url).toMatch(/^https:\/\//);
  });

  it('does not credit a backdrop that has no photo', () => {
    for (const [id, backdrop] of Object.entries(registry)) {
      if (backdrop.credit) expect(Object.keys(blocks)).toContain(id);
    }
  });
});
