/**
 * Try the demo world (#113): Moppetopia, brought down by its public demo
 * key as a world of the user's own: unlinked, editable, never syncing back.
 *
 * It is a world file made in memory and opened through the world-file door
 * (`setup/world-file-open.ts`), so every rule of that door holds here too:
 * the reader's checks, the make protocol, the where-question, the restore of
 * a copy the browser cleared. Nothing new decides identity.
 *
 *   1  one build at a time across tabs (a Web Lock); the scratch is a folder
 *      in memory (`store/memory-dir.ts`, 1.25.1, #126), so nothing outlives
 *      the try; the OPFS `atlas-scratch/` an interrupted try of an older
 *      version left is swept
 *   2  world.json: the world's id and name, and its own fields (the calendar,
 *      the description) as the server holds them; no `api` block, no key
 *   3  every element, through the link door's download (`initialDownloadAll`;
 *      a full origin stops it at once)
 *   4  the portable copy (`collectWorldFiles`: no link, no sync files), zipped
 *   5  the scratch goes with the call (memory, never written to disk)
 *
 * The copy keeps the world's id, as a world file downloaded from a linked
 * Moppetopia would (folder format §4.1). So the caller asks `isHere` once the
 * id is known, and a copy already here opens without a second download).
 * Its elements keep their ids too; a copy taken online later meets
 * the foreign-id step every world file meets. Demo keys are read scope on the
 * server, so this path cannot write there.
 *
 * The same builder (`buildWorldFile`) makes a public world's file for the
 * open door's view-only copy (`setup/public-door.ts`): its own world id, the
 * keyless reader, the public slice's mark, and keel's counts as the measure
 * of whole. That file opens as a copy (conv. 177), never under the world's id.
 */
import { PlainError } from '../core/plain-error';
import { opfsRoot } from '../core/browser-worlds';
import { memoryDirectory } from '../store/memory-dir';
import { initialDownloadAll, type InitialDownloadProgress, type DownloadStop } from '../sync/initial-download';
import { pickSyncedMeta, isMetaEmpty } from '../sync/world-meta-sync';
import { keyCheckError } from './key-check-errors';
import type { OwApiClient, WorldMetaWire } from '../sync/sync-engine';
import type { ElementType, WorldMeta } from '../core/types';
import { ALL_ELEMENT_TYPES } from '../core/types';
import { DEMO_WORLD_ID } from '../core/moppetopia';
import { serverOrigin } from '../sync/export-provenance';
import { atlasProducer } from '../core/provenance';

/** Moppetopia's public demo key (read scope, no PIN). */
export const DEMO_WORLD_KEY = '0000000001';
export const DEMO_WORLD_NAME = 'Moppetopia';
/** Moppetopia's world id lives in core, where the guide's notes read it too. */
export { DEMO_WORLD_ID } from '../core/moppetopia';

/**
 * A demo read that has not answered in this long is given up: on a
 * stalled connection the try otherwise waited forever with nothing on screen
 * (Boss 2026-10-14, the harness `Notes/ui-snapshots/2026-10-14-s405/demo-drop.mjs`).
 * Moppetopia's biggest page comes down in about a second.
 */
export const DEMO_READ_TIMEOUT_MS = 30_000;

const SCRATCH = 'atlas-scratch';
const LOCK = 'atlas-demo-copy';

/** The client this needs: the element reads, plus the world's own fields. */
export type DemoClient = OwApiClient & { getWorldMeta(): Promise<WorldMetaWire> };

export type DemoWorldFile =
  | { kind: 'file'; bytes: Uint8Array; worldId: string; name: string }
  /** `isHere` said yes once the server named the world: nothing was downloaded. */
  | { kind: 'here'; worldId: string };

export interface DemoCopyOpts {
  /** Test seam: the client (production builds the v2 adapter on the demo key). */
  client?: DemoClient;
  /** Asked with the world's id before any element comes down. */
  isHere?: (worldId: string) => boolean;
  onProgress?: (p: InitialDownloadProgress) => void;
  shouldStop?: () => DownloadStop;
}

type Locks = { request<T>(name: string, cb: () => Promise<T>): Promise<T> };

/** The demo world as a world file's bytes. Throws a `PlainError` when it did not come down whole. */
export async function buildDemoWorldFile(opts: DemoCopyOpts = {}): Promise<DemoWorldFile> {
  const locks = (typeof navigator !== 'undefined' ? (navigator as { locks?: Locks }).locks : undefined);
  return locks ? locks.request(LOCK, () => build(opts)) : build(opts);
}

async function build(opts: DemoCopyOpts): Promise<DemoWorldFile> {
  const client = opts.client ?? (await import('../sync/make-online')).buildV2Adapter(DEMO_WORLD_KEY, '', undefined, { readTimeoutMs: DEMO_READ_TIMEOUT_MS });
  return buildWorldFile({
    worldId: DEMO_WORLD_ID,
    client,
    fallbackName: DEMO_WORLD_NAME,
    read: async () => {
      try {
        return { meta: await client.getWorldMeta(), counts: null };
      } catch (err) {
        throw keyCheckError(err, { readOnly: true });
      }
    },
    // The demo key names its world: the copy is whatever world it answers with.
    anyId: true,
    isHere: opts.isHere,
    onProgress: opts.onProgress,
    shouldStop: opts.shouldStop,
  });
}

/** keel's count of what a reader may read: `{total, types: {type: n}}` (GET /world's `counts`). */
export interface ReadCounts { total: number; types: Record<string, number> }

/** A world file made from a server read: the demo's (#113), and a public world's view-only copy. */
export interface WorldFileSource {
  /** The world asked for. Its answer must name it, unless `anyId`. */
  worldId: string;
  client: DemoClient;
  /** The name when the server sends none. */
  fallbackName: string;
  /** The world read: its fields, and the counts the copy must match (null: none to match). */
  read: () => Promise<{ meta: WorldMetaWire; counts: ReadCounts | null }>;
  /** The demo's: the copy is whatever world the key answers with. */
  anyId?: boolean;
  /** The slice this read is (folder spec §4.2): `{kind: "public", ...}` for the public reader. */
  exportedAs?: Record<string, unknown>;
  /** Whole means keel's counts match, type by type; with no counts sent, nothing opens. */
  requireCounts?: boolean;
  /** Type lists at once (the public reader's is 1; every other door keeps the walker's 6). */
  listConcurrency?: number;
  isHere?: (worldId: string) => boolean;
  onProgress?: (p: InitialDownloadProgress) => void;
  shouldStop?: () => DownloadStop;
}

/** The words for a world that did not come down whole. */
export function notWholeLine(name: string): string {
  return `"${name}" did not download completely, so Atlas did not open it. Try again.`;
}

/** Did the walk bring down exactly what keel counts? Every type, and the total. */
export function matchesCounts(listed: Partial<Record<ElementType, number>>, counts: ReadCounts): boolean {
  let sum = 0;
  for (const type of ALL_ELEMENT_TYPES) {
    const got = listed[type] ?? 0;
    if (got !== (counts.types[type] ?? 0)) return false;
    sum += got;
  }
  // A count for a type the copy cannot hold is a shortfall too.
  for (const [type, n] of Object.entries(counts.types)) {
    if (n > 0 && !(ALL_ELEMENT_TYPES as readonly string[]).includes(type)) return false;
  }
  return sum === counts.total;
}

/**
 * A world as a world file's bytes, made in memory: world.json (the world's
 * id and name, its own fields as the server holds them, where it came from),
 * every element through the link door's download, the portable copy zipped.
 * Throws a `PlainError` when it did not come down whole; nothing is written
 * outside memory.
 */
export async function buildWorldFile(src: WorldFileSource): Promise<DemoWorldFile> {
  const { client } = src;
  const { meta, counts } = await src.read();
  if (!meta?.id || (!src.anyId && meta.id !== src.worldId)) throw new PlainError(`OnlyWorlds did not send ${src.fallbackName} as expected. Try again later.`);
  if (src.isHere?.(meta.id)) return { kind: 'here', worldId: meta.id };
  const name = meta.name?.trim() || src.fallbackName;
  if (src.requireCounts && !counts) throw new PlainError(notWholeLine(name));

  // Up to 1.25 the scratch lived in OPFS: inside the lock nothing else
  // builds, so a scratch folder still there was left by a try that never
  // reached its own cleanup (a reload, a closed tab). Swept once, never made.
  await (await opfsRoot()).removeEntry(SCRATCH, { recursive: true }).catch(() => {});
  // The scratch is in memory since 1.25.1 (#126): the same store writes the
  // same files, and Firefox no longer pays an OPFS write for each of them.
  const dir = memoryDirectory('demo-scratch');
  {
    const { FsFolderStore } = await import('../store/folder-store-fs');
    const store = new FsFolderStore();
    await store.open(dir);
    let failed = 0;
    let stopped = false;
    let whole = true;
    try {
      const own: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(pickSyncedMeta(meta as unknown as Record<string, unknown>))) {
        if (!isMetaEmpty(field, value)) own[field] = value;
      }
      // Where the copy came from (folder spec §4.2), at the read's time; the
      // demo key's slice is none of the four, so the demo writes no exported_as.
      const source = { server: serverOrigin(), world: String(meta.id), at: new Date().toISOString() };
      await store.writeWorldMeta({ id: meta.id, name, ...own, source, ...(src.exportedAs ? { exported_as: src.exportedAs } : {}), producer: atlasProducer('server') } as Partial<WorldMeta>);
      const result = await initialDownloadAll(store, client, src.onProgress, src.shouldStop, {
        stopOnQuota: true,
        ...(src.listConcurrency ? { listConcurrency: src.listConcurrency } : {}),
      });
      failed = result.failures.length;
      stopped = !!result.stoppedEarly;
      // Whole by keel's own count of what this reader may read (a short page the cursor accepted).
      if (src.requireCounts && counts) whole = matchesCounts(result.listed, counts);
    } finally {
      await store.close().catch(() => {});
    }
    if (failed > 0 || stopped || !whole) {
      throw new PlainError(notWholeLine(name));
    }
    const ws = await import('../store/world-file');
    const collected = await ws.collectWorldFiles(dir);
    const bytes = ws.zipWorld(collected, ws.worldFileName(name, meta.id).dir);
    return { kind: 'file', bytes, worldId: meta.id, name };
  }
}
