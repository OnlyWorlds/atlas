/**
 * Import reconcile core — pure. No FolderStore, no network.
 *
 * Turns a parsed payload + the target world's existing elements into an
 * ImportPlan (creates / updates / skips + a report). The applier (B2) walks the
 * plan and writes to the folder; FK ordering / id-swap is the SyncEngine's push
 * concern, NOT import's — the local folder has no FK constraints (convention #81).
 *
 * Identity strategy, decided per element (convention #82):
 *   - keep-ids: a relation value that is a valid uuid passes through (after the
 *     incoming-id remap below). A full ow.com world export is uniformly keep-ids.
 *   - resolve-names: a relation value that is a non-uuid string is a NAME,
 *     resolved against the lookup via FIELD_SCHEMA[type][field].target (#84).
 *
 * Matching (convention #83): by uuid id first (only when names agree — a bare
 * uuid collision between unrelated elements must NOT clobber), then normalized
 * name+type. Matched elements skip (default) or overwrite per options.
 *
 * Incoming-id remap: when an incoming record's uuid is discarded (it matched an
 * existing element by name, or collided with an unrelated existing id and got a
 * fresh one), uuid references to that discarded id from OTHER records are
 * rewritten to the final id — otherwise they'd dangle silently. Relation fields
 * go through resolveRelations; ow:// prose, sidecar and page blocks through
 * remapProse (the re-key kernel's rekeyBody).
 */

import { relationFieldsFor } from '../editor/field-schema';
import { rekeyBody } from '../store/rekey-body';
import { ALL_ELEMENT_TYPES, type Element, type ElementType, type WorldMeta } from '../core/types';
import { isUuid, keyNT, normName, normalizeRecord } from './normalize';
import { metaList } from '../core/meta-list';
import type { ImportPlan, ImportReport, ParseResult, RawRecord, ReconcileOptions } from './types';

const ALL_ELEMENT_TYPES_SET = new Set<string>(ALL_ELEMENT_TYPES);

interface Incoming {
  type: ElementType;
  record: RawRecord; // normalized; relations still under bare (schema) name
  name: string;
  finalId: string;
  action: 'insert' | 'update' | 'skip';
  targetId: string; // existing id if matched, else finalId
}

export function reconcile(
  parsed: ParseResult,
  existing: Element[] = [],
  opts: ReconcileOptions = {},
): ImportPlan {
  const matchByName = opts.matchByName ?? true;
  const onConflict = opts.onConflict ?? 'skip';
  const mergeMultiLinks = opts.mergeMultiLinks ?? false;
  const genId = opts.genId ?? (() => crypto.randomUUID());

  const report: ImportReport = {
    created: 0,
    updated: 0,
    skipped: 0,
    invalidRecords: 0,
    unknownFieldsDropped: 0,
    droppedLinks: [],
    ambiguousNames: [],
  };

  const plan: ImportPlan = { creates: [], updates: [], skips: [], report };
  if (!parsed.ok) return plan;

  // --- existing lookups ---
  const existingById = new Map<string, Element>();
  const existingByNameType = new Map<string, Element>();
  for (const e of existing) {
    existingById.set(e.id, e);
    if (e.name) existingByNameType.set(keyNT(e.type, e.name), e);
  }

  // --- pass 1: normalize + decide action + assign final ids + build id remap ---
  const incoming: Incoming[] = [];
  const incomingIdRemap = new Map<string, string>(); // discarded incoming uuid → finalId
  const assignedIds = new Set<string>(); // final ids already claimed this batch (in-batch dup guard)
  for (const [type, records] of parsed.byType) {
    const claimed = new Set<string>(); // existing ids claimed by a name match this type
    for (const raw of records) {
      const name = typeof raw.name === 'string' ? raw.name : '';
      // Pins and markers are unnamed by design (atlas creates them with an
      // empty name) — dropping them here broke export→import round-trips
      // for every unnamed spatial artifact (found via the sample
      // world). Everything else still requires a name.
      const nameOptional = type === 'pin' || type === 'marker';
      if (!name.trim() && !nameOptional) {
        report.invalidRecords++;
        continue;
      }
      const { record, droppedUnknown } = normalizeRecord(raw, type, { keepUnknown: parsed.envelope === true });
      report.unknownFieldsDropped += droppedUnknown;

      const rawId = typeof record.id === 'string' && isUuid(record.id) ? record.id : undefined;

      let matched: Element | undefined;
      if (rawId && existingById.has(rawId)) {
        // Id match — but only when names agree (or a side is unnamed). A bare
        // uuid collision between unrelated elements must not clobber (#83 guard).
        const ex = existingById.get(rawId)!;
        if (!ex.name || normName(ex.name) === normName(name)) matched = ex;
        // Within the world's own export an id IS the element, renamed or not.
        else if (opts.sameWorld && ex.type === type) matched = ex;
      }
      if (!matched && matchByName && name.trim()) {
        // Empty names never name-match (two unnamed pins are not "the same").
        const cand = existingByNameType.get(keyNT(type, name));
        if (cand && !claimed.has(cand.id)) matched = cand;
      }

      let action: Incoming['action'];
      let finalId: string;
      let targetId: string;
      if (matched) {
        claimed.add(matched.id);
        finalId = matched.id;
        targetId = matched.id;
        action = onConflict === 'overwrite' ? 'update' : 'skip';
      } else {
        // Insert. Keep the incoming uuid unless it collides with a DIFFERENT
        // existing element OR another incoming record already claimed it this
        // batch — then mint a fresh one. Without the in-batch guard, two records
        // sharing a raw id would both resolve to it and the second would silently
        // overwrite the first on apply.
        finalId = rawId && !existingById.has(rawId) && !assignedIds.has(rawId) ? rawId : genId();
        targetId = finalId;
        action = 'insert';
      }
      assignedIds.add(finalId);
      if (rawId && rawId !== finalId) incomingIdRemap.set(rawId, finalId);
      incoming.push({ type, record, name, finalId, action, targetId });
    }
  }

  // --- name → id resolution lookup (import overrides existing; flag dup names) ---
  const idByNameType = new Map<string, string>();
  for (const e of existing) if (e.name) idByNameType.set(keyNT(e.type, e.name), e.id);
  const seenImportKeys = new Set<string>();
  const flaggedDup = new Set<string>();
  for (const inc of incoming) {
    const k = keyNT(inc.type, inc.name);
    if (seenImportKeys.has(k) && !flaggedDup.has(k)) {
      flaggedDup.add(k);
      report.ambiguousNames.push({ type: inc.type, name: inc.name });
    }
    seenImportKeys.add(k);
    idByNameType.set(k, inc.finalId); // last-wins for resolution
  }

  // --- type-by-final-id (for deriving pin element_type) ---
  const typeById = new Map<string, ElementType>();
  for (const e of existing) typeById.set(e.id, e.type);
  for (const inc of incoming) typeById.set(inc.finalId, inc.type);

  // --- pass 2: resolve relations + bucket ---
  for (const inc of incoming) {
    if (inc.action === 'skip') {
      plan.skips.push({ type: inc.type, id: inc.targetId, name: inc.name });
      report.skipped++;
      continue;
    }

    const resolved = remapProse(
      inc.type,
      resolveRelations(inc, idByNameType, incomingIdRemap, typeById, report),
      incomingIdRemap,
    );

    if (inc.action === 'insert') {
      plan.creates.push({ type: inc.type, data: { ...resolved, id: inc.finalId } });
      report.created++;
    } else {
      const patch: RawRecord = { ...resolved };
      delete patch.id;
      const finalPatch = mergeMultiLinks
        ? unionMultiLinks(patch, existingById.get(inc.targetId), inc.type)
        : patch;
      plan.updates.push({ type: inc.type, id: inc.targetId, patch: finalPatch });
      report.updated++;
    }
  }

  // --- world metadata (full-world only) ---
  if (parsed.format === 'full-world' && parsed.world) {
    plan.worldMeta = mapWorldBlock(parsed.world);
  }
  if (parsed.envelope === true) plan.envelope = true;

  return plan;
}

function remap(m: Map<string, string>, id: string): string {
  return m.get(id) ?? id;
}

/** Resolve relation values to ids; rename spatial relations to disk shape; dedup multi-links. */
function resolveRelations(
  inc: Incoming,
  idByNameType: Map<string, string>,
  incomingIdRemap: Map<string, string>,
  typeById: Map<string, ElementType>,
  report: ImportReport,
): RawRecord {
  const out: RawRecord = { ...inc.record };
  for (const rel of relationFieldsFor(inc.type)) {
    const src = rel.schemaField;
    if (!(src in out)) continue;
    const v = out[src];
    const target = rel.target ?? polymorphicTarget(inc.record);

    if (rel.kind === 'single') {
      let resolved: string | undefined;
      if (typeof v === 'string' && v.trim()) {
        if (isUuid(v)) {
          resolved = remap(incomingIdRemap, v.trim());
        } else {
          const id = target ? idByNameType.get(keyNT(target, v)) : undefined;
          if (id) resolved = id;
          else report.droppedLinks.push({ type: inc.type, element: inc.name, field: rel.diskField, value: v });
        }
      }
      if (rel.diskField !== src) delete out[src];
      if (resolved !== undefined) out[rel.diskField] = resolved;
      else delete out[rel.diskField];
    } else {
      const arr = Array.isArray(v) ? v : [];
      const seen = new Set<string>();
      const resolvedArr: string[] = [];
      for (const item of arr) {
        if (typeof item !== 'string' || !item.trim()) continue;
        let id: string | undefined;
        if (isUuid(item)) {
          id = remap(incomingIdRemap, item.trim());
        } else {
          id = target ? idByNameType.get(keyNT(target, item)) : undefined;
          if (!id) {
            report.droppedLinks.push({ type: inc.type, element: inc.name, field: rel.diskField, value: item });
            continue;
          }
        }
        if (id && !seen.has(id)) {
          seen.add(id);
          resolvedArr.push(id);
        }
      }
      if (rel.diskField !== src) delete out[src];
      out[rel.diskField] = resolvedArr;
    }
  }

  // Pin: derive element_type from the referenced element. ow.com exports it as a
  // numeric ContentType pk (e.g. "7"), useless to atlas; drop it when we can't
  // derive so the map-tab self-heal owns it.
  if (inc.type === 'pin') {
    const eid = typeof out.element_id === 'string' ? out.element_id : undefined;
    const t = eid ? typeById.get(eid) : undefined;
    if (t) out.element_type = t;
    else delete out.element_type;
  }

  return out;
}

/**
 * Apply the incoming-id remap to everything EXCEPT relation fields (already
 * resolved above; a second pass could chain X to Y to W): ow:// links in
 * prose, the TipTap sidecar, page blocks. The re-key kernel's transform, so
 * import and re-key agree on what a reference is.
 */
function remapProse(type: ElementType, resolved: RawRecord, map: Map<string, string>): RawRecord {
  if (map.size === 0) return resolved;
  const rel = new Set<string>();
  for (const r of relationFieldsFor(type)) { rel.add(r.schemaField); rel.add(r.diskField); }
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(resolved)) if (!rel.has(k)) body[k] = v;
  body.type = type;
  const { body: next, changed } = rekeyBody(body as unknown as Element, map);
  if (!changed) return resolved;
  const out: RawRecord = { ...resolved };
  const nextRec = next as unknown as Record<string, unknown>;
  for (const k of Object.keys(body)) if (k !== 'type') out[k] = nextRec[k];
  return out;
}

/** Polymorphic pin.element_id target: the element_type field, iff it's a real type name. */
function polymorphicTarget(record: RawRecord): ElementType | null {
  const et = record.element_type;
  if (typeof et === 'string' && ALL_ELEMENT_TYPES_SET.has(et.toLowerCase())) {
    return et.toLowerCase() as ElementType;
  }
  return null;
}

/** Union multi-link arrays with the existing element's current values (overwrite + mergeMultiLinks). */
function unionMultiLinks(
  patch: RawRecord,
  existingEl: Element | undefined,
  type: ElementType,
): RawRecord {
  if (!existingEl) return patch;
  const out = { ...patch };
  for (const rel of relationFieldsFor(type)) {
    if (rel.kind !== 'multi') continue;
    const incoming = out[rel.diskField];
    if (!Array.isArray(incoming)) continue;
    const current = Array.isArray(existingEl[rel.diskField]) ? (existingEl[rel.diskField] as string[]) : [];
    out[rel.diskField] = Array.from(new Set([...current, ...(incoming as string[])]));
  }
  return out;
}

/** Map a full-world `World` block to WorldMeta. Drops api_key + world id (convention #85). */
function mapWorldBlock(world: RawRecord): Partial<WorldMeta> {
  const out: Partial<WorldMeta> = {};
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
  const num = (v: unknown): number | undefined => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
    return undefined;
  };

  const name = str(world.name);
  if (name && name.trim()) out.name = name.trim(); // empty name → let caller default it
  const description = str(world.description);
  if (description) out.description = description;
  const version = str(world.version);
  if (version) out.version = version;
  const image_url = str(world.image_url);
  if (image_url) out.image_url = image_url;
  const tfn = strArr(world.time_format_names);
  if (tfn) out.time_format_names = tfn;
  // Equivalents keep whole numbers as the standard types them (keel ca181a3).
  const tfe = Array.isArray(world.time_format_equivalents) ? metaList(world.time_format_equivalents) : undefined;
  if (tfe) out.time_format_equivalents = tfe;
  const tbu = str(world.time_basic_unit);
  if (tbu) out.time_basic_unit = tbu;
  // The now under either spelling (folder-format v0.3.5): the standard's
  // `time_current` first, then keel's wire name, which the site's download
  // carries since its world block became the World whole (dist.50).
  const tc = num(world.time_current) ?? num(world.time_range_current);
  if (tc !== undefined) out.time_current = tc;
  const trmin = num(world.time_range_min);
  if (trmin !== undefined) out.time_range_min = trmin;
  const trmax = num(world.time_range_max);
  if (trmax !== undefined) out.time_range_max = trmax;
  for (const f of ['length_unit', 'mass_unit', 'distance_unit'] as const) {
    const unit = str(world[f])?.trim();
    if (unit) out[f] = unit;
  }
  // Where the copy came from and which slice it is (folder spec §4.2): keel's
  // one-file export is this envelope, so a Character's view imported as a new
  // world stays one and is never offered to go online as the whole.
  // Kept only as objects; their parts are read defensively later.
  const lines = out as Record<string, unknown>;
  if (world.source && typeof world.source === 'object' && !Array.isArray(world.source)) lines.source = world.source;
  if (world.exported_as && typeof world.exported_as === 'object' && !Array.isArray(world.exported_as)) lines.exported_as = world.exported_as;
  // And who made it (v0.3.14): verbatim, so a new world from keel's export
  // says keel made it, never Atlas.
  if (world.producer && typeof world.producer === 'object' && !Array.isArray(world.producer)) lines.producer = world.producer;
  // And where the world first came from, as the server served it
  // (v0.3.16): kept, nulls and all, never derived.
  if (world.origin && typeof world.origin === 'object' && !Array.isArray(world.origin)) lines.origin = world.origin;
  // A profile's keys on the World (`x_names`, a world's own words for the
  // types; names.md): verbatim, as §4.1 keeps every key a writer did not
  // change, so a work world opened from its file still says Employee.
  for (const [key, value] of Object.entries(world)) {
    if (key.startsWith('x_') && value !== undefined) lines[key] = value;
  }
  // api_key + id intentionally dropped — never auto-arm sync (convention #85);
  // atlas generates its own WorldMeta.id.
  return out;
}

export { normName };
