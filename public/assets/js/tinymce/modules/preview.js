// Preview Module
// Handles preview functionality for blog posts

/**
 * Get DOMPurify instance - either from window global or dynamic import
 */
function getDOMPurify() {
  // Check if DOMPurify is available globally (loaded via script tag)
  if (typeof window !== 'undefined' && window.DOMPurify) {
    return window.DOMPurify;
  }
  return null;
}

/**
 * Highlight code blocks in the preview container using Prism (if loaded)
 */
function highlightPreviewCode(container) {
  if (typeof Prism === 'undefined') return;

  container.querySelectorAll('pre:not([class*="language-"])').forEach(function(p) {
    p.classList.add('language-plaintext');
    var c = p.querySelector('code');
    if (c && !c.className.match(/language-/)) c.classList.add('language-plaintext');
  });
  Prism.highlightAllUnder(container);
}

const PREVIEW_LAYOUTS = ['standard', 'wide', 'magazine'];

/**
 * Mirror the layout chosen in the editor (select[name="layout"]) as post-layout-<value> on the preview section,
 * so the preview shows what the layout adds (e.g. the initial and closing mark of the magazine layout).
 * @param {HTMLElement} previewContentElement
 */
function applyPreviewLayout(previewContentElement) {
  const section = previewContentElement.closest ? previewContentElement.closest('.form-preview') : null;
  if (!section) return;
  const select = document.querySelector('select[name="layout"]');
  const layout = select && PREVIEW_LAYOUTS.includes(select.value) ? select.value : 'standard';
  PREVIEW_LAYOUTS.forEach(l => section.classList.toggle(`post-layout-${l}`, l === layout));
}

/**
 * Update preview of blog post
 */
export function updatePreview() {
  const titleElement = document.getElementById('title');
  const tagsElement = document.getElementById('tags');
  const previewContentElement = document.getElementById('preview-content');

  if (!previewContentElement) {
    console.warn('Preview content element not found');
    return;
  }

  // Get title, tags, and content
  const title = titleElement ? titleElement.value : '';
  const tags = tagsElement ? tagsElement.value : '';

  const tinymceEditor = tinymce.get('content');
  let content = '';

  if (tinymceEditor) {
    content = tinymceEditor.getContent();
  } else {
    const contentElement = document.getElementById('content');
    if (contentElement) {
      content = contentElement.value;
    }
  }

  // Build preview HTML with title, tags, and content
  const DOMPurify = getDOMPurify();
  if (DOMPurify && DOMPurify.sanitize) {
    const sanitizeOptions = {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'option', 'meta', 'link'],
      ADD_ATTR: ['style', 'class', 'id', 'align'],
      ALLOW_DATA_ATTR: false,
    };
    let previewHTML = '';

    // Add title if present
    if (title && title.trim()) {
      previewHTML += `<h1 class="preview-title-heading">${DOMPurify.sanitize(title, sanitizeOptions)}</h1>`;
    }

    // Add tags if present
    if (tags && tags.trim()) {
      const tagList = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      if (tagList.length > 0) {
        previewHTML += '<div class="preview-tags">';
        tagList.forEach(tag => {
          previewHTML += `<span class="preview-tag">${DOMPurify.sanitize(tag, sanitizeOptions)}</span>`;
        });
        previewHTML += '</div>';
      }
    }

    // Add horizontal divider if title or tags present
    if (previewHTML) {
      previewHTML += '<hr class="preview-divider">';
    }

    // Add content
    previewHTML += DOMPurify.sanitize(content, sanitizeOptions);

    // Show placeholder if everything is empty
    if (!previewHTML.trim()) {
      previewHTML = '<p class="preview-placeholder">Die Vorschau wird hier angezeigt, sobald du schreibst...</p>';
    }

    previewContentElement.innerHTML = previewHTML;
    applyPreviewLayout(previewContentElement);
    highlightPreviewCode(previewContentElement);
  } else {
    console.warn('DOMPurify not available, showing plain text preview');
    previewContentElement.textContent = 'Preview nicht verfügbar (DOMPurify nicht geladen)';
  }
}

/**
 * Toggle preview visibility
 */
export function togglePreview() {
  const previewBox = document.querySelector('.form-preview');
  const toggleBtn = document.getElementById('toggle-preview-btn');

  if (!previewBox || !toggleBtn) {
    console.error('Preview box or toggle button not found');
    return;
  }

  // Always update preview to ensure it shows current content
  updatePreview();

  const isCurrentlyHidden = !previewBox.classList.contains('preview-visible');

  if (isCurrentlyHidden) {
    previewBox.classList.add('preview-visible');
    toggleBtn.innerHTML = '<span class="btn-icon">🙈</span> Vorschau ausblenden';
  } else {
    previewBox.classList.remove('preview-visible');
    toggleBtn.innerHTML = '<span class="btn-icon">👀</span> Vorschau einblenden';
  }
}

// Listen for theme changes to update preview styling
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('themeChanged', function() {
    const previewBox = document.querySelector('.form-preview');
    if (previewBox && previewBox.classList.contains('preview-visible')) {
      updatePreview();
    }
  });

  // Listen for TinyMCE content changes to update preview
  document.addEventListener('tinymce:contentChanged', function() {
    const previewBox = document.querySelector('.form-preview');
    if (previewBox && previewBox.classList.contains('preview-visible')) {
      updatePreview();
    }
  });

  // A different layout changes the preview as well
  document.addEventListener('change', function(event) {
    const target = event.target;
    if (!target || target.name !== 'layout') return;
    const previewBox = document.querySelector('.form-preview');
    if (previewBox && previewBox.classList.contains('preview-visible')) {
      updatePreview();
    }
  });

  // Listen for AI assistant refresh requests (always update, regardless of visibility)
  document.addEventListener('ai-assistant:refresh-preview', function() {
    updatePreview();
  });
}
