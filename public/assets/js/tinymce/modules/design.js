// Design Module ("Gestaltung")
// Layout and decoration of a post: image placement, paragraph styles, boxes, quotes and ornaments.
// Everything is written as classes. The server removes style attributes and unwraps class-only <span>s
// (shared/text.js cleanPostContent), so TinyMCE's default inline styles would be lost on saving.
// The themes style the classes in themes/soft/content.css and css/content.css (also loaded in the editor).

const TEXT_BLOCKS = 'p,h1,h2,h3,h4,h5,h6,td,th,tr,div,ul,ol,li,pre';

/**
 * TinyMCE alignment format that writes classes instead of inline styles: images (and captioned figures)
 * float with align-left/-right (the text flows around them), text blocks get text-left/-center/-right/-justify.
 * @param {'left'|'center'|'right'|'justify'} side
 * @returns {Object[]}
 */
function alignFormat(side) {
  const formats = [];
  if (side !== 'justify') {
    formats.push({ selector: 'figure.image', collapsed: false, classes: `align-${side}`, ceFalseOverride: true, preview: 'font-family font-size' });
  }
  formats.push({ selector: TEXT_BLOCKS, classes: `text-${side}`, inherit: false, preview: false });
  if (side !== 'justify') {
    formats.push({ selector: 'img', collapsed: false, classes: `align-${side}`, preview: 'font-family font-size' });
  }
  return formats;
}

/** Paragraph styles (toggle independently; Initiale and Kapitälchen go well together) */
export const PARAGRAPH_STYLES = Object.freeze([
  { format: 'pc_lead', className: 'pc-lead', text: 'Einleitung (größer, kursiv)' },
  { format: 'pc_dropcap', className: 'pc-dropcap', text: 'Initiale (großer Anfangsbuchstabe)' },
  { format: 'pc_smallcaps', className: 'pc-smallcaps', text: 'Kapitälchen-Auftakt (erste Zeile)' },
  { format: 'pc_end', className: 'pc-end', text: 'Schlusszeichen ◆' },
]);

/** Boxes wrap the selected paragraphs */
export const BOX_STYLES = Object.freeze([
  { format: 'pc_note', text: 'Hinweis-Kasten' },
  { format: 'pc_key', text: 'Kernsatz (mittig, zwischen Linien)' },
  { format: 'pc_margin', text: 'Randnotiz (rechts, Text fließt herum)' },
  { format: 'pc_columns', text: 'Zwei Spalten' },
]);

export const QUOTE_STYLES = Object.freeze([
  { format: 'pc_pullquote', text: 'Herausgestelltes Zitat (groß, mittig)' },
  { format: 'pc_pullquote_right', text: 'Herausgestelltes Zitat (rechts, Text fließt herum)' },
]);

/** Ornament dividers: <hr class="pc-divider pc-divider--<id>"> */
export const DIVIDERS = Object.freeze([
  { id: 'flourish', text: 'Ranke' },
  { id: 'leaves', text: 'Blätter' },
  { id: 'stars', text: 'Sterne (⁂)' },
  { id: 'diamonds', text: 'Rauten' },
]);

/** Classes of the elements the "Gestaltung" menu creates (wrappers it can remove again) */
const DESIGN_BLOCK_SELECTOR = 'aside.pc-note, aside.pc-key, aside.pc-margin, section.pc-columns, blockquote.pc-pullquote, blockquote.pc-epigraph';

/**
 * Formats for the TinyMCE `formats` option: class-based alignment plus the design styles.
 * @returns {Object}
 */
export function getDesignFormats() {
  const wrapper = (block, classes) => ({ block, classes, wrapper: true, merge_siblings: false });
  return {
    alignleft: alignFormat('left'),
    aligncenter: alignFormat('center'),
    alignright: alignFormat('right'),
    alignjustify: alignFormat('justify'),
    ...Object.fromEntries(PARAGRAPH_STYLES.map(s => [s.format, { selector: 'p', classes: s.className }])),
    pc_note: wrapper('aside', 'pc-note'),
    pc_key: wrapper('aside', 'pc-key'),
    pc_margin: wrapper('aside', 'pc-margin'),
    pc_columns: wrapper('section', 'pc-columns'),
    pc_pullquote: wrapper('blockquote', 'pc-pullquote'),
    pc_pullquote_right: wrapper('blockquote', ['pc-pullquote', 'align-right']),
    pc_mark: { inline: 'mark' },
  };
}

/**
 * The "Formate" menu (menubar Format → Formate) lists the same styles.
 * @returns {Object[]}
 */
export function getDesignStyleFormats() {
  return [
    { title: 'Absatz', items: PARAGRAPH_STYLES.map(s => ({ title: s.text, format: s.format })) },
    { title: 'Kästen', items: BOX_STYLES.map(s => ({ title: s.text, format: s.format })) },
    { title: 'Zitate', items: QUOTE_STYLES.map(s => ({ title: s.text, format: s.format })) },
    { title: 'Textmarker', format: 'pc_mark' },
  ];
}

/**
 * The image (or captioned figure) the selection is on, where layout classes belong.
 * @param {Object} editor
 * @returns {HTMLElement|null}
 */
export function getImageTarget(editor) {
  const node = editor.selection.getNode();
  if (!node) return null;
  const figure = editor.dom.getParent(node, 'figure.image');
  if (figure) return figure;
  return node.nodeName === 'IMG' ? node : null;
}

function changeImage(editor, change) {
  const target = getImageTarget(editor);
  if (!target) return;
  editor.undoManager.transact(() => change(target));
  editor.nodeChanged();
}

/**
 * Image size: s (small), m (normal) or l (large). Floating images take 30 / 42 / 56 % of the column,
 * centred ones half, their natural size or the full column.
 */
function setImageSize(editor, size) {
  changeImage(editor, (target) => {
    editor.dom.removeClass(target, 'pc-size-s');
    editor.dom.removeClass(target, 'pc-size-l');
    if (size !== 'm') editor.dom.addClass(target, `pc-size-${size}`);
  });
}

/** Wider than the text column; such an image does not float */
function toggleImageWide(editor) {
  changeImage(editor, (target) => {
    if (editor.dom.hasClass(target, 'pc-wide')) {
      editor.dom.removeClass(target, 'pc-wide');
      return;
    }
    ['align-left', 'align-right', 'align-center', 'pc-size-s', 'pc-size-l'].forEach(c => editor.dom.removeClass(target, c));
    editor.dom.addClass(target, 'pc-wide');
  });
}

/** Float the image (left/right) or centre it, through the alignment formats so the toolbar shows the state */
function alignImage(editor, side) {
  const target = getImageTarget(editor);
  if (target && editor.dom.hasClass(target, 'pc-wide')) editor.dom.removeClass(target, 'pc-wide');
  editor.execCommand({ left: 'JustifyLeft', center: 'JustifyCenter', right: 'JustifyRight' }[side]);
}

function imageHasClass(editor, className) {
  const target = getImageTarget(editor);
  return !!target && editor.dom.hasClass(target, className);
}

function imageSize(editor) {
  if (imageHasClass(editor, 'pc-size-s')) return 's';
  if (imageHasClass(editor, 'pc-size-l')) return 'l';
  return 'm';
}

function insertDivider(editor, id) {
  editor.insertContent(`<hr class="pc-divider pc-divider--${id}">`);
}

/** Remove the box/quote around the cursor, keeping its content */
function removeDesignBlock(editor) {
  const block = editor.dom.getParent(editor.selection.getNode(), DESIGN_BLOCK_SELECTOR);
  if (!block) return;
  editor.undoManager.transact(() => editor.dom.remove(block, true));
  editor.nodeChanged();
}

function openEpigraphDialog(editor) {
  editor.windowManager.open({
    title: 'Motto einfügen',
    body: {
      type: 'panel',
      items: [
        { type: 'textarea', name: 'quote', label: 'Motto (kurzes Zitat)', placeholder: 'Erkenne dich selbst.' },
        { type: 'input', name: 'source', label: 'Quelle', placeholder: 'Inschrift am Apollontempel in Delphi' },
      ],
    },
    buttons: [
      { type: 'cancel', text: 'Abbrechen' },
      { type: 'submit', text: 'Einfügen', primary: true },
    ],
    onSubmit(api) {
      const { quote, source } = api.getData();
      if (quote && quote.trim()) {
        const lines = quote.trim().split(/\n+/).map(line => `<p>${editor.dom.encode(line)}</p>`).join('');
        const cite = source && source.trim() ? `<footer><cite>${editor.dom.encode(source.trim())}</cite></footer>` : '';
        editor.insertContent(`<blockquote class="pc-epigraph">${lines}${cite}</blockquote><p></p>`);
      }
      api.close();
    },
  });
}

const formatItem = (editor, { format, text }) => ({
  type: 'togglemenuitem',
  text,
  onAction: () => editor.execCommand('mceToggleFormat', false, format),
  onSetup: (api) => {
    api.setActive(editor.formatter.match(format));
    return () => {};
  },
});

const imageItem = (editor, text, onAction, isActive) => ({
  type: 'togglemenuitem',
  text,
  onAction,
  onSetup: (api) => {
    api.setEnabled(!!getImageTarget(editor));
    api.setActive(isActive());
    return () => {};
  },
});

function getMenuItems(editor) {
  return [
    {
      type: 'nestedmenuitem',
      text: 'Absatz',
      getSubmenuItems: () => [
        ...PARAGRAPH_STYLES.map(s => formatItem(editor, s)),
        { type: 'separator' },
        {
          type: 'menuitem',
          text: 'Normaler Absatz',
          onAction: () => PARAGRAPH_STYLES.forEach(s => editor.formatter.remove(s.format)),
        },
      ],
    },
    {
      type: 'nestedmenuitem',
      text: 'Kasten',
      getSubmenuItems: () => [
        ...BOX_STYLES.map(s => formatItem(editor, s)),
        { type: 'menuitem', text: 'Exkurs (aufklappbar)', onAction: () => editor.execCommand('InsertAccordion') },
        { type: 'separator' },
        { type: 'menuitem', text: 'Kasten/Zitat entfernen (Text bleibt)', onAction: () => removeDesignBlock(editor) },
      ],
    },
    {
      type: 'nestedmenuitem',
      text: 'Zitat',
      getSubmenuItems: () => [
        ...QUOTE_STYLES.map(s => formatItem(editor, s)),
        { type: 'menuitem', text: 'Motto mit Quelle …', onAction: () => openEpigraphDialog(editor) },
      ],
    },
    {
      type: 'nestedmenuitem',
      text: 'Bild (vorher anklicken)',
      getSubmenuItems: () => [
        imageItem(editor, 'Links, Text fließt rechts herum', () => alignImage(editor, 'left'), () => imageHasClass(editor, 'align-left')),
        imageItem(editor, 'Rechts, Text fließt links herum', () => alignImage(editor, 'right'), () => imageHasClass(editor, 'align-right')),
        imageItem(editor, 'Mittig', () => alignImage(editor, 'center'), () => imageHasClass(editor, 'align-center')),
        imageItem(editor, 'Breit (über die Textspalte hinaus)', () => toggleImageWide(editor), () => imageHasClass(editor, 'pc-wide')),
        { type: 'separator' },
        imageItem(editor, 'Klein', () => setImageSize(editor, 's'), () => imageSize(editor) === 's'),
        imageItem(editor, 'Normal', () => setImageSize(editor, 'm'), () => imageSize(editor) === 'm'),
        imageItem(editor, 'Groß', () => setImageSize(editor, 'l'), () => imageSize(editor) === 'l'),
      ],
    },
    {
      type: 'nestedmenuitem',
      text: 'Trenner (Verzierung)',
      getSubmenuItems: () => DIVIDERS.map(d => ({ type: 'menuitem', text: d.text, onAction: () => insertDivider(editor, d.id) })),
    },
    formatItem(editor, { format: 'pc_mark', text: 'Textmarker' }),
  ];
}

/**
 * Register the "Gestaltung" menu button, the image layout buttons used by the image quick toolbar
 * (quickbars_image_toolbar) and the handling of <details> (Exkurs): open while editing, closed in the post.
 * @param {Object} editor - TinyMCE editor instance
 */
export function setupDesign(editor) {
  editor.ui.registry.addMenuButton('pcdesign', {
    text: 'Gestaltung',
    icon: 'format-painter',
    tooltip: 'Gestaltung: Absätze, Kästen, Zitate, Bilder, Verzierungen',
    fetch: (callback) => callback(getMenuItems(editor)),
  });

  const imageToggle = (name, { text, tooltip, onAction, isActive }) => {
    editor.ui.registry.addToggleButton(name, {
      text,
      tooltip,
      onAction,
      onSetup: (api) => {
        const update = () => api.setActive(isActive());
        update();
        editor.on('NodeChange', update);
        return () => editor.off('NodeChange', update);
      },
    });
  };
  imageToggle('pcimgsmall', { text: 'S', tooltip: 'Bild klein', onAction: () => setImageSize(editor, 's'), isActive: () => imageSize(editor) === 's' });
  imageToggle('pcimgmedium', { text: 'M', tooltip: 'Bild normal', onAction: () => setImageSize(editor, 'm'), isActive: () => imageSize(editor) === 'm' });
  imageToggle('pcimglarge', { text: 'L', tooltip: 'Bild groß', onAction: () => setImageSize(editor, 'l'), isActive: () => imageSize(editor) === 'l' });
  imageToggle('pcimgwide', { text: 'Breit', tooltip: 'Bild breiter als die Textspalte', onAction: () => toggleImageWide(editor), isActive: () => imageHasClass(editor, 'pc-wide') });

  // An "Exkurs" is a <details> (accordion plugin): always open while editing, always closed when the post
  // is read; the reader opens it.
  editor.on('PreInit', () => {
    editor.parser.addNodeFilter('details', (nodes) => nodes.forEach(node => node.attr('open', 'open')));
    editor.serializer.addNodeFilter('details', (nodes) => nodes.forEach(node => node.attr('open', null)));
  });

  const tiny = typeof window !== 'undefined' ? window.tinymce : null;
  if (tiny && typeof tiny.addI18n === 'function') {
    tiny.addI18n('de', {
      'Accordion summary...': 'Exkurs',
      'Accordion body...': 'Hier steht der Exkurs. Leser klappen ihn mit einem Klick auf.',
      'Insert accordion': 'Exkurs (aufklappbar) einfügen',
      'Accordion': 'Exkurs',
    });
  }
}
