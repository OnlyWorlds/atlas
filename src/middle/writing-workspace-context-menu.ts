/**
 * Prose right-click context menu + its actions for the writing workspace.
 *
 * Owns the in-prose contextmenu handler and the two hotkey-driven actions that
 * share its surface:
 *   - Create element from selection (Ctrl+Shift+E or menu)
 *   - Split here into new sibling (menu, or the split hotkey)
 *   - Link to {name} (right-click an autolink hint)
 *   - Unlink {chip} (right-click a linked chip; also drops it from the cast
 *     field when no other mention of the element remains in the prose)
 *
 * Extracted from writing-workspace.ts (session 232). A factory that attaches
 * its own listeners (contextmenu on root + the inline-create / split document
 * events) and returns a `destroy()`; it reaches the live editor + active
 * narrative through accessor deps so it survives editor remounts on narrative
 * switch.
 */

import { getState } from '../core/state';
import { escapeText } from '../core/dom-utils';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { toastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import { ElementCreateModal } from '../ui/element-create-modal';
import { openSplitDialog } from './writing-workspace-split';
import {
  findAutolinkCandidateAt, convertAutolinkAt,
  countAutolinkHints, countChips, convertAllAutolinks, unlinkAllChips,
} from './writing-workspace-autolink';
import { NARRATIVE_RELATION_FIELDS } from './writing-workspace-derive';
import { linkSelectionToExisting } from './prose-link-existing';
import { pushRecent } from './writing-workspace-recents';
import { WRITING_INLINE_CREATE_EVENT, WRITING_SPLIT_EVENT } from '../core/hotkeys';
import type { Element } from '../core/types';
import type { WorkspaceEditorHandle } from './writing-workspace-editor';
import { forPointer } from '../core/pointer';

export interface ProseContextMenuController {
  destroy(): void;
}

export function createProseContextMenu(deps: {
  root: HTMLElement;
  getEditorHandle: () => WorkspaceEditorHandle | null;
  getActiveNarrative: () => Element | null;
}): ProseContextMenuController {
  const { root, getEditorHandle, getActiveNarrative } = deps;

  /**
   * Open the split-into-sibling confirm dialog for the current narrative,
   * splitting at the editor's cursor position. Bails (with toast) if no
   * editor / no narrative.
   */
  function openSplitForCurrentCursor(): void {
    const editor = getEditorHandle()?.editor;
    const el = getActiveNarrative();
    const worldId = getState().active?.worldId;
    if (!editor || !el || !worldId) return;
    openSplitDialog({ narrative: el, editor, worldId });
  }

  /**
   * Inline element creation — opens ElementCreateModal pre-filled with the
   * currently-selected prose text. After create, replaces the selection with
   * an ow:// chip pointing at the new element. Navigation stays in the writing
   * room (suppressNavigate=true). No-op when there's no text selection.
   */
  function openInlineCreate(): void {
    const editor = getEditorHandle()?.editor;
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) {
      toastManager.info(forPointer('Select some text first, then Ctrl+Shift+E', 'Select some text first'));
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
        const handle = getEditorHandle();
        if (!handle) return;
        handle.editor
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
    const editorHandle = getEditorHandle();
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
          <span>Unlink ${escapeText(chipHit.label || 'chip')}</span>
        </button>
      `);
    }
    if (autolinkHit) {
      items.push(`
        <button type="button" class="atlas-prose-context-menu-item" data-role="link-autolink">
          <span class="material-symbols-outlined">link</span>
          <span>Link to ${escapeText(autolinkHit.name)}</span>
        </button>
      `);
    }
    // Selection-scoped bulk linking (S265, Susie's gesture: select text,
    // right-click, link everything in it). Counts come from the live
    // decoration set / chip nodes, so the labels are exact.
    let selLinkable = 0;
    let selChips = 0;
    if (hasSelection) {
      selLinkable = countAutolinkHints(editor.view, { from, to });
      selChips = countChips(editor.view, { from, to });
      if (selLinkable > 0) {
        items.push(`
          <button type="button" class="atlas-prose-context-menu-item" data-role="link-selection">
            <span class="material-symbols-outlined">link</span>
            <span>Link ${selLinkable} mention${selLinkable === 1 ? '' : 's'} in selection</span>
          </button>
        `);
      }
      if (selChips > 0) {
        items.push(`
          <button type="button" class="atlas-prose-context-menu-item" data-role="unlink-selection">
            <span class="material-symbols-outlined">link_off</span>
            <span>Unlink ${selChips} mention${selChips === 1 ? '' : 's'} in selection</span>
          </button>
        `);
      }
      // Link-to-existing (2026-07-19): the picker path for selections whose
      // words match no element name — autolink/Tab only fires on exact
      // name/alias matches, so this was previously chip-unreachable prose.
      items.push(`
        <button type="button" class="atlas-prose-context-menu-item" data-role="link-existing">
          <span class="material-symbols-outlined">add_link</span>
          <span>Link to existing element…</span>
        </button>
      `);
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
    menu.querySelector<HTMLElement>('[data-role="link-existing"]')?.addEventListener('click', () => {
      dismissContextMenu();
      void linkSelectionToExisting(getEditorHandle, {
        onLinked: (id) => {
          const worldId = getState().active?.worldId;
          if (worldId) pushRecent(worldId, id);
        },
      });
    });
    menu.querySelector<HTMLElement>('[data-role="link-selection"]')?.addEventListener('click', () => {
      dismissContextMenu();
      if (!editorHandle) return;
      const n = convertAllAutolinks(editorHandle.editor.view, { from, to });
      if (n > 0) toastManager.info(`Linked ${n} element${n === 1 ? '' : 's'}${forPointer(' · Ctrl+Z undoes', '')}`);
    });
    menu.querySelector<HTMLElement>('[data-role="unlink-selection"]')?.addEventListener('click', () => {
      dismissContextMenu();
      if (!editorHandle) return;
      const n = unlinkAllChips(editorHandle.editor.view, { from, to });
      if (n > 0) toastManager.info(`Unlinked ${n} mention${n === 1 ? '' : 's'}${forPointer(' · Ctrl+Z undoes', '')}`);
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
    const editorHandle = getEditorHandle();
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
      // No retry: the narrative may have changed since, and this writes the
      // whole link list. The chip is gone from the text; the field keeps the
      // link, which the user can remove from the element page.
      showProblem(err, { doing: 'removing the link' });
    }
  }

  const onInlineCreateEvent = (): void => { openInlineCreate(); };
  const onSplitEvent = (): void => { openSplitForCurrentCursor(); };

  root.addEventListener('contextmenu', onProseContextMenu);
  document.addEventListener(WRITING_INLINE_CREATE_EVENT, onInlineCreateEvent);
  document.addEventListener(WRITING_SPLIT_EVENT, onSplitEvent);

  return {
    destroy(): void {
      root.removeEventListener('contextmenu', onProseContextMenu);
      document.removeEventListener(WRITING_INLINE_CREATE_EVENT, onInlineCreateEvent);
      document.removeEventListener(WRITING_SPLIT_EVENT, onSplitEvent);
      dismissContextMenu();
    },
  };
}
