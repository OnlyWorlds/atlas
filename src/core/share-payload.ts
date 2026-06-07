/**
 * Publish payload builder — SHARING_CONTRACT.md §5 (v0.2).
 *
 * `buildPagePayload()` turns a page (Narrative `subtype:"page"`) + the world's
 * elements into the self-contained snapshot the backend stores and the viewer
 * renders with zero further fetches. This is THE wire shape: the visitor
 * preview renders from this same payload (share-room), so what authors see is
 * byte-identical to what `GET /pages/<slug>/` will serve.
 *
 * ## The disclosure mechanic (contract §5.1)
 *
 * `elements` carries ONLY card-bound elements, and ONLY their chosen fields.
 * Relation values are projected to token arrays `{ text, ref? }` at build
 * time: `ref` is present only when the target element is itself included —
 * a non-included element leaks nothing but a name the author chose to show
 * (and a dangling reference leaks nothing at all: the token is dropped).
 * Prose `ow://` links follow the same rule at RENDER time (the renderer
 * checks membership; see share-page-render).
 *
 * Pure module: no DOM, no store, no state — the SDK's FIELD_SCHEMA is its
 * only dependency (relation detection must match the editor's view of the
 * schema). Unit-tested in tests/unit/share-payload.test.ts.
 */

import { FIELD_SCHEMA } from '@onlyworlds/sdk';
import type { Element } from './types';
import {
  blocksOf, pageIntentOf,
  type PageBlock, type PageIntent, type ElementCardBlock, type CircleBlock,
  type HeadingBlock, type ProseBlock,
} from './sharing';
import { knowledgeHeldBy } from './knowledge';

// ---------------------------------------------------------------------------
// Payload types (the §5 wire shape).
// ---------------------------------------------------------------------------

/** Relation value token: plain text, optionally linkable when target is included. */
export interface RelationToken {
  text: string;
  /** Present ONLY when the referenced element is itself in `elements`. */
  ref?: string;
}

export interface PayloadElementEntry {
  name: string;
  type: string;
  image_url?: string;
  /** Chosen, populated fields — raw values, or RelationToken[] for relations. */
  fields: Record<string, unknown>;
}

/**
 * The payload form of a circle block: the knower's compiled knowledge FROZEN
 * at build time (the circle is the disclosure boundary — later knowledge
 * edits never leak into a published snapshot). Entry markdown follows the
 * prose disclosure rule at render time (ow:// targets resolve against the
 * payload's included set — usually plain text, unless the subject is also
 * carded on the page).
 */
export interface PayloadCircleBlock {
  id: string;
  kind: 'circle';
  knowerId: string;
  /** The knower's display name at publish time. */
  title: string;
  /** 'collective' (a circle) or 'character' (a lone knower). */
  knowerType: string;
  entries: Array<{ title: string; markdown: string }>;
}

/** A block as it appears in the PAYLOAD (circle blocks are frozen-compiled). */
export type PayloadBlock = HeadingBlock | ProseBlock | ElementCardBlock | PayloadCircleBlock;

export interface PagePayload {
  /** The PAYLOAD schema version — the viewer branches on this. */
  schema_version: 1;
  title: string;
  /** Advisory metadata only (viewer chrome + OG flavor) — never server behavior. */
  intent: PageIntent;
  /** Reserved — the ~6 theme tokens land with S3. */
  theme: Record<string, unknown>;
  blocks: PayloadBlock[];
  elements: Record<string, PayloadElementEntry>;
}

// ---------------------------------------------------------------------------
// Shared field predicates (used by the builder AND the renderers).
// ---------------------------------------------------------------------------

/**
 * Field names that never belong on a card or in a payload entry:
 * identity/meta, sync stamps, the image (rendered as the card image, not a
 * field row), and the whole atlas-local extension family.
 */
const CARD_SKIP_FIELDS = new Set([
  'id', 'type', 'name', 'local_updated_at', 'server_updated_at',
  'image_url',
]);

export function isCardSkipField(name: string): boolean {
  return CARD_SKIP_FIELDS.has(name) || name.startsWith('atlas_') || name === 'image_media_id';
}

/** Does this value carry displayable content? */
export function isPopulatedValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return true;
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

// ---------------------------------------------------------------------------
// Relation detection (schema-driven — matches the editor's widget resolution).
// ---------------------------------------------------------------------------

type RelationKind = 'single' | 'multi' | null;

function relationKindOf(elementType: string, fieldName: string): RelationKind {
  const meta = (FIELD_SCHEMA as Record<string, Record<string, { type?: string } | undefined>>)[elementType]?.[fieldName];
  if (meta?.type === 'single_link') return 'single';
  if (meta?.type === 'multi_link') return 'multi';
  return null;
}

/** Extract an element id from a raw relation value (bare id string, or a nested `{id}` defensively). */
function relationId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The builder.
// ---------------------------------------------------------------------------

export function buildPagePayload(page: Element, elements: Element[]): PagePayload {
  const byId = new Map(elements.map(e => [e.id, e]));
  const blocks = blocksOf(page);

  // Included set = card-bound elements that exist. Cards pointing at missing
  // elements stay in the block list (the viewer renders an honest placeholder)
  // but contribute nothing to `elements`.
  const cards = blocks.filter((b): b is ElementCardBlock => b.kind === 'element-card');
  const includedIds = new Set(cards.map(c => c.elementId).filter(id => byId.has(id)));

  // Chosen fields per included element: union across its FULL-variant cards
  // (compact cards are identity-only). Order: first-seen.
  const chosenFields = new Map<string, string[]>();
  for (const card of cards) {
    if (!includedIds.has(card.elementId) || card.variant !== 'full') continue;
    const list = chosenFields.get(card.elementId) ?? [];
    for (const f of card.fields) {
      if (!list.includes(f)) list.push(f);
    }
    chosenFields.set(card.elementId, list);
  }

  const tokenFor = (id: string): RelationToken | null => {
    const target = byId.get(id);
    if (!target) return null; // dangling ref — discloses nothing, drop it
    const token: RelationToken = { text: target.name || '(unnamed)' };
    if (includedIds.has(id)) token.ref = id;
    return token;
  };

  const entries: Record<string, PayloadElementEntry> = {};
  for (const id of includedIds) {
    const el = byId.get(id)!;
    const rec = el as Record<string, unknown>;
    const entry: PayloadElementEntry = {
      name: el.name || '(unnamed)',
      type: el.type,
      fields: {},
    };
    const imageUrl = rec.image_url;
    if (typeof imageUrl === 'string' && imageUrl.trim().length > 0) entry.image_url = imageUrl;

    for (const field of chosenFields.get(id) ?? []) {
      if (isCardSkipField(field)) continue; // defensive — UI never offers these
      const raw = rec[field];
      if (!isPopulatedValue(raw)) continue;
      const kind = relationKindOf(el.type, field);
      if (kind === null) {
        entry.fields[field] = raw;
        continue;
      }
      const rawIds = kind === 'single' ? [raw] : (Array.isArray(raw) ? raw : []);
      const tokens: RelationToken[] = [];
      for (const v of rawIds) {
        const refId = relationId(v);
        if (!refId) continue;
        const token = tokenFor(refId);
        if (token) tokens.push(token);
      }
      if (tokens.length > 0) entry.fields[field] = tokens;
    }
    entries[id] = entry;
  }

  // Prose blocks ship markdown only — richtextJson is an editing concern
  // (and the payload should stay lean; contract suggests a 256KB server cap).
  // Circle blocks FREEZE: the knower's compiled knowledge snapshots into the
  // block (entries' names + texts) — the published page never re-resolves.
  const payloadBlocks: PayloadBlock[] = blocks.map((b): PayloadBlock => {
    if (b.kind === 'prose') return { id: b.id, kind: 'prose', markdown: b.markdown };
    if (b.kind === 'circle') return freezeCircleBlock(b, elements, byId);
    return { ...b };
  });

  const rawTheme = (page as Record<string, unknown>).atlas_page_theme;
  return {
    schema_version: 1,
    title: page.name || '(untitled)',
    intent: pageIntentOf(page),
    theme: rawTheme && typeof rawTheme === 'object' && !Array.isArray(rawTheme)
      ? rawTheme as Record<string, unknown> : {},
    blocks: payloadBlocks,
    elements: entries,
  };
}

/**
 * Compile a circle block's knower into the frozen payload form. Exported for
 * the renderer: the builder's static view compiles live from world data, then
 * renders through the same path the payload uses (one look, two sources).
 */
export function freezeCircleBlock(
  block: CircleBlock,
  elements: Element[],
  byId: Map<string, Element>,
): PayloadCircleBlock {
  const knower = byId.get(block.knowerId);
  if (!knower) {
    return { id: block.id, kind: 'circle', knowerId: block.knowerId, title: '(missing knower)', knowerType: 'collective', entries: [] };
  }
  const held = knowledgeHeldBy(knower.id, elements)
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return {
    id: block.id,
    kind: 'circle',
    knowerId: knower.id,
    title: knower.name || '(unnamed)',
    knowerType: knower.type,
    entries: held.map(entry => ({
      title: entry.name || '(untitled)',
      markdown: typeof (entry as Record<string, unknown>).story === 'string'
        ? (entry as Record<string, unknown>).story as string : '',
    })),
  };
}
