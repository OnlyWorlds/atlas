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
 * Output order is deterministic: local-side lists follow the input order of
 * `locals`; server-side lists follow ALL_ELEMENT_TYPES, then each type's
 * array order.
 */
import { ALL_ELEMENT_TYPES } from '../core/types';
import type { Element, ElementType } from '../core/types';

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
  /** A server record whose id is a local element of ANOTHER type: never downloaded (it would overwrite that file). */
  idClashes: Array<{ id: string; localType: ElementType; serverType: ElementType }>;
}

/** The name-match key: NFC, trimmed, lower-cased; inner whitespace untouched. Non-strings give ''. */
export function normalizeMatchName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.normalize('NFC').trim().toLowerCase();
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
    idClashes: [],
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
  for (const local of locals) {
    const server = serverIdIndex.get(local.type)?.get(local.id);
    if (!server || matchedServers.has(server)) continue;
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
      if (localMatch.has(local)) continue;
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
    // Ambiguity is reported per type in ALL_ELEMENT_TYPES order, then by the
    // first local carrying the name.
    const ambiguousByType = new Map<ElementType, Array<{ type: ElementType; name: string }>>();
    for (const [bucketKey, bucketLocals] of localsByKey) {
      const bucketServers = serversByKey.get(bucketKey);
      if (!bucketServers) continue;
      const first = bucketLocals[0];
      if (bucketLocals.length === 1 && bucketServers.length === 1) {
        namePairs.set(first, bucketServers[0]);
        continue;
      }
      const list = ambiguousByType.get(first.type) ?? [];
      list.push({ type: first.type, name: first.name.trim() });
      ambiguousByType.set(first.type, list);
    }
    for (const type of ALL_ELEMENT_TYPES) {
      plan.ambiguous.push(...(ambiguousByType.get(type) ?? []));
    }
  }

  // Local-side lists, in input order.
  const pairedServers = new Set<ServerRec>();
  for (const local of locals) {
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
