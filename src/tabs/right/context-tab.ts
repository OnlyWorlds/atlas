/**
 * Context tab body — orchestrator for the tool-global context pane.
 *
 * The pane is composed of:
 *   [graph]   — force-directed visualization centered on a subject element
 *   [details] — mode-routed content beneath the graph:
 *                 - writing room   → Cast + Potentials lists
 *                 - element room   → element preview card (subject by default,
 *                                    swaps to whichever graph node is clicked)
 *                 - other (home, timeline, settings, map, search) → empty state
 *
 * Subject is derived from the URL route at render time:
 *   - mode === 'writing'  → route.narrativeId (the active narrative)
 *   - mode === 'element'  → route.elementId
 *   - otherwise           → null (empty state)
 *
 * URL is the single source of truth for "what am I focused on". No state
 * slice, no sessionStorage. The user's URL hash already persists across
 * page refreshes. In-pane click-to-recenter and graph-node-click selection
 * stay pane-local — see `context-pane-graph.ts`.
 */

import { getState, patchSlice, subscribe, type RightTabRef } from '../../core/state';
import type { Element, ElementType, WorldRegistryEntry } from '../../core/types';
import { ToastManager } from '../../ui/toast-manager';
import { onHashChange, parseHash, type Route } from '../../core/router';
import { saveRegistry } from '../../registry/registry';
import { getTierForNarrative } from '../../middle/writing-helpers';
import { mountContextGraph, type GraphHandle, type HopDepth } from './context-pane-graph';
import { mountContextLists, type ContextListsHandle } from './context-pane-lists';
import { mountContextPreview, type ContextPreviewHandle } from './context-pane-preview';
import { mountContextToolbar, type ContextToolbarHandle } from './context-pane-toolbar';

export interface MountContextTabOpts {
  pane: HTMLElement;
  toasts: ToastManager;
}

type DetailsMode = 'writing' | 'element' | 'empty';

interface Subject {
  /** The element the graph + details center on. Null when no focus. */
  element: Element | null;
  /** Which details renderer to mount below the graph. */
  detailsMode: DetailsMode;
}

function resolveSubject(route: Route, elements: readonly Element[]): Subject {
  if (route.mode === 'writing' && route.narrativeId) {
    const el = elements.find(e => e.id === route.narrativeId) ?? null;
    return { element: el, detailsMode: 'writing' };
  }
  if (route.mode === 'element' && route.elementId) {
    const el = elements.find(e => e.id === route.elementId) ?? null;
    return { element: el, detailsMode: 'element' };
  }
  return { element: null, detailsMode: 'empty' };
}

export function mountContextTab(opts: MountContextTabOpts): () => void {
  const { pane } = opts;
  pane.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'atlas-context-pane';
  pane.appendChild(root);

  // Toolbar (above graph) — type filter chips + hop pill. Hidden when there's
  // no subject (empty state); shown otherwise.
  const toolbarHost = document.createElement('div');
  toolbarHost.className = 'atlas-context-pane-toolbar-host';
  toolbarHost.dataset.state = 'hidden';
  root.appendChild(toolbarHost);

  const graphSlot = document.createElement('div');
  graphSlot.className = 'atlas-context-pane-graph';
  root.appendChild(graphSlot);

  const belowGraph = document.createElement('div');
  belowGraph.className = 'atlas-context-pane-below';
  root.appendChild(belowGraph);

  const listsHost = document.createElement('div');
  listsHost.className = 'atlas-context-pane-lists-host';
  belowGraph.appendChild(listsHost);

  const previewHost = document.createElement('div');
  previewHost.className = 'atlas-context-pane-preview-host';
  previewHost.dataset.state = 'hidden';
  belowGraph.appendChild(previewHost);

  // Currently rendered context — populated by renderAll. The unified
  // onSelect handler reads this to dispatch to the right behavior.
  let currentRender: { mode: DetailsMode; subject: Element | null } = {
    mode: 'empty',
    subject: null,
  };

  let selectedId: string | null = null;
  let graphHandle: GraphHandle | null = null;
  let listsHandle: ContextListsHandle | null = null;
  let previewHandle: ContextPreviewHandle | null = null;
  let toolbarHandle: ContextToolbarHandle | null = null;

  // Cached inputs so we don't rebuild on every state tick. Rebuild only when
  // route key changes or elements array reference swaps. Prefs changes
  // (registry edits via toolbar OR settings page) propagate via
  // syncPrefsToGraph without a full rebuild.
  let lastRouteKey: string | null = null;
  let lastElementsRef: readonly Element[] | null = null;
  let lastAppliedPrefs: ReturnType<typeof getWorldContextPrefs> | null = null;

  function routeKey(route: Route): string {
    return `${route.mode}|${route.narrativeId ?? ''}|${route.elementId ?? ''}`;
  }

  function hiddenEquals(a: Set<ElementType>, b: Set<ElementType>): boolean {
    if (a.size !== b.size) return false;
    for (const t of a) if (!b.has(t)) return false;
    return true;
  }

  /**
   * When the registry changes (from either toolbar OR settings page edits),
   * propagate the new prefs to the graph without rebuilding. ONLY calls the
   * setter for fields that actually changed — extra setHiddenTypes /
   * setHopDepth calls would trigger spurious sim re-runs and wobble node
   * positions, breaking lock-layout's "no jumping" guarantee. Order matters:
   * setLockLayout first so subsequent setHiddenTypes sees the new flag.
   */
  function syncPrefsToGraph(): void {
    if (!graphHandle || !currentRender.subject) return;
    const prefs = getWorldContextPrefs();
    const prev = lastAppliedPrefs;
    if (prev
      && prev.lockLayout === prefs.lockLayout
      && prev.edgeColor === prefs.edgeColor
      && prev.hop === prefs.hop
      && hiddenEquals(prev.hidden, prefs.hidden)
    ) return;
    if (!prev || prev.lockLayout !== prefs.lockLayout) {
      graphHandle.setLockLayout(prefs.lockLayout);
    }
    if (!prev || !hiddenEquals(prev.hidden, prefs.hidden)) {
      graphHandle.setHiddenTypes(prefs.hidden);
    }
    if (!prev || prev.hop !== prefs.hop) {
      graphHandle.setHopDepth(prefs.hop);
    }
    if (!prev || prev.edgeColor !== prefs.edgeColor) {
      graphHandle.setEdgeColor(prefs.edgeColor);
    }
    lastAppliedPrefs = prefs;
    toolbarHandle?.update({
      presentTypes: graphHandle.getPresentTypes(),
      hiddenTypes: prefs.hidden,
      effectiveHop: effectiveHopFor(currentRender.subject, prefs.hop),
      lockLayout: prefs.lockLayout,
    });
  }

  function showEmpty(message: string): void {
    graphSlot.innerHTML = `<div class="atlas-context-pane-empty">${message}</div>`;
    listsHost.innerHTML = '';
    previewHost.innerHTML = '';
    previewHost.dataset.state = 'hidden';
    listsHost.style.display = '';
    graphHandle?.destroy();
    listsHandle?.destroy();
    previewHandle?.destroy();
    toolbarHandle?.destroy();
    toolbarHost.dataset.state = 'hidden';
    graphHandle = null;
    listsHandle = null;
    previewHandle = null;
    toolbarHandle = null;
    selectedId = null;
  }

  /** Get the active world's per-world context-pane prefs. */
  function getWorldContextPrefs(): {
    hidden: Set<ElementType>;
    hop: HopDepth | undefined;
    lockLayout: boolean;
    edgeColor: boolean;
  } {
    const state = getState();
    const worldId = state.active?.worldId;
    if (!worldId) return { hidden: new Set(), hop: undefined, lockLayout: false, edgeColor: false };
    const entry = state.registry.worlds.find(w => w.id === worldId);
    const hidden = new Set<ElementType>((entry?.context_filters_off ?? []) as ElementType[]);
    const hop = entry?.context_hop_depth as HopDepth | undefined;
    const lockLayout = entry?.context_lock_layout === true;
    const edgeColor = entry?.context_edge_color === true;
    return { hidden, hop, lockLayout, edgeColor };
  }

  /** Mutate the active world's registry entry. Persists + patches state. */
  function patchWorldEntry(patch: Partial<WorldRegistryEntry>): void {
    const state = getState();
    const worldId = state.active?.worldId;
    if (!worldId) return;
    const reg = state.registry;
    const idx = reg.worlds.findIndex(w => w.id === worldId);
    if (idx < 0) return;
    const updated: WorldRegistryEntry = { ...reg.worlds[idx], ...patch };
    const next = { ...reg, worlds: reg.worlds.map((w, i) => (i === idx ? updated : w)) };
    saveRegistry(next);
    patchSlice('registry', next);
  }

  /** Compute the effective hop depth for the current subject. */
  function effectiveHopFor(subject: Element, explicit: HopDepth | undefined): HopDepth {
    if (explicit === 1 || explicit === 2 || explicit === 3 || explicit === 4) return explicit;
    // Tier-derived default: scene/draft → 2; chapter/book → 1; non-narrative → 2.
    const worldId = getState().active?.worldId ?? '';
    if (subject.type !== 'narrative' || !worldId) return 2;
    const tier = getTierForNarrative(subject, worldId);
    return tier === 'l1' || tier === 'l2' ? 1 : 2;
  }

  /**
   * Unified selection handler shared across graph, lists, and preview.
   * Behavior depends on the current render mode.
   *
   * - **writing**: elementId selects → preview slides over lists. Null hides
   *   preview, restores lists. Tracks selection in graph + lists highlight.
   * - **element**: preview is always visible. elementId swaps the preview's
   *   content. Null reverts to the subject preview (graph back pill).
   * - **empty**: no-op.
   */
  function onSelect(elementId: string | null): void {
    selectedId = elementId;
    graphHandle?.highlight(elementId);

    if (currentRender.mode === 'writing') {
      listsHandle?.highlight(elementId);
      if (elementId) {
        const el = getState().data.elements.find(e => e.id === elementId);
        if (el) {
          previewHost.dataset.state = 'visible';
          listsHost.style.display = 'none';
          previewHandle?.show(el);
        }
      } else {
        previewHost.dataset.state = 'hidden';
        listsHost.style.display = '';
        previewHandle?.hide();
      }
      return;
    }

    if (currentRender.mode === 'element') {
      // Element mode: preview is the primary content, always visible.
      // null = revert to subject.
      const subject = currentRender.subject;
      const targetId = elementId ?? subject?.id ?? null;
      if (!targetId) return;
      const target = getState().data.elements.find(e => e.id === targetId);
      if (target) {
        previewHandle?.show(target);
        graphHandle?.highlight(target.id);
      }
      return;
    }
  }

  function renderAll(route: Route): void {
    const state = getState();
    const subject = resolveSubject(route, state.data.elements);

    // Tear down + clear before rebuild.
    graphHandle?.destroy();
    listsHandle?.destroy();
    previewHandle?.destroy();
    toolbarHandle?.destroy();
    graphHandle = null;
    listsHandle = null;
    previewHandle = null;
    toolbarHandle = null;
    graphSlot.innerHTML = '';
    listsHost.innerHTML = '';
    previewHost.innerHTML = '';
    selectedId = null;

    currentRender = { mode: subject.detailsMode, subject: subject.element };

    // No subject: show empty state and bail. Distinguish "no focus yet" from
    // "focus resolves to nothing in current data".
    if (subject.detailsMode === 'empty') {
      showEmpty(emptyCopyForRoute(route));
      return;
    }
    if (subject.element === null) {
      const loaded = state.data.elements.length > 0;
      showEmpty(loaded ? 'Element not found.' : 'Loading…');
      return;
    }

    // Subject resolved — load per-world prefs and mount graph + toolbar.
    const prefs = getWorldContextPrefs();
    const subjectEl = subject.element;
    const effectiveHop = effectiveHopFor(subjectEl, prefs.hop);

    // onRender callback bridges the graph's per-render present-types update
    // into the toolbar so its chips reflect the current view.
    const handleGraphRender = (presentTypes: ReadonlySet<ElementType>): void => {
      const p = getWorldContextPrefs();
      toolbarHandle?.update({
        presentTypes,
        hiddenTypes: p.hidden,
        effectiveHop: effectiveHopFor(subjectEl, p.hop),
        lockLayout: p.lockLayout,
      });
    };

    graphHandle = mountContextGraph({
      host: graphSlot,
      subject: subjectEl,
      onSelect,
      hiddenTypes: prefs.hidden,
      hopDepth: prefs.hop,
      lockLayout: prefs.lockLayout,
      edgeColor: prefs.edgeColor,
      onRender: handleGraphRender,
    });

    // Mount toolbar with the initial state. Toolbar callbacks ONLY persist
    // to the registry — the orchestrator's syncPrefsToGraph picks up the
    // change (via the state subscriber → maybeRender) and applies it to the
    // graph. Settings page edits land here the same way.
    toolbarHandle = mountContextToolbar({
      host: toolbarHost,
      initial: {
        presentTypes: graphHandle.getPresentTypes(),
        hiddenTypes: prefs.hidden,
        effectiveHop,
        lockLayout: prefs.lockLayout,
      },
      onToggleType: (type) => {
        const cur = getWorldContextPrefs().hidden;
        const next = new Set(cur);
        if (next.has(type)) next.delete(type);
        else next.add(type);
        patchWorldEntry({ context_filters_off: Array.from(next) });
      },
      onSetHop: (hop) => {
        patchWorldEntry({ context_hop_depth: hop });
      },
      onToggleLockLayout: () => {
        patchWorldEntry({ context_lock_layout: !getWorldContextPrefs().lockLayout });
      },
    });
    toolbarHost.dataset.state = 'visible';
    // Seed prefs cache so the first state tick after mount doesn't re-apply.
    lastAppliedPrefs = prefs;

    if (subject.detailsMode === 'writing') {
      const narrative = subjectEl;
      listsHandle = mountContextLists({ host: listsHost, narrative, onSelect });
      previewHandle = mountContextPreview({
        host: previewHost,
        subject: narrative,
        mode: 'writing',
        onClose: () => onSelect(null),
      });
      previewHost.dataset.state = 'hidden';
      listsHost.style.display = '';
      return;
    }

    if (subject.detailsMode === 'element') {
      const element = subjectEl;
      previewHandle = mountContextPreview({
        host: previewHost,
        subject: element,
        mode: 'element',
        onClose: () => onSelect(null), // revert to subject preview
      });
      listsHost.style.display = 'none';
      previewHost.dataset.state = 'visible';
      previewHandle.show(element);
      graphHandle.highlight(element.id);
      selectedId = element.id;
      return;
    }
  }

  function maybeRender(): void {
    const route = parseHash(window.location.hash);
    const elements = getState().data.elements;
    const nextKey = routeKey(route);
    if (nextKey !== lastRouteKey || elements !== lastElementsRef) {
      lastRouteKey = nextKey;
      lastElementsRef = elements;
      renderAll(route);
      return;
    }
    // Route + elements unchanged — check if context-pane prefs changed
    // (toolbar persisted via patchWorldEntry, OR settings page edited).
    syncPrefsToGraph();
  }

  const unsubState = subscribe(maybeRender);
  const unsubHash = onHashChange(maybeRender);

  // Chip-click selection event (dispatched by the writing workspace when an
  // ow:// chip in prose is clicked). Routes selection into the lists/preview
  // without changing the URL. Only meaningful in writing mode; no-op otherwise.
  const onChipSelectEvent = (e: Event): void => {
    const detail = (e as CustomEvent).detail as { id?: string } | null;
    if (!detail || typeof detail.id !== 'string') return;
    if (currentRender.mode === 'writing') onSelect(detail.id);
  };
  document.addEventListener('atlas:context-select-element', onChipSelectEvent);

  // Mouse-back button (button index 3 on 5-button mice). When pressed with
  // the cursor over the context pane, suppress the browser's history
  // navigation and instead pop one entry off the graph breadcrumb. When the
  // breadcrumb is already empty (at subject), still suppress navigation —
  // user clearly meant to back-navigate INSIDE the pane.
  //
  // Implementation: listen at WINDOW level in CAPTURE phase so we run before
  // Chrome's built-in gesture handler initiates history.back(). Listen on
  // mousedown + mouseup + auxclick because Chrome fires history nav on
  // mouseup; preventDefault on all three maximizes suppression coverage.
  // Only act (goBack) on mousedown to avoid triple-popping.
  const handleMouseBack = (e: MouseEvent): void => {
    if (e.button !== 3) return;
    if (!root.contains(e.target as Node)) return;
    e.preventDefault();
    if (e.type === 'mousedown' && graphHandle) {
      graphHandle.goBack();
    }
  };
  window.addEventListener('mousedown', handleMouseBack, true);
  window.addEventListener('mouseup', handleMouseBack, true);
  window.addEventListener('auxclick', handleMouseBack, true);

  maybeRender();

  return () => {
    unsubState();
    unsubHash();
    document.removeEventListener('atlas:context-select-element', onChipSelectEvent);
    window.removeEventListener('mousedown', handleMouseBack, true);
    window.removeEventListener('mouseup', handleMouseBack, true);
    window.removeEventListener('auxclick', handleMouseBack, true);
    graphHandle?.destroy();
    listsHandle?.destroy();
    previewHandle?.destroy();
    toolbarHandle?.destroy();
    pane.innerHTML = '';
  };
}

function emptyCopyForRoute(route: Route): string {
  // Subtle per-route hints; all variants are encouraging-not-prescriptive.
  switch (route.mode) {
    case 'home':
    case 'welcome':
      return 'Open an element or narrative to see its connections.';
    case 'timeline':
      return 'Select an element to focus the graph.';
    case 'settings':
      return 'Element-focused view returns when you leave settings.';
    case 'search':
      return 'Pick a search result to see its context.';
    case 'map':
      return 'Open an element or narrative to focus the graph.';
    default:
      return 'Open an element or narrative to see its connections.';
  }
}

/** Type-narrow helper for the right-pane dispatch. */
export function isContextTab(t: RightTabRef): t is { kind: 'context' } {
  return t.kind === 'context';
}
