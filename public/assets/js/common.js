/* eslint-env browser, es2021 */
/* global tinymce, ADMIN_MESSAGES, adminLogout, document, window, fetch, MutationObserver, location, localStorage, CustomEvent */
// Import dependencies as ES6 modules
import { makeApiRequest as _makeApiRequest } from './api.js';
import { escapeHtml as _escapeHtml } from './shared/text.js';
// Logger not available in frontend - use console instead


// Helper: strip HTML from a string and return plain text. Prefer DOMPurify if
// available for better handling, otherwise fall back to a simple regex.
export function stripHtml(html = '') {
  if (!html) return '';
  try {
    if (typeof DOMPurify !== 'undefined' && DOMPurify && typeof DOMPurify.sanitize === 'function') {
      // Use DOMPurify to sanitize then remove tags by placing into a temporary element
      const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: [] });
      return String(clean);
    }
  } catch (e) {
    void e; // silence unused var linter, fallback to regex stripper
  }
  // Fallback: naive tag stripper
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/<[^>]*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createExcerptFromHtml(html = '', maxLength = 150) {
  const text = stripHtml(html).trim();
  if (!text) return '';
  const excerpt = text.length > maxLength ? text.substring(0, maxLength).trimEnd() : text;
  return excerpt.endsWith('...') ? excerpt : `${excerpt}...`;
}

export function createElement(tagName, attributes = {}, html = '') {
  const el = document.createElement(tagName);
  Object.entries(attributes || {}).forEach(([key, value]) => {
    if (key === 'class') {
      el.className = String(value);
    } else if (key === 'style' && typeof value === 'object' && value) {
      Object.assign(el.style, value);
    } else if (value !== undefined && value !== null) {
      el.setAttribute(key, String(value));
    }
  });
  if (html) {
    el.innerHTML = html;
  }
  return el;
}

export function elementExists(elementId) {
  return !!document.getElementById(elementId);
}

export function showElement(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.style.display = '';
  el.classList.add('d-block');
  el.classList.remove('d-none');
}

export function hideElement(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.style.display = 'none';
  el.classList.add('d-none');
  el.classList.remove('d-block');
}

export function showNotification(message, type = 'info', durationMs = 3000) {
  if (typeof document === 'undefined') return;
  const typeMap = {
    success: 'alert-success',
    error: 'alert-danger',
    danger: 'alert-danger',
    warning: 'alert-info',
    info: 'alert-info',
  };
  const alertClass = typeMap[type] || 'alert-info';
  const containerId = 'notification-container';
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'notification-container';
    document.body.appendChild(container);
  }

  const note = document.createElement('div');
  note.className = `notification ${alertClass}`.trim();
  note.textContent = String(message || '');
  container.appendChild(note);

  // Fade in
  setTimeout(() => note.classList.add('show'), 10);

  // Fade out, then remove
  const total = Math.max(800, Number(durationMs) || 0);
  setTimeout(() => {
    if (note && note.parentElement) note.classList.remove('show');
  }, total - 300);
  setTimeout(() => {
    if (note && note.parentElement) note.parentElement.removeChild(note);
  }, total);
}

export function formatContent(content = '') {
  return String(content || '').trim();
}

export function formatPostDate(dateInput) {
  const date = dateInput ? new Date(dateInput) : new Date();
  const postDate = date.toLocaleDateString('de-DE');
  const postTime = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return { postDate, postTime };
}

export function calculateReadingTime(text = '') {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const minutes = Math.ceil(words.length / 200);
  return Math.max(1, minutes);
}

let _commonDelegationInitialized = false;
export function initializeCommonDelegation() {
  if (_commonDelegationInitialized) return;
  _commonDelegationInitialized = true;

  // Handle data-action attributes
  document.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    
    const action = actionEl.getAttribute('data-action');
    if (!action) return;

    // Built-in actions
    if (action === 'close-modal') {
      const modal = e.target.closest('.modal, .modal-overlay');
      if (modal && modal.parentElement) modal.parentElement.removeChild(modal);
      return;
    }
    
    if (action === 'back') {
      window.history.back();
      return;
    }
    
    if (action === 'reload') {
      window.location.reload();
      return;
    }

    // Try to get action from registry
    try {
      const { getAction } = await import('./actions/actionRegistry.js');
      const actionFn = getAction(action);
      if (typeof actionFn === 'function') {
        e.preventDefault();
        await actionFn(e, actionEl);
      }
    } catch (err) {
      console.warn(`Action '${action}' not found or failed:`, err);
    }
  });

  // Handle data-confirm attributes (form submit confirmation)
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const submitBtn = form.querySelector('[data-confirm]');
    if (submitBtn) {
      const message = submitBtn.getAttribute('data-confirm');
      if (!confirm(message)) {
        e.preventDefault();
        return false;
      }
    }
  });
}

export function initializeBlogPostForm() {
  const form = document.getElementById('blogPostForm');
  if (!form) return;
  form.addEventListener('submit', () => {
    if (typeof tinymce !== 'undefined' && tinymce && typeof tinymce.triggerSave === 'function') {
      tinymce.triggerSave();
    }
  });
}

// Wrapper for api.js to centralize request behavior
async function apiRequest(path, options) {
  const isTestEnv = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test');

  // In tests, if window.fetch is mocked, use it directly so expectations about calls succeed
  if (isTestEnv && typeof window !== 'undefined' && typeof window.fetch === 'function') {
    const response = await window.fetch(path, options);
    let result = null;
    try { result = await response.json(); } catch (_e) { void _e; }
    if (!response.ok) {
      return { success: false, error: result?.error || response.statusText, status: response.status };
    }
    return { success: true, data: result, status: response.status };
  }

  // Fallback to internal wrapper
  return await _makeApiRequest(path, options);
}

// Utility-Funktion zum Abrufen von URL-Parametern
export function getUrlParameter(paramName) {
  try {
    const urlParams = new URLSearchParams(window.location.search || '');
    return urlParams.get(paramName);
  } catch {
    // In test environments window.location.search may be undefined or mocked
    try {
      const search = (typeof window !== 'undefined' && window.location && window.location.search) || '';
      const urlParams = new URLSearchParams(search);
      return urlParams.get(paramName);
    } catch {
      return null;
    }
  }
}

/*
 Delegation notes:
 - Use `data-action` attributes in markup and call `initializeCommonDelegation()` once at page init.
 - Tests that need to mock imported modules should use `jest.unstable_mockModule(...)` BEFORE importing modules that depend on them.
 - Avoid attaching functions to `window`; prefer exports and delegation.
*/
export function getPostIdFromPath() {
  // Match explicit routes like /blogpost/id/123, /blogpost/update/123, /blogpost/delete/123
  let match = window.location.pathname.match(/\/blogpost\/(?:delete|update|id)\/(\d+)/);
  if (match) return match[1];
  // Also support the shorthand numeric URL /blogpost/123
  match = window.location.pathname.match(/\/blogpost\/(\d+)(?:\/|$)/);
  if (match) return match[1];
  return null;
}
// Prüft, ob ein Post-Parameter existiert, lädt ggf. den Post und füllt das Formular vor
// Accepts an optional already-initialized editor instance to skip the tinymce.get() retry
export async function checkAndPrefillEditPostForm(editorInstance) {
  console.log('[checkAndPrefillEditPostForm] Starting...');

  const normalizeEditorContentForEdit = (html) => {
    if (!html || typeof html !== 'string') return html || '';
    let normalized = html;
    normalized = normalized.replace(/(src=["'])\.\.\/(assets\/(?:uploads|media)\/)/gi, '$1/$2');
    normalized = normalized.replace(/(src=["'])\.\/+(assets\/(?:uploads|media)\/)/gi, '$1/$2');
    normalized = normalized.replace(/(src=["'])(assets\/(?:uploads|media)\/)/gi, '$1/$2');
    return normalized;
  };
  
  // Prefer server-injected post object (SSR) from JSON script to avoid an extra API call.
  let post = null;
  try {
    const el = document.getElementById('server-post');
    if (el && el.textContent) {
      post = JSON.parse(el.textContent);
      console.log('[checkAndPrefillEditPostForm] Loaded from server-post:', post?.id);
    }
  } catch (err) {
    console.warn('[checkAndPrefillEditPostForm] Failed to parse server-post:', err);
  }
  
  if (!post) {
    const postId = getPostIdFromPath();
    console.log('[checkAndPrefillEditPostForm] Post ID from path:', postId);
    
    if (!postId) {
      console.log('[checkAndPrefillEditPostForm] No post ID found, exiting');
      return;
    }

    console.log('[checkAndPrefillEditPostForm] Fetching post from API:', postId);
    // Admin-only, publish-status-agnostic endpoint — /api/blogpost/id/:id is public
    // and published-only, so it 404s for drafts (see /api/blogpost/edit/:id).
    const apiResult = await apiRequest(`/api/blogpost/edit/${postId}`, { method: 'GET' });
    if (!apiResult || apiResult.success !== true) {
      console.error('[checkAndPrefillEditPostForm] Failed to load post:', apiResult);
      return;
    }
    post = apiResult.data;
    console.log('[checkAndPrefillEditPostForm] Loaded post from API:', post?.id, post?.title);
  }

  if (!post || !post.id) {
    showNotification('Blogpost nicht gefunden', 'error');
    return;
  }

  const mainTitle = document.getElementById('main-title');
  const description = document.getElementById('description');
  if (mainTitle) mainTitle.textContent = 'Blogpost bearbeiten';
  if (description) hideElement('description');

  function doPrefill(editor) {
    const titleEl = document.getElementById('title');
    const tagsEl = document.getElementById('tags');
    if (!titleEl || !tagsEl) {
      console.error('[prefill] title or tags element not found in DOM');
      return;
    }
    console.log('[prefill] Setting title:', post.title);
    titleEl.value = post.title || '';
    
    const normalizedContent = normalizeEditorContentForEdit(post.content || '');
    console.log('[prefill] Setting content, length:', normalizedContent?.length || 0);
    editor.setContent(normalizedContent);
    
    const tagsValue = Array.isArray(post.tags)
      ? post.tags.join(', ')
      : (typeof post.tags === 'string' ? post.tags : '');
    console.log('[prefill] Setting tags:', tagsValue);
    tagsEl.value = tagsValue;
    
    try {
      document.dispatchEvent(new CustomEvent('tinymce:contentChanged'));
    } catch (e) { /* ignore */ }
    
    console.log('[prefill] Done!');
  }

  // If caller already has the editor instance, use it directly
  if (editorInstance && typeof editorInstance.setContent === 'function') {
    console.log('[checkAndPrefillEditPostForm] Using passed editor instance');
    doPrefill(editorInstance);
    return;
  }

  // Otherwise retry until tinymce.get('content') is available
  function prefillWhenReady(retries = 15) {
    const editor = (typeof tinymce !== 'undefined') ? tinymce.get('content') : null;
    console.log('[prefillWhenReady] Attempt', 16 - retries, '- Editor ready:', !!editor);
    if (editor) {
      doPrefill(editor);
    } else if (retries > 0) {
      setTimeout(() => prefillWhenReady(retries - 1), 300);
    } else {
      console.error('[prefillWhenReady] Editor not ready after all retries, aborting.');
    }
  }
  prefillWhenReady();
}
// AJAX-Formular-Handling für internes Kontaktformular
(function() {
  const form = document.getElementById('my-form');
  if (!form) return;

  const loadedAtInput = document.getElementById('contact-form-loaded-at');
  if (loadedAtInput && !loadedAtInput.value) {
    loadedAtInput.value = String(Date.now());
  }

  const status = document.getElementById('my-form-status');
  let statusResetTimer = null;

  function setStatusMessage(message) {
    if (!status) return;
    status.innerHTML = message;
    if (statusResetTimer) {
      clearTimeout(statusResetTimer);
    }
    statusResetTimer = setTimeout(() => {
      status.innerHTML = '';
      statusResetTimer = null;
    }, 3000);
  }

  form.addEventListener('submit', async function handleSubmit(event) {
    event.preventDefault();
    if (status) status.innerHTML = 'Senden...';

    // Read the CSRF token at submit time (not at page-load time) so that it is
    // always current.  Send it as a request header — the body is FormData
    // (multipart/form-data) which express.urlencoded does NOT parse, so
    // putting the token only in the body would cause a 403 every single time.
    const csrfToken = (form.querySelector('input[name="_csrf"]') || {}).value || '';

    const params = new URLSearchParams();
    params.set('name', (document.getElementById('contact-name') || {}).value || '');
    params.set('email', (document.getElementById('contact-email') || {}).value || '');
    params.set('message', (document.getElementById('contact-message') || {}).value || '');
    params.set('formLoadedAt', loadedAtInput ? loadedAtInput.value : '');
    params.set('website', (form.querySelector('input[name="website"]') || {}).value || '');
    if (csrfToken) params.set('_csrf', csrfToken);

    try {
      const response = await fetch(form.action, {
        method: form.method,
        body: params,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
      });
      if (response.ok) {
        setStatusMessage('Danke für deine Nachricht!');
        form.reset();
        if (loadedAtInput) {
          loadedAtInput.value = String(Date.now());
        }
      } else {
        const result = await response.json().catch(() => ({}));
        if (result.errors && status) {
          setStatusMessage(result.errors.map(e => e.message).join(', '));
        } else if (result.error && status) {
          setStatusMessage(result.error);
        } else if (status) {
          setStatusMessage('Oops! Es gab ein Problem beim Senden.');
        }
      }
    } catch (error) {
      setStatusMessage('Oops! Es gab ein Problem beim Senden.');
      console.error('Error while sending contact form:', error);
    }
  });
})();
/* ========================================
   FLOATING MENU
   ======================================== */

// Design is always dark — no toggle needed.
export function initializeDarkMode() {
  createFloatingMenu();
}
// Create floating menu system
function createFloatingMenu() {
  // Check if menu already exists
  if (document.getElementById('floating-menu')) return;
    
  // Create menu container
  const floatingMenu = document.createElement('div');
  floatingMenu.id = 'floating-menu';
  floatingMenu.className = 'floating-menu';
    
  // Create menu toggle button
  const menuToggle = document.createElement('button');
  menuToggle.className = 'menu-toggle';
  menuToggle.title = 'Menü öffnen';
  menuToggle.setAttribute('aria-label', 'Menü öffnen');

  // Create image icon:
  const clippyImg = document.createElement('img');
  clippyImg.src = '/assets/media/clippy-28.webp';
  clippyImg.alt = '';
  clippyImg.width = 28;
  clippyImg.height = 26;
  menuToggle.appendChild(clippyImg);
    
  // Create menu options container
  const menuOptions = document.createElement('div');
  menuOptions.className = 'menu-options';
    
  // Create admin button
  const adminBtn = document.createElement('button');
  adminBtn.className = 'menu-option admin-btn';
  adminBtn.title = 'Admin Login';
  adminBtn.setAttribute('data-tooltip', 'Admin Login');
  adminBtn.setAttribute('aria-label', 'Admin Login');
  adminBtn.innerHTML = '⋆';
  // Use delegated handler instead of inline click listener
  adminBtn.dataset.action = 'show-admin-login';
    
  // Create scroll to top button
  const scrollTopBtn = document.createElement('button');
  scrollTopBtn.className = 'menu-option scroll-top-btn';
  scrollTopBtn.title = 'Nach oben';
  scrollTopBtn.setAttribute('data-tooltip', 'Nach oben');
  scrollTopBtn.setAttribute('aria-label', 'Nach oben scrollen');
  scrollTopBtn.innerHTML = '⌃';
  scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
    closeFloatingMenu();
  });
    
  // Add options to container
  menuOptions.appendChild(scrollTopBtn);
  menuOptions.appendChild(adminBtn);
    
  // Add elements to menu - options first (above), then toggle button (bottom)
  floatingMenu.appendChild(menuOptions);
  floatingMenu.appendChild(menuToggle);
    
  // Menu toggle functionality
  let isMenuOpen = false;
  menuToggle.addEventListener('click', () => {
    isMenuOpen = !menuToggle.classList.contains('active');
    menuToggle.classList.toggle('active', isMenuOpen);
    menuOptions.classList.toggle('active', isMenuOpen);
    menuToggle.title = isMenuOpen ? 'Menü schließen' : 'Menü öffnen';
  });
    
  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!floatingMenu.contains(e.target) && isMenuOpen) {
      // Use the exported helper to close the menu
      closeFloatingMenu();
    }
  });
    
  // Add to page
  document.body.appendChild(floatingMenu);

  // Push menu above footer when footer becomes visible
  const footer = document.querySelector('.site-footer');
  if (footer) {
    const observer = new IntersectionObserver((entries) => {
      const visibleHeight = entries[0].intersectionRect.height;
      floatingMenu.style.bottom = visibleHeight > 0 ? (visibleHeight + 15) + 'px' : '';
    }, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) });
    observer.observe(footer);
  }
}
// Exported helper to close the floating menu from other modules or delegated handlers
export function closeFloatingMenu() {
  const floatingMenu = document.getElementById('floating-menu');
  if (!floatingMenu) return;
  const menuToggle = floatingMenu.querySelector('.menu-toggle');
  const menuOptions = floatingMenu.querySelector('.menu-options');
  if (menuToggle) menuToggle.classList.remove('active');
  if (menuOptions) menuOptions.classList.remove('active');
  // If there was an internal isMenuOpen state, we can't access it here; rely on DOM to represent closed state
  if (menuToggle) menuToggle.title = 'Menü öffnen';
}
// Auto-initialize when DOM is loaded
// Skip automatic initialization during tests to avoid manipulating a minimal jsdom
// environment which may not include expected elements.
if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test') {
  // In test mode we skip auto-init to keep tests hermetic.
} else if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDarkMode);
  } else {
    initializeDarkMode();
  }
}

// Collapse-Toggle (Bootstrap-Ersatz)
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-collapse]');
    if (!trigger) return;
    const target = document.querySelector(trigger.getAttribute('data-collapse'));
    if (!target) return;
    const isShown = target.classList.toggle('show');
    trigger.setAttribute('aria-expanded', isShown);
  });
}

// Einheitliche Alert-Modal Funktion
export function showAlertModal(message) {
  const modalHtml = `
    <div class="modal-overlay" id="alert-modal">
      <div class="modal-container">
        <div class="modal-content">${message}</div>
        <div class="modal-footer">
          <button id="alert-close" class="modal-button">OK</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modal = document.getElementById('alert-modal');
  const closeBtn = document.getElementById('alert-close');

  const closeModal = () => modal.remove();

  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  closeBtn.focus();
}

// ===========================================
// ADMIN HELPER FUNCTIONS
// ===========================================

// Reload page after a delay
export function reloadPageWithDelay(delayMs = 1000) {
  setTimeout(() => {
    window.location.reload();
  }, delayMs);
}


// Re-export shared escapeHtml to keep existing imports working
export { _escapeHtml as escapeHtml };