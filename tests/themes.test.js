/** @jest-environment node */
import { describe, it, expect } from '@jest/globals';
import { THEMES, DEFAULT_THEME, resolveTheme } from '../config/themes.js';

describe('resolveTheme', () => {
  it('defaults to the soft theme with the herbst backdrop', () => {
    const theme = resolveTheme('', '');
    expect(theme.id).toBe(DEFAULT_THEME);
    expect(theme.id).toBe('soft');
    expect(theme.backdrop).toBe('herbst');
    expect(theme.warnings).toEqual([]);
  });

  it('has no photo credit for a backdrop without a photo', () => {
    expect(resolveTheme('soft', 'winter').photoCredit).toBeNull();
    expect(resolveTheme('radical', '').photoCredit).toBeNull();
  });

  it('exposes the credit of a photo backdrop', () => {
    const credit = resolveTheme('soft', 'herbst-wald').photoCredit;
    expect(credit).toEqual(expect.objectContaining({ author: 'Artem Saranin', license: 'Pexels License' }));
    expect(credit.url).toMatch(/^https:\/\/www\.pexels\.com\//);
  });

  it('accepts the herbst photo variants and their umlaut spellings', () => {
    for (const id of ['herbst', 'herbst-himmel', 'herbst-wald', 'herbst-baeume']) {
      expect(resolveTheme('soft', id).backdrop).toBe(id);
    }
    expect(resolveTheme('soft', 'Herbst-Bäume').backdrop).toBe('herbst-baeume');
    expect(resolveTheme('soft', 'herbst-allee').backdrop).toBe('herbst');
  });

  it('keeps the original theme selectable and without a backdrop', () => {
    const theme = resolveTheme('radical', 'winter');
    expect(theme.id).toBe('radical');
    expect(theme.backdrop).toBeNull();
    expect(theme.stylesheets).toEqual(['/assets/css/main.css']);
    expect(theme.navbar).toBe('partials/navbar');
    expect(theme.warnings).toEqual([]);
  });

  it.each(['herbst', 'winter', 'nebel', 'fruehling', 'sommer'])('accepts the %s backdrop', (id) => {
    expect(resolveTheme('soft', id).backdrop).toBe(id);
  });

  it('normalises case, whitespace and umlaut spelling', () => {
    expect(resolveTheme('  SOFT ', ' Winter ').backdrop).toBe('winter');
    expect(resolveTheme('soft', 'Frühling').backdrop).toBe('fruehling');
    expect(resolveTheme('soft', 'fruhling').backdrop).toBe('fruehling');
  });

  it('falls back and reports unknown values instead of throwing', () => {
    const theme = resolveTheme('neon', 'karneval');
    expect(theme.id).toBe('soft');
    expect(theme.backdrop).toBe('herbst');
    expect(theme.warnings).toHaveLength(2);
    expect(theme.warnings[0]).toMatch(/BLOG_THEME "neon"/);
    expect(theme.warnings[1]).toMatch(/BLOG_BACKDROP "karneval"/);
  });

  it('does not resolve inherited object keys as themes', () => {
    expect(resolveTheme('constructor', '').id).toBe('soft');
    expect(resolveTheme('__proto__', '').id).toBe('soft');
  });

  it('lists a stylesheet and a navbar partial for every theme', () => {
    for (const theme of Object.values(THEMES)) {
      expect(theme.stylesheets.length).toBeGreaterThan(0);
      expect(theme.stylesheets.every(href => href.startsWith('/assets/'))).toBe(true);
      expect(theme.navbar).toMatch(/^partials\//);
    }
  });

  it('returns frozen objects so request handlers cannot alter the shared theme', () => {
    expect(Object.isFrozen(resolveTheme('soft', 'herbst'))).toBe(true);
    expect(Object.isFrozen(THEMES.soft)).toBe(true);
  });
});
