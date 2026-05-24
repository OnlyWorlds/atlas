/**
 * Writing workspace — dedicated prose-centric editor for the writing room.
 *
 * Replaces the schema-driven element-detail when route.mode === 'writing' AND
 * an active narrative is in the URL hierarchy (book/chapter/scene). The
 * narrative's `story` field renders as a TipTap richtext surface (with the
 * full JSON document mirrored to the atlas-local `atlas_richtext_json`
 * field — convention #47). All other narrative fields collapse into a
 * "Details" disclosure below the prose; the existing "References" panel
 * collapses into its own disclosure.
 *
 * Conventions: #46 (URL → active narrative, no selectedElementId mirror),
 * #47 (atlas_richtext_json storage), #48 (ow:// markdown link format),
 * #49 (atlas_aliases for linking), #50 (auto-derive relations on save),
 * #51 (workspace replaces element-detail in writing mode).
 *
 * See DESIGN_WRITING.md v3.0 for full design.
 */

import { getState, subscribe } from '../core/state';
import { onHashChange, parseHash, writingHash, elementHash, navigate } from '../core/router';
import type { Element } from '../core/types';
import { ELEMENT_LABELS } from '../core/constants';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { toastManager } from '../ui/toast-manager';
import { renderHeader } from './element-detail-header';
import {
  buildNarrativeIndex,
  ancestorIds,
} from './writing-helpers';
import { mountWorkspaceEditor, type WorkspaceEditorHandle, type SearchController } from './writing-workspace-editor';
import { createFindBar, type FindBarHandle } from './writing-workspace-find-bar';
import { ElementCreateModal } from '../ui/element-create-modal';
import { mountCompiledView, narrativeHasChildren } from './writing-compiled';
import { handleAddToCast, type AddToCastDetail } from './writing-workspace-add-to-cast';
import { findAutolinkCandidateAt, convertAutolinkAt } from './writing-workspace-autolink';
import { NARRATIVE_RELATION_FIELDS } from './writing-workspace-derive';
import { openSplitDialog } from './writing-workspace-split';
import { type MentionSuggestionItem } from './writing-workspace-mention';
import { computeRelationPatch } from './writing-workspace-derive';
import { createChipPreview, type ChipPreviewController } from './writing-workspace-chip-preview';
import { getRecents, pushRecent } from './writing-workspace-recents';
import {
  getWordGoal,
  setWordGoal,
  clearWordGoal,
  openWordGoalPopover,
  goalProgress,
} from './writing-workspace-word-goal';
import {
  WRITING_FOCUS_TOGGLE_EVENT,
  WRITING_INLINE_CREATE_EVENT,
  WRITING_SPLIT_EVENT,
} from '../core/hotkeys';
import type { JSONContent } from '@tiptap/core';

/**
 * Public reset (was used to clear per-narrative disclosure state). Disclosures
 * are gone now; this stays as a tiny no-op so existing call-sites don't need
 * to be hunted down. Drop entirely once we're certain there are no callers.
 */
export function resetWritingWorkspaceMemory(): void {
  viewModeByNarrative.clear();
}

/**
 * Writing view mode — selectable when a narrative has children.
 *   - this-level: edit the narrative's own `story` field (default for leaves)
 *   - compiled:   read-only assembly of self + all descendants (default for
 *                 parents — see DESIGN_WRITING.md compiled-view section)
 *
 * Module-level state — ephemeral, resets on world switch via
 * resetWritingWorkspaceMemory. Persisting to registry would couple the model
 * tighter than needed; the default (compiled when has children) already
 * matches the expected behavior for most users.
 */
type WritingViewMode = 'this-level' | 'compiled';
const viewModeByNarrative = new Map<string, WritingViewMode>();

function resolveViewMode(el: Element, allElements: readonly Element[]): WritingViewMode {
  const stored = viewModeByNarrative.get(el.id);
  if (stored) return stored;
  return narrativeHasChildren(el, allElements) ? 'compiled' : 'this-level';
}

/**
 * System-font stacks for the writing workspace. Sans is the default; the
 * others provide stylistic variety without webfont download. Slab gracefully
 * degrades to serif on systems without a true slab face installed.
 */
const PROSE_FONT_STACKS: Record<'sans' | 'serif' | 'slab' | 'mono', string> = {
  sans: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
  serif: `Georgia, 'Iowan Old Style', 'Times New Roman', 'Source Serif Pro', serif`,
  slab: `'Rockwell', 'Roboto Slab', 'Slabo 27px', Georgia, serif`,
  mono: `ui-monospace, 'SF Mono', 'Cascadia Code', 'Roboto Mono', Consolas, 'Liberation Mono', monospace`,
};

export function mountWritingWorkspace(target: HTMLElement): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-writing-workspace';
  target.appendChild(root);

  // Apply per-world prose font size (registry pref → CSS var on root).
  applyProseFontSize(root);

  let editorHandle: WorkspaceEditorHandle | null = null;
  let mountedForId: string | null = null;
  let lastSavedMarkdown: string | null = null;
  let pendingSaveTimer: number | null = null;
  let pendingSnapshot: { markdown: string; json: JSONContent } | null = null;
  // Track last-seen elements array reference so we only rebuild the autolink
  // index (and dispatch a tx) when state.data.elements actually swaps.
  let lastSeenElementsRef: Element[] | null = null;
  // Track inputs to refreshNonEditorSurfaces so UI-only state ticks (popover
  // open, sidebar toggle, hover, etc.) skip the whole 6-replacement cascade.
  // Set by mountForNarrative on first paint; updated after each refresh.
  let lastRefreshEl: Element | null = null;
  let lastRefreshElementsRef: Element[] | null = null;
  // Singleton chip preview controller for this workspace mount — hover +
  // sticky-on-click peek of linked elements (DESIGN_WRITING.md §Click + hover).
  const chipPreview: ChipPreviewController = createChipPreview(root);

  // Find-bar controller proxies onto the CURRENT editor handle's search
  // controller. Editor handles get recreated on narrative switch, so we
  // can't keep a direct reference — the proxy stays valid across switches.
  const findBarSearchProxy: SearchController = {
    setQuery: (opts) => editorHandle?.search.setQuery(opts),
    next: () => editorHandle?.search.next(),
    prev: () => editorHandle?.search.prev(),
    replaceCurrent: (text) => editorHandle?.search.replaceCurrent(text) ?? false,
    replaceAll: (text) => editorHandle?.search.replaceAll(text) ?? 0,
    clear: () => editorHandle?.search.clear(),
    getInfo: () => editorHandle?.search.getInfo() ?? {
      total: 0, currentIndex: 0, query: '', caseSensitive: false, wholeWord: false,
    },
  };
  let findBar: FindBarHandle | null = null;
  function ensureFindBar(): FindBarHandle {
    if (findBar) return findBar;
    findBar = createFindBar(root, {
      search: findBarSearchProxy,
      onClose: () => {
        // Editor regains focus so typing resumes immediately.
        editorHandle?.editor.commands.focus();
      },
    });
    return findBar;
  }

  /**
   * Workspace-scoped find/replace hotkeys (Ctrl+F / Ctrl+H). Listened on the
   * root so they don't conflict with browser-level Ctrl+F outside the writing
   * room. Inline-create (Ctrl+Shift+E) flows through the central hotkey
   * dispatcher and arrives as a custom event — see onInlineCreateEvent below.
   */
  const onWorkspaceHotkey = (e: KeyboardEvent): void => {
    const isMeta = e.ctrlKey || e.metaKey;
    if (!isMeta) return;
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      ensureFindBar().open('find');
    } else if (e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      ensureFindBar().open('replace');
    }
  };
  root.addEventListener('keydown', onWorkspaceHotkey);

  const onInlineCreateEvent = (): void => {
    openInlineCreate();
  };
  document.addEventListener(WRITING_INLINE_CREATE_EVENT, onInlineCreateEvent);

  const onSplitEvent = (): void => {
    openSplitForCurrentCursor();
  };
  document.addEventListener(WRITING_SPLIT_EVENT, onSplitEvent);

  // "Add to cast" event from the writing-context pane's element preview.
  // Implementation lives in writing-workspace-add-to-cast.ts; this listener
  // just forwards the detail + current editor instance.
  const onAddToCast = (e: Event): void => {
    void handleAddToCast(
      (e as CustomEvent).detail as AddToCastDetail,
      editorHandle?.editor ?? null,
    );
  };
  document.addEventListener('atlas:context-add-to-cast', onAddToCast);

  /**
   * Open the split-into-sibling confirm dialog for the current narrative,
   * splitting at the editor's cursor position. Bails (with toast) if no
   * editor / no narrative.
   */
  function openSplitForCurrentCursor(): void {
    const editor = editorHandle?.editor;
    const el = getActiveNarrative();
    const worldId = getState().active?.worldId;
    if (!editor || !el || !worldId) return;
    openSplitDialog({ narrative: el, editor, worldId });
  }
  // contextmenu attaches at root — survives editor remounts on narrative
  // switch. Delegated check inside the handler bails out if the target
  // isn't inside the prose surface.

  /**
   * Inline element creation — opens ElementCreateModal pre-filled with the
   * currently-selected prose text. After create, replaces the selection with
   * an ow:// chip pointing at the new element. Navigation stays in the writing
   * room (suppressNavigate=true). No-op when there's no text selection.
   */
  function openInlineCreate(): void {
    const editor = editorHandle?.editor;
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) {
      toastManager.info('Select some text first, then Ctrl+Shift+E');
      return;
    }
    const selectedText = editor.state.doc.textBetween(from, to, ' ', ' ').trim();
    if (!selectedText) {
      toastManager.info('Selection is empty');
      return;
    }
    new ElementCreateModal(toastManager, {
      initialName: selectedText,
      suppressNavigate: true,
      title: 'Create element from selection',
      onCreated: (id, type) => {
        // Replace the original selected range with an ow:// chip. No trailing
        // space — cursor naturally lands after the chip.
        if (!editorHandle) return;
        editorHandle.editor
          .chain()
          .focus()
          .insertContentAt({ from, to }, [
            { type: 'elementChip', attrs: { id, type, label: selectedText } },
          ])
          .run();
      },
    }).open();
  }

  /**
   * Right-click context menu — when there's a text selection, offers a single
   * action: "Create element from selection". Otherwise lets the browser's
   * native menu show. The menu is a tiny floating div anchored at the click
   * position; click-outside / Esc closes.
   */
  let activeContextMenu: HTMLElement | null = null;
  function dismissContextMenu(): void {
    if (!activeContextMenu) return;
    activeContextMenu.remove();
    activeContextMenu = null;
    document.removeEventListener('mousedown', onContextMenuOutside, true);
    document.removeEventListener('keydown', onContextMenuKey, true);
  }
  const onContextMenuOutside = (e: MouseEvent): void => {
    if (!activeContextMenu) return;
    if (activeContextMenu.contains(e.target as Node)) return;
    dismissContextMenu();
  };
  const onContextMenuKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') dismissContextMenu();
  };
  const onProseContextMenu = (e: MouseEvent): void => {
    // Only fire for events that originated inside the prose surface — the
    // header, sidebar, etc. keep their native menus.
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.atlas-writing-workspace-prose .ProseMirror')) return;
    const editor = editorHandle?.editor;
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;
    const cursorPos = from;
    const docSize = editor.state.doc.content.size;
    const cursorIsMidDoc = cursorPos > 0 && cursorPos < docSize;

    // Detect right-click on an autolink hint — surface a "Link to {name}"
    // action as the mouse-only alternative to Tab. We probe the doc position
    // at the click coordinates so multiple-word matches resolve correctly.
    const onHint = target.closest('.atlas-autolink-hint') !== null;
    let autolinkHit: { name: string; docPos: number } | null = null;
    if (onHint) {
      const probe = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (probe) {
        const found = findAutolinkCandidateAt(editor.view, probe.pos);
        if (found) {
          autolinkHit = { name: found.candidate.displayName, docPos: probe.pos };
        }
      }
    }

    // Detect right-click on a linked chip — surface an "Unlink" action.
    // Locate the chip node at the click coords and capture its range.
    const chipDom = target.closest<HTMLElement>('.atlas-element-chip');
    let chipHit: { id: string; label: string; from: number; to: number } | null = null;
    if (chipDom) {
      const probe = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (probe) {
        const $pos = editor.state.doc.resolve(probe.pos);
        const nodeAfter = $pos.nodeAfter;
        const nodeBefore = $pos.nodeBefore;
        // Inline chip nodes occupy 1 position. The cursor at the click coord
        // may resolve to either side of the chip; check both.
        let chipNode: any = null;
        let chipStart = -1;
        if (nodeAfter && nodeAfter.type.name === 'elementChip') {
          chipNode = nodeAfter;
          chipStart = probe.pos;
        } else if (nodeBefore && nodeBefore.type.name === 'elementChip') {
          chipNode = nodeBefore;
          chipStart = probe.pos - nodeBefore.nodeSize;
        }
        if (chipNode) {
          chipHit = {
            id: chipNode.attrs?.id as string,
            label: (chipNode.attrs?.label as string) || '',
            from: chipStart,
            to: chipStart + chipNode.nodeSize,
          };
        }
      }
    }

    // If we have nothing to offer (no selection, not mid-doc, no autolink, no chip),
    // let the browser show its native menu (copy, paste, etc.).
    if (!hasSelection && !cursorIsMidDoc && !autolinkHit && !chipHit) return;

    e.preventDefault();
    dismissContextMenu();

    const items: string[] = [];
    if (chipHit) {
      items.push(`
        <button type="button" class="atlas-prose-context-menu-item" data-role="unlink-chip">
          <span class="material-symbols-outlined">link_off</span>
          <span>Unlink ${escapeMenuText(chipHit.label || 'chip')}</span>
        </button>
      `);
    }
    if (autolinkHit) {
      items.push(`
        <button type="button" class="atlas-prose-context-menu-item" data-role="link-autolink">
          <span class="material-symbols-outlined">link</span>
          <span>Link to ${escapeMenuText(autolinkHit.name)}</span>
        </button>
      `);
    }
    if (hasSelection) {
      items.push(`
        <button type="button" class="atlas-prose-context-menu-item" data-role="create">
          <span class="material-symbols-outlined">add</span>
          <span>Create element from selection</span>
        </button>
      `);
    }
    if (cursorIsMidDoc) {
      items.push(`
        <button type="button" class="atlas-prose-context-menu-item" data-role="split">
          <span class="material-symbols-outlined">content_cut</span>
          <span>Split here into new sibling</span>
        </button>
      `);
    }

    const menu = document.createElement('div');
    menu.className = 'atlas-prose-context-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = items.join('');
    menu.style.position = 'fixed';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.style.zIndex = '1000';
    document.body.appendChild(menu);
    activeContextMenu = menu;

    menu.querySelector<HTMLElement>('[data-role="create"]')?.addEventListener('click', () => {
      dismissContextMenu();
      openInlineCreate();
    });
    menu.querySelector<HTMLElement>('[data-role="split"]')?.addEventListener('click', () => {
      dismissContextMenu();
      openSplitForCurrentCursor();
    });
    menu.querySelector<HTMLElement>('[data-role="link-autolink"]')?.addEventListener('click', () => {
      dismissContextMenu();
      if (autolinkHit && editorHandle) {
        convertAutolinkAt(editorHandle.editor.view, autolinkHit.docPos);
      }
    });
    menu.querySelector<HTMLElement>('[data-role="unlink-chip"]')?.addEventListener('click', () => {
      dismissContextMenu();
      if (chipHit && editorHandle) {
        void unlinkChipAndMaybeRemoveFromCast(chipHit);
      }
    });
    // Defer the outside-click listener so the contextmenu event that opened
    // us doesn't immediately close.
    queueMicrotask(() => {
      document.addEventListener('mousedown', onContextMenuOutside, true);
      document.addEventListener('keydown', onContextMenuKey, true);
    });
  };

  /** Cheap HTML escape for menu labels — chip names can contain &<>". */
  function escapeMenuText(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Right-click "Unlink" handler. Replaces the chip with its label text
   * (preserves visible reading). Then scans the rest of the prose for any
   * OTHER mentions of the same element id — other chips, or text matches
   * against the element's name + aliases. If none remain AND the id is in
   * the narrative's matching link field, also remove it from that field —
   * stronger "no longer in the cast" gesture than a chip deletion.
   */
  async function unlinkChipAndMaybeRemoveFromCast(
    chip: { id: string; label: string; from: number; to: number },
  ): Promise<void> {
    if (!editorHandle) return;
    const editor = editorHandle.editor;
    // 1. Replace the chip with its plain label text.
    editor
      .chain()
      .focus()
      .insertContentAt({ from: chip.from, to: chip.to }, chip.label || '')
      .run();

    // 2. Scan remaining prose for any other mention of this element id.
    // After the replacement, the doc no longer has THIS chip but may still
    // have other chips with the same id, or text matches via name/aliases.
    const state = getState();
    const targetEl = state.data.elements.find(e => e.id === chip.id);
    if (!targetEl) return;

    // Re-read the editor's current markdown to check for ow://type/id chips.
    const markdown = editorHandle.getMarkdown();
    const otherChipMatch = markdown.includes('/' + chip.id + ')');

    // Text-mention scan: any of the element's surface forms (name + aliases)
    // appearing as a word-bounded match in the prose-as-plain-text view.
    const plainText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n');
    const surfaceForms: string[] = [];
    if (targetEl.name) surfaceForms.push(targetEl.name);
    if (Array.isArray(targetEl.atlas_aliases)) {
      for (const a of targetEl.atlas_aliases) {
        if (typeof a === 'string') surfaceForms.push(a);
      }
    }
    let textMentionFound = false;
    for (const form of surfaceForms) {
      if (form.length < 2) continue;
      const escaped = form.replace(/[\\^$.*+?()\[\]{}|]/g, '\\$&');
      const re = new RegExp('\\b' + escaped + '\\b');
      if (re.test(plainText)) { textMentionFound = true; break; }
    }

    if (otherChipMatch || textMentionFound) return; // Still mentioned — leave the field alone.

    // 3. Remove the id from the narrative's matching link field.
    const narrative = getActiveNarrative();
    if (!narrative) return;
    const field = NARRATIVE_RELATION_FIELDS[targetEl.type];
    if (!field) return;
    const existing = (narrative as Record<string, unknown>)[field];
    if (!Array.isArray(existing)) return;
    const filtered = existing.filter((v): v is string => typeof v === 'string' && v !== chip.id);
    if (filtered.length === existing.length) return; // wasn't there anyway
    const folder = getActiveStore();
    if (!folder) return;
    try {
      await folder.updateElement(narrative.id, {
        [field]: filtered,
      } as Partial<Element>);
      await refreshElementsAfterWrite(folder);
      requestPushIfLinked();
    } catch (err) {
      console.error('[writing-workspace] unlink: field write failed', err);
    }
  }
  root.addEventListener('contextmenu', onProseContextMenu);

  // Focus mode (Cmd+Shift+F via hotkeys.ts) — toggles a class on the workspace
  // root. Sibling chrome (sidebar, room-nav) hides via `.atlas-shell:has(...)`
  // selectors in atlas.css. Esc exits while in focus mode.
  const onFocusToggle = (): void => {
    root.classList.toggle('is-focus-mode');
  };
  const onFocusEsc = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    // Esc exits focus mode OR reading mode (whichever is active). Focus mode
    // takes priority — the user is more visually buried in it.
    if (root.classList.contains('is-focus-mode')) {
      e.preventDefault();
      e.stopPropagation();
      root.classList.remove('is-focus-mode');
      // Sync the action button's aria-pressed state with the class change.
      const focusBtn = root.querySelector<HTMLButtonElement>('.atlas-writing-workspace-action[data-action="focus"]');
      if (focusBtn) focusBtn.setAttribute('aria-pressed', 'false');
      return;
    }
    if (root.classList.contains('is-reading-mode')) {
      e.preventDefault();
      e.stopPropagation();
      root.classList.remove('is-reading-mode');
      const readBtn = root.querySelector<HTMLButtonElement>('.atlas-writing-workspace-action[data-action="reading"]');
      if (readBtn) readBtn.setAttribute('aria-pressed', 'false');
    }
  };
  document.addEventListener(WRITING_FOCUS_TOGGLE_EVENT, onFocusToggle);
  // Capture phase so we beat the editor's own Esc handlers.
  document.addEventListener('keydown', onFocusEsc, true);

  function getActiveNarrative(): Element | null {
    const state = getState();
    const route = parseHash(window.location.hash);
    const id = route.narrativeId ?? null;
    if (!id) return null;
    return state.data.elements.find(e => e.id === id) ?? null;
  }

  /** Match the existing sync debounce window — same UX as inline field edits. */
  function getSaveDebounceMs(): number {
    const ms = getState().registry.sync_debounce_ms;
    return typeof ms === 'number' && ms >= 200 ? ms : 1000;
  }

  function scheduleSave(snapshot: { markdown: string; json: JSONContent }): void {
    pendingSnapshot = snapshot;
    if (pendingSaveTimer !== null) {
      window.clearTimeout(pendingSaveTimer);
    }
    pendingSaveTimer = window.setTimeout(() => {
      pendingSaveTimer = null;
      const snap = pendingSnapshot;
      pendingSnapshot = null;
      if (snap) void persistSnapshot(snap);
    }, getSaveDebounceMs());
  }

  /** Flush any pending save immediately. Called on narrative switch / unmount. */
  async function flushPendingSave(): Promise<void> {
    if (pendingSaveTimer !== null) {
      window.clearTimeout(pendingSaveTimer);
      pendingSaveTimer = null;
    }
    if (pendingSnapshot) {
      const snap = pendingSnapshot;
      pendingSnapshot = null;
      await persistSnapshot(snap);
    }
  }

  /**
   * Page-unload safety net. Browsers fire `pagehide` on tab close, navigation
   * away, and reload — including (unlike `unload`) the back/forward cache
   * lifecycle. We fire the pending save synchronously-ish; if the browser
   * gives the FS Access API enough time to flush, the user's last keystroke
   * lands. Best effort — there is no fully-synchronous file-system write API
   * in the browser, so any guarantee weaker than "we tried" is a lie.
   */
  function onPageHide(): void {
    // Capture latest editor state if onUpdate hasn't fired yet for the most
    // recent transaction (defensive — onUpdate is synchronous from TipTap's
    // dispatchTransaction, so this is rarely a no-op, but cheap insurance).
    if (editorHandle && mountedForId !== null && !pendingSnapshot) {
      const markdown = editorHandle.getMarkdown();
      if (lastSavedMarkdown !== null && markdown !== lastSavedMarkdown) {
        pendingSnapshot = { markdown, json: editorHandle.getJson() };
      }
    }
    void flushPendingSave();
  }
  window.addEventListener('pagehide', onPageHide);

  /**
   * Silent relation-only save. Used by the mount-time self-heal pass to bring
   * stale narrative.<relation> fields current with prose mentions, without
   * touching `story` or `atlas_richtext_json` (those are still the user's
   * canonical writing surface). No save-indicator flash; no toast on failure
   * beyond the console — self-heal is best-effort housekeeping, not a user op.
   */
  async function selfHealRelations(elementId: string, patch: Partial<Element>): Promise<void> {
    const folder = getActiveStore();
    if (!folder) return;
    if (mountedForId !== elementId) return; // workspace tore down or switched
    try {
      await folder.updateElement(elementId, patch);
      await refreshElementsAfterWrite(folder);
      requestPushIfLinked();
    } catch (err) {
      console.error('[writing-workspace] self-heal failed', err);
    }
  }

  async function persistSnapshot(snap: { markdown: string; json: JSONContent }): Promise<void> {
    const el = getActiveNarrative();
    if (!el || el.id !== mountedForId) return;
    const folder = getActiveStore();
    if (!folder) return;

    // Skip no-op writes — markdown unchanged from last save.
    if (lastSavedMarkdown !== null && snap.markdown === lastSavedMarkdown) return;

    const relationPatch = computeRelationPatch(el, snap.markdown);
    const patch: Partial<Element> = {
      story: snap.markdown,
      atlas_richtext_json: snap.json,
      ...relationPatch,
    };

    try {
      await folder.updateElement(el.id, patch);
      lastSavedMarkdown = snap.markdown;
      await refreshElementsAfterWrite(folder);
      requestPushIfLinked();
      // Save-state indicator no longer rendered here — the element-header's
      // sync dot (sets data-state via local_updated_at vs server_updated_at)
      // is now the single source of truth for save/sync visual feedback.
    } catch (err: any) {
      console.error('[writing-workspace] save failed', err);
      toastManager.error('Save failed: ' + (err?.message ?? 'unknown error'));
    }
  }

  // ============================================================================
  // Layout — header + breadcrumb + date + prose + collapsibles + footer
  // ============================================================================

  function render(): void {
    const state = getState();
    if (!state.active) {
      root.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
      teardownEditor();
      return;
    }
    const el = getActiveNarrative();
    if (!el) {
      // Should not happen — writing.ts dispatches to empty state instead.
      root.innerHTML = '<div class="atlas-pane-empty">No narrative selected.</div>';
      teardownEditor();
      return;
    }

    if (mountedForId !== el.id) {
      void flushPendingSave().then(() => mountForNarrative(el));
      return;
    }
    // Same narrative — refresh non-editor surfaces (header, breadcrumb,
    // disclosures) without remounting the editor (would clobber cursor).
    refreshNonEditorSurfaces(el);

    // Live-apply prose font size in case Settings → Writing changed it.
    applyProseFontSize(root);
    applySpellcheck();

    // Live chip label sync — propagate any element renames into the editor's
    // chip nodes. No-op when nothing changed; a single state-driven tick.
    if (editorHandle) {
      const elements = getState().data.elements;
      const byId = new Map<string, { name: string; aliases: string[] }>();
      for (const e of elements) {
        byId.set(e.id, {
          name: e.name || '',
          aliases: Array.isArray(e.atlas_aliases) ? e.atlas_aliases : [],
        });
      }
      editorHandle.syncChipLabels((id) => byId.get(id) ?? null);
      // Refresh autolink index only when the elements array reference swaps —
      // skip the no-op tx on ticks where only e.g. UI state changed.
      if (elements !== lastSeenElementsRef) {
        editorHandle.refreshAutolink(elements);
        lastSeenElementsRef = elements;
      }
    }
  }

  function mountForNarrative(el: Element): void {
    teardownEditor();
    root.innerHTML = '';
    mountedForId = el.id;
    lastSavedMarkdown = el.story ?? null;

    // Self-heal pass: if this narrative's `story` markdown contains ow:// links
    // whose UUIDs aren't reflected in the multi-link relation fields yet
    // (convention #50), bring relations current with one quiet save. Covers
    // legacy markdown-only narratives loaded from another OW tool, and any
    // narrative whose relations drifted from the prose. No-op when relations
    // already match. Deferred to a microtask so the editor mounts first.
    if (typeof el.story === 'string' && el.story.length > 0) {
      const initialPatch = computeRelationPatch(el, el.story);
      if (Object.keys(initialPatch).length > 0) {
        queueMicrotask(() => {
          void selfHealRelations(el.id, initialPatch);
        });
      }
    }

    // 1. Header (reuse element-detail-header for visual + behavioral consistency).
    root.appendChild(renderHeader(el));

    // 2. Sticky bar — breadcrumb + date + action icons. Chrome-level sibling
    // of the scrollable body so it's always visible without needing
    // position:sticky on the body's first child.
    root.appendChild(renderBreadcrumbAndDate(el));

    // 3. Body wrapper — scrollable, with section spacing.
    const body = document.createElement('div');
    body.className = 'atlas-writing-workspace-body';
    body.dataset.elementId = el.id;
    root.appendChild(body);

    // Cast strip / Details disclosure / References disclosure moved to the
    // right-pane writing-context tab (session 229). The writing room is now
    // prose-pure: sticky bar above, prose, ambient word count. Anything else
    // lives in the context pane (right) or element-detail (open-as-element).

    // 4. Prose surface — either TipTap editor (this-level mode) or compiled
    // view (parents in compiled mode). The compiled view is read-only and
    // assembles self + descendants in order.
    const proseHost = document.createElement('div');
    proseHost.className = 'atlas-writing-workspace-prose';
    body.appendChild(proseHost);

    const viewMode = resolveViewMode(el, getState().data.elements);
    if (viewMode === 'compiled') {
      // Compiled view — read-only assembly. No editor handle; save paths and
      // mention picker stay dormant. Auto-revert to this-level if a structure
      // change leaves the narrative with no children.
      mountCompiledView(proseHost, el);
    } else {
      const initialJson = parseRichtextJson(el.atlas_richtext_json);
      const initialMarkdown = typeof el.story === 'string' ? el.story : '';

      editorHandle = mountWorkspaceEditor({
        target: proseHost,
        initialJson,
        initialMarkdown,
        autolinkSeed: { elements: getState().data.elements },
        onUpdate: (snap) => {
          scheduleSave({ markdown: snap.markdown, json: snap.json });
          updateWordCountIndicator(snap.wordCount);
          // Save-state indicator no longer rendered; element-header sync dot
          // handles dirty/synced feedback via local_updated_at vs server_updated_at.
        },
        mentionItems: (query) => buildMentionItems(query),
        onChipHover: (chip, id, type) => chipPreview.scheduleHoverShow(chip, id, type),
        onChipUnhover: () => chipPreview.scheduleHoverHide(),
        onChipClick: (_chip, id, _type) => {
          // Route chip clicks to the context pane — select the clicked
          // element there (preview slides in, lists highlight, graph
          // highlights). The hover preview popover stays for quick peeks;
          // click is the "commit to looking at this in detail" gesture and
          // belongs in the unified selection surface (the context pane).
          chipPreview.hideNow();
          document.dispatchEvent(new CustomEvent('atlas:context-select-element', {
            detail: { id },
          }));
        },
        onMentionInserted: (id) => {
          const worldId = getState().active?.worldId;
          if (worldId) pushRecent(worldId, id);
        },
      });

      // Sync chip labels to current element names immediately on mount —
      // covers the case where atlas_richtext_json was stored when elements
      // had different names. The synchronous sync triggers onUpdate (tx =
      // docChange), which schedules a save that persists the fresh labels.
      const elements = getState().data.elements;
      const byId = new Map<string, { name: string; aliases: string[] }>();
      for (const e of elements) {
        byId.set(e.id, {
          name: e.name || '',
          aliases: Array.isArray(e.atlas_aliases) ? e.atlas_aliases : [],
        });
      }
      editorHandle.syncChipLabels((id) => byId.get(id) ?? null);
      // Apply per-world spellcheck preference to the contenteditable.
      applySpellcheck();
    }

    // 5/6 — disclosures removed (moved to context pane).

    // 7. Ambient word-count widget — anchored bottom-right corner of the
    // workspace root (NOT inside the scrollable body, so it stays visible
    // across long narratives without scroll). Click → goal popover.
    root.appendChild(renderWordCountWidget(el));

    // Prime the refresh-cache so the next render() tick is a no-op until
    // either the active narrative or the elements array reference changes.
    lastRefreshEl = el;
    lastRefreshElementsRef = getState().data.elements;
  }

  function refreshNonEditorSurfaces(el: Element): void {
    // Update header, breadcrumb, disclosures, ambient word count — but DON'T
    // touch the editor. The editor's DOM stays because we never wipe
    // `.atlas-writing-workspace-prose`'s contents — the editor instance owns
    // that subtree.
    const body = root.querySelector<HTMLElement>('.atlas-writing-workspace-body');
    if (!body) return;

    // Skip the cascade entirely when nothing relevant changed since the last
    // refresh. UI-only state ticks (popover open/close, sidebar mode toggle,
    // chip hover, find-bar interactions) re-enter render() but mutate neither
    // the active narrative nor the elements array — those should be no-ops
    // here. Typing ticks DO swap state.data.elements (debounced save → store
    // patch), so they fall through and refresh.
    const elementsRef = getState().data.elements;
    if (el === lastRefreshEl && elementsRef === lastRefreshElementsRef) return;
    lastRefreshEl = el;
    lastRefreshElementsRef = elementsRef;

    // Replace header (cheap — the renderHeader function is the same one
    // element-detail uses; works fine to re-render on every state change).
    const oldHeader = root.querySelector<HTMLElement>('.atlas-middle-header');
    const newHeader = renderHeader(el);
    if (oldHeader) oldHeader.replaceWith(newHeader);

    // Replace sticky bar (breadcrumb + date + action icons).
    const oldCrumb = root.querySelector<HTMLElement>(':scope > .atlas-writing-workspace-crumb');
    const newCrumb = renderBreadcrumbAndDate(el);
    if (oldCrumb) oldCrumb.replaceWith(newCrumb);

    // Cast / Details / References surfaces moved to the context pane (right
    // pane writing-context tab). No replacements needed here anymore.

    // Replace ambient word-count widget (anchored on workspace root, not body).
    const oldWc = root.querySelector<HTMLElement>(':scope > .atlas-writing-workspace-wc-corner');
    const newWc = renderWordCountWidget(el);
    if (oldWc) oldWc.replaceWith(newWc);
    else root.appendChild(newWc);
  }

  function teardownEditor(): void {
    if (editorHandle) {
      editorHandle.destroy();
      editorHandle = null;
    }
    mountedForId = null;
    lastSavedMarkdown = null;
    lastRefreshEl = null;
    lastRefreshElementsRef = null;
  }

  // ============================================================================
  // Sub-renderers
  // ============================================================================

  function renderBreadcrumbAndDate(el: Element): HTMLElement {
    // Sticky bar below the 36px element header. Single horizontal row:
    //   [crumb › crumb › current  📅 dates]              [focus][read][open]
    // Crumbs + date on the left (ellipsize as needed), action icons on right.
    // position: sticky in CSS so it pins to the top of the scrollable body.
    const wrap = document.createElement('div');
    wrap.className = 'atlas-writing-workspace-crumb';

    const state = getState();
    const worldId = state.active!.worldId;
    const idx = buildNarrativeIndex(state.data.elements, worldId);
    const chain = ancestorIds(idx, el.id);

    const left = document.createElement('div');
    left.className = 'atlas-writing-workspace-crumb-left';
    wrap.appendChild(left);

    const crumbs: Array<{ id: string; name: string }> = [];
    for (const ancestorId of chain) {
      const node = idx.byId.get(ancestorId);
      if (node) crumbs.push({ id: ancestorId, name: node.el.name || '(unnamed)' });
    }
    crumbs.push({ id: el.id, name: el.name || '(unnamed)' });

    const crumbsRow = document.createElement('div');
    crumbsRow.className = 'atlas-writing-workspace-crumbs';
    crumbs.forEach((c, i) => {
      const isLast = i === crumbs.length - 1;
      const seg = document.createElement(isLast ? 'span' : 'a');
      seg.className = 'atlas-writing-workspace-crumb-seg' + (isLast ? ' is-current' : '');
      seg.textContent = c.name;
      if (!isLast) {
        (seg as HTMLAnchorElement).href = '#' + buildCrumbHash(worldId, c.id);
        seg.addEventListener('click', (e) => {
          e.preventDefault();
          navigate(buildCrumbHash(worldId, c.id));
        });
      }
      crumbsRow.appendChild(seg);
      if (!isLast) {
        const sep = document.createElement('span');
        sep.className = 'atlas-writing-workspace-crumb-sep';
        sep.textContent = '›';
        crumbsRow.appendChild(sep);
      }
    });
    left.appendChild(crumbsRow);

    // Date pill — inline next to the breadcrumb. Only renders when at least
    // one bound is set. Small event icon + range/single-value text.
    const start = el.start_date;
    const end = el.end_date;
    if (start != null || end != null) {
      const dateBadge = document.createElement('span');
      dateBadge.className = 'atlas-writing-workspace-date';
      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined';
      icon.textContent = 'event';
      dateBadge.appendChild(icon);
      const dateText = document.createElement('span');
      if (start != null && end != null) {
        dateText.textContent = `${start} → ${end}`;
      } else if (start != null) {
        dateText.textContent = String(start);
      } else {
        dateText.textContent = `→ ${end}`;
      }
      dateBadge.appendChild(dateText);
      left.appendChild(dateBadge);
    }

    // Right cluster — view-mode toggle (when narrative has children) + action
    // icons. Save state already lives in the element header's sync dot.
    const right = document.createElement('div');
    right.className = 'atlas-writing-workspace-crumb-actions';

    // View-mode toggle — only when this narrative has descendants. Lets the
    // user switch between editing THIS narrative's prose and a read-only
    // compiled view of self + descendants.
    if (narrativeHasChildren(el, state.data.elements)) {
      const mode = resolveViewMode(el, state.data.elements);
      const toggle = document.createElement('div');
      toggle.className = 'atlas-writing-workspace-viewmode';
      toggle.setAttribute('role', 'tablist');

      const thisBtn = document.createElement('button');
      thisBtn.type = 'button';
      thisBtn.className = 'atlas-writing-workspace-viewmode-btn';
      thisBtn.setAttribute('role', 'tab');
      thisBtn.dataset.mode = 'this-level';
      thisBtn.textContent = 'This level';
      thisBtn.setAttribute('aria-selected', mode === 'this-level' ? 'true' : 'false');
      thisBtn.addEventListener('click', () => {
        if (resolveViewMode(el, getState().data.elements) === 'this-level') return;
        viewModeByNarrative.set(el.id, 'this-level');
        void flushPendingSave().then(() => mountForNarrative(el));
      });
      toggle.appendChild(thisBtn);

      const compiledBtn = document.createElement('button');
      compiledBtn.type = 'button';
      compiledBtn.className = 'atlas-writing-workspace-viewmode-btn';
      compiledBtn.setAttribute('role', 'tab');
      compiledBtn.dataset.mode = 'compiled';
      compiledBtn.textContent = 'Compiled';
      compiledBtn.setAttribute('aria-selected', mode === 'compiled' ? 'true' : 'false');
      compiledBtn.addEventListener('click', () => {
        if (resolveViewMode(el, getState().data.elements) === 'compiled') return;
        viewModeByNarrative.set(el.id, 'compiled');
        void flushPendingSave().then(() => mountForNarrative(el));
      });
      toggle.appendChild(compiledBtn);

      right.appendChild(toggle);
    }

    const focusBtn = document.createElement('button');
    focusBtn.type = 'button';
    focusBtn.className = 'atlas-icon-btn-sm atlas-writing-workspace-action';
    focusBtn.dataset.action = 'focus';
    focusBtn.title = 'Focus mode (Ctrl+Shift+F)';
    focusBtn.setAttribute('aria-pressed', root.classList.contains('is-focus-mode') ? 'true' : 'false');
    focusBtn.innerHTML = '<span class="material-symbols-outlined">center_focus_strong</span>';
    focusBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent(WRITING_FOCUS_TOGGLE_EVENT));
      focusBtn.setAttribute('aria-pressed', root.classList.contains('is-focus-mode') ? 'true' : 'false');
    });
    right.appendChild(focusBtn);

    const readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.className = 'atlas-icon-btn-sm atlas-writing-workspace-action';
    readBtn.dataset.action = 'reading';
    readBtn.title = 'Reading mode';
    readBtn.setAttribute('aria-pressed', root.classList.contains('is-reading-mode') ? 'true' : 'false');
    readBtn.innerHTML = '<span class="material-symbols-outlined">menu_book</span>';
    readBtn.addEventListener('click', () => {
      const isOn = root.classList.toggle('is-reading-mode');
      readBtn.setAttribute('aria-pressed', String(isOn));
    });
    right.appendChild(readBtn);

    const openBtn = document.createElement('a');
    openBtn.className = 'atlas-icon-btn-sm atlas-writing-workspace-action';
    openBtn.dataset.action = 'open-as-element';
    openBtn.title = 'Open as element';
    openBtn.href = '#' + elementHash(worldId, el.id);
    openBtn.innerHTML = '<span class="material-symbols-outlined">open_in_new</span>';
    openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(elementHash(worldId, el.id));
    });
    right.appendChild(openBtn);

    wrap.appendChild(right);

    return wrap;
  }

  function buildCrumbHash(worldId: string, narrativeId: string): string {
    // After URL-scheme shortening (session 227), each crumb segment is just a
    // direct writing-room URL for that narrative. Ancestry is derived from
    // parent_narrative at render time.
    return writingHash(worldId, narrativeId);
  }

  /**
   * Ambient word-count widget. Position-absolute on the workspace root,
   * bottom-right corner. Always visible regardless of scroll. Click opens
   * the session word-goal popover.
   *
   * Replaces the legacy footer entirely. Reading time, save-state, and
   * open-as-element moved to the sticky bar (or, in save-state's case,
   * the element-header sync dot — convention #5 follow-through).
   */
  function renderWordCountWidget(el: Element): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-writing-workspace-wc-corner';

    const wordCount = editorHandle?.getWordCount() ?? 0;
    const worldId = getState().active!.worldId;
    const goal = getWordGoal(worldId, el.id);

    const wcBtn = document.createElement('button');
    wcBtn.type = 'button';
    wcBtn.className = 'atlas-writing-workspace-wc-btn';
    wcBtn.title = goal != null
      ? `${wordCount.toLocaleString()} / ${goal.toLocaleString()} words — click to change goal`
      : 'Click to set session word goal';
    if (goal != null) wcBtn.dataset.hasGoal = 'true';
    renderWordCountInto(wcBtn, wordCount, goal);
    wcBtn.addEventListener('click', () => {
      openWordGoalPopover({
        anchor: wcBtn,
        currentGoal: getWordGoal(worldId, el.id),
        onSet: (next) => {
          setWordGoal(worldId, el.id, next);
          const liveCount = editorHandle?.getWordCount() ?? 0;
          renderWordCountInto(wcBtn, liveCount, next);
          wcBtn.dataset.hasGoal = 'true';
        },
        onClear: () => {
          clearWordGoal(worldId, el.id);
          const liveCount = editorHandle?.getWordCount() ?? 0;
          renderWordCountInto(wcBtn, liveCount, null);
          delete wcBtn.dataset.hasGoal;
        },
      });
    });
    wrap.appendChild(wcBtn);
    return wrap;
  }

  function updateWordCountIndicator(wordCount: number): void {
    const btn = root.querySelector<HTMLElement>('.atlas-writing-workspace-wc-btn');
    if (!btn) return;
    const worldId = getState().active?.worldId;
    const narrId = mountedForId;
    const goal = worldId && narrId ? getWordGoal(worldId, narrId) : null;
    renderWordCountInto(btn, wordCount, goal);
  }

  /**
   * Paint the word-count button's contents — optional progress ring + count
   * + optional `/ goal` suffix. Pure DOM write, doesn't read state, so the
   * caller controls whether the goal is current.
   */
  function renderWordCountInto(btn: HTMLElement, wordCount: number, goal: number | null): void {
    const formatted = wordCount.toLocaleString();
    const goalText = goal != null ? ` / ${goal.toLocaleString()}` : '';
    const fraction = goalProgress(wordCount, goal);
    const ringHtml = goal != null
      ? `<span class="atlas-writing-workspace-wc-ring" style="--progress: ${fraction.toFixed(3)};" data-complete="${fraction >= 1 ? 'true' : 'false'}"></span>`
      : '';
    btn.innerHTML = `
      ${ringHtml}
      <span class="atlas-writing-workspace-wc">${formatted} words</span>
      ${goal != null ? `<span class="atlas-writing-workspace-wc-goal">${goalText}</span>` : ''}
    `;
  }

  // ============================================================================
  // Mention items provider — alias-aware fuzzy match across the world
  // ============================================================================

  function buildMentionItems(query: string): MentionSuggestionItem[] {
    const state = getState();
    if (!state.active) return [];
    const worldId = state.active.worldId;
    const q = query.toLowerCase().trim();
    const elements = state.data.elements;
    const byId = new Map<string, Element>();
    for (const e of elements) byId.set(e.id, e);

    // Element types that shouldn't appear in the picker — they aren't
    // narrative-linkable entities. Markers and pins are map-internal
    // (anchors on maps, not story characters/places). Narratives can't
    // link to themselves. Maps are debatable but excluded for v1 to keep
    // the picker focused on world-building entities.
    const PICKER_EXCLUDED_TYPES = new Set(['narrative', 'pin', 'marker', 'map']);

    // Empty query → recently-edited elements (by local_updated_at desc),
    // with picker recents promoted to the top. "Recently-edited" matches
    // the writer's natural workflow ("I just touched X, now I'm writing
    // about it"). Once the user types, fuzzy match takes over.
    if (q === '') {
      const out: MentionSuggestionItem[] = [];
      const seen = new Set<string>();
      // First: explicit picker recents (the writer's intentional history).
      for (const id of getRecents(worldId)) {
        const el = byId.get(id);
        if (!el || PICKER_EXCLUDED_TYPES.has(el.type)) continue;
        seen.add(id);
        out.push(toItem(el));
      }
      // Then: recently-edited elements (whatever the writer touched lately
      // in element-detail elsewhere — Drizzle's description, etc.). Sorted
      // by local_updated_at desc. Pad up to 8.
      if (out.length < 8) {
        const byMtime = elements
          .filter(e => !PICKER_EXCLUDED_TYPES.has(e.type) && !seen.has(e.id))
          .slice()
          .sort((a, b) => {
            const aT = a.local_updated_at ?? '';
            const bT = b.local_updated_at ?? '';
            return aT < bT ? 1 : aT > bT ? -1 : 0;
          });
        for (const el of byMtime) {
          if (out.length >= 8) break;
          out.push(toItem(el));
        }
      }
      return out;
    }

    const scored: Array<{ score: number; item: MentionSuggestionItem }> = [];
    for (const el of elements) {
      if (PICKER_EXCLUDED_TYPES.has(el.type)) continue;
      const aliases = el.atlas_aliases;
      const name = (el.name || '').toLowerCase();
      const aliasMatches = Array.isArray(aliases) ? aliases.map(a => a.toLowerCase()) : [];

      let score = 0;
      if (name.startsWith(q)) {
        score = 100;
      } else if (name.includes(q)) {
        score = 50;
      } else if (aliasMatches.some(a => a.startsWith(q))) {
        score = 80;
      } else if (aliasMatches.some(a => a.includes(q))) {
        score = 40;
      }
      if (score === 0) continue;

      scored.push({ score, item: toItem(el) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.item).slice(0, 50);
  }

  function toItem(el: Element): MentionSuggestionItem {
    const aliases = el.atlas_aliases;
    return {
      id: el.id,
      type: el.type,
      name: el.name || '(unnamed)',
      subtitle: buildSubtitle(el),
      aliases,
    };
  }

  function buildSubtitle(el: Element): string | undefined {
    // For v1 keep it light — just the element-type label. Disambiguation by
    // parent location / family / etc. is a polish refinement.
    return ELEMENT_LABELS[el.type]?.singular;
  }

  /**
   * Read the per-world writing font preferences (size + family) and set them
   * as CSS custom properties on the workspace root. Called once at mount and
   * again via state subscription so Settings → Writing changes take effect
   * live. The font-family map is centralized here so adding a new preset
   * is one tiny edit.
   */
  /**
   * Apply the per-world spellcheck preference to the editor's contenteditable.
   * Reads writing_spellcheck (default true) from the world's registry entry
   * and sets the attribute. Runs on every render() so toggling Settings →
   * Writing → Spellcheck takes effect live.
   */
  function applySpellcheck(): void {
    if (!editorHandle) return;
    const state = getState();
    const active = state.active;
    if (!active) return;
    const entry = state.registry.worlds.find(w => w.id === active.worldId);
    const enabled = entry?.writing_spellcheck !== false;
    editorHandle.editor.view.dom.setAttribute('spellcheck', enabled ? 'true' : 'false');
  }

  function applyProseFontSize(workspaceRoot: HTMLElement): void {
    const state = getState();
    const active = state.active;
    if (!active) return;
    const entry = state.registry.worlds.find(w => w.id === active.worldId);
    const raw = entry?.writing_font_size_px;
    const px = typeof raw === 'number' && raw >= 12 && raw <= 22 ? raw : 15;
    workspaceRoot.style.setProperty('--atlas-prose-font-size', `${px}px`);

    const fam = entry?.writing_font_family ?? 'sans';
    workspaceRoot.style.setProperty('--atlas-prose-font-family', PROSE_FONT_STACKS[fam] ?? PROSE_FONT_STACKS.sans);
  }

  function parseRichtextJson(raw: unknown): JSONContent | null {
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as JSONContent;
      } catch {
        return null;
      }
    }
    if (typeof raw === 'object') return raw as JSONContent;
    return null;
  }

  // ============================================================================
  // Lifecycle wiring
  // ============================================================================

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();

  return () => {
    // Cleanup contract is synchronous, but the folder write inside
    // persistSnapshot is async. We initiate the write FIRST (with a defensive
    // snapshot capture in case onUpdate hasn't run for the latest transaction),
    // then run the rest of the teardown. persistSnapshot reads its inputs
    // through closure-captured locals (folder, lastSavedMarkdown), so the
    // write itself completes after teardown without depending on still-alive
    // workspace state. teardownEditor nulls `mountedForId`, but that check in
    // persistSnapshot runs BEFORE the first `await`, so the in-flight write
    // proceeds even though new persists won't.
    if (editorHandle && mountedForId !== null && !pendingSnapshot) {
      const markdown = editorHandle.getMarkdown();
      if (lastSavedMarkdown !== null && markdown !== lastSavedMarkdown) {
        pendingSnapshot = { markdown, json: editorHandle.getJson() };
      }
    }
    void flushPendingSave();
    window.removeEventListener('pagehide', onPageHide);
    unsubState();
    unsubHash();
    root.removeEventListener('keydown', onWorkspaceHotkey);
    document.removeEventListener(WRITING_INLINE_CREATE_EVENT, onInlineCreateEvent);
    document.removeEventListener(WRITING_SPLIT_EVENT, onSplitEvent);
    document.removeEventListener('atlas:context-add-to-cast', onAddToCast);
    root.removeEventListener('contextmenu', onProseContextMenu);
    dismissContextMenu();
    document.removeEventListener(WRITING_FOCUS_TOGGLE_EVENT, onFocusToggle);
    document.removeEventListener('keydown', onFocusEsc, true);
    chipPreview.destroy();
    findBar?.destroy();
    findBar = null;
    teardownEditor();
  };
}
