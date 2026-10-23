/**
 * Merge planning for Route 2 (Make Online onto an existing api world): decide,
 * per element type, which local elements are the same thing as which server
 * records, before anything is written.
 *
 * Pure. Replaces the one-pass matcher in make-online.ts, which had two bugs:
 * H10, a same-named local listed first could take a server record that
 * another local matches by id (the id-matched local's text was then lost);
 * H11, a whitespace-only name was truthy and matched a blank server name.
 * Here pass 1 (id) runs over every local before pass 2 (name) starts, and an
 * empty normalized name never matches. A name shared by two or more elements
 * on one side is skipped and reported, never guessed (Captain's ruling: a
 * visible duplicate beats a silent overwrite).
 *
 * A map or zone whose name matches is NOT matched when both sides already
 * have children on it (pins or markers on the map, markers on the zone):
 * the kernel would move the local children onto the server's map or zone
 * beside the server's own, so one element ended with two pins on one map,
 * or a zone outline drawn from two interleaved marker sets (S367 gate
 * A4/A5, Captain's ruling 2026-10-04). It stays its own element and is
 * reported in `childClashes`. Children on one side only, or none, still
 * match. Children are read from the same lists, so this stays pure.
 *
 * Output order is deterministic: local-side lists follow the input order of
 * `locals`; server-side lists follow ALL_ELEMENT_TYPES, then each type's
 * array order.
 */
import { ALL_ELEMENT_TYPES } from '../core/types';
import type { Element, ElementType } from '../core/types';
import { isHiddenMark } from '../core/hidden-mark';

export type ServerRec = { id: string; updated_at: string } & Record<string, unknown>;

export interface MergePlan {
  /** Name matches only: local id → server id. Drives the local re-key. */
  pairs: Map<string, string>;
  /** Locals whose id equals a server record of the same type. */
  sameId: Array<{ local: Element; server: ServerRec; type: ElementType }>;
  /** Name matches (the same set as `pairs`), with the server record. */
  renamed: Array<{ local: Element; server: ServerRec; type: ElementType }>;
  /** Locals with no counterpart: upload as their own element. */
  creates: Array<{ local: Element; type: ElementType }>;
  /** Server records with no counterpart: download. */
  downloads: Array<{ server: ServerRec; type: ElementType }>;
  /** Names skipped because two or more on one side share them (per type). */
  ambiguous: Array<{ type: ElementType; name: string }>;
  /** Maps and zones whose name matched but that both sides have children on: not matched (gate A4/A5). */
  childClashes: Array<{ type: ElementType; name: string }>;
  /** A server record whose id is a local element of ANOTHER type: never downloaded (it would overwrite that file). */
  idClashes: Array<{ id: string; localType: ElementType; serverType: ElementType }>;
  /**
   * Hidden locals whose id is an element OnlyWorlds shows (folder spec §4.8, conv. 170): neither sent
   * (the content would go up shown) nor downloaded over (the folder's own copy stays).
   */
  hiddenOnline: Array<{ id: string; type: ElementType; name: string }>;
}

/** The name-match key: NFC, trimmed, lower-cased; inner whitespace untouched. Non-strings give ''. */
export function normalizeMatchName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.normalize('NFC').trim().toLowerCase();
}

/** A link value as a single id, or null. */
function linkId(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * The map and zone ids that carry children on one side: a pin or marker's
 * map, a marker's zone. Both spellings are read (`map_id` in memory, `map`
 * from a record that kept the schema name), so a stray spelling never hides
 * a child.
 */
function parentsWithChildren(records: Iterable<{ type: ElementType; rec: Record<string, unknown> }>): { maps: Set<string>; zones: Set<string> } {
  const maps = new Set<string>();
  const zones = new Set<string>();
  for (const { type, rec } of records) {
    if (type !== 'pin' && type !== 'marker') continue;
    const map = linkId(rec.map_id) ?? linkId(rec.map);
    if (map) maps.add(map);
    if (type === 'marker') {
      const zone = linkId(rec.zone_id) ?? linkId(rec.zone);
      if (zone) zones.add(zone);
    }
  }
  return { maps, zones };
}

export function planMerge(
  locals: readonly Element[],
  serverByType: ReadonlyMap<ElementType, readonly ServerRec[]>,
  opts: { matchByName: boolean },
): MergePlan {
  const plan: MergePlan = {
    pairs: new Map(),
    sameId: [],
    renamed: [],
    creates: [],
    downloads: [],
    ambiguous: [],
    childClashes: [],
    idClashes: [],
    hiddenOnline: [],
  };

  // Server records in their canonical order, with a per-type id index.
  const serverOrder: Array<{ server: ServerRec; type: ElementType }> = [];
  const serverIdIndex = new Map<ElementType, Map<string, ServerRec>>();
  for (const type of ALL_ELEMENT_TYPES) {
    const index = new Map<string, ServerRec>();
    for (const server of serverByType.get(type) ?? []) {
      serverOrder.push({ server, type });
      if (!index.has(server.id)) index.set(server.id, server);
    }
    serverIdIndex.set(type, index);
  }

  // Every local id with the types it lives under (for the id-clash check).
  const localTypesById = new Map<string, ElementType[]>();
  for (const local of locals) {
    const types = localTypesById.get(local.id);
    if (types) types.push(local.type);
    else localTypesById.set(local.id, [local.type]);
  }

  // Pass 1, id: over ALL locals before any name matching (the H10 fix).
  const localMatch = new Map<Element, ServerRec>();
  const matchedServers = new Set<ServerRec>();
  const heldLocals = new Set<Element>();
  for (const local of locals) {
    const server = serverIdIndex.get(local.type)?.get(local.id);
    if (!server || matchedServers.has(server)) continue;
    if (isHiddenMark(local) && !isHiddenMark(server)) {
      plan.hiddenOnline.push({ id: local.id, type: local.type, name: typeof local.name === 'string' ? local.name.trim() : '' });
      heldLocals.add(local);
      matchedServers.add(server);
      continue;
    }
    localMatch.set(local, server);
    matchedServers.add(server);
  }

  // Server records left over: an id held locally under another type is a
  // clash (never downloaded, never a name target); the rest stay eligible.
  const eligible = new Set<ServerRec>();
  for (const { server, type } of serverOrder) {
    if (matchedServers.has(server)) continue;
    const localTypes = localTypesById.get(server.id);
    if (localTypes) {
      const localType = localTypes.find(t => t !== type) ?? localTypes[0];
      plan.idClashes.push({ id: server.id, localType, serverType: type });
      continue;
    }
    eligible.add(server);
  }

  // Pass 2, name: unique key on both sides of one type, or no match at all.
  const namePairs = new Map<Element, ServerRec>();
  if (opts.matchByName) {
    const localsByKey = new Map<string, Element[]>();
    for (const local of locals) {
      // A hidden element is never matched by name: matched, its content would go up onto a shown one (conv. 170).
      if (localMatch.has(local) || heldLocals.has(local) || isHiddenMark(local)) continue;
      const key = normalizeMatchName(local.name);
      if (!key) continue;
      const bucketKey = `${local.type}\u0000${key}`;
      const bucket = localsByKey.get(bucketKey);
      if (bucket) bucket.push(local);
      else localsByKey.set(bucketKey, [local]);
    }
    const serversByKey = new Map<string, ServerRec[]>();
    for (const { server, type } of serverOrder) {
      if (!eligible.has(server)) continue;
      const key = normalizeMatchName(server.name);
      if (!key) continue;
      const bucketKey = `${type}\u0000${key}`;
      const bucket = serversByKey.get(bucketKey);
      if (bucket) bucket.push(server);
      else serversByKey.set(bucketKey, [server]);
    }
    // A map or zone both sides have children on is never a name match. Only
    // each side's OWN children count: a pin matched by id is the same element
    // on both sides, not a second set (S368 gate lens B M1).
    const localParents = parentsWithChildren(
      locals.filter(l => !localMatch.has(l)).map(l => ({ type: l.type, rec: l as unknown as Record<string, unknown> })),
    );
    const serverParents = parentsWithChildren(
      serverOrder.filter(({ server }) => !matchedServers.has(server)).map(({ server, type }) => ({ type, rec: server as Record<string, unknown> })),
    );
    const bothHaveChildren = (type: ElementType, localId: string, serverId: string): boolean => {
      if (type === 'map') return localParents.maps.has(localId) && serverParents.maps.has(serverId);
      if (type === 'zone') return localParents.zones.has(localId) && serverParents.zones.has(serverId);
      return false;
    };
    // Ambiguity (and a child clash) is reported per type in ALL_ELEMENT_TYPES
    // order, then by the first local carrying the name.
    const ambiguousByType = new Map<ElementType, Array<{ type: ElementType; name: string }>>();
    const childClashByType = new Map<ElementType, Array<{ type: ElementType; name: string }>>();
    const report = (into: typeof ambiguousByType, local: Element) => {
      const list = into.get(local.type) ?? [];
      list.push({ type: local.type, name: local.name.trim() });
      into.set(local.type, list);
    };
    // First the maps and zones that clash, so their children can stay out of
    // name matching: a named marker (converter worlds name every one) matched
    // to its server twin would move onto the server id under its LOCAL zone,
    // and policy b would then strip the online outline (gate lens B H1).
    const clashedLocal = new Set<string>();
    const clashedServer = new Set<string>();
    for (const [bucketKey, bucketLocals] of localsByKey) {
      const first = bucketLocals[0];
      if (first.type !== 'map' && first.type !== 'zone') continue;
      const bucketServers = serversByKey.get(bucketKey);
      if (bucketLocals.length !== 1 || bucketServers?.length !== 1) continue;
      if (!bothHaveChildren(first.type, first.id, bucketServers[0].id)) continue;
      clashedLocal.add(first.id);
      clashedServer.add(bucketServers[0].id);
      report(childClashByType, first);
    }
    const onClashed = (type: ElementType, rec: Record<string, unknown>, clashed: Set<string>): boolean => {
      if (type !== 'pin' && type !== 'marker') return false;
      const map = linkId(rec.map_id) ?? linkId(rec.map);
      if (map && clashed.has(map)) return true;
      const zone = type === 'marker' ? linkId(rec.zone_id) ?? linkId(rec.zone) : null;
      return !!zone && clashed.has(zone);
    };
    for (const [bucketKey, allLocals] of localsByKey) {
      const allServers = serversByKey.get(bucketKey);
      if (!allServers) continue;
      if (clashedLocal.has(allLocals[0].id) && allLocals.length === 1) continue; // reported above
      // Children of a clashed map or zone stay with their own side: the
      // locals go up as creates, the server's come down.
      const bucketLocals = allLocals.filter(l => !onClashed(l.type, l as unknown as Record<string, unknown>, clashedLocal));
      const bucketServers = allServers.filter(s => !onClashed(allLocals[0].type, s as Record<string, unknown>, clashedServer));
      if (bucketLocals.length === 0 || bucketServers.length === 0) continue;
      const first = bucketLocals[0];
      if (bucketLocals.length === 1 && bucketServers.length === 1) {
        namePairs.set(first, bucketServers[0]);
        continue;
      }
      report(ambiguousByType, first);
    }
    for (const type of ALL_ELEMENT_TYPES) {
      plan.ambiguous.push(...(ambiguousByType.get(type) ?? []));
      plan.childClashes.push(...(childClashByType.get(type) ?? []));
    }
  }

  // Local-side lists, in input order.
  const pairedServers = new Set<ServerRec>();
  for (const local of locals) {
    if (heldLocals.has(local)) continue;
    const byId = localMatch.get(local);
    if (byId) {
      plan.sameId.push({ local, server: byId, type: local.type });
      continue;
    }
    const byName = namePairs.get(local);
    if (byName) {
      plan.pairs.set(local.id, byName.id);
      plan.renamed.push({ local, server: byName, type: local.type });
      pairedServers.add(byName);
      continue;
    }
    plan.creates.push({ local, type: local.type });
  }

  // Server-side downloads, in canonical order.
  for (const { server, type } of serverOrder) {
    if (eligible.has(server) && !pairedServers.has(server)) plan.downloads.push({ server, type });
  }

  return plan;
}
