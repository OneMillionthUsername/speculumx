/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import ejs from 'ejs';
import { JSDOM } from 'jsdom';
import { describe, it, expect } from '@jest/globals';
import { detectLanguage, withExcerpts, cleanPostContent } from '../public/assets/js/shared/text.js';
import { sanitizeHtml } from '../utils/sanitizer.js';
import { Post, POST_LAYOUTS, normalizePostLayout } from '../models/postModel.js';
import { getDesignFormats, DIVIDERS } from '../public/assets/js/tinymce/modules/design.js';
import { THEMES } from '../config/themes.js';

// Reading layouts, hyphenation language, the editor's design elements and the fixed card images of the admin list.

const root = process.cwd();
const viewsDir = path.join(root, 'views');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function render(view, data = {}) {
  const file = path.join(viewsDir, `${view}.ejs`);
  const html = ejs.render(fs.readFileSync(file, 'utf8'), { nonce: 'n', csrfToken: 't', isAdmin: true, theme: { id: 'soft' }, ...data }, { filename: file });
  return new JSDOM(`<body>${html}</body>`).window.document;
}

const GERMAN = '<p>Die Philosophie kommt immer zu spät. Sie malt ihr Grau in Grau, wenn eine Gestalt des Lebens alt geworden ist, und mit Grau in Grau lässt sie sich nicht verjüngen, sondern nur erkennen.</p>';
const ENGLISH = '<p>The owl of Minerva spreads its wings only with the falling of the dusk. It is not what you think, and that is the point of the story about the bot trap.</p>';

describe('detectLanguage (hyphenation follows the lang attribute)', () => {
  it('recognises German and English posts', () => {
    expect(detectLanguage(GERMAN)).toBe('de');
    expect(detectLanguage(ENGLISH)).toBe('en');
  });

  it('keeps a German post with an English quotation German', () => {
    expect(detectLanguage(`${GERMAN}<blockquote><p>The medium is the message.</p></blockquote>${GERMAN}`)).toBe('de');
  });

  it('falls back to German for short or empty texts and ignores markup', () => {
    expect(detectLanguage('')).toBe('de');
    expect(detectLanguage(undefined)).toBe('de');
    expect(detectLanguage('<p>Hello world</p>')).toBe('de');
    expect(detectLanguage('<p class="the and of to is it that for with on">Ein kurzer Satz.</p>')).toBe('de');
  });

  it('adds the language to the teasers of a post list', () => {
    const [de, en] = withExcerpts([{ content: GERMAN }, { content: ENGLISH }]);
    expect(de.lang).toBe('de');
    expect(en.lang).toBe('en');
    expect(en.excerpt).toMatch(/^The owl of Minerva/);
  });
});

describe('post layout', () => {
  it('maps any input to one of the layouts', () => {
    expect(POST_LAYOUTS).toEqual(['standard', 'wide', 'magazine']);
    expect(normalizePostLayout('wide')).toBe('wide');
    expect(normalizePostLayout(' MAGAZINE ')).toBe('magazine');
    for (const value of ['bogus', '', undefined, null, 5, {}]) {
      expect(normalizePostLayout(value)).toBe('standard');
    }
  });

  it('never fails a post because of its layout, and leaves a missing layout out', () => {
    const base = { slug: 'titel', title: 'Titel', content: '<p>x</p>', category_id: 1 };
    expect(Post.validate({ ...base, layout: 'wide' }).value.layout).toBe('wide');
    const odd = Post.validate({ ...base, layout: 'zigzag' });
    expect(odd.error).toBeUndefined();
    expect(odd.value.layout).toBe('standard');
    // absent stays absent, so an update without the field keeps the stored layout
    expect('layout' in Post.validate(base).value).toBe(false);
    expect(new Post(base).layout).toBe('standard');
  });
});

describe('saving keeps the design markup', () => {
  it('survives sanitising and cleaning on the server', () => {
    const html = [
      '<blockquote class="pc-epigraph"><p>Erkenne dich selbst.</p><footer><cite>Delphi</cite></footer></blockquote>',
      '<p class="pc-lead pc-dropcap text-justify">Einleitung mit <mark>Markierung</mark>.</p>',
      '<p><img class="img-responsive align-left pc-size-s" src="/assets/uploads/a.webp" alt="A"></p>',
      '<figure class="image align-right pc-size-l"><img src="/assets/uploads/b.webp" alt="B"><figcaption>Unterschrift</figcaption></figure>',
      '<aside class="pc-note"><p>Hinweis</p></aside>',
      '<aside class="pc-margin"><p>Randnotiz</p></aside>',
      '<section class="pc-columns"><p>Spalte</p></section>',
      '<blockquote class="pc-pullquote align-right"><p>Zitat</p></blockquote>',
      '<details class="mce-accordion"><summary>Exkurs</summary><p>Inhalt</p></details>',
      '<hr class="pc-divider pc-divider--flourish">',
    ];
    const saved = cleanPostContent(sanitizeHtml(html.join('\n')));
    for (const fragment of html) expect(saved).toContain(fragment);
  });
});

describe('reading view', () => {
  const post = (layout) => ({ id: 1, slug: 's', title: 'Titel', content: '<p>Text</p>', created_at: new Date(), updated_at: new Date(), tags: [], layout });
  const page = (layout, contentLang = 'de') => render('readPost', { post: post(layout), contentLang, comments: [], commentCount: 0 });

  it.each([
    [undefined, 'col-md-10', 'post-layout-standard'],
    ['standard', 'col-md-10', 'post-layout-standard'],
    ['wide', 'col-12', 'post-layout-wide'],
    ['magazine', 'col-12', 'post-layout-magazine'],
    ['<script>', 'col-md-10', 'post-layout-standard'],
  ])('layout %p uses %s and %s', (layout, column, cls) => {
    const doc = page(layout);
    const panel = doc.getElementById('blogpost-content');
    expect(panel.className).toBe(cls);
    expect(panel.closest(`.${column}`)).not.toBeNull();
  });

  it('marks an English post on its title and text only', () => {
    const doc = page('standard', 'en');
    expect(doc.getElementById('title').getAttribute('lang')).toBe('en');
    expect(doc.getElementById('content').getAttribute('lang')).toBe('en');
    expect(doc.getElementById('post-article').hasAttribute('lang')).toBe(false); // the German meta line stays German
    expect(page('standard', 'de').getElementById('content').hasAttribute('lang')).toBe(false);
  });
});

describe('editor', () => {
  const editor = (post) => render('createPost', { categories: [{ id: 1, name: 'Philosophie' }], post, extraHead: '', useTinyMce: true, usePrism: true });

  it('offers every layout, labelled, preselecting the stored one', () => {
    const select = editor({ id: 3, title: 'T', tags: [], category_id: 1, layout: 'magazine' }).querySelector('select[name="layout"]');
    expect([...select.options].map(o => o.value)).toEqual(POST_LAYOUTS);
    expect(select.value).toBe('magazine');
    expect(select.getAttribute('aria-label')).toBeTruthy();
  });

  it('starts a new post with the standard layout', () => {
    expect(editor(null).querySelector('select[name="layout"]').value).toBe('standard');
  });
});

describe('admin card list', () => {
  const cards = [
    { id: 1, title: 'Lokal', subtitle: '', link: 'https://www.example.org/a', img_link: '/assets/uploads/cards/x.webp', published: 1 },
    { id: 2, title: 'Extern', subtitle: 'Sub', link: 'https://example.net/b', img_link: 'https://img.example.net/y.jpg', published: 0 },
  ];

  it('puts every image into a frame of the same fixed size', () => {
    const doc = render('adminCards', { cards });
    const frames = doc.querySelectorAll('.admin-card .admin-card-thumb');
    expect(frames).toHaveLength(2);
    const imgs = [...frames].map(f => f.querySelector('img'));
    expect(imgs.map(i => i.getAttribute('src'))).toEqual(['/assets/uploads/cards/x-344.webp', 'https://img.example.net/y.jpg']);
    for (const img of imgs) {
      expect(img.getAttribute('width')).toBe('172');
      expect(img.getAttribute('height')).toBe('155');
    }
    for (const css of [read('public/assets/css/themes/soft/admin.css'), read('public/assets/css/main.css')]) {
      expect(css).toMatch(/\.admin-card-thumb \{[^}]*width: 172px;[^}]*height: 155px;/);
      expect(css).toMatch(/\.admin-card-thumb img \{[^}]*height: 100%;[^}]*object-fit: cover;/);
    }
  });

  it('keeps the source link clickable (no stretched title link over the card)', () => {
    const doc = render('adminCards', { cards });
    expect(doc.querySelector('.admin-card .post-link')).toBeNull();
    expect(doc.querySelector('.admin-card a[href="https://www.example.org/a"]').textContent).toBe('example.org');
  });
});

describe('design elements of the editor', () => {
  const formats = getDesignFormats();
  const soft = read('public/assets/css/themes/soft/content.css');
  const radical = read('public/assets/css/content.css');

  it('aligns with classes, since the server removes style attributes', () => {
    for (const name of ['alignleft', 'aligncenter', 'alignright', 'alignjustify']) {
      for (const format of formats[name]) {
        expect(format.styles).toBeUndefined();
        expect(format.classes).toMatch(/^(align|text)-(left|center|right|justify)$/);
      }
    }
  });

  it('has a style in both themes for every class the editor writes', () => {
    const classes = new Set(['align-left', 'align-right', 'align-center', 'pc-size-s', 'pc-size-l', 'pc-wide', 'text-justify']);
    for (const format of Object.values(formats).flat()) {
      [].concat(format.classes || []).flatMap(c => c.split(' ')).forEach(c => classes.add(c));
    }
    DIVIDERS.forEach(d => classes.add(`pc-divider--${d.id}`));
    for (const cls of classes) {
      expect({ cls, soft: soft.includes(`.${cls}`) }).toEqual({ cls, soft: true });
      expect({ cls, radical: radical.includes(`.${cls}`) }).toEqual({ cls, radical: true });
    }
  });

  it('only references ornaments that exist', () => {
    const urls = new Set([...`${soft}${radical}${read('public/assets/css/themes/soft/pages.css')}`.matchAll(/url\('(\/assets\/ornaments\/[^']+)'\)/g)].map(m => m[1]));
    expect(urls.size).toBeGreaterThanOrEqual(4);
    for (const url of urls) expect(fs.existsSync(path.join(root, 'public', url))).toBe(true);
  });

  it('loads the content styles on the pages and inside the editor of both themes', () => {
    expect(THEMES.soft.stylesheets).toContain('/assets/css/themes/soft/content.css');
    expect(THEMES.radical.stylesheets).toContain('/assets/css/content.css');
    const config = read('public/assets/js/tinymce/modules/config.js');
    expect(config).toContain('\'/assets/css/themes/soft/content.css\'');
    expect(config).toContain('\'/assets/css/content.css\'');
  });
});
