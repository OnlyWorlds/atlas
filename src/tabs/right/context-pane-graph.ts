/**
 * Force-directed graph for the context pane.
 *
 * Adapted from `tools/cos-browser/src/modes/browse/graph-view.ts`. Same shape:
 *   - Synchronous run-to-stable physics sim (no live animation churn)
 *   - DOM nodes for click + hover; canvas for edges
 *   - Center node = subject; cast (direct neighbors) = filled cyan;
 *     adjacent (1-hop) = outlined
 *
 * Subject can be any element: narrative (writing mode), character / location /
 * etc. (element mode). Tier-aware density rules apply only when the subject
 * is a narrative with a configured tier; non-narratives always get full
 * adjacency (cap 12).
 *
 * Capabilities:
 *   - **Click to recenter** — clicking any non-center node re-runs the sim
 *     with that element as the new center. A "← back to {subject}" pill
 *     appears; clicking it restores the original subject-centered view.
 *   - **Ctrl/Cmd+click** — navigates the middle pane to that element (URL
 *     changes; whole context pane re-renders with new subject).
 *   - **Hover fade** — hovering a node fades non-edge-sharing nodes.
 *   - **Resize handling** — ResizeObserver re-projects layout to the new host
 *     dimensions without re-running the sim.
 *
 * Tier-aware density (narrative subjects only):
 *   - Scene (l3) / Draft (l4): show cast + 1-hop adjacency, cap 12
 *   - Chapter (l2): show only direct cast, cap 6
 *   - Book (l1): show only direct cast, cap 4
 */

import { getState } from '../../core/state';
import type { Element, ElementType } from '../../core/types';
import { ELEMENT_ICONS, ELEMENT_TYPE_COLORS } from '../../core/constants';
import { navigate, elementHash } from '../../core/router';
import { getTierForNarrative } from '../../middle/writing-helpers';

export interface GraphHandle {
  /** Visually emphasize a node (or clear highlight when id is null). */
  highlight(elementId: string | null): void;
  /**
   * Pop one entry off the recent-centers stack. Returns true if a pop
   * happened (graph navigated back to a previous center). Returns false
   * when already at the subject (no-op). Consumed by the orchestrator's
   * mouse-back-button handler.
   */
  goBack(): boolean;
  /**
   * Update the set of element types to hide from the graph. Re-renders in
   * place; breadcrumb stack is preserved.
   */
  setHiddenTypes(hidden: ReadonlySet<ElementType>): void;
  /**
   * Set hop depth (1 = direct cast only; 2, 3, 4 = include successive
   * outward rings). `undefined` means "tier-derived" — for narrative
   * subjects scene/draft yields 2, chapter/book yields 1; for non-narrative
   * subjects yields 2.
   */
  setHopDepth(depth: HopDepth | undefined): void;
  /**
   * Update the lock-layout flag. Does NOT trigger a re-render — only affects
   * subsequent setHiddenTypes calls. When true, filter changes hide nodes
   * via CSS without re-running the sim. When false, filter changes re-run
   * the full sim (legacy default).
   */
  setLockLayout(locked: boolean): void;
  /**
   * Toggle per-type edge coloring. Re-renders edges only — no sim re-run,
   * no DOM swap, just a canvas redraw.
   */
  setEdgeColor(on: boolean): void;
  /**
   * Types present in the current candidate set (cast + adjacent, BEFORE
   * applying hiddenTypes filter). Toolbar reads this to decide which type
   * chips to render — chips persist even when their type is filtered out so
   * the user can re-enable them.
   */
  getPresentTypes(): ReadonlySet<ElementType>;
  /** Tear down listeners, canvas, DOM. */
  destroy(): void;
}

export interface GraphOpts {
  host: HTMLElement;
  /** The subject element — defines the "home" view of the graph. */
  subject: Element;
  /** Selection event consumed by lists + preview slide-in. */
  onSelect: (elementId: string | null) => void;
  /** Initial set of types to hide. Defaults to none. */
  hiddenTypes?: ReadonlySet<ElementType>;
  /** Initial hop depth. undefined = tier-derived. */
  hopDepth?: HopDepth;
  /**
   * If true, filter changes preserve the existing layout (hide via CSS, no
   * sim re-run). If false/absent (default), filter changes trigger a full
   * re-render with sim — surviving nodes redistribute over the canvas.
   */
  lockLayout?: boolean;
  /** Initial edge-coloring flag. Defaults to false (neutral cyan edges). */
  edgeColor?: boolean;
  /**
   * Fires after each render with the present-types set (pre-filter). Toolbar
   * uses this to update its chip list dynamically as the user recenters.
   */
  onRender?: (presentTypes: ReadonlySet<ElementType>) => void;
}

const PARAMS = {
  k_r: 14000,
  k_a: 0.10,
  k_g: 0.012,
  rest: 150,
  damping: 0.85,
  iters: 500,
  collisionPasses: 8,
  collisionMinDist: 56,
};

const NODE_DIAMETER = 36;

/**
 * Max node labels rendered at once. Above this, the label pass keeps the
 * highest-priority labels (center + selection + most-connected) and hides the
 * rest to stop a dense scene from becoming a label-colliding hairball (T-CX2);
 * hidden labels reveal on hover via CSS. Ported idea, not code, from the charts
 * label-priority pass.
 */
const LABEL_BUDGET = 14;
/**
 * The center node renders larger (CSS .is-center). The diameter used here
 * MUST match the CSS width/height or the node will sit off-center relative
 * to where the edges meet. Whenever you change one, change the other.
 */
const CENTER_NODE_DIAMETER = 44;

/** Hop depth — number of rings outward from the subject. */
export type HopDepth = 1 | 2 | 3 | 4;

/**
 * Per-ring cap. Ring 1 (cast) is uncapped; tighter caps for outer rings
 * keep dense worlds visually digestible. Tier-density may shrink ring 2
 * further (see RING2_CAP_CHAPTER / _BOOK).
 */
const RING_CAPS: Record<2 | 3 | 4, number> = { 2: 12, 3: 8, 4: 6 };
const RING2_CAP_CHAPTER = 6;
const RING2_CAP_BOOK = 4;

function diameterFor(n: { isCenter: boolean }): number {
  return n.isCenter ? CENTER_NODE_DIAMETER : NODE_DIAMETER;
}

interface SimNode {
  id: string;
  el: Element | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  isCenter: boolean;
  isCast: boolean;
}

interface SimEdge {
  fromId: string;
  toId: string;
}

const MULTI_LINK_FIELDS = [
  'characters', 'locations', 'objects', 'events', 'creatures',
  'species', 'institutions', 'collectives', 'phenomena', 'languages',
  'titles', 'traits', 'abilities', 'constructs', 'laws', 'families',
  'narratives', 'relations',
] as const;

function readMultiLink(el: Element, field: string): string[] {
  const raw = (el as Record<string, unknown>)[field];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item === 'object' && typeof (item as { id?: string }).id === 'string') {
      out.push((item as { id: string }).id);
    }
  }
  return out;
}

/**
 * Fields whose string values are never treated as single-link neighbors:
 * identity/sync metadata, and `parent_narrative` — the writing-tree hierarchy
 * lives in the sidebar; pulling parents into the flat context graph just adds
 * noise to every scene/chapter view.
 */
const SINGLE_LINK_SKIP_KEYS = new Set([
  'id', 'local_updated_at', 'server_updated_at', 'parent_narrative',
]);

/**
 * Plausible element-id shape — a 36-char hyphenated UUID. Keeps prose/text
 * field values out of the candidate set; final validity is the caller's
 * `byId.has` filter (same double-gate rationale as the engine's topo-sort).
 */
export function looksLikeId(v: string): boolean {
  return v.length === 36 && v.includes('-');
}

export function collectDirectNeighbors(el: Element): string[] {
  const seen = new Set<string>();
  for (const field of MULTI_LINK_FIELDS) {
    for (const id of readMultiLink(el, field)) {
      if (!seen.has(id)) seen.add(id);
    }
  }
  // Single-link fields too (narrator / protagonist / birthplace / location /
  // …) — generic id-shaped scan (convention #5). Without this, a knowledge
  // entry's narrator (its primary holder channel) and every other single-link
  // relation was invisible to the graph (session 235 fix).
  for (const [key, value] of Object.entries(el)) {
    if (SINGLE_LINK_SKIP_KEYS.has(key)) continue;
    if (typeof value === 'string') {
      if (looksLikeId(value)) seen.add(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const id = (value as { id?: unknown }).id;
      if (typeof id === 'string' && looksLikeId(id)) seen.add(id);
    }
  }
  seen.delete(el.id);
  return Array.from(seen);
}

export function mountContextGraph(opts: GraphOpts): GraphHandle {
  const { host, subject, onSelect, onRender } = opts;
  host.innerHTML = '';
  host.style.position = 'relative';

  // The "home" view is always the subject. `currentCenterId` may diverge from
  // `homeId` when the user click-recenters on another node.
  const homeId = subject.id;
  let currentCenterId = homeId;

  // User-controlled view options. hopDepth undefined = tier-derived default.
  let currentHopDepth: HopDepth | undefined = opts.hopDepth;
  let currentHiddenTypes: ReadonlySet<ElementType> = opts.hiddenTypes ?? new Set();
  let currentLockLayout = opts.lockLayout ?? false;
  let currentEdgeColor = opts.edgeColor ?? false;

  // User-applied transform on TOP of the fit-to-canvas base projection.
  // Wheel = scale (anchored at cursor); drag = translate; double-click /
  // fit-to-view button = reset. Resets whenever the user navigates to a new
  // center (renderForCenter); preserved across ResizeObserver re-projections.
  let userScale = 1;
  let userTx = 0;
  let userTy = 0;

  function resetUserTransform(): void {
    userScale = 1;
    userTx = 0;
    userTy = 0;
  }

  function userTransformIsIdentity(): boolean {
    return userScale === 1 && userTx === 0 && userTy === 0;
  }

  // Updated on each render — used by the toolbar to render type-filter chips
  // (pre-filter, so user can re-enable hidden types).
  let presentTypes: Set<ElementType> = new Set();

  // Recent-centers stack — does NOT include home (home is the implicit
  // leftmost anchor in the breadcrumb). Push on click-recenter; pop on
  // breadcrumb-click or goBack(). Stack length === breadcrumb depth.
  let centerStack: string[] = [];

  function pushCenter(id: string): void {
    if (id === homeId) {
      centerStack = [];
    } else if (centerStack[centerStack.length - 1] !== id) {
      centerStack.push(id);
    }
    // User navigated — fresh view; clear any zoom/pan they had on the old
    // center so the new center is fit-to-canvas.
    resetUserTransform();
    renderForCenter(id);
  }

  function jumpToBreadcrumbIndex(index: number): void {
    resetUserTransform();
    // index === -1 → home; 0..n → stack position.
    if (index < 0) {
      centerStack = [];
      renderForCenter(homeId);
    } else {
      centerStack = centerStack.slice(0, index + 1);
      renderForCenter(centerStack[index]);
    }
  }

  // Captured per render so resize can re-project without rebuilding.
  let lastNodes: SimNode[] = [];
  let lastEdges: SimEdge[] = [];
  let lastNeighborSets = new Map<string, Set<string>>();
  let lastNodeEls = new Map<string, HTMLElement>();
  let lastCanvas: HTMLCanvasElement | null = null;
  let lastHighlightedId: string | null = null;
  let resizeObserver: ResizeObserver | null = null;

  function findElement(id: string): Element | null {
    return getState().data.elements.find(e => e.id === id) ?? null;
  }

  function renderForCenter(centerId: string): void {
    currentCenterId = centerId;
    const centerEl = findElement(centerId);
    if (!centerEl) {
      host.innerHTML = '<div class="atlas-context-pane-empty">Element not found.</div>';
      return;
    }

    // Build sim inputs.
    const state = getState();
    const elements = state.data.elements;
    const byId = new Map<string, Element>();
    for (const e of elements) byId.set(e.id, e);

    // Tier-aware ring-2 cap. Ring 1 (cast) is uncapped; ring 2 narrows on
    // chapter/book narratives for visual clarity. Rings 3 and 4 use fixed
    // global caps (RING_CAPS) regardless of tier.
    let ring2Cap = RING_CAPS[2];
    let tierDefaultHop: HopDepth = 2;
    const worldId = state.active?.worldId ?? '';
    const tier = (centerEl.type === 'narrative' && worldId)
      ? getTierForNarrative(centerEl, worldId)
      : null;
    if (tier === 'l2') {
      tierDefaultHop = 1;
      ring2Cap = RING2_CAP_CHAPTER;
    } else if (tier === 'l1') {
      tierDefaultHop = 1;
      ring2Cap = RING2_CAP_BOOK;
    }
    const effectiveHop: HopDepth = currentHopDepth ?? tierDefaultHop;

    // Build rings outward from the subject. rings[0] = subject only; each
    // subsequent ring scores candidates by how many edges connect them back
    // to the previous ring, then takes the top-N per the cap.
    const allCastIds = collectDirectNeighbors(centerEl).filter(id => byId.has(id));
    const rings: string[][] = [[centerEl.id], allCastIds];
    const inAnyRing = new Set<string>([centerEl.id, ...allCastIds]);

    for (let depth = 2; depth <= effectiveHop; depth++) {
      const previousRing = rings[depth - 1];
      const cap = depth === 2 ? ring2Cap : RING_CAPS[depth as 3 | 4];
      const scores = new Map<string, number>();
      for (const prevId of previousRing) {
        const prevEl = byId.get(prevId);
        if (!prevEl) continue;
        for (const adj of collectDirectNeighbors(prevEl)) {
          if (inAnyRing.has(adj)) continue;
          if (!byId.has(adj)) continue;
          scores.set(adj, (scores.get(adj) ?? 0) + 1);
        }
      }
      const ring = Array.from(scores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, cap)
        .map(([id]) => id);
      rings.push(ring);
      for (const id of ring) inAnyRing.add(id);
    }

    // Compute present types BEFORE applying the hidden-types filter. The
    // toolbar reads this to render type chips; chips persist for hidden
    // types so the user can re-enable them.
    presentTypes = new Set<ElementType>();
    for (let r = 1; r < rings.length; r++) {
      for (const id of rings[r]) {
        const t = byId.get(id)?.type;
        if (t) presentTypes.add(t);
      }
    }

    // Apply hidden-types filter to derive the visible-per-ring sets.
    const isHidden = (id: string): boolean => {
      const t = byId.get(id)?.type;
      return t ? currentHiddenTypes.has(t) : false;
    };
    const visibleRings: string[][] = rings.map((r, idx) =>
      idx === 0 ? r : r.filter(id => !isHidden(id))
    );
    const visibleSet = new Set<string>();
    for (const r of visibleRings) for (const id of r) visibleSet.add(id);

    // Build sim nodes — radial seed positions per ring (sim relaxes them).
    const nodes: SimNode[] = [];
    const center: SimNode = {
      id: centerEl.id, el: centerEl,
      x: 0, y: 0, vx: 0, vy: 0,
      isCenter: true, isCast: false,
    };
    nodes.push(center);
    const ringRadius = (depth: number): number => 120 * depth;
    for (let d = 1; d < visibleRings.length; d++) {
      const ring = visibleRings[d];
      const radius = ringRadius(d);
      const baseAngle = d * Math.PI / 6; // offset rings so they don't align
      ring.forEach((id, i) => {
        const angle = baseAngle + (i / Math.max(1, ring.length)) * Math.PI * 2;
        nodes.push({
          id, el: byId.get(id) ?? null,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          vx: 0, vy: 0,
          isCenter: false,
          isCast: d === 1,
        });
      });
    }
    const idToNode = new Map<string, SimNode>();
    for (const n of nodes) idToNode.set(n.id, n);

    // Edges: every relation between two visible nodes draws once. Direction
    // doesn't matter for rendering, but we dedupe symmetric pairs by id
    // ordering so the canvas doesn't draw both A→B and B→A.
    const edges: SimEdge[] = [];
    const seenPair = new Set<string>();
    for (const id of visibleSet) {
      const el = byId.get(id);
      if (!el) continue;
      for (const adj of collectDirectNeighbors(el)) {
        if (!visibleSet.has(adj)) continue;
        const key = id < adj ? `${id}|${adj}` : `${adj}|${id}`;
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        edges.push({ fromId: id, toId: adj });
      }
    }

    // Run physics sim.
    runSim(nodes, edges, idToNode);

    // Compute per-node neighbor sets for hover-fade.
    const neighborSets = new Map<string, Set<string>>();
    for (const n of nodes) neighborSets.set(n.id, new Set([n.id]));
    for (const e of edges) {
      neighborSets.get(e.fromId)?.add(e.toId);
      neighborSets.get(e.toId)?.add(e.fromId);
    }

    // Paint.
    host.innerHTML = '';
    paint(host, nodes, edges, neighborSets);

    // Recent-centers breadcrumb — only renders when we've recentered away from
    // home. Home is the implicit leftmost chip; each stack entry is a clickable
    // chip; the current center is non-clickable text.
    if (centerStack.length > 0) {
      host.appendChild(buildBreadcrumb());
    }

    // Stash for resize re-projection + highlight reapply.
    lastNodes = nodes;
    lastEdges = edges;
    lastNeighborSets = neighborSets;
    if (lastHighlightedId) applyHighlightTo(lastNodeEls, lastHighlightedId);

    // Notify the orchestrator about the new present-types set so its toolbar
    // can render the matching chips.
    onRender?.(presentTypes);
  }

  function paint(
    target: HTMLElement,
    nodes: SimNode[],
    edges: SimEdge[],
    neighborSets: Map<string, Set<string>>,
  ): void {
    // Compute projection.
    const { offsetX, offsetY, scale, hostW, hostH } = effectiveProjection(nodes, target);

    // Canvas layer for edges.
    const canvas = document.createElement('canvas');
    canvas.width = hostW;
    canvas.height = hostH;
    canvas.className = 'atlas-context-graph-canvas';
    target.appendChild(canvas);
    lastCanvas = canvas;
    drawEdges(canvas, nodes, edges, offsetX, offsetY, scale);

    // DOM nodes.
    const nodeEls = new Map<string, HTMLElement>();
    for (const n of nodes) {
      const nodeEl = document.createElement('button');
      nodeEl.type = 'button';
      nodeEl.className = 'atlas-context-graph-node';
      if (n.isCenter) nodeEl.classList.add('is-center');
      else if (n.isCast) nodeEl.classList.add('is-cast');
      else nodeEl.classList.add('is-adjacent');
      nodeEl.dataset.elementId = n.id;
      const cx = n.x * scale + offsetX;
      const cy = n.y * scale + offsetY;
      const dia = diameterFor(n);
      nodeEl.style.left = `${cx - dia / 2}px`;
      nodeEl.style.top = `${cy - dia / 2}px`;
      const iconName = n.el ? (ELEMENT_ICONS[n.el.type] ?? 'category') : 'edit_note';
      const rawName = n.el?.name
        || (n.isCenter && n.id === homeId ? subject.name || '(home)' : '(unknown)');
      nodeEl.innerHTML =
        `<span class="material-symbols-outlined">${iconName}</span>` +
        `<span class="atlas-context-graph-node-label">${escapeHtml(rawName)}</span>`;
      // Native browser tooltip — name + first ~200 chars of description so
      // the writer can peek at "what is this" without clicking.
      const desc = typeof n.el?.description === 'string' ? n.el.description.trim() : '';
      const descSnippet = desc.length > 200 ? desc.slice(0, 197) + '…' : desc;
      nodeEl.title = descSnippet ? `${rawName}\n\n${descSnippet}` : rawName;

      nodeEl.addEventListener('click', (e) => {
        e.stopPropagation();
        // Ctrl/Cmd+click navigates to the element (leaves writing room).
        if (e.ctrlKey || e.metaKey) {
          const worldId = getState().active?.worldId;
          if (worldId) navigate(elementHash(worldId, n.id));
          return;
        }
        if (n.isCenter) {
          // Center node click: if we're on home, deselect; if we've recentered
          // elsewhere, clicking center is the same as picking that element
          // (already centered) → just emit select for the preview.
          if (n.id === homeId) {
            onSelect(null);
          } else {
            onSelect(n.id);
          }
          return;
        }
        // Non-center click: recenter the graph on this element AND select it
        // in the lists/preview. The lists themselves don't change (they stay
        // tied to home). Pushes a new entry onto the breadcrumb trail.
        pushCenter(n.id);
        onSelect(n.id);
      });

      // Hover fade — fade all nodes that don't share an edge with the hovered.
      nodeEl.addEventListener('mouseenter', () => applyHoverFade(target, n.id, neighborSets));
      nodeEl.addEventListener('mouseleave', () => clearHoverFade(target));

      // Right-click menu — quick actions for the node. Suppress the native
      // browser context menu so our menu wins.
      nodeEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openNodeMenu(n, e.clientX, e.clientY);
      });

      target.appendChild(nodeEl);
      nodeEls.set(n.id, nodeEl);
    }

    lastNodeEls = nodeEls;
    applyLabelBudget(nodeEls, nodes, neighborSets);
  }

  /**
   * Label-priority pass (T-CX2). On dense graphs, keep only the highest-value
   * labels visible: the anchor (center) and the currently-selected node always
   * win; the remaining budget fills by degree (most-connected first). Everyone
   * else hides their label (CSS reveals it on hover). No-op under the budget.
   */
  function applyLabelBudget(
    nodeEls: Map<string, HTMLElement>,
    nodes: SimNode[],
    neighborSets: Map<string, Set<string>>,
  ): void {
    if (nodes.length <= LABEL_BUDGET) {
      for (const el of nodeEls.values()) el.classList.remove('is-label-hidden');
      return;
    }
    const alwaysShow = new Set<string>();
    for (const n of nodes) if (n.isCenter) alwaysShow.add(n.id);
    if (lastHighlightedId) alwaysShow.add(lastHighlightedId);
    const slots = Math.max(0, LABEL_BUDGET - alwaysShow.size);
    const ranked = nodes
      .filter(n => !alwaysShow.has(n.id))
      .map(n => ({ id: n.id, degree: (neighborSets.get(n.id)?.size ?? 1) - 1 }))
      .sort((a, b) => b.degree - a.degree);
    const show = new Set<string>(alwaysShow);
    for (let i = 0; i < ranked.length && i < slots; i++) show.add(ranked[i].id);
    for (const [id, el] of nodeEls) {
      el.classList.toggle('is-label-hidden', !show.has(id));
    }
  }

  /**
   * Base fit-to-canvas projection — derived purely from node positions and
   * the host's dimensions. User zoom/pan is applied ON TOP (see
   * `effectiveProjection`).
   */
  function computeProjection(nodes: SimNode[], target: HTMLElement): {
    offsetX: number; offsetY: number; scale: number; hostW: number; hostH: number;
  } {
    let minX = -100, maxX = 100, minY = -100, maxY = 100;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    const padding = 50;
    const layoutW = (maxX - minX) + padding * 2;
    const layoutH = (maxY - minY) + padding * 2;
    const rect = target.getBoundingClientRect();
    const hostW = rect.width || 320;
    const hostH = rect.height || 240;
    const scale = Math.min(hostW / layoutW, hostH / layoutH, 1.4);
    const offsetX = hostW / 2 - ((minX + maxX) / 2) * scale;
    const offsetY = hostH / 2 - ((minY + maxY) / 2) * scale;
    return { offsetX, offsetY, scale, hostW, hostH };
  }

  /**
   * Compose base fit projection with the user's zoom/pan. The user transform
   * is applied AFTER base: `finalX = baseHostX * userScale + userTx`. World
   * point W lands at: `finalX = (W.x * baseScale + baseOffsetX) * userScale + userTx`,
   * which simplifies to `W.x * (baseScale * userScale) + (baseOffsetX * userScale + userTx)`.
   * Cursor-anchored zoom uses this two-stage model to keep the world point
   * under the cursor invariant across scale changes.
   */
  function effectiveProjection(nodes: SimNode[], target: HTMLElement): {
    offsetX: number; offsetY: number; scale: number; hostW: number; hostH: number;
  } {
    const base = computeProjection(nodes, target);
    return {
      scale: base.scale * userScale,
      offsetX: base.offsetX * userScale + userTx,
      offsetY: base.offsetY * userScale + userTy,
      hostW: base.hostW,
      hostH: base.hostH,
    };
  }

  function drawEdges(
    canvas: HTMLCanvasElement,
    nodes: SimNode[],
    edges: SimEdge[],
    offsetX: number,
    offsetY: number,
    scale: number,
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 1;
    const defaultStroke = 'rgba(34, 211, 238, 0.25)';
    const idToNode = new Map<string, SimNode>();
    for (const n of nodes) idToNode.set(n.id, n);
    for (const e of edges) {
      const a = idToNode.get(e.fromId);
      const b = idToNode.get(e.toId);
      if (!a || !b) continue;
      ctx.strokeStyle = currentEdgeColor
        ? edgeStrokeFor(a, b)
        : defaultStroke;
      ctx.beginPath();
      ctx.moveTo(a.x * scale + offsetX, a.y * scale + offsetY);
      ctx.lineTo(b.x * scale + offsetX, b.y * scale + offsetY);
      ctx.stroke();
    }
  }

  /**
   * Pick a per-edge stroke color when edge-coloring is on. Strategy: take
   * the non-center node's type (radial edges). For non-radial edges (between
   * two non-center nodes), use the `to` node deterministically. Apply at
   * 0.45 alpha so the color is visible without dominating.
   */
  function edgeStrokeFor(a: SimNode, b: SimNode): string {
    const peripheral = a.isCenter ? b : (b.isCenter ? a : b);
    const t = peripheral.el?.type as ElementType | undefined;
    const hex = t ? ELEMENT_TYPE_COLORS[t] : null;
    return hex ? hexToRgba(hex, 0.45) : 'rgba(34, 211, 238, 0.25)';
  }

  function applyHoverFade(target: HTMLElement, hoveredId: string, neighborSets: Map<string, Set<string>>): void {
    const neighbors = neighborSets.get(hoveredId) ?? new Set<string>();
    target.querySelectorAll<HTMLElement>('.atlas-context-graph-node').forEach((el) => {
      const id = el.dataset.elementId;
      if (!id) return;
      el.classList.toggle('is-faded', !neighbors.has(id));
    });
  }

  function clearHoverFade(target: HTMLElement): void {
    target.querySelectorAll<HTMLElement>('.atlas-context-graph-node.is-faded').forEach((el) => {
      el.classList.remove('is-faded');
    });
  }

  function applyHighlightTo(nodeEls: Map<string, HTMLElement>, elementId: string | null): void {
    nodeEls.forEach((el, id) => {
      el.classList.toggle('is-highlighted', id === elementId);
    });
  }

  function reprojectOnResize(): void {
    paintFromState();
  }

  /**
   * Repaint canvas + reposition DOM nodes from cached `lastNodes`/`lastEdges`,
   * without re-running the sim. Used by ResizeObserver (host dimensions
   * changed) AND by user-transform changes (wheel zoom, drag pan). Respects
   * the current hidden-types filter so locked-layout filter toggles only
   * have to clear `display: none` and call here for the edge redraw to
   * apply.
   */
  function paintFromState(): void {
    if (lastNodes.length === 0) return;
    const { offsetX, offsetY, scale, hostW, hostH } = effectiveProjection(lastNodes, host);
    if (lastCanvas) {
      lastCanvas.width = hostW;
      lastCanvas.height = hostH;
      // Edges between visible-to-visible only when lock-layout is active and
      // some types are hidden. Otherwise lastEdges already matches the visible
      // node set (full re-render path).
      const visibleEdges = currentLockLayout && currentHiddenTypes.size > 0
        ? filterEdgesToVisibleNodes(lastEdges)
        : lastEdges;
      drawEdges(lastCanvas, lastNodes, visibleEdges, offsetX, offsetY, scale);
    }
    for (const n of lastNodes) {
      const el = lastNodeEls.get(n.id);
      if (!el) continue;
      const cx = n.x * scale + offsetX;
      const cy = n.y * scale + offsetY;
      const dia = diameterFor(n);
      el.style.left = `${cx - dia / 2}px`;
      el.style.top = `${cy - dia / 2}px`;
    }
    ensureFitButton();
  }

  /**
   * Fit-to-view button — shown in the bottom-right corner of the graph host
   * only when the user has applied a non-identity zoom/pan. Clicking resets.
   * Idempotent: removes the existing button before deciding whether to add.
   */
  function ensureFitButton(): void {
    const existing = host.querySelector('.atlas-context-graph-fit');
    if (existing) existing.remove();
    if (userTransformIsIdentity()) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-context-graph-fit';
    btn.title = 'Reset zoom + pan (or double-click empty space)';
    btn.innerHTML = '<span class="material-symbols-outlined">center_focus_strong</span>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      resetUserTransform();
      paintFromState();
    });
    host.appendChild(btn);
  }

  function filterEdgesToVisibleNodes(edges: SimEdge[]): SimEdge[] {
    const elements = getState().data.elements;
    const typeOf = (id: string): ElementType | null => {
      const e = elements.find(x => x.id === id);
      return e ? (e.type as ElementType) : null;
    };
    const visible = new Set<string>();
    for (const n of lastNodes) {
      const t = typeOf(n.id);
      if (!t || !currentHiddenTypes.has(t)) visible.add(n.id);
    }
    return edges.filter(e => visible.has(e.fromId) && visible.has(e.toId));
  }

  // ----------------------------------------------------------------
  // Host-level interaction handlers (zoom / pan / fit / deselect).
  // Attached once at mount; survive paint cycles which only wipe inner DOM.
  // ----------------------------------------------------------------

  let dragActive = false;
  let dragOriginX = 0;
  let dragOriginY = 0;
  let dragMoved = false;
  let suppressNextClick = false;

  function isBackgroundTarget(t: EventTarget | null): boolean {
    return t === host || t === lastCanvas;
  }

  // Empty-background click deselects (only meaningful for the writing-mode
  // preview slide-in). Suppressed when the click follows a drag pan.
  host.addEventListener('click', (e) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    if (!isBackgroundTarget(e.target)) return;
    onSelect(null);
  });

  // Mouse wheel → zoom anchored at cursor. preventDefault so the scroll
  // doesn't bubble to the pane container. Always intercepts within the
  // graph host (nodes + background both zoom).
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = host.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nextScale = Math.max(0.3, Math.min(5, userScale * factor));
    const actual = nextScale / userScale;
    // Cursor-anchored: keep the host-space point at the cursor invariant.
    userTx = cx - (cx - userTx) * actual;
    userTy = cy - (cy - userTy) * actual;
    userScale = nextScale;
    paintFromState();
  };
  host.addEventListener('wheel', onWheel, { passive: false });

  // Drag-pan on empty background (left button only).
  host.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (!isBackgroundTarget(e.target)) return;
    dragActive = true;
    dragMoved = false;
    dragOriginX = e.clientX;
    dragOriginY = e.clientY;
    host.style.cursor = 'grabbing';
  });
  const onDocMouseMove = (e: MouseEvent): void => {
    if (!dragActive) return;
    const dx = e.clientX - dragOriginX;
    const dy = e.clientY - dragOriginY;
    if (!dragMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) dragMoved = true;
    if (dragMoved) {
      userTx += e.movementX;
      userTy += e.movementY;
      paintFromState();
    }
  };
  const onDocMouseUp = (): void => {
    if (!dragActive) return;
    dragActive = false;
    host.style.cursor = '';
    if (dragMoved) suppressNextClick = true;
    dragMoved = false;
  };
  document.addEventListener('mousemove', onDocMouseMove);
  document.addEventListener('mouseup', onDocMouseUp);

  // Double-click on empty background → reset to fit-to-canvas.
  host.addEventListener('dblclick', (e) => {
    if (!isBackgroundTarget(e.target)) return;
    e.preventDefault();
    resetUserTransform();
    paintFromState();
  });

  // Initial render.
  renderForCenter(homeId);

  // ResizeObserver — re-project layout when the host resizes (right-pane drag).
  // Coalesce via requestAnimationFrame so multiple rapid resize events trigger
  // at most one reproject per frame.
  let resizeRaf: number | null = null;
  resizeObserver = new ResizeObserver(() => {
    if (resizeRaf !== null) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      reprojectOnResize();
    });
  });
  resizeObserver.observe(host);

  // Module-scoped reference to the currently-open node menu so we can
  // dismiss it on outside-click / scroll / new menu open.
  let openMenu: HTMLElement | null = null;

  function closeNodeMenu(): void {
    if (!openMenu) return;
    openMenu.remove();
    openMenu = null;
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onMenuKey, true);
  }

  function onDocMouseDown(e: MouseEvent): void {
    if (!openMenu) return;
    if (openMenu.contains(e.target as Node)) return;
    closeNodeMenu();
  }
  function onMenuKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      closeNodeMenu();
      e.preventDefault();
    }
  }

  function openNodeMenu(n: SimNode, clientX: number, clientY: number): void {
    closeNodeMenu();

    const menu = document.createElement('div');
    menu.className = 'atlas-context-graph-node-menu';
    // Initial position — adjusted below to keep inside viewport.
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;

    const worldId = getState().active?.worldId ?? null;
    const isSubjectNarrative = subject.type === 'narrative';
    const isSubjectNode = n.id === homeId;

    // Open as element — always available (navigates to element-detail).
    addMenuItem(menu, 'visibility', 'Open as element', () => {
      if (worldId) navigate(elementHash(worldId, n.id));
    });

    // Copy ID — clipboard write. Permission-denied silently swallowed.
    addMenuItem(menu, 'content_copy', 'Copy ID', () => {
      try {
        void navigator.clipboard?.writeText(n.id);
      } catch {
        /* ignore — clipboard may be unavailable in some contexts */
      }
    });

    // Add to story — writing mode AND not the subject itself.
    if (isSubjectNarrative && !isSubjectNode && n.el) {
      addMenuItem(menu, 'add', 'Add to story', () => {
        document.dispatchEvent(new CustomEvent('atlas:context-add-to-cast', {
          detail: { id: n.id, type: n.el!.type, name: n.el!.name ?? '' },
        }));
      });
    }

    document.body.appendChild(menu);
    openMenu = menu;

    // Clamp position inside viewport. Measure after attach so dimensions are
    // known.
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw - 8) menu.style.left = `${Math.max(8, vw - rect.width - 8)}px`;
    if (rect.bottom > vh - 8) menu.style.top = `${Math.max(8, vh - rect.height - 8)}px`;

    // Defer attach of dismiss listeners so the right-click that opened us
    // doesn't immediately fire onDocMouseDown and close.
    queueMicrotask(() => {
      document.addEventListener('mousedown', onDocMouseDown, true);
      document.addEventListener('keydown', onMenuKey, true);
    });
  }

  function addMenuItem(menu: HTMLElement, icon: string, label: string, onClick: () => void): void {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'atlas-context-graph-node-menu-item';
    item.innerHTML =
      `<span class="material-symbols-outlined">${icon}</span>` +
      `<span>${escapeHtml(label)}</span>`;
    item.addEventListener('click', () => {
      onClick();
      closeNodeMenu();
    });
    menu.appendChild(item);
  }

  /**
   * Apply the current hidden-types filter to the EXISTING nodes/edges
   * without re-running the physics sim. Used when lockLayout is on so that
   * toggling chips doesn't make surviving nodes jump.
   *
   * Hides nodes via `display: none` and redraws the canvas with only the
   * edges between visible nodes. The presentTypes set is unchanged (still
   * derived from candidate set, regardless of filter state).
   */
  function applyFiltersWithoutResim(): void {
    if (!lastCanvas || lastNodes.length === 0) return;
    const elements = getState().data.elements;
    const isHidden = (id: string): boolean => {
      const t = elements.find(x => x.id === id)?.type as ElementType | undefined;
      return t ? currentHiddenTypes.has(t) : false;
    };
    // Toggle DOM visibility on each existing node.
    for (const n of lastNodes) {
      const el = lastNodeEls.get(n.id);
      if (!el) continue;
      el.style.display = isHidden(n.id) ? 'none' : '';
    }
    // Redraw edges + reapply node positions via the shared paint path so the
    // user's zoom/pan transform is respected.
    paintFromState();

    // Notify orchestrator — presentTypes set is unchanged, but we surface
    // it so toolbar state stays consistent if anything was relying on the
    // tick.
    onRender?.(presentTypes);
  }

  function buildBreadcrumb(): HTMLElement {
    const trail = document.createElement('div');
    trail.className = 'atlas-context-graph-trail';

    // Home chip — always shown when the trail is rendered.
    const homeChip = document.createElement('button');
    homeChip.type = 'button';
    homeChip.className = 'atlas-context-graph-trail-chip';
    homeChip.title = `Back to ${subject.name || '(home)'}`;
    homeChip.dataset.trailIndex = '-1';
    homeChip.innerHTML =
      `<span class="material-symbols-outlined">home</span>` +
      `<span>${escapeHtml(subject.name || '(home)')}</span>`;
    homeChip.addEventListener('click', (e) => {
      e.stopPropagation();
      jumpToBreadcrumbIndex(-1);
      onSelect(null);
    });
    trail.appendChild(homeChip);

    // Stack entries. Last one = current = non-clickable.
    centerStack.forEach((id, idx) => {
      const sep = document.createElement('span');
      sep.className = 'atlas-context-graph-trail-sep';
      sep.textContent = '›';
      trail.appendChild(sep);

      const el = findElement(id);
      const label = el?.name || '(unknown)';
      const isCurrent = idx === centerStack.length - 1;
      if (isCurrent) {
        const cur = document.createElement('span');
        cur.className = 'atlas-context-graph-trail-current';
        cur.textContent = label;
        cur.title = label;
        trail.appendChild(cur);
      } else {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'atlas-context-graph-trail-chip';
        chip.title = `Back to ${label}`;
        chip.dataset.trailIndex = String(idx);
        chip.textContent = label;
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          jumpToBreadcrumbIndex(idx);
          onSelect(id);
        });
        trail.appendChild(chip);
      }
    });
    return trail;
  }

  return {
    highlight(elementId: string | null): void {
      lastHighlightedId = elementId;
      applyHighlightTo(lastNodeEls, elementId);
    },
    goBack(): boolean {
      if (centerStack.length === 0) return false;
      // Pop one entry and re-render at the new tail (or home if empty).
      centerStack.pop();
      const nextCenter = centerStack.length > 0
        ? centerStack[centerStack.length - 1]
        : homeId;
      resetUserTransform();
      renderForCenter(nextCenter);
      // Synthesize a selection event so preview/lists re-sync to the new
      // center. Null on home (writing mode hides preview, element mode
      // reverts to subject).
      if (nextCenter === homeId) onSelect(null);
      else onSelect(nextCenter);
      return true;
    },
    setHiddenTypes(hidden: ReadonlySet<ElementType>): void {
      currentHiddenTypes = hidden;
      if (currentLockLayout && lastNodes.length > 0) {
        applyFiltersWithoutResim();
      } else {
        renderForCenter(currentCenterId);
      }
    },
    setHopDepth(depth: HopDepth | undefined): void {
      currentHopDepth = depth;
      // Hop depth always re-renders — changing hop adds/removes whole node
      // rings, which is fundamentally different from filter visibility.
      renderForCenter(currentCenterId);
    },
    setLockLayout(locked: boolean): void {
      currentLockLayout = locked;
      // No re-render — only affects subsequent setHiddenTypes calls.
    },
    setEdgeColor(on: boolean): void {
      currentEdgeColor = on;
      // Edge-color is a visual-only flag — repaint canvas + reposition nodes
      // via paintFromState (no sim, no DOM rebuild).
      paintFromState();
    },
    getPresentTypes(): ReadonlySet<ElementType> {
      return presentTypes;
    },
    destroy(): void {
      closeNodeMenu();
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (resizeRaf !== null) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = null;
      }
      document.removeEventListener('mousemove', onDocMouseMove);
      document.removeEventListener('mouseup', onDocMouseUp);
      host.innerHTML = '';
    },
  };
}

function runSim(nodes: SimNode[], edges: SimEdge[], idToNode: Map<string, SimNode>): void {
  for (let iter = 0; iter < PARAMS.iters; iter++) {
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const dx = nodes[b].x - nodes[a].x;
        const dy = nodes[b].y - nodes[a].y;
        const d2 = dx * dx + dy * dy + 0.01;
        const f = PARAMS.k_r / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        if (!nodes[a].isCenter) { nodes[a].vx -= fx; nodes[a].vy -= fy; }
        if (!nodes[b].isCenter) { nodes[b].vx += fx; nodes[b].vy += fy; }
      }
    }
    for (const e of edges) {
      const a = idToNode.get(e.fromId);
      const b = idToNode.get(e.toId);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = PARAMS.k_a * (d - PARAMS.rest);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      if (!a.isCenter) { a.vx += fx; a.vy += fy; }
      if (!b.isCenter) { b.vx -= fx; b.vy -= fy; }
    }
    for (const n of nodes) {
      if (n.isCenter) continue;
      n.vx -= n.x * PARAMS.k_g;
      n.vy -= n.y * PARAMS.k_g;
    }
    for (const n of nodes) {
      if (n.isCenter) continue;
      n.vx *= PARAMS.damping;
      n.vy *= PARAMS.damping;
      n.x += n.vx;
      n.y += n.vy;
    }
  }
  // Collision relaxation post-sim.
  for (let pass = 0; pass < PARAMS.collisionPasses; pass++) {
    let moved = false;
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const dx = nodes[b].x - nodes[a].x;
        const dy = nodes[b].y - nodes[a].y;
        const d2 = dx * dx + dy * dy;
        const min = PARAMS.collisionMinDist;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const overlap = (min - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        if (!nodes[a].isCenter) { nodes[a].x -= nx * overlap; nodes[a].y -= ny * overlap; }
        if (!nodes[b].isCenter) { nodes[b].x += nx * overlap; nodes[b].y += ny * overlap; }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Convert a `#rrggbb` hex string to an `rgba(r, g, b, alpha)` string.
 * Falls back to a neutral cyan if the hex is malformed. Used by the
 * edge-coloring path to apply alpha to the element-type palette.
 */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return `rgba(34, 211, 238, ${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
