/**
 * Writing room — single-pane editor surface.
 *
 * Session 224 sidebar-takeover: the writing tree moved to the sidebar (see
 * `src/sidebar/writing-sidebar.ts`). The middle pane is now a single-column
 * surface showing the selected narrative's element-detail with a contextual
 * "+ new child" toolbar above it. When no narrative is selected, an empty
 * state directs the user to the sidebar.
 *
 * Setup screen (when `isWritingInitialized` is false) still mounts here.
 *
 * The model: a Narrative belongs to the writing tree iff its supertype
 * matches one of l1-l4. Tier semantics + creation flow defined in
 * `writing-helpers.ts`. See DESIGN_WRITING.md.
 */

import { getState, patchSlice, subscribe } from '../core/state';
import { onHashChange, parseHash, navigate, writingHash } from '../core/router';
import { mountElementDetail } from './element-detail';
import { ToastManager } from '../ui/toast-manager';
import { WritingCreateModal } from '../ui/writing-create-modal';
import { getActiveStore } from '../core/active-store';
import { requestPushIfLinked } from '../sync/sync-attach';
import { mountWritingSetup } from './writing-setup';
import { saveRegistry } from '../registry/registry';
import {
  getWritingLabels,
  getTierForNarrative,
  isWritingNarrative,
  isWritingInitialized,
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
  tier: WritingTier;
  children: NarrativeNode[];
  depth: number;
}

interface NarrativeIndex {
  byId: Map<string, NarrativeNode>;
}

function buildNarrativeIndex(elements: Element[], worldId: string): NarrativeIndex {
  const writingNarratives = elements.filter(e => isWritingNarrative(e, worldId));
  const byId = new Map<string, NarrativeNode>();
  for (const el of writingNarratives) {
    byId.set(el.id, { el, tier: getTierForNarrative(el, worldId), children: [], depth: 0 });
  }
  for (const node of byId.values()) {
    const parentId = (node.el as Element & { parent_narrative?: string }).parent_narrative;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    }
  }
  return { byId };
}

export function mountWriting(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'atlas-writing-room-container';
  target.appendChild(container);

  let unmountInner: (() => void) | null = null;
  let lastMode: 'setup' | 'editor' | 'empty' | null = null;

  function render(): void {
    const active = getState().active;
    if (!active) {
      mountMode('empty');
      return;
    }
    const entry = getState().registry.worlds.find(w => w.id === active.worldId);
    const inited = isWritingInitialized(entry, getState().data.elements);
    mountMode(inited ? 'editor' : 'setup');
  }

  function mountMode(mode: 'setup' | 'editor' | 'empty'): void {
    if (mode === lastMode) return;
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
        lastMode = null;
        render();
      });
      return;
    }
    unmountInner = mountEditor(container, toasts);
  }

  const unsub = subscribe(render);
  const unsubHash = onHashChange(() => {
    // Hash changes don't change mode; editor handles its own routing.
  });
  render();

  return () => {
    unsub();
    unsubHash();
    unmountInner?.();
  };
}

async function createNarrativeAtRoot(
  tier: 'l1' | 'l4',
  name: string,
  worldId: string,
  toasts: ToastManager,
): Promise<Element | null> {
  const folder = getActiveStore();
  if (!folder) {
    toasts.error('No active world.');
    return null;
  }
  const supertype = supertypeForTier(tier, worldId);
  const created = await folder.createElement('narrative', {
    name,
    supertype,
    order: 0,
  } as Partial<Element>);
  const all = await folder.listElements();
  patchSlice('data', { elements: all });
  requestPushIfLinked();
  return created;
}

/**
 * Mount the editor surface: contextual create toolbar + element-detail of
 * the active narrative. The writing tree itself lives in the sidebar.
 */
function mountEditor(container: HTMLElement, toasts: ToastManager): () => void {
  const root = document.createElement('div');
  root.className = 'atlas-writing-editor';
  container.appendChild(root);

  // Tier badge + child-create buttons now live in element-detail's own header
  // (session 224 header unification). The writing editor is just the detail
  // slot — single column, no separate toolbar above.
  const detailSlot = document.createElement('div');
  detailSlot.className = 'atlas-writing-editor-detail-slot';
  root.appendChild(detailSlot);

  let unmountDetail: (() => void) | null = null;
  let mountedDetailForId: string | null = null;

  function render(): void {
    const active = getState().active;
    if (!active) {
      detailSlot.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
      return;
    }
    const labels = getWritingLabels(active.worldId);
    const elements = getState().data.elements;
    const idx = buildNarrativeIndex(elements, active.worldId);
    const route = parseHash(window.location.hash);
    const activeId = route.sceneId ?? route.chapterId ?? route.bookId ?? null;
    const activeNode = activeId ? idx.byId.get(activeId) : null;

    if (!activeNode) {
      // No selection — empty state. Two flavors:
      //   - Tree has narratives (idx.byId non-empty) → pick-from-sidebar copy
      //   - Tree is empty → primary create buttons inline (no narratives yet,
      //     point the user straight at the action)
      unmountDetail?.();
      unmountDetail = null;
      mountedDetailForId = null;
      detailSlot.innerHTML = '';

      const empty = document.createElement('div');
      empty.className = 'atlas-writing-editor-empty';
      if (idx.byId.size > 0) {
        empty.innerHTML = `
          <p class="atlas-writing-editor-empty-headline">
            Pick a ${escapeText(labels.l1.toLowerCase())}, ${escapeText(labels.l2.toLowerCase())},
            ${escapeText(labels.l3.toLowerCase())}, or ${escapeText(labels.l4.toLowerCase())} from the sidebar to begin.
          </p>
        `;
      } else {
        empty.innerHTML = `
          <p class="atlas-writing-editor-empty-headline">No ${escapeText(pluralize(labels.l1.toLowerCase()))} yet.</p>
          <p class="atlas-writing-editor-empty-hint">Start writing by creating one.</p>
          <div class="atlas-writing-editor-empty-actions"></div>
        `;
        const actions = empty.querySelector<HTMLElement>('.atlas-writing-editor-empty-actions')!;

        const newBookBtn = document.createElement('button');
        newBookBtn.type = 'button';
        newBookBtn.className = 'atlas-btn-primary';
        newBookBtn.innerHTML = `<span class="material-symbols-outlined">add</span><span>New ${escapeText(labels.l1.toLowerCase())}</span>`;
        newBookBtn.addEventListener('click', () => {
          new WritingCreateModal({
            label: labels.l1,
            onCreate: async (name) => {
              const created = await createNarrativeAtRoot('l1', name, active.worldId, toasts);
              if (created) {
                navigate(writingHash(active.worldId, created.id));
                toasts.info(`${labels.l1} created`);
              }
            },
          }).open();
        });
        actions.appendChild(newBookBtn);

        const newDraftBtn = document.createElement('button');
        newDraftBtn.type = 'button';
        newDraftBtn.className = 'atlas-btn-ghost';
        newDraftBtn.innerHTML = `<span class="material-symbols-outlined">edit_note</span><span>New ${escapeText(labels.l4.toLowerCase())}</span>`;
        newDraftBtn.addEventListener('click', () => {
          new WritingCreateModal({
            label: labels.l4,
            onCreate: async (name) => {
              const created = await createNarrativeAtRoot('l4', name, active.worldId, toasts);
              if (created) {
                navigate(writingHash(active.worldId, created.id));
                toasts.info(`${labels.l4} created`);
              }
            },
          }).open();
        });
        actions.appendChild(newDraftBtn);
      }
      detailSlot.appendChild(empty);
      return;
    }

    // Mirror selection into ui state so element-detail renders this narrative.
    // Deferred to avoid recursive render mid-flight (see bug fix from earlier
    // in this session — patchSlice synchronously fires subscribers).
    const targetId = activeNode.el.id;
    if (getState().ui.selectedElementId !== targetId) {
      queueMicrotask(() => {
        if (getState().ui.selectedElementId !== targetId) {
          patchSlice('ui', { ...getState().ui, selectedElementId: targetId });
        }
      });
    }

    // Remember the selected narrative for this world so the writing icon in
    // the room nav can restore this view when the user returns from another
    // room. Persist in registry, but only when value actually changes (avoid
    // a save-on-every-render thrash).
    const entry = getState().registry.worlds.find(w => w.id === active.worldId);
    if (entry && entry.last_writing_narrative_id !== targetId) {
      const reg = getState().registry;
      const nextWorlds = reg.worlds.map(w =>
        w.id === active.worldId ? { ...w, last_writing_narrative_id: targetId } : w,
      );
      const nextReg = { ...reg, worlds: nextWorlds };
      saveRegistry(nextReg);
      // Defer the patchSlice — same reason as above (synchronous subscribe).
      queueMicrotask(() => patchSlice('registry', nextReg));
    }

    // Tier badge + child-create buttons live in the element-detail header
    // itself (session 224 header unification). No separate toolbar here.

    // --- Element detail ---
    // Mount once per selected narrative; element-detail has its own state
    // subscription that re-renders when the underlying element changes.
    // Only remount when the selection actually changes id.
    if (mountedDetailForId !== targetId) {
      unmountDetail?.();
      detailSlot.innerHTML = '';
      const detailMount = document.createElement('div');
      detailMount.className = 'atlas-writing-editor-detail-mount';
      detailSlot.appendChild(detailMount);
      unmountDetail = mountElementDetail(detailMount);
      mountedDetailForId = targetId;
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
