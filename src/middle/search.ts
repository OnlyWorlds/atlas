/**
 * Search room — cross-world search across name + description + supertype +
 * subtype on all elements in the active world.
 *
 * See DESIGN.md Rooms (#/w/<id>/search?q=<query>). v1 is a simple substring
 * search; future versions could add fuzzy match, filters per type, regex,
 * search-in-prose for narrative bodies, etc.
 */

import { getState, subscribe } from '../core/state';
import { onHashChange, parseHash, navigate, searchHash, elementHash } from '../core/router';
import { ELEMENT_ICONS } from '../core/constants';
import type { Element } from '../core/types';
import { escapeText } from '../core/dom-utils';

const SEARCH_FIELDS = ['name', 'description', 'supertype', 'subtype'];

interface Hit {
  el: Element;
  matchedField: string;
  excerpt: string;
}

function runSearch(elements: Element[], query: string): Hit[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const hits: Hit[] = [];
  for (const el of elements) {
    if (el.type === 'pin' || el.type === 'marker' || el.type === 'zone') continue;
    for (const field of SEARCH_FIELDS) {
      const val = (el as Element & Record<string, unknown>)[field];
      if (typeof val !== 'string') continue;
      const lower = val.toLowerCase();
      const idx = lower.indexOf(q);
      if (idx >= 0) {
        const start = Math.max(0, idx - 30);
        const end = Math.min(val.length, idx + q.length + 30);
        const excerpt = (start > 0 ? '…' : '') + val.slice(start, end) + (end < val.length ? '…' : '');
        hits.push({ el, matchedField: field, excerpt });
        break; // First match per element
      }
    }
  }
  return hits;
}

export function mountSearch(target: HTMLElement): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-search-room';
  target.appendChild(root);

  const header = document.createElement('div');
  header.className = 'atlas-search-header';
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'atlas-input atlas-search-input';
  input.placeholder = 'search this world…';
  input.setAttribute('data-role', 'global-search');
  header.appendChild(input);
  root.appendChild(header);

  const status = document.createElement('div');
  status.className = 'atlas-search-status';
  root.appendChild(status);

  const list = document.createElement('div');
  list.className = 'atlas-search-results';
  root.appendChild(list);

  // Memo: skip the full scan when neither the query nor the elements array
  // reference has changed since the last render. `subscribe(render)` fires on
  // every state tick (e.g. sync engine state changes) — most don't touch the
  // elements set, so this avoids the O(elements × fields) scan for them.
  let lastQuery: string | null = null;
  let lastElements: Element[] | null = null;
  let lastHits: Hit[] = [];

  function render(): void {
    const active = getState().active;
    if (!active) {
      status.textContent = 'No active world.';
      list.innerHTML = '';
      return;
    }
    const route = parseHash(window.location.hash);
    const query = (route.searchQuery ?? '').trim();
    if (input.value !== query) input.value = query;

    const elements = getState().data.elements;
    if (!query) {
      status.textContent = `Search across ${elements.length} elements (name, description, supertype, subtype).`;
      list.innerHTML = '';
      lastQuery = null;
      lastElements = null;
      lastHits = [];
      return;
    }

    // Reuse the previous scan if both inputs match by reference / value.
    let hits: Hit[];
    if (query === lastQuery && elements === lastElements) {
      hits = lastHits;
    } else {
      hits = runSearch(elements, query);
      lastQuery = query;
      lastElements = elements;
      lastHits = hits;
    }

    status.textContent = hits.length === 0
      ? `No results for "${query}".`
      : `${hits.length} result${hits.length === 1 ? '' : 's'} for "${query}".`;

    list.innerHTML = '';
    for (const hit of hits) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'atlas-search-result-row';
      const matchedExcerpt = highlightMatch(hit.excerpt, query);
      row.innerHTML = `
        <span class="material-symbols-outlined atlas-search-icon">${ELEMENT_ICONS[hit.el.type] ?? 'category'}</span>
        <span class="atlas-search-name">${escapeText(hit.el.name || '(unnamed)')}</span>
        <span class="atlas-search-type">${hit.el.type}</span>
        <span class="atlas-search-excerpt">[${hit.matchedField}] ${matchedExcerpt}</span>
      `;
      row.addEventListener('click', () => {
        navigate(elementHash(active.worldId, hit.el.id));
      });
      list.appendChild(row);
    }
  }

  // Debounced input → updates URL ?q= which triggers re-render
  let debounceTimer: number | null = null;
  input.addEventListener('input', () => {
    if (debounceTimer != null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      const active = getState().active;
      if (!active) return;
      navigate(searchHash(active.worldId, input.value));
    }, 200);
  });

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();

  // Auto-focus on mount
  queueMicrotask(() => input.focus());

  return () => {
    unsubState();
    unsubHash();
    if (debounceTimer != null) window.clearTimeout(debounceTimer);
  };
}


function highlightMatch(excerpt: string, query: string): string {
  const escaped = escapeText(excerpt);
  const qEsc = escapeText(query);
  const re = new RegExp(qEsc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return escaped.replace(re, (m) => `<mark>${m}</mark>`);
}
