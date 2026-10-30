/**
 * Writing room — single-pane editor surface.
 *
 * Sidebar takeover: the writing tree moved to the sidebar (see
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
import { worldIsViewOnly } from '../core/view-only';
import { onHashChange, parseHash, navigate, writingHash, settingsHash } from '../core/router';
import { ToastManager } from '../ui/toast-manager';
import { WritingCreateModal } from '../ui/writing-create-modal';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite } from '../sync/sync-attach';
import { mountWritingSetup } from './writing-setup';
import { saveRegistry } from '../registry/registry';
import {
  getWritingLabels,
  isWritingInitialized,
  supertypeForTier,
  buildNarrativeIndex,
} from './writing-helpers';
import type { Element } from '../core/types';
import { escapeText } from '../core/dom-utils';
import { mountGuideRoomBar } from './guide-room-bar';

// Re-export for backward compat with any callers still importing from writing.
export { getWritingLabels } from './writing-helpers';

/**
 * Type-only import of the workspace module so we can describe its shape at
 * the writing.ts boundary without bundling its contents. The runtime path
 * uses a dynamic `import()` to keep TipTap + ProseMirror out of the main
 * bundle until the user actually opens a writing room. See `loadWorkspace`.
 */
type WorkspaceModule = typeof import('./writing-workspace');

/**
 * Lazily-imported workspace module. Cached after first successful load so
 * subsequent narrative switches don't refetch the chunk.
 */
let workspaceModulePromise: Promise<WorkspaceModule> | null = null;
function loadWorkspace(): Promise<WorkspaceModule> {
  if (!workspaceModulePromise) {
    workspaceModulePromise = import('./writing-workspace');
  }
  return workspaceModulePromise;
}

export function mountWriting(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'atlas-writing-room-container';
  target.appendChild(container);
  // The guide's bar above every mode (#975): setup, the landing and the editor.
  const unmountGuideBar = mountGuideRoomBar(target, 'writing');

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
      container.innerHTML = '<div class="atlas-pane-empty">No world open. Pick one from the sidebar.</div>';
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
    unmountGuideBar();
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
    toasts.error('No world open. Pick one from the sidebar.');
    return null;
  }
  const supertype = supertypeForTier(tier, worldId);
  const created = await folder.createElement('narrative', {
    name,
    supertype,
    order: 0,
  } as Partial<Element>);
  const all = await refreshElementsAfterWrite(folder);
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
  // (the header unification). The writing editor is just the detail
  // slot — single column, no separate toolbar above.
  const detailSlot = document.createElement('div');
  detailSlot.className = 'atlas-writing-editor-detail-slot';
  root.appendChild(detailSlot);

  let unmountDetail: (() => void) | null = null;
  let mountedDetailForId: string | null = null;
  // Bumped on every mountEditor unmount. The async workspace-load .then()
  // captures the value at schedule time and bails if it differs at fire time
  // — prevents a stale async mount from landing into a detached DOM after
  // the user has navigated away from the writing room entirely.
  let mountGeneration = 0;

  function render(): void {
    const active = getState().active;
    if (!active) {
      detailSlot.innerHTML = '<div class="atlas-pane-empty">No world open. Pick one from the sidebar.</div>';
      return;
    }
    const labels = getWritingLabels(active.worldId);
    const elements = getState().data.elements;
    const idx = buildNarrativeIndex(elements, active.worldId);
    // A view-only world reads its stories: no create, no label edit (conv. 149).
    const viewOnly = worldIsViewOnly(active.worldId);
    const route = parseHash(window.location.hash);
    const activeId = route.narrativeId ?? null;
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

      // Room landing header — same big-title treatment as every other room.
      // Only the no-selection state shows it; once a narrative is open the
      // compact entity band (its name) takes over, like every other room.
      const roomHeader = document.createElement('header');
      roomHeader.className = 'atlas-room-header';
      roomHeader.innerHTML = `
        <h1>Writing</h1>
        <p class="atlas-room-subtitle">${viewOnly ? "Read this world's stories." : "Write your world's stories."}</p>
        <p class="atlas-writing-landing-labels">Labels: ${escapeText(labels.l1)} › ${escapeText(labels.l2)} › ${escapeText(labels.l3)}${viewOnly ? '' : ` · <a class="atlas-writing-landing-labels-edit" href="${escapeText(settingsHash(active.worldId, 'writing'))}">Edit</a>`}</p>
      `;
      detailSlot.appendChild(roomHeader);

      const empty = document.createElement('div');
      empty.className = 'atlas-writing-editor-empty';
      if (idx.byId.size > 0) {
        empty.innerHTML = `
          <p class="atlas-writing-editor-empty-headline">
            Pick a ${escapeText(labels.l1.toLowerCase())}, ${escapeText(labels.l2.toLowerCase())},
            ${escapeText(labels.l3.toLowerCase())}, or ${escapeText(labels.l4.toLowerCase())} from the sidebar to begin.
          </p>
        `;
      } else if (viewOnly) {
        empty.innerHTML = `
          <p class="atlas-writing-editor-empty-headline">No ${escapeText(pluralize(labels.l1.toLowerCase()))} in this world.</p>
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

    // NOTE (decoupling): we deliberately do NOT mirror the
    // active narrative into state.ui.selectedElementId. element-detail
    // derives its target element from URL segments when route.mode ===
    // 'writing', so the global selection persists across writing visits.
    // This way the room-nav chip continues to point at whatever the user
    // had selected before entering writing — switching to writing no longer
    // clobbers selection.
    const targetId = activeNode.el.id;

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

    // --- Writing workspace (code-split) ---
    // v3.0 redesign: the workspace replaces the schema-driven
    // element-detail entirely for active narratives in writing mode
    // (convention #51).
    //
    // TipTap + ProseMirror are heavyweight (~140 KB gzipped) and
    // only matter when the writer actually opens a narrative. We dynamic-
    // import the workspace module the first time we need it; subsequent
    // narrative switches hit the cached promise. A loading placeholder
    // fills the slot synchronously so the user never sees a blank pane.
    if (mountedDetailForId !== targetId) {
      unmountDetail?.();
      detailSlot.innerHTML = '';
      const detailMount = document.createElement('div');
      detailMount.className = 'atlas-writing-editor-detail-mount';
      detailMount.innerHTML = '<div class="atlas-writing-workspace-loading">Loading editor…</div>';
      detailSlot.appendChild(detailMount);
      mountedDetailForId = targetId;
      const mountTargetId = targetId; // capture for race-guard
      const mountGen = mountGeneration; // capture generation
      void loadWorkspace().then((mod) => {
        // Race-guards: (a) user switched narratives during the chunk load,
        // (b) user navigated away from writing entirely (mountEditor's
        // cleanup ran and bumped mountGeneration). Either case → drop this
        // mount; the new target (if any) will trigger its own load.
        if (mountGen !== mountGeneration) return;
        if (mountedDetailForId !== mountTargetId) return;
        detailMount.innerHTML = '';
        unmountDetail = mod.mountWritingWorkspace(detailMount);
      }).catch((err) => {
        console.error('[writing] workspace chunk failed to load', err);
        if (mountGen === mountGeneration && mountedDetailForId === mountTargetId) {
          detailMount.innerHTML = '<div class="atlas-pane-empty">Editor failed to load. Reload the page to try again.</div>';
        }
      });
    }
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();

  return () => {
    // Bump the mount generation FIRST so any in-flight async workspace load
    // bails its post-load mount step. unmountDetail handles the case where
    // the workspace already mounted.
    mountGeneration++;
    mountedDetailForId = null;
    unsubState();
    unsubHash();
    unmountDetail?.();
    unmountDetail = null;
  };
}

function pluralize(word: string): string {
  if (word.endsWith('s')) return word;
  if (word.endsWith('y')) return word.slice(0, -1) + 'ies';
  return word + 's';
}
