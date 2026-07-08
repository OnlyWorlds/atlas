/**
 * Split-into-sibling for the writing workspace.
 *
 * The writer puts the cursor at a point in the prose and invokes the split
 * (Ctrl+Shift+D or right-click → "Split here into new {tier}"). Atlas:
 *   1. Splits the prose at cursor: text BEFORE stays in the current narrative,
 *      text AFTER moves into a freshly-created sibling narrative.
 *   2. Creates the sibling at the SAME tier as the current narrative, with the
 *      same `parent_narrative` and a sequential `order` after the current.
 *   3. Navigates to the new narrative so the writer continues seamlessly.
 *
 * Confirm modal first — split is irreversible without an undo system, so we
 * gate behind an explicit confirmation with a preview of what will move.
 *
 * Tier rule: sibling at the same tier as the current. Splitting a chapter
 * makes another chapter; splitting a scene makes another scene; splitting a
 * draft makes another draft. Avoids depth-limit awkwardness.
 */

import { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { BaseModal } from '../ui/modal-base';
import { getState, patchSlice } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { navigate, writingHash } from '../core/router';
import { toastManager } from '../ui/toast-manager';
import { escapeAttr, escapeText } from '../core/dom-utils';
import { serializeDocToMarkdown } from './writing-workspace-markdown';
import {
  isWritingNarrative,
  getTierForNarrative,
  getWritingLabels,
} from './writing-helpers';
import type { Element } from '../core/types';

const PREVIEW_CHARS = 80;

export interface SplitOptions {
  /** Narrative being split. Must be in the writing tree. */
  narrative: Element;
  /** Active editor — used to read cursor position + cut the doc. */
  editor: Editor;
  /** World id for tier/label resolution and navigation. */
  worldId: string;
  /** Optional callback after successful split (post-navigation). */
  onDone?: (newNarrativeId: string) => void;
}

/**
 * Entry point — validates that the narrative + cursor position are valid for
 * splitting, then opens the confirm modal. Toasts and bails on invalid states.
 */
export function openSplitDialog(opts: SplitOptions): void {
  const { narrative, editor, worldId } = opts;

  if (!isWritingNarrative(narrative, worldId)) {
    toastManager.info('Split only works on narratives in the writing tree.');
    return;
  }

  const cursorPos = editor.state.selection.from;
  const docSize = editor.state.doc.content.size;
  // We treat "at start" / "at end" as "nothing to split" — split with nothing
  // moving wouldn't be useful (and would create an empty sibling or empty self).
  if (cursorPos <= 0) {
    toastManager.info('Cursor is at the start. Move it where you want to split.');
    return;
  }
  if (cursorPos >= docSize) {
    toastManager.info('Cursor is at the end; nothing after it to split into a new sibling.');
    return;
  }

  // Cut the doc at cursor → before / after fragments.
  const beforeDoc = editor.state.doc.cut(0, cursorPos);
  const afterDoc = editor.state.doc.cut(cursorPos, docSize);
  const beforeJson = beforeDoc.toJSON() as JSONContent;
  const afterJson = afterDoc.toJSON() as JSONContent;
  const beforeMarkdown = serializeDocToMarkdown(beforeJson);
  const afterMarkdown = serializeDocToMarkdown(afterJson);

  if (afterMarkdown.trim().length === 0) {
    toastManager.info('No content after the cursor to split.');
    return;
  }

  const tier = getTierForNarrative(narrative, worldId);
  const labels = getWritingLabels(worldId);
  const tierLabel = tier ? labels[tier] : 'narrative';

  new SplitConfirmModal({
    tierLabel,
    afterPreview: previewOf(afterMarkdown, PREVIEW_CHARS),
    defaultName: `untitled ${tierLabel.toLowerCase()}`,
    onConfirm: async (newName) => {
      await performSplit({
        currentNarrative: narrative,
        currentBeforeMarkdown: beforeMarkdown,
        currentBeforeJson: beforeJson,
        afterMarkdown,
        afterJson,
        newName,
        worldId,
        onDone: opts.onDone,
      });
    },
  }).open();
}

/**
 * Build a short single-line preview of markdown for the confirm modal.
 * Collapses whitespace + truncates with an ellipsis.
 */
function previewOf(markdown: string, max: number): string {
  const flat = markdown.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max).trimEnd() + '…';
}

interface PerformSplitArgs {
  currentNarrative: Element;
  currentBeforeMarkdown: string;
  currentBeforeJson: JSONContent;
  afterMarkdown: string;
  afterJson: JSONContent;
  newName: string;
  worldId: string;
  onDone?: (newNarrativeId: string) => void;
}

/**
 * Atomic-ish split:
 *   1. Create the new sibling narrative with the after-cursor content.
 *   2. Update the current narrative's story to the before-cursor content.
 *   3. Refresh elements + request push.
 *   4. Navigate to the new narrative.
 *
 * If step 1 fails, nothing happens. If step 2 fails after step 1 succeeded,
 * the new sibling exists with the after content but the original retains the
 * full original content — the writer ends up with the full text duplicated
 * across two narratives. Better than silent data loss; a follow-up cleanup
 * would manually edit either side. The folder writes are independent.
 */
async function performSplit(args: PerformSplitArgs): Promise<void> {
  const folder = getActiveStore();
  if (!folder) {
    toastManager.error('No active store.');
    return;
  }

  const supertype = (args.currentNarrative as Element & { supertype?: string }).supertype;
  const parentNarrative = (args.currentNarrative as Element & { parent_narrative?: string }).parent_narrative;
  const currentOrderRaw = (args.currentNarrative as Element & { order?: number }).order;
  const currentOrder = typeof currentOrderRaw === 'number' ? currentOrderRaw : 0;

  // New sibling sits immediately after the current narrative in the order
  // sequence. Bump every later sibling's order to keep gaps from collapsing.
  const allElements = getState().data.elements;
  const laterSiblings = allElements.filter((e): e is Element => {
    if (e.type !== 'narrative') return false;
    if (e.id === args.currentNarrative.id) return false;
    const pn = (e as Element & { parent_narrative?: string }).parent_narrative;
    if (pn !== parentNarrative) return false;
    const o = (e as Element & { order?: number }).order;
    return typeof o === 'number' && o > currentOrder;
  });

  const newOrder = currentOrder + 1;

  // Build the new sibling payload. Copy supertype + parent + use computed order.
  const newPayload: Partial<Element> = {
    name: args.newName,
    supertype,
    parent_narrative: parentNarrative,
    order: newOrder,
    story: args.afterMarkdown,
    atlas_richtext_json: args.afterJson,
  };

  let created: Element;
  try {
    created = await folder.createElement('narrative', newPayload);
  } catch (err) {
    console.error('[split] create sibling failed', err);
    toastManager.error('Could not create the new narrative.');
    return;
  }

  // Bump every later sibling's order by 1 to keep the sequence consistent.
  // (We've inserted at currentOrder+1; anything previously >= currentOrder+1
  // needs to slide by one.)
  for (const sib of laterSiblings) {
    const sibOrder = (sib as Element & { order?: number }).order ?? 0;
    try {
      await folder.updateElement(sib.id, { order: sibOrder + 1 } as Partial<Element>);
    } catch (err) {
      console.warn('[split] failed to bump sibling order; tree may need manual fix', err);
      // Non-fatal — the sibling's order is wrong but the split itself succeeded.
    }
  }

  // Truncate the current narrative's story to the before-cursor content.
  try {
    await folder.updateElement(args.currentNarrative.id, {
      story: args.currentBeforeMarkdown,
      atlas_richtext_json: args.currentBeforeJson,
    } as Partial<Element>);
  } catch (err) {
    console.error('[split] truncate current narrative failed', err);
    toastManager.error('Created the new narrative but could not truncate the current one. You may need to manually clean up.');
    // Don't bail — the new one exists; better to navigate than leave the
    // writer guessing whether anything happened.
  }

  await refreshElementsAfterWrite(folder);
  requestPushIfLinked();

  toastManager.success(`Split into new narrative.`);
  args.onDone?.(created.id);
  navigate(writingHash(args.worldId, created.id));
}

// ---- Confirm modal ----

interface SplitConfirmOpts {
  tierLabel: string;
  afterPreview: string;
  defaultName: string;
  onConfirm: (newName: string) => Promise<void>;
}

class SplitConfirmModal extends BaseModal {
  constructor(private readonly opts: SplitConfirmOpts) {
    super();
  }

  open(): void {
    const { overlay, body } = this.buildModalShell({
      title: `Split into new ${this.opts.tierLabel.toLowerCase()}`,
      dataModal: 'writing-split',
    });

    body.innerHTML = `
      <p class="atlas-modal-hint">
        Everything after your cursor moves into a new sibling
        ${escapeText(this.opts.tierLabel.toLowerCase())}. The current
        ${escapeText(this.opts.tierLabel.toLowerCase())} keeps what comes before.
      </p>
      <div class="atlas-modal-field">
        <label class="atlas-modal-label">New name</label>
        <input
          class="atlas-input"
          type="text"
          name="new-name"
          value="${escapeAttr(this.opts.defaultName)}"
          autocomplete="off"
        />
      </div>
      <div class="atlas-modal-field">
        <label class="atlas-modal-label">Moves to new ${escapeText(this.opts.tierLabel.toLowerCase())}</label>
        <p class="atlas-split-preview">${escapeText(this.opts.afterPreview)}</p>
      </div>
      <div class="atlas-modal-error" data-role="error" hidden></div>
      <div class="atlas-modal-actions">
        <button type="button" class="atlas-btn-ghost" data-role="cancel">Cancel</button>
        <button type="button" class="atlas-btn-primary" data-role="confirm">Split</button>
      </div>
    `;

    this.modal = overlay;
    this.show();

    const input = body.querySelector<HTMLInputElement>('input[name="new-name"]')!;
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-role="cancel"]')!;
    const confirmBtn = body.querySelector<HTMLButtonElement>('[data-role="confirm"]')!;

    cancelBtn.addEventListener('click', () => this.hide());

    const submit = async (): Promise<void> => {
      const name = input.value.trim();
      if (!name) {
        errorBox.textContent = 'Name is required';
        errorBox.hidden = false;
        input.focus();
        return;
      }
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      errorBox.hidden = true;
      try {
        await this.opts.onConfirm(name);
        this.hide();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errorBox.textContent = message;
        errorBox.hidden = false;
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    };

    confirmBtn.addEventListener('click', () => { void submit(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void submit();
      }
    });

    queueMicrotask(() => {
      input.focus();
      input.select();
    });
  }
}
