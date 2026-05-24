/**
 * Force-directed graph for the writing-context pane.
 *
 * Adapted from `tools/cos-browser/src/modes/browse/graph-view.ts`. Same shape:
 *   - Synchronous run-to-stable physics sim (no live animation churn)
 *   - DOM nodes for click + hover; canvas for edges
 *   - Center node = current center; cast = filled cyan; adjacent = outlined
 *
 * Capabilities (session 230 redesign):
 *   - **Click to recenter** — clicking any non-center node re-runs the sim
 *     with that element as the new center. A "← back to {narrative}" pill
 *     appears at the top; clicking it restores the original narrative-centered
 *     view. Lists below stay tied to the writing-room narrative — the graph
 *     becomes a Little-Lens-style endless click-through exploration tool.
 *   - **Ctrl/Cmd+click** — navigates the middle pane to that element (leaves
 *     writing). Mouse-only path; without modifier, click stays in the pane.
 *   - **Hover fade** — hovering a node fades all nodes that don't share an
 *     edge with it. Quick visual disambiguation in busy graphs.
 *   - **Resize handling** — ResizeObserver re-projects layout to the new host
 *     dimensions without re-running the sim.
 *
 * Tier-aware density (session 230):
 *   - Scene (l3) / Draft (l4): show cast + 1-hop adjacency, cap 12
 *   - Chapter (l2): show only direct cast, cap 6
 *   - Book (l1): show only direct cast, cap 4
 */

import { getState } from '../../core/state';
import type { Element } from '../../core/types';
import { ELEMENT_ICONS } from '../../core/constants';
import { navigate, elementHash } from '../../core/router';
import { getTierForNarrative } from '../../middle/writing-helpers';

export interface GraphHandle {
  /** Visually emphasize a node (or clear highlight when id is null). */
  highlight(elementId: string | null): void;
  /** Tear down listeners, canvas, DOM. */
  destroy(): void;
}

export interface GraphOpts {
  host: HTMLElement;
  /** The active writing-room narrative — defines the "home" view. */
  narrative: Element;
  /** Selection event consumed by lists + preview slide-in. */
  onSelect: (elementId: string | null) => void;
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
const ADJACENT_CAP_SCENE = 12;
const ADJACENT_CAP_CHAPTER = 6;
const ADJACENT_CAP_BOOK = 4;

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

function collectDirectNeighbors(el: Element): string[] {
  const seen = new Set<string>();
  for (const field of MULTI_LINK_FIELDS) {
    for (const id of readMultiLink(el, field)) {
      if (!seen.has(id)) seen.add(id);
    }
  }
  return Array.from(seen);
}

export function mountContextGraph(opts: GraphOpts): GraphHandle {
  const { host, narrative, onSelect } = opts;
  host.innerHTML = '';
  host.style.position = 'relative';

  // The "home" view is always the writing-room narrative. `currentCenterId`
  // may diverge from `homeId` when the user click-recenters on another node.
  const homeId = narrative.id;
  let currentCenterId = homeId;

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

    const castIds = collectDirectNeighbors(centerEl).filter(id => byId.has(id));

    // Tier-aware density rules apply only when centered on a narrative AND
    // it has a writing tier. Non-narrative centers always get scene-level
    // (full adjacency, cap 12) because they're exploration views.
    let showAdjacent = true;
    let adjacentCap = ADJACENT_CAP_SCENE;
    const worldId = state.active?.worldId ?? '';
    const tier = (centerEl.type === 'narrative' && worldId)
      ? getTierForNarrative(centerEl, worldId)
      : null;
    if (tier === 'l2') {
      showAdjacent = false;
      adjacentCap = ADJACENT_CAP_CHAPTER;
    } else if (tier === 'l1') {
      showAdjacent = false;
      adjacentCap = ADJACENT_CAP_BOOK;
    }

    const adjacentScores = new Map<string, number>();
    if (showAdjacent) {
      for (const cid of castIds) {
        const cel = byId.get(cid);
        if (!cel) continue;
        for (const adj of collectDirectNeighbors(cel)) {
          if (adj === centerEl.id) continue;
          if (castIds.includes(adj)) continue;
          if (!byId.has(adj)) continue;
          adjacentScores.set(adj, (adjacentScores.get(adj) ?? 0) + 1);
        }
      }
    }
    const adjacentIds = Array.from(adjacentScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, adjacentCap)
      .map(([id]) => id);
    const adjacentSet = new Set<string>(adjacentIds);

    // Build sim nodes.
    const nodes: SimNode[] = [];
    const center: SimNode = {
      id: centerEl.id, el: centerEl,
      x: 0, y: 0, vx: 0, vy: 0,
      isCenter: true, isCast: false,
    };
    nodes.push(center);
    castIds.forEach((id, i) => {
      const angle = (i / Math.max(1, castIds.length)) * Math.PI * 2;
      nodes.push({
        id, el: byId.get(id) ?? null,
        x: Math.cos(angle) * 120,
        y: Math.sin(angle) * 120,
        vx: 0, vy: 0, isCenter: false, isCast: true,
      });
    });
    let i = 0;
    for (const adjId of adjacentSet) {
      const angle = (i / Math.max(1, adjacentSet.size)) * Math.PI * 2 + Math.PI / 6;
      nodes.push({
        id: adjId, el: byId.get(adjId) ?? null,
        x: Math.cos(angle) * 240,
        y: Math.sin(angle) * 240,
        vx: 0, vy: 0, isCenter: false, isCast: false,
      });
      i++;
    }
    const idToNode = new Map<string, SimNode>();
    for (const n of nodes) idToNode.set(n.id, n);

    const edges: SimEdge[] = [];
    for (const cid of castIds) edges.push({ fromId: centerEl.id, toId: cid });
    for (const cid of castIds) {
      const cel = byId.get(cid);
      if (!cel) continue;
      for (const adj of collectDirectNeighbors(cel)) {
        if (adjacentSet.has(adj)) edges.push({ fromId: cid, toId: adj });
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

    // "← back to {narrative}" pill, only when we've recentered away from home.
    if (centerId !== homeId) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'atlas-context-graph-back';
      pill.innerHTML = `<span class="material-symbols-outlined">arrow_back</span><span>back to ${escapeHtml(narrative.name || '(narrative)')}</span>`;
      pill.title = 'Return to narrative-centered graph';
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        renderForCenter(homeId);
        onSelect(null);
      });
      host.appendChild(pill);
    }

    // Stash for resize re-projection + highlight reapply.
    lastNodes = nodes;
    lastEdges = edges;
    lastNeighborSets = neighborSets;
    if (lastHighlightedId) applyHighlightTo(lastNodeEls, lastHighlightedId);
  }

  function paint(
    target: HTMLElement,
    nodes: SimNode[],
    edges: SimEdge[],
    neighborSets: Map<string, Set<string>>,
  ): void {
    // Compute projection.
    const { offsetX, offsetY, scale, hostW, hostH } = computeProjection(nodes, target);

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
      nodeEl.style.left = `${cx - NODE_DIAMETER / 2}px`;
      nodeEl.style.top = `${cy - NODE_DIAMETER / 2}px`;
      const iconName = n.el ? (ELEMENT_ICONS[n.el.type] ?? 'category') : 'edit_note';
      const rawName = n.el?.name
        || (n.isCenter && n.id === homeId ? narrative.name || '(this narrative)' : '(unknown)');
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
        // tied to home).
        renderForCenter(n.id);
        onSelect(n.id);
      });

      // Hover fade — fade all nodes that don't share an edge with the hovered.
      nodeEl.addEventListener('mouseenter', () => applyHoverFade(target, n.id, neighborSets));
      nodeEl.addEventListener('mouseleave', () => clearHoverFade(target));

      target.appendChild(nodeEl);
      nodeEls.set(n.id, nodeEl);
    }

    lastNodeEls = nodeEls;

    // Click on empty graph background deselects (only when on home).
    target.addEventListener('click', (e) => {
      if (e.target !== target && e.target !== lastCanvas) return;
      onSelect(null);
    }, { once: false });
  }

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
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.25)';
    const idToNode = new Map<string, SimNode>();
    for (const n of nodes) idToNode.set(n.id, n);
    for (const e of edges) {
      const a = idToNode.get(e.fromId);
      const b = idToNode.get(e.toId);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x * scale + offsetX, a.y * scale + offsetY);
      ctx.lineTo(b.x * scale + offsetX, b.y * scale + offsetY);
      ctx.stroke();
    }
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
    if (lastNodes.length === 0) return;
    const { offsetX, offsetY, scale, hostW, hostH } = computeProjection(lastNodes, host);
    if (lastCanvas) {
      lastCanvas.width = hostW;
      lastCanvas.height = hostH;
      drawEdges(lastCanvas, lastNodes, lastEdges, offsetX, offsetY, scale);
    }
    for (const n of lastNodes) {
      const el = lastNodeEls.get(n.id);
      if (!el) continue;
      const cx = n.x * scale + offsetX;
      const cy = n.y * scale + offsetY;
      el.style.left = `${cx - NODE_DIAMETER / 2}px`;
      el.style.top = `${cy - NODE_DIAMETER / 2}px`;
    }
  }

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

  return {
    highlight(elementId: string | null): void {
      lastHighlightedId = elementId;
      applyHighlightTo(lastNodeEls, elementId);
    },
    destroy(): void {
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (resizeRaf !== null) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = null;
      }
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
