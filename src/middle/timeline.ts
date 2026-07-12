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

import { getState, subscribe, patchSlice } from '../core/state';
import { navigate, elementHash, timelineHash, parseHash, onHashChange, type Route } from '../core/router';
import { ToastManager } from '../ui/toast-manager';
import { ElementCreateModal } from '../ui/element-create-modal';
import { mountTimelineView, type TimelineViewHandle, type TimelineViewExtras } from '../visualization/timeline/timeline-view';
import { extractTemporalNodes } from '../visualization/timeline/data-normalizer';
import { TEMPORAL_TYPE_FIELDS, parseTemporalValue } from '../visualization/timeline/temporal-fields';
import { filterNodesByScope, scopeFromFocus, tableauScope } from '../visualization/timeline/chart-recipe';
import type { ChartConfig, ChartScope, TimelineNode } from '../visualization/timeline/types';
import { defaultChartName, upsertChart, removeChart, renameChart, sameScope } from '../visualization/timeline/charts-store';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite } from '../sync/sync-attach';
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
    <p class="atlas-room-subtitle">See your world arranged in time. Click any element to explore its connections.</p>
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
  newEventBtn.addEventListener('click', () => new ElementCreateModal(toasts, {
    initialType: 'event',
    // Stay in the room (Captain, 2026-07-10): the chart is the workspace here.
    // A fresh event is undated, so it can't appear on the axis yet — say so
    // instead of letting it silently not-show. (Act 1's undated rail is the
    // real home for this.)
    suppressNavigate: true,
    onCreated: () => toasts.info('Event created · give it a date to place it on the chart'),
  }).open());
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
  let config: ChartConfig | null = null;        // set when a saved chart loads; the save/share contract
  // The LANDING is the TABLEAU (Captain, 2026-07-10: "no highlights, neutral
  // state") — an EMPTY type filter, no chips lit. Ticking a chip narrows to
  // that type; null = every type (all chips on).
  let typeFilter: Set<ElementType> | null = new Set();
  // PEEK state (the 2026-07-10 split): reading an element's card is room-local
  // and free; FOCUS is the URL. A focus navigation auto-peeks its element.
  let peekId: string | null = null;
  let lastFocusId: string | null | undefined = undefined; // undefined = never seen
  let lastScoped: TimelineNode[] = [];
  let savedCharts: ChartConfig[] = [];          // from .atlas/charts.json
  let suppressGallery = false;                  // true while an inline rename input is open

  const worldId = (): string | null => getState().active?.worldId ?? null;
  const elementById = (id: string): Element | undefined =>
    getState().data.elements.find(e => e.id === id);

  // The world's "now" (Act 1) — `World.time_current`, drawn as the now-line and
  // the forward-half seam. Local-only (World-meta doesn't sync today).
  const nowValue = (): number | null => getState().active?.meta?.time_current ?? null;

  /** Persist the now to world.json + mirror into state so the room re-renders. */
  async function setNow(value: number | null): Promise<void> {
    const store = getActiveStore();
    const active = getState().active;
    if (!store || !active) return;
    await store.writeWorldMeta({ time_current: value ?? undefined });
    patchSlice('active', {
      ...active,
      meta: { ...active.meta, time_current: value ?? undefined },
    });
  }

  /** A sensible first "now": the MEDIAN dated point, so roughly half the world
   *  sits on each side (a mid-range average gets skewed early by one ancient
   *  outlier). The user drags it from there. */
  function suggestNow(nodes: TimelineNode[]): number {
    const dates = nodes.map(n => n.startDate).sort((a, b) => a - b);
    if (dates.length === 0) return 0;
    const mid = Math.floor(dates.length / 2);
    const median = dates.length % 2 === 0 ? (dates[mid - 1] + dates[mid]) / 2 : dates[mid];
    return Math.round(median);
  }

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

    // Tableau state (all chips off): say what's showing instead of leaving an
    // unlabeled curated view (it isn't "nothing selected", it's the default
    // world view — cast + essentials).
    if (!focused && typeFilter && typeFilter.size === 0) {
      const hint = document.createElement('span');
      hint.className = 'atlas-chart-tableau-hint';
      hint.textContent = 'Tableau: the cast and essentials';
      hint.title = 'With no types picked, the chart shows the world at a glance. Pick types above for the full sets.';
      controlBar.appendChild(hint);
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

    // The now control (Act 1): establish the world's now, or show + clear it.
    // Once set, the now-line is draggable directly on the canvas.
    const now = nowValue();
    const nowWrap = document.createElement('div');
    nowWrap.className = 'atlas-chart-now';
    if (now == null) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'atlas-chart-now-set';
      btn.title = "Set the world's current point in time. Everything after it becomes the forward half (drag the line to move it).";
      btn.innerHTML = `<span class="material-symbols-outlined">flag</span><span>Set current</span>`;
      btn.addEventListener('click', () => void setNow(suggestNow(allNodes)));
      nowWrap.appendChild(btn);
    } else {
      const chip = document.createElement('span');
      chip.className = 'atlas-chart-now-chip';
      chip.title = 'Drag the now-line on the chart to move it';
      chip.innerHTML =
        `<span class="material-symbols-outlined">schedule</span>` +
        `<span>now · ${escapeText(String(now))}</span>` +
        `<button type="button" class="atlas-chart-now-clear" title="Clear now (remove the seam)">×</button>`;
      chip.querySelector('.atlas-chart-now-clear')!
        .addEventListener('click', () => void setNow(null));
      nowWrap.appendChild(chip);
    }
    controlBar.appendChild(nowWrap);
  }

  /**
   * The work queue (Act 1, Bout 1.1): elements of dateable types that carry no
   * date yet — the backlog that could go on the axis. Global (the whole world's
   * undated backlog, not the current scope), grouped for the rail by the caller.
   */
  function undatedElements(): Array<{ id: string; type: ElementType; name: string }> {
    const out: Array<{ id: string; type: ElementType; name: string }> = [];
    for (const el of getState().data.elements) {
      const map = TEMPORAL_TYPE_FIELDS[el.type];
      if (!map) continue; // not a dateable type — never counts as "undated"
      if (parseTemporalValue((el as Record<string, unknown>)[map.start]) != null) continue;
      out.push({ id: el.id, type: el.type as ElementType, name: el.name || '(unnamed)' });
    }
    return out;
  }

  /**
   * Drag-to-date commit (Bout 1.2): write the type's start-date field, then
   * GUARANTEE the element is visible. A bare write can silently vanish it — the
   * default tableau caps at 22 by weight and a type filter excludes off-type
   * elements, so a freshly-dated low-weight element may enter neither the rail
   * (now dated) nor the scoped chart (gate: convergent HIGH finding).
   */
  async function dateElement(id: string, date: number): Promise<void> {
    const store = getActiveStore();
    const el = getState().data.elements.find(e => e.id === id);
    if (!store || !el) { toasts.error('element not found'); return; } // deleted mid-drag (gate)
    const field = TEMPORAL_TYPE_FIELDS[el.type]?.start;
    if (!field) { toasts.error('this type has no date field'); return; }
    try {
      await store.updateElement(id, { [field]: date });
      await refreshElementsAfterWrite(store);
      // Deferred so the re-render's lastScoped is fresh.
      queueMicrotask(() => showDatedElement(id, el.name, date));
    } catch (err) {
      console.error('[charts] drag-to-date write failed:', err);
      toasts.error('could not save the date');
    }
  }

  /**
   * Confirm a just-dated element. PEEK it if it's on the chart — a gentle
   * highlight + card, never a FOCUS (focus narrows the scope and loses the
   * user's view, Captain). If it fell outside the current tableau/filter, an
   * honest toast confirms the write instead of it silently vanishing (gate).
   */
  function showDatedElement(id: string, name: string, date: number): void {
    if (lastScoped.some(n => n.id === id)) {
      peekId = id;
      handle?.setSelection(id);
      toasts.success(`Dated ${name} to ${date}`);
    } else {
      toasts.success(`Dated ${name} to ${date} · not in this view`);
    }
  }

  /** The world's cast favorites (protagonist/nexus ids) from the registry. */
  function castIds(): string[] {
    const wid = worldId();
    const favorites = wid ? getState().registry.worlds.find(w => w.id === wid)?.favorites : undefined;
    return [favorites?.protagonist_id, favorites?.nexus_id]
      .filter((x): x is string => typeof x === 'string' && x.length > 0);
  }

  /**
   * The scope the live view is currently showing. Focus (URL) wins; an EMPTY
   * type filter means the TABLEAU (the world's cast + weighted essentials),
   * not "everything" — unticking every chip used to invert into the full soup.
   */
  function effectiveScope(allNodes: TimelineNode[], route: Route): ChartScope {
    if (!route.elementId && typeFilter && typeFilter.size === 0) {
      return tableauScope(allNodes, castIds());
    }
    return scopeFromFocus(route.elementId ?? null, typeFilter);
  }

  /** Same, for save-chart (reads the route itself). */
  function currentScope(): ChartScope {
    const route = parseHash(window.location.hash);
    const allNodes = extractTemporalNodes(getState().data.elements);
    return effectiveScope(allNodes, route);
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

    const route = parseHash(window.location.hash);
    renderControlBar(allNodes, route);

    if (!handle) {
      handle = mountTimelineView(viewMount, {
        // PEEK: clicking reads; it never routes... unless the clicked id (a
        // card chip can point outside the scope) has no node here — then the
        // honest move is a focus jump so the user still lands somewhere real.
        onSelect: (id) => {
          if (!id) { peekId = null; handle?.setSelection(null); return; }
          if (lastScoped.some(n => n.id === id)) {
            peekId = id;
            handle?.setSelection(id);
          } else {
            const w = worldId();
            if (w) navigate(timelineHash(w, id));
          }
        },
        // FOCUS: the explicit narrowing verb — URL-backed, Back walks out.
        onFocus: (id) => { const w = worldId(); if (w) navigate(timelineHash(w, id)); },
        onOpenElement: (id) => { const w = worldId(); if (w) navigate(elementHash(w, id)); },
        // The now-line was dragged/established → persist to World.time_current.
        onSetNow: (value) => void setNow(value),
        // A rail element was dragged onto the axis and dropped at `date`.
        onDateElement: (id, date) => void dateElement(id, date),
      });
    }

    const scoped = filterNodesByScope(allNodes, effectiveScope(allNodes, route));
    lastScoped = scoped;
    // Cast favorites (S4 + the cast marks): re-read each render so a toggle on
    // the element header reflects immediately.
    const favorites = getState().registry.worlds.find(w => w.id === wid)?.favorites;
    const extras: TimelineViewExtras = {
      cast: {
        protagonistId: favorites?.protagonist_id ?? null,
        nexusId: favorites?.nexus_id ?? null,
      },
      now: nowValue(),
      undated: undatedElements(),
    };
    // allNodes rides along as the overview strip's constant reference frame
    // (the full world's history stays visible however narrow the scope, S2).
    handle.setNodes(scoped, allNodes, extras);
    // A focus CHANGE auto-peeks its element (the card answers "what am I
    // looking at"); otherwise the peek is sticky across re-renders.
    const focusNow = route.mode === 'timeline' ? (route.elementId ?? null) : null;
    if (focusNow !== lastFocusId) {
      lastFocusId = focusNow;
      peekId = focusNow;
    }
    handle.setSelection(peekId);

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
