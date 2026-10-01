/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import ejs from 'ejs';
import { describe, it, expect } from '@jest/globals';
import { resolveTheme } from '../config/themes.js';

const viewsDir = path.resolve(process.cwd(), 'views');
const layoutPath = path.join(viewsDir, 'layout.ejs');
const layout = fs.readFileSync(layoutPath, 'utf8');

const render = (data = {}) => ejs.render(layout, {
  body: '<p>Inhalt</p>', nonce: 'abc123', assetVersion: '9', isAdmin: false, currentPath: '/', ...data,
}, { filename: layoutPath });

describe('layout.ejs', () => {
  it('renders the soft theme from the registry', () => {
    const html = render({ theme: resolveTheme('soft', 'winter') });

    expect(html).toContain('<html lang="de" data-theme="soft" data-backdrop="winter">');
    expect(html).toContain('<body class="theme-soft">');
    for (const href of ['tokens', 'backdrops', 'base', 'components', 'pages', 'admin']) {
      expect(html).toContain(`/assets/css/themes/soft/${href}.css?v=9`);
    }
    expect(html).not.toContain('/assets/css/main.css');
    expect(html).toContain('<script src="/assets/js/themes/soft/navigation.js?v=9" type="module"></script>');
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(html).toContain('family=Fraunces');
    expect(html).toContain('class="navbar"'); // navbarSoft
    expect(html).toContain('<main id="main">');
    expect(html).toContain('<script nonce="abc123">');
  });

  it('renders the original theme like before: main.css, old navbar, no extra scripts or meta', () => {
    const html = render({ theme: resolveTheme('radical', '') });

    expect(html).toContain('<html lang="de" data-theme="radical">');
    expect(html).toContain('/assets/css/main.css?v=9');
    expect(html).not.toContain('/themes/soft/');
    expect(html).toContain('id="menu-toggle"'); // checkbox hamburger of the old navbar
    expect(html).not.toContain('color-scheme');
    expect(html).toContain('family=IBM+Plex+Mono');
  });

  it('behaves like the original theme when no theme is passed (views rendered outside the app)', () => {
    const html = render();

    expect(html).toContain('/assets/css/main.css?v=9');
    expect(html).toContain('id="menu-toggle"');
  });

  it('loads Prism and TinyMCE stylesheets only where the theme wants them', () => {
    const soft = render({ theme: resolveTheme('soft', ''), usePrism: true, useTinyMce: true });
    expect(soft).not.toContain('prism-okaidia');
    expect(soft).not.toContain('tinymce-content.css');

    const radical = render({ theme: resolveTheme('radical', ''), usePrism: true, useTinyMce: true });
    expect(radical).toContain('/assets/css/prism-okaidia.min.css?v=9');
    expect(radical).toContain('/assets/css/tinymce-content.css');
  });

  it('shows the photo credit escaped, only when the backdrop has one', () => {
    const base = resolveTheme('soft', 'herbst');
    expect(render({ theme: base })).not.toContain('Hintergrundfoto');

    const credited = { ...base, photoCredit: { author: 'A <b>Author</b>', license: 'Pexels License', url: 'https://www.pexels.com/photo/x-1/' } };
    const html = render({ theme: credited });
    expect(html).toContain('Hintergrundfoto: <a href="https://www.pexels.com/photo/x-1/" target="_blank" rel="noopener noreferrer">A &lt;b&gt;Author&lt;/b&gt;</a>');
    expect(html).toContain('Pexels License');
  });

  it('marks the current page in the soft navbar', () => {
    const html = render({ theme: resolveTheme('soft', ''), currentPath: '/blogpost/archive' });

    expect(html).toMatch(/<a href="\/blogpost\/archive" aria-current="page" class="is-active">Archiv<\/a>/);
    expect(html).not.toMatch(/<a href="\/posts"[^>]*aria-current/);
  });

  it('keeps a single post page under "Posts"', () => {
    const html = render({ theme: resolveTheme('soft', ''), currentPath: '/blogpost/spinoza-und-die-ewigkeit' });

    expect(html).toMatch(/<a href="\/posts" aria-current="true" class="is-active">Posts<\/a>/);
    expect(html).not.toMatch(/<a href="\/blogpost\/archive"[^>]*aria-current/);
  });
});
