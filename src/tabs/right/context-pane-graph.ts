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
import type { Element, ElementType, Marker, Pin } from '../../core/types';
import { ELEMENT_ICONS, ELEMENT_TYPE_COLORS } from '../../core/constants';
import { navigate, elementHash } from '../../core/router';
import { getTierForNarrative } from '../../middle/writing-helpers';
import { escapeText } from '../../core/dom-utils';
import { placeGraphLabels, GRAPH_LABEL_SIDES, type GraphLabelItem } from './graph-labels';
import { currentLore, isRoomElement } from '../../core/parlor-room';
import { proposedMarkOf, proposedTitle, proposedWord } from '../../core/review-mark';
import { hiddenMarkLine } from '../../core/hidden-mark';

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
  collisionPasses: 16,
  collisionMinDist: 64,
  maxStep: 20,
  /**
   * Hemisphere bias for ring 1: a constant downward push on backlink
   * nodes and an equal upward push on the subject's own links, so the two
   * halves of the ring settle above and below the center. Against the k_g
   * spring the equilibrium offset is k_h / k_g, about 75px, which reads as
   * "linked from below" without pinning anything to a fixed slot.
   */
  k_h: 0.9,
};

const NODE_DIAMETER = 36;

/**
 * The center node renders larger (CSS .is-center). The diameter used here
 * MUST match the CSS width/height or the node will sit off-center relative
 * to where the edges meet. Whenever you change one, change the other.
 */
const CENTER_NODE_DIAMETER = 44;

/** Hop depth — number of rings outward from the subject. */
export type HopDepth = 1 | 2 | 3 | 4;

/**
 * Per-ring cap. Tighter caps for outer rings keep dense worlds visually
 * digestible. Tier-density may shrink ring 2 further (see RING2_CAP_CHAPTER /
 * _BOOK). Ring 1 was once uncapped: a Map's backlinks are
 * every pin and marker on it, and the sim is O(iters x n^2), so a Sikelia map
 * stalled the tab. Ring 1 now keeps its RING_CAPS[1] most connected; the
 * legend says how many were left out.
 */
const RING_CAPS: Record<1 | 2 | 3 | 4, number> = { 1: 60, 2: 12, 3: 8, 4: 6 };
const RING2_CAP_CHAPTER = 6;
const RING2_CAP_BOOK = 4;

/**
 * Layout memo. The context tab remounts the graph on every
 * elements swap (each edit, each autosave), and the sim is deterministic in
 * its inputs, so a node + edge set already laid out reuses its positions.
 * Module-level so it survives the remount; a few entries cover recenters.
 */
const LAYOUT_MEMO_MAX = 8;
const layoutMemo = new Map<string, Array<[number, number]>>();
let simRuns = 0;
/** Test seam: how many times the physics sim has actually run. */
export function contextGraphSimRuns(): number { return simRuns; }
let lastLayout: Array<{ id: string; x: number; y: number; isCenter: boolean }> = [];
/** Test seam: the last laid-out nodes, in sim units (the center at 0,0). */
export function contextGraphLastLayout(): ReadonlyArray<{ id: string; x: number; y: number; isCenter: boolean }> { return lastLayout; }
/** Test seam: the sim's collision distance and the center label slot it keeps clear. */
export function contextGraphLayoutRules(centerName: string): { minDist: number; slot: { halfW: number; top: number; bottom: number } } {
  return { minDist: PARAMS.collisionMinDist, slot: centerLabelSlotFor(centerName) };
}
/** Test seam: forget memoised layouts. */
export function clearContextGraphLayoutMemo(): void { layoutMemo.clear(); }

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
  /**
   * Ring-1 node that links TO the center without the center linking back.
   * Rendered muted with an arrow into the center; seeded and biased
   * into the lower hemisphere. A mutual link is cast, never backlink.
   */
  isBacklink: boolean;
}

interface SimEdge {
  /** The element whose field carries the link. */
  fromId: string;
  /** The element it points at. */
  toId: string;
  /** True when the reverse link also exists (drawn as a plain line). */
  mutual: boolean;
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
  // relation was invisible to the graph.
  for (const [key, value] of Object.entries(el)) {
    if (SINGLE_LINK_SKIP_KEYS.has(key)) continue;
    if (typeof value === 'string') {
      if (looksLikeId(value)) seen.add(value);
    } else if (Array.isArray(value)) {
      // Multi-links OUTSIDE the named list: `governs`, `populations`,
      // `holders`, `allies`, `members`... the schema has dozens of multi-link
      // names and the list above holds eighteen. A family that `governs` a
      // regime was invisible to the regime's web. Any array of id-shaped
      // strings is a link list; the caller's `byId` filter still decides.
      for (const item of value) {
        if (typeof item === 'string' && looksLikeId(item)) seen.add(item);
      }
    } else if (value && typeof value === 'object') {
      const id = (value as { id?: unknown }).id;
      if (typeof id === 'string' && looksLikeId(id)) seen.add(id);
    }
  }
  seen.delete(el.id);
  return Array.from(seen);
}

/**
 * Reverse adjacency for a world: for every element id, the ids of elements
 * whose fields point at it. Built once per render from the same
 * `collectDirectNeighbors` read that draws the forward edges, so a link
 * counts in exactly one direction per pair and the two never disagree.
 * O(N × fields) over the loaded world; a 600-element world is well under a
 * millisecond.
 */
export function buildReverseIndex(elements: readonly Element[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const el of elements) {
    for (const target of collectDirectNeighbors(el)) {
      let set = out.get(target);
      if (!set) { set = new Set(); out.set(target, set); }
      set.add(el.id);
    }
  }
  return out;
}

/** Ids of elements linking TO `targetId`, excluding itself. Test seam. */
export function collectIncomingNeighbors(targetId: string, elements: readonly Element[]): string[] {
  const set = buildReverseIndex(elements).get(targetId);
  if (!set) return [];
  set.delete(targetId);
  return Array.from(set);
}

/**
 * The web's links, with pins and markers read as what they join (#185,
 * conv. 138). A pin joins a map to the place it marks and a marker joins a map
 * to its zone, so neither is drawn as a node of its own: each becomes a
 * two-way link between its two ends, and a zone's markers become ONE link. The
 * Space Map's web at depth 2 was 73 nodes, 67 of them pins and markers. A pin
 * or marker missing either end links nothing (the lists under the web still
 * name it), and a link INTO a pin or marker is dropped. The center keeps its
 * own links when it is a pin or marker itself. Pure; built once per render.
 */
export interface WebLinks {
  /** id → ids it links to. */
  out: Map<string, Set<string>>;
  /** id → ids that link to it. */
  inc: Map<string, Set<string>>;
  /** `${mapId}|${zoneId}` → how many markers draw that zone on that map. */
  markerCounts: Map<string, number>;
}

const NO_LINKS: ReadonlySet<string> = new Set();

function isSpatial(el: Element | undefined): boolean {
  return el?.type === 'pin' || el?.type === 'marker';
}

export function buildWebLinks(elements: readonly Element[], centerId: string): WebLinks {
  const byId = new Map<string, Element>();
  for (const e of elements) byId.set(e.id, e);
  const out = new Map<string, Set<string>>();
  const inc = new Map<string, Set<string>>();
  const markerCounts = new Map<string, number>();
  const add = (from: string, to: string): void => {
    if (from === to) return;
    let o = out.get(from);
    if (!o) { o = new Set(); out.set(from, o); }
    o.add(to);
    let i = inc.get(to);
    if (!i) { i = new Set(); inc.set(to, i); }
    i.add(from);
  };
  for (const el of elements) {
    if (isSpatial(el) && el.id !== centerId) {
      const mapId = (el as Pin | Marker).map_id;
      const otherId = el.type === 'pin' ? (el as Pin).element_id : (el as Marker).zone_id;
      const map = typeof mapId === 'string' ? byId.get(mapId) : undefined;
      const other = typeof otherId === 'string' ? byId.get(otherId) : undefined;
      if (!map || !other || isSpatial(map) || isSpatial(other) || map.id === other.id) continue;
      add(map.id, other.id);
      add(other.id, map.id);
      if (el.type === 'marker') {
        const key = `${map.id}|${other.id}`;
        markerCounts.set(key, (markerCounts.get(key) ?? 0) + 1);
      }
      continue;
    }
    for (const t of collectDirectNeighbors(el)) {
      const target = byId.get(t);
      if (!target || (isSpatial(target) && t !== centerId)) continue;
      add(el.id, t);
    }
  }
  return { out, inc, markerCounts };
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
  let lastMarkerCounts = new Map<string, number>();
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
    // A lore element's web leaves the parlor's room out while it is hidden
    // (core/parlor-room.ts); a room element's web reads the whole world.
    const elements = isRoomElement(centerEl) ? state.data.elements : currentLore();
    const byId = new Map<string, Element>();
    for (const e of elements) byId.set(e.id, e);

    // Tier-aware ring-2 cap. Ring 2 narrows on chapter/book narratives for
    // visual clarity. Rings 1, 3 and 4 use fixed global caps (RING_CAPS)
    // regardless of tier.
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
    //
    // Ring 1 is the UNION of both directions (Titus's ask): what the
    // subject links to (cast) plus everything that links to the subject
    // (backlinks). An element that is only ever pointed at, a regime named
    // by ten titles and three houses, used to draw an empty web.
    // Pins and markers are read as the links they make (#185, conv. 138).
    const links = buildWebLinks(elements, centerEl.id);
    lastMarkerCounts = links.markerCounts;
    const outOf = (id: string): ReadonlySet<string> => links.out.get(id) ?? NO_LINKS;
    const allCastIds = Array.from(outOf(centerEl.id));
    const castSet = new Set(allCastIds);
    const backlinkIds = Array.from(links.inc.get(centerEl.id) ?? [])
      .filter(id => !castSet.has(id));
    const backlinkSet = new Set(backlinkIds);
    const ring1All = [...allCastIds, ...backlinkIds];
    const inAnyRing = new Set<string>([centerEl.id, ...ring1All]);
    // Outer rings walk the web undirected: a backlink's own links and
    // linkers are as much "one hop out" as a cast member's.
    const undirected = (id: string): string[] => {
      const inc = links.inc.get(id);
      return inc ? [...outOf(id), ...inc] : Array.from(outOf(id));
    };
    const isHidden = (id: string): boolean => {
      const t = byId.get(id)?.type;
      return t ? currentHiddenTypes.has(t) : false;
    };
    // Ring 1 cap, applied AFTER the type filter so hiding
    // a flood type lets the rest through. Scored like the outer
    // rings: edges back into the center and the ring itself; the stable sort
    // keeps cast ahead of backlinks on a tie. The left-out count feeds the
    // legend; the left-out ids stay in inAnyRing so they never pose as ring 2.
    const ring1Eligible = ring1All.filter(id => !isHidden(id));
    let ring1 = ring1Eligible;
    if (ring1Eligible.length > RING_CAPS[1]) {
      const pool = new Set<string>([centerEl.id, ...ring1Eligible]);
      const score = new Map<string, number>();
      for (const id of ring1Eligible) {
        let s = 0;
        for (const adj of undirected(id)) if (pool.has(adj) && adj !== id) s++;
        score.set(id, s);
      }
      ring1 = [...ring1Eligible]
        .sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0))
        .slice(0, RING_CAPS[1]);
    }
    const ring1Omitted = ring1Eligible.length - ring1.length;
    const rings: string[][] = [[centerEl.id], ring1];

    for (let depth = 2; depth <= effectiveHop; depth++) {
      const previousRing = rings[depth - 1];
      const cap = depth === 2 ? ring2Cap : RING_CAPS[depth as 3 | 4];
      const scores = new Map<string, number>();
      for (const prevId of previousRing) {
        for (const adj of undirected(prevId)) {
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
    for (const ids of [ring1All, ...rings.slice(2)]) {
      for (const id of ids) {
        const t = byId.get(id)?.type;
        if (t) presentTypes.add(t);
      }
    }

    // Apply hidden-types filter to derive the visible-per-ring sets.
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
      isCenter: true, isCast: false, isBacklink: false,
    };
    nodes.push(center);
    const ringRadius = (depth: number): number => 120 * depth;
    for (let d = 1; d < visibleRings.length; d++) {
      const ring = visibleRings[d];
      const radius = ringRadius(d);
      const baseAngle = d * Math.PI / 6; // offset rings so they don't align
      if (d === 1) {
        // Ring 1 seeds by hemisphere: cast across the upper arc, backlinks
        // across the lower arc (screen y grows downward). The sim's k_h bias
        // keeps the halves apart once the springs settle.
        const cast = ring.filter(id => !backlinkSet.has(id));
        const back = ring.filter(id => backlinkSet.has(id));
        const seedArc = (ids: string[], from: number, to: number, isBack: boolean): void => {
          ids.forEach((id, i) => {
            const t = ids.length === 1 ? 0.5 : (i + 0.5) / ids.length;
            const angle = from + t * (to - from);
            nodes.push({
              id, el: byId.get(id) ?? null,
              x: Math.cos(angle) * radius,
              y: Math.sin(angle) * radius,
              vx: 0, vy: 0,
              isCenter: false, isCast: !isBack, isBacklink: isBack,
            });
          });
        };
        // Upper arc runs from just past 9 o'clock over the top to 3 o'clock;
        // lower arc the mirror. Each arc widens to the full half when the
        // other side is empty, so a subject with only backlinks still fans
        // out rather than crowding one quadrant.
        seedArc(cast, back.length ? -Math.PI * 0.95 : -Math.PI, back.length ? -Math.PI * 0.05 : Math.PI, false);
        seedArc(back, cast.length ? Math.PI * 0.05 : 0, cast.length ? Math.PI * 0.95 : Math.PI * 2, true);
        continue;
      }
      ring.forEach((id, i) => {
        const angle = baseAngle + (i / Math.max(1, ring.length)) * Math.PI * 2;
        nodes.push({
          id, el: byId.get(id) ?? null,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          vx: 0, vy: 0,
          isCenter: false,
          isCast: false,
          isBacklink: false,
        });
      });
    }
    const idToNode = new Map<string, SimNode>();
    for (const n of nodes) idToNode.set(n.id, n);

    // Edges: every relation between two visible nodes draws once, keeping
    // its direction: `from` is the element whose field holds the
    // link, `to` is the one it names. A pair linked both ways is one
    // `mutual` edge. The renderer only draws arrowheads on edges INTO the
    // center, so direction is visible exactly where the question "who links
    // here?" is asked, and the rest of the web stays a plain line.
    const edges: SimEdge[] = [];
    const edgeByPair = new Map<string, SimEdge>();
    for (const id of visibleSet) {
      for (const adj of outOf(id)) {
        if (!visibleSet.has(adj)) continue;
        const key = id < adj ? `${id}|${adj}` : `${adj}|${id}`;
        const existing = edgeByPair.get(key);
        if (existing) {
          if (existing.fromId !== id) existing.mutual = true;
          continue;
        }
        const edge: SimEdge = { fromId: id, toId: adj, mutual: false };
        edgeByPair.set(key, edge);
        edges.push(edge);
      }
    }

    // Run physics sim. The hemisphere bias only earns its keep when BOTH
    // halves of ring 1 exist; with backlinks alone it would crowd the whole
    // ring into the bottom of the canvas for no contrast.
    const biased = nodes.some(n => n.isCast) && nodes.some(n => n.isBacklink);
    // Seeds follow from ring order and the cast/backlink split, and the sim
    // has no randomness, so this key fixes the result.
    const memoKey = `${biased ? 1 : 0}#`
      + visibleRings.map((r, d) => r.map(id => (d === 1 && backlinkSet.has(id) ? '<' : '') + id).join(',')).join(';')
      + '#' + edges.map(e => `${e.fromId}>${e.toId}${e.mutual ? '=' : ''}`).join(',');
    const memo = layoutMemo.get(memoKey);
    if (memo && memo.length === nodes.length) {
      memo.forEach(([x, y], i) => { nodes[i].x = x; nodes[i].y = y; });
    } else {
      const centerName = centerEl.name || '';
      runSim(nodes, edges, idToNode, biased, centerLabelSlotFor(centerName));
      // The slot was sized for the usual scale; a wide web fits the pane
      // smaller, and the box kept clear shrinks under the label (once
      // Fluffington's label over Commander Vera at depth 2, 1440). Size it
      // again from the fit this pane gives, and relax again. Never below
      // the scale where the collision distance still keeps nodes apart: a
      // bigger slot spreads the web, the fit drops, and nodes touch (41
      // pairs at 1200 without the floor).
      const rect = host.getBoundingClientRect();
      const floor = NODE_DIAMETER / PARAMS.collisionMinDist;
      let slotScale = SLOT_SCALE;
      for (let i = 0; i < 3; i++) {
        const fit = Math.max(floor, fitScale(nodes, rect.width || 320, rect.height || 240));
        if (fit >= slotScale - 0.01) break;
        slotScale = fit;
        relaxLayout(nodes, centerLabelSlotFor(centerName, slotScale));
      }
      simRuns++;
      layoutMemo.delete(memoKey);
      layoutMemo.set(memoKey, nodes.map(n => [n.x, n.y]));
      if (layoutMemo.size > LAYOUT_MEMO_MAX) layoutMemo.delete(layoutMemo.keys().next().value!);
    }
    lastLayout = nodes.map(n => ({ id: n.id, x: n.x, y: n.y, isCenter: n.isCenter }));

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

    // Legend for the muted half of the ring: one quiet line, only
    // when backlinks are on the canvas, so a first-time reader has the key
    // without a settings trip. Pointer-events off; it is not a control.
    // The same line carries the ring-1 cap's left-out count.
    const backlinkCount = nodes.filter(n => n.isBacklink).length;
    if (backlinkCount > 0 || ring1Omitted > 0) {
      const legend = document.createElement('div');
      legend.className = 'atlas-context-graph-legend';
      if (ring1Omitted === 0) legend.setAttribute('aria-hidden', 'true');
      legend.innerHTML = (backlinkCount > 0
        ? `<span class="atlas-context-graph-legend-swatch"></span>` +
          `<span>${backlinkCount} link${backlinkCount === 1 ? '' : 's'} here</span>`
        : '')
        + (ring1Omitted > 0
          ? `<span class="atlas-context-graph-legend-more">+${ring1Omitted} more not shown</span>`
          : '');
      host.appendChild(legend);
    }

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
    const paintCenterId = nodes.find(c => c.isCenter)?.id ?? homeId;
    const paintState = getState();
    const paintWorldState = paintState.registry.worlds.find(w => w.id === paintState.active?.worldId)?.state;
    for (const n of nodes) {
      const nodeEl = document.createElement('button');
      nodeEl.type = 'button';
      nodeEl.className = 'atlas-context-graph-node';
      if (n.isCenter) nodeEl.classList.add('is-center');
      else if (n.isCast) nodeEl.classList.add('is-cast');
      else if (n.isBacklink) nodeEl.classList.add('is-backlink');
      else nodeEl.classList.add('is-adjacent');
      nodeEl.dataset.elementId = n.id;
      const cx = n.x * scale + offsetX;
      const cy = n.y * scale + offsetY;
      const dia = diameterFor(n);
      nodeEl.style.left = `${cx - dia / 2}px`;
      nodeEl.style.top = `${cy - dia / 2}px`;
      const iconName = n.el ? (ELEMENT_ICONS[n.el.type] ?? 'category') : 'edit_note';
      const rawName = n.el?.name?.trim()
        || (n.isCenter && n.id === homeId ? subject.name || '(home)' : '(unknown)');
      // A proposed or hidden element is drawn with its mark, never plain, as on
      // every other surface: a dotted ring, the word in the label and its line in
      // the tooltip. Atlas is the keeper's copy, so they are shown, marked.
      const proposed = n.el ? proposedMarkOf(n.el) : null;
      const hiddenLine = n.el ? hiddenMarkLine(n.el, paintWorldState) : null;
      const markWords = [proposed ? proposedWord(proposed) : '', hiddenLine ? 'Hidden' : ''].filter(Boolean);
      if (proposed) nodeEl.classList.add('is-proposed');
      if (hiddenLine) nodeEl.classList.add('is-hidden');
      if (markWords.length) nodeEl.dataset.mark = markWords.join(' ').toLowerCase();
      nodeEl.innerHTML =
        `<span class="material-symbols-outlined">${iconName}</span>` +
        `<span class="atlas-context-graph-node-label">${escapeText(rawName)}` +
        (markWords.length ? ` <span class="atlas-context-graph-node-mark">${escapeText(markWords.join(', '))}</span>` : '') +
        `</span>`;
      // Native browser tooltip — name + first ~200 chars of description so
      // the writer can peek at "what is this" without clicking.
      const desc = typeof n.el?.description === 'string' ? n.el.description.trim() : '';
      const descSnippet = desc.length > 200 ? desc.slice(0, 197) + '…' : desc;
      // A backlink's tooltip says so in words, for the reader who has not
      // yet learned the muted ring + arrow. A zone beside its map
      // says how many markers draw it there (#185: they are one line now).
      const centerName = nodes.find(c => c.isCenter)?.el?.name || 'this element';
      const markers = n.isCenter ? 0
        : lastMarkerCounts.get(`${paintCenterId}|${n.id}`) ?? lastMarkerCounts.get(`${n.id}|${paintCenterId}`) ?? 0;
      const markerLine = markers ? `\n${markers} marker${markers === 1 ? '' : 's'} on the map` : '';
      const markLines = [proposed ? proposedTitle(proposed) : '', hiddenLine ?? ''].filter(Boolean).map(l => `\n${l}`).join('');
      const heading = (n.isBacklink ? `${rawName}\nlinks to ${centerName}` : rawName) + markLines + markerLine;
      nodeEl.title = descSnippet ? `${heading}\n\n${descSnippet}` : heading;

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
    lastNodes = nodes;
    lastNeighborSets = neighborSets;
    applyLabelPlacement();
  }

  /**
   * The label pass (#141; it replaced T-CX2's count budget, which hid by
   * degree alone and still let fourteen labels print over each other in a
   * busy ring). Every label takes the first clear side of its node or waits
   * for hover (`graph-labels.ts`). Priority: the center, then the selection,
   * then the most connected. Runs on every paint, because a zoom, a pan or a
   * resize moves the nodes under the labels.
   */
  function applyLabelPlacement(): void {
    const items: GraphLabelItem[] = [];
    for (const n of lastNodes) {
      const el = lastNodeEls.get(n.id);
      if (!el || el.style.display === 'none') continue;
      // A node with no label is still an obstacle: it goes in with no size,
      // so others keep off its circle.
      const label = el.querySelector<HTMLElement>('.atlas-context-graph-node-label');
      const dia = diameterFor(n);
      const degree = (lastNeighborSets.get(n.id)?.size ?? 1) - 1;
      items.push({
        id: n.id,
        cx: parseFloat(el.style.left) + dia / 2,
        cy: parseFloat(el.style.top) + dia / 2,
        r: dia / 2,
        w: label?.offsetWidth ?? 0,
        h: label?.offsetHeight ?? 0,
        priority: n.isCenter ? 1e6 : n.id === lastHighlightedId ? 1e5 : degree,
        always: n.isCenter || n.id === lastHighlightedId,
      });
    }
    const rect = host.getBoundingClientRect();
    const sides = placeGraphLabels(items, { w: rect.width, h: rect.height });
    for (const [id, el] of lastNodeEls) {
      const side = sides.get(id);
      el.classList.toggle('is-label-hidden', side === null);
      for (const s of GRAPH_LABEL_SIDES) el.classList.toggle(`is-label-${s}`, side === s && s !== 'below');
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
    const { minX, maxX, minY, maxY } = layoutBounds(nodes);
    const rect = target.getBoundingClientRect();
    const hostW = rect.width || 320;
    const hostH = rect.height || 240;
    const scale = fitScale(nodes, hostW, hostH);
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
    // Backlink edges read from the app ink rather than the accent:
    // they belong to the muted half of the ring. The canvas cannot read a
    // CSS variable directly, so resolve the ink triplet once per draw and
    // fall back to the dark-theme white.
    const inkRgb = getComputedStyle(canvas).getPropertyValue('--atlas-ink-rgb').trim() || '255, 255, 255';
    const backlinkStroke = `rgba(${inkRgb}, 0.22)`;
    const idToNode = new Map<string, SimNode>();
    for (const n of nodes) idToNode.set(n.id, n);
    for (const e of edges) {
      const a = idToNode.get(e.fromId);
      const b = idToNode.get(e.toId);
      if (!a || !b) continue;
      // An edge INTO the center from a backlink node is the one that carries
      // direction: grey line, small arrowhead at the center's rim.
      const intoCenter = b.isCenter && a.isBacklink && !e.mutual;
      ctx.strokeStyle = intoCenter
        ? (currentEdgeColor ? edgeStrokeFor(a, b) : backlinkStroke)
        : currentEdgeColor ? edgeStrokeFor(a, b) : defaultStroke;
      const ax = a.x * scale + offsetX;
      const ay = a.y * scale + offsetY;
      const bx = b.x * scale + offsetX;
      const by = b.y * scale + offsetY;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      if (intoCenter) drawArrowhead(ctx, ax, ay, bx, by, (diameterFor(b) / 2) * scale + 2);
    }
  }

  /**
   * Small open chevron on the line from (ax,ay) to (bx,by), its tip pulled
   * back `inset` px from the far end so it sits on the target node's rim
   * instead of under it. Stroke colour is whatever the caller left set.
   */
  function drawArrowhead(
    ctx: CanvasRenderingContext2D,
    ax: number, ay: number, bx: number, by: number, inset: number,
  ): void {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < inset + 6) return;
    const ux = dx / len;
    const uy = dy / len;
    const tipX = bx - ux * inset;
    const tipY = by - uy * inset;
    const size = 5;
    const wing = 0.5; // half-angle in radians, roughly 29 degrees
    ctx.beginPath();
    ctx.moveTo(tipX - size * (ux * Math.cos(wing) - uy * Math.sin(wing)), tipY - size * (uy * Math.cos(wing) + ux * Math.sin(wing)));
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tipX - size * (ux * Math.cos(wing) + uy * Math.sin(wing)), tipY - size * (uy * Math.cos(wing) - ux * Math.sin(wing)));
    ctx.stroke();
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
    applyLabelPlacement();
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
      `<span>${escapeText(label)}</span>`;
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
      `<span>${escapeText(subject.name || '(home)')}</span>`;
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
      applyLabelPlacement();
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

function runSim(
  nodes: SimNode[], edges: SimEdge[], idToNode: Map<string, SimNode>, hemisphereBias = false,
  centerLabelSlot: { halfW: number; top: number; bottom: number } | null = null,
): void {
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
      // Hemisphere bias, ring 1 only: backlinks settle below the center,
      // the subject's own links above.
      if (!hemisphereBias) continue;
      if (n.isBacklink) n.vy += PARAMS.k_h;
      else if (n.isCast) n.vy -= PARAMS.k_h;
    }
    for (const n of nodes) {
      if (n.isCenter) continue;
      n.vx *= PARAMS.damping;
      n.vy *= PARAMS.damping;
      const speed = Math.hypot(n.vx, n.vy);
      if (speed > PARAMS.maxStep) { n.vx *= PARAMS.maxStep / speed; n.vy *= PARAMS.maxStep / speed; }
      n.x += n.vx;
      n.y += n.vy;
    }
  }
  relaxLayout(nodes, centerLabelSlot);
}

/** Collision relaxation post-sim, and the subject's label slot kept clear. */
function relaxLayout(
  nodes: SimNode[], centerLabelSlot: { halfW: number; top: number; bottom: number } | null,
): void {
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
    // The subject's label slot (#141): a box under the center, sized from
    // its name, that no node may sit in, so the one label that always
    // prints has a clear place to print.
    if (centerLabelSlot) {
      const r = PARAMS.collisionMinDist / 2;
      const { halfW, top, bottom } = centerLabelSlot;
      for (const n of nodes) {
        if (n.isCenter) continue;
        if (n.x + r <= -halfW || n.x - r >= halfW || n.y + r <= top || n.y - r >= bottom) continue;
        const toLeft = -halfW - r - n.x;
        const toRight = halfW + r - n.x;
        const toBelow = bottom + r - n.y;
        const dx = Math.abs(toLeft) < Math.abs(toRight) ? toLeft : toRight;
        if (Math.abs(dx) < toBelow) n.x += dx; else n.y += toBelow;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** The scale a pane usually draws at; the slot is sized for it first. */
const SLOT_SCALE = 0.75;

/**
 * The center label's slot in sim units: the label's pixel size over the
 * scale the pane draws at, from its name's length. An estimate on purpose:
 * the label pass measures the real ink afterwards.
 */
function centerLabelSlotFor(name: string, scale = SLOT_SCALE): { halfW: number; top: number; bottom: number } {
  const halfPx = (name.length * 6) / 2 + 4;
  const topPx = CENTER_NODE_DIAMETER / 2 + 2;
  return { halfW: halfPx / scale, top: topPx / scale, bottom: (topPx + 14) / scale };
}

/** A layout's bounds in sim units, never smaller than the center's 200 x 200. */
function layoutBounds(nodes: readonly SimNode[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = -100, maxX = 100, minY = -100, maxY = 100;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  return { minX, maxX, minY, maxY };
}

/** The fit-to-pane scale for a layout: the base projection's, before any zoom. */
function fitScale(nodes: readonly SimNode[], hostW: number, hostH: number): number {
  const { minX, maxX, minY, maxY } = layoutBounds(nodes);
  const padding = 50;
  return Math.min(hostW / ((maxX - minX) + padding * 2), hostH / ((maxY - minY) + padding * 2), 1.4);
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
