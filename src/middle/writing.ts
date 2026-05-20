/**
 * Writing room — book / chapter / scene / draft authorship.
 *
 * See DESIGN_WRITING.md for the full spec. The model (session 224):
 *
 *   - Narratives belong to the writing tree iff `supertype` matches one of
 *     the world's four configured labels (`writing_labels.l1`–`l4`).
 *   - Tier (l1/l2/l3/l4) is determined directly by supertype value.
 *   - `subtype` is FREE for the user (vision, flashback, etc.) — atlas never
 *     sets it during writing-create.
 *   - Drafts (l4) are flexible-parent: any parent or none.
 *
 * When `isWritingInitialized` returns false, the setup screen replaces the
 * tree until the user confirms labels + optionally promotes existing
 * structured narratives.
 */

import { getState, patchSlice, subscribe } from '../core/state';
import { onHashChange, parseHash, navigate, writingHash } from '../core/router';
import { mountElementDetail } from './element-detail';
import { ToastManager } from '../ui/toast-manager';
import { WritingCreateModal } from '../ui/writing-create-modal';
import { getActiveStore } from '../core/active-store';
import { requestPushIfLinked } from '../sync/sync-attach';
import { saveRegistry, toggleWritingTreeCollapsed } from '../registry/registry';
import { mountWritingSetup } from './writing-setup';
import {
  getWritingLabels,
  getTierForNarrative,
  isWritingNarrative,
  isWritingInitialized,
  iconForTier,
  tierConstraints,
  supertypeForTier,
  type WritingLabels,
  type WritingTier,
} from './writing-helpers';
import type { Element } from '../core/types';
import { escapeText } from '../core/dom-utils';

// Re-export for backward compat with any callers still importing from writing.
export { getWritingLabels } from './writing-helpers';

interface NarrativeNode {
  el: Element;
  tier: WritingTier; // non-null for every node in the tree (filtered upstream)
  children: NarrativeNode[];
  depth: number;
}

interface NarrativeIndex {
  roots: NarrativeNode[];
  byId: Map<string, NarrativeNode>;
}

function buildNarrativeIndex(elements: Element[], worldId: string): NarrativeIndex {
  const writingNarratives = elements.filter(e => isWritingNarrative(e, worldId));
  const byId = new Map<string, NarrativeNode>();
  for (const el of writingNarratives) {
    byId.set(el.id, { el, tier: getTierForNarrative(el, worldId), children: [], depth: 0 });
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
  // Compute depth via BFS from roots.
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
  const cur = idx.byId.get(id);
  let parentId = cur ? (cur.el as Element & { parent_narrative?: string }).parent_narrative : undefined;
  while (parentId) {
    out.push(parentId);
    const parent = idx.byId.get(parentId);
    if (!parent) break;
    parentId = (parent.el as Element & { parent_narrative?: string }).parent_narrative;
  }
  return out;
}

/** Walk parent_narrative up to find {bookId, chapterId, sceneId} for routing. */
function findAncestry(idx: NarrativeIndex, id: string): { bookId?: string; chapterId?: string; sceneId?: string } {
  const node = idx.byId.get(id);
  if (!node) return {};
  const chain: NarrativeNode[] = [node];
  let parentId = (node.el as Element & { parent_narrative?: string }).parent_narrative;
  while (parentId) {
    const parent = idx.byId.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    parentId = (parent.el as Element & { parent_narrative?: string }).parent_narrative;
  }
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

async function createNarrativeAtTier(
  tier: 'l1' | 'l2' | 'l3' | 'l4',
  parentId: string | null,
  name: string,
  worldId: string,
  toasts: ToastManager,
): Promise<Element | null> {
  const folder = getActiveStore();
  if (!folder) {
    toasts.error('No active world.');
    return null;
  }
  const idx = buildNarrativeIndex(getState().data.elements, worldId);
  const supertype = supertypeForTier(tier, worldId);
  const created = await folder.createElement('narrative', {
    name,
    supertype,
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
  const container = document.createElement('div');
  container.className = 'atlas-writing-room-container';
  target.appendChild(container);

  let unmountInner: (() => void) | null = null;
  let lastMode: 'setup' | 'tree' | 'empty' | null = null;

  function render(): void {
    const active = getState().active;
    if (!active) {
      mountMode('empty');
      return;
    }
    const entry = getState().registry.worlds.find(w => w.id === active.worldId);
    const inited = isWritingInitialized(entry, getState().data.elements);
    mountMode(inited ? 'tree' : 'setup');
  }

  function mountMode(mode: 'setup' | 'tree' | 'empty'): void {
    if (mode === lastMode) {
      // Inner component owns its own subscriptions for live updates.
      return;
    }
    unmountInner?.();
    unmountInner = null;
    container.innerHTML = '';
    lastMode = mode;
    if (mode === 'empty') {
      container.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
      return;
    }
    if (mode === 'setup') {
      unmountInner = mountWritingSetup(container, toasts, () => {
        // On finish/skip, fall through to tree.
        lastMode = null;
        render();
      });
      return;
    }
    unmountInner = mountTree(container, toasts);
  }

  // Outer subscription re-evaluates mode on every state tick. mountMode
  // early-returns when mode is unchanged, so this is cheap. Doing it always
  // (not just for setup/empty modes) is what makes the gear-click flow work:
  // clicking gear flips `writing_initialized` to false in the registry, and
  // we need to react by switching tree → setup. If we filtered on lastMode,
  // tree-mode would be stuck.
  const unsub = subscribe(render);
  const unsubHash = onHashChange(() => {
    // Hash changes don't change mode; the mounted component handles routing.
  });
  render();

  return () => {
    unsub();
    unsubHash();
    unmountInner?.();
  };
}

function mountTree(container: HTMLElement, toasts: ToastManager): () => void {
  const root = document.createElement('div');
  root.className = 'atlas-writing-room';
  container.appendChild(root);

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
    const idx = buildNarrativeIndex(elements, active.worldId);
    const route = parseHash(window.location.hash);
    const activeId = route.sceneId ?? route.chapterId ?? route.bookId ?? null;
    const activeNode = activeId ? idx.byId.get(activeId) : null;
    const entry = getState().registry.worlds.find(w => w.id === active.worldId);
    const collapsed = new Set(entry?.writing_tree_collapsed ?? []);
    if (activeId) {
      for (const ancestorId of ancestorIds(idx, activeId)) {
        collapsed.delete(ancestorId);
      }
    }

    // --- Tree column ---
    treeCol.innerHTML = '';
    const headerRow = document.createElement('div');
    headerRow.className = 'atlas-writing-tree-header';
    headerRow.innerHTML = `
      <span class="atlas-writing-tree-header-title">${escapeText(pluralize(labels.l1))}</span>
      <button class="atlas-writing-tree-header-settings" data-action="writing-settings" title="writing settings" aria-label="writing settings">
        <span class="material-symbols-outlined">tune</span>
      </button>
    `;
    headerRow.querySelector('[data-action="writing-settings"]')?.addEventListener('click', () => {
      // Re-open setup screen by clearing the flag in-memory + re-rendering.
      // Persisted on save inside the setup component.
      const reg = getState().registry;
      const nextWorlds = reg.worlds.map(w =>
        w.id === active.worldId ? { ...w, writing_initialized: false } : w,
      );
      patchSlice('registry', { ...reg, worlds: nextWorlds });
      saveRegistry({ ...reg, worlds: nextWorlds });
    });
    treeCol.appendChild(headerRow);

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

    // "+ new book" + "+ new draft" at bottom.
    const createRow = document.createElement('div');
    createRow.className = 'atlas-writing-tree-create-row';
    const newBookBtn = document.createElement('button');
    newBookBtn.type = 'button';
    newBookBtn.className = 'atlas-btn-ghost atlas-writing-new-book';
    newBookBtn.innerHTML = `<span class="material-symbols-outlined">add</span><span>new ${labels.l1.toLowerCase()}</span>`;
    newBookBtn.addEventListener('click', () => {
      new WritingCreateModal({
        label: labels.l1,
        onCreate: async (name) => {
          const created = await createNarrativeAtTier('l1', null, name, active.worldId, toasts);
          if (created) {
            navigate(writingHash(active.worldId, created.id));
            toasts.info(`${labels.l1} created`);
          }
        },
      }).open();
    });
    createRow.appendChild(newBookBtn);

    const newDraftBtn = document.createElement('button');
    newDraftBtn.type = 'button';
    newDraftBtn.className = 'atlas-btn-ghost atlas-writing-new-draft';
    newDraftBtn.innerHTML = `<span class="material-symbols-outlined">edit_note</span><span>new ${labels.l4.toLowerCase()}</span>`;
    newDraftBtn.addEventListener('click', () => {
      new WritingCreateModal({
        label: labels.l4,
        onCreate: async (name) => {
          const created = await createNarrativeAtTier('l4', null, name, active.worldId, toasts);
          if (created) {
            navigate(writingHash(active.worldId, created.id));
            toasts.info(`${labels.l4} created`);
          }
        },
      }).open();
    });
    createRow.appendChild(newDraftBtn);

    treeCol.appendChild(createRow);

    // --- Detail column ---
    unmountDetail?.();
    unmountDetail = null;
    detailCol.innerHTML = '';
    if (activeNode) {
      // Mirror selection into ui state so element-detail can render this
      // narrative. DEFERRED via queueMicrotask: patchSlice fires subscribers
      // synchronously, and our own subscribe would recurse into render()
      // mid-flight if we patched inline — causing detailCol to grow a second
      // detailMount before the outer render finishes. Deferring schedules the
      // patch after this render completes; if it changes state, a single
      // clean re-render follows. Idempotent re-checks the value inside.
      const targetId = activeNode.el.id;
      if (getState().ui.selectedElementId !== targetId) {
        queueMicrotask(() => {
          if (getState().ui.selectedElementId !== targetId) {
            patchSlice('ui', { ...getState().ui, selectedElementId: targetId });
          }
        });
      }

      // Contextual "+ new child" buttons based on active tier:
      //   l1 (Book)    → + Chapter, + Draft
      //   l2 (Chapter) → + Scene, + Draft
      //   l3 (Scene)   → + Draft
      //   l4 (Draft)   → + Draft (drafts nest drafts)
      const childTiers: Array<'l1' | 'l2' | 'l3' | 'l4'> = [];
      if (activeNode.tier === 'l1') childTiers.push('l2', 'l4');
      else if (activeNode.tier === 'l2') childTiers.push('l3', 'l4');
      else if (activeNode.tier === 'l3') childTiers.push('l4');
      else if (activeNode.tier === 'l4') childTiers.push('l4');

      if (childTiers.length > 0) {
        const toolbar = document.createElement('div');
        toolbar.className = 'atlas-writing-context-toolbar';
        for (const childTier of childTiers) {
          const childLabel = labels[childTier];
          const addChildBtn = document.createElement('button');
          addChildBtn.type = 'button';
          addChildBtn.className = 'atlas-btn-ghost';
          addChildBtn.innerHTML = `<span class="material-symbols-outlined">add</span><span>new ${childLabel.toLowerCase()}</span>`;
          addChildBtn.addEventListener('click', () => {
            new WritingCreateModal({
              label: childLabel,
              parentId: activeNode.el.id,
              onCreate: async (name) => {
                const created = await createNarrativeAtTier(childTier, activeNode.el.id, name, active.worldId, toasts);
                if (created) {
                  const path = findAncestry(buildNarrativeIndex(getState().data.elements, active.worldId), created.id);
                  navigate(writingHash(active.worldId, path.bookId, path.chapterId, path.sceneId));
                  toasts.info(`${childLabel} created`);
                }
              },
            }).open();
          });
          toolbar.appendChild(addChildBtn);
        }
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
        <p>Select a ${labels.l1.toLowerCase()} or ${labels.l4.toLowerCase()} to begin, or create one.</p>
      `;
      detailCol.appendChild(empty);
    }
  }

  function renderNode(
    node: NarrativeNode,
    parent: HTMLElement,
    labels: WritingLabels,
    worldId: string,
    activeId: string | null,
    idx: NarrativeIndex,
    collapsed: Set<string>,
  ): void {
    const hasChildren = node.children.length > 0;
    const isCollapsed = hasChildren && collapsed.has(node.el.id);

    const row = document.createElement('div');
    row.className = 'atlas-writing-tree-row';
    if (node.el.id === activeId) row.classList.add('active');
    row.style.paddingLeft = `${node.depth * 16 + 4}px`;

    // Tier-aware label + icon (drafts get distinct icon regardless of depth).
    const tierLabel =
      node.tier === 'l1' ? labels.l1
      : node.tier === 'l2' ? labels.l2
      : node.tier === 'l3' ? labels.l3
      : labels.l4;
    const icon = iconForTier(node.tier);

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
      chevron.classList.add('atlas-writing-tree-chevron-empty');
      chevron.disabled = true;
      chevron.innerHTML = '';
    }
    row.appendChild(chevron);

    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'atlas-writing-tree-row-body';
    if (node.tier === 'l4') body.classList.add('atlas-writing-tree-row-body-draft');
    body.innerHTML = `
      <span class="material-symbols-outlined atlas-writing-tree-icon">${icon}</span>
      <span class="atlas-writing-tree-name">${escapeText(node.el.name || `(unnamed ${tierLabel.toLowerCase()})`)}</span>
    `;
    body.addEventListener('click', () => {
      const path = findAncestry(idx, node.el.id);
      navigate(writingHash(worldId, path.bookId, path.chapterId, path.sceneId));
    });
    row.appendChild(body);

    parent.appendChild(row);

    // Render children for ANY tier (including drafts — they can nest).
    if (hasChildren && !isCollapsed) {
      for (const child of node.children) {
        renderNode(child, parent, labels, worldId, activeId, idx, collapsed);
      }
    }
  }

  // Suppress unused warning — tierConstraints is reserved for future Refactor
  // (e.g. validating parent at create time). Keep import-friendly.
  void tierConstraints;

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
