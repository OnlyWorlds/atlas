/**
 * Charts room — the interactive chart view (currently the temporal chart).
 *
 * Owns the BROAD-VIEW type filter (seeded once from the recipe engine) and feeds
 * the scoped node set to the dumb `timeline-view` renderer. FOCUS is NOT room
 * state — it lives in the URL (`/timeline/<id>`), derived each render, so the
 * browser Back button walks the focus chain and every click is a navigable step.
 * Effective scope = focus(URL id) → else the type filter → else all
 * (`scopeFromFocus`). Selecting a dot OR a card chip focuses that element
 * (unified select=focus, Captain-confirmed). See DESIGN_CHARTS.md.
 */

import { getState, subscribe } from '../core/state';
import { navigate, elementHash, timelineHash, parseHash, onHashChange, type Route } from '../core/router';
import { ToastManager } from '../ui/toast-manager';
import { ElementCreateModal } from '../ui/element-create-modal';
import { mountTimelineView, type TimelineViewHandle, type TimelineViewExtras } from '../visualization/timeline/timeline-view';
import { extractTemporalNodes } from '../visualization/timeline/data-normalizer';
import { pickDefaultChart, filterNodesByScope, scopeFromFocus, protagonistWindow } from '../visualization/timeline/chart-recipe';
import type { ChartConfig, ChartScope, TimelineNode } from '../visualization/timeline/types';
import { defaultChartName, upsertChart, removeChart, renameChart, sameScope } from '../visualization/timeline/charts-store';
import { getActiveStore } from '../core/active-store';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import type { Element, ElementType } from '../core/types';
import { escapeText } from '../core/dom-utils';

export function mountTimeline(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'atlas-timeline-room';
  target.appendChild(wrap);

  const header = document.createElement('header');
  header.className = 'atlas-room-header';
  header.innerHTML = `
    <h1>Charts</h1>
    <p class="atlas-room-subtitle">See your world's events on a timeline and click any element to explore its connections.</p>
  `;
  wrap.appendChild(header);

  const actions = document.createElement('div');
  actions.className = 'atlas-room-actions';
  const newEventBtn = document.createElement('button');
  newEventBtn.type = 'button';
  newEventBtn.className = 'atlas-btn-ghost';
  newEventBtn.dataset.action = 'new-event';
  newEventBtn.title = 'Create a new event';
  newEventBtn.textContent = '+ Event';
  newEventBtn.addEventListener('click', () => new ElementCreateModal(toasts, { initialType: 'event' }).open());
  actions.appendChild(newEventBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'atlas-btn-ghost';
  saveBtn.dataset.action = 'save-chart';
  saveBtn.title = 'Save the current view as a chart you can reopen or share';
  saveBtn.innerHTML = `<span class="material-symbols-outlined">bookmark_add</span> Save chart`;
  saveBtn.addEventListener('click', () => void saveCurrentChart());
  actions.appendChild(saveBtn);
  wrap.appendChild(actions);

  // Saved-chart gallery — hidden until at least one chart is saved.
  const gallery = document.createElement('div');
  gallery.className = 'atlas-chart-gallery';
  wrap.appendChild(gallery);

  const controlBar = document.createElement('div');
  controlBar.className = 'atlas-chart-controls';
  wrap.appendChild(controlBar);

  const viewMount = document.createElement('div');
  viewMount.className = 'atlas-timeline-view-mount';
  wrap.appendChild(viewMount);

  let handle: TimelineViewHandle | null = null;
  let config: ChartConfig | null = null;        // seeded once; the save/share contract
  let typeFilter: Set<ElementType> | null = null; // broad-view filter (null = all); focus is URL-driven
  let seeded = false;
  let savedCharts: ChartConfig[] = [];          // from .atlas/charts.json
  let suppressGallery = false;                  // true while an inline rename input is open

  const worldId = (): string | null => getState().active?.worldId ?? null;
  const elementById = (id: string): Element | undefined =>
    getState().data.elements.find(e => e.id === id);

  /** Temporal types actually present, first-seen order (stable enough). */
  function presentTypes(nodes: TimelineNode[]): ElementType[] {
    const seen = new Set<string>();
    const out: ElementType[] = [];
    for (const n of nodes) {
      if (!seen.has(n.elementType)) { seen.add(n.elementType); out.push(n.elementType as ElementType); }
    }
    return out;
  }

  function renderControlBar(allNodes: TimelineNode[], route: Route): void {
    controlBar.innerHTML = '';
    if (allNodes.length === 0) return;
    const present = presentTypes(allNodes);
    const focused = !!route.elementId;

    // Focus pill — shown when the URL scopes the chart to one element's
    // neighbourhood. Clearing navigates back to the broad view (no id).
    if (focused) {
      const target = elementById(route.elementId!);
      const pill = document.createElement('div');
      pill.className = 'atlas-chart-focus-pill';
      pill.innerHTML =
        `<span class="material-symbols-outlined">filter_center_focus</span>` +
        `<span>${escapeText(target?.name || 'focused')}</span>` +
        `<button type="button" class="atlas-chart-focus-clear" title="Clear focus (show all)">×</button>`;
      pill.querySelector('.atlas-chart-focus-clear')!
        .addEventListener('click', () => { const w = worldId(); if (w) navigate(timelineHash(w)); });
      controlBar.appendChild(pill);
    }

    // Type toggle chips — the broad-view filter (null = all). While focused they
    // read inactive (focus is the lens); clicking one drops focus and applies it.
    for (const t of present) {
      const on = !focused && (typeFilter === null || typeFilter.has(t));
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'atlas-chart-type-chip' + (on ? ' active' : '');
      const label = ELEMENT_LABELS[t]?.plural ?? t;
      chip.innerHTML =
        `<span class="material-symbols-outlined">${escapeText(ELEMENT_ICONS[t] ?? 'category')}</span>` +
        `<span>${escapeText(label)}</span>`;
      chip.addEventListener('click', () => {
        const base = new Set<ElementType>(typeFilter ?? present);
        if (base.has(t)) base.delete(t); else base.add(t);
        typeFilter = base.size >= present.length ? null : base;
        const w = worldId();
        if (route.elementId && w) navigate(timelineHash(w)); // exit focus → hashchange re-renders
        else render();
      });
      controlBar.appendChild(chip);
    }
  }

  /** The scope the live view is currently showing (focus URL + type filter). */
  function currentScope(): ChartScope {
    const route = parseHash(window.location.hash);
    return scopeFromFocus(route.elementId ?? null, typeFilter);
  }

  /** Save the current view as a named chart in `.atlas/charts.json`. */
  async function saveCurrentChart(): Promise<void> {
    const store = getActiveStore();
    if (!store) { toasts.error('no active world to save into'); return; }
    const all = getState().data.elements;
    const scope = currentScope();
    const axis = config?.axis ?? { kind: 'time' as const, direction: 'both' as const };
    const chart: ChartConfig = {
      schema_version: 1,
      id: crypto.randomUUID(),
      name: defaultChartName(scope, all),
      axis,
      scope,
      render: '2d',
    };
    savedCharts = upsertChart(savedCharts, chart);
    await store.writeCharts(savedCharts);
    renderGallery();
    toasts.success(`saved "${chart.name}"`);
  }

  /** Load a saved chart into the live view (restores its scope). */
  function applyChart(chart: ChartConfig): void {
    const w = worldId();
    if (!w) return;
    config = chart;
    const route = parseHash(window.location.hash);
    const scope = chart.scope;
    if (scope.kind === 'focus') {
      typeFilter = null;
      navigate(timelineHash(w, scope.elementId));
    } else if (scope.kind === 'types') {
      typeFilter = new Set(scope.types);
      if (route.elementId) navigate(timelineHash(w)); else render();
    } else if (scope.kind === 'all') {
      typeFilter = null;
      if (route.elementId) navigate(timelineHash(w)); else render();
    } else {
      // selection / unknown — not creatable in this editor yet; lands in share.
      toasts.show('this chart opens in the share view', 'info');
    }
  }

  async function deleteChart(chart: ChartConfig): Promise<void> {
    savedCharts = removeChart(savedCharts, chart.id);
    const store = getActiveStore();
    if (store) await store.writeCharts(savedCharts);
    renderGallery();
    toasts.show(`removed "${chart.name}"`, 'info');
  }

  /** Swap a saved-chart card's name for an inline rename input. */
  function startRename(card: HTMLElement, chart: ChartConfig): void {
    const nameEl = card.querySelector('.atlas-saved-chart-name');
    if (!nameEl) return;
    suppressGallery = true; // keep background re-renders from destroying the input
    card.classList.add('renaming');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'atlas-saved-chart-rename';
    input.value = chart.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = async (save: boolean): Promise<void> => {
      if (done) return;
      done = true;
      suppressGallery = false;
      if (save) {
        const next = renameChart(savedCharts, chart.id, input.value);
        if (next !== savedCharts) {
          savedCharts = next;
          const store = getActiveStore();
          if (store) await store.writeCharts(savedCharts);
        }
      }
      renderGallery();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); void commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); void commit(false); }
    });
    input.addEventListener('blur', () => void commit(true));
  }

  function galleryActionBtn(icon: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-saved-chart-action';
    b.title = title;
    b.innerHTML = `<span class="material-symbols-outlined">${escapeText(icon)}</span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  function renderGallery(): void {
    gallery.innerHTML = '';
    if (savedCharts.length === 0) return;
    const label = document.createElement('span');
    label.className = 'atlas-chart-gallery-label';
    label.textContent = 'Saved charts';
    gallery.appendChild(label);

    const curScope = currentScope();
    for (const chart of savedCharts) {
      const card = document.createElement('div');
      card.className = 'atlas-saved-chart' + (sameScope(chart.scope, curScope) ? ' active' : '');

      const nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.className = 'atlas-saved-chart-name';
      nameBtn.title = 'Open this chart';
      nameBtn.textContent = chart.name;
      nameBtn.addEventListener('click', () => applyChart(chart));
      card.appendChild(nameBtn);

      const acts = document.createElement('div');
      acts.className = 'atlas-saved-chart-actions';
      acts.appendChild(galleryActionBtn('edit', 'Rename chart', () => startRename(card, chart)));
      acts.appendChild(galleryActionBtn('close', 'Delete chart', () => void deleteChart(chart)));
      card.appendChild(acts);

      gallery.appendChild(card);
    }
  }

  async function refreshGallery(): Promise<void> {
    const store = getActiveStore();
    savedCharts = store ? await store.readCharts() : [];
    renderGallery();
  }

  function render(): void {
    const wid = worldId();
    if (!wid) return;
    const all = getState().data.elements;
    const allNodes = extractTemporalNodes(all);
    // Seed the broad-view type filter from the recipe ONCE, so the opening view
    // is the focused recipe (Story / Events / Foundings), not the full wall. A
    // 'focus' recipe leaves the broad view = all (the user clicks to focus).
    let justSeeded = false;
    if (!seeded && allNodes.length > 0) {
      seeded = true;
      justSeeded = true;
      if (!config) config = pickDefaultChart(all);
      if (config.scope.kind === 'types') typeFilter = new Set(config.scope.types);
    }

    const route = parseHash(window.location.hash);
    renderControlBar(allNodes, route);

    if (!handle) {
      handle = mountTimelineView(viewMount, {
        // Unified select=focus: a dot OR a card chip focuses that element via the
        // URL (Back walks the chain). Empty id clears focus.
        onSelect: (id) => { const w = worldId(); if (w) navigate(id ? timelineHash(w, id) : timelineHash(w)); },
        onOpenElement: (id) => { const w = worldId(); if (w) navigate(elementHash(w, id)); },
      });
    }

    const scoped = filterNodesByScope(allNodes, scopeFromFocus(route.elementId ?? null, typeFilter));
    // Cast favorites (S4): their labels always win the budget. Re-read each
    // render so a toggle on the element header reflects immediately.
    const favorites = getState().registry.worlds.find(w => w.id === wid)?.favorites;
    const extras: TimelineViewExtras = {
      favoriteIds: [favorites?.protagonist_id, favorites?.nexus_id]
        .filter((x): x is string => typeof x === 'string' && x.length > 0),
    };
    // S5 protagonist-first: on the seed render (broad landing only — a focus
    // URL owns its own fit), open the window on the protagonist's era. One-shot
    // by construction: only the seed render passes it, and the view ignores it
    // once the user has a window of their own.
    if (justSeeded && !route.elementId) {
      const win = protagonistWindow(allNodes, favorites?.protagonist_id ?? null);
      if (win) extras.defaultWindow = win;
    }
    // allNodes rides along as the overview strip's constant reference frame
    // (the full world's history stays visible however narrow the scope, S2).
    handle.setNodes(scoped, allNodes, extras);
    handle.setSelection(route.mode === 'timeline' ? (route.elementId ?? null) : null);

    if (!suppressGallery) renderGallery(); // keep the active-chart highlight in sync
  }

  if (getState().active) render();
  void refreshGallery();
  // charts.json can change out-of-band (id-swap migration on make-online) —
  // re-read so the gallery never shows a stale saved scope.
  const onChartsChanged = () => { void refreshGallery(); };
  window.addEventListener('atlas:charts-changed', onChartsChanged);
  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);

  return () => {
    window.removeEventListener('atlas:charts-changed', onChartsChanged);
    unsubState();
    unsubHash();
    handle?.destroy();
    handle = null;
  };
}
