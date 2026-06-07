/**
 * Narrative kind — the one place that answers "what KIND of narrative is
 * this?". Atlas reuses the Narrative element for three distinct concepts,
 * distinguished by subtype:
 *
 *   - 'story'     — writing-tree material (books/chapters/scenes/drafts and
 *                   loose narratives). The default kind.
 *   - 'knowledge' — a knowledge entry (DESIGN_KNOWLEDGE.md). Lives in the
 *                   knowledge room; held-by reinterpretation applies.
 *   - 'page'      — a sharing page (DESIGN_SHARING.md). Lives in the share
 *                   room; composition in atlas-local block fields.
 *
 * Surfaces that consume "narratives" should decide which kinds they mean via
 * this helper instead of ad-hoc subtype checks — the writing room means
 * stories, the knowledge room means knowledge entries, the share room means
 * pages. Three rooms, three kinds, one seam.
 */

import type { Element } from './types';
import { isKnowledgeNarrative } from './knowledge';
import { isPageNarrative } from './sharing';

export type NarrativeKind = 'story' | 'knowledge' | 'page';

/** The narrative's kind; null for non-narrative elements. */
export function narrativeKindOf(el: Element | null | undefined): NarrativeKind | null {
  if (!el || el.type !== 'narrative') return null;
  if (isKnowledgeNarrative(el)) return 'knowledge';
  if (isPageNarrative(el)) return 'page';
  return 'story';
}

/** True iff the narrative is writing-tree material (the default story kind). */
export function isStoryNarrative(el: Element | null | undefined): boolean {
  return narrativeKindOf(el) === 'story';
}
