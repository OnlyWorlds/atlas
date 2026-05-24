/**
 * Writing-context tab body — orchestrator for the context pane that lives in
 * the right pane while the writing room is active.
 *
 * Pane layout (top to bottom):
 *   [graph]      — force-directed visualization of cast + 1-hop adjacent
 *   [lists]      — Cast (left 60%) + Suggested (right 40%), side-by-side
 *   [preview]    — element preview slide-in, takes lists' slot when active
 *
 * Lifecycle: mounted by right-pane.ts dispatch when the active tab is
 * `writing-context`. Reads `narrativeId` from the tab ref. Re-renders on
 * state changes (elements list, narrative content).
 *
 * Boot ordering note: on page refresh the tab can mount BEFORE state.data
 * .elements is populated (world activation + folder unlock are async). The
 * subscribe installs unconditionally, and renderAll bails to an empty state
 * when the narrative isn't found yet — it re-attempts on every elements-ref
 * swap until the lookup succeeds.
 */

import { getState, subscribe, type RightTabRef } from '../../core/state';
import type { Element } from '../../core/types';
import { ToastManager } from '../../ui/toast-manager';
import { mountContextGraph, type GraphHandle } from './context-pane-graph';
import { mountContextLists, type ContextListsHandle } from './context-pane-lists';
import { mountContextPreview, type ContextPreviewHandle } from './context-pane-preview';

export interface MountContextTabOpts {
  pane: HTMLElement;
  narrativeId: string;
  toasts: ToastManager;
}

export function mountWritingContextTab(opts: MountContextTabOpts): () => void {
  const { pane, narrativeId } = opts;
  pane.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'atlas-context-pane';
  root.dataset.narrativeId = narrativeId;
  pane.appendChild(root);

  // Graph slot — fixed-height region for the force-directed visualization.
  // No top strip in v1 — the tab label is sufficient identification, and a
  // disabled tier selector earned no real estate (tier zoom deferred to v2).
  const graphSlot = document.createElement('div');
  graphSlot.className = 'atlas-context-pane-graph';
  root.appendChild(graphSlot);

  // Below-graph container hosts BOTH the lists and the preview slide-in.
  // Lists render by default; preview replaces them (display toggle) when an
  // element is selected — perfectly snug seam against the graph's bottom edge.
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

  const findNarrative = (id: string): Element | null => {
    return getState().data.elements.find(e => e.id === id) ?? null;
  };

  // Selection state — shared between graph, lists, preview.
  let selectedId: string | null = null;
  let graphHandle: GraphHandle | null = null;
  let listsHandle: ContextListsHandle | null = null;
  let previewHandle: ContextPreviewHandle | null = null;
  let lastRenderedForRef: readonly Element[] | null = null;

  function showEmpty(message: string): void {
    graphSlot.innerHTML = `<div class="atlas-context-pane-empty">${message}</div>`;
    listsHost.innerHTML = '';
    previewHost.innerHTML = '';
    previewHost.dataset.state = 'hidden';
    listsHost.style.display = '';
  }

  function onSelect(elementId: string | null): void {
    selectedId = elementId;
    graphHandle?.highlight(elementId);
    listsHandle?.highlight(elementId);
    if (elementId) {
      const el = findNarrative(elementId);
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
  }

  function renderAll(): void {
    const current = findNarrative(narrativeId);
    if (!current) {
      // Either still booting (elements not loaded yet) or the narrative was
      // deleted. Either way, show a tiny empty state and let the subscribe
      // re-attempt next state tick. Loading-state copy distinguishes
      // "haven't loaded yet" from "really gone".
      const elementsLoaded = getState().data.elements.length > 0;
      showEmpty(elementsLoaded ? 'Narrative not found.' : 'Loading narrative…');
      // Reset handles so the next successful render starts clean.
      graphHandle?.destroy();
      listsHandle?.destroy();
      previewHandle?.destroy();
      graphHandle = null;
      listsHandle = null;
      previewHandle = null;
      return;
    }
    graphHandle?.destroy();
    listsHandle?.destroy();
    previewHandle?.destroy();
    graphSlot.innerHTML = '';
    listsHost.innerHTML = '';
    previewHost.innerHTML = '';
    graphHandle = mountContextGraph({
      host: graphSlot,
      narrative: current,
      onSelect,
    });
    listsHandle = mountContextLists({
      host: listsHost,
      narrative: current,
      onSelect,
    });
    previewHandle = mountContextPreview({
      host: previewHost,
      narrative: current,
      onClose: () => onSelect(null),
    });
    if (selectedId) onSelect(selectedId);
  }

  // Subscribe FIRST so the tab recovers when elements arrive after mount
  // (boot path: tab inserts before world activation completes). The first
  // renderAll call below either succeeds (warm reload with elements ready)
  // or shows the loading-state empty surface and waits for the subscribe to
  // fire.
  lastRenderedForRef = getState().data.elements;
  const unsubState = subscribe(() => {
    const current = getState().data.elements;
    if (current === lastRenderedForRef) return;
    lastRenderedForRef = current;
    renderAll();
  });

  // Listen for in-prose chip clicks — routes the selection into this pane
  // so the click stays in writing mode (no URL change). Counterpart to
  // writing-workspace's onChipClick dispatcher.
  const onChipSelectEvent = (e: Event): void => {
    const detail = (e as CustomEvent).detail as { id?: string } | null;
    if (!detail || typeof detail.id !== 'string') return;
    onSelect(detail.id);
  };
  document.addEventListener('atlas:context-select-element', onChipSelectEvent);

  renderAll();

  return () => {
    unsubState();
    document.removeEventListener('atlas:context-select-element', onChipSelectEvent);
    graphHandle?.destroy();
    listsHandle?.destroy();
    previewHandle?.destroy();
    pane.innerHTML = '';
  };
}

/** Type-narrow helper for the right-pane dispatch. */
export function isWritingContextTab(t: RightTabRef): t is { kind: 'writing-context'; narrativeId: string } {
  return t.kind === 'writing-context';
}
