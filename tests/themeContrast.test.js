/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from '@jest/globals';
import { THEMES } from '../config/themes.js';

// Every backdrop of the soft theme is a block of colour variables (backdrops.css). Text and accent
// colours must stay readable on the surfaces and tints they are used on, whatever the palette is.

const css = fs.readFileSync(path.resolve(process.cwd(), 'public/assets/css/themes/soft/backdrops.css'), 'utf8');

// Palette blocks (those that define --text); photo-only blocks of the herbst variants are skipped.
// [data-backdrop|="herbst"] covers "herbst" and every "herbst-…" variant.
function parseBackdrops() {
  const blocks = {};
  for (const match of css.matchAll(/\[data-backdrop\|?="([\w-]+)"\]\s*\{([^}]*)\}/g)) {
    const vars = {};
    for (const [, name, value] of match[2].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) vars[name] = value;
    if (vars.text) blocks[match[1]] = vars;
  }
  return blocks;
}

const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map(x => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
const blend = (fg, bg, alpha) => toHex(rgb(fg).map((x, i) => x * alpha + rgb(bg)[i] * (1 - alpha)));

function luminance(hex) {
  const [r, g, b] = rgb(hex).map(c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [label, foreground, background, minimum ratio] for one palette */
function pairs(v) {
  const surface = v['surface-solid'];
  const sunken = v['surface-sunken'];
  const base = v['bd-base'];
  const out = [
    ['text on surface', v.text, surface, 7],
    ['text on sunken', v.text, sunken, 7],
    ['text on base', v.text, base, 7],
    ['dim on surface', v['text-dim'], surface, 4.5],
    ['dim on sunken', v['text-dim'], sunken, 4.5],
    ['dim on base', v['text-dim'], base, 4.5],
    ['faint on surface', v['text-faint'], surface, 4.5],
    ['faint on sunken', v['text-faint'], sunken, 4.5],
    ['accent on surface', v.accent, surface, 4.5],
    ['accent on sunken', v.accent, sunken, 4.5],
    ['button label on accent fill', v['accent-ink'], v.accent, 4.5],
    ['accent-strong on surface', v['accent-strong'], surface, 4.5],
    ['accent-strong on tonal button (18%)', v['accent-strong'], blend(v.accent, surface, 0.18), 4.5],
    ['accent-strong on tonal button hover (26%)', v['accent-strong'], blend(v.accent, surface, 0.26), 4.5],
  ];
  for (let i = 1; i <= 5; i++) {
    const glow = blend(v[`bd-glow-${i}`], base, 0.85);
    out.push([`text on glow ${i}`, v.text, glow, 7], [`dim on glow ${i}`, v['text-dim'], glow, 4.5]);
  }
  for (const name of ['tone-1', 'tone-2', 'tone-3', 'tone-4', 'danger', 'success', 'warning', 'info']) {
    out.push(
      [`${name} on surface`, v[name], surface, 4.5],
      [`${name} on its tint (16%)`, v[name], blend(v[name], surface, 0.16), 4.5],
      [`${name} on its hover tint (26%)`, v[name], blend(v[name], surface, 0.26), 4.5],
    );
  }
  for (const name of ['tone-1', 'tone-2', 'tone-3', 'tone-4']) {
    const card = blend(v[name], surface, 0.24); // tinted cards
    out.push([`text on ${name} card`, v.text, card, 7], [`dim on ${name} card`, v['text-dim'], card, 4.5]);
  }
  return out;
}

const backdrops = parseBackdrops();

describe('soft theme palettes', () => {
  it('defines a palette for every backdrop the registry lists (variants share their base palette)', () => {
    for (const { id } of THEMES.soft.backdrops) {
      const paletteId = backdrops[id] ? id : id.split('-')[0];
      expect(Object.keys(backdrops)).toContain(paletteId);
    }
  });

  it.each(Object.entries(backdrops))('%s keeps text and accents readable', (name, vars) => {
    const failures = pairs(vars)
      .map(([label, fg, bg, min]) => ({ label, ratio: contrast(fg, bg), min }))
      .filter(p => p.ratio < p.min)
      .map(p => `${p.label}: ${p.ratio.toFixed(2)} < ${p.min}`);
    expect(failures).toEqual([]);
  });
});
