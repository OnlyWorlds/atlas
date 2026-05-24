/**
 * Add-to-cast handler — invoked when the writing-context pane fires
 * `atlas:context-add-to-cast`. The button is hidden by the preview when
 * the element is already Featured (in field AND in prose), so this handler
 * only runs for Planned and Suggested elements. Branches on selection:
 *
 *   (a) no selection         → insert canonical chip at cursor (or end of
 *                              doc if no cursor position). The chip enters
 *                              prose; UNION-on-save adds the id to the
 *                              field if it isn't already there.
 *   (b) selection + no chip  → wrap selection as chip with selected text
 *                              as display label AND add selection text as
 *                              a new alias on the target element
 *                              (case-insensitive dedup, 60-char cap).
 *   (c) selection has a chip → toast + no-op (don't clobber existing chips)
 *
 * Alias creation in (b) is best-effort.
 */

import type { Editor } from '@tiptap/core';
import type { Element } from '../core/types';
import { getState } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { toastManager } from '../ui/toast-manager';

export interface AddToCastDetail {
  id?: string;
  type?: string;
  name?: string;
}

const MAX_AUTO_ALIAS_CHARS = 60;

export async function handleAddToCast(
  detail: AddToCastDetail,
  editor: Editor | null,
): Promise<void> {
  if (!detail || typeof detail.id !== 'string' || typeof detail.type !== 'string') return;
  if (!editor) {
    toastManager.info('Open the writing room first');
    return;
  }
  const { from, to } = editor.state.selection;
  const hasSelection = from !== to;
  const label = (detail.name || '').trim() || '(unnamed)';
  const elementType = detail.type;
  const elementId = detail.id;

  if (!hasSelection) {
    // Insert canonical chip at cursor. UNION-on-save handles the field side.
    editor
      .chain()
      .focus()
      .insertContent([
        { type: 'elementChip', attrs: { id: elementId, type: elementType, label } },
      ])
      .run();
    return;
  }

  const selectedText = editor.state.doc.textBetween(from, to, ' ', ' ').trim();
  // Bail if the selection range already contains a chip node — the regex
  // scan elsewhere won't find it (chips are nodes, not text), but the chain's
  // insertContentAt below would otherwise replace a chip wholesale.
  let containsChip = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'elementChip') containsChip = true;
    return !containsChip;
  });
  if (containsChip) {
    toastManager.info('Selection already contains a link');
    return;
  }

  if (selectedText.length === 0) {
    toastManager.info('Selection is empty');
    return;
  }
  if (selectedText.length > MAX_AUTO_ALIAS_CHARS) {
    // Long selections almost certainly weren't meant as an alias. Insert at
    // cursor with the element's canonical label instead and warn.
    toastManager.info('Selection too long for an alias; using element name');
    editor
      .chain()
      .focus()
      .insertContentAt({ from, to }, [
        { type: 'elementChip', attrs: { id: elementId, type: elementType, label } },
      ])
      .run();
    return;
  }

  // Wrap the selection as a chip whose display label = the selected text.
  editor
    .chain()
    .focus()
    .insertContentAt({ from, to }, [
      { type: 'elementChip', attrs: { id: elementId, type: elementType, label: selectedText } },
    ])
    .run();

  // Add the selection text as an alias on the target element (case-insensitive
  // dedup against name + existing aliases). Best-effort; silent on failure
  // — the chip is already in the prose, the user's flow isn't blocked.
  await maybeAddAlias(elementId, selectedText);
}

async function maybeAddAlias(elementId: string, alias: string): Promise<void> {
  const folder = getActiveStore();
  if (!folder) return;
  const state = getState();
  const target = state.data.elements.find(x => x.id === elementId);
  if (!target) return;
  const existingAliases = Array.isArray(target.atlas_aliases) ? target.atlas_aliases : [];
  const lowered = new Set<string>(existingAliases.map(a => a.toLowerCase()));
  lowered.add((target.name || '').toLowerCase());
  if (lowered.has(alias.toLowerCase())) return;
  try {
    await folder.updateElement(elementId, {
      atlas_aliases: [...existingAliases, alias],
    } as Partial<Element>);
    await refreshElementsAfterWrite(folder);
    requestPushIfLinked();
  } catch (err) {
    console.error('[writing-workspace] add alias failed', err);
  }
}
