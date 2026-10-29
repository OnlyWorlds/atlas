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

import { ELEMENT_ICONS } from '../../core/constants';
import { typeName } from '../../core/type-words';
import type { ElementType } from '../../core/types';
import { markEscapeOwned } from '../../core/escape-mark';

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
  /**
   * The lens chip (#841): shown in every world, so the first lens can be made.
   * With a lens chosen the type chips, the lock and the hop pill go: the
   * lens's own `types` and `depth` decide. Absent: no chip (Home's picture).
   */
  lens?: ToolbarLens;
  /** Only the lens chip: a route with no subject, where the Web draws a lens or nothing. */
  lensOnly?: boolean;
}

export interface ToolbarLens {
  chosen: { id: string; name: string } | null;
  choices: ReadonlyArray<{ id: string; name: string; template: boolean }>;
  /** Keep a lens on <name>, when offered; `busy` while its write runs. */
  keep: { name: string; busy: boolean } | null;
}

export interface ContextToolbarOpts {
  host: HTMLElement;
  initial: ContextToolbarState;
  onToggleType: (type: ElementType) => void;
  onSetHop: (hop: ToolbarHop) => void;
  onToggleLockLayout: () => void;
  onChooseLens?: (lensId: string | null) => void;
  onKeepLens?: () => void;
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

  const lensSlot = document.createElement('div');
  lensSlot.className = 'atlas-context-pane-toolbar-lens';
  rightCluster.appendChild(lensSlot);

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
      chip.setAttribute('aria-pressed', isHidden ? 'false' : 'true');
      chip.dataset.type = t;
      chip.title = isHidden
        ? `Show ${typeName(t, { many: true })}`
        : `Hide ${typeName(t, { many: true })}`;
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
    wrap.title = 'Graph reach: 1 shows direct links only, and each step up adds their links too.';
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
      ? 'Kept still: hiding a type leaves the other elements where they are. Click to let it move.'
      : 'Free to move: hiding a type rearranges the rest. Click to keep it still.';
    btn.innerHTML =
      `<span class="material-symbols-outlined">${current.lockLayout ? 'lock' : 'lock_open'}</span>`;
    btn.addEventListener('click', () => onToggleLockLayout());
    lockSlot.appendChild(btn);
  }

  // ---- the lens chip and its list ----------------------------------------
  let menu: HTMLElement | null = null;

  function closeMenu(): void {
    if (!menu) return;
    menu.remove();
    menu = null;
    document.removeEventListener('mousedown', onDocDown, true);
    window.removeEventListener('keydown', onMenuKey, true);
  }
  function onDocDown(e: MouseEvent): void {
    const t = e.target as Node;
    if (menu?.contains(t) || lensSlot.contains(t)) return;
    closeMenu();
  }
  function onMenuKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !menu) return;
    // Marked, never stopped: the drawer and the global Escape read the mark and step aside.
    markEscapeOwned(e);
    closeMenu();
    lensSlot.querySelector<HTMLButtonElement>('[data-role="lens-chip"]')?.focus();
  }

  function menuItem(label: string, attrs: Record<string, string>, onClick: () => void, opts: { checked?: boolean; disabled?: boolean } = {}): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'atlas-context-lens-menu-item';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', opts.checked ? 'true' : 'false');
    for (const [k, v] of Object.entries(attrs)) item.setAttribute(k, v);
    item.textContent = label;
    if (opts.disabled) item.disabled = true;
    item.addEventListener('click', () => { onClick(); closeMenu(); });
    return item;
  }

  function openMenu(): void {
    const lens = current.lens;
    if (!lens) return;
    closeMenu();
    const m = document.createElement('div');
    m.className = 'atlas-context-lens-menu';
    m.dataset.role = 'lens-menu';
    m.setAttribute('role', 'menu');
    m.appendChild(menuItem('None', { 'data-lens-id': '' }, () => opts.onChooseLens?.(null), { checked: !lens.chosen }));
    for (const c of lens.choices) {
      const label = c.template ? `${c.name} (template)` : c.name;
      m.appendChild(menuItem(label, { 'data-lens-id': c.id }, () => opts.onChooseLens?.(c.id), { checked: lens.chosen?.id === c.id }));
    }
    if (lens.keep) {
      const keep = menuItem(`Keep a lens on ${lens.keep.name}`, { 'data-role': 'keep-lens' }, () => opts.onKeepLens?.(), { disabled: lens.keep.busy });
      keep.setAttribute('role', 'menuitem');
      keep.removeAttribute('aria-checked');
      keep.classList.add('is-keep');
      m.appendChild(keep);
    }
    document.body.appendChild(m);
    menu = m;
    const chip = lensSlot.querySelector<HTMLElement>('[data-role="lens-chip"]');
    const r = chip?.getBoundingClientRect();
    if (r) {
      const w = m.getBoundingClientRect().width;
      m.style.top = `${Math.round(r.bottom + 4)}px`;
      m.style.left = `${Math.round(Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)))}px`;
    }
    queueMicrotask(() => {
      document.addEventListener('mousedown', onDocDown, true);
      window.addEventListener('keydown', onMenuKey, true);
    });
    m.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }

  function renderLens(): void {
    lensSlot.innerHTML = '';
    const lens = current.lens;
    if (!lens) { closeMenu(); return; }
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'atlas-context-pane-toolbar-lens-chip';
    if (lens.chosen) chip.classList.add('is-on');
    chip.dataset.role = 'lens-chip';
    chip.setAttribute('aria-haspopup', 'menu');
    chip.setAttribute('aria-expanded', menu ? 'true' : 'false');
    const name = lens.chosen ? lens.chosen.name : 'none';
    chip.title = lens.chosen
      ? `The Web reads through ${lens.chosen.name}. Choose another lens, or None.`
      : 'Read the Web through a lens: a saved reading of your world.';
    chip.innerHTML = `<span class="atlas-context-pane-toolbar-lens-word">Lens:</span> <span class="atlas-context-pane-toolbar-lens-name"></span>`;
    chip.querySelector('.atlas-context-pane-toolbar-lens-name')!.textContent = name;
    chip.addEventListener('click', () => { if (menu) closeMenu(); else openMenu(); chip.setAttribute('aria-expanded', menu ? 'true' : 'false'); });
    lensSlot.appendChild(chip);
    if (menu) openMenu();
  }

  function renderAll(): void {
    renderLens();
    const ringControls = !current.lensOnly && !current.lens?.chosen;
    if (ringControls) { renderChips(); renderLock(); renderHop(); }
    else { chipsRow.innerHTML = ''; lockSlot.innerHTML = ''; hopRow.innerHTML = ''; }
  }

  renderAll();

  return {
    update(next: ContextToolbarState): void {
      current = next;
      renderAll();
    },
    destroy(): void {
      closeMenu();
      host.classList.remove('atlas-context-pane-toolbar');
      host.innerHTML = '';
    },
  };
}
