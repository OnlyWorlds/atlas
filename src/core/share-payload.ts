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
 * Pure module: no DOM, no store, no state — the SDK's FIELD_SCHEMA (read through `relationFieldsFor`) is its
 * only dependency (relation detection must match the editor's view of the
 * schema). Unit-tested in tests/unit/share-payload.test.ts.
 */

import { ALL_ELEMENT_TYPES, type Element, type ElementType } from './types';
import { SERVER_AUTHOR_FIELDS, SERVER_MARK_FIELDS, SERVER_STAMP_FIELDS, isProfileField } from './constants';
import { relationFieldsFor } from '../editor/field-schema';
import { isStraySpelling } from '../store/disk-link-names';
import {
  blocksOf, pageIntentOf, parsePageTheme,
  type PageBlock, type PageIntent, type ElementCardBlock, type CircleBlock,
  type CollectionBlock, type MapBlock, type HeadingBlock, type ProseBlock, type PageTheme,
} from './sharing';
import { knowledgeHeldBy } from './knowledge';
import { handsOnAsProposed } from './review-mark';
import { isHiddenMark } from './hidden-mark';
import { findAddresses, findLooseAddressRuns, isPrefixAlone, namedId, plainRunId } from './ow-links';
// Pure shape/geometry helpers (no DOM) — one resolver for zone shape across
// canvas, builder, and payload; the tabs/right location is historical.
import { getZoneShape } from '../tabs/right/zone-derived';
import { freezeChartBlock, type PayloadChartBlock } from '../visualization/timeline/chart-freeze';
import type { ChartConfig } from '../visualization/timeline/types';
import { capitalise, missingLabel, nameOrUnnamed, ownName, theUnnamed } from './type-words';

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
 * chosen pins as %-positioned identity tokens (top-left CSS origin; pin
 * storage coords are bottom-left image pixels, converted once in
 * `freezeMapBlock` via the map's width/height). `ref` is
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
  /**
   * Zone overlays (additive — old payloads/viewers unaffected):
   * %-normalized polygon/line geometry compiled from the zone's markers on
   * this map. `ref` present only when the zone element is itself included
   * (the standard disclosure rule).
   */
  zones?: Array<{
    name: string;
    shape: 'polygon' | 'line';
    points: Array<{ xPct: number; yPct: number }>;
    ref?: string;
  }>;
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
 * field row), the whole atlas-local extension family, and what the server
 * says about an element (1.125.14: the world it is in, when and by whom and
 * through which door it was written, its marks, and `known_of`, a stub's
 * mark, which says how its reader sees the world). A Full pin sends every
 * filled field this does not skip, so a server field left off this list is
 * published by every Full pin. A published profile's key (`isProfileField`:
 * a room's, a review's, a report's mark and the like) is machinery other
 * tools read, some of it ids of this world, and is no card field either; a
 * person's own `x_` field is. `__proto__` is never a field: a file can hold
 * it as a key.
 */
const CARD_SKIP_FIELDS = new Set<string>([
  'id', 'type', 'name', 'local_updated_at', 'server_updated_at',
  'image_url',
  ...SERVER_STAMP_FIELDS, ...SERVER_AUTHOR_FIELDS, ...SERVER_MARK_FIELDS,
  'known_of', '__proto__',
]);

export function isCardSkipField(name: string): boolean {
  return CARD_SKIP_FIELDS.has(name) || name.startsWith('atlas_') || name === 'image_media_id' || isProfileField(name);
}

/**
 * A field a card can offer and send for this element: no skipped name, and no
 * stray spelling of a pin's or marker's link (`isStraySpelling`), so a file
 * holding `map` beside `map_id` offers and sends the one map Atlas reads.
 */
export function isCardFieldOf(el: Element, name: string): boolean {
  return !isCardSkipField(name) && !isStraySpelling(el, name);
}

/** Does this object hold the key itself? Never `in` or a bare lookup: a world file can tick `constructor`, or card an element by that id. */
function holdsKey(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
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
    if (!isCardFieldOf(el, key)) continue;
    if (isPopulatedValue(value)) out.push(key);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Disclosure scrub — the wire artifact must not carry undisclosed ids.
// ---------------------------------------------------------------------------

/** Scrub target for text that never chips (card field values): drop every link. */
const NO_IDS: ReadonlySet<string> = new Set<string>();

/** The rest of a link's href after the scrubbed span, to its `)` (sticky: read in place, never a copy). */
const LINK_CLOSE = /[^\s()<>]*(?:\s*>)?(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/y;

/** An id in the form Atlas and onlyworlds.com make (8-4-4-4-12 hex, either case): the only form the address rules read. */
const ID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * An id whose end no run can find: it holds a character a loose run is cut at
 * (white space, `)`), or ends in a mark a run's end leaves to its sentence
 * (`RUN_CLOSERS` in ow-links).
 */
const NO_FINDABLE_END = /[\s)]|[.,;:!?'"\]>]$/;
const TYPE_WORDS: ReadonlySet<string> = new Set<string>(ALL_ELEMENT_TYPES);

/** 0: every id is an id-form. 1: the world holds a hand id. 2: one of them has no end a run can find. */
type HandIds = 0 | 1 | 2;
/** Read once for each map handed in (the payload builder makes its maps anew, and nothing writes to one after). */
const HAND_IDS = new WeakMap<Map<string, Element>, HandIds>();

function handIdsOf(held: Map<string, Element>): HandIds {
  const known = HAND_IDS.get(held);
  if (known !== undefined) return known;
  let found: HandIds = 0;
  for (const id of held.keys()) {
    if (ID_FORM.test(id)) continue;
    found = 1;
    if (NO_FINDABLE_END.test(id)) { found = 2; break; }
  }
  HAND_IDS.set(held, found);
  return found;
}

/**
 * Where a link's label opens, for the `](` at `open`: the `[` that matches
 * its `]`, nested brackets counted (`[a [b] c]`); with none (`[a]b]`), the
 * nearest `[`. Never before `floor` (text already written out) and never
 * across a blank line; -1 when there is none.
 */
function labelStartBefore(md: string, open: number, floor: number): number {
  let depth = 0;
  let nearest = -1;
  for (let k = open - 1; k >= floor; k--) {
    const c = md[k];
    if (c === '\n' && md[k - 1] === '\n') break;
    if (c === ']') depth++;
    else if (c === '[') {
      if (nearest === -1) nearest = k;
      if (depth === 0) return k;
      depth--;
    }
  }
  return nearest;
}

/**
 * Pre-resolve markdown for the payload (contract §2): an address whose
 * element or lens is NOT included is taken out BEFORE the payload ships.
 * The render-time rule (§5.1) still strips them visually, but the payload
 * JSON itself is served publicly — an `ow://character/<uuid>` in raw markdown
 * would leak the element's type, uuid, and cross-page linkable identity even
 * when no renderer ever shows it.
 *
 * Two passes, and the scrub is the one reader that reads WIDER than the
 * address rules, because it guards disclosure:
 *   1. every address the SDK reads (`findAddresses`: either form, any world),
 *      whose element (`namedId` against the world: as written, then
 *      lowercase) or lens is not on the page;
 *   2. every loose run (`findLooseAddressRuns`: an `ow://` or onlyworlds.com
 *      `/w/` prefix in any case, to the next space or `)`) holding an id-form
 *      not on the page: one that names a held element (`namedId`, as written,
 *      then lowercase) is on the page only when that element is; one that
 *      names none is compared lowercase. A link in capitals, an unknown type
 *      word, another query key, a glued address or a world's id is still seen,
 *      and an id in capitals is never read as its lowercase twin on the page.
 * A world holding hand ids (an id that is no id-form: a folder made by hand)
 * is read more strictly, since neither pass can say which part of a run is
 * such an id: a run is kept only when it is plain, and none is kept when a
 * hand id has no end a run can find (conv. 196).
 *
 * `held` is every id the WORLD holds, a hidden or proposed element's too:
 * the page leaves those out, and the scrub must still know each as an id.
 * Inside a markdown link `[label](…)` the whole link becomes its label (THE
 * LABEL LAW: never the element's name); a bare address or run becomes
 * nothing, so no name of an element left off the page ever ships.
 */
export function scrubMarkdownForPayload(
  markdown: string,
  includedIds: ReadonlySet<string>,
  held: Map<string, Element>,
): string {
  if (typeof markdown !== 'string') return markdown;
  const has = (id: string): boolean => held.has(id);
  const onPage = (asWritten: string | null, reading: string | null): boolean => {
    if (asWritten === null || reading === null) return true;
    const named = namedId({ idAsWritten: asWritten, id: reading }, has);
    return named !== null && includedIds.has(named);
  };
  const includedLower = new Set<string>();
  for (const id of includedIds) includedLower.add(id.toLowerCase());

  const handIds = handIdsOf(held);
  const spans: Array<{ start: number; end: number }> = [];
  /** The addresses kept that sit inside this world (`ow://<type>/<id>`, a moment and a lens at most), by where each starts. */
  const keptInWorld = new Map<number, number>();
  for (const f of findAddresses(markdown)) {
    if (onPage(f.idAsWritten, f.reading.id) && onPage(f.lensAsWritten, f.reading.lens)) {
      if (f.reading.form === 'text' && f.reading.world === null) keptInWorld.set(f.start, f.end);
      continue;
    }
    spans.push({ start: f.start, end: f.end });
  }
  const looseOnPage = (asWritten: string): boolean => {
    const named = namedId({ idAsWritten: asWritten, id: asWritten.toLowerCase() }, has);
    return named !== null ? includedIds.has(named) : includedLower.has(asWritten.toLowerCase());
  };
  // A world holding hand ids: a run is kept only when it is plain. Either the
  // address rules read it whole as an address inside this world, or it is
  // `ow://`, a type word, a slash and the id of an element on the page, to its
  // last character. Nothing else can stand in a run that is kept, so no id of
  // any shape rides in one. And a run ends at white space, a `)` or a
  // sentence's closing mark: where a hand id holds one of the first two or
  // ends in the third, a plain run could be the start of that id, so only a
  // prefix with nothing after it is kept.
  const plain = (start: number, end: number): boolean => {
    if (isPrefixAlone(markdown, start, end)) return true;
    if (handIds === 2) return false;
    if (keptInWorld.get(start) === end) return true;
    const id = plainRunId(markdown, start, end, TYPE_WORDS);
    if (id === null) return false;
    const named = namedId({ idAsWritten: id, id: id.toLowerCase() }, has);
    return named !== null && includedIds.has(named);
  };
  for (const run of findLooseAddressRuns(markdown)) {
    const kept = run.idsAsWritten.every(looseOnPage) && (handIds === 0 || plain(run.start, run.end));
    if (kept) continue;
    spans.push({ start: run.start, end: run.end });
  }
  if (spans.length === 0) return markdown;
  spans.sort((x, y) => x.start - y.start || y.end - x.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const sp of spans) {
    const lastSpan = merged[merged.length - 1];
    if (lastSpan && sp.start < lastSpan.end) lastSpan.end = Math.max(lastSpan.end, sp.end);
    else merged.push({ ...sp });
  }

  // Where a hand id may hold a space, a link's href can go on past its run in
  // ways LINK_CLOSE does not read: the link then closes at the first `)` of
  // its line. The two finds only ever move forward, so the whole text is read
  // once however many links it holds.
  let nextClose = -2;
  let nextBreak = -2;
  const wideCloseLength = (from: number): number => {
    if (nextClose !== -1 && nextClose < from) nextClose = markdown.indexOf(')', from);
    if (nextBreak !== -1 && nextBreak < from) nextBreak = markdown.indexOf('\n', from);
    if (nextClose === -1 || (nextBreak !== -1 && nextBreak < nextClose)) return -1;
    return nextClose + 1 - from;
  };

  let out = '';
  let last = 0;
  for (const sp of merged) {
    if (sp.start < last) continue; // inside a markdown link already replaced
    // `[label](…)` (an href in angle brackets too): the whole link becomes its
    // label. The href may go on past the span (a query, a fragment, a closing
    // `>`, a title in "…", '…' or (…)) up to its `)`.
    const angle = markdown.slice(sp.start - 3, sp.start) === '](<';
    const open = angle ? sp.start - 3 : (markdown.slice(sp.start - 2, sp.start) === '](' ? sp.start - 2 : -1);
    const labelStart = open !== -1 ? labelStartBefore(markdown, open, last) : -1;
    LINK_CLOSE.lastIndex = sp.end;
    const close = labelStart !== -1 ? LINK_CLOSE.exec(markdown) : null;
    const closeLength = close ? close[0].length : (labelStart !== -1 && handIds === 2 ? wideCloseLength(sp.end) : -1);
    if (labelStart !== -1 && closeLength !== -1) {
      out += markdown.slice(last, labelStart) + markdown.slice(labelStart + 1, open);
      last = sp.end + closeLength;
      continue;
    }
    out += markdown.slice(last, sp.start);
    last = sp.end;
  }
  return last === 0 ? markdown : out + markdown.slice(last);
}

// ---------------------------------------------------------------------------
// Relation detection (schema-driven — matches the editor's widget resolution).
// ---------------------------------------------------------------------------

type RelationKind = 'single' | 'multi' | null;

const relationKinds = new Map<string, Map<string, 'single' | 'multi'>>();

/**
 * A field's link kind, by the name the file holds it under: a pin's and a
 * marker's link fields are `map_id` and `zone_id` on disk (`relationFieldsFor`),
 * and read by the schema's bare name they went out as raw ids (1.125.14).
 * Both names are read: a file from another tool can hold the bare one.
 */
function relationKindOf(elementType: string, fieldName: string): RelationKind {
  let kinds = relationKinds.get(elementType);
  if (!kinds) {
    kinds = new Map(relationFieldsFor(elementType as ElementType).flatMap(r => [[r.schemaField, r.kind], [r.diskField, r.kind]]));
    relationKinds.set(elementType, kinds);
  }
  return kinds.get(fieldName) ?? null;
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

/**
 * A published page hands the world on: an element written as proposed and not
 * yet settled by a keeper (the review profile's reader rule, conv. 168), or one
 * the world hides (folder spec §4.8, conv. 170), is left out, as a missing
 * element is, from every block (a card, a collection, a map's pins, a circle's
 * entries, a chart, a link field's names).
 */
export function leftOutOfPage(el: unknown): boolean {
  return handsOnAsProposed(el) || isHiddenMark(el);
}

export function buildPagePayload(page: Element, elements: Element[], charts: ChartConfig[] = []): PagePayload {
  const handed = handedOn(elements);
  // The scrub asks the whole world which ids it holds: a hidden or proposed
  // element is left out of every block, and its id must still be known as an id.
  return buildPayloadFrom(page, handed, charts, handed === elements ? undefined : elements);
}

/** The elements a published page may name: all but the left out (conv. 168, 170). */
function handedOn(elements: Element[]): Element[] {
  return elements.some(leftOutOfPage) ? elements.filter(e => !leftOutOfPage(e)) : elements;
}

// ---------------------------------------------------------------------------
// What a page shares, read before Publish (1.125.13).
// ---------------------------------------------------------------------------

/** One block that sends something of an element: what it sends, and the block its press opens. */
export interface SharePart {
  kind: 'card' | 'map' | 'collection';
  /** The page block that sends it; the press beside the part opens this block's editor. */
  blockId: string;
  /** Field NAMES (the room labels them), each one the payload's entry holds and this block sends. */
  fields: string[];
  /** This block sends the element's picture (the entry holds an `image_url`). */
  picture: boolean;
  /** A map part: the map's name as published, and this element's pins on it that show. */
  mapTitle?: string;
  pinIds?: string[];
  /** A map part: those of `pinIds` that are Full (each sends every filled field). */
  fullPinIds?: string[];
}

/** One element whose payload entry sends a field or a picture. */
export interface ShareRow {
  elementId: string;
  name: string;
  type: string;
  /** The element has no name of its own (`name` is then its unnamed form). */
  unnamed: boolean;
  parts: SharePart[];
  /** A field the entry sends that no block above sends (none expected; nothing sent goes unlisted). */
  also: string[];
}

/** What else the payload carries, each only where its carrier is in the payload. */
export interface ShareClauses {
  /** A map block: its picture and its pins' and zones' names. */
  maps: boolean;
  /** A link field's names, in any entry (a card's ticked link, or a full pin's). */
  links: boolean;
  /** A link names an element not on the page (a token with no `ref`). */
  linksOffPage: boolean;
  /** A chart block that draws something: the names and dates of what it draws. */
  charts: boolean;
  /** Each circle block with entries: its knower's name as published, and how many entries. */
  circles: Array<{ knower: string; entries: number }>;
}

export interface PageShares {
  rows: ShareRow[];
  /** Elements whose entry sends neither a field nor a picture, by name, in page order. */
  nameOnly: string[];
  clauses: ShareClauses;
}

/** A payload's entry for an id, or undefined: only an entry the payload itself holds. */
function entryOf(payload: PagePayload, id: string): PayloadElementEntry | undefined {
  return holdsKey(payload.elements, id) ? payload.elements[id] : undefined;
}

/**
 * What a page shares, from the payload `buildPagePayload` returned for it and
 * the page's own blocks (`blocksOf`) beside it: what is sent is read from the
 * payload, and which block sends it from the blocks (which card ticks what,
 * which pins are Full, which collections hold whom). A part lists only fields
 * the payload's entry holds. A field two blocks send is listed under both, so
 * turning it off in one leaves it visibly under the other. `elements` is the
 * world, read only to place pins on their elements as the payload does.
 */
export function pageShares(payload: PagePayload, blocks: readonly PageBlock[], elements: Element[]): PageShares {
  const byId = new Map(handedOn(elements).map(e => [e.id, e]));
  const frozenMaps = new Map<string, PayloadMapBlock>();
  for (const b of payload.blocks) if (b.kind === 'map') frozenMaps.set(b.id, b);

  // Parts per element, walking the blocks in page order; the walk also fixes
  // each element's first appearance, which orders the rows.
  const order: string[] = [];
  const seen = (id: string): void => { if (!order.includes(id)) order.push(id); };
  const partsOf = new Map<string, SharePart[]>();
  const add = (id: string, part: SharePart): void => {
    if (part.fields.length === 0 && !part.picture) return; // a part appears only when it lists something
    const list = partsOf.get(id) ?? [];
    list.push(part);
    partsOf.set(id, list);
  };

  for (const b of blocks) {
    if (b.kind === 'element-card') {
      seen(b.elementId);
      const entry = entryOf(payload, b.elementId);
      if (!entry) continue;
      // A compact card sends no field of its own (the payload unions full cards only).
      const fields = b.variant === 'full' ? b.fields.filter(f => holdsKey(entry.fields, f)) : [];
      add(b.elementId, {
        kind: 'card', blockId: b.id, fields: [...new Set(fields)],
        picture: b.showImage !== false && entry.image_url !== undefined,
      });
    } else if (b.kind === 'collection') {
      for (const id of new Set(b.elementIds)) {
        seen(id);
        const entry = entryOf(payload, id);
        if (entry) add(id, { kind: 'collection', blockId: b.id, fields: [], picture: entry.image_url !== undefined });
      }
    } else if (b.kind === 'map') {
      const frozen = frozenMaps.get(b.id);
      if (!frozen) continue; // the map does not show: its pins send nothing
      const pinsByTarget = new Map<string, Array<{ pinId: string; target: Element }>>();
      for (const fp of frozenPinTargets(b, byId)) {
        seen(fp.target.id);
        const list = pinsByTarget.get(fp.target.id) ?? [];
        list.push(fp);
        pinsByTarget.set(fp.target.id, list);
      }
      for (const [id, pins] of pinsByTarget) {
        const entry = entryOf(payload, id);
        if (!entry) continue;
        // What this block's pins send, as the payload builds it: a pin its
        // description, a Full pin every filled field.
        const sent = new Set<string>(['description']);
        for (const { pinId, target } of pins) {
          if ((b.fullPinIds ?? []).includes(pinId)) for (const f of populatedFieldNames(target)) sent.add(f);
        }
        add(id, {
          kind: 'map', blockId: b.id,
          fields: Object.keys(entry.fields).filter(f => sent.has(f)),
          picture: entry.image_url !== undefined,
          mapTitle: frozen.title,
          pinIds: pins.map(p => p.pinId),
          fullPinIds: pins.map(p => p.pinId).filter(pinId => (b.fullPinIds ?? []).includes(pinId)),
        });
      }
    }
  }
  for (const id of Object.keys(payload.elements)) seen(id);

  const rows: ShareRow[] = [];
  const nameOnly: string[] = [];
  for (const id of order) {
    const entry = entryOf(payload, id);
    if (!entry) continue; // hidden, proposed or missing: no row, not counted
    if (Object.keys(entry.fields).length === 0 && entry.image_url === undefined) {
      nameOnly.push(entry.name);
      continue;
    }
    const parts = partsOf.get(id) ?? [];
    const listed = new Set(parts.flatMap(p => p.fields));
    rows.push({
      elementId: id, name: entry.name, type: entry.type, parts,
      unnamed: !ownName(byId.get(id) ?? { name: '' }),
      also: Object.keys(entry.fields).filter(f => !listed.has(f)),
    });
  }

  let links = false;
  let linksOffPage = false;
  for (const entry of Object.values(payload.elements)) {
    for (const [field, value] of Object.entries(entry.fields)) {
      if (relationKindOf(entry.type, field) === null || !Array.isArray(value)) continue;
      links = true;
      if ((value as RelationToken[]).some(t => !t.ref)) linksOffPage = true;
    }
  }
  return {
    rows,
    nameOnly,
    clauses: {
      maps: frozenMaps.size > 0,
      links,
      linksOffPage,
      // A chart that draws nothing names nothing.
      charts: payload.blocks.some(b => b.kind === 'chart' && b.nodes.length > 0),
      // A missing knower freezes with no entries, so "with entries" is "its knower resolves".
      circles: payload.blocks.flatMap(b => b.kind === 'circle' && b.entries.length > 0
        ? [{ knower: b.title, entries: b.entries.length }] : []),
    },
  };
}

/** `pageShares` for a page as the next Publish would send it: the payload built once, then read. */
export function pageSharesOf(page: Element, elements: Element[], charts: ChartConfig[] = []): PageShares {
  return pageShares(buildPagePayload(page, elements, charts), blocksOf(page), elements);
}

/**
 * What publishing leaves out of this page for one reason (`out`), for the
 * builder's line: the elements its blocks name that are themselves out, an
 * out pin as "a pin on <its element>", and a circle's entries that are out.
 * An element whose only way onto the page was a pin that is out is never named.
 * Empty when nothing on the page is.
 */
function leftOutBy(page: Element, elements: Element[], charts: ChartConfig[], out: (el: unknown) => boolean): string[] {
  if (!elements.some(out)) return [];
  const byId = new Map(elements.map(e => [e.id, e]));
  const whole = buildPayloadFrom(page, elements, charts);
  const handed = buildPayloadFrom(page, elements.filter(e => !out(e)), charts, elements);
  const names = Object.entries(whole.elements)
    .filter(([id]) => !holdsKey(handed.elements, id) && out(byId.get(id)))
    .map(([, e]) => e.name);
  for (const b of blocksOf(page)) {
    if (b.kind !== 'map') continue;
    for (const pinId of b.pinIds) {
      const pin = byId.get(pinId);
      if (!pin || !out(pin)) continue;
      const targetId = (pin as Record<string, unknown>).element_id;
      const target = typeof targetId === 'string' ? byId.get(targetId) : undefined;
      if (target && !out(target)) names.push(`a pin on ${nameOrUnnamed(target)}`);
    }
  }
  const entries = (p: PagePayload) => p.blocks.flatMap(b => b.kind === 'circle' ? b.entries.map(e => e.title) : []);
  const kept = entries(handed);
  for (const title of entries(whole)) {
    const at = kept.indexOf(title);
    if (at >= 0) kept.splice(at, 1);
    else names.push(title);
  }
  return names;
}

export function proposedLeftOut(page: Element, elements: Element[], charts: ChartConfig[] = []): string[] {
  return leftOutBy(page, elements, charts, handsOnAsProposed);
}

export function hiddenLeftOut(page: Element, elements: Element[], charts: ChartConfig[] = []): string[] {
  return leftOutBy(page, elements, charts, isHiddenMark);
}

/** A page that is itself left out is not published at all: its own text would go out. */
export function pageNotPublishedLine(page: Element): string | null {
  if (isHiddenMark(page)) return 'This page is hidden, so it is not published: a published page is read by anyone with its address.';
  if (handsOnAsProposed(page)) return 'This page is proposed and not yet reviewed, so it can be published once a keeper accepts it.';
  return null;
}

/**
 * The builder's line about what publishing leaves out (conv. 168, 170), or null:
 * the page's own refusal, else what is hidden, then what is proposed.
 */
export function leftOutPageLine(page: Element, elements: Element[], charts: ChartConfig[] = []): string | null {
  const refused = pageNotPublishedLine(page);
  if (refused) return refused;
  const lines = [hiddenPageLine(page, elements, charts), proposedPageLine(page, elements, charts)].filter((l): l is string => l !== null);
  return lines.length > 0 ? lines.join(' ') : null;
}

function namesOf(leftOut: string[]): string {
  return leftOut.slice(0, 3).join(', ') + (leftOut.length > 3 ? ` and ${leftOut.length - 3} more` : '');
}

function hiddenPageLine(page: Element, elements: Element[], charts: ChartConfig[]): string | null {
  const leftOut = hiddenLeftOut(page, elements, charts);
  if (leftOut.length === 0) return null;
  const names = namesOf(leftOut);
  return leftOut.length === 1
    ? `${names.charAt(0).toUpperCase()}${names.slice(1)} is hidden, so the published page leaves it out.`
    : `${leftOut.length} hidden (${names}) are left out of the published page.`;
}

function proposedPageLine(page: Element, elements: Element[], charts: ChartConfig[]): string | null {
  const leftOut = proposedLeftOut(page, elements, charts);
  if (leftOut.length === 0) return null;
  const names = namesOf(leftOut);
  return leftOut.length === 1
    ? `${names.charAt(0).toUpperCase()}${names.slice(1)} is proposed and not yet reviewed, so the published page leaves it out until a keeper accepts it.`
    : `${leftOut.length} proposed and not yet reviewed (${names}) are left out of the published page until a keeper accepts them.`;
}

function buildPayloadFrom(page: Element, elements: Element[], charts: ChartConfig[], world?: Element[]): PagePayload {
  const byId = new Map(elements.map(e => [e.id, e]));
  /** Every id the world holds, the left out too: what the scrub reads an id against (conv. 196). */
  const held = world ? new Map(world.map(e => [e.id, e])) : byId;
  const blocks = blocksOf(page);

  // Included set = card-bound elements + collection members that exist.
  // A card pointing at a missing element contributes nothing to `elements`
  // and leaves the block list too (1.125.14, below).
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

  // Pinned elements are disclosed BY INCLUSION, identity-first (B6, settled
  // 2026-07-03 — supersedes the earlier full-fields default): an included
  // pin ships its element as name/type/description (+ image); only pins the
  // author explicitly opted in via `fullPinIds` ship every populated field.
  // Fields another block (card/collection) separately disclosed still union
  // in — a map can never DOWNGRADE a deliberate card disclosure.
  // Only a pin that itself freezes into its map block sends its element
  // (1.125.13): a map with no published image or no size, a hidden or missing
  // map, or a pin with no place draws nothing, so it sends nothing.
  for (const mb of blocks.filter((b): b is MapBlock => b.kind === 'map')) {
    for (const { pinId, target } of frozenPinTargets(mb, byId)) {
      includedIds.add(target.id);
      imageWanted.add(target.id);
      const full = (mb.fullPinIds ?? []).includes(pinId);
      const list = chosenFields.get(target.id) ?? [];
      const wanted = full ? populatedFieldNames(target) : ['description'];
      for (const f of wanted) {
        if (!list.includes(f)) list.push(f);
      }
      chosenFields.set(target.id, list);
    }
  }

  // No prototype: an element's id is a key here, and a hand-made file can call
  // one `__proto__` or `constructor`.
  const entries: Record<string, PayloadElementEntry> = Object.create(null);
  for (const id of includedIds) {
    entries[id] = projectElementEntry(
      byId.get(id)!, byId, includedIds, chosenFields.get(id) ?? [], imageWanted.has(id), held);
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
      return { id: b.id, kind: 'prose', markdown: scrubMarkdownForPayload(b.markdown, includedIds, held) };
    }
    if (b.kind === 'circle') {
      const frozen = freezeCircleBlock(b, elements, byId);
      return {
        ...frozen,
        // The knower's id ships only when the knower is
        // itself included (the relation-token `ref` rule). Empty string, not
        // absent: the viewer's parser drops a circle block without one.
        knowerId: includedIds.has(frozen.knowerId) ? frozen.knowerId : '',
        entries: frozen.entries.map(e => ({
          ...e, markdown: scrubMarkdownForPayload(e.markdown, includedIds, held),
        })),
      };
    }
    if (b.kind === 'collection') {
      // Dangling members drop from the wire (their ids disclose nothing).
      return { id: b.id, kind: 'collection', elementIds: b.elementIds.filter(id => byId.has(id)) };
    }
    if (b.kind === 'map') return freezeMapBlock(b, byId, includedIds);
    if (b.kind === 'chart') return freezeChartBlock(b.chartId, b.id, charts, elements, includedIds);
    if (b.kind === 'element-card') {
      // A card leaves with its element (1.125.14): one that is hidden,
      // proposed or no longer in the world drew nothing, and its block named
      // the element's id and its ticked fields on a public wire. A card that
      // stays names only the fields its entry holds, each once (a full card's
      // ticks that are filled and sendable; a compact card draws none).
      const entry = holdsKey(entries, b.elementId) ? entries[b.elementId] : undefined;
      if (!entry) return null;
      return { ...b, fields: b.variant === 'full' ? [...new Set(b.fields)].filter(f => holdsKey(entry.fields, f)) : [] };
    }
    return { ...b };
  }).filter((b): b is PayloadBlock => b !== null);

  return {
    schema_version: 1,
    title: nameOrUnnamed(page, { start: true, word: 'page' }),
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
  /** Every id the world holds, for the scrub of a field's text; `byId` when the caller's map is the whole world. */
  held: Map<string, Element> = byId,
): PayloadElementEntry {
  const rec = el as Record<string, unknown>;
  const entry: PayloadElementEntry = {
    name: nameOrUnnamed(el, { start: true }),
    type: el.type,
    fields: {},
  };
  const imageUrl = rec.image_url;
  if (withImage && typeof imageUrl === 'string' && imageUrl.trim().length > 0) {
    entry.image_url = imageUrl;
  }
  for (const field of fieldNames) {
    if (!isCardFieldOf(el, field)) continue; // defensive — UI never offers these
    const raw = rec[field];
    if (!isPopulatedValue(raw)) continue;
    const kind = relationKindOf(el.type, field);
    if (kind === null) {
      // Field text is public wire too. Scrub every ow:// link
      // to its label (empty included set: cards render fields as plain text,
      // so no link survives, disclosed or not).
      entry.fields[field] = typeof raw === 'string' ? scrubMarkdownForPayload(raw, NO_IDS, held) : raw;
      continue;
    }
    const rawIds = kind === 'single' ? [raw] : (Array.isArray(raw) ? raw : []);
    const tokens: RelationToken[] = [];
    for (const v of rawIds) {
      const refId = relationId(v);
      if (!refId) continue;
      const target = byId.get(refId);
      if (!target) continue; // dangling ref — discloses nothing, drop it
      const token: RelationToken = { text: nameOrUnnamed(target, { start: true }) };
      if (includedIds.has(refId)) token.ref = refId;
      tokens.push(token);
    }
    if (tokens.length > 0) entry.fields[field] = tokens;
  }
  return entry;
}

/** A map block's map as it publishes: present, with an http(s) image and a size; else null (the block drops). */
function mapFrameOf(block: MapBlock, byId: Map<string, Element>): { map: Element; imageUrl: string; width: number; height: number } | null {
  const map = byId.get(block.mapId);
  if (!map) return null;
  const rec = map as Record<string, unknown>;
  const imageUrl = typeof rec.image_url === 'string' ? rec.image_url.trim() : '';
  if (!/^https?:\/\//i.test(imageUrl)) return null;
  const width = typeof rec.width === 'number' ? rec.width : 0;
  const height = typeof rec.height === 'number' ? rec.height : 0;
  if (width <= 0 || height <= 0) return null;
  return { map, imageUrl, width, height };
}

/**
 * The pins that freeze into a map block, in include-list order, each with its
 * placed element: none when the map itself drops (`mapFrameOf`), and a pin
 * only when it is in the world, has a finite x and y, and points at an element
 * in the world. The payload's one reading of "this pin shows": the map's pins
 * and the elements pins send (1.125.13) both come from it.
 */
export function frozenPinTargets(
  block: MapBlock,
  byId: Map<string, Element>,
): Array<{ pinId: string; x: number; y: number; target: Element }> {
  if (!mapFrameOf(block, byId)) return [];
  const out: Array<{ pinId: string; x: number; y: number; target: Element }> = [];
  for (const pinId of block.pinIds) {
    const pin = byId.get(pinId);
    if (!pin) continue;
    const p = pin as Record<string, unknown>;
    // A pin moved to another map no longer belongs to this one: the map
    // editor lists only this map's pins, so it would have no checkbox here.
    if (p.map_id !== block.mapId) continue;
    const x = typeof p.x === 'number' ? p.x : NaN;
    const y = typeof p.y === 'number' ? p.y : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const target = typeof p.element_id === 'string' ? byId.get(p.element_id) : undefined;
    if (!target) continue; // pin without a live element discloses nothing
    out.push({ pinId, x, y, target });
  }
  return out;
}

/**
 * Freeze a map block: image URL + chosen pins normalized to percentages.
 * THE ONE ORIGIN CONVERSION on the publish path: storage is the
 * schema's BOTTOM-left, the payload's `yPct` is a TOP-left CSS percentage by
 * contract (SHARING_CONTRACT.md §5), so `yPct = (height - y) / height`. The
 * renderers (atlas preview, tools/show) apply `yPct` as `top:` and never
 * convert, which is why pages published before the y-flip still draw right. The
 * map's width/height fields hold the image dimensions, auto-detected by atlas
 * when image_url is set. Returns null — block drops from the wire — when the map
 * is missing, has no published image (D3: image_url only, local media never
 * leaves the folder), or has no usable dimensions. Pins drop individually
 * when their pin/element is gone (disclose nothing), unplaced, or moved to
 * another map (`frozenPinTargets`).
 * Exported for the renderer (builder compiles live → same view).
 */
export function freezeMapBlock(
  block: MapBlock,
  byId: Map<string, Element>,
  includedIds: ReadonlySet<string>,
): PayloadMapBlock | null {
  const frame = mapFrameOf(block, byId);
  if (!frame) return null;
  const { map, imageUrl, width, height } = frame;

  const pins: PayloadMapBlock['pins'] = [];
  for (const { x, y, target } of frozenPinTargets(block, byId)) {
    const token: PayloadMapBlock['pins'][number] = {
      xPct: Math.round(Math.min(100, Math.max(0, (x / width) * 100)) * 100) / 100,
      yPct: Math.round(Math.min(100, Math.max(0, ((height - y) / height) * 100)) * 100) / 100,
      name: nameOrUnnamed(target, { start: true }),
      type: target.type,
    };
    if (includedIds.has(target.id)) token.ref = target.id;
    pins.push(token);
  }

  const frozen: PayloadMapBlock = {
    id: block.id,
    kind: 'map',
    title: nameOrUnnamed(map, { start: true }),
    image_url: imageUrl,
    pins,
  };
  if (block.showLabels === false) frozen.showLabels = false;

  // Zone overlays: markers are the only spatial truth (a zone
  // "appears" on a map iff its markers do — DESIGN_ZONES.md §1); geometry
  // normalizes exactly like pins. Shape resolution shares the app's one
  // helper (getZoneShape) so builder, payload, and canvas can never disagree.
  // zoneIds is an include-list (absent = all — legacy/friendly default).
  {
    const includeAll = block.zoneIds === undefined;
    const zoneAllow = new Set(block.zoneIds ?? []);
    const markers: Array<Record<string, unknown>> = [];
    const zoneEls: Element[] = [];
    for (const el of byId.values()) {
      if (el.type === 'marker') markers.push(el as Record<string, unknown>);
      else if (el.type === 'zone') zoneEls.push(el);
    }
    const zones: NonNullable<PayloadMapBlock['zones']> = [];
    for (const zone of zoneEls) {
      if (!includeAll && !zoneAllow.has(zone.id)) continue;
      const points = markers
        .filter(m => m.zone_id === zone.id && m.map_id === block.mapId
          && Number.isFinite(m.x as number) && Number.isFinite(m.y as number))
        .sort((a, b) => ((a.order as number | undefined) ?? 0) - ((b.order as number | undefined) ?? 0))
        .map(m => ({
          xPct: Math.round(Math.min(100, Math.max(0, ((m.x as number) / width) * 100)) * 100) / 100,
          yPct: Math.round(Math.min(100, Math.max(0, ((height - (m.y as number)) / height) * 100)) * 100) / 100,
        }));
      const shape = getZoneShape(zone as Parameters<typeof getZoneShape>[0]);
      if (points.length < (shape === 'line' ? 2 : 3)) continue; // degenerate geometry drops
      const token: NonNullable<PayloadMapBlock['zones']>[number] = {
        name: nameOrUnnamed(zone, { start: true }), shape, points,
      };
      if (includedIds.has(zone.id)) token.ref = zone.id;
      zones.push(token);
    }
    if (zones.length > 0) frozen.zones = zones;
  }
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
    // The knower is not in the world, and the block names no type for it: a missing element. The title is text
    // to every reader (the page's renderer and its copy in the viewer print it escaped; nothing parses it).
    return { id: block.id, kind: 'circle', knowerId: block.knowerId, title: missingLabel('element'), knowerType: 'collective', entries: [] };
  }
  const held = knowledgeHeldBy(knower.id, elements)
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return {
    id: block.id,
    kind: 'circle',
    knowerId: knower.id,
    title: nameOrUnnamed(knower, { start: true }),
    knowerType: knower.type,
    entries: held.map(entry => ({
      title: nameOrUnnamed(entry, { start: true, word: 'entry' }),
      markdown: typeof (entry as Record<string, unknown>).story === 'string'
        ? (entry as Record<string, unknown>).story as string : '',
    })),
  };
}
