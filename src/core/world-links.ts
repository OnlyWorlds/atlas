/**
 * Which values in a world are links: one reading for every surface that counts them.
 *
 * The reader is the SDK's `worldGraph` (the lens profile's graph section): each schema link field typed
 * to its target, and the extension links a profile declares (`x_lens_leads_to`, `x_spine_depends_on`). An
 * id-shaped value in any other key is no link (Atlas's own `atlas_` fields, an import's `x_` reference),
 * and a link to an element of another type than its field's target is no link. Read for the owner with
 * every flag back (room, hidden, proposed, map space, and the reading aids since serial 104's flag), so the
 * caller's elements array alone decides who is in the world.
 *
 * Beside the reader, Atlas's own links, named here and nowhere else (`atlasAdditionsOf`):
 *   - map space as Atlas keeps it: a pin's element (`element_id`, its placement, which the reader never
 *     reads as an edge) and its map, a marker's map and zone, each in either spelling (`map_id` in memory,
 *     `map` as the standard writes it; an empty value reads the other spelling);
 *   - a page's bound elements (`atlas_page_refs`, the mirror of its element cards: "Featured in").
 *
 * Surfaces: the Web (`context-pane-graph.ts`, with its own drawing choices over the reader alone), the
 * element page's references and the preview's Linked from (`element-detail-refs.ts`), Home's loose threads
 * and grid, the writing pane's Cast and Suggested (`context-pane-lists.ts`), the map labels' weight.
 */
import { worldGraph } from '@onlyworlds/sdk';
import type { Element } from './types';
import { diskRenamesFor } from '../store/disk-link-names';

export interface WorldLink { target: string; field: string }

const READER_FLAGS = { rooms: true, hidden: true, proposed: true, mapSpace: true, readingAids: true } as const;

/** Per elements array (the store swaps the array on every write, and never mutates one in place). */
const readerMemo = new WeakMap<readonly Element[], Map<string, WorldLink[]>>();

/**
 * Every element's outgoing links as the reader reads them, in the reader's order (field name, then the
 * target's place in the list): each target and field once, never the element itself.
 */
export function readerEdgesOf(elements: readonly Element[]): Map<string, WorldLink[]> {
  const memo = readerMemo.get(elements);
  if (memo) return memo;
  const handed = elements.filter(isBody).map(withoutStraySpellings);
  const out = new Map<string, WorldLink[]>();
  let graph: ReturnType<typeof worldGraph> | null = null;
  try {
    graph = worldGraph({ elements: handed as unknown as object[] }, { rung: 'owner' }, READER_FLAGS);
  } catch (err) {
    // A world the reader refuses reads as a world without links rather than no surface at all.
    console.warn('[atlas] the graph reader refused this world', err);
  }
  for (const e of graph?.edges ?? []) {
    if (e.source === e.target) continue;
    let list = out.get(e.source);
    if (!list) { list = []; out.set(e.source, list); }
    if (!list.some(l => l.target === e.target && l.field === e.field)) list.push({ target: e.target, field: e.field });
  }
  readerMemo.set(elements, out);
  return out;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** A body at all: the array is the store's, but a foreign or damaged one may hold a null (the 1.118.0 gate's N7). */
function isBody(el: unknown): el is Element { return typeof el === 'object' && el !== null; }

/**
 * A pin or marker without the standard spelling of a link Atlas holds in its own (`map` beside `map_id`,
 * `zone` beside `zone_id`): in memory Atlas's spelling is the link, and a file that carried both keeps the
 * other as a stray (`normalizeDiskLinks`). Handed both, the reader read the stray and the additions the
 * link, so one marker linked two zones (the 1.118.0 gate's N6). Only the stray goes, and only where Atlas's
 * spelling holds a value: an empty one still reads the other, as the additions do.
 */
function withoutStraySpellings(el: Element): Element {
  const renames = diskRenamesFor(el.type);
  if (renames.length === 0) return el;
  const r = el as unknown as Record<string, unknown>;
  const strays = renames.filter(({ schema, disk }) => schema in r && str(r[disk]) !== null);
  if (strays.length === 0) return el;
  const copy = { ...r };
  for (const { schema } of strays) delete copy[schema];
  return copy as unknown as Element;
}

/** A pin's or marker's map, in either spelling. */
export function spatialMapOf(el: Element): string | null {
  const r = el as unknown as Record<string, unknown>;
  return str(r.map_id) ?? str(r.map);
}

/** What a pin places (`element_id`) or a marker draws (`zone_id` or `zone`). */
export function spatialOtherOf(el: Element): string | null {
  const r = el as unknown as Record<string, unknown>;
  if (el.type === 'pin') return str(r.element_id);
  if (el.type === 'marker') return str(r.zone_id) ?? str(r.zone);
  return null;
}

/** Atlas's own links of one element (see the header), each with the field it is kept in. */
export function atlasAdditionsOf(el: Element): WorldLink[] {
  const out: WorldLink[] = [];
  const r = el as unknown as Record<string, unknown>;
  if (el.type === 'pin' || el.type === 'marker') {
    const map = spatialMapOf(el);
    const other = spatialOtherOf(el);
    if (map) out.push({ target: map, field: str(r.map_id) ? 'map_id' : 'map' });
    if (other) out.push({ target: other, field: el.type === 'pin' ? 'element_id' : (str(r.zone_id) ? 'zone_id' : 'zone') });
  }
  if (Array.isArray(r.atlas_page_refs)) {
    for (const id of r.atlas_page_refs) if (typeof id === 'string' && id) out.push({ target: id, field: 'atlas_page_refs' });
  }
  return out.filter(l => l.target !== el.id);
}

/** Every link of one element in a world: the reader's, then Atlas's own. */
export function linksOf(el: Element, elements: readonly Element[]): WorldLink[] {
  const reader = readerEdgesOf(elements).get(el.id) ?? [];
  const extra = atlasAdditionsOf(el).filter(a => !reader.some(l => l.target === a.target && l.field === a.field));
  return [...reader, ...extra];
}

const incomingMemo = new WeakMap<readonly Element[], Map<string, Map<string, string[]>>>();

/** target → source → the fields that link them, the reader's and Atlas's own; per elements array. */
export function incomingOf(elements: readonly Element[]): Map<string, Map<string, string[]>> {
  const memo = incomingMemo.get(elements);
  if (memo) return memo;
  const out = new Map<string, Map<string, string[]>>();
  for (const el of elements) {
    if (!isBody(el)) continue;
    for (const l of linksOf(el, elements)) {
      let bySource = out.get(l.target);
      if (!bySource) { bySource = new Map(); out.set(l.target, bySource); }
      const fields = bySource.get(el.id);
      if (fields) { if (!fields.includes(l.field)) fields.push(l.field); } else bySource.set(el.id, [l.field]);
    }
  }
  incomingMemo.set(elements, out);
  return out;
}

/**
 * Elements linked to nothing in the world, either way (a link out counts as much as a link in; pins and every
 * reference counted): Home's loose squares and the loose threads band's unlinked characters, one rule. One reading
 * of the whole array: a link out is only seen with its target in the world read, so never ask about one element
 * alone (the 1.118.0 gate's M1).
 */
export function looseIds(elements: readonly Element[]): Set<string> {
  const linked = new Set<string>();
  for (const [target, sources] of incomingOf(elements)) {
    if (sources.size === 0) continue;
    linked.add(target);
    for (const source of sources.keys()) linked.add(source);
  }
  return new Set(elements.filter(e => !linked.has(e.id)).map(e => e.id));
}
