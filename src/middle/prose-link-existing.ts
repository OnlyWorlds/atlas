/**
 * Link selected prose to an EXISTING element — the picker-backed sibling of
 * "Create element from selection" (Captain's ask, 2026-07-19: selected text
 * whose words don't match an element name has no path to a chip; autolink
 * only fires on exact name/alias matches).
 *
 * Shared by the share-page prose editor, the writing workspace context menu,
 * and the selection bubble. The selection's own text becomes the chip LABEL
 * (same rule as create-from-selection): the prose keeps reading exactly as
 * written, the chip points wherever the author chose.
 *
 * THE ALIAS WRITE (load-bearing, found by own-eyes): chip-label sync rewrites
 * any label that is neither the element's name nor one of its atlas_aliases —
 * so a foreign label would silently become the element's name on the next
 * tick, changing the user's prose. Linking foreign text therefore RECORDS it
 * as an alias on the element (the tour's baked-alias pattern): the label
 * survives, and autolink learns the surface form for next time. The write is
 * surfaced in the toast, never silent.
 */

import { getState } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { toastManager } from '../ui/toast-manager';
import { pickElement } from '../ui/element-picker-modal';
import type { Element } from '../core/types';
import type { WorkspaceEditorHandle } from './writing-workspace-editor';

export interface LinkExistingOptions {
  /** Called with the picked element's id after the chip lands (recents etc.). */
  onLinked?: (id: string) => void;
  /** Picker title override. */
  title?: string;
}

/**
 * Open the element picker for the current selection and replace it with a
 * chip to the picked element. No-op (resolving false) when the selection is
 * empty or the pick is cancelled.
 */
export async function linkSelectionToExisting(
  getHandle: () => WorkspaceEditorHandle | null,
  opts: LinkExistingOptions = {},
): Promise<boolean> {
  const editor = getHandle()?.editor;
  if (!editor) return false;
  const { from, to } = editor.state.selection;
  if (from === to) return false;
  const selectedText = editor.state.doc.textBetween(from, to, ' ', ' ').trim();
  if (!selectedText) return false;

  const picked = await pickElement({ title: opts.title ?? 'Link to which element?' });
  if (!picked) return false;

  // Re-acquire the handle — the picker is async and the editor could have
  // remounted (narrative switch) while it was open.
  const handle = getHandle();
  if (!handle) return false;
  handle.editor
    .chain()
    .focus()
    .insertContentAt({ from, to }, [
      { type: 'elementChip', attrs: { id: picked.id, type: picked.type, label: selectedText } },
    ])
    .run();

  await recordAliasIfForeign(picked, selectedText);
  opts.onLinked?.(picked.id);
  return true;
}

/**
 * When the linked text is neither the element's name nor a known alias,
 * append it to atlas_aliases (else chip-label sync renames it on the next
 * tick and the prose changes under the user). Failure degrades honestly:
 * the chip stays, the toast says the label won't stick.
 */
export async function recordAliasIfForeign(picked: Element, label: string): Promise<void> {
  const live = getState().data.elements.find(e => e.id === picked.id) ?? picked;
  const name = live.name || '';
  const aliases = Array.isArray(live.atlas_aliases)
    ? live.atlas_aliases.filter((a): a is string => typeof a === 'string')
    : [];
  if (label === name || aliases.includes(label)) return;
  const folder = getActiveStore();
  if (!folder) return;
  try {
    await folder.updateElement(picked.id, { atlas_aliases: [...aliases, label] } as Partial<Element>);
    await refreshElementsAfterWrite(folder);
    requestPushIfLinked();
    toastManager.info(`"${label}" saved as an alias of ${name || '(unnamed)'}`);
  } catch (err) {
    console.error('[prose-link-existing] alias write failed', err);
    toastManager.error(`Linked, but could not save "${label}" as an alias. The link may show ${name || 'the element name'} instead`);
  }
}
