/**
 * Charts room — the interactive chart view (currently the temporal chart).
 *
 * Owns the ChartConfig (seeded from the recipe engine, then mutated by the
 * control bar), computes the scoped node set, and feeds it to the dumb
 * `timeline-view` renderer. Selection round-trips through the URL so the
 * right-pane context graph focuses the same element (mode stays 'timeline' →
 * app.ts doesn't re-mount). See DESIGN_CHARTS.md.
 */

import { getState, subscribe } from '../core/state';
import { navigate, elementHash, timelineHash, parseHash, onHashChange } from '../core/router';
import { ToastManager } from '../ui/toast-manager';
import { ElementCreateModal } from '../ui/element-create-modal';
import { mountTimelineView, type TimelineViewHandle } from '../visualization/timeline/timeline-view';
import { extractTemporalNodes } from '../visualization/timeline/data-normalizer';
import { pickDefaultChart, filterNodesByScope } from '../visualization/timeline/chart-recipe';
import type { ChartConfig, ChartScope, TimelineNode } from '../visualization/timeline/types';
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
    <p class="atlas-room-subtitle">Your world along a time axis — click any event to see everything it touches.</p>
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
  let config: ChartConfig | null = null;

  const worldId = (): string | null => getState().active?.worldId ?? null;
  const elementById = (id: string): Element | undefined =>
    getState().data.elements.find(e => e.id === id);

  function applyScope(scope: ChartScope): void {
    if (config) config = { ...config, scope };
    render();
  }

  // The set of temporal types actually present, first-seen order (stable enough).
  function presentTypes(nodes: TimelineNode[]): ElementType[] {
    const seen = new Set<string>();
    const out: ElementType[] = [];
    for (const n of nodes) {
      if (!seen.has(n.elementType)) { seen.add(n.elementType); out.push(n.elementType as ElementType); }
    }
    return out;
  }

  function activeTypeSet(scope: ChartScope, present: ElementType[]): Set<string> {
    if (scope.kind === 'types') return new Set(scope.types);
    return new Set(present); // 'all' / 'focus' / 'selection' → all present read as active
  }

  function renderControlBar(allNodes: TimelineNode[]): void {
    controlBar.innerHTML = '';
    if (!config || allNodes.length === 0) return;
    const present = presentTypes(allNodes);

    // Focus pill (when the chart is scoped to one element's neighbourhood).
    if (config.scope.kind === 'focus') {
      const target = elementById(config.scope.elementId);
      const pill = document.createElement('div');
      pill.className = 'atlas-chart-focus-pill';
      pill.innerHTML =
        `<span class="material-symbols-outlined">filter_center_focus</span>` +
        `<span>${escapeText(target?.name || 'focused')}</span>` +
        `<button type="button" class="atlas-chart-focus-clear" title="Clear focus">×</button>`;
      pill.querySelector('.atlas-chart-focus-clear')!
        .addEventListener('click', () => applyScope({ kind: 'all' }));
      controlBar.appendChild(pill);
    }

    // Type toggle chips — the wall-killer: pull the world's temporal dump down
    // to the types you care about.
    const active = activeTypeSet(config.scope, present);
    const chipsLive = config.scope.kind === 'types' || config.scope.kind === 'all';
    for (const t of present) {
      const on = chipsLive && active.has(t);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'atlas-chart-type-chip' + (on ? ' active' : '');
      const label = ELEMENT_LABELS[t]?.plural ?? t;
      chip.innerHTML =
        `<span class="material-symbols-outlined">${escapeText(ELEMENT_ICONS[t] ?? 'category')}</span>` +
        `<span>${escapeText(label)}</span>`;
      chip.addEventListener('click', () => {
        const next = activeTypeSet(config!.scope, present);
        if (next.has(t)) next.delete(t); else next.add(t);
        applyScope(next.size >= present.length ? { kind: 'all' } : { kind: 'types', types: [...next] as ElementType[] });
      });
      controlBar.appendChild(chip);
    }
  }

  function render(): void {
    const wid = worldId();
    if (!wid) return;
    const all = getState().data.elements;
    const allNodes = extractTemporalNodes(all);
    // Seed the default chart from the recipe ONCE, when content first exists
    // (so the opening view is the focused recipe, never the full wall).
    if (!config && allNodes.length > 0) config = pickDefaultChart(all);

    renderControlBar(allNodes);

    if (!handle) {
      handle = mountTimelineView(viewMount, {
        onSelect: (id) => { const w = worldId(); if (w) navigate(id ? timelineHash(w, id) : timelineHash(w)); },
        onFocus: (id) => {
          if (config) config = { ...config, scope: { kind: 'focus', elementId: id } };
          const w = worldId(); if (w) navigate(timelineHash(w, id));
        },
        onOpenElement: (id) => { const w = worldId(); if (w) navigate(elementHash(w, id)); },
      });
    }

    const scoped = config ? filterNodesByScope(allNodes, config.scope) : allNodes;
    handle.setNodes(scoped);
    const route = parseHash(window.location.hash);
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
