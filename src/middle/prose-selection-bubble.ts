/**
 * Selection bubble for prose editors — a small floating bar that appears
 * above a non-empty text selection with the basic formatting the editor
 * already supports (StarterKit marks, so far invisible: Ctrl+B/I worked,
 * nothing advertised it) plus "link to existing element".
 *
 * Born for the share-page prose block (Captain's ask, 2026-07-19: bold /
 * italic "and maybe a little link icon when selected"). Component-neutral:
 * mount it over any WorkspaceEditorHandle.
 *
 * Positioning: fixed, centered above the selection's head line, clamped to
 * the viewport. Re-placed on every selectionUpdate; hidden on empty
 * selection, blur (unless the focus went INTO the bubble), and destroy.
 */

import type { WorkspaceEditorHandle } from './writing-workspace-editor';
import { worldIsViewOnly } from '../core/view-only';

export interface SelectionBubbleController {
  destroy(): void;
}

export function mountSelectionBubble(deps: {
  getHandle: () => WorkspaceEditorHandle | null;
  /** Run the link-to-existing flow (the bubble hides itself first). */
  onLinkExisting: () => void;
}): SelectionBubbleController {
  const { getHandle, onLinkExisting } = deps;

  const bubble = document.createElement('div');
  bubble.className = 'atlas-prose-bubble';
  bubble.setAttribute('role', 'toolbar');
  bubble.innerHTML = `
    <button type="button" class="atlas-prose-bubble-btn" data-role="bold" title="Bold (Ctrl+B)">
      <span class="material-symbols-outlined">format_bold</span>
    </button>
    <button type="button" class="atlas-prose-bubble-btn" data-role="italic" title="Italic (Ctrl+I)">
      <span class="material-symbols-outlined">format_italic</span>
    </button>
    <span class="atlas-prose-bubble-sep"></span>
    <button type="button" class="atlas-prose-bubble-btn" data-role="link" title="Link to an existing element">
      <span class="material-symbols-outlined">add_link</span>
    </button>
  `;
  document.body.appendChild(bubble);

  let visible = false;
  function hide(): void {
    if (!visible) return;
    visible = false;
    bubble.classList.remove('is-visible');
  }

  function place(): void {
    const editor = getHandle()?.editor;
    // Every button here writes; a view-only world shows no bubble (conv. 149).
    if (!editor || worldIsViewOnly()) { hide(); return; }
    const { from, to, empty } = editor.state.selection;
    if (empty) { hide(); return; }
    // Lost focus hides unless the user is mid-click inside the bubble itself.
    if (!editor.isFocused && !bubble.contains(document.activeElement)) { hide(); return; }
    let start;
    let end;
    try {
      start = editor.view.coordsAtPos(from);
      end = editor.view.coordsAtPos(to);
    } catch {
      hide();
      return;
    }
    // Mark active states so B/I read as toggles.
    bubble.querySelector('[data-role="bold"]')?.classList.toggle('is-active', editor.isActive('bold'));
    bubble.querySelector('[data-role="italic"]')?.classList.toggle('is-active', editor.isActive('italic'));

    visible = true;
    bubble.classList.add('is-visible');
    // Center on the selection's horizontal midpoint at the START line, sit
    // above it; clamp inside the viewport with a small margin.
    const rect = bubble.getBoundingClientRect();
    const midX = (start.left + (start.top === end.top ? end.left : start.left)) / 2;
    const left = Math.min(Math.max(8, midX - rect.width / 2), window.innerWidth - rect.width - 8);
    const top = Math.max(8, start.top - rect.height - 8);
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(top)}px`;
  }

  const onSelectionUpdate = (): void => { place(); };
  const onBlur = (): void => {
    // Let a click land inside the bubble before deciding — blur fires first.
    setTimeout(() => {
      if (!bubble.contains(document.activeElement)) hide();
    }, 0);
  };

  const editorNow = getHandle()?.editor;
  editorNow?.on('selectionUpdate', onSelectionUpdate);
  editorNow?.on('transaction', onSelectionUpdate);
  editorNow?.on('blur', onBlur);

  // mousedown + preventDefault keeps the editor selection alive through the
  // button click (same idiom as the heading-level toggles).
  bubble.addEventListener('mousedown', (e) => e.preventDefault());
  bubble.querySelector('[data-role="bold"]')?.addEventListener('click', () => {
    getHandle()?.editor.chain().focus().toggleBold().run();
  });
  bubble.querySelector('[data-role="italic"]')?.addEventListener('click', () => {
    getHandle()?.editor.chain().focus().toggleItalic().run();
  });
  bubble.querySelector('[data-role="link"]')?.addEventListener('click', () => {
    hide();
    onLinkExisting();
  });

  return {
    destroy(): void {
      const editor = getHandle()?.editor;
      editor?.off('selectionUpdate', onSelectionUpdate);
      editor?.off('transaction', onSelectionUpdate);
      editor?.off('blur', onBlur);
      bubble.remove();
    },
  };
}
