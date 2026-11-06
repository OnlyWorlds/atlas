/**
 * The open door's public path (1.123): `#/open/<world id>` for a world anyone
 * may read, opened by a visitor whom the account path cannot serve (signed
 * out, or signed in with no row for that id). Called by `setup/open-door.ts`
 * only after a world already here and the account's rows both said no.
 *
 *   1  A view-only copy of that world already here (any copy, by the world
 *      alone: `copy_of.world_id`, whatever its time) opens as it is, after
 *      one keyless `GET /world`: a 404 there adds one line that the world is
 *      no longer public; nothing else is read.
 *   2  Otherwise (or when that copy's folder is gone) the same one read
 *      decides. 200: the ask. 404, or 401 with keel's public reader switched
 *      off: the open door's own words for a world it cannot see. Anything
 *      else: one line, nothing made, nothing held.
 *   3  The ask's Open checks again (the tour, the sign-in it was asked
 *      under, a copy made meanwhile), then builds under a Web Lock per world
 *      across tabs, looking for a copy once more inside it: the whole world
 *      through the keyless reader, one type at a time and paced on keel's
 *      429, whole by keel's own counts, as a world file in memory
 *      (`buildWorldFile`), opened as a view-only copy beside nothing
 *      (`openWorldFile(bytes, { asCopy: true })`, conv. 177): a fresh world
 *      id, `snapshot_of`, `writable: false`, never online.
 *
 * Nothing is written before Open, and nothing goes up, ever
 * (`sync/public-reader.ts`).
 */
import { getState, patchSlice } from '../core/state';
import { PlainError } from '../core/plain-error';
import { isTourFlagActive } from '../tour/tour-flag';
import type { WorldRegistryEntry, WorldsRegistry } from '../core/types';
import type { ToastManager } from '../ui/toast-manager';
import { PublicWaitsSpent, PublicWorldReader, isPublicClosed, isPublicNotFound, type PublicReaderOpts, type PublicWorld } from '../sync/public-reader';
import { adoptStoredRegistry } from '../registry/registry';
import { buildWorldFile, notWholeLine } from './demo-copy';
import { requestPersistOnFirstBrowserWorld } from './world-parent';
import { copyDay, openedCopyLine } from '../core/world-copy';
import { PublicAskModal } from '../ui/public-ask-modal';

export const PUBLIC_UNREAD_LINE = 'Atlas could not reach OnlyWorlds just now. Try the link again in a moment.';
export const PUBLIC_SIGN_IN_CHANGED_LINE = 'You signed in or out while Atlas was opening this world. Open the link again.';
const OPEN_TOUR_LINE = 'Finish the tour first, then open the world again from onlyworlds.com.';

/** The ask, signed out: the copy, or a sign-in for a person whose world it is. */
export function publicAskLine(name: string): string {
  return `Open a view-only copy of "${name}" in this browser? If it is your world, sign in instead to open it as your own.`;
}

/** The ask, signed in with an account that has no row for the world. */
export function publicAskSignedInLine(name: string, who: string | null | undefined): string {
  return who
    ? `"${name}" is not one of your worlds (you are signed in as ${who}). Open a view-only copy in this browser?`
    : `"${name}" is not one of the worlds of the account Atlas is signed in with. Open a view-only copy in this browser?`;
}

/** Said on the progress line while keel's 429 is waited out. */
export function publicWaitLine(seconds: number): string {
  return `OnlyWorlds asked Atlas to wait ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
}

/** The fourth 429 in one open. */
export function publicSpentLine(name: string): string {
  return `"${name}" did not download completely, so Atlas did not open it. Try again in a minute.`;
}

/** A copy here of a world that is no longer public. */
export function publicGoneLine(name: string, at: string | undefined): string {
  const day = copyDay(at);
  return `"${name}" is no longer public on OnlyWorlds. This copy is as it was ${day ? `on ${day}` : 'when it was taken'}.`;
}

/** The public slice's mark (folder spec §4.2): the public rung, no role, no Character. */
export const PUBLIC_EXPORTED_AS = { kind: 'public', role: null, character: null } as const;

/** The newest view-only copy of this world here, by the world alone (any time, any door that made it); null when none. */
export function findPublicCopy(reg: WorldsRegistry, serverWorldId: string): WorldRegistryEntry | null {
  const time = (w: WorldRegistryEntry) => { const t = Date.parse(w.copy_of?.at ?? ''); return Number.isFinite(t) ? t : -Infinity; };
  const copies = reg.worlds.filter(w => !w.cleared_at && w.copy_of?.world_id === serverWorldId);
  copies.sort((a, b) => time(b) - time(a));
  return copies[0] ?? null;
}

export interface PublicDoorCtx {
  /** The account token the door ran under; null signed out. */
  token: string | null;
  /** Signed out, a world the public cannot read: the open door's sign-in words, the id held. */
  saySignIn: () => void;
  /** Signed in, a world the public cannot read: the open door's not-among words. */
  sayNotAmong: () => void;
  /**
   * Open a world already here as the open door does (silently with no world
   * open, else its click). False when it could not: the registry forgot it
   * (its folder gone), so the door goes on to the ask.
   */
  openHere: (entry: WorldRegistryEntry, said?: () => void) => Promise<boolean>;
  /** Test seam: the reader's options (fetch, sleep, base). */
  readerOpts?: PublicReaderOpts;
}

/** Ids being built in this tab: a second Open while one runs does nothing. */
const building = new Set<string>();

type Locks = { request<T>(name: string, cb: () => Promise<T>): Promise<T> };

function withPublicLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as { locks?: Locks }).locks : undefined;
  return locks ? locks.request(`atlas-public-copy-${id}`, fn) : fn();
}

/** The public path, once the account path said no. Never rejects. */
export async function runPublicDoor(id: string, toasts: ToastManager, ctx: PublicDoorCtx): Promise<void> {
  const found = findPublicCopy(getState().registry, id);
  // One request, never paced: a 429 here is "anything else".
  const reader = new PublicWorldReader(id, { ...ctx.readerOpts, maxWaits: 0 });
  let world: PublicWorld | null = null;
  let failure: unknown = null;
  try {
    world = await reader.readWorld();
  } catch (err) {
    failure = err;
  }
  if (found) {
    // Not public any more (404): the copy opens with a line. The reader
    // switched off (401) or anything else: the copy opens as it is, no line.
    const gone = isPublicNotFound(failure);
    if (failure && !gone) console.warn('[public-door] the world was not read; the copy opens as it is', failure);
    if (await ctx.openHere(found, gone ? () => toasts.info(publicGoneLine(found.name, found.copy_of?.at), 12_000) : undefined)) return;
    // Its folder was gone and the registry forgot it: the door goes on, on the same read.
  }
  if (!world) {
    // The public cannot read it: not public (404), or keel's reader switched off (401).
    if (isPublicClosed(failure)) {
      if (ctx.token) ctx.sayNotAmong(); else ctx.saySignIn();
      return;
    }
    console.warn('[public-door] the world was not read:', failure);
    toasts.error(PUBLIC_UNREAD_LINE, 12_000);
    return;
  }
  askForCopy(id, world.meta.name?.trim() || 'this world', toasts, ctx);
}

/**
 * The ask, a card in the middle of the page (1.123.1): nothing is made before
 * its Open, and its click is the gesture the storage request needs. Not now,
 * Escape or an outside click leaves nothing made and nothing held.
 */
function askForCopy(id: string, name: string, toasts: ToastManager, ctx: PublicDoorCtx): void {
  const line = ctx.token
    ? publicAskSignedInLine(name, getState().registry.account_username)
    : publicAskLine(name);
  new PublicAskModal({
    line,
    onOpen: () => { void openPublicCopy(id, name, toasts, ctx); },
    ...(ctx.token ? {} : { onSignIn: () => ctx.saySignIn() }),
  }).open();
}

/** The ask's Open. Never rejects. */
export async function openPublicCopy(id: string, name: string, toasts: ToastManager, ctx: PublicDoorCtx): Promise<void> {
  // The card stays until answered: the tour may have started, the sign-in moved.
  if (isTourFlagActive()) { toasts.info(OPEN_TOUR_LINE); return; }
  if ((getState().registry.account_token ?? null) !== ctx.token) { toasts.info(PUBLIC_SIGN_IN_CHANGED_LINE); return; }
  if (building.has(id)) return;
  // The copy lands in this browser: ask it to keep worlds inside the click, before the first await.
  requestPersistOnFirstBrowserWorld(line => toasts.info(line, 10_000));
  building.add(id);
  try {
    await withPublicLock(id, () => buildAndOpen(id, name, toasts, ctx));
  } catch (err) {
    console.warn('[public-door] the copy failed:', err);
    await sayFailure(err, name, toasts, ctx);
  } finally {
    building.delete(id);
  }
}

async function buildAndOpen(id: string, name: string, toasts: ToastManager, ctx: PublicDoorCtx): Promise<void> {
  // A copy made meanwhile (this tab or another) opens instead: one build per
  // world. Read from storage, not only this tab's memory: another tab's save
  // can land before its storage event reaches this one.
  const stored = adoptStoredRegistry(getState().registry);
  if (stored) patchSlice('registry', stored);
  const here = findPublicCopy(getState().registry, id);
  if (here && await ctx.openHere(here)) return;
  const { opfsStatus, NO_BROWSER_STORAGE_LINE } = await import('../core/capabilities');
  const status = await opfsStatus();
  if (status !== 'ok') {
    const { browserStorageFullSentence } = await import('../core/problems');
    toasts.error(status === 'full' ? browserStorageFullSentence('opening a copy of this world') : NO_BROWSER_STORAGE_LINE);
    return;
  }
  const { showLoadingOverlay } = await import('../ui/loading-overlay');
  const { progressLine } = await import('../ui/download-progress');
  const overlay = showLoadingOverlay(`Downloading ${name}`);
  overlay.update('Asking OnlyWorlds for it…');
  try {
    const reader = new PublicWorldReader(id, {
      ...ctx.readerOpts,
      onWait: s => overlay.update(publicWaitLine(s)),
      // The wait is over: the line no longer says to wait.
      onResume: () => overlay.update('Asking OnlyWorlds for it…'),
    });
    const built = await buildWorldFile({
      worldId: id,
      client: reader,
      fallbackName: name,
      read: () => reader.readWorld(),
      exportedAs: { ...PUBLIC_EXPORTED_AS },
      requireCounts: true,
      listConcurrency: 1,
      onProgress: p => { if (p.phase === 'write') overlay.update(progressLine(p)); },
    });
    if (built.kind !== 'file') return;
    overlay.update(`Opening ${built.name}…`);
    const { openWorldFile } = await import('./world-file-open');
    const { activateWorld } = await import('../sidebar/worlds-sidebar');
    const out = await openWorldFile(built.bytes, { asCopy: true });
    if (out.kind !== 'copied' && out.kind !== 'already') return;
    const entry = getState().registry.worlds.find(w => w.id === out.worldId);
    const opened = await activateWorld(out.worldId, toasts);
    if (opened && out.kind === 'copied' && entry?.copy_of) {
      toasts.success(openedCopyLine(entry.name, entry.copy_of));
    }
  } finally {
    overlay.close();
  }
}

async function sayFailure(err: unknown, name: string, toasts: ToastManager, ctx: PublicDoorCtx): Promise<void> {
  const { isCodeLoadError } = await import('../core/reload-offer');
  if (isCodeLoadError(err)) return; // its reload banner already says it (conv. 121)
  if (err instanceof PublicWaitsSpent) { toasts.error(publicSpentLine(name), 15_000); return; }
  // Turned private, or the reader switched off, between the ask and the build: the door's own words for a world it cannot see.
  if (isPublicClosed(err)) { if (ctx.token) ctx.sayNotAmong(); else ctx.saySignIn(); return; }
  if (err instanceof PlainError || (err as { name?: unknown } | null)?.name === 'QuotaExceededError') {
    const { showProblem } = await import('../ui/problem-fixes');
    showProblem(err, { doing: 'opening a copy of this world', where: 'browser', toasts });
    return;
  }
  // A failed read, a page that would not walk, a server error: not whole, so nothing opened.
  toasts.error(notWholeLine(name), 12_000);
}
