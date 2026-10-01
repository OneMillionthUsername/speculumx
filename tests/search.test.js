/** @jest-environment node */
import { describe, it, expect } from '@jest/globals';
import {
  normalizeQuery,
  getSearchTerms,
  splitHighlight,
  buildSnippet,
  SEARCH_MAX_LENGTH,
  SEARCH_MAX_TERMS,
} from '../public/assets/js/shared/search.js';

const joinMatches = (segments) => segments.filter(s => s.match).map(s => s.text);

describe('normalizeQuery', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeQuery('  spinoza \n  ewigkeit\t')).toBe('spinoza ewigkeit');
  });

  it('caps the length', () => {
    expect(normalizeQuery('a'.repeat(500))).toHaveLength(SEARCH_MAX_LENGTH);
  });

  it('treats non-strings (e.g. ?q=a&q=b or ?q[x]=y) as empty', () => {
    expect(normalizeQuery(['a', 'b'])).toBe('');
    expect(normalizeQuery({ x: 'y' })).toBe('');
    expect(normalizeQuery(undefined)).toBe('');
  });
});

describe('getSearchTerms', () => {
  it('splits into terms', () => {
    expect(getSearchTerms('Spinoza Ewigkeit')).toEqual(['Spinoza', 'Ewigkeit']);
  });

  it('drops terms shorter than two characters and duplicates (ignoring case and accents)', () => {
    expect(getSearchTerms('a Ethik ethik Éthik')).toEqual(['Ethik']);
  });

  it('returns no terms for a single character query', () => {
    expect(getSearchTerms('x')).toEqual([]);
  });

  it('limits the number of terms', () => {
    expect(getSearchTerms('aa bb cc dd ee ff gg')).toHaveLength(SEARCH_MAX_TERMS);
  });
});

describe('splitHighlight', () => {
  it('marks matches case-insensitively and keeps the original text', () => {
    const segments = splitHighlight('Ethik und ethische Fragen', ['ethik']);
    expect(joinMatches(segments)).toEqual(['Ethik']);
    expect(segments.map(s => s.text).join('')).toBe('Ethik und ethische Fragen');
  });

  it('matches across accents like the database collation does', () => {
    expect(joinMatches(splitHighlight('Über den Wolken', ['uber']))).toEqual(['Über']);
    expect(joinMatches(splitHighlight('Cafe oder Café', ['café']))).toEqual(['Cafe', 'Café']);
  });

  it('merges overlapping matches of different terms', () => {
    expect(joinMatches(splitHighlight('Erkenntnistheorie', ['erkenn', 'kenntnis']))).toEqual(['Erkenntnis']);
  });

  it('does not treat terms as patterns', () => {
    expect(joinMatches(splitHighlight('a.b and axb', ['a.b']))).toEqual(['a.b']);
    expect(joinMatches(splitHighlight('100% sicher', ['%']))).toEqual(['%']);
  });

  it('returns the text unchanged without terms', () => {
    expect(splitHighlight('text', [])).toEqual([{ text: 'text', match: false }]);
  });

  it('never produces markup, only text segments', () => {
    const segments = splitHighlight('<script>alert(1)</script>', ['script']);
    expect(segments.map(s => s.text).join('')).toBe('<script>alert(1)</script>');
  });
});

describe('buildSnippet', () => {
  const long = `${'Vorspann '.repeat(40)}Hier steht das Wort Ewigkeit mitten im Text. ${'Nachspann '.repeat(40)}`;

  it('centres the snippet on the first match', () => {
    const snippet = buildSnippet(long, ['ewigkeit'], 120);
    expect(snippet).toContain('Ewigkeit');
    expect(snippet.startsWith('… ')).toBe(true);
    expect(snippet.endsWith(' …')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(130);
  });

  it('starts at the beginning when the match is near it', () => {
    const snippet = buildSnippet('Ewigkeit steht am Anfang. Danach kommt noch viel Text, damit gekürzt werden muss.', ['ewigkeit'], 40);
    expect(snippet.startsWith('Ewigkeit')).toBe(true);
    expect(snippet.endsWith(' …')).toBe(true);
  });

  it('falls back to the start of the text when only the title matched', () => {
    const snippet = buildSnippet('Ein ganz anderer Text ohne den Suchbegriff. '.repeat(10), ['spinoza'], 60);
    expect(snippet.startsWith('Ein ganz anderer Text')).toBe(true);
    expect(snippet.endsWith(' …')).toBe(true);
  });

  it('returns short text unchanged and empty text as empty', () => {
    expect(buildSnippet('Kurz.', ['x'])).toBe('Kurz.');
    expect(buildSnippet('', ['x'])).toBe('');
  });
});
