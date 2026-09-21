// Admin-System für den Blog
// Alle admin-bezogenen Funktionen sind hier zentralisiert
import { showFeedback } from './feedback.js';
// Import helpers from common module instead of relying on window globals
import {
  hideElement,
  reloadPageWithDelay,
  getUrlParameter,
  showNotification,
} from './common.js';
import { isAdmin, setAdmin } from './state/adminState.js';
import { isAdminFromServer } from './config.js';
import { makeApiRequest } from './api.js';

// Admin-Status (module-scoped via state store)
let currentUser = null;
// Admin-Status Caching mit Timestamp
let adminStatusCache = {
  promise: null,
  result: null,
  timestamp: 0,
  ttl: 5 * 60 * 1000, // 5 Minuten Cache
};
// Admin-System Initialisierung
let adminSystemInitialized = false;
let adminSystemInitPromise = null;

// Admin-Status über HTTP-only Cookie prüfen
// Normalize response to a stable shape: { ok, valid, user }
async function checkAdminStatusCached() {
  const serverSaysAdmin = isAdminFromServer();
  setAdmin(!!serverSaysAdmin);
  currentUser = serverSaysAdmin ? currentUser : null;
  adminStatusCache.result = !!serverSaysAdmin;
  adminStatusCache.timestamp = Date.now();
  return adminStatusCache.result;
}
// Cookie-basiertes Admin Logout 
// Funktion zum Aktualisieren der Navigation basierend auf Admin-Status
function updateNavigationVisibility() {
  const adminNavLink = document.getElementById('admin-nav-link');
  if (adminNavLink) {
    adminNavLink.style.display = isAdmin() ? 'block' : 'none';
  }

  // Create-Links auf anderen Seiten
  const createLinks = document.querySelectorAll('.create-link');
  createLinks.forEach(link => {
    link.style.display = isAdmin() ? 'inline-block' : 'none';
  });

  // Navigation auf /createPost (Admin-geschützte vs. öffentliche Navigation)
  const publicNavigation = document.getElementById('public-navigation');
  if (publicNavigation) {
    publicNavigation.style.display = isAdmin() ? 'none' : 'block';
  }

  if (!isAdmin()) {
    const adminControls = document.getElementById('admin-controls');
    if (adminControls) {
      hideElement('admin-controls');
      adminControls.innerHTML = '';
    }
  }
}
// Modal anzeigen
function showAdminLoginModal() {
  if (isAdmin()) {
    showFeedback('Admin bereits eingeloggt.', 'error');
    return;
  }
  if (document.getElementById('admin-login-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'admin-login-modal';
  modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Login</h3>
            </div>
            <div class="modal-body">
          <form method="POST" action="/auth/login">
            <div>
              <label for="admin-username">Benutzername:</label>
              <input id="admin-username" name="username" type="text" required />
            </div>
            <div>
              <label for="admin-password">Passwort:</label>
              <input id="admin-password" name="password" type="password" required />
            </div>
            <div class="modal-actions">
              <button type="button" id="admin-login-cancel" data-action="close-modal">Abbrechen</button>
              <button type="submit" id="admin-login-submit">Anmelden</button>
            </div>
            <div id="admin-login-error"></div>
          </form>
            </div>
        </div>
    `;
  document.body.appendChild(modal);
    
  // Event-Handler: use delegated/data-action attributes for close and submit
  const cancelBtn = document.getElementById('admin-login-cancel');
  if (cancelBtn) {
    cancelBtn.dataset.action = 'close-modal';
  }

  // Close modal when clicking outside (on overlay)
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      if (modal && modal.parentElement) modal.parentElement.removeChild(modal);
    }
  });

  function _showError(msg) {
    const err = document.getElementById('admin-login-error');
    if (!err) return;
    err.textContent = msg;
    err.style.display = 'block';
  }

  const form = modal.querySelector('form');
  const submitBtn = document.getElementById('admin-login-submit');
  const usernameInput = document.getElementById('admin-username');
  const passwordInput = document.getElementById('admin-password');
  const GENERIC_LOGIN_ERROR = 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.';

  const clearError = () => {
    const err = document.getElementById('admin-login-error');
    if (!err) return;
    err.textContent = '';
    err.style.display = 'none';
  };

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();

      const username = (usernameInput && usernameInput.value ? usernameInput.value : '').trim();
      const password = passwordInput && passwordInput.value ? passwordInput.value : '';

      if (!username || !password) {
        _showError('Bitte Benutzername und Passwort eingeben.');
        return;
      }

      if (submitBtn) submitBtn.disabled = true;

      try {
        const result = await makeApiRequest('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        });

        if (!result.success) {
          _showError(GENERIC_LOGIN_ERROR);
          return;
        }

        setAdmin(true);
        currentUser = result.data && result.data.user ? result.data.user : null;
        showFeedback('Login erfolgreich.', 'success');

        if (modal && modal.parentElement) {
          modal.parentElement.removeChild(modal);
        }

        reloadPageWithDelay(1500);
      } catch (error) {
        console.error('Admin-Login fehlgeschlagen:', error);
        _showError(GENERIC_LOGIN_ERROR);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
}
function resolveCurrentPostId() {
  try {
    // 1) Server-injected JSON via non-executable script tag
    try {
      const el = document.getElementById('server-post');
      if (el && el.textContent) {
        const obj = JSON.parse(el.textContent);
        if (obj && obj.id) return String(obj.id);
      }
    } catch { /* ignore */ }
    // 2) Meta tag
    const meta = document.querySelector('meta[name="post-id"]');
    if (meta && meta.content) return String(meta.content);
    // 3) Any element with data-post-id (e.g., #post-article)
    const dataEl = document.querySelector('[data-post-id]');
    if (dataEl && dataEl.getAttribute('data-post-id')) return String(dataEl.getAttribute('data-post-id'));
    // 4) URL pattern /blogpost/123 or /blogpost/id/123
    const path = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
    const m = path.match(/\/blogpost\/(?:id\/)?(\d+)/);
    if (m && m[1]) return String(m[1]);
    // 5) Legacy query parameter
    const q = getUrlParameter('post');
    if (q) return String(q);
  } catch { /* ignore */ }
  return null;
}

async function addReadPostAdminControls() {
  if (!isAdmin()) return;
  const postId = resolveCurrentPostId();
  if (!postId) return;

  let adminControls = document.getElementById('admin-controls');
  // Fallback: create container inside navigation if missing
  if (!adminControls) {
    const nav = document.querySelector('.navigation') || document.querySelector('.post-footer') || document.body;
    adminControls = document.createElement('div');
    adminControls.id = 'admin-controls';
    adminControls.className = 'mt-15';
    nav.appendChild(adminControls);
  }

  if (adminControls) {
    adminControls.innerHTML = `
      <button type="button" data-action="delete-post" data-post-id="${postId}" class="btn admin-delete-btn">
        Post löschen
      </button>
      <button type="button" class="btn btn-outline-warning" data-action="edit-post" data-post-id="${postId}">
        Post bearbeiten
      </button>
    `;
    // Ensure controls are visible if a utility 'hidden' class is present
    try { adminControls.classList.remove('hidden'); } catch { /* no-op */ }
  }
}
async function initializeAdminSystem() {
  if (adminSystemInitialized) return true;
  if (adminSystemInitPromise) return adminSystemInitPromise;

  adminSystemInitPromise = (async () => {
    try {
      // Seed from SSR config for immediate UI correctness, then verify
      try { setAdmin(isAdminFromServer()); } catch { /* ignore */ }
      const status = await checkAdminStatusCached();
      updateNavigationVisibility();
      adminSystemInitialized = true;
      return status;
    } catch (error) {
      console.error('Admin-Status konnte nicht geprüft werden:', error);
      showFeedback('Verbindung zum Server fehlgeschlagen. Admin-Funktionen stehen nicht zur Verfügung.', 'error');
      adminSystemInitialized = false;
      return false;
    }
  })();

  return adminSystemInitPromise;
}
function addAdminMenuItemToNavbar() {
  if (isAdmin()) {
    const menu = document.getElementById('navbar-menu-items');
    if (menu && !document.getElementById('admin-nav-link')) {
      const adminLi = document.createElement('li');
      adminLi.id = 'admin-nav-link';
      adminLi.innerHTML = '<a href="/admin">Admin</a>';
      menu.insertBefore(adminLi, menu.firstChild.nextSibling);
    }
  }
}
const ADMIN_CONFIG = {
  ELEMENT_WAIT_TIMEOUT: 5000,
};

// Exporting showAdminLoginModal is enough for modules to import it;
// avoid attaching to `window` to keep modules pure.


function getCurrentUser() {
  return currentUser;
}

export { initializeAdminSystem, addAdminMenuItemToNavbar, checkAdminStatusCached, showAdminLoginModal, ADMIN_CONFIG, addReadPostAdminControls, getCurrentUser };

// Initialize admin-specific delegated action handlers. Call this once after admin init.
let _adminDelegationInitialized = false;
export function initializeAdminDelegation() {
  if (_adminDelegationInitialized) return;
  _adminDelegationInitialized = true;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (!action) return;
    // Admin-only actions
    if (action === 'show-admin-login') {
      e.preventDefault();
      if (typeof showAdminLoginModal === 'function') showAdminLoginModal();
      return;
    }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[action*="/blogpost/delete/"], form[action*="/cards/"][action$="/delete"]');
    if (!form) return;
    e.preventDefault();

    const confirmed = window.confirm(form.dataset.confirm || 'Post wirklich löschen?');
    if (!confirmed) return;

    const csrfInput = form.querySelector('input[name="_csrf"]');
    const body = new URLSearchParams();
    if (csrfInput) body.append('_csrf', csrfInput.value);

    fetch(form.action, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          showNotification('Post erfolgreich gelöscht', 'success');
          setTimeout(() => { window.location.href = data.returnTo || '/'; }, 1500);
        } else {
          showNotification(data.error || 'Fehler beim Löschen', 'error');
        }
      })
      .catch(() => {
        showNotification('Netzwerkfehler beim Löschen', 'error');
      });
  });
}

