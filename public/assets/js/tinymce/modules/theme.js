// Theme Module
// radical (original): the editor stays dark, tinymce-content.css handles all styling.
// soft: the editor is light; the iframe takes over the blog's palette so it matches the active backdrop.

// Custom properties of the soft theme that /assets/css/themes/soft/tinymce-content.css reads
const SOFT_PALETTE_VARS = [
  '--surface-solid', '--surface-sunken',
  '--text', '--text-dim', '--text-faint',
  '--accent', '--accent-strong',
  '--line', '--line-strong',
  '--tone-1', '--tone-2', '--tone-3', '--tone-4',
  '--shadow-rgb', '--font-text', '--font-ui',
];

/**
 * True when the page uses the light "soft" theme (set by views/layout.ejs on <html>).
 * @returns {boolean}
 */
export function isSoftTheme() {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'soft';
}

/**
 * Apply the page theme to a TinyMCE editor: copies the active backdrop's palette into the
 * editor iframe (soft theme only; a no-op for the original dark theme).
 * @param {Object} editor - TinyMCE editor instance
 */
export function applyTinyMCETheme(editor) {
  if (!isSoftTheme() || !editor || typeof editor.getDoc !== 'function') return;
  const doc = editor.getDoc();
  if (!doc || !doc.documentElement) return;
  const computed = getComputedStyle(document.documentElement);
  for (const name of SOFT_PALETTE_VARS) {
    const value = computed.getPropertyValue(name).trim();
    if (value) doc.documentElement.style.setProperty(name, value);
  }
}

/**
 * Update TinyMCE theme for all editors (e.g. after the backdrop changed).
 */
export function updateTinyMCETheme() {
  const tiny = typeof window !== 'undefined' ? window.tinymce : null;
  if (tiny && Array.isArray(tiny.editors)) tiny.editors.forEach(applyTinyMCETheme);
}
