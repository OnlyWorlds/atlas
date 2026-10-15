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
import { onHashChange, parseHash } from '../core/router';
import type { Element } from '../core/types';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { toastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import { noteOpenedFromStory } from './story-notice';
import { diskChangeFor, storyChangedAlone } from '../core/live-folder';
import { renderHeader, isEditingIn } from './element-detail-header';
import { mountWorkspaceEditor, linkTermInEditor, type WorkspaceEditorHandle, type SearchController } from './writing-workspace-editor';
import { createFindBar, type FindBarHandle } from './writing-workspace-find-bar';
import { compiledWordCount, mountCompiledView, narrativeHasChildren } from './writing-compiled';
import { handleAddToCast, type AddToCastDetail } from './writing-workspace-add-to-cast';
import { computeRelationPatch, linkTargetsIn } from './writing-workspace-derive';
import { createChipPreview, type ChipPreviewController } from './writing-workspace-chip-preview';
import { pushRecent } from './writing-workspace-recents';
import { buildMentionItems } from './writing-workspace-mention-items';
import { createWordCount } from './writing-workspace-word-count';
import { createStickyBar } from './writing-workspace-sticky-bar';
import { createProseContextMenu } from './writing-workspace-context-menu';
import { convertAllAutolinks, unlinkAllChips } from './writing-workspace-autolink';
import { setLiveEditorOps } from './writing-live-editor-ops';
import { createLinkAllCorner } from './prose-linkall-corner';
import { createCompiledSearch } from './writing-compiled-search';
import { bulkLinkTerm } from './writing-bulk-link';
import { recordAliasIfForeign } from './prose-link-existing';
import { collectNarrativeDescendants } from '../core/narrative-delete';
import { pickElement } from '../ui/element-picker-modal';
import { WRITING_FOCUS_TOGGLE_EVENT } from '../core/hotkeys';
import type { JSONContent } from '@tiptap/core';
import { onLeaveWorld } from '../core/leave-flush';

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
export type WritingViewMode = 'this-level' | 'compiled';
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

/**
 * A prose write in flight. `id` is the narrative the text was typed into and
 * `baseline` is what was last known saved for THAT narrative — both captured
 * when the save was scheduled, never re-derived later. The route, the mounted
 * editor and the workspace itself may all have moved on by the time this
 * lands; none of them are consulted (S323).
 */
type PendingWrite = {
  id: string;
  baseline: string | null;
  markdown: string;
  json: JSONContent;
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
  /**
   * The pending write carries the id of the narrative the text CAME FROM, and
   * the baseline it was typed against. Both are captured at schedule time, so
   * a flush that runs after the route has already moved still writes to the
   * right element (S323 — the room-exit data-loss class; see persistSnapshot).
   */
  let pendingSnapshot: PendingWrite | null = null;
  // The latest save started per narrative (S368): "Retry now" on a failed
  // save runs only while no later save of that narrative has started, so an
  // older text never overwrites a newer one.
  const latestSave = new Map<string, number>();
  let saveSeq = 0;
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

  // Set by mountForNarrative to the mounted narrative when the COMPILED view
  // is showing, null in this-level mode. The compiled view has no editor, so
  // its count comes from the assembled tree instead of an editor handle.
  let compiledCountFor: Element | null = null;

  // Ambient word-count widget controller. The factory closes over root + a
  // count accessor, so the indicator tracks whichever prose surface is
  // mounted without owning the difference between them.

  const wordCount = createWordCount({
    root,
    getCount: () => (compiledCountFor
      ? compiledWordCount(compiledCountFor, getState().data.elements)
      : editorHandle?.getWordCount() ?? 0),
    getMountedForId: () => mountedForId,
  });

  // Sticky bar (breadcrumb + date + action buttons + view-mode toggle).
  // View-mode switching defers back here because it owns the editor remount.
  const stickyBar = createStickyBar({
    root,
    getViewMode: (el) => resolveViewMode(el, getState().data.elements),
    onSwitchViewMode: (el, mode) => {
      viewModeByNarrative.set(el.id, mode);
      void flushPendingSave().then(() => mountForNarrative(el));
    },
    onFind: () => openFind('find'),
  });

  // Prose right-click menu + inline-create / split / unlink-chip actions.
  // Attaches its own contextmenu + hotkey-event listeners; torn down in cleanup.
  const proseMenu = createProseContextMenu({
    root,
    getEditorHandle: () => editorHandle,
    getActiveNarrative,
  });

  // Find in the COMPILED view (S355): a DOM-marking controller over the
  // read-only rendering, so Ctrl+F and "Link to element" work at chapter and
  // book level, not only in scenes.
  const compiledSearch = createCompiledSearch(
    () => root.querySelector<HTMLElement>('.atlas-writing-compiled'),
  );

  // Find-bar controller proxies onto whichever surface is mounted: the
  // CURRENT editor handle's search controller in this-level mode, the
  // compiled DOM controller in compiled mode. Handles get recreated on
  // narrative switch, so we can't keep a direct reference — the proxy stays
  // valid across switches.
  const activeSearch = (): SearchController | null =>
    editorHandle?.search ?? (compiledCountFor ? compiledSearch : null);
  const findBarSearchProxy: SearchController = {
    setQuery: (opts) => activeSearch()?.setQuery(opts),
    next: () => activeSearch()?.next(),
    prev: () => activeSearch()?.prev(),
    replaceCurrent: (text) => activeSearch()?.replaceCurrent(text) ?? false,
    replaceAll: (text) => activeSearch()?.replaceAll(text) ?? 0,
    linkAllMatches: (target) => activeSearch()?.linkAllMatches(target) ?? 0,
    clear: () => activeSearch()?.clear(),
    getInfo: () => activeSearch()?.getInfo() ?? {
      total: 0, currentIndex: 0, query: '', caseSensitive: false, wholeWord: false,
    },
  };

  /**
   * "Link to element…" from the find bar (S355). One picker, then:
   *   - this-level: every match in the live doc becomes a chip in one
   *     undoable transaction;
   *   - compiled: every match across the narrative AND its descendants is
   *     linked on disk (both story and sidecar), the view re-renders, the
   *     highlight re-applies to whatever is left.
   * The matched word is recorded as an alias on the element when it is not
   * already its name or an alias, so first-mention autolink recognises it in
   * later scenes (same rule as linking a selection to an existing element).
   */
  async function linkFindMatchesToElement(): Promise<void> {
    const info = findBarSearchProxy.getInfo();
    if (!info.query || info.total === 0) return;
    const picked = await pickElement({ title: `Link every "${info.query}" to which element?` });
    if (!picked) return;
    const target = { id: picked.id, type: picked.type };
    const opts = { caseSensitive: info.caseSensitive, wholeWord: info.wholeWord };
    const name = picked.name || '(unnamed)';

    // Alias FIRST, chips second: the chip-label sync runs on the next state
    // tick and rewrites any label that is not yet the name or an alias, so
    // recording after linking is a race the writer loses (Captain saw it).
    const term = info.query.trim();
    if (editorHandle) {
      await recordAliasIfForeign(picked, term);
      const n = editorHandle.search.linkAllMatches(target);
      if (n === 0) return;
      toastManager.info(`Linked ${n} mention${n === 1 ? '' : 's'} to ${name}`);
      return;
    }

    const rootEl = compiledCountFor;
    if (!rootEl) return;
    const ids = [rootEl.id, ...collectNarrativeDescendants(getState().data.elements, rootEl.id)];
    await recordAliasIfForeign(picked, term);
    const { changed, count } = await bulkLinkTerm(ids, info.query, target, opts);
    if (count === 0) {
      toastManager.info('Nothing to link');
      return;
    }
    remountCompiledView();
    toastManager.info(
      `Linked ${count} mention${count === 1 ? '' : 's'} to ${name} across `
      + `${changed} narrative${changed === 1 ? '' : 's'} (saved, no undo)`,
    );
  }

  /** Re-render the compiled view from fresh state and re-apply any search. */
  function remountCompiledView(): void {
    const rootEl = compiledCountFor;
    // mountCompiledView replaces the host's class with its own, so the prose
    // class is gone after the first mount; find the host by what it became.
    const host = root.querySelector<HTMLElement>('.atlas-writing-compiled');
    if (!rootEl || !host) return;
    const fresh = getState().data.elements.find(e => e.id === rootEl.id) ?? rootEl;
    compiledCountFor = fresh;
    mountCompiledView(host, fresh);
    host.tabIndex = -1;
    compiledSearch.reapply();
  }

  let findBar: FindBarHandle | null = null;
  function ensureFindBar(): FindBarHandle {
    // mountForNarrative wipes root.innerHTML, which detaches a bar built for
    // an earlier narrative; a detached bar opens invisibly. Rebuild it.
    if (findBar && !root.querySelector('.atlas-find-bar')) {
      findBar.destroy();
      findBar = null;
    }
    if (findBar) return findBar;
    findBar = createFindBar(root, {
      search: findBarSearchProxy,
      onClose: () => {
        // Editor regains focus so typing resumes immediately.
        editorHandle?.editor.commands.focus();
      },
      onLinkMatches: linkFindMatchesToElement,
    });
    return findBar;
  }

  /**
   * The selected text on whichever surface is mounted, for the find box.
   * The DOM selection is what the writer SEES and is read first: ProseMirror
   * syncs its own selection from the DOM on a later tick, so a shortcut
   * pressed right after a keyboard selection can find the editor state one
   * step behind (own-eyes at S355: two of three runs). The editor state is
   * the fallback, for a selection made programmatically.
   */
  function currentSelectionText(): string {
    const dom = window.getSelection()?.toString() ?? '';
    if (dom.trim()) return dom;
    if (editorHandle) {
      const { from, to } = editorHandle.editor.state.selection;
      return from === to ? '' : editorHandle.editor.state.doc.textBetween(from, to, ' ', ' ');
    }
    return '';
  }

  /**
   * Workspace-scoped find/replace hotkeys (Ctrl+F / Ctrl+H). Listened on the
   * root so they don't conflict with browser-level Ctrl+F outside the writing
   * room. Inline-create (Ctrl+Shift+E) flows through the central hotkey
   * dispatcher and arrives as a custom event — see onInlineCreateEvent below.
   */
  const onWorkspaceHotkey = (e: KeyboardEvent): void => {
    const isMeta = e.ctrlKey || e.metaKey;
    // Shift combos belong to the global dispatcher: Ctrl+Shift+F is focus
    // mode and used to open Find as well, pulling the caret out of the prose
    // (S367 critic C10). Same rule for H.
    if (!isMeta || e.shiftKey) return;
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      openFind('find');
    } else if (e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      openFind('replace');
    }
  };

  /** The find bar from a key or the touch screen's button (#301). */
  function openFind(mode: 'find' | 'replace'): void {
    // The compiled view is a rendering, not the source: find works, replace
    // is hidden (Ctrl+H opens find there), linking writes the subtree.
    const readOnly = !editorHandle && compiledCountFor !== null;
    ensureFindBar().open(mode, { readOnly, prefill: currentSelectionText() });
  }
  root.addEventListener('keydown', onWorkspaceHotkey);

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

  // Focus mode (Cmd+Shift+F via hotkeys.ts) — toggles a class on the workspace
  // root. Sibling chrome (sidebar, room-nav, sticky bar) hides via
  // `.atlas-shell:has(...)` selectors in atlas.css. Because the sticky bar's
  // focus button hides along with it, a small floating focus icon (top-right)
  // is shown while focus mode is on so it's dismissable by mouse, not just Esc.
  let focusExitBtn: HTMLButtonElement | null = null;
  function showFocusExit(): void {
    if (focusExitBtn) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-writing-focus-exit';
    btn.title = 'Exit focus mode (Esc)';
    btn.setAttribute('aria-label', 'Exit focus mode');
    btn.innerHTML = '<span class="material-symbols-outlined">center_focus_strong</span>';
    btn.addEventListener('click', () => exitFocusMode());
    document.body.appendChild(btn);
    focusExitBtn = btn;
  }
  function hideFocusExit(): void {
    if (!focusExitBtn) return;
    focusExitBtn.remove();
    focusExitBtn = null;
  }
  function exitFocusMode(): void {
    root.classList.remove('is-focus-mode');
    hideFocusExit();
    // Sync the (now-revealed) sticky-bar focus button's aria-pressed state.
    const focusBtn = root.querySelector<HTMLButtonElement>('.atlas-writing-workspace-action[data-action="focus"]');
    if (focusBtn) focusBtn.setAttribute('aria-pressed', 'false');
  }
  const onFocusToggle = (): void => {
    const nowOn = root.classList.toggle('is-focus-mode');
    if (nowOn) showFocusExit();
    else hideFocusExit();
  };
  const onFocusEsc = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    // Esc exits focus mode OR reading mode (whichever is active). Focus mode
    // takes priority — the user is more visually buried in it.
    if (root.classList.contains('is-focus-mode')) {
      e.preventDefault();
      e.stopPropagation();
      exitFocusMode();
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
    // Address the write NOW, while we still know who it belongs to.
    if (mountedForId === null) return;
    pendingSnapshot = { id: mountedForId, baseline: lastSavedMarkdown, ...snapshot };
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
  function onPageHide(): Promise<void> {
    // Capture latest editor state if onUpdate hasn't fired yet for the most
    // recent transaction (defensive — onUpdate is synchronous from TipTap's
    // dispatchTransaction, so this is rarely a no-op, but cheap insurance).
    if (editorHandle && mountedForId !== null && !pendingSnapshot) {
      const markdown = editorHandle.getMarkdown();
      if (lastSavedMarkdown !== null && markdown !== lastSavedMarkdown) {
        pendingSnapshot = {
          id: mountedForId,
          baseline: lastSavedMarkdown,
          markdown,
          json: editorHandle.getJson(),
        };
      }
    }
    return flushPendingSave();
  }
  window.addEventListener('pagehide', onPageHide);
  // Same flush before a world switch empties the elements this save needs (S360).
  const unLeaveWorld = onLeaveWorld(onPageHide);

  /**
   * THE LIVE FOLDER (S364): another tool changed the open scene on disk.
   * The pass flushed this room first, so a clean editor has nothing unsaved:
   * remount it from the new body (the sidecar rule decides which text).
   * Typing that landed during the pass wins, and the room says so; its save
   * merges into the disk body (readForWrite), replacing only the story.
   */
  function onDiskChanges(ev: Event): void {
    const change = diskChangeFor(ev, mountedForId);
    if (!change || !editorHandle || mountedForId === null) return;
    const dirty = pendingSnapshot !== null
      || (lastSavedMarkdown !== null && editorHandle.getMarkdown() !== lastSavedMarkdown);
    if (dirty) {
      toastManager.info('This scene also changed on disk. Your version is kept.');
      return;
    }
    const el = getState().data.elements.find(e => e.id === mountedForId);
    if (!el) return;
    // Keep the reader's place (S364 gate lens B B14): a writer coming back to
    // the window with the caret in the scene keeps focus there (never on the
    // page body, where single keys are hotkeys) and keeps the scroll.
    const hadFocus = root.contains(document.activeElement);
    const scrollTop = root.querySelector<HTMLElement>('.atlas-writing-workspace-body')?.scrollTop ?? 0;
    mountForNarrative(el, { preferStory: storyChangedAlone(change.before, el, 'atlas_richtext_json') });
    const body = root.querySelector<HTMLElement>('.atlas-writing-workspace-body');
    if (body) body.scrollTop = scrollTop;
    if (hadFocus) editorHandle?.editor.commands.focus('end');
  }
  document.addEventListener('atlas:disk-changes', onDiskChanges);

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

  /**
   * Write a pending snapshot to the element it came from.
   *
   * This used to resolve its target from the LIVE url (`getActiveNarrative()`)
   * and bail when that disagreed with the mounted editor. Both readings move
   * before the flush does: leaving the writing room empties the route of any
   * narrative id, so the lookup returned null and the guard dropped the write
   * — and `flushPendingSave` had already cleared `pendingSnapshot`, so the
   * text was gone from the editor, from state and from disk, silently. Atlas
   * has no undo. (S323, reproduced live: type, then click another room inside
   * the debounce window.)
   *
   * The write is now addressed by the id captured at schedule time, so the
   * route and the mounted editor are simply not consulted.
   */
  async function persistSnapshot(snap: PendingWrite): Promise<void> {
    const seq = ++saveSeq;
    latestSave.set(snap.id, seq);
    const el = getState().data.elements.find(e => e.id === snap.id) ?? null;
    if (!el) return; // deleted out from under us — nothing to write to
    const folder = getActiveStore();
    if (!folder) return;

    // Skip no-op writes — markdown unchanged from what THIS narrative last
    // saved (the baseline travels with the snapshot; `lastSavedMarkdown` may
    // already belong to a different narrative by now).
    if (snap.baseline !== null && snap.markdown === snap.baseline) return;

    const relationPatch = computeRelationPatch(el, snap.markdown, linkTargetsIn(getState().data.elements));
    const patch: Partial<Element> = {
      story: snap.markdown,
      atlas_richtext_json: snap.json,
      ...relationPatch,
    };

    try {
      await folder.updateElement(snap.id, patch);
      // Only advance the mount's baseline if this write BELONGS to the
      // currently mounted narrative — a late flush for the previous one must
      // not tell the new editor its text is already saved.
      if (mountedForId === snap.id) lastSavedMarkdown = snap.markdown;
      await refreshElementsAfterWrite(folder);
      requestPushIfLinked();
      // Save-state indicator no longer rendered here — the element-header's
      // sync dot (sets data-state via local_updated_at vs server_updated_at)
      // is now the single source of truth for save/sync visual feedback.
    } catch (err) {
      console.error('[writing-workspace] save failed', err);
      showProblem(err, {
        doing: 'saving this scene',
        dedupeKey: `scene-save:${snap.id}`,
        retry: () => { if (latestSave.get(snap.id) === seq) void persistSnapshot(snap); },
      });
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

    // The compiled view is a rendering of OTHER narratives too, so it goes
    // stale whenever the elements array swaps (a sync pull, a link from the
    // context pane, a scene edited elsewhere). Re-render it on that tick
    // (S355; before this it only redrew on narrative switch).
    if (!editorHandle && compiledCountFor) {
      const elements = getState().data.elements;
      if (elements !== lastSeenElementsRef) {
        lastSeenElementsRef = elements;
        remountCompiledView();
      }
    }

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

  function mountForNarrative(el: Element, opts: { preferStory?: boolean } = {}): void {
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
      const initialPatch = computeRelationPatch(el, el.story, linkTargetsIn(getState().data.elements));
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
    root.appendChild(stickyBar.render(el));

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
      compiledCountFor = el;
      mountCompiledView(proseHost, el);
      // Focusable so Ctrl+F reaches the workspace's keydown listener (a
      // click on a plain div moves focus nowhere; the editor was focusable
      // by nature, the rendering is not).
      proseHost.tabIndex = -1;
    } else {
      compiledCountFor = null;
      // A reload after an outside `story` edit skips the stale rich-text copy (S364).
      const initialJson = opts.preferStory ? null : parseRichtextJson(el.atlas_richtext_json);
      const initialMarkdown = typeof el.story === 'string' ? el.story : '';

      editorHandle = mountWorkspaceEditor({
        target: proseHost,
        initialJson,
        initialMarkdown,
        storyOutranksStaleSidecar: true,
        autolinkSeed: { elements: getState().data.elements },
        onUpdate: (snap) => {
          scheduleSave({ markdown: snap.markdown, json: snap.json });
          wordCount.updateIndicator(snap.wordCount);
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
      // The "unsaved?" baseline is the EDITOR's serialisation of what it
      // loaded, not the raw `story` (S364 gate, lens B B1 / lens C C2): TipTap
      // re-serialises (a trailing newline, `*` bullets), so an untouched scene
      // read as dirty and every flush, now run before each live-folder pass,
      // wrote Atlas's stale text over the outside edit it was about to show.
      lastSavedMarkdown = editorHandle.getMarkdown();
      // `story` changed while Atlas was closed and outranked the stale
      // rich-text copy (S365): say so, once per scene per session.
      if (editorHandle.openedFromStory) noteOpenedFromStory(el.id, 'scene');

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

      // Link-all corner affordance (S265): a gentle icon at the prose
      // surface's top-right, visible only while unlinked mention candidates
      // exist. Click converts every hint in one transaction (one Ctrl+Z
      // undoes the batch). Refreshed on every editor transaction — the
      // autolink plugin's decorations are the candidate truth.
      editorHandle.editor.on('transaction', refreshLinkAllWidget);
      refreshLinkAllWidget();

      // Register the live bulk ops so the tree-level "link mentions in all
      // scenes" routes THIS narrative through the editor (a disk write here
      // would be reverted by the next autosave).
      setLiveEditorOps({
        narrativeId: el.id,
        linkAll: (only?: string) => {
          const v = editorHandle?.editor.view;
          return v ? convertAllAutolinks(v, undefined, only) : 0;
        },
        unlinkAll: () => {
          const v = editorHandle?.editor.view;
          return v ? unlinkAllChips(v) : 0;
        },
        linkTerm: (term, target, opts) => {
          const ed = editorHandle?.editor;
          return ed ? linkTermInEditor(ed, term, target, opts) : 0;
        },
      });
    }

    // 5/6 — disclosures removed (moved to context pane).

    // 7. Ambient word-count widget — anchored bottom-right corner of the
    // workspace root (NOT inside the scrollable body, so it stays visible
    // across long narratives without scroll). Click → goal popover.
    root.appendChild(wordCount.renderWidget(el));

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
    // Never under a focused rename (S364 lane A3): the replace would blur and
    // commit the half-typed name. The rename's commit swaps the elements
    // array, which brings this refresh back with the new name.
    const oldHeader = root.querySelector<HTMLElement>('.atlas-middle-header');
    if (oldHeader && !isEditingIn(oldHeader)) oldHeader.replaceWith(renderHeader(el));

    // Replace sticky bar (breadcrumb + date + action icons).
    const oldCrumb = root.querySelector<HTMLElement>(':scope > .atlas-writing-workspace-crumb');
    const newCrumb = stickyBar.render(el);
    if (oldCrumb) oldCrumb.replaceWith(newCrumb);

    // Cast / Details / References surfaces moved to the context pane (right
    // pane writing-context tab). No replacements needed here anymore.

    // Replace ambient word-count widget (anchored on workspace root, not body).
    const oldWc = root.querySelector<HTMLElement>(':scope > .atlas-writing-workspace-wc-corner');
    const newWc = wordCount.renderWidget(el);
    if (oldWc) oldWc.replaceWith(newWc);
    else root.appendChild(newWc);
  }

  /**
   * The link-all corner button. Lifted to `prose-linkall-corner.ts` in S310 so
   * the KNOWLEDGE room can mount the same affordance — it mounts the same
   * editor into a host carrying the same prose class and had been missing this
   * button since S265. Behavior here is unchanged.
   */
  const linkAllCorner = createLinkAllCorner({
    getHost: () => root.querySelector<HTMLElement>('.atlas-writing-workspace-prose'),
    getView: () => editorHandle?.editor.view,
    toasts: toastManager,
  });
  function refreshLinkAllWidget(): void {
    linkAllCorner.refresh();
  }

  function teardownEditor(): void {
    if (editorHandle) {
      editorHandle.destroy();
      editorHandle = null;
    }
    setLiveEditorOps(null);
    linkAllCorner.deactivate();
    compiledSearch.clear();
    compiledCountFor = null;
    mountedForId = null;
    lastSavedMarkdown = null;
    lastRefreshEl = null;
    lastRefreshElementsRef = null;
  }

  // ============================================================================
  // Sub-renderers
  // ============================================================================

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
    // Cleanup is synchronous, the folder write inside persistSnapshot is not.
    // We initiate the write FIRST (with a defensive snapshot capture in case
    // onUpdate has not run for the latest transaction), then tear down. The
    // write carries its own target id and baseline, so it completes correctly
    // after teardown has nulled `mountedForId` and after the route has already
    // moved to another room — which is exactly the case that used to lose it
    // (S323). This comment previously claimed the pre-await guard made the
    // in-flight write safe; it did not, because the other half of that guard
    // read the live url. Addressing the write fixed it; the claim is now true.
    if (editorHandle && mountedForId !== null && !pendingSnapshot) {
      const markdown = editorHandle.getMarkdown();
      if (lastSavedMarkdown !== null && markdown !== lastSavedMarkdown) {
        pendingSnapshot = {
          id: mountedForId,
          baseline: lastSavedMarkdown,
          markdown,
          json: editorHandle.getJson(),
        };
      }
    }
    void flushPendingSave();
    window.removeEventListener('pagehide', onPageHide);
    unLeaveWorld();
    document.removeEventListener('atlas:disk-changes', onDiskChanges);
    unsubState();
    unsubHash();
    root.removeEventListener('keydown', onWorkspaceHotkey);
    document.removeEventListener('atlas:context-add-to-cast', onAddToCast);
    proseMenu.destroy();
    document.removeEventListener(WRITING_FOCUS_TOGGLE_EVENT, onFocusToggle);
    document.removeEventListener('keydown', onFocusEsc, true);
    hideFocusExit();
    chipPreview.destroy();
    findBar?.destroy();
    findBar = null;
    teardownEditor();
  };
}
