/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import ejs from 'ejs';
import { JSDOM } from 'jsdom';
import { describe, it, expect } from '@jest/globals';

// Structural accessibility of the server-rendered views: one h1 per page, no skipped heading levels,
// distinguishable landmarks, labelled form controls. (Colour contrast is covered by themeContrast.test.js.)

const viewsDir = path.resolve(process.cwd(), 'views');
const soft = { id: 'soft' };
const radical = { id: 'radical' };

function render(view, data = {}) {
  const file = path.join(viewsDir, `${view}.ejs`);
  const html = ejs.render(fs.readFileSync(file, 'utf8'), { nonce: 'n', csrfToken: 't', isAdmin: false, theme: soft, ...data }, { filename: file });
  return new JSDOM(`<body>${html}</body>`).window.document;
}

const headingLevels = (doc) => [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => Number(h.tagName[1]));

function expectOutline(doc) {
  const levels = headingLevels(doc);
  expect(levels.filter(l => l === 1)).toHaveLength(1);
  levels.forEach((level, i) => {
    if (i > 0) expect(level).toBeLessThanOrEqual(levels[i - 1] + 1); // never skip a level going down
  });
}

const date = new Date('2026-05-04T10:00:00Z');
const post = (n) => ({ id: n, slug: `post-${n}`, title: `Beitrag ${n}`, author: 'D.M.', views: n, created_at: date, updated_at: date, excerpt: 'Ein Teaser.', content: '<p>Text</p>', tags: ['Ethik'] });
const posts = [post(1), post(2), post(3)];

describe('page outlines (soft theme)', () => {
  const pages = {
    index: { featuredPosts: [{ title: 'A', slug: 'a', excerpt: 'x' }, { title: 'B', slug: 'b', excerpt: 'y' }, { title: 'C', slug: 'c', excerpt: 'z' }], leadPost: { title: 'A', slug: 'a', excerpt: 'x', created_at: date, previewImage: { src: null } }, popularPosts: [], categories: [{ name: 'Philosophie', slug: 'philosophie' }], archiveYears: [2026], cards: [{ title: 'Karte', subtitle: 'Sub', link: 'https://example.org', img_link: 'https://example.org/i.jpg' }] },
    listCurrentPosts: { posts, pagination: null },
    archiv: { posts, archiveYears: [2026], pagination: null },
    mostReadPosts: { posts },
    about: {},
    notFound: {},
    error: { message: 'Fehler' },
    readPost: { post: { ...post(1), tags: ['Ethik'] }, comments: [], commentCount: 0, commentStatus: null, commentMessage: null },
    searchResults: { searchQuery: 'ethik', terms: ['ethik'], total: 1, posts: [{ ...post(1), titleParts: [{ text: 'Beitrag 1', match: false }], snippetParts: [{ text: 'Ein Teaser', match: false }] }], pagination: null, categories: [] },
    impressum: {},
    datenschutz: {},
  };

  it.each(Object.entries(pages))('%s has exactly one h1 and no skipped heading levels', (view, data) => {
    expectOutline(render(view, data));
  });
});

describe('landmarks and labels', () => {
  it('gives the two search forms on the search page different accessible names', () => {
    const page = render('searchResults', { searchQuery: 'x', terms: [], total: 0, posts: [], categories: [] });
    const nav = render('partials/navbarSoft', { currentPath: '/search' });
    const labels = [page.querySelector('form[role="search"]'), nav.querySelector('form[role="search"]')].map(f => f.getAttribute('aria-label'));
    expect(labels.every(Boolean)).toBe(true);
    expect(new Set(labels).size).toBe(2);
  });

  it('labels the navbar search field and offers a skip link to the main content', () => {
    const doc = render('partials/navbarSoft', { currentPath: '/' });
    expect(doc.querySelector('label[for="nav-search-input"]')).not.toBeNull();
    expect(doc.querySelector('a.skip-link').getAttribute('href')).toBe('#main');
    expect(doc.querySelector('#nav-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(doc.querySelector('#nav-toggle').getAttribute('aria-controls')).toBe('navbar-panel');
  });

  it('labels every field of the contact form', () => {
    const doc = render('about');
    for (const field of doc.querySelectorAll('#my-form input:not([type="hidden"]):not([tabindex="-1"]), #my-form textarea')) {
      expect(doc.querySelector(`label[for="${field.id}"]`)).not.toBeNull();
    }
  });

  it('labels the category select of the editor', () => {
    const doc = render('createPost', { categories: [{ id: 1, name: 'Philosophie' }], post: null, extraHead: '', isAdmin: true, useTinyMce: true, usePrism: true });
    expect(doc.querySelector('select[name="category_id"]').getAttribute('aria-label')).toBeTruthy();
  });
});

describe('home page lead card', () => {
  const home = {
    featuredPosts: [{ title: 'Neu', slug: 'neu', excerpt: 'a' }, { title: 'Zwei', slug: 'zwei', excerpt: 'b' }, { title: 'Drei', slug: 'drei', excerpt: 'c' }],
    leadPost: { title: 'Neu', slug: 'neu', excerpt: 'Ein längerer Teaser.', created_at: date, previewImage: { src: null } },
    popularPosts: [{ title: 'Neu', slug: 'neu' }, { title: 'Zwei', slug: 'zwei' }, { title: 'Alt', slug: 'alt' }],
    categories: [], archiveYears: [], cards: [],
  };

  it('shows the newest post as "Aktuell" and does not repeat shown posts under "Beliebte Beiträge"', () => {
    const doc = render('index', home);
    expect(doc.querySelector('.lead-post .lead-post-label').textContent.trim()).toBe('Aktuell');
    expect(doc.querySelector('.lead-post-link').getAttribute('href')).toBe('/blogpost/neu');
    expect(doc.querySelector('.lead-post time').getAttribute('datetime')).toBe(date.toISOString());
    // lead + the next two are on the page, so only "Alt" is left for the sidebar
    expect([...doc.querySelectorAll('#popular-posts a')].map(a => a.textContent)).toEqual(['Alt']);
    expect(doc.querySelectorAll('.featured-post-card')).toHaveLength(2);
  });

  it('omits the popular block when everything popular is already shown', () => {
    const doc = render('index', { ...home, popularPosts: [{ title: 'Neu', slug: 'neu' }] });
    expect(doc.querySelector('#popular-posts')).toBeNull();
  });

  it('keeps the original home layout for the radical theme (no lead card, popular posts unchanged)', () => {
    const doc = render('index', { ...home, theme: radical });
    expect(doc.querySelector('.lead-post')).toBeNull();
    expect(doc.querySelectorAll('.featured-post-card')).toHaveLength(3);
    expect(doc.querySelectorAll('#popular-posts a')).toHaveLength(3);
    expect(doc.querySelector('.header-section > aside.sidebar')).not.toBeNull(); // sidebar first, as before
  });

  it('renders without a lead post (no published posts yet)', () => {
    const doc = render('index', { ...home, leadPost: null, featuredPosts: [], popularPosts: [] });
    expect(doc.querySelector('.lead-post')).toBeNull();
  });
});
