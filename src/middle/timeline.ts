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
import { mountTimelineView, type TimelineViewHandle } from '../visualization/timeline/timeline-view';
import { extractTemporalNodes } from '../visualization/timeline/data-normalizer';
import { pickDefaultChart, filterNodesByScope, scopeFromFocus } from '../visualization/timeline/chart-recipe';
import type { ChartConfig, TimelineNode } from '../visualization/timeline/types';
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
    <p class="atlas-room-subtitle">Your world along a time axis — click any element to focus on what it touches.</p>
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
  wrap.appendChild(actions);

  const controlBar = document.createElement('div');
  controlBar.className = 'atlas-chart-controls';
  wrap.appendChild(controlBar);

  const viewMount = document.createElement('div');
  viewMount.className = 'atlas-timeline-view-mount';
  wrap.appendChild(viewMount);

  let handle: TimelineViewHandle | null = null;
  let config: ChartConfig | null = null;        // seeded once; the future save/share contract
  let typeFilter: Set<ElementType> | null = null; // broad-view filter (null = all); focus is URL-driven
  let seeded = false;

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

  function render(): void {
    const wid = worldId();
    if (!wid) return;
    const all = getState().data.elements;
    const allNodes = extractTemporalNodes(all);
    // Seed the broad-view type filter from the recipe ONCE, so the opening view
    // is the focused recipe (Story / Events / Foundings), not the full wall. A
    // 'focus' recipe leaves the broad view = all (the user clicks to focus).
    if (!seeded && allNodes.length > 0) {
      seeded = true;
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
    handle.setNodes(scoped);
    handle.setSelection(route.mode === 'timeline' ? (route.elementId ?? null) : null);
  }

  if (getState().active) render();
  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);

  return () => {
    unsubState();
    unsubHash();
    handle?.destroy();
    handle = null;
  };
}
