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
  linkTermMarkdown, linkTermRichtext,
  type TermLinkTarget, type TermMatchOptions,
} from '../core/prose-autolink';
import { computeRelationPatch, linkTargetsIn } from './writing-workspace-derive';
import { getLiveEditorOps } from './writing-live-editor-ops';
import type { Element } from '../core/types';
import type { JSONContent } from '@tiptap/core';
import { serializeDocToMarkdown } from './writing-workspace-markdown';

/**
 * ONE HALF IS THE TRUTH (S365 gate lens A H3). Every Atlas save keeps
 * `story === serializeDocToMarkdown(sidecar)`, and the sidecar rule at open
 * (story-sidecar.ts) reads any other disagreement as an outside edit. These
 * writers used to transform the two halves separately, and they part ways
 * (a first mention in italics: an unmarked chip in the sidecar, a link inside
 * the emphasis in markdown), so the next open reported "changed outside
 * Atlas" about a scene nobody touched and dropped its detail. Now: when the
 * sidecar still holds the scene, transform IT and derive `story` from it;
 * when `story` outranks it (an outside edit), transform `story` and drop the
 * stale sidecar; with no sidecar, `story` alone, as before.
 */
async function authoritativeHalf(story: string, sidecar: unknown): Promise<'sidecar' | 'story'> {
  if (!sidecar) return 'story';
  if (serializeDocToMarkdown(sidecar as JSONContent) === story) return 'sidecar';
  const { storyOutranksSidecar } = await import('./story-sidecar');
  return storyOutranksSidecar(sidecar as JSONContent, story) ? 'story' : 'sidecar';
}

function fromSidecar<R extends { doc: unknown }>(r: R, countOf: (r: R) => number): { n: number; patch: Partial<Element> } {
  const doc = r.doc as JSONContent;
  return { n: countOf(r), patch: { story: serializeDocToMarkdown(doc), atlas_richtext_json: doc } as Partial<Element> };
}

function fromStory<R extends { story: string }>(r: R, countOf: (r: R) => number, sidecar: unknown): { n: number; patch: Partial<Element> } {
  return { n: countOf(r), patch: { story: r.story, ...(sidecar ? { atlas_richtext_json: null } : {}) } as Partial<Element> };
}

export interface BulkLinkSummary {
  /** Narratives that actually changed. */
  changed: number;
  /** Total mentions linked / chips unlinked. */
  count: number;
}

/**
 * `only` (#24, "Named in the text" under Potentials): link that one element's
 * mentions alone, by the same routing.
 */
export async function bulkLinkNarratives(
  ids: readonly string[],
  mode: 'link' | 'unlink',
  only?: string,
): Promise<BulkLinkSummary> {
  const folder = getActiveStore();
  if (!folder) return { changed: 0, count: 0 };
  const index = mode === 'link' ? buildAutolinkIndex(getState().data.elements) : null;
  const exists = linkTargetsIn(getState().data.elements); // once per run, not per narrative
  const live = getLiveEditorOps();

  let changed = 0;
  let count = 0;
  let wroteDisk = false;

  for (const id of ids) {
    if (live && live.narrativeId === id) {
      const n = mode === 'link' ? live.linkAll(only) : live.unlinkAll();
      if (n > 0) { changed++; count += n; }
      continue;
    }
    const el = await folder.getElement(id);
    if (!el || el.type !== 'narrative') continue;
    const story = typeof el.story === 'string' ? el.story : '';
    const sidecar = (el as Record<string, unknown>).atlas_richtext_json;
    const half = await authoritativeHalf(story, sidecar);

    if (mode === 'link') {
      const out = half === 'sidecar'
        ? fromSidecar(autolinkRichtext(sidecar, index!, only), r => r.linked.length)
        : fromStory(autolinkMarkdown(story, index!, only), r => r.linked.length, sidecar);
      if (out.n === 0) continue;
      await folder.updateElement(id, { ...out.patch, ...computeRelationPatch(el, out.patch.story as string, exists) });
      changed++; count += out.n; wroteDisk = true;
    } else {
      const out = half === 'sidecar'
        ? fromSidecar(unlinkRichtext(sidecar), r => r.unlinked)
        : fromStory(unlinkMarkdown(story), r => r.unlinked, sidecar);
      if (out.n === 0) continue;
      await folder.updateElement(id, out.patch);
      changed++; count += out.n; wroteDisk = true;
    }
  }

  if (wroteDisk) {
    await refreshElementsAfterWrite(folder);
    requestPushIfLinked();
  }
  return { changed, count };
}

/**
 * S355: link EVERY match of one term to one element across a set of
 * narratives (the compiled view's "Link to element"). Same routing as
 * {@link bulkLinkNarratives}: the live narrative (if any) goes through the
 * editor transaction, every other one gets both halves rewritten on disk,
 * and the convention-#50 relation derive runs on each new story.
 */
export async function bulkLinkTerm(
  ids: readonly string[],
  term: string | readonly string[],
  target: TermLinkTarget,
  opts: TermMatchOptions,
): Promise<BulkLinkSummary> {
  const folder = getActiveStore();
  if (!folder) return { changed: 0, count: 0 };
  const live = getLiveEditorOps();
  const exists = linkTargetsIn(getState().data.elements); // once per run, not per narrative

  let changed = 0;
  let count = 0;
  let wroteDisk = false;

  for (const id of ids) {
    if (live && live.narrativeId === id) {
      const n = live.linkTerm(term, target, opts);
      if (n > 0) { changed++; count += n; }
      continue;
    }
    const el = await folder.getElement(id);
    if (!el || el.type !== 'narrative') continue;
    const story = typeof el.story === 'string' ? el.story : '';
    const sidecar = (el as Record<string, unknown>).atlas_richtext_json;

    const half = await authoritativeHalf(story, sidecar);
    const out = half === 'sidecar'
      ? fromSidecar(linkTermRichtext(sidecar, term, target, opts), r => r.linked)
      : fromStory(linkTermMarkdown(story, term, target, opts), r => r.linked, sidecar);
    const n = out.n;
    if (n === 0) continue;
    const patch: Partial<Element> = { ...out.patch, ...computeRelationPatch(el, out.patch.story as string, exists) };
    await folder.updateElement(id, patch);
    changed++; count += n; wroteDisk = true;
  }

  if (wroteDisk) {
    await refreshElementsAfterWrite(folder);
    requestPushIfLinked();
  }
  return { changed, count };
}
