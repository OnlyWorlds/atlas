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
 */

import type { WorldRegistryEntry, WorldsRegistry } from './types';
import { BROWSER_HOME, browserHome, isBrowserWorld, isGoneError, markWorldCleared, unmarkWorldCleared } from './browser-worlds';
import { slugify } from '../store/fs-utils';
import { createApiLinkedWorld, createLocalWorld, findWorldByOwIdentity, updateWorldEntry } from '../registry/registry';

export const MAKING_MARKER = 'making';

/** `<slug>-<id8>-<nonce4>`: never the name of an earlier directory. */
export function mintBrowserDirName(name: string, worldId: string): string {
  const slug = slugify(name) || 'world';
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(2)), b => b.toString(16).padStart(2, '0')).join('');
  return `${slug}-${worldId.slice(0, 8)}-${nonce}`;
}

/** A world with this world.json id is already in the registry, under any spelling of its identity. */
export function worldAlreadyHere(reg: WorldsRegistry, worldId: string): WorldRegistryEntry | undefined {
  const keyed = new RegExp(`^world-${worldId.replace(/[^0-9a-zA-Z-]/g, '')}(-\\d+)?$`);
  return findWorldByOwIdentity(reg, worldId) ?? reg.worlds.find(w => keyed.test(w.folder?.handle_key ?? ''));
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

export async function finishBrowserMake(handle: FileSystemDirectoryHandle): Promise<void> {
  const atlas = await handle.getDirectoryHandle('.atlas', { create: true });
  await atlas.removeEntry(MAKING_MARKER).catch(err => { if (!isGoneError(err)) throw err; });
}

// ---- the reconciliation ----

interface DirFacts {
  name: string;
  making: boolean;
  /** Parsed world.json, `null` when absent, `'unreadable'` when it will not parse. */
  meta: { id?: unknown; name?: unknown; demo?: unknown; api?: { world_id?: unknown; api_key?: unknown; world_name?: unknown; read_only?: unknown } } | null | 'unreadable';
}

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

export interface ReconcileOutcome {
  next: WorldsRegistry;
  adopted: string[];
  removed: string[];
  cleared: string[];
  /** Browser directories holding a world the registry places in a folder (a move's stale copy). */
  stale: string[];
}

/**
 * Reconcile the browser home against the registry (contract §3.2). `tourActive`
 * is `atlas_tour_v1.active`. Removals happen only inside a free lock.
 */
export async function reconcileBrowserHome(
  reg: WorldsRegistry,
  opts: { tourActive: boolean; home?: FileSystemDirectoryHandle },
): Promise<ReconcileOutcome> {
  const out: ReconcileOutcome = { next: reg, adopted: [], removed: [], cleared: [], stale: [] };
  let home: FileSystemDirectoryHandle;
  try {
    home = opts.home ?? await browserHome();
  } catch (err) {
    if (!isGoneError(err)) throw err;
    // No browser home: every browser world of the user's own is gone.
    out.next = markMissing(out.next, new Set(), out.cleared);
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
        if (claimed.cleared_at && f.meta && f.meta !== 'unreadable') out.next = unmarkWorldCleared(out.next, claimed.id);
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
        if (!opts.tourActive) await home.removeEntry(name, { recursive: true }).then(() => out.removed.push(name), () => {});
        return;
      }
      const owner = worldAlreadyHere(out.next, id);
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
      out.next = adopt(out.next, name, f.meta as Exclude<DirFacts['meta'], null | 'unreadable'>, id);
      out.adopted.push(name);
    });
    if (!result.ran) continue; // another tab's make or move is live
  }

  out.next = markMissing(out.next, listed, out.cleared);
  out.next = collapseTwins(out.next);
  return out;
}

function adopt(reg: WorldsRegistry, dir: string, meta: Exclude<DirFacts['meta'], null | 'unreadable'>, id: string): WorldsRegistry {
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

/** Mark every unlisted browser world of the user's own as cleared. */
function markMissing(reg: WorldsRegistry, listed: Set<string>, cleared: string[]): WorldsRegistry {
  let next = reg;
  for (const w of reg.worlds) {
    if (!isBrowserWorld(w) || w.demo === true || w.cleared_at) continue;
    if (listed.has(w.folder.folder_name)) continue;
    next = markWorldCleared(next, w.id);
    cleared.push(w.id);
  }
  return next;
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
