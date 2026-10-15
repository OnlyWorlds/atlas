/**
 * rekeyBody: the one reference transform for giving elements new ids (S363).
 *
 * Given an element body and a map old id → new id, return the body with every
 * REFERENCE to an old id replaced, and whether anything changed. Pure,
 * idempotent under the map, copy-on-write (an untouched body comes back as the
 * same object). Used by the re-key kernel (`store/rekey.ts`) for the new
 * elements and for every referrer.
 *
 * What is a reference (the field-path table, re-key gate lens 3):
 *   - any top-level string or string[] member EQUAL to an old id, except in
 *     identity/stamp fields and prose (a bare uuid a writer typed is text);
 *   - an `ow://<type>/<id>` link inside ANY top-level string (story,
 *     description, custom text): the id segment only, every other byte kept;
 *   - the TipTap sidecar `atlas_richtext_json` (object, or the JSON string
 *     older and foreign files carry): `elementChip` and `mention` nodes'
 *     `attrs.id`, and `link` marks whose href is an ow:// link. The serializer
 *     turns all three into `ow://` links, so missing one lets the editor write
 *     the old id back into `story` on the next keystroke, and the relation
 *     derive (#50) then re-links it;
 *   - `atlas_page_blocks`, walked RAW by kind and named field (never through
 *     `parsePageBlocks`, which drops unknown kinds, nor `pageBlocksPatch`,
 *     which recompiles story): card/circle/collection/map ids, `fullPinIds`,
 *     and prose blocks' markdown + richtext. Block ids, chart ids and any
 *     unknown kind are left alone.
 * Never touched: `id`, `type`, `name`, stamps, `image_media_id` (a media id),
 * `atlas_page_pub` (the published page's own id), `atlas_calendar`,
 * `atlas_page_theme`, `atlas_page_intent`, `atlas_aliases`.
 */
import type { Element, ElementType } from '../core/types';
import { SERVER_AUTHOR_FIELDS } from '../core/constants';
import { OW_LINK_HREF_RE, createOwLinkScanner } from '../core/ow-links';
import { knownFieldsFor, numberFieldsFor, relationFieldsFor } from '../editor/field-schema';

export type IdMap = ReadonlyMap<string, string>;

const SKIP = new Set<string>([
  ...SERVER_AUTHOR_FIELDS,
  'id', 'type', 'name', 'created_at', 'local_updated_at', 'server_updated_at', 'updated_at',
  'image_media_id', 'atlas_page_pub', 'atlas_calendar', 'atlas_page_theme', 'atlas_page_intent', 'atlas_aliases',
]);
const SIDECAR = 'atlas_richtext_json';
const BLOCKS = 'atlas_page_blocks';
const CHIP_NODES = new Set(['elementChip', 'mention']);

/** Schema text fields per type: prose, never equality-rewritten. */
const proseCache = new Map<ElementType, Set<string>>();
function proseFieldsFor(type: ElementType): Set<string> {
  let set = proseCache.get(type);
  if (!set) {
    set = new Set(['story', 'description']);
    try {
      const rel = new Set<string>();
      for (const r of relationFieldsFor(type)) { rel.add(r.diskField); rel.add(r.schemaField); }
      const nums = numberFieldsFor(type);
      for (const f of knownFieldsFor(type)) if (!rel.has(f) && !nums.has(f)) set.add(f);
    } catch { /* unknown type: story + description only */ }
    proseCache.set(type, set);
  }
  return set;
}

/** Replace the id segment of every ow:// link whose id is in the map. */
export function rekeyOwLinks(text: string, map: IdMap): string {
  if (!text.includes('ow://')) return text;
  return text.replace(createOwLinkScanner(), (whole, type: string, id: string) => {
    const next = map.get(id);
    return next ? `ow://${type}/${next}` : whole;
  });
}

function rekeyHref(href: unknown, map: IdMap): unknown {
  if (typeof href !== 'string') return href;
  const m = OW_LINK_HREF_RE.exec(href);
  if (!m) return href;
  const next = map.get(m[2]);
  return next ? `ow://${m[1]}/${next}` : href;
}

/** Walk a TipTap JSON node; returns the same node when nothing changed. */
function rekeyDocNode(node: unknown, map: IdMap): unknown {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  const n = node as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  const set = (k: string, v: unknown) => { if (!out) out = { ...n }; out[k] = v; };

  if (typeof n.type === 'string' && CHIP_NODES.has(n.type) && n.attrs && typeof n.attrs === 'object') {
    const attrs = n.attrs as Record<string, unknown>;
    const next = typeof attrs.id === 'string' ? map.get(attrs.id) : undefined;
    if (next) set('attrs', { ...attrs, id: next });
  }
  if (Array.isArray(n.marks)) {
    let changed = false;
    const marks = n.marks.map(mark => {
      if (!mark || typeof mark !== 'object') return mark;
      const mk = mark as Record<string, unknown>;
      if (mk.type !== 'link' || !mk.attrs || typeof mk.attrs !== 'object') return mark;
      const attrs = mk.attrs as Record<string, unknown>;
      const href = rekeyHref(attrs.href, map);
      if (href === attrs.href) return mark;
      changed = true;
      return { ...mk, attrs: { ...attrs, href } };
    });
    if (changed) set('marks', marks);
  }
  if (Array.isArray(n.content)) {
    let changed = false;
    const content = n.content.map(child => {
      const c = rekeyDocNode(child, map);
      if (c !== child) changed = true;
      return c;
    });
    if (changed) set('content', content);
  }
  return out ?? node;
}

/** A sidecar is an object, or a JSON string (older/foreign files); unparseable strings stay untouched. */
export function rekeySidecar(value: unknown, map: IdMap): unknown {
  if (typeof value === 'string') {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { return value; }
    const next = rekeyDocNode(parsed, map);
    return next === parsed ? value : JSON.stringify(next);
  }
  return rekeyDocNode(value, map);
}

function rekeyIdArray(value: unknown, map: IdMap): unknown {
  if (!Array.isArray(value)) return value;
  let changed = false;
  const out = value.map(v => {
    const next = typeof v === 'string' ? map.get(v) : undefined;
    if (next) { changed = true; return next; }
    return v;
  });
  return changed ? out : value;
}

function rekeyIdString(value: unknown, map: IdMap): unknown {
  return typeof value === 'string' ? map.get(value) ?? value : value;
}

/** Raw walk of `atlas_page_blocks`, by kind and named field only. */
function rekeyBlocks(value: unknown, map: IdMap): unknown {
  if (!Array.isArray(value)) return value;
  let changed = false;
  const out = value.map(block => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return block;
    const b = block as Record<string, unknown>;
    const next: Record<string, unknown> = { ...b };
    switch (b.kind) {
      case 'element-card': next.elementId = rekeyIdString(b.elementId, map); break;
      case 'circle': next.knowerId = rekeyIdString(b.knowerId, map); break;
      case 'collection': next.elementIds = rekeyIdArray(b.elementIds, map); break;
      case 'map':
        next.mapId = rekeyIdString(b.mapId, map);
        next.pinIds = rekeyIdArray(b.pinIds, map);
        next.zoneIds = rekeyIdArray(b.zoneIds, map);
        next.fullPinIds = rekeyIdArray(b.fullPinIds, map);
        break;
      case 'prose':
        next.markdown = typeof b.markdown === 'string' ? rekeyOwLinks(b.markdown, map) : b.markdown;
        next.richtextJson = rekeySidecar(b.richtextJson, map);
        break;
      default:
        return block; // headings, charts, and kinds a newer atlas wrote
    }
    const touched = Object.keys(next).some(k => next[k] !== b[k]);
    if (!touched) return block;
    // Keep absent keys absent (a map block without zoneIds means "all zones").
    for (const k of Object.keys(next)) if (!(k in b)) delete next[k];
    changed = true;
    return next;
  });
  return changed ? out : value;
}

export function rekeyBody(body: Element, map: IdMap): { body: Element; changed: boolean } {
  if (map.size === 0) return { body, changed: false };
  const prose = proseFieldsFor(body.type);
  let out: Record<string, unknown> | null = null;
  const src = body as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(src)) {
    if (SKIP.has(key)) continue;
    let next: unknown = value;
    if (key === SIDECAR) next = rekeySidecar(value, map);
    else if (key === BLOCKS) next = rekeyBlocks(value, map);
    else if (typeof value === 'string') {
      next = !prose.has(key) && map.has(value) ? map.get(value)! : rekeyOwLinks(value, map);
    } else if (Array.isArray(value)) next = rekeyIdArray(value, map);
    if (next !== value) {
      if (!out) out = { ...src };
      out[key] = next;
    }
  }
  return out ? { body: out as unknown as Element, changed: true } : { body, changed: false };
}
