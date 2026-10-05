/**
 * The browser home (`browser-worlds/`): naming, the make protocol, and the
 * boot reconciliation (1.17 bout 1, conv. 129; contract §1.2, §2.2, §3.2).
 *
 * NAMES are `<slug>-<id8>-<nonce4>`, a fresh nonce at every creation, so no
 * directory is ever made under an earlier one's name: OPFS handles are
 * path-based, and a parked store still holding the old name would write into
 * the new world (S370 gate B6).
 *
 * A MAKE (create, import, link, open a world file, the tour) holds the Web
 * Lock `atlas-world:<dir>` from before its first write to after its registry
 * save, and keeps `.atlas/making` in the directory until just before that
 * save. So a make in progress in any tab is visible (the lock is held), and
 * a crashed one is recognisable (the marker with a free lock) and removed,
 * never adopted (gate A6, B1).
 *
 * The RECONCILIATION runs once per boot, first in the activation chain. It
 * re-adopts worlds the registry lost, removes crashed makes and orphaned tour
 * scaffolds, marks entries whose directory is gone, and deletes nothing else.
 * It decides on facts read inside each directory's lock against the registry
 * as STORED (another tab's make commits before it releases that lock), and it
 * returns DELTAS that the caller applies to the registry as it is when the
 * pass ends: a save built from the snapshot it started with would revert,
 * field by field, whatever any tab saved meanwhile (S376 gate B1). Every make
 * in this tab waits for it (`openBrowserMake`, contract §3.2).
 */

import type { WorldRegistryEntry, WorldsRegistry } from './types';
import { BROWSER_HOME, browserHome, isBrowserWorld, isGoneError, markWorldCleared, removeBrowserWorldDir, unmarkWorldCleared } from './browser-worlds';
import { slugify } from '../store/fs-utils';
import { adoptStoredRegistry, createApiLinkedWorld, createLocalWorld, findWorldByOwIdentity, saveRegistry, storedRegistry, updateWorldEntry } from '../registry/registry';
import { getState, patchSlice } from './state';
import { isTourFlagActive } from '../tour/tour-flag';

export const MAKING_MARKER = 'making';

/** `<slug>-<id8>-<nonce4>`: never the name of an earlier directory. */
export function mintBrowserDirName(name: string, worldId: string): string {
  const slug = slugify(name) || 'world';
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(2)), b => b.toString(16).padStart(2, '0')).join('');
  return `${slug}-${worldId.slice(0, 8)}-${nonce}`;
}

/**
 * Is this handle key the world's own: `world-<id>`, or a later link's
 * `world-<id>-N`? An exact string match: nothing in the id is stripped, so a
 * crafted id never matches another world's key (S373 gate F7).
 */
export function isOwnHandleKey(handleKey: string, worldId: string): boolean {
  const base = `world-${worldId}`;
  return handleKey === base || (handleKey.startsWith(`${base}-`) && /^\d+$/.test(handleKey.slice(base.length + 1)));
}

/** A world with this world.json id is already in the registry, under any spelling of its identity. */
export function worldAlreadyHere(reg: WorldsRegistry, worldId: string): WorldRegistryEntry | undefined {
  return findWorldByOwIdentity(reg, worldId) ?? reg.worlds.find(w => isOwnHandleKey(w.folder?.handle_key ?? '', worldId));
}

/**
 * The cleared browser world a world.json of this id restores: one the browser
 * cleared, holding this EXACT world id (its own handle key, or its link's
 * server id). Never one matched only through a former link: the link goes
 * back only to the world it was made for (Skeld's second condition, S373
 * F7). The file door and the folder door both ask it (S376 gate B3).
 */
export function clearedOwnTwin(reg: WorldsRegistry, worldId: string): WorldRegistryEntry | null {
  // Searched by the exact rule itself, never through `worldAlreadyHere`,
  // whose first identity match can be a row a former link names (S377 D2 gate).
  return reg.worlds.find(w =>
    isBrowserWorld(w) && !!w.cleared_at && w.demo !== true
    && (isOwnHandleKey(w.folder.handle_key, worldId) || w.api?.world_id === worldId),
  ) ?? null;
}

type Locks = { request: (name: string, opts: unknown, cb: (lock: unknown) => Promise<unknown> | unknown) => Promise<unknown> };
function locks(): Locks | null {
  const l = (navigator as unknown as { locks?: Locks }).locks;
  return l && typeof l.request === 'function' ? l : null;
}
const lockName = (dir: string) => `atlas-world:${dir}`;

/** Run `fn` holding the make lock for one browser-home directory. */
export async function withWorldLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const l = locks();
  if (!l) return fn();
  return l.request(lockName(dir), {}, () => fn()) as Promise<T>;
}

/**
 * Run `fn` only if no one holds the directory's lock, holding it meanwhile.
 * Answers `{ ran: false }` when another tab's make or move is live.
 */
export async function ifWorldLockFree<T>(dir: string, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  const l = locks();
  if (!l) return { ran: true, value: await fn() };
  return l.request(lockName(dir), { ifAvailable: true }, async lock => {
    if (lock === null) return { ran: false } as const;
    return { ran: true, value: await fn() } as const;
  }) as Promise<{ ran: true; value: T } | { ran: false }>;
}

/**
 * Begin a make: create the directory and its `.atlas/making` marker. Call
 * inside `withWorldLock(dir, …)`; `finishBrowserMake` just before the
 * registry save.
 */
export async function beginBrowserMake(dir: string): Promise<FileSystemDirectoryHandle> {
  const home = await browserHome({ create: true });
  const handle = await home.getDirectoryHandle(dir, { create: true });
  const atlas = await handle.getDirectoryHandle('.atlas', { create: true });
  const w = await (await atlas.getFileHandle(MAKING_MARKER, { create: true })).createWritable();
  await w.write(new Date().toISOString());
  await w.close();
  return handle;
}

/**
 * A make in progress, holding its Web Lock until `finish` or `abort`
 * (contract §2.2). `finish(commit)` removes the marker, runs the synchronous
 * registry save, then releases the lock; `abort()` removes the directory
 * (after the caller closed any store on it) and releases the lock. Any
 * failure between `openBrowserMake` and `finish` must end in `abort`.
 */
export interface BrowserMake {
  dir: string;
  handle: FileSystemDirectoryHandle;
  finish(commit: () => void): Promise<void>;
  abort(): Promise<void>;
}

/**
 * The boot reconciliation's gate: settled once the pass has applied its
 * deltas. Every make awaits it, so none commits inside the pass's window
 * (contract §3.2; S376 gate B1: five makes rode outside the activation chain).
 */
let reconciled: Promise<void> = Promise.resolve();

/** How long a make waits for a pass that never ends (a hung `hydrateAtlasRoot`). */
export const RECONCILE_WAIT_LIMIT_MS = 15_000;

/**
 * Opens the gate; the returned function settles it. Called synchronously at
 * boot. It also settles itself after `RECONCILE_WAIT_LIMIT_MS`: a pass stuck
 * behind a blocked IndexedDB open must not hang every make with no word
 * (S377 D2 gate F3).
 */
export function beginBootReconciliation(): () => void {
  let settle: () => void = () => {};
  reconciled = new Promise<void>(r => { settle = r; });
  const backstop = setTimeout(() => settle(), RECONCILE_WAIT_LIMIT_MS);
  return () => { clearTimeout(backstop); settle(); };
}

export async function openBrowserMake(name: string, worldId: string): Promise<BrowserMake> {
  await reconciled;
  const dir = mintBrowserDirName(name, worldId);
  let release: () => void = () => {};
  const l = locks();
  if (l) {
    await new Promise<void>(acquired => {
      void l.request(lockName(dir), {}, () => {
        acquired();
        return new Promise<void>(done => { release = done; });
      });
    });
  }
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await beginBrowserMake(dir);
  } catch (err) {
    release();
    throw err;
  }
  let settled = false;
  return {
    dir,
    handle,
    async finish(commit) {
      if (settled) return;
      await finishBrowserMake(handle);
      try { commit(); } finally { settled = true; release(); }
    },
    async abort() {
      if (settled) return;
      settled = true;
      try {
        await removeBrowserWorldDir({ where: 'browser', folder: { handle_key: '', folder_name: dir } });
      } finally {
        release();
      }
    },
  };
}

/** Is this error the browser's storage being full? A make treats it as fatal (contract §2.2). */
export function isQuotaError(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'QuotaExceededError';
}

export async function finishBrowserMake(handle: FileSystemDirectoryHandle): Promise<void> {
  const atlas = await handle.getDirectoryHandle('.atlas', { create: true });
  await atlas.removeEntry(MAKING_MARKER).catch(err => { if (!isGoneError(err)) throw err; });
}

// ---- the reconciliation ----

type WorldFacts = { id?: unknown; name?: unknown; demo?: unknown; api?: { world_id?: unknown; api_key?: unknown; world_name?: unknown; read_only?: unknown } };

interface DirFacts {
  name: string;
  making: boolean;
  /** Parsed world.json, `null` when absent, `'unreadable'` when it will not parse. */
  meta: WorldFacts | null | 'unreadable';
}

/**
 * One change the pass decided. `applyReconcile` applies it to the registry as
 * it is THEN, re-checked there: a change another tab made meanwhile wins.
 */
export type ReconcileOp =
  | { kind: 'adopt'; dir: string; id: string; meta: WorldFacts }
  | { kind: 'unmark'; entryId: string; dir: string }
  | { kind: 'mark'; entryId: string; dir: string };

async function readFacts(dir: FileSystemDirectoryHandle, name: string): Promise<DirFacts> {
  let making = false;
  try { await (await dir.getDirectoryHandle('.atlas')).getFileHandle(MAKING_MARKER); making = true; } catch { /* none */ }
  let meta: DirFacts['meta'] = null;
  try {
    const text = await (await (await dir.getFileHandle('world.json')).getFile()).text();
    try { meta = JSON.parse(text); } catch { meta = 'unreadable'; }
    if (meta !== 'unreadable' && (typeof meta !== 'object' || meta === null)) meta = 'unreadable';
  } catch (err) {
    meta = isGoneError(err) ? null : 'unreadable';
  }
  return { name, making, meta };
}

/** What the last reconciliation left as a move's stale copy (Settings, Storage counts them). Session only. */
let lastStale: string[] = [];
export function staleBrowserCopies(): readonly string[] {
  return lastStale;
}

export interface ReconcileOutcome {
  /** The deltas, for the caller to apply to the registry as it is when the pass ends. */
  ops: ReconcileOp[];
  /** The deltas applied to the registry the pass started from: a record, never saved as such. */
  next: WorldsRegistry;
  adopted: string[];
  removed: string[];
  cleared: string[];
  /** Browser directories holding a world the registry places in a folder (a move's stale copy). */
  stale: string[];
}

/**
 * Reconcile the browser home against the registry (contract §3.2). `tourActive`
 * is `atlas_tour_v1.active`, read when each directory is decided. `fresh`
 * gives the registry as it is NOW (stored, and this tab's), checked inside
 * each directory's lock beside the snapshot `reg`. Removals happen only
 * inside a free lock.
 */
export async function reconcileBrowserHome(
  reg: WorldsRegistry,
  opts: { tourActive: boolean | (() => boolean); home?: FileSystemDirectoryHandle; fresh?: () => WorldsRegistry[] },
): Promise<ReconcileOutcome> {
  const out: ReconcileOutcome = { ops: [], next: reg, adopted: [], removed: [], cleared: [], stale: [] };
  const tourActive = () => typeof opts.tourActive === 'function' ? opts.tourActive() : opts.tourActive;
  const views = () => [out.next, ...(opts.fresh?.() ?? [])];
  let home: FileSystemDirectoryHandle;
  try {
    home = opts.home ?? await browserHome();
  } catch (err) {
    if (!isGoneError(err)) throw err;
    // No browser home: every browser world of the user's own is gone.
    markMissing(reg, new Set(), out);
    out.next = applyReconcile(reg, out.ops);
    return out;
  }

  const listed = new Set<string>();
  const dirs: Array<[string, FileSystemDirectoryHandle]> = [];
  for await (const [name, h] of (home as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (h.kind === 'directory') dirs.push([name, h as FileSystemDirectoryHandle]);
  }

  for (const [name, dir] of dirs) {
    listed.add(name);
    const result = await ifWorldLockFree(name, async () => {
      const f = await readFacts(dir, name);
      const claimed = out.next.worlds.find(w => isBrowserWorld(w) && w.folder.folder_name === name);
      if (claimed) {
        if (claimed.cleared_at && f.meta && f.meta !== 'unreadable') {
          out.ops.push({ kind: 'unmark', entryId: claimed.id, dir: name });
          out.next = unmarkWorldCleared(out.next, claimed.id);
        }
        return;
      }
      if (f.making) {
        await home.removeEntry(name, { recursive: true }).then(() => out.removed.push(name), () => {});
        return;
      }
      if (!f.meta || f.meta === 'unreadable') return; // not a world, or not one we can name: leave it
      const id = typeof f.meta.id === 'string' ? f.meta.id : '';
      if (!id) return;
      if (f.meta.demo === true) {
        if (!tourActive()) await home.removeEntry(name, { recursive: true }).then(() => out.removed.push(name), () => {});
        return;
      }
      // The owner as stored NOW, not only in the snapshot: another tab's make
      // commits before it releases this lock (S376 gate B1).
      const owner = views().map(v => worldAlreadyHere(v, id)).find(Boolean);
      if (owner) {
        if (!isBrowserWorld(owner)) {
          // A move's stale copy: the registry places this world in a folder.
          // Removed only when the commit named it (contract §4.3); else left.
          const movedFrom = (owner as { moved_from?: string }).moved_from;
          if (movedFrom === name) {
            await home.removeEntry(name, { recursive: true }).then(() => out.removed.push(name), () => {});
          } else {
            out.stale.push(name);
          }
        }
        return; // a browser world already registered under another directory: leave this one
      }
      out.ops.push({ kind: 'adopt', dir: name, id, meta: f.meta });
      out.next = adopt(out.next, name, f.meta, id);
      out.adopted.push(name);
    });
    if (!result.ran) continue; // another tab's make or move is live
  }

  markMissing(reg, listed, out);
  out.next = applyReconcile(reg, out.ops);
  lastStale = [...out.stale];
  return out;
}

/**
 * Apply the pass's deltas to `reg` (the registry as it is when the pass
 * ends), each re-checked against it: an adoption only for a directory and an
 * id no entry holds; a mark or unmark only for an entry still in this browser
 * under the same directory, still as the pass saw it. Then twins collapse.
 * Returns `reg` itself when nothing changed.
 */
export function applyReconcile(reg: WorldsRegistry, ops: readonly ReconcileOp[]): WorldsRegistry {
  let next = reg;
  const at = (id: string, dir: string) => next.worlds.find(w => w.id === id && isBrowserWorld(w) && w.folder.folder_name === dir);
  for (const op of ops) {
    if (op.kind === 'adopt') {
      if (next.worlds.some(w => isBrowserWorld(w) && w.folder.folder_name === op.dir) || worldAlreadyHere(next, op.id)) continue;
      next = adopt(next, op.dir, op.meta, op.id);
    } else if (op.kind === 'unmark') {
      if (at(op.entryId, op.dir)?.cleared_at) next = unmarkWorldCleared(next, op.entryId);
    } else {
      const w = at(op.entryId, op.dir);
      if (w && !w.cleared_at && w.demo !== true) next = markWorldCleared(next, op.entryId);
    }
  }
  return collapseTwins(next);
}

/**
 * The boot pass (`app.ts`, first in the activation chain): reconcile against
 * the registry as stored and as this tab holds it, then apply the deltas to
 * the registry as it is AFTER the last await, and save once.
 */
export async function reconcileAtBoot(opts: { home?: FileSystemDirectoryHandle } = {}): Promise<ReconcileOutcome> {
  const out = await reconcileBrowserHome(getState().registry, {
    tourActive: isTourFlagActive,
    home: opts.home,
    fresh: () => [storedRegistry(), getState().registry],
  });
  // Fold in what is stored first: another tab's save can land before its
  // storage event reaches this tab, and a delta re-checked against a lagging
  // view would bring back a world that tab deleted (S377 D2 gate F1, F2).
  const folded = adoptStoredRegistry(getState().registry);
  if (folded) patchSlice('registry', folded);
  const current = getState().registry;
  const next = applyReconcile(current, out.ops);
  if (next !== current) {
    saveRegistry(next);
    patchSlice('registry', next);
  }
  return out;
}

function adopt(reg: WorldsRegistry, dir: string, meta: WorldFacts, id: string): WorldsRegistry {
  const name = typeof meta.name === 'string' && meta.name ? meta.name : 'Untitled world';
  const handleKey = `world-${id}`;
  const pathHint = `browser storage/${dir}`;
  const api = meta.api;
  const linked = !!api && typeof api.world_id === 'string' && typeof api.api_key === 'string';
  const { next, entry } = linked
    ? createApiLinkedWorld(reg, {
      name, apiWorldId: api!.world_id as string, apiKey: api!.api_key as string, folderName: dir, handleKey, pathHint,
      apiWorldName: typeof api!.world_name === 'string' ? api!.world_name : undefined, readOnly: api!.read_only === true,
    })
    : createLocalWorld(reg, { name, folderName: dir, handleKey, pathHint });
  return updateWorldEntry(next, entry.id, { where: 'browser' });
}

/** Every unlisted browser world of the user's own (in the snapshot) is to be marked cleared. */
function markMissing(reg: WorldsRegistry, listed: Set<string>, out: ReconcileOutcome): void {
  for (const w of reg.worlds) {
    if (!isBrowserWorld(w) || w.demo === true || w.cleared_at) continue;
    if (listed.has(w.folder.folder_name)) continue;
    out.ops.push({ kind: 'mark', entryId: w.id, dir: w.folder.folder_name });
    out.cleared.push(w.id);
  }
}

/** Two entries naming the same browser directory (a two-tab merge twin): keep the older. */
function collapseTwins(reg: WorldsRegistry): WorldsRegistry {
  const seen = new Map<string, WorldRegistryEntry>();
  const drop = new Set<string>();
  for (const w of reg.worlds) {
    if (!isBrowserWorld(w)) continue;
    const prior = seen.get(w.folder.folder_name);
    if (!prior) { seen.set(w.folder.folder_name, w); continue; }
    const older = (prior.created_at ?? '') <= (w.created_at ?? '') ? prior : w;
    drop.add(older === prior ? w.id : prior.id);
    seen.set(w.folder.folder_name, older);
  }
  return drop.size ? { ...reg, worlds: reg.worlds.filter(w => !drop.has(w.id)) } : reg;
}

export { BROWSER_HOME };
