/**
 * Sticky bar for the writing workspace — the row that pins below the 36px
 * element header:
 *
 *   [crumb › crumb › current  📅 dates]        [view-mode][focus][read][open]
 *
 * Breadcrumb (ancestor chain) + optional date pill on the left; view-mode
 * toggle (when the narrative has children) + focus / reading / open-as-element
 * actions on the right. Extracted from writing-workspace.ts (session 232) as a
 * factory closing over the workspace root + view-mode accessors — the focus /
 * reading toggles only touch `root` and dispatch document events, so they live
 * here entirely; view-mode switching defers to the main file via callback
 * because it owns the editor remount.
 */

import { getState } from '../core/state';
import { navigate, writingHash, elementHash } from '../core/router';
import type { Element } from '../core/types';
import { buildNarrativeIndex, ancestorIds } from './writing-helpers';
import { narrativeHasChildren } from './writing-compiled';
import { WRITING_FOCUS_TOGGLE_EVENT } from '../core/hotkeys';
import type { WritingViewMode } from './writing-workspace';

export interface StickyBarController {
  /** Build the sticky bar for `el`. */
  render(el: Element): HTMLElement;
}

export function createStickyBar(deps: {
  root: HTMLElement;
  getViewMode: (el: Element) => WritingViewMode;
  onSwitchViewMode: (el: Element, mode: WritingViewMode) => void;
}): StickyBarController {
  const { root, getViewMode, onSwitchViewMode } = deps;

  function render(el: Element): HTMLElement {
    // Sticky bar below the 36px element header. Single horizontal row:
    //   [crumb › crumb › current  📅 dates]              [focus][read][open]
    // Crumbs + date on the left (ellipsize as needed), action icons on right.
    // position: sticky in CSS so it pins to the top of the scrollable body.
    const wrap = document.createElement('div');
    wrap.className = 'atlas-writing-workspace-crumb';

    const state = getState();
    const worldId = state.active!.worldId;
    const idx = buildNarrativeIndex(state.data.elements, worldId);
    // ancestorIds walks child->root (nearest first); a breadcrumb reads
    // root->current, so reverse (S265 -- the crumb showed "chapter > book").
    const chain = [...ancestorIds(idx, el.id)].reverse();

    const left = document.createElement('div');
    left.className = 'atlas-writing-workspace-crumb-left';
    wrap.appendChild(left);

    const crumbs: Array<{ id: string; name: string }> = [];
    for (const ancestorId of chain) {
      const node = idx.byId.get(ancestorId);
      if (node) crumbs.push({ id: ancestorId, name: node.el.name || '(unnamed)' });
    }
    crumbs.push({ id: el.id, name: el.name || '(unnamed)' });

    const crumbsRow = document.createElement('div');
    crumbsRow.className = 'atlas-writing-workspace-crumbs';
    crumbs.forEach((c, i) => {
      const isLast = i === crumbs.length - 1;
      const seg = document.createElement(isLast ? 'span' : 'a');
      seg.className = 'atlas-writing-workspace-crumb-seg' + (isLast ? ' is-current' : '');
      seg.textContent = c.name;
      if (!isLast) {
        (seg as HTMLAnchorElement).href = '#' + buildCrumbHash(worldId, c.id);
        seg.addEventListener('click', (e) => {
          e.preventDefault();
          navigate(buildCrumbHash(worldId, c.id));
        });
      }
      crumbsRow.appendChild(seg);
      if (!isLast) {
        const sep = document.createElement('span');
        sep.className = 'atlas-writing-workspace-crumb-sep';
        sep.textContent = '›';
        crumbsRow.appendChild(sep);
      }
    });
    left.appendChild(crumbsRow);

    // Date pill — inline next to the breadcrumb. Only renders when at least
    // one bound is set. Small event icon + range/single-value text.
    const start = el.start_date;
    const end = el.end_date;
    if (start != null || end != null) {
      const dateBadge = document.createElement('span');
      dateBadge.className = 'atlas-writing-workspace-date';
      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined';
      icon.textContent = 'event';
      dateBadge.appendChild(icon);
      const dateText = document.createElement('span');
      if (start != null && end != null) {
        dateText.textContent = `${start} → ${end}`;
      } else if (start != null) {
        dateText.textContent = String(start);
      } else {
        dateText.textContent = `→ ${end}`;
      }
      dateBadge.appendChild(dateText);
      left.appendChild(dateBadge);
    }

    // Right cluster — view-mode toggle (when narrative has children) + action
    // icons. Save state already lives in the element header's sync dot.
    const right = document.createElement('div');
    right.className = 'atlas-writing-workspace-crumb-actions';

    // View-mode toggle — only when this narrative has descendants. Lets the
    // user switch between editing THIS narrative's prose and a read-only
    // compiled view of self + descendants.
    if (narrativeHasChildren(el, state.data.elements)) {
      const mode = getViewMode(el);
      const toggle = document.createElement('div');
      toggle.className = 'atlas-writing-workspace-viewmode';
      toggle.setAttribute('role', 'tablist');

      const thisBtn = document.createElement('button');
      thisBtn.type = 'button';
      thisBtn.className = 'atlas-writing-workspace-viewmode-btn';
      thisBtn.setAttribute('role', 'tab');
      thisBtn.dataset.mode = 'this-level';
      thisBtn.textContent = 'This level';
      thisBtn.setAttribute('aria-selected', mode === 'this-level' ? 'true' : 'false');
      thisBtn.addEventListener('click', () => {
        if (getViewMode(el) === 'this-level') return;
        onSwitchViewMode(el, 'this-level');
      });
      toggle.appendChild(thisBtn);

      const compiledBtn = document.createElement('button');
      compiledBtn.type = 'button';
      compiledBtn.className = 'atlas-writing-workspace-viewmode-btn';
      compiledBtn.setAttribute('role', 'tab');
      compiledBtn.dataset.mode = 'compiled';
      compiledBtn.textContent = 'Compiled';
      compiledBtn.setAttribute('aria-selected', mode === 'compiled' ? 'true' : 'false');
      compiledBtn.addEventListener('click', () => {
        if (getViewMode(el) === 'compiled') return;
        onSwitchViewMode(el, 'compiled');
      });
      toggle.appendChild(compiledBtn);

      right.appendChild(toggle);
    }

    const focusBtn = document.createElement('button');
    focusBtn.type = 'button';
    focusBtn.className = 'atlas-icon-btn-sm atlas-writing-workspace-action';
    focusBtn.dataset.action = 'focus';
    focusBtn.title = 'Focus mode (Ctrl+Shift+F)';
    focusBtn.setAttribute('aria-pressed', root.classList.contains('is-focus-mode') ? 'true' : 'false');
    focusBtn.innerHTML = '<span class="material-symbols-outlined">center_focus_strong</span>';
    focusBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent(WRITING_FOCUS_TOGGLE_EVENT));
      focusBtn.setAttribute('aria-pressed', root.classList.contains('is-focus-mode') ? 'true' : 'false');
    });
    right.appendChild(focusBtn);

    const readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.className = 'atlas-icon-btn-sm atlas-writing-workspace-action';
    readBtn.dataset.action = 'reading';
    readBtn.title = 'Reading mode';
    readBtn.setAttribute('aria-pressed', root.classList.contains('is-reading-mode') ? 'true' : 'false');
    readBtn.innerHTML = '<span class="material-symbols-outlined">menu_book</span>';
    readBtn.addEventListener('click', () => {
      const isOn = root.classList.toggle('is-reading-mode');
      readBtn.setAttribute('aria-pressed', String(isOn));
    });
    right.appendChild(readBtn);

    const openBtn = document.createElement('a');
    openBtn.className = 'atlas-icon-btn-sm atlas-writing-workspace-action';
    openBtn.dataset.action = 'open-as-element';
    openBtn.title = 'Open as element';
    openBtn.href = '#' + elementHash(worldId, el.id);
    openBtn.innerHTML = '<span class="material-symbols-outlined">open_in_new</span>';
    openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(elementHash(worldId, el.id));
    });
    right.appendChild(openBtn);

    wrap.appendChild(right);

    return wrap;
  }

  function buildCrumbHash(worldId: string, narrativeId: string): string {
    // After URL-scheme shortening (session 227), each crumb segment is just a
    // direct writing-room URL for that narrative. Ancestry is derived from
    // parent_narrative at render time.
    return writingHash(worldId, narrativeId);
  }

  return { render };
}
