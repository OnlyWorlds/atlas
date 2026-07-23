/**
 * Writing-mode sidebar body — the writing tree.
 *
 * Mounted into the shared sidebar body slot when the route is `writing` and
 * the user hasn't explicitly toggled to worlds/elements during this writing
 * session. The middle pane in writing mode becomes a single-pane element
 * detail; this sidebar is the navigation surface.
 *
 * Body-only — the parent sidebar driver owns the mode toggle and footer gear.
 */

import { getState, patchSlice, subscribe } from '../core/state';
import { onHashChange, parseHash, navigate, writingHash } from '../core/router';
import { ToastManager } from '../ui/toast-manager';
import { WritingCreateModal } from '../ui/writing-create-modal';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite } from '../sync/sync-attach';
import { saveRegistry, toggleWritingTreeCollapsed, getEditorSettings } from '../registry/registry';
import {
  getWritingLabels,
  iconForTier,
  supertypeForTier,
  buildNarrativeIndex,
  ancestorIds,
  nextOrder,
  type WritingLabels,
  type NarrativeNode,
  type NarrativeIndex,
} from '../middle/writing-helpers';
import type { Element } from '../core/types';
import { escapeText } from '../core/dom-utils';
import { bulkLinkNarratives } from '../middle/writing-bulk-link';
import { decideDeleteConfirm } from '../core/delete-confirm';
import { requestPushIfLinked } from '../sync/sync-attach';
import { isTourFlagActive } from '../tour/tour-flag';

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
  const all = await refreshElementsAfterWrite(folder);
  return created;
}

export interface WritingBodyMount {
  content: HTMLElement;
  toasts: ToastManager;
}

export function mountWritingBody(mount: WritingBodyMount): () => void {
  const { content, toasts } = mount;
  content.innerHTML = '';

  // Match the elements-sidebar structure exactly: append the bands and the
  // list DIRECTLY to `content` (which is the shell-level `.atlas-sidebar-content`
  // with `overflow-y: auto`). This makes the sidebar-level scrollbar work
  // identically — when the tree overflows, the scrollbar gutter (~14px)
  // reserves space across the whole sidebar including the search row, so
  // the search-row icons sit at exactly the same x-coordinate as the
  // elements sidebar's. No wrapping flex div, no internal scroll layer.
  const root = content;

  // Closure-scoped query — independent of state.ui.search (which is shared
  // with the elements sidebar) so toggling between sidebars doesn't drag a
  // half-typed elements query into writing or vice versa.
  let searchQuery = '';

  // Drag-and-drop state — module-scoped to the mount so dragover handlers
  // on sibling rows can read the dragging narrative's parent without going
  // through dataTransfer (which is unreadable during dragover for security).
  let draggingId: string | null = null;
  let draggingParent: string | null = null;

  /**
   * Reorder sibling narratives by writing new `order` values. Only operates
   * within the same `parent_narrative` group — re-parenting deferred.
   * Persists via FolderStore.updateElement for each affected sibling; sync
   * push fires after.
   */
  async function reorderSiblings(
    draggedId: string,
    targetId: string,
    insertAbove: boolean,
  ): Promise<void> {
    if (draggedId === targetId) return;
    const folder = getActiveStore();
    if (!folder) return;
    const els = getState().data.elements;
    const dragged = els.find(e => e.id === draggedId);
    const target = els.find(e => e.id === targetId);
    if (!dragged || !target) return;
    if (dragged.type !== 'narrative' || target.type !== 'narrative') return;
    const dParent = (dragged as Element & { parent_narrative?: string }).parent_narrative ?? null;
    const tParent = (target as Element & { parent_narrative?: string }).parent_narrative ?? null;
    if (dParent !== tParent) return; // same parent only — re-parent not in v1

    // Build sorted sibling list, exclude dragged, insert at new position.
    let siblings = els.filter(e =>
      e.type === 'narrative' &&
      ((e as Element & { parent_narrative?: string }).parent_narrative ?? null) === dParent,
    );
    siblings.sort((a, b) => {
      const ao = (a as Element & { order?: number }).order ?? 0;
      const bo = (b as Element & { order?: number }).order ?? 0;
      if (ao !== bo) return ao - bo;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
    siblings = siblings.filter(s => s.id !== draggedId);
    const targetIdx = siblings.findIndex(s => s.id === targetId);
    if (targetIdx < 0) return;
    const insertIdx = insertAbove ? targetIdx : targetIdx + 1;
    siblings.splice(insertIdx, 0, dragged);

    // Write new sequential order to every sibling whose value actually changes.
    // Sequential integers (0..N-1) keep the order field clean — no fractions.
    //
    // WRAPPED (S307). This loop writes to N elements in sequence and had no
    // error handling at all, while its only call site invokes it as a bare
    // `void reorderSiblings(...)`. A failure partway through (lock conflict,
    // disk error, a rejected write) left the tree PARTIALLY reordered and
    // produced an unhandled rejection: no toast, not even a console line.
    // Same class as the `void setNow(...)` silence fixed in S306 — a write
    // the user can see the result of must never fail invisibly.
    try {
      for (let i = 0; i < siblings.length; i++) {
        const current = (siblings[i] as Element & { order?: number }).order;
        if (current !== i) {
          await folder.updateElement(siblings[i].id, { order: i } as Partial<Element>);
        }
      }
    } catch (err) {
      console.error('[writing-sidebar] reorder failed:', err);
      toasts.error('Could not reorder: the list may be partly changed. Refresh to see the saved order.');
    }
    // Always re-prime from disk, success or failure — after a partial write
    // the in-memory order is a guess and the disk is the truth.
    await refreshElementsAfterWrite(folder);
  }

  // Track the activeId from the LAST navigation. We force-expand ancestors
  // only when the active narrative just changed (so a newly selected scene
  // is visible in its book/chapter chain). Subsequent renders for the SAME
  // active narrative skip the auto-expand — so the user can collapse the
  // book even if a chapter under it is selected. Without this, the chevron
  // toggle would be silently re-overridden on the next render.
  let lastExpandedForActiveId: string | null = null;

  function render(): void {
    const active = getState().active;
    if (!active) {
      root.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
      return;
    }
    const labels = getWritingLabels(active.worldId);
    const elements = getState().data.elements;
    const idx = buildNarrativeIndex(elements, active.worldId);
    const route = parseHash(window.location.hash);
    const activeId = route.narrativeId ?? null;
    const entry = getState().registry.worlds.find(w => w.id === active.worldId);
    const collapsed = new Set(entry?.writing_tree_collapsed ?? []);
    // Force-expand ancestors only on activeId CHANGE — first render after
    // navigation. After that, respect user's collapse toggles even if the
    // selection's parent is in the collapsed set. (Fixes: book chevron not
    // folding when a child chapter is selected.)
    if (activeId && activeId !== lastExpandedForActiveId) {
      const ancestors = ancestorIds(idx, activeId);
      if (ancestors.length > 0) {
        const current = entry?.writing_tree_collapsed ?? [];
        const filtered = current.filter(id => !ancestors.includes(id));
        if (filtered.length !== current.length) {
          // Persist the auto-expand so subsequent renders + reloads see it.
          const reg = getState().registry;
          const nextWorlds = reg.worlds.map(w =>
            w.id === active.worldId ? { ...w, writing_tree_collapsed: filtered } : w,
          );
          const nextReg = { ...reg, worlds: nextWorlds };
          saveRegistry(nextReg);
          patchSlice('registry', nextReg);
          // The patchSlice will trigger a re-render with the updated set.
          // Mark this id as already expanded so we don't recurse.
          lastExpandedForActiveId = activeId;
          return;
        }
      }
      lastExpandedForActiveId = activeId;
    }
    const q = searchQuery.trim().toLowerCase();
    const matchingIds = q ? collectMatchingIds(idx, q) : null;
    // When filtering, force-open every ancestor of a match so the path is
    // visible. The collapsed set becomes effectively empty within the
    // filter result subset.
    if (matchingIds) {
      for (const id of matchingIds) {
        for (const ancestorId of ancestorIds(idx, id)) {
          collapsed.delete(ancestorId);
        }
      }
    }

    root.innerHTML = '';

    // Band 1 — create row (mirrors the elements sidebar's filter-strip slot).
    // Two stacked buttons fill the same vertical height as the filter strip.
    const createRow = document.createElement('div');
    createRow.className = 'atlas-writing-sidebar-create-row';
    const newBookBtn = document.createElement('button');
    newBookBtn.type = 'button';
    newBookBtn.className = 'atlas-writing-sidebar-create-btn';
    newBookBtn.title = `New ${labels.l1.toLowerCase()}`;
    newBookBtn.innerHTML = `<span class="material-symbols-outlined">add</span><span>new ${escapeText(labels.l1.toLowerCase())}</span>`;
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

    // The "new draft" button is gone (S265, Captain: two parentless create
    // buttons read as two competing entry points). Drafts (l4) stay a working
    // tier — existing ones render and behave — they're just no longer pushed.
    // Chapters and scenes create from their PARENT row's hover "+" instead.

    root.appendChild(createRow);

    // Band 2 — search row (mirrors the elements sidebar's search row exactly).
    // [input] [magnifier opens search room] [tune opens writing settings].
    // Same three-cell layout as elements; magnifier slot identical, the third
    // slot carries writing-specific tune instead of elements' "+".
    const searchRow = document.createElement('div');
    searchRow.className = 'atlas-search-row';

    const searchInput = document.createElement('input');
    searchInput.className = 'atlas-input';
    searchInput.type = 'text';
    searchInput.placeholder = `Search ${labels.l1.toLowerCase()}s...`;
    searchInput.setAttribute('data-role', 'writing-search');
    searchInput.style.flex = '1 1 auto';
    searchInput.value = searchQuery;
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      render();
      // Restore focus + caret to the end after re-render (innerHTML wiped it).
      queueMicrotask(() => {
        const fresh = root.querySelector<HTMLInputElement>('[data-role="writing-search"]');
        if (fresh) {
          fresh.focus();
          fresh.setSelectionRange(searchQuery.length, searchQuery.length);
        }
      });
    });
    searchRow.appendChild(searchInput);

    const globalSearchBtn = document.createElement('button');
    globalSearchBtn.type = 'button';
    globalSearchBtn.className = 'atlas-create-btn atlas-search-everywhere-btn';
    globalSearchBtn.title = 'Search everywhere (all elements)';
    globalSearchBtn.innerHTML = '<span class="material-symbols-outlined">search</span>';
    globalSearchBtn.addEventListener('click', () => {
      // Search room removed (session 256): "search everywhere" hands the query
      // to the elements-sidebar filter — the interim search surface until the
      // Cmd+K palette. Sidebar mode is pure state (session 223 decoupling).
      patchSlice('ui', { ...getState().ui, sidebarMode: 'elements', search: searchQuery, sidebarWritingOverride: true });
      queueMicrotask(() => {
        const input = document.querySelector<HTMLInputElement>('input[data-role="elements-search"]');
        if (input) {
          input.focus();
          input.select();
        }
      });
    });
    searchRow.appendChild(globalSearchBtn);

    const tuneBtn = document.createElement('button');
    tuneBtn.type = 'button';
    tuneBtn.className = 'atlas-create-btn atlas-writing-settings-btn';
    tuneBtn.setAttribute('data-action', 'writing-settings');
    tuneBtn.title = 'Writing settings';
    tuneBtn.innerHTML = '<span class="material-symbols-outlined">tune</span>';
    tuneBtn.addEventListener('click', () => {
      const reg = getState().registry;
      const nextWorlds = reg.worlds.map(w =>
        w.id === active.worldId ? { ...w, writing_initialized: false } : w,
      );
      const nextReg = { ...reg, worlds: nextWorlds };
      saveRegistry(nextReg);
      patchSlice('registry', nextReg);
    });
    searchRow.appendChild(tuneBtn);

    root.appendChild(searchRow);

    // Tree list.
    const list = document.createElement('div');
    list.className = 'atlas-writing-sidebar-list';
    if (idx.roots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'atlas-pane-empty atlas-writing-sidebar-empty';
      empty.textContent = `No ${labels.l1.toLowerCase()}s yet. Use the buttons above to create one.`;
      list.appendChild(empty);
    } else {
      // Render only nodes that match the filter (when active) or all of them.
      const visibleRoots = matchingIds
        ? idx.roots.filter(r => containsAnyMatch(r, matchingIds))
        : idx.roots;
      if (matchingIds && visibleRoots.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'atlas-pane-empty atlas-writing-sidebar-empty';
        empty.textContent = `No matches for "${searchQuery.trim()}".`;
        list.appendChild(empty);
      } else {
        for (const node of visibleRoots) {
          renderNode(node, list, labels, active.worldId, activeId, idx, collapsed, matchingIds);
        }
      }
    }
    root.appendChild(list);
  }

  /**
   * Walk the tree and return the set of nodes whose name (or descendant's
   * name) matches the query. Used to filter the visible tree without
   * collapsing the structure entirely.
   */
  function collectMatchingIds(idx: NarrativeIndex, q: string): Set<string> {
    const matches = new Set<string>();
    for (const node of idx.byId.values()) {
      if ((node.el.name ?? '').toLowerCase().includes(q)) {
        matches.add(node.el.id);
      }
    }
    return matches;
  }

  function containsAnyMatch(node: NarrativeNode, matches: Set<string>): boolean {
    if (matches.has(node.el.id)) return true;
    return node.children.some(c => containsAnyMatch(c, matches));
  }

  /** Count ow:// chips (links) in a story markdown blob. */
  function countOwLinks(story: unknown): number {
    if (typeof story !== 'string' || story.length === 0) return 0;
    const m = story.match(/\]\(ow:\/\//g);
    return m ? m.length : 0;
  }
  /**
   * Total links in this node's prose PLUS every descendant's — a size cue that
   * still means something on a Book (the sum across its chapters and scenes),
   * not just on a leaf Scene.
   */
  function subtreeLinkCount(node: NarrativeNode): number {
    let n = countOwLinks((node.el as Record<string, unknown>).story);
    for (const c of node.children) n += subtreeLinkCount(c);
    return n;
  }

  function renderNode(
    node: NarrativeNode,
    parent: HTMLElement,
    labels: WritingLabels,
    worldId: string,
    activeId: string | null,
    idx: NarrativeIndex,
    collapsed: Set<string>,
    matchingIds: Set<string> | null,
  ): void {
    // When filtering, only render this node if it matches or contains a match.
    if (matchingIds && !containsAnyMatch(node, matchingIds)) return;
    const hasChildren = node.children.length > 0;
    const isCollapsed = hasChildren && collapsed.has(node.el.id);

    const row = document.createElement('div');
    row.className = 'atlas-writing-tree-row';
    if (node.el.id === activeId) row.classList.add('active');
    row.style.paddingLeft = `${node.depth * 14 + 4}px`;

    // Drag-and-drop for sibling reorder (session 224). Each row is draggable;
    // dragover/drop on a sibling row inserts above or below based on mouse y.
    // Same parent_narrative only — re-parenting deferred.
    row.draggable = true;
    const myParent = (node.el as Element & { parent_narrative?: string }).parent_narrative ?? null;

    row.addEventListener('dragstart', (e) => {
      draggingId = node.el.id;
      draggingParent = myParent;
      e.dataTransfer?.setData('text/atlas-narrative', node.el.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      draggingId = null;
      draggingParent = null;
      row.classList.remove('dragging');
      // Belt-and-braces — clear any lingering indicators.
      document.querySelectorAll('.atlas-writing-tree-row.drop-above, .atlas-writing-tree-row.drop-below')
        .forEach(el => el.classList.remove('drop-above', 'drop-below'));
    });
    row.addEventListener('dragover', (e) => {
      if (!draggingId || draggingId === node.el.id) return;
      if (draggingParent !== myParent) return; // sibling-only
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      // Single indicator at a time.
      document.querySelectorAll('.atlas-writing-tree-row.drop-above, .atlas-writing-tree-row.drop-below')
        .forEach(el => {
          if (el !== row) el.classList.remove('drop-above', 'drop-below');
        });
      row.classList.toggle('drop-above', above);
      row.classList.toggle('drop-below', !above);
    });
    row.addEventListener('dragleave', (e) => {
      if (!row.contains(e.relatedTarget as Node)) {
        row.classList.remove('drop-above', 'drop-below');
      }
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!draggingId || draggingId === node.el.id) return;
      if (draggingParent !== myParent) return;
      const rect = row.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      const dragged = draggingId;
      row.classList.remove('drop-above', 'drop-below');
      void reorderSiblings(dragged, node.el.id, above);
    });

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
        saveRegistry(next);
        patchSlice('registry', next);
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
      navigate(writingHash(worldId, node.el.id));
    });
    row.appendChild(body);

    // Link-count badge (Captain, S313): a small right-aligned number = how many
    // links live in this narrative and everything under it — a size cue at a
    // glance. Hidden at zero so an empty tree stays clean.
    const linkCount = subtreeLinkCount(node);
    if (linkCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'atlas-writing-tree-linkcount';
      badge.textContent = String(linkCount);
      badge.title = hasChildren
        ? `${linkCount} link${linkCount === 1 ? '' : 's'} in this ${tierLabel.toLowerCase()} and below`
        : `${linkCount} link${linkCount === 1 ? '' : 's'}`;
      row.appendChild(badge);
    }

    // Hover "+" (S265): create the child tier INSIDE this row — a book row
    // makes a chapter, a chapter row a scene. The container question answers
    // itself: it's the row you clicked. Scenes and drafts get no button.
    const childTier = node.tier === 'l1' ? 'l2' as const : node.tier === 'l2' ? 'l3' as const : null;
    if (childTier) {
      const childLabel = labels[childTier];
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'atlas-writing-tree-row-add';
      addBtn.title = `New ${childLabel.toLowerCase()} in "${node.el.name || `(unnamed ${tierLabel.toLowerCase()})`}"`;
      addBtn.innerHTML = `<span class="material-symbols-outlined">add</span>`;
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        new WritingCreateModal({
          label: childLabel,
          onCreate: async (name) => {
            const created = await createNarrativeAtTier(childTier, node.el.id, name, worldId, toasts);
            if (created) {
              // Un-collapse the parent so the new row is visible immediately.
              if (collapsed.has(node.el.id)) {
                const next = toggleWritingTreeCollapsed(getState().registry, worldId, node.el.id);
                saveRegistry(next);
                patchSlice('registry', next);
              }
              navigate(writingHash(worldId, created.id));
              toasts.info(`${childLabel} created`);
            }
          },
        }).open();
      });
      row.appendChild(addBtn);
    }

    // Right-click → bulk link/unlink over this node + descendants (S265).
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openTreeContextMenu(e, node, tierLabel, toasts);
    });

    parent.appendChild(row);

    if (hasChildren && !isCollapsed) {
      for (const child of node.children) {
        renderNode(child, parent, labels, worldId, activeId, idx, collapsed, matchingIds);
      }
    }
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();

  return () => {
    unsubState();
    unsubHash();
  };
}

function pluralize(word: string): string {
  if (word.endsWith('s')) return word;
  if (word.endsWith('y')) return word.slice(0, -1) + 'ies';
  return word + 's';
}

// ---------------------------------------------------------------------------
// Tree context menu — bulk link/unlink over a node + its descendants (S265)
// ---------------------------------------------------------------------------

function collectSubtreeIds(node: NarrativeNode): string[] {
  return [node.el.id, ...node.children.flatMap(collectSubtreeIds)];
}

let activeTreeMenu: HTMLElement | null = null;
function dismissTreeMenu(): void {
  if (!activeTreeMenu) return;
  activeTreeMenu.remove();
  activeTreeMenu = null;
  document.removeEventListener('mousedown', onTreeMenuOutside, true);
  document.removeEventListener('keydown', onTreeMenuKey, true);
}
const onTreeMenuOutside = (e: MouseEvent): void => {
  if (activeTreeMenu && !activeTreeMenu.contains(e.target as Node)) dismissTreeMenu();
};
const onTreeMenuKey = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') dismissTreeMenu();
};

function openTreeContextMenu(
  e: MouseEvent,
  node: NarrativeNode,
  tierLabel: string,
  toasts: ToastManager,
): void {
  dismissTreeMenu();
  const ids = collectSubtreeIds(node);
  const scope = ids.length > 1
    ? `this ${tierLabel.toLowerCase()} · ${ids.length} narratives`
    : `this ${tierLabel.toLowerCase()}`;

  const menu = document.createElement('div');
  menu.className = 'atlas-prose-context-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <button type="button" class="atlas-prose-context-menu-item" data-role="bulk-link">
      <span class="material-symbols-outlined">link</span>
      <span>Link mentions in ${escapeText(scope)}</span>
    </button>
    <button type="button" class="atlas-prose-context-menu-item" data-role="bulk-unlink">
      <span class="material-symbols-outlined">link_off</span>
      <span>Unlink mentions in ${escapeText(scope)}</span>
    </button>
  `;

  // NOT DURING THE TOUR (S310, integration gate).
  //
  // The tour's `the-writing` step reveals the Hyperion book and its Chapter 1
  // and gates advance on the chip count inside that chapter's story. The
  // writing tree is fully reachable while touring (there is no overlay and
  // `.atlas-tour-locked` is deliberately not pointer-events:none), so a
  // right-click Delete on the book would cascade the chapter away, leave the
  // advance gate permanently unsatisfiable, and render no Next — a soft-locked
  // tour whose only escape is stepping back and redoing the user's linking
  // work. `revealOne` re-creates only on step ENTRY, so there is no self-heal.
  //
  // A scripted walkthrough has no business offering destruction of its own
  // scaffolding. The link/unlink items above stay: they are reversible and the
  // step is about linking.
  if (!isTourFlagActive()) {
    menu.insertAdjacentHTML('beforeend', `
      <button type="button" class="atlas-prose-context-menu-item atlas-context-menu-item-danger" data-role="delete-narrative">
        <span class="material-symbols-outlined">delete</span>
        <span>Delete ${escapeText(tierLabel.toLowerCase())}</span>
      </button>
    `);
  }
  menu.style.position = 'fixed';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.style.zIndex = '1000';
  document.body.appendChild(menu);
  activeTreeMenu = menu;

  menu.querySelector<HTMLElement>('[data-role="bulk-link"]')?.addEventListener('click', () => {
    dismissTreeMenu();
    // Multi-narrative writes touch closed docs — one confirm line (Captain's
    // ruling); a single narrative applies immediately like the corner icon.
    if (ids.length > 1 && !confirm(`Link element mentions across ${ids.length} narratives?`)) return;
    void bulkLinkNarratives(ids, 'link').then(({ changed, count }) => {
      toasts.info(count > 0
        ? `Linked ${count} mention${count === 1 ? '' : 's'} across ${changed} narrative${changed === 1 ? '' : 's'}`
        : 'Nothing new to link');
    });
  });
  menu.querySelector<HTMLElement>('[data-role="bulk-unlink"]')?.addEventListener('click', () => {
    dismissTreeMenu();
    // Always confirm: disk unlinks in closed narratives have no Ctrl+Z.
    if (!confirm(`Unlink every element mention in ${scope}? This can't be undone for closed narratives.`)) return;
    void bulkLinkNarratives(ids, 'unlink').then(({ changed, count }) => {
      toasts.info(count > 0
        ? `Unlinked ${count} mention${count === 1 ? '' : 's'} across ${changed} narrative${changed === 1 ? '' : 's'}`
        : 'No linked mentions found');
    });
  });

  menu.querySelector<HTMLElement>('[data-role="delete-narrative"]')?.addEventListener('click', () => {
    dismissTreeMenu();
    void deleteNarrativeSubtree(node, toasts);
  });

  queueMicrotask(() => {
    document.addEventListener('mousedown', onTreeMenuOutside, true);
    document.addEventListener('keydown', onTreeMenuKey, true);
  });
}

/**
 * Delete a narrative and everything beneath it, from the tree's right-click
 * menu (S310).
 *
 * Routed through `decideDeleteConfirm` so this gesture and the workspace
 * header trash cannot drift apart — they are the same destructive act reached
 * two ways, and the confirm text is the user's only warning before an
 * irreversible loss.
 *
 * ORDER MATTERS. The URL is the source of truth for which narrative the
 * workspace renders (convention #46). If the open narrative is inside the
 * doomed subtree we navigate AWAY FIRST, so the workspace unmounts its editor
 * before the element disappears from under it. Deleting first would leave the
 * middle pane mounted on a element that no longer exists, and — worse — the
 * editor's debounced save could still be holding the deleted narrative.
 */
async function deleteNarrativeSubtree(node: NarrativeNode, toasts: ToastManager): Promise<void> {
  const store = getActiveStore();
  const worldId = getState().active?.worldId;
  if (!store || !worldId) return;
  const el = node.el;

  let dependents: Element[] = [];
  try {
    dependents = await store.findDependents(el.id);
  } catch { /* fall through with none */ }

  const decision = decideDeleteConfirm({
    el,
    dependents,
    allElements: getState().data.elements,
    labels: getWritingLabels(worldId),
    confirmPref: getEditorSettings(getState().registry).confirm_before_delete,
  });
  if (decision.needed && !window.confirm(decision.message)) return;

  // Navigate away BEFORE the delete if the open narrative is going with it.
  const doomed = new Set<string>([el.id, ...dependents.map(d => d.id)]);
  const openId = parseHash(window.location.hash).narrativeId;
  if (openId && doomed.has(openId)) navigate(writingHash(worldId));

  try {
    await store.deleteElement(el.id);
    await refreshElementsAfterWrite(store);
    requestPushIfLinked();
    toasts.success(`Deleted ${el.name || 'narrative'}`);
  } catch (err) {
    console.error('[writing-sidebar] delete failed', err);
    toasts.error(err instanceof Error ? err.message : String(err));
  }
}
