/**
 * Sharing model helpers (see DESIGN_SHARING.md + SHARING_CONTRACT.md).
 *
 * A **page** is a Narrative with `subtype === 'page'` — the unit of sharing.
 * Its composition is an ordered single-column stack of **blocks** stored in
 * the atlas-local field `atlas_page_blocks` (never sent to the OW API). The
 * canonical `story` field carries a derived plain-markdown compilation of the
 * blocks so the page stays readable on other devices / in other OW tools
 * (one source of truth — the blocks; one honest derived mirror — story).
 *
 * Block model v1 (minimal-blocks, sharing call 2): heading / prose /
 * element-card. The set grows (map, collection, image, callout, divider,
 * circle) without migration because pages are block-shaped from day one.
 *
 * ## The refs mirror (id-swap correctness)
 *
 * `rewriteIdReferences` (sync-engine) walks flat string + string-array fields
 * only — ids nested inside block OBJECTS would silently go stale when the OW
 * server assigns its own id on first push (the make-online journey: compose
 * pages locally → make online → every element id-swaps). Instead of teaching
 * the sync layer about block shapes, pages mirror every element-card's id
 * into the flat `atlas_page_refs: string[]` (in block order). The existing
 * rewrite contract handles that array automatically; `blocksOf()` heals each
 * element-card's nested id from the mirror at read time (positional pairing —
 * both are always written in the same save via `pageBlocksPatch`).
 */

import type { Element } from './types';

/** Narrative subtype that marks a page. Free-text subtype — no schema change. */
export const PAGE_SUBTYPE = 'page';

/** True iff the element is a page (a narrative tagged with the page subtype). */
export function isPageNarrative(el: Element | null | undefined): boolean {
  if (!el || el.type !== 'narrative') return false;
  const subtype = (el as Record<string, unknown>).subtype;
  return typeof subtype === 'string' && subtype.toLowerCase() === PAGE_SUBTYPE;
}

/** All pages among the given elements. */
export function listPages(elements: Element[]): Element[] {
  return elements.filter(isPageNarrative);
}

// ---------------------------------------------------------------------------
// Intent — the sharing axis (DESIGN_SHARING "three intents").
// ---------------------------------------------------------------------------

export type PageIntent = 'show' | 'reference' | 'publish';

export const PAGE_INTENTS: readonly PageIntent[] = ['show', 'reference', 'publish'];

/** Human hint per intent (list chips + the intent picker). */
export const PAGE_INTENT_HINTS: Record<PageIntent, string> = {
  show: 'social — look at this!',
  reference: 'selective — for a specific audience',
  publish: 'permanent — a curated destination',
};

/** A page's intent; defaults to 'show' when missing/unknown. */
export function pageIntentOf(el: Element): PageIntent {
  const raw = (el as Record<string, unknown>).atlas_page_intent;
  return typeof raw === 'string' && (PAGE_INTENTS as string[]).includes(raw)
    ? (raw as PageIntent)
    : 'show';
}

// ---------------------------------------------------------------------------
// Block model v1.
// ---------------------------------------------------------------------------

export interface HeadingBlock {
  id: string;
  kind: 'heading';
  text: string;
  /** 1 = section, 2 = subsection. */
  level: 1 | 2;
}

export interface ProseBlock {
  id: string;
  kind: 'prose';
  /** Markdown is canonical for the block (mirrors the writing room's storage model). */
  markdown: string;
  /** TipTap JSON for high-fidelity editing; null until edited richly. */
  richtextJson?: unknown | null;
}

export interface ElementCardBlock {
  id: string;
  kind: 'element-card';
  /** The bound element. Healed from `atlas_page_refs` on read — see module doc. */
  elementId: string;
  variant: 'compact' | 'full';
  /** Field names chosen as visible on the card (the disclosure primitive). */
  fields: string[];
}

export type PageBlock = HeadingBlock | ProseBlock | ElementCardBlock;

export function newBlockId(): string {
  return crypto.randomUUID();
}

/**
 * Parse a raw `atlas_page_blocks` value defensively: accept well-formed
 * blocks, drop anything malformed (wrong kind, missing required fields).
 * Never throws — a corrupted blocks array degrades to the valid subset.
 */
export function parsePageBlocks(raw: unknown): PageBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: PageBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const b = item as Record<string, unknown>;
    if (typeof b.id !== 'string' || b.id.length === 0) continue;
    switch (b.kind) {
      case 'heading':
        if (typeof b.text !== 'string') continue;
        out.push({ id: b.id, kind: 'heading', text: b.text, level: b.level === 2 ? 2 : 1 });
        break;
      case 'prose':
        if (typeof b.markdown !== 'string') continue;
        out.push({
          id: b.id, kind: 'prose', markdown: b.markdown,
          richtextJson: b.richtextJson && typeof b.richtextJson === 'object' ? b.richtextJson : null,
        });
        break;
      case 'element-card':
        if (typeof b.elementId !== 'string' || b.elementId.length === 0) continue;
        out.push({
          id: b.id, kind: 'element-card', elementId: b.elementId,
          variant: b.variant === 'full' ? 'full' : 'compact',
          fields: Array.isArray(b.fields) ? b.fields.filter((f): f is string => typeof f === 'string') : [],
        });
        break;
      default:
        continue; // unknown kind — forward-compat drop
    }
  }
  return out;
}

/**
 * The page's blocks, with element-card ids HEALED from the `atlas_page_refs`
 * mirror (positional: the i-th element-card pairs with refs[i]). After an
 * id-swap rewrites the flat refs array, this read adopts the fresh ids even
 * though the nested block copies are stale. Falls back to the block's own id
 * when the mirror is missing/short (out-of-band edits degrade gracefully).
 */
export function blocksOf(el: Element): PageBlock[] {
  const blocks = parsePageBlocks((el as Record<string, unknown>).atlas_page_blocks);
  const rawRefs = (el as Record<string, unknown>).atlas_page_refs;
  const refs = Array.isArray(rawRefs)
    ? rawRefs.filter((v): v is string => typeof v === 'string')
    : [];
  let cardIndex = 0;
  for (const b of blocks) {
    if (b.kind !== 'element-card') continue;
    const mirrored = refs[cardIndex];
    if (mirrored && mirrored !== b.elementId) b.elementId = mirrored;
    cardIndex++;
  }
  return blocks;
}

/** The flat refs mirror for a block stack: element-card ids in block order. */
export function pageRefsFor(blocks: readonly PageBlock[]): string[] {
  return blocks.filter((b): b is ElementCardBlock => b.kind === 'element-card').map(b => b.elementId);
}

/**
 * The write-side patch for a blocks change. ALWAYS save blocks through this
 * helper — it keeps the refs mirror and the derived story in lockstep with
 * the blocks (the positional-pairing invariant `blocksOf` heals from).
 */
export function pageBlocksPatch(
  blocks: readonly PageBlock[],
  resolveName: (elementId: string) => string | null,
): Record<string, unknown> {
  return {
    atlas_page_blocks: blocks,
    atlas_page_refs: pageRefsFor(blocks),
    story: compilePageStory(blocks, resolveName),
  };
}

/**
 * Derived `story` mirror: a plain-markdown compilation of the blocks. The
 * blocks are the source of truth (atlas-local); story is the synced, honest
 * derived copy other devices/tools can read. Regenerated whole on every save.
 */
export function compilePageStory(
  blocks: readonly PageBlock[],
  resolveName: (elementId: string) => string | null,
): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        parts.push(`${b.level === 2 ? '##' : '#'} ${b.text}`);
        break;
      case 'prose':
        if (b.markdown.trim()) parts.push(b.markdown.trim());
        break;
      case 'element-card':
        parts.push(`[ ${resolveName(b.elementId) ?? b.elementId} — element card ]`);
        break;
    }
  }
  return parts.join('\n\n');
}

/** "3 blocks", "1 block", or "empty" — list-row summary. */
export function blockSummary(blocks: readonly PageBlock[]): string {
  if (blocks.length === 0) return 'empty';
  return `${blocks.length} block${blocks.length === 1 ? '' : 's'}`;
}

/** Unique default name for a new page: "new page", "new page (2)", ... */
export function findUniquePageName(elements: Element[]): string {
  const names = new Set(listPages(elements).map(p => (p.name || '').toLowerCase()));
  if (!names.has('new page')) return 'new page';
  for (let i = 2; ; i++) {
    if (!names.has(`new page (${i})`)) return `new page (${i})`;
  }
}
