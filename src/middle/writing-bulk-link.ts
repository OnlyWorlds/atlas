/**
 * Tree-level bulk link/unlink (S265) — "Link mentions in all scenes" from the
 * writing sidebar. Runs the prose-autolink kernel over a set of narratives:
 *
 *   - The narrative OPEN in the live editor goes through the registered
 *     live-editor ops (a real TipTap transaction — undoable, autosaved).
 *     A plain disk write there would be reverted by the editor's next save.
 *   - Every other narrative gets BOTH halves rewritten on disk: `story`
 *     (markdown) AND `atlas_richtext_json` (the sidecar the editor actually
 *     renders) — one without the other is the story-shadowing trap.
 *   - Linking also runs the convention-#50 relation derive on the new story.
 *     Unlinking deliberately leaves relation fields alone (union semantics:
 *     the derive never removes; field removal stays an explicit gesture).
 */

import { getState } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import {
  buildAutolinkIndex, autolinkMarkdown, autolinkRichtext, unlinkMarkdown, unlinkRichtext,
} from '../core/prose-autolink';
import { computeRelationPatch } from './writing-workspace-derive';
import { getLiveEditorOps } from './writing-live-editor-ops';
import type { Element } from '../core/types';

export interface BulkLinkSummary {
  /** Narratives that actually changed. */
  changed: number;
  /** Total mentions linked / chips unlinked. */
  count: number;
}

export async function bulkLinkNarratives(
  ids: readonly string[],
  mode: 'link' | 'unlink',
): Promise<BulkLinkSummary> {
  const folder = getActiveStore();
  if (!folder) return { changed: 0, count: 0 };
  const index = mode === 'link' ? buildAutolinkIndex(getState().data.elements) : null;
  const live = getLiveEditorOps();

  let changed = 0;
  let count = 0;
  let wroteDisk = false;

  for (const id of ids) {
    if (live && live.narrativeId === id) {
      const n = mode === 'link' ? live.linkAll() : live.unlinkAll();
      if (n > 0) { changed++; count += n; }
      continue;
    }
    const el = await folder.getElement(id);
    if (!el || el.type !== 'narrative') continue;
    const story = typeof el.story === 'string' ? el.story : '';
    const sidecar = (el as Record<string, unknown>).atlas_richtext_json;

    if (mode === 'link') {
      const md = autolinkMarkdown(story, index!);
      const rt = sidecar ? autolinkRichtext(sidecar, index!) : { doc: sidecar, linked: [] };
      const n = Math.max(md.linked.length, rt.linked.length);
      if (n === 0) continue;
      const patch: Partial<Element> = {
        story: md.story,
        ...(sidecar ? { atlas_richtext_json: rt.doc } : {}),
        ...computeRelationPatch(el, md.story),
      };
      await folder.updateElement(id, patch);
      changed++; count += n; wroteDisk = true;
    } else {
      const md = unlinkMarkdown(story);
      const rt = sidecar ? unlinkRichtext(sidecar) : { doc: sidecar, unlinked: 0 };
      const n = Math.max(md.unlinked, rt.unlinked);
      if (n === 0) continue;
      const patch: Partial<Element> = {
        story: md.story,
        ...(sidecar ? { atlas_richtext_json: rt.doc } : {}),
      };
      await folder.updateElement(id, patch);
      changed++; count += n; wroteDisk = true;
    }
  }

  if (wroteDisk) {
    await refreshElementsAfterWrite(folder);
    requestPushIfLinked();
  }
  return { changed, count };
}
