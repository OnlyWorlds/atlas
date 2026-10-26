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
 *      a full origin stops it at once, gate F4)
 *   4  the portable copy (`collectWorldFiles`: no link, no sync files), zipped
 *   5  the scratch goes with the call (memory, never written to disk)
 *
 * The copy keeps the world's id, as a world file downloaded from a linked
 * Moppetopia would (folder format §4.1). So the caller asks `isHere` once the
 * id is known, and a copy already here opens without a second download (gate
 * F1-F3). Its elements keep their ids too; a copy taken online later meets
 * the foreign-id step every world file meets. Demo keys are read scope on the
 * server, so this path cannot write there.
 */
import { PlainError } from '../core/plain-error';
import { opfsRoot } from '../core/browser-worlds';
import { memoryDirectory } from '../store/memory-dir';
import { initialDownloadAll, type InitialDownloadProgress, type DownloadStop } from '../sync/initial-download';
import { pickSyncedMeta, isMetaEmpty } from '../sync/world-meta-sync';
import { keyCheckError } from './key-check-errors';
import type { OwApiClient, WorldMetaWire } from '../sync/sync-engine';
import type { WorldMeta } from '../core/types';
import { serverOrigin } from '../sync/export-provenance';
import { atlasProducer } from '../core/provenance';

/** Moppetopia's public demo key (read scope, no PIN). */
export const DEMO_WORLD_KEY = '0000000001';
export const DEMO_WORLD_NAME = 'Moppetopia';
/**
 * Moppetopia's world id on onlyworlds.com (measured 2026-10-09), so a copy
 * already here opens with no connection. Should the demo world ever be
 * remade under a new id, the id the server answers is checked as well.
 */
export const DEMO_WORLD_ID = '0695db52-5433-7332-8000-db7fe10da375';

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
type DemoClient = OwApiClient & { getWorldMeta(): Promise<WorldMetaWire> };

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
  let meta: WorldMetaWire;
  try {
    meta = await client.getWorldMeta();
  } catch (err) {
    throw keyCheckError(err, { readOnly: true });
  }
  if (!meta?.id) throw new PlainError(`OnlyWorlds did not send ${DEMO_WORLD_NAME} as expected. Try again later.`);
  if (opts.isHere?.(meta.id)) return { kind: 'here', worldId: meta.id };
  const name = meta.name?.trim() || DEMO_WORLD_NAME;

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
    try {
      const own: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(pickSyncedMeta(meta as unknown as Record<string, unknown>))) {
        if (!isMetaEmpty(field, value)) own[field] = value;
      }
      // Where the copy came from (folder spec §4.2); a demo key's slice is none of the four, so no exported_as.
      const source = { server: serverOrigin(), world: String(meta.id), at: new Date().toISOString() };
      await store.writeWorldMeta({ id: meta.id, name, ...own, source, producer: atlasProducer('server') } as Partial<WorldMeta>);
      const result = await initialDownloadAll(store, client, opts.onProgress, opts.shouldStop, { stopOnQuota: true });
      failed = result.failures.length;
      stopped = !!result.stoppedEarly;
    } finally {
      await store.close().catch(() => {});
    }
    if (failed > 0 || stopped) {
      throw new PlainError(`${name} did not download whole, so Atlas did not open it. Try again.`);
    }
    const ws = await import('../store/world-file');
    const collected = await ws.collectWorldFiles(dir);
    const bytes = ws.zipWorld(collected, ws.worldFileName(name, meta.id).dir);
    return { kind: 'file', bytes, worldId: meta.id, name };
  }
}
