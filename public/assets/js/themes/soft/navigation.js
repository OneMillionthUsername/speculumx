// Navigation of the "soft" theme: mobile menu and live search suggestions.
// Loaded as an external module (CSP: no inline handlers). Without JS the menu is always visible
// (see soft.css, rules are scoped to html.js) and the search is a plain GET form to /search.

import { getSearchTerms, splitHighlight } from '../../shared/search.js';

const MOBILE_QUERY = '(max-width: 860px)';
const SUGGEST_DELAY_MS = 180;

function initMenu() {
  const toggle = document.getElementById('nav-toggle');
  const panel = document.getElementById('navbar-panel');
  if (!toggle || !panel) return;

  const mobile = window.matchMedia(MOBILE_QUERY);

  const setOpen = (open, { restoreFocus = false } = {}) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
    panel.classList.toggle('is-open', open);
    document.documentElement.classList.toggle('nav-open', open);
    if (!open && restoreFocus) toggle.focus();
  };

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false, { restoreFocus: true });
    }
  });

  document.addEventListener('click', (event) => {
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    if (event.target instanceof Node && !event.target.closest('.navbar')) setOpen(false);
  });

  // Following a link in the sheet closes it (relevant for in-page navigation and bfcache)
  panel.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('.menu-items a')) setOpen(false);
  });

  // Leaving the mobile layout must not leave the sheet "open" in the DOM
  mobile.addEventListener('change', (event) => {
    if (!event.matches) setOpen(false);
  });
  window.addEventListener('pageshow', () => setOpen(false));
}

function initSearch() {
  const form = document.getElementById('nav-search-form');
  const input = document.getElementById('nav-search-input');
  const list = document.getElementById('nav-search-results');
  const status = document.getElementById('nav-search-status');
  if (!form || !input || !list) return;

  let items = []; // { url, el }
  let active = -1;
  let timer = null;
  let controller = null;

  const setExpanded = (open) => {
    input.setAttribute('aria-expanded', String(open));
    list.hidden = !open;
    if (!open) {
      active = -1;
      input.removeAttribute('aria-activedescendant');
    }
  };

  const setActive = (index) => {
    items.forEach((item, i) => {
      const selected = i === index;
      item.el.classList.toggle('is-active', selected);
      item.el.setAttribute('aria-selected', String(selected));
    });
    active = index;
    if (index >= 0) {
      input.setAttribute('aria-activedescendant', items[index].el.id);
      items[index].el.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const appendHighlighted = (parent, text, terms) => {
    for (const part of splitHighlight(text, terms)) {
      if (part.match) {
        const mark = document.createElement('mark');
        mark.textContent = part.text;
        parent.appendChild(mark);
      } else {
        parent.appendChild(document.createTextNode(part.text));
      }
    }
  };

  const addItem = (url, build) => {
    const li = document.createElement('li');
    li.id = `nav-search-option-${items.length}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    const a = document.createElement('a');
    a.href = url;
    a.tabIndex = -1;
    build(a);
    li.appendChild(a);
    list.appendChild(li);
    items.push({ url, el: li });
  };

  const render = (query, results) => {
    list.textContent = '';
    items = [];
    const terms = getSearchTerms(query);
    for (const result of results) {
      addItem(result.url, (a) => appendHighlighted(a, result.title, terms));
    }
    addItem(`/search?q=${encodeURIComponent(query)}`, (a) => {
      a.classList.add('is-all');
      a.textContent = results.length > 0 ? `Alle Ergebnisse für „${query}“ anzeigen` : `Keine Vorschläge – im ganzen Blog suchen nach „${query}“`;
    });
    setExpanded(true);
    setActive(-1);
    if (status) {
      status.textContent = results.length > 0 ? `${results.length} Vorschläge` : 'Keine Vorschläge';
    }
  };

  const fetchSuggestions = async (query) => {
    if (controller) controller.abort();
    controller = new AbortController();
    try {
      const response = await fetch(`/api/blogpost/search?q=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      // Ignore answers to a query the user has already changed
      if (input.value.trim() !== query) return;
      render(query, Array.isArray(data.results) ? data.results : []);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      setExpanded(false); // the form still works as a plain search
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (getSearchTerms(query).length === 0) {
      if (controller) controller.abort();
      setExpanded(false);
      return;
    }
    timer = setTimeout(() => fetchSuggestions(query), SUGGEST_DELAY_MS);
  });

  input.addEventListener('keydown', (event) => {
    const open = !list.hidden && items.length > 0;
    if (event.key === 'ArrowDown' && open) {
      event.preventDefault();
      setActive(active + 1 >= items.length ? 0 : active + 1);
    } else if (event.key === 'ArrowUp' && open) {
      event.preventDefault();
      setActive(active <= 0 ? items.length - 1 : active - 1);
    } else if (event.key === 'Enter' && open && active >= 0) {
      event.preventDefault();
      window.location.assign(items[active].url);
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
    }
  });

  input.addEventListener('focus', () => {
    if (items.length > 0 && input.value.trim()) setExpanded(true);
  });

  document.addEventListener('click', (event) => {
    if (event.target instanceof Node && !form.contains(event.target)) setExpanded(false);
  });

  // "/" focuses the search unless the user is typing somewhere
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const el = document.activeElement;
    const typing = el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    if (typing) return;
    event.preventDefault();
    // On mobile the field lives in the sheet, so open it first
    const toggle = document.getElementById('nav-toggle');
    if (toggle && toggle.getAttribute('aria-expanded') !== 'true' && window.matchMedia(MOBILE_QUERY).matches) toggle.click();
    input.focus();
    input.select();
  });
}

function init() {
  initMenu();
  initSearch();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
