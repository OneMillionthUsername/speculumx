/**
 * Theme registry.
 *
 * A theme bundles everything that differs between two looks of the blog:
 * web fonts, stylesheets, extra scripts and the navbar partial. views/layout.ejs reads the
 * active theme from `res.locals.theme` and renders only what the registry lists, so the
 * views themselves stay theme-agnostic.
 *
 * Add a theme: put its CSS below public/assets/css/themes/<id>/, add an entry to THEMES and
 * select it with BLOG_THEME=<id>.
 * Add a backdrop to an existing theme: add a [data-backdrop="<id>"] block to that theme's
 * backdrops.css and list the id in its `backdrops`. A backdrop that uses a photograph carries a
 * `credit: { author, license, url }`, which the footer shows (see scripts/import-backdrop-photos.mjs).
 */

const FONTS_RADICAL = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Cormorant+Garamond:ital,wght@0,300;0,600;1,300&display=swap';

// Fraunces ships "SOFT" (rounded terminals) and "WONK" axes; DM Mono is used for small UI labels.
const FONTS_SOFT = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..700,0..100,0..1;1,9..144,300..700,0..100,0..1&family=DM+Mono:wght@400;500&display=swap';

export const THEMES = Object.freeze({
  // The original dark theme (public/assets/css/main.css). Kept unchanged.
  radical: Object.freeze({
    id: 'radical',
    label: 'Radical',
    fontsUrl: FONTS_RADICAL,
    colorScheme: null, // unchanged look: no color-scheme meta, as before
    stylesheets: Object.freeze(['/assets/css/main.css']),
    scripts: Object.freeze([]),
    navbar: 'partials/navbar',
    prismStylesheet: '/assets/css/prism-okaidia.min.css',
    tinymceContentCss: true,
    backdrops: Object.freeze([]),
    defaultBackdrop: null,
  }),

  // Soft, matte, light look after css_styles/farbpalette.html with exchangeable backdrops.
  soft: Object.freeze({
    id: 'soft',
    label: 'Soft',
    fontsUrl: FONTS_SOFT,
    colorScheme: 'light',
    stylesheets: Object.freeze([
      '/assets/css/themes/soft/tokens.css',
      '/assets/css/themes/soft/backdrops.css',
      '/assets/css/themes/soft/base.css',
      '/assets/css/themes/soft/components.css',
      '/assets/css/themes/soft/pages.css',
      '/assets/css/themes/soft/admin.css',
    ]),
    scripts: Object.freeze(['/assets/js/themes/soft/navigation.js']),
    navbar: 'partials/navbarSoft',
    prismStylesheet: null, // pages.css ships its own muted syntax colours
    tinymceContentCss: false,
    backdrops: Object.freeze([
      Object.freeze({ id: 'herbst', label: 'Herbst' }),
      Object.freeze({ id: 'winter', label: 'Winter' }),
      Object.freeze({ id: 'nebel', label: 'Nebel' }),
      Object.freeze({ id: 'fruehling', label: 'Frühling' }),
      Object.freeze({ id: 'sommer', label: 'Sommer' }),
    ]),
    defaultBackdrop: 'herbst',
  }),
});

export const DEFAULT_THEME = 'soft';

// Spellings people are likely to put into an env file.
const BACKDROP_ALIASES = Object.freeze({
  'frühling': 'fruehling',
  'fruhling': 'fruehling',
});

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Resolve the requested theme/backdrop to a registry entry. Unknown or empty values fall back to
 * the defaults; `warnings` lists what was replaced so the caller can log it once at startup.
 *
 * @param {string} [themeName]    value of BLOG_THEME
 * @param {string} [backdropName] value of BLOG_BACKDROP
 * @returns {{ id: string, label: string, fontsUrl: string, colorScheme: 'light'|'dark'|null, stylesheets: readonly string[],
 *   scripts: readonly string[], navbar: string, prismStylesheet: string|null,
 *   tinymceContentCss: boolean, backdrops: readonly {id: string, label: string}[],
 *   backdrop: string|null, photoCredit: { author: string, license: string, url: string }|null,
 *   warnings: string[] }}
 */
export function resolveTheme(themeName, backdropName) {
  const warnings = [];

  let themeId = normalize(themeName);
  if (!themeId) {
    themeId = DEFAULT_THEME;
  } else if (!Object.hasOwn(THEMES, themeId)) {
    warnings.push(`Unknown BLOG_THEME "${themeId}", using "${DEFAULT_THEME}". Available: ${Object.keys(THEMES).join(', ')}`);
    themeId = DEFAULT_THEME;
  }
  const theme = THEMES[themeId];

  let backdrop = null;
  if (theme.backdrops.length > 0) {
    const requested = normalize(backdropName);
    const candidate = BACKDROP_ALIASES[requested] || requested;
    if (!candidate) {
      backdrop = theme.defaultBackdrop;
    } else if (theme.backdrops.some(b => b.id === candidate)) {
      backdrop = candidate;
    } else {
      warnings.push(`Unknown BLOG_BACKDROP "${requested}" for theme "${themeId}", using "${theme.defaultBackdrop}". Available: ${theme.backdrops.map(b => b.id).join(', ')}`);
      backdrop = theme.defaultBackdrop;
    }
  }

  const chosen = theme.backdrops.find(b => b.id === backdrop);
  const photoCredit = chosen && chosen.credit ? chosen.credit : null;

  return Object.freeze({ ...theme, backdrop, photoCredit, warnings });
}
