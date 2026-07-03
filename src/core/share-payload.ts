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
  blocksOf, pageIntentOf, parsePageTheme,
  type PageBlock, type PageIntent, type ElementCardBlock, type CircleBlock,
  type CollectionBlock, type MapBlock, type HeadingBlock, type ProseBlock, type PageTheme,
} from './sharing';
import { knowledgeHeldBy } from './knowledge';
import { freezeChartBlock, type PayloadChartBlock } from '../visualization/timeline/chart-freeze';
import type { ChartConfig } from '../visualization/timeline/types';

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

/**
 * The payload form of a map block — frozen at build: the image URL + the
 * chosen pins as %-positioned identity tokens (top-left origin; pin storage
 * coords are image pixels, normalized via the map's width/height). `ref` is
 * present only when the pinned element is itself included (the standard
 * disclosure rule — hover shows identity, click-through needs a card).
 */
export interface PayloadMapBlock {
  id: string;
  kind: 'map';
  /** The map's display name at publish time. */
  title: string;
  image_url: string;
  /** Always-visible pin labels (absent = true; hover-only when false). */
  showLabels?: boolean;
  pins: Array<{ xPct: number; yPct: number; name: string; type: string; ref?: string }>;
}

/** A block as it appears in the PAYLOAD (circle/map blocks are frozen-compiled). */
export type PayloadBlock = HeadingBlock | ProseBlock | ElementCardBlock | PayloadCircleBlock | CollectionBlock | PayloadMapBlock | PayloadChartBlock;

export interface PagePayload {
  /** The PAYLOAD schema version — the viewer branches on this. */
  schema_version: 1;
  title: string;
  /** Advisory metadata only (viewer chrome + OG flavor) — never server behavior. */
  intent: PageIntent;
  /** The ~6 curated theme tokens (S3) — validated, allowlist-only. */
  theme: PageTheme;
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

/** Every card-eligible, populated field name of an element (disk order). */
export function populatedFieldNames(el: Element): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(el)) {
    if (isCardSkipField(key)) continue;
    if (isPopulatedValue(value)) out.push(key);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Disclosure scrub — the wire artifact must not carry undisclosed ids.
// ---------------------------------------------------------------------------

/** Markdown ow:// link: [label](ow://type/uuid) — the shape both renderers match. */
const MD_OW_LINK_RE = /\[([^\]]+?)\]\(ow:\/\/([a-z_-]+)\/([\w-]+)\)/gi;

/** Bare ow:// URI outside link syntax (hand-typed) — same leak, no label. */
const BARE_OW_LINK_RE = /ow:\/\/([a-z_-]+)\/([\w-]+)/gi;

/**
 * Pre-resolve markdown for the payload (contract §2): ow:// links whose
 * target is NOT included become plain label text BEFORE the payload ships.
 * The render-time rule (§5.1) still strips them visually, but the payload
 * JSON itself is served publicly — an `ow://character/<uuid>` in raw markdown
 * would leak the element's type, uuid, and cross-page linkable identity even
 * when no renderer ever shows it. Included targets keep their links (the
 * viewer chips them). Bare hand-typed ow:// URIs resolve to the element's
 * name when known, else drop.
 */
export function scrubMarkdownForPayload(
  markdown: string,
  includedIds: ReadonlySet<string>,
  byId: Map<string, Element>,
): string {
  let out = markdown.replace(MD_OW_LINK_RE, (whole, label: string, _type: string, id: string) =>
    includedIds.has(id) ? whole : label,
  );
  out = out.replace(BARE_OW_LINK_RE, (whole, _type: string, id: string) => {
    if (includedIds.has(id)) return whole;
    return byId.get(id)?.name ?? '';
  });
  return out;
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

export function buildPagePayload(page: Element, elements: Element[], charts: ChartConfig[] = []): PagePayload {
  const byId = new Map(elements.map(e => [e.id, e]));
  const blocks = blocksOf(page);

  // Included set = card-bound elements + collection members that exist.
  // Blocks pointing at missing elements stay in the block list (the viewer
  // renders honestly) but contribute nothing to `elements`.
  const cards = blocks.filter((b): b is ElementCardBlock => b.kind === 'element-card');
  const collections = blocks.filter((b): b is CollectionBlock => b.kind === 'collection');
  const includedIds = new Set(cards.map(c => c.elementId).filter(id => byId.has(id)));
  for (const col of collections) {
    for (const id of col.elementIds) {
      if (byId.has(id)) includedIds.add(id);
    }
  }

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

  // Image inclusion: ships when ANY card for the element wants it (showImage,
  // default true — compact renders it as an avatar, full as a banner). When
  // every card opts out, the url stays off the wire entirely. Collection
  // members always want it (the grid renders avatars).
  const imageWanted = new Set(
    cards.filter(c => includedIds.has(c.elementId) && c.showImage !== false).map(c => c.elementId),
  );
  for (const col of collections) {
    for (const id of col.elementIds) {
      if (byId.has(id)) imageWanted.add(id);
    }
  }

  // Pinned elements are disclosed BY INCLUSION (session 239, Captain's call):
  // the pin-click modal shows image + description + populated fields, so the
  // pin checklist is the disclosure gate for maps. Their entries project ALL
  // populated fields (relations still tokenized per the standard rule).
  for (const mb of blocks.filter((b): b is MapBlock => b.kind === 'map')) {
    for (const pinId of mb.pinIds) {
      const pin = byId.get(pinId);
      const targetId = pin ? (pin as Record<string, unknown>).element_id : null;
      const target = typeof targetId === 'string' ? byId.get(targetId) : undefined;
      if (!target) continue;
      includedIds.add(target.id);
      imageWanted.add(target.id);
      const list = chosenFields.get(target.id) ?? [];
      for (const f of populatedFieldNames(target)) {
        if (!list.includes(f)) list.push(f);
      }
      chosenFields.set(target.id, list);
    }
  }

  const entries: Record<string, PayloadElementEntry> = {};
  for (const id of includedIds) {
    entries[id] = projectElementEntry(
      byId.get(id)!, byId, includedIds, chosenFields.get(id) ?? [], imageWanted.has(id));
  }

  // Prose blocks ship markdown only — richtextJson is an editing concern
  // (and the payload should stay lean; contract suggests a 256KB server cap).
  // Markdown is disclosure-SCRUBBED at build: ow:// links to non-included
  // targets pre-resolve to plain labels (the payload is public; see
  // scrubMarkdownForPayload). Circle blocks FREEZE: the knower's compiled
  // knowledge snapshots into the block (entries' names + texts, scrubbed the
  // same way) — the published page never re-resolves.
  const payloadBlocks: PayloadBlock[] = blocks.map((b): PayloadBlock | null => {
    if (b.kind === 'prose') {
      return { id: b.id, kind: 'prose', markdown: scrubMarkdownForPayload(b.markdown, includedIds, byId) };
    }
    if (b.kind === 'circle') {
      const frozen = freezeCircleBlock(b, elements, byId);
      return {
        ...frozen,
        entries: frozen.entries.map(e => ({
          ...e, markdown: scrubMarkdownForPayload(e.markdown, includedIds, byId),
        })),
      };
    }
    if (b.kind === 'collection') {
      // Dangling members drop from the wire (their ids disclose nothing).
      return { id: b.id, kind: 'collection', elementIds: b.elementIds.filter(id => byId.has(id)) };
    }
    if (b.kind === 'map') return freezeMapBlock(b, byId, includedIds);
    if (b.kind === 'chart') return freezeChartBlock(b.chartId, b.id, charts, elements, includedIds);
    return { ...b };
  }).filter((b): b is PayloadBlock => b !== null);

  return {
    schema_version: 1,
    title: page.name || '(untitled)',
    intent: pageIntentOf(page),
    // Validated, never passthrough — the payload is public wire (S3).
    theme: parsePageTheme((page as Record<string, unknown>).atlas_page_theme),
    blocks: payloadBlocks,
    elements: entries,
  };
}

/**
 * Project one element into its payload entry form: identity + (optionally)
 * image + the given fields, populated-only, relations tokenized per the
 * disclosure rule (`ref` only when the target is itself included). Used by
 * the payload builder AND by the builder-side pin modal (which synthesizes
 * payload-true entries from world data on the fly).
 */
export function projectElementEntry(
  el: Element,
  byId: Map<string, Element>,
  includedIds: ReadonlySet<string>,
  fieldNames: readonly string[],
  withImage: boolean,
): PayloadElementEntry {
  const rec = el as Record<string, unknown>;
  const entry: PayloadElementEntry = {
    name: el.name || '(unnamed)',
    type: el.type,
    fields: {},
  };
  const imageUrl = rec.image_url;
  if (withImage && typeof imageUrl === 'string' && imageUrl.trim().length > 0) {
    entry.image_url = imageUrl;
  }
  for (const field of fieldNames) {
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
      const target = byId.get(refId);
      if (!target) continue; // dangling ref — discloses nothing, drop it
      const token: RelationToken = { text: target.name || '(unnamed)' };
      if (includedIds.has(refId)) token.ref = refId;
      tokens.push(token);
    }
    if (tokens.length > 0) entry.fields[field] = tokens;
  }
  return entry;
}

/**
 * Freeze a map block: image URL + chosen pins normalized to percentages
 * (top-left origin — pin storage coords ARE top-left image pixels; the map's
 * width/height fields hold the image dimensions, auto-detected by atlas when
 * image_url is set). Returns null — block drops from the wire — when the map
 * is missing, has no published image (D3: image_url only, local media never
 * leaves the folder), or has no usable dimensions. Pins drop individually
 * when their pin/element is gone (disclose nothing) or out of bounds.
 * Exported for the renderer (builder compiles live → same view).
 */
export function freezeMapBlock(
  block: MapBlock,
  byId: Map<string, Element>,
  includedIds: ReadonlySet<string>,
): PayloadMapBlock | null {
  const map = byId.get(block.mapId);
  if (!map) return null;
  const rec = map as Record<string, unknown>;
  const imageUrl = typeof rec.image_url === 'string' ? rec.image_url.trim() : '';
  if (!/^https?:\/\//i.test(imageUrl)) return null;
  const width = typeof rec.width === 'number' ? rec.width : 0;
  const height = typeof rec.height === 'number' ? rec.height : 0;
  if (width <= 0 || height <= 0) return null;

  const pins: PayloadMapBlock['pins'] = [];
  for (const pinId of block.pinIds) {
    const pin = byId.get(pinId);
    if (!pin) continue;
    const p = pin as Record<string, unknown>;
    const x = typeof p.x === 'number' ? p.x : NaN;
    const y = typeof p.y === 'number' ? p.y : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const target = typeof p.element_id === 'string' ? byId.get(p.element_id) : undefined;
    if (!target) continue; // pin without a live element discloses nothing
    const token: PayloadMapBlock['pins'][number] = {
      xPct: Math.round(Math.min(100, Math.max(0, (x / width) * 100)) * 100) / 100,
      yPct: Math.round(Math.min(100, Math.max(0, (y / height) * 100)) * 100) / 100,
      name: target.name || '(unnamed)',
      type: target.type,
    };
    if (includedIds.has(target.id)) token.ref = target.id;
    pins.push(token);
  }

  const frozen: PayloadMapBlock = {
    id: block.id,
    kind: 'map',
    title: map.name || '(unnamed map)',
    image_url: imageUrl,
    pins,
  };
  if (block.showLabels === false) frozen.showLabels = false;
  return frozen;
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
