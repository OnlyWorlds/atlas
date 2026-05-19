/**
 * Writing room — Book / Chapter / Scene authorship.
 *
 * See DESIGN_WRITING.md for full spec. v1 shell:
 *   - Left sub-column: book/chapter/scene tree (built from Narratives via
 *     parent_narrative + order)
 *   - Right sub-column: active Narrative as element-detail (reused)
 *
 * Three-level depth cap. Labels customizable via registry.writing_labels.
 *
 * v1 scope: tree + element-detail reuse for the editor surface. Real richtext
 * editor + autolinking + word count + outline mode all deferred — see
 * DESIGN_WRITING.md "Deferred design questions".
 */

import { getState, patchSlice, subscribe } from '../core/state';
import { onHashChange, parseHash, navigate, writingHash } from '../core/router';
import { mountElementDetail } from './element-detail';
import { ToastManager } from '../ui/toast-manager';
import { WritingCreateModal } from '../ui/writing-create-modal';
import { getActiveStore } from '../core/active-store';
import { requestPushIfLinked } from '../sync/sync-attach';
import { saveRegistry, toggleWritingTreeCollapsed } from '../registry/registry';
import type { Element } from '../core/types';
import { escapeText } from '../core/dom-utils';

export function getWritingLabels(worldId: string): { l1: string; l2: string; l3: string } {
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  return {
    l1: entry?.writing_labels?.l1 ?? 'Book',
    l2: entry?.writing_labels?.l2 ?? 'Chapter',
    l3: entry?.writing_labels?.l3 ?? 'Scene',
  };
}

interface NarrativeNode {
  el: Element;
  children: NarrativeNode[];
  depth: number;
}

interface NarrativeIndex {
  roots: NarrativeNode[];
  byId: Map<string, NarrativeNode>;
}

function buildNarrativeIndex(elements: Element[]): NarrativeIndex {
  const narratives = elements.filter(e => e.type === 'narrative');
  const byId = new Map<string, NarrativeNode>();
  for (const el of narratives) {
    byId.set(el.id, { el, children: [], depth: 0 });
  }
  const roots: NarrativeNode[] = [];
  for (const node of byId.values()) {
    const parentId = (node.el as Element & { parent_narrative?: string }).parent_narrative;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Compute depth via BFS from roots
  const queue: NarrativeNode[] = roots.map(r => { r.depth = 0; return r; });
  while (queue.length > 0) {
    const n = queue.shift()!;
    for (const child of n.children) {
      child.depth = n.depth + 1;
      queue.push(child);
    }
  }
  const orderFn = (a: NarrativeNode, b: NarrativeNode) => {
    const ao = (a.el as Element & { order?: number }).order ?? 0;
    const bo = (b.el as Element & { order?: number }).order ?? 0;
    if (ao !== bo) return ao - bo;
    return (a.el.name ?? '').localeCompare(b.el.name ?? '');
  };
  const sortTree = (nodes: NarrativeNode[]): void => {
    nodes.sort(orderFn);
    for (const n of nodes) sortTree(n.children);
  };
  sortTree(roots);
  return { roots, byId };
}

/** List ancestor node ids of `id` (excludes `id` itself). */
function ancestorIds(idx: NarrativeIndex, id: string): string[] {
  const out: string[] = [];
  let cur = idx.byId.get(id);
  let parentId = cur ? (cur.el as Element & { parent_narrative?: string }).parent_narrative : undefined;
  while (parentId) {
    out.push(parentId);
    const parent = idx.byId.get(parentId);
    if (!parent) break;
    parentId = (parent.el as Element & { parent_narrative?: string }).parent_narrative;
  }
  return out;
}

/** Walk parent_narrative up to find {bookId, chapterId, sceneId} for navigation. */
function findAncestry(idx: NarrativeIndex, id: string): { bookId?: string; chapterId?: string; sceneId?: string } {
  const node = idx.byId.get(id);
  if (!node) return {};
  // Build the chain from this node up to root
  const chain: NarrativeNode[] = [node];
  let parentId = (node.el as Element & { parent_narrative?: string }).parent_narrative;
  while (parentId) {
    const parent = idx.byId.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    parentId = (parent.el as Element & { parent_narrative?: string }).parent_narrative;
  }
  // chain[0] = book, chain[1] = chapter, chain[2] = scene (if present)
  return {
    bookId: chain[0]?.el.id,
    chapterId: chain[1]?.el.id,
    sceneId: chain[2]?.el.id,
  };
}

/** Find the next free `order` value for siblings under the given parent. */
function nextOrder(idx: NarrativeIndex, parentId: string | null): number {
  const siblings = parentId
    ? (idx.byId.get(parentId)?.children ?? [])
    : idx.roots;
  let max = -1;
  for (const s of siblings) {
    const o = (s.el as Element & { order?: number }).order ?? 0;
    if (o > max) max = o;
  }
  return max + 1;
}

async function createNarrative(
  parentId: string | null,
  name: string,
  toasts: ToastManager,
): Promise<Element | null> {
  const folder = getActiveStore();
  if (!folder) {
    toasts.error('No active world.');
    return null;
  }
  const idx = buildNarrativeIndex(getState().data.elements);
  const created = await folder.createElement('narrative', {
    name,
    ...(parentId ? { parent_narrative: parentId } : {}),
    order: nextOrder(idx, parentId),
  } as Partial<Element>);
  const all = await folder.listElements();
  patchSlice('data', { elements: all });
  requestPushIfLinked();
  return created;
}

export function mountWriting(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-writing-room';
  target.appendChild(root);

  const treeCol = document.createElement('div');
  treeCol.className = 'atlas-writing-tree';
  root.appendChild(treeCol);

  const detailCol = document.createElement('div');
  detailCol.className = 'atlas-writing-detail';
  root.appendChild(detailCol);

  let unmountDetail: (() => void) | null = null;

  function render(): void {
    const active = getState().active;
    if (!active) {
      treeCol.innerHTML = '';
      detailCol.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
      return;
    }
    const labels = getWritingLabels(active.worldId);
    const elements = getState().data.elements;
    const idx = buildNarrativeIndex(elements);
    const route = parseHash(window.location.hash);
    const activeId = route.sceneId ?? route.chapterId ?? route.bookId ?? null;
    const activeNode = activeId ? idx.byId.get(activeId) : null;
    const entry = getState().registry.worlds.find(w => w.id === active.worldId);
    const collapsed = new Set(entry?.writing_tree_collapsed ?? []);
    // If the URL targets a descendant of a collapsed node, force its ancestors
    // open so the active selection is visible. The user explicitly navigated
    // there — collapse shouldn't hide it.
    if (activeId) {
      for (const ancestorId of ancestorIds(idx, activeId)) {
        collapsed.delete(ancestorId);
      }
    }

    // --- Tree column ---
    treeCol.innerHTML = '';
    const treeHeader = document.createElement('div');
    treeHeader.className = 'atlas-writing-tree-header';
    treeHeader.textContent = pluralize(labels.l1);
    treeCol.appendChild(treeHeader);

    const treeList = document.createElement('div');
    treeList.className = 'atlas-writing-tree-list';
    if (idx.roots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'atlas-pane-empty';
      empty.textContent = `No ${labels.l1.toLowerCase()}s yet.`;
      treeList.appendChild(empty);
    } else {
      for (const node of idx.roots) {
        renderNode(node, treeList, labels, active.worldId, activeId, idx, collapsed);
      }
    }
    treeCol.appendChild(treeList);

    // "+ new book" at bottom (top-level create)
    const newBookBtn = document.createElement('button');
    newBookBtn.type = 'button';
    newBookBtn.className = 'atlas-btn-ghost atlas-writing-new-book';
    newBookBtn.innerHTML = `<span class="material-symbols-outlined">add</span><span>new ${labels.l1.toLowerCase()}</span>`;
    newBookBtn.addEventListener('click', () => {
      new WritingCreateModal({
        label: labels.l1,
        onCreate: async (name) => {
          const created = await createNarrative(null, name, toasts);
          if (created) {
            navigate(writingHash(active.worldId, created.id));
            toasts.info(`${labels.l1} created`);
          }
        },
      }).open();
    });
    treeCol.appendChild(newBookBtn);

    // --- Detail column ---
    unmountDetail?.();
    unmountDetail = null;
    detailCol.innerHTML = '';
    if (activeNode) {
      // Mirror selection so element-detail renders this narrative.
      if (getState().ui.selectedElementId !== activeNode.el.id) {
        patchSlice('ui', { ...getState().ui, selectedElementId: activeNode.el.id });
      }

      // Contextual "+ new child" toolbar — depth 0 lets you add a chapter,
      // depth 1 lets you add a scene, depth 2 (scene) has no children.
      if (activeNode.depth < 2) {
        const childLabel = activeNode.depth === 0 ? labels.l2 : labels.l3;
        const toolbar = document.createElement('div');
        toolbar.className = 'atlas-writing-context-toolbar';
        const addChildBtn = document.createElement('button');
        addChildBtn.type = 'button';
        addChildBtn.className = 'atlas-btn-ghost';
        addChildBtn.innerHTML = `<span class="material-symbols-outlined">add</span><span>new ${childLabel.toLowerCase()}</span>`;
        addChildBtn.addEventListener('click', () => {
          new WritingCreateModal({
            label: childLabel,
            parentId: activeNode.el.id,
            onCreate: async (name) => {
              const created = await createNarrative(activeNode.el.id, name, toasts);
              if (created) {
                const path = findAncestry(buildNarrativeIndex(getState().data.elements), created.id);
                navigate(writingHash(active.worldId, path.bookId, path.chapterId, path.sceneId));
                toasts.info(`${childLabel} created`);
              }
            },
          }).open();
        });
        toolbar.appendChild(addChildBtn);
        detailCol.appendChild(toolbar);
      }

      const detailMount = document.createElement('div');
      detailMount.className = 'atlas-writing-detail-mount';
      detailCol.appendChild(detailMount);
      unmountDetail = mountElementDetail(detailMount);
    } else {
      const empty = document.createElement('div');
      empty.className = 'atlas-pane-empty';
      empty.innerHTML = `
        <p>Select a ${labels.l1.toLowerCase()} to begin, or create one.</p>
      `;
      detailCol.appendChild(empty);
    }
  }

  function renderNode(
    node: NarrativeNode,
    parent: HTMLElement,
    labels: { l1: string; l2: string; l3: string },
    worldId: string,
    activeId: string | null,
    idx: NarrativeIndex,
    collapsed: Set<string>,
  ): void {
    const hasChildren = node.children.length > 0 && node.depth < 2;
    const isCollapsed = hasChildren && collapsed.has(node.el.id);

    const row = document.createElement('div');
    row.className = 'atlas-writing-tree-row';
    if (node.el.id === activeId) row.classList.add('active');
    row.style.paddingLeft = `${node.depth * 16 + 4}px`;

    const label = node.depth === 0 ? labels.l1 : node.depth === 1 ? labels.l2 : labels.l3;
    const icon = node.depth === 0 ? 'menu_book' : node.depth === 1 ? 'article' : 'short_text';

    // Chevron (separate clickable; only when the node has children to hide).
    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = 'atlas-writing-tree-chevron';
    chevron.tabIndex = -1;
    chevron.setAttribute('aria-label', isCollapsed ? 'expand' : 'collapse');
    if (hasChildren) {
      chevron.innerHTML = `<span class="material-symbols-outlined">${isCollapsed ? 'chevron_right' : 'expand_more'}</span>`;
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = toggleWritingTreeCollapsed(getState().registry, worldId, node.el.id);
        patchSlice('registry', next);
        saveRegistry(next);
      });
    } else {
      // Reserved spacer so all rows align regardless of children.
      chevron.classList.add('atlas-writing-tree-chevron-empty');
      chevron.disabled = true;
      chevron.innerHTML = '';
    }
    row.appendChild(chevron);

    // The body of the row (icon + name) navigates to the node.
    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'atlas-writing-tree-row-body';
    body.innerHTML = `
      <span class="material-symbols-outlined atlas-writing-tree-icon">${icon}</span>
      <span class="atlas-writing-tree-name">${escapeText(node.el.name || `(unnamed ${label.toLowerCase()})`)}</span>
    `;
    body.addEventListener('click', () => {
      const path = findAncestry(idx, node.el.id);
      navigate(writingHash(worldId, path.bookId, path.chapterId, path.sceneId));
    });
    row.appendChild(body);

    parent.appendChild(row);

    // Render children up to depth 2 (scene). Scenes have no children.
    // Skip when collapsed.
    if (hasChildren && !isCollapsed) {
      for (const child of node.children) {
        renderNode(child, parent, labels, worldId, activeId, idx, collapsed);
      }
    }
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();

  return () => {
    unsubState();
    unsubHash();
    unmountDetail?.();
  };
}


function pluralize(word: string): string {
  if (word.endsWith('s')) return word;
  if (word.endsWith('y')) return word.slice(0, -1) + 'ies';
  return word + 's';
}
