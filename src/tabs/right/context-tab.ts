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
import { elementHash, navigate, onHashChange, parseHash, type Route } from '../../core/router';
import { saveRegistry } from '../../registry/registry';
import { getTierForNarrative, isWritingNarrative } from '../../middle/writing-helpers';
import { mountContextGraph, type GraphHandle, type HopDepth } from './context-pane-graph';
import { mountContextLists, type ContextListsHandle } from './context-pane-lists';
import { getKnowledgeRoomTab } from '../../middle/knowledge-room';
import { listKnowledgeEntries, heldByCount } from '../../core/knowledge';
import { blocksOf, pageRefsFor } from '../../core/sharing';
import { mountContextPreview, type ContextPreviewHandle } from './context-pane-preview';
import { mountContextToolbar, type ContextToolbarHandle } from './context-pane-toolbar';
import { extractTemporalNodes } from '../../visualization/timeline/data-normalizer';
import { rankAnchors } from '../../visualization/timeline/degree';
import { currentLore } from '../../core/parlor-room';
import {
  chosenLens, keepHeldBackLine, keepLensField, keepLensOn, keepingLens, lensChoices, lensLine, lensName, readLensPicture, setWebLens,
} from '../../core/web-lens';
import type { ToolbarLens } from './context-pane-toolbar';
import { getActiveStore } from '../../core/active-store';
import { refreshElementsAfterWrite } from '../../sync/sync-attach';
import { showProblem } from '../../ui/problem-fixes';
import { strandMarkKey } from '../../core/strand';
import { buildStrandFrame } from './context-strand-frame';

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
  /**
   * One-line muted explainer shown above the details when the pane ANCHORED a
   * default (charts / knowledge list / share page / writing landing) instead of
   * the user focusing something — so a surprising anchor doesn't read as random
   * (T-CX3). Absent for direct focus.
   */
  caption?: string;
}

/** Most-recently-edited element in a set (by local/server update timestamp). */
function mostRecentlyEdited(els: readonly Element[]): Element | null {
  let best: Element | null = null;
  let bestTs = '';
  for (const e of els) {
    const rec = e as Record<string, unknown>;
    const ts = String(rec.local_updated_at ?? rec.server_updated_at ?? '');
    if (!best || ts > bestTs) { best = e; bestTs = ts; }
  }
  return best;
}

function resolveSubject(route: Route, elements: readonly Element[]): Subject {
  if (route.mode === 'writing' && route.narrativeId) {
    const el = elements.find(e => e.id === route.narrativeId) ?? null;
    return { element: el, detailsMode: 'writing' };
  }
  // Writing landing (no open narrative): instead of a void, anchor the graph on
  // the most recently edited writing-tree narrative so the pane teaches by
  // example. World with no writing narratives falls through to the empty state.
  if (route.mode === 'writing' && route.worldId) {
    const writing = elements.filter(e => isWritingNarrative(e, route.worldId!));
    const anchor = mostRecentlyEdited(writing);
    return anchor
      ? { element: anchor, detailsMode: 'element', caption: 'Your most recently edited narrative' }
      : { element: null, detailsMode: 'empty' };
  }
  if (route.mode === 'element' && route.elementId) {
    const el = elements.find(e => e.id === route.elementId) ?? null;
    return { element: el, detailsMode: 'element' };
  }
  // Charts room: a focused element (/timeline/<elementId>) is the subject, so
  // the context graph focuses the same element the chart shows — middle = WHEN,
  // right pane = the relational WEB (DESIGN_CHARTS.md). With NO focus, anchor the
  // graph on the most-significant dated node (same degree metric as the chart's
  // anchor beats) so the pane is never empty on the landing — globally-highest-
  // degree, ignoring type chips (Titus's call, chart #2).
  if (route.mode === 'timeline') {
    if (route.elementId) {
      const el = elements.find(e => e.id === route.elementId) ?? null;
      return { element: el, detailsMode: 'element' };
    }
    const topId = [...rankAnchors(extractTemporalNodes([...elements]), 1)][0];
    const el = topId ? (elements.find(e => e.id === topId) ?? null) : null;
    return el
      ? { element: el, detailsMode: 'element', caption: 'Most connected in this period' }
      : { element: null, detailsMode: 'empty' };
  }
  // Knowledge room: an open entry (or knower known-view) is the subject —
  // entry ↔ holders ↔ subjects in the graph via the existing element mode.
  // (The full "knowledge mode" graph is K5, deferred.)
  if (route.mode === 'knowledge' && route.knowledgeId && route.knowledgeId !== 'new') {
    const el = elements.find(e => e.id === route.knowledgeId) ?? null;
    return { element: el, detailsMode: 'element' };
  }
  if (route.mode === 'knowledge' && route.knowerId) {
    const el = elements.find(e => e.id === route.knowerId) ?? null;
    return { element: el, detailsMode: 'element' };
  }
  // Knowledge list (no open entry/knower): anchor on the most widely held
  // entry so the pane shows the world's knowledge web instead of empty text
  // (K7). The graph's element mode draws entry ↔ holders ↔ subjects around it.
  if (route.mode === 'knowledge') {
    const entries = listKnowledgeEntries([...elements]);
    if (entries.length === 0) return { element: null, detailsMode: 'empty' };
    const anchor = entries.reduce(
      (best, e) => (heldByCount(e) > heldByCount(best) ? e : best),
      entries[0],
    );
    return { element: anchor, detailsMode: 'element', caption: 'The world’s most widely held entry' };
  }
  // Share page detail: anchor on the page's first carded element so the pane
  // previews what the page features. Pages with no element cards fall through
  // to the empty state (which names the next action). The list view (no
  // pageId) also falls through — nothing is focused yet.
  if (route.mode === 'share' && route.pageId) {
    const page = elements.find(e => e.id === route.pageId) ?? null;
    if (!page) return { element: null, detailsMode: 'empty' };
    const refs = pageRefsFor(blocksOf(page));
    const firstEl = refs
      .map(id => elements.find(e => e.id === id))
      .find((e): e is Element => Boolean(e)) ?? null;
    return firstEl
      ? { element: firstEl, detailsMode: 'element', caption: 'This page’s first featured element' }
      : { element: null, detailsMode: 'empty' };
  }
  return { element: null, detailsMode: 'empty' };
}

export function mountContextTab(opts: MountContextTabOpts): () => void {
  const { pane, toasts } = opts;
  pane.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'atlas-context-pane';
  pane.appendChild(root);

  // The strand's frame (S8): the writing context leads with it while the open
  // Narrative is the world's strand's story; empty otherwise.
  const strandHost = document.createElement('div');
  strandHost.className = 'atlas-context-strand-host';
  root.appendChild(strandHost);

  // Toolbar (above graph) — type filter chips + hop pill. Hidden when there's
  // no subject (empty state); shown otherwise.
  const toolbarHost = document.createElement('div');
  toolbarHost.className = 'atlas-context-pane-toolbar-host';
  toolbarHost.dataset.state = 'hidden';
  root.appendChild(toolbarHost);

  const graphSlot = document.createElement('div');
  graphSlot.className = 'atlas-context-pane-graph';
  root.appendChild(graphSlot);

  // Anchor caption (T-CX3) — sits between the graph and the details slot;
  // populated only when the subject was an anchored default (see setCaption).
  const captionHost = document.createElement('div');
  captionHost.className = 'atlas-context-pane-caption';
  captionHost.dataset.state = 'hidden';
  root.appendChild(captionHost);

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
  let currentRender: { mode: DetailsMode; subject: Element | null; focused: boolean; lensOnly: boolean } = {
    mode: 'empty',
    subject: null,
    focused: false,
    lensOnly: false,
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
  // The strand's mark (G4): a press, a pull or Clear the strand redraws the frame, no keystroke needed.
  let lastMarkKey: string | null | undefined;

  /** The frame for the route's writing subject, or nothing. */
  function renderFrame(route: Route): void {
    strandHost.innerHTML = '';
    if (route.mode !== 'writing') return;
    const subject = resolveSubject(route, getState().data.elements);
    if (subject.detailsMode !== 'writing' || !subject.element) return;
    const frame = buildStrandFrame(subject.element);
    if (frame) strandHost.appendChild(frame);
  }
  let lastAppliedPrefs: ReturnType<typeof getWorldContextPrefs> | null = null;

  function routeKey(route: Route): string {
    return `${route.mode}|${route.narrativeId ?? ''}|${route.elementId ?? ''}|${route.knowledgeId ?? ''}|${route.knowerId ?? ''}|${route.pageId ?? ''}`;
  }

  /** Show or clear the anchor caption above the details slot. */
  function setCaption(text: string | null): void {
    captionHost.textContent = text ?? '';
    captionHost.dataset.state = text ? 'visible' : 'hidden';
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
    const prefs = getWorldContextPrefs();
    const prev = lastAppliedPrefs;
    // A lens chosen or cleared is a different picture: draw it whole.
    if (prev && prev.lens !== prefs.lens) {
      renderAll(parseHash(window.location.hash));
      return;
    }
    if (!graphHandle || !currentRender.subject) return;
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
    toolbarHandle?.update(toolbarState(graphHandle.getPresentTypes()));
  }

  /** The toolbar's whole state: the ring controls from the prefs, the lens chip from the world. */
  function toolbarState(presentTypes: ReadonlySet<ElementType>): Parameters<ContextToolbarHandle['update']>[0] {
    const p = getWorldContextPrefs();
    const subject = currentRender.subject;
    return {
      presentTypes,
      hiddenTypes: p.hidden,
      effectiveHop: subject ? effectiveHopFor(subject, p.hop) : 2,
      lockLayout: p.lockLayout,
      lens: toolbarLens(),
      lensOnly: currentRender.lensOnly,
    };
  }

  function toolbarLens(): ToolbarLens {
    const state = getState();
    const worldId = state.active?.worldId ?? null;
    const els = state.data.elements;
    const chosen = chosenLens(els, getWorldContextPrefs().lens);
    const subject = currentRender.lensOnly ? null : currentRender.subject;
    const field = chosen ? null : keepLensField(worldId, subject, currentRender.focused);
    return {
      chosen: chosen ? { id: chosen.id, name: lensName(chosen) } : null,
      choices: lensChoices(els),
      keep: field && subject && worldId
        ? { name: subject.name?.trim() || 'Unnamed', busy: keepingLens(worldId, subject.id) }
        : null,
      // Said only where Keep would otherwise be weighed: no lens chosen, an element the person opened.
      heldBack: !chosen && subject && currentRender.focused ? keepHeldBackLine(worldId) : null,
    };
  }

  /** Keep a lens on the Web's subject, then read the Web through it. */
  async function keepLens(): Promise<void> {
    const worldId = getState().active?.worldId;
    const subject = currentRender.subject;
    const field = keepLensField(worldId, subject, currentRender.focused);
    const store = getActiveStore();
    if (!worldId || !subject || !field || !store || keepingLens(worldId, subject.id)) return;
    const refreshToolbar = (): void => { toolbarHandle?.update(toolbarState(graphHandle?.getPresentTypes() ?? new Set())); };
    const name = subject.name?.trim() || 'Unnamed';
    const stillHere = (): boolean => getState().active?.worldId === worldId;
    // The cache is refreshed only while the world is still open: another world's list never lands on it (C9).
    const run = keepLensOn(worldId, subject, field, store, async () => { if (stillHere()) await refreshElementsAfterWrite(store); });
    refreshToolbar();
    try {
      const kept = await run;
      if (kept && stillHere()) {
        setWebLens(worldId, kept.id);
        toasts.success(kept.made
          ? `${kept.name} is a lens now. The Web is reading it.`
          : `${kept.name} already reads ${name}. The Web is reading it.`);
      }
    } catch (err) {
      showProblem(err, { doing: 'keeping the lens', toasts });
    } finally {
      refreshToolbar();
    }
  }

  function showEmpty(message: string): void {
    setCaption(null);
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
    /** The chosen lens's id as stored; `chosenLens` checks it before any reading. */
    lens: string | null;
  } {
    const state = getState();
    const worldId = state.active?.worldId;
    if (!worldId) return { hidden: new Set(), hop: undefined, lockLayout: false, edgeColor: false, lens: null };
    const entry = state.registry.worlds.find(w => w.id === worldId);
    const hidden = new Set<ElementType>((entry?.context_filters_off ?? []) as ElementType[]);
    const hop = entry?.context_hop_depth as HopDepth | undefined;
    const lockLayout = entry?.context_lock_layout === true;
    const edgeColor = entry?.context_edge_color === true;
    const lens = typeof entry?.context_lens === 'string' && entry.context_lens ? entry.context_lens : null;
    return { hidden, hop, lockLayout, edgeColor, lens };
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

    // A subject the person focused, not one the pane picked for a room (a caption says so).
    currentRender = {
      mode: subject.detailsMode, subject: subject.element,
      focused: !!subject.element && !subject.caption, lensOnly: false,
    };
    // Anchor caption rides with the subject (only anchored defaults set it).
    setCaption(subject.caption ?? null);

    const prefs = getWorldContextPrefs();
    // Seed prefs cache so the first state tick after mount doesn't re-apply.
    lastAppliedPrefs = prefs;
    const lensEl = chosenLens(state.data.elements, prefs.lens);
    const worldId = state.active?.worldId ?? null;

    function mountToolbar(): void {
      // Toolbar callbacks ONLY persist to the registry — the orchestrator's
      // syncPrefsToGraph picks up the change (via the state subscriber →
      // maybeRender) and applies it to the graph. Settings page edits land
      // here the same way.
      toolbarHandle = mountContextToolbar({
        host: toolbarHost,
        initial: toolbarState(graphHandle?.getPresentTypes() ?? new Set()),
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
        onChooseLens: (id) => { if (worldId) setWebLens(worldId, id); },
        onKeepLens: () => { void keepLens(); },
      });
      toolbarHost.dataset.state = 'visible';
    }

    /** The Web through the chosen lens, with its line; the subject named when it is not in it. */
    function lensOpt(subjectEl: Element | null) {
      if (!lensEl) return undefined;
      const picture = readLensPicture(lensEl);
      // A lens is never in its own reading: on its own page (Read this lens) the line names no subject (C2).
      const named = subjectEl && subjectEl.id !== lensEl.id ? subjectEl : null;
      const line = lensLine(picture, named
        ? { name: named.name?.trim() || 'This element', kept: picture.keptIds.includes(named.id) }
        : null);
      const title = picture.unreadableKey ? `The setting Atlas can't read: ${picture.unreadableKey}` : undefined;
      return { picture, line, title };
    }

    const handleGraphRender = (presentTypes: ReadonlySet<ElementType>): void => {
      toolbarHandle?.update(toolbarState(presentTypes));
    };

    // No subject: show empty state and bail. Distinguish "no focus yet" from
    // "focus resolves to nothing in current data". A chosen lens needs no
    // subject: it is drawn all the same, and the chip shows wherever the
    // world holds a lens to choose.
    if (subject.detailsMode === 'empty' || subject.element === null) {
      const message = subject.detailsMode === 'empty'
        ? emptyCopyForRoute(route)
        : (state.data.elements.length > 0 ? 'Element not found.' : 'Loading…');
      if (lensEl) {
        // With no page to preview on, a press opens the element's page, where the Web keeps the lens (C5).
        const openPressed = (id: string | null): void => { if (id && worldId) navigate(elementHash(worldId, id)); };
        currentRender = { ...currentRender, subject: null, focused: false, lensOnly: true };
        setCaption(null);
        graphHandle = mountContextGraph({
          host: graphSlot, subject: lensEl, onSelect: openPressed,
          lens: lensOpt(null), onRender: handleGraphRender,
        });
        mountToolbar();
        return;
      }
      showEmpty(message);
      if (worldId && lensChoices(state.data.elements).length > 0) {
        currentRender = { ...currentRender, lensOnly: true };
        mountToolbar();
      }
      return;
    }

    // Subject resolved — mount graph + toolbar.
    const subjectEl = subject.element;
    graphHandle = mountContextGraph({
      host: graphSlot,
      subject: subjectEl,
      onSelect,
      hiddenTypes: prefs.hidden,
      hopDepth: prefs.hop,
      lockLayout: prefs.lockLayout,
      edgeColor: prefs.edgeColor,
      onRender: handleGraphRender,
      lens: lensOpt(subjectEl),
    });
    mountToolbar();

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
    // The lore's identity moves with the elements and with the room's switch
    // (core/parlor-room.ts), so showing or hiding the room redraws the Web.
    const elements = currentLore();
    const nextKey = routeKey(route);
    const markKey = strandMarkKey(getState().active?.meta);
    if (nextKey !== lastRouteKey || elements !== lastElementsRef) {
      lastRouteKey = nextKey;
      lastElementsRef = elements;
      lastMarkKey = markKey;
      renderAll(route);
      renderFrame(route);
      return;
    }
    if (markKey !== lastMarkKey) {
      lastMarkKey = markKey;
      renderFrame(route);
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
    // writing mode: preview slides over the lists. element mode (element room
    // + knowledge entries): preview swaps content. Both via onSelect.
    if (currentRender.mode === 'writing' || currentRender.mode === 'element') onSelect(detail.id);
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
      return 'Add dates to your elements to chart them here.';
    case 'settings':
      return 'Element-focused view returns when you leave settings.';
    case 'knowledge':
      return getKnowledgeRoomTab() === 'knowers'
        ? 'Open a knower to see their world.'
        : 'Open a knowledge entry to see its holders and subjects.';
    case 'writing':
      return 'Create a narrative to see its connections here.';
    case 'share':
      return route.pageId
        ? 'Add an element to see the elements this page features.'
        : 'Open a page to see the elements it features.';
    case 'map':
      return 'Open an element or narrative to focus the graph.';
    default:
      return 'Open an element or narrative to see its connections.';
  }
}

