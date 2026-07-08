/**
 * Context pane toolbar — sits above the graph. Two controls:
 *
 *   [type chips: characters · locations · …]    [1-hop | 2-hop]
 *
 *   - Type chips: one per element type present in the current graph
 *     (cast + adjacency, pre-filter). Click toggles hide/show. Chips persist
 *     even when their type is hidden so the user can re-enable.
 *
 *   - Hop pill: 1 = direct cast only; 2 = cast + adjacent. Default state
 *     reflects either the user's explicit choice OR the tier-derived default
 *     (which the orchestrator resolves before passing it in).
 *
 * All state lives in the orchestrator + registry. The toolbar is a pure
 * renderer that fires callbacks when chips are clicked.
 */

import { ELEMENT_ICONS, ELEMENT_LABELS } from '../../core/constants';
import type { ElementType } from '../../core/types';

export interface ContextToolbarHandle {
  /**
   * Re-render with the latest state. Called by orchestrator after graph
   * fires onRender (present types may have changed when center swapped) or
   * after user actions persist to registry.
   */
  update(state: ContextToolbarState): void;
  destroy(): void;
}

export type ToolbarHop = 1 | 2 | 3 | 4;

export interface ContextToolbarState {
  presentTypes: ReadonlySet<ElementType>;
  hiddenTypes: ReadonlySet<ElementType>;
  /**
   * Effective hop. Orchestrator resolves tier-default vs explicit user pref
   * before passing this in. Toolbar just renders + reports back the user's
   * choice on click.
   */
  effectiveHop: ToolbarHop;
  /**
   * Whether the lock-layout pref is on. When on, filter toggles preserve the
   * existing graph layout (no sim re-run).
   */
  lockLayout: boolean;
}

export interface ContextToolbarOpts {
  host: HTMLElement;
  initial: ContextToolbarState;
  onToggleType: (type: ElementType) => void;
  onSetHop: (hop: ToolbarHop) => void;
  onToggleLockLayout: () => void;
}

// Deterministic chip order so the toolbar doesn't jitter as the underlying
// set iteration order changes. Matches the high-level element groupings used
// in the elements sidebar filter strip.
const TYPE_ORDER: ElementType[] = [
  'character', 'location', 'event', 'narrative',
  'object', 'creature', 'species', 'family', 'collective', 'institution',
  'title', 'trait', 'ability', 'phenomenon', 'language', 'law', 'construct',
  'relation', 'map', 'pin', 'marker', 'zone',
];

export function mountContextToolbar(opts: ContextToolbarOpts): ContextToolbarHandle {
  const { host, onToggleType, onSetHop, onToggleLockLayout } = opts;
  host.innerHTML = '';
  host.classList.add('atlas-context-pane-toolbar');

  const chipsRow = document.createElement('div');
  chipsRow.className = 'atlas-context-pane-toolbar-chips';
  host.appendChild(chipsRow);

  const rightCluster = document.createElement('div');
  rightCluster.className = 'atlas-context-pane-toolbar-right';
  host.appendChild(rightCluster);

  const lockSlot = document.createElement('div');
  lockSlot.className = 'atlas-context-pane-toolbar-lock';
  rightCluster.appendChild(lockSlot);

  const hopRow = document.createElement('div');
  hopRow.className = 'atlas-context-pane-toolbar-hop';
  rightCluster.appendChild(hopRow);

  let current: ContextToolbarState = opts.initial;

  function renderChips(): void {
    chipsRow.innerHTML = '';
    const orderedPresent = TYPE_ORDER.filter(t => current.presentTypes.has(t));
    if (orderedPresent.length === 0) {
      // Suppress the row entirely when nothing is on the graph; keeps
      // the toolbar from feeling empty/broken.
      return;
    }
    for (const t of orderedPresent) {
      const isHidden = current.hiddenTypes.has(t);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'atlas-context-pane-toolbar-chip';
      if (isHidden) chip.classList.add('is-off');
      chip.dataset.type = t;
      chip.title = isHidden
        ? `Show ${ELEMENT_LABELS[t]?.plural ?? t}`
        : `Hide ${ELEMENT_LABELS[t]?.plural ?? t}`;
      chip.innerHTML =
        `<span class="material-symbols-outlined">${ELEMENT_ICONS[t] ?? 'category'}</span>`;
      chip.addEventListener('click', () => onToggleType(t));
      chipsRow.appendChild(chip);
    }
  }

  function renderHop(): void {
    hopRow.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'atlas-context-pane-toolbar-hop-pill';
    wrap.title = 'Graph reach. 1 = direct neighbours only · higher = also neighbours of neighbours, and so on.';
    for (const n of [1, 2, 3, 4] as const) {
      const seg = document.createElement('button');
      seg.type = 'button';
      seg.className = 'atlas-context-pane-toolbar-hop-seg';
      if (current.effectiveHop === n) seg.classList.add('is-active');
      seg.textContent = String(n);
      seg.title = `${n}-hop`;
      seg.addEventListener('click', () => {
        if (current.effectiveHop !== n) onSetHop(n);
      });
      wrap.appendChild(seg);
    }
    hopRow.appendChild(wrap);
  }

  function renderLock(): void {
    lockSlot.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-context-pane-toolbar-lock-btn';
    if (current.lockLayout) btn.classList.add('is-on');
    btn.dataset.locked = current.lockLayout ? 'true' : 'false';
    btn.title = current.lockLayout
      ? 'Layout locked: filter toggles hide nodes without re-arranging. Click to unlock.'
      : 'Layout free: filter toggles re-run the sim so surviving nodes redistribute. Click to lock.';
    btn.innerHTML =
      `<span class="material-symbols-outlined">${current.lockLayout ? 'lock' : 'lock_open'}</span>`;
    btn.addEventListener('click', () => onToggleLockLayout());
    lockSlot.appendChild(btn);
  }

  function renderAll(): void {
    renderChips();
    renderLock();
    renderHop();
  }

  renderAll();

  return {
    update(next: ContextToolbarState): void {
      current = next;
      renderAll();
    },
    destroy(): void {
      host.classList.remove('atlas-context-pane-toolbar');
      host.innerHTML = '';
    },
  };
}
