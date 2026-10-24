/**
 * THE LIVE FOLDER (S364): keep Atlas open while another tool writes the
 * world folder (an AI agent, a text editor, a git checkout) and see what it
 * wrote when you come back to the window.
 *
 * The store half is `FolderStore.rescanDisk()` (a stat pass against the
 * stamps Atlas recorded, each candidate confirmed in its id's write chain).
 * This module is the app half: WHEN to scan (window focus, the tab becoming
 * visible, switching back to a parked world, "Reload from disk"), what to do
 * first (flush the rooms' pending saves, so Atlas's own text is on disk before
 * anything is compared), and what to tell whom (the element list's "changed
 * on disk" pill and row marks, the rooms' reload hooks via
 * `atlas:disk-changes`, the sync engine on linked worlds).
 *
 * What it never does: write a file, invent a sync stamp, or send a server
 * DELETE for a file removed outside Atlas. On a linked world, an outside
 * edit that follows the toolkit's rule (a fresh `local_updated_at`) uploads
 * like any edit; one that does not is shown, marked "not synced", and left
 * for the manifest design to decide (Captain's ruling, S364).
 */

import { isAtlasOnlyStorage } from './browser-worlds';
import { getState, patchSlice } from './state';
import { getActiveStore } from './active-store';
import { isZoneGestureActive } from './zone-gesture';
import { flushBeforeLeavingWorld } from './leave-flush';
import { onHashChange, parseHash } from './router';
import type { DiskChange, FolderStore } from '../store/folder-store';
import type { Element } from './types';

/** A focus storm (alt-tab, devtools) runs one pass, not five. */
const FOCUS_THROTTLE_MS = 5_000;
/** Above this many outside edits that would upload, on a linked world, sync waits for the user (Captain, S364). */
export const BIG_BATCH = 50;
/** worldId -> count of a held batch, so the question survives leaving the world and a reload (S364 gate lens B B3). */
const HELD_KEY = 'atlas_disk_held';

export interface DiskNotice {
  worldId: string;
  /** Elements changed or created on disk, marked until opened or dismissed. */
  marked: Set<string>;
  /** Linked worlds: marked elements that changed without a new edit time (see `notSyncedNow`). */
  notSynced: Set<string>;
  /** Files that would not parse (half-written, conflict markers): still served from before. */
  unreadable: string[];
  /**
   * Names of elements whose files were removed outside Atlas (Captain, S364:
   * say so). Dropped from view only: never deleted on the account, and a
   * linked world's next full pull can bring them back.
   */
  removed: string[];
  /** Linked world, big batch: sync is held until the user answers. */
  held: { count: number; release: () => void } | null;
  /** The element list shows only the marked elements. */
  showOnly: boolean;
}

/** Why a pass did not look. */
export type RescanSkip = 'no-world' | 'throttled' | 'busy' | 'rekey' | 'closed';
export interface RescanOutcome {
  changes: DiskChange[];
  skipped?: RescanSkip;
}

/** One notice per world: leaving a world keeps its marks and its held question (B3). */
const notices = new Map<string, DiskNotice>();
const listeners = new Set<() => void>();
let lastRunAt = 0;
/** A focus inside the throttle arms ONE trailing pass for when the window
 *  reopens, so an agent's edit made seconds after the last pass still shows
 *  without another alt-tab (S365 lane B M4). */
let trailing: ReturnType<typeof setTimeout> | null = null;
/** The pass in flight, and the store it is for (B5: a pass for another world never answers for this one). */
let running: { store: FolderStore; full: boolean; promise: Promise<RescanOutcome> } | null = null;
/** Changes a pass found for a store whose world was left mid-pass: carried to that store's next pass (B5). */
const abandoned = new WeakMap<FolderStore, DiskChange[]>();

function emit(): void {
  for (const fn of listeners) fn();
}

function heldMap(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(HELD_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, number> : {};
  } catch { return {}; }
}
function persistHeld(worldId: string, count: number | null): void {
  try {
    const m = heldMap();
    if (count === null) delete m[worldId]; else m[worldId] = count;
    localStorage.setItem(HELD_KEY, JSON.stringify(m));
  } catch { /* blocked storage: the hold lasts this page session only */ }
}

function emptyNotice(worldId: string): DiskNotice {
  return { worldId, marked: new Set(), notSynced: new Set(), unreadable: [], removed: [], held: null, showOnly: false };
}
function isEmpty(n: DiskNotice): boolean {
  return n.marked.size === 0 && n.unreadable.length === 0 && n.removed.length === 0 && !n.held;
}
function setNotice(n: DiskNotice): void {
  if (isEmpty(n)) notices.delete(n.worldId); else notices.set(n.worldId, n);
  emit();
}

/** The live folder's notice for the ACTIVE world, or null. */
export function getDiskNotice(): DiskNotice | null {
  const worldId = getState().active?.worldId ?? null;
  return worldId ? notices.get(worldId) ?? null : null;
}

export function onDiskNotice(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * The "not synced" ids that are still true: an Atlas write since (a user
 * edit, the scene's relation fix-up) stamps the element, and then it uploads
 * after all (S364 gate lens B B12).
 */
export function notSyncedNow(n: DiskNotice, elements: readonly Element[]): number {
  if (n.notSynced.size === 0) return 0;
  const byId = new Map(elements.map(e => [e.id, e]));
  let count = 0;
  for (const id of n.notSynced) {
    const el = byId.get(id);
    if (el && el.server_updated_at && (el.local_updated_at ?? '') <= el.server_updated_at) count++;
  }
  return count;
}

/**
 * The files a world's open left out as unreadable (conv. 176, Seethe h20 #12538): said in the
 * same line as those a rescan finds, once per open, since before 1.89.0 a folder with a damaged
 * file opened one element short and said nothing. `files` is the store's `unreadableFiles()`.
 */
export function noticeUnreadableAtOpen(worldId: string, files: readonly string[]): void {
  if (files.length === 0) return;
  const prev = notices.get(worldId) ?? emptyNotice(worldId);
  setNotice({ ...prev, unreadable: [...new Set([...prev.unreadable, ...files])] });
}

/** "Mark all seen": clear the marks and the unreadable line. A held batch keeps waiting for its answer. */
export function dismissDiskNotice(): void {
  const n = getDiskNotice();
  if (!n) return;
  setNotice({ ...n, marked: new Set(), notSynced: new Set(), unreadable: [], removed: [], showOnly: false });
}

export function setDiskShowOnly(on: boolean): void {
  const n = getDiskNotice();
  if (!n) return;
  setNotice({ ...n, showOnly: on });
}

/**
 * Ids moved (the re-key, Route 2): the marks follow them, or a notice would
 * count an element that is gone and miss its successor (S367 lane B N8).
 */
export function remapDiskNoticeIds(worldId: string, map: ReadonlyMap<string, string>): void {
  const n = notices.get(worldId);
  if (!n) return;
  const re = (s: Set<string>): Set<string> =>
    [...s].some(id => map.has(id)) ? new Set([...s].map(id => map.get(id) ?? id)) : s;
  const marked = re(n.marked);
  const notSynced = re(n.notSynced);
  if (marked === n.marked && notSynced === n.notSynced) return;
  setNotice({ ...n, marked, notSynced });
}

/** Opening an element (in any room) clears its mark. */
function markSeen(id: string): void {
  const n = getDiskNotice();
  if (!n || !n.marked.has(id)) return;
  const marked = new Set(n.marked);
  marked.delete(id);
  const notSynced = new Set(n.notSynced);
  notSynced.delete(id);
  setNotice({ ...n, marked, notSynced, showOnly: n.showOnly && marked.size > 0 });
}

/**
 * Answer a held batch: upload the changes, or keep this world offline (the
 * same switch as "Stay offline" in the worlds list).
 */
export async function answerHeldBatch(upload: boolean): Promise<void> {
  const n = getDiskNotice();
  const held = n?.held;
  if (!n || !held) return;
  const worldId = n.worldId;
  persistHeld(worldId, null);
  setNotice({ ...n, held: null });
  if (!upload) {
    const { setWorldPaused, saveRegistry } = await import('../registry/registry');
    const { getCurrentSyncEngine, getCurrentSyncWorldId } = await import('../sync/sync-attach');
    const next = setWorldPaused(getState().registry, worldId, true);
    saveRegistry(next);
    patchSlice('registry', next);
    if (getCurrentSyncWorldId() === worldId) getCurrentSyncEngine()?.pause('manual');
  }
  held.release(); // pushes on release unless the world is now paused
}

/**
 * Drop a waiting big-batch question for this world without answering it
 * (S366 gate A2). Taking a world online IS the answer: the link just tried to
 * upload every element, so a question saved before it (a world held, then
 * unlinked, then linked again) must not come back with its old count.
 */
export function forgetPersistedDiskHold(worldId: string): void {
  if (!heldMap()[worldId]) return;
  persistHeld(worldId, null);
  const prev = notices.get(worldId);
  if (prev?.held) setNotice({ ...prev, held: null });
}

/** True when a big-batch question is waiting for this world (persisted across reloads). */
export function isDiskHoldPersisted(worldId: string): boolean {
  return !!heldMap()[worldId];
}

/**
 * THE SAME QUESTION AT OPEN (S365 lane B M3, Captain's yes): more than
 * `BIG_BATCH` elements waiting to upload when a linked world opens (an agent
 * re-parsed the folder overnight, a branch switch while Atlas was closed)
 * wait for Upload them / Stay offline, exactly as the batch seen with the
 * window open does. Persisted, so a reload asks again.
 */
export function holdBigBatchAtOpen(worldId: string, count: number, engine: { hold(reason: 'disk'): Promise<() => void> }): void {
  persistHeld(worldId, count);
  adoptPersistedDiskHold(worldId, engine);
}

/**
 * A batch that was waiting for its answer when the world was left or the page
 * reloaded keeps waiting (B3). Called by `attachSyncEngine` BEFORE the
 * flush-on-attach, which would otherwise push it: `hold()` counts itself in
 * synchronously, so the flush's round refuses.
 */
export function adoptPersistedDiskHold(worldId: string, engine: { hold(reason: 'disk'): Promise<() => void> }): void {
  const count = heldMap()[worldId];
  if (!count) return;
  const releasing = engine.hold('disk');
  const release = (): void => { void releasing.then(r => r()); };
  const prev = notices.get(worldId) ?? emptyNotice(worldId);
  setNotice({ ...prev, held: { count, release } });
}

/**
 * Wait out a pass already in flight (S367, lane B N2). An id move takes the
 * re-key single-flight first, which stops every NEW pass; one that started
 * before could still land its element list over the move's. Never throws.
 */
export async function settleLivePass(): Promise<void> {
  const r = running;
  if (r) await r.promise.catch(() => undefined);
}

/**
 * One pass for the active world. `force` skips the focus throttle (revive,
 * the command, tests); `full` confirms every file by content. Never runs while
 * a world is loading, while touring (the tour world is Atlas's own scaffold),
 * during a zone drag or pin placement, or during a re-key; says why it did not.
 */
export function rescanNow(opts: { force?: boolean; full?: boolean } = {}): Promise<RescanOutcome> {
  const store = getActiveStore();
  const worldId = getState().active?.worldId ?? null;
  if (!store || !worldId) return Promise.resolve({ changes: [], skipped: 'no-world' });
  if (running) {
    // The pass in flight answers for its own store only, and a "Reload from
    // disk" is never satisfied by a quick pass: chain one more after it.
    if (running.store === store && (running.full || !opts.full)) return running.promise;
    return running.promise.catch(() => undefined).then(() => rescanNow({ ...opts, force: true }));
  }
  const now = Date.now();
  if (!opts.force && now - lastRunAt < FOCUS_THROTTLE_MS) {
    if (!trailing) {
      trailing = setTimeout(() => {
        trailing = null;
        if (document.visibilityState !== 'hidden') void rescanNow({ force: true });
      }, FOCUS_THROTTLE_MS - (now - lastRunAt));
    }
    return Promise.resolve({ changes: [], skipped: 'throttled' });
  }
  const ui = getState().ui;
  // A zone drag or a pin placement holds positions the store has not seen
  // yet; the next focus after it finishes runs the pass. A world in browser
  // storage (and the tour's sandbox) can only be written by Atlas tabs, under
  // the lock, so there is nothing outside to notice (conv. 129); asked of the
  // ACTIVE world, not the tour flag, which is shared by every tab (S365 L1).
  const touring = isAtlasOnlyStorage(getState().registry.worlds.find(w => w.id === worldId));
  if (getState().data.loading || touring || isZoneGestureActive() || ui.pinPlacement) {
    return Promise.resolve({ changes: [], skipped: 'busy' });
  }
  // Claimed SYNCHRONOUSLY (B9): a focus and a visibilitychange in one tick
  // run one pass, not two.
  lastRunAt = now;
  if (trailing) { clearTimeout(trailing); trailing = null; }
  const full = !!opts.full;
  const promise = (async (): Promise<RescanOutcome> => {
    try {
      const { isRekeyRunning } = await import('../sync/rekey-run');
      if (isRekeyRunning()) return { changes: [], skipped: 'rekey' };
      return await runPass(store, worldId, full);
    } finally {
      running = null;
    }
  })();
  running = { store, full, promise };
  return promise;
}

async function runPass(store: FolderStore, worldId: string, full: boolean): Promise<RescanOutcome> {
  // Atlas's own pending text reaches disk first: then every difference the
  // pass finds is someone else's, and a room typing into an element the
  // other tool also changed has its words on disk before the comparison.
  // (The rooms write only what really changed since they loaded or saved.)
  await flushBeforeLeavingWorld();
  const stillHere = () => getActiveStore() === store && getState().active?.worldId === worldId;
  if (!stillHere()) return { changes: [], skipped: 'closed' };
  const result = await store.rescanDisk({ full });
  const carried = abandoned.get(store) ?? [];
  abandoned.delete(store);
  const changes = mergeChanges(carried, result.changes);
  if (!stillHere()) {
    // The world was left mid-pass: the store has absorbed these, and no later
    // stat will show them again, so they wait for this store's next pass (B5).
    if (changes.length > 0) abandoned.set(store, changes);
    return { changes: [], skipped: 'closed' };
  }
  if (result.skipped) return { changes: [], skipped: result.skipped };

  // world.json is never cached (it syncs from disk already); only the header
  // and the charts' now-line hold a copy.
  const { refreshMetaCacheNow } = await import('../sync/sync-attach');
  await refreshMetaCacheNow().catch(() => {});

  const applied = changes.filter(c => c.kind !== 'unreadable');
  const unreadable = changes.filter(c => c.kind === 'unreadable').map(c => (c.filename ? `${c.type}/${c.filename}` : c.id));
  if (changes.length === 0) return { changes: [] };

  let elements: Element[] = getState().data.elements;
  if (applied.length > 0) {
    elements = await store.listElements();
    if (!stillHere()) { abandoned.set(store, changes); return { changes: [], skipped: 'closed' }; }
    patchSlice('data', { ...getState().data, elements });
  }

  // Marks: changed + created join; deleted ones leave.
  const prev = notices.get(worldId) ?? emptyNotice(worldId);
  const marked = new Set(prev.marked);
  const notSynced = new Set(prev.notSynced);
  for (const c of applied) {
    if (c.kind === 'deleted') { marked.delete(c.id); notSynced.delete(c.id); }
    else marked.add(c.id);
  }

  // Linked worlds (Captain's rulings, S364): an edit carrying a fresh
  // `local_updated_at` uploads like any edit; one without is marked "not
  // synced"; more than BIG_BATCH edits that WOULD upload hold sync until the
  // user answers (B11: unstamped ones upload nothing, so they never count).
  // A view-only world never uploads, so it never asks.
  const { getCurrentSyncEngine, getCurrentSyncWorldId, requestPushIfLinked } = await import('../sync/sync-attach');
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  const engine = getCurrentSyncWorldId() === worldId && !entry?.api?.read_only ? getCurrentSyncEngine() : null;
  let held = prev.held;
  if (engine) {
    const byId = new Map(elements.map(e => [e.id, e]));
    let pending = 0;
    for (const c of applied) {
      if (c.kind === 'deleted') continue;
      const el = byId.get(c.id);
      if (!el) continue;
      const willUpload = !el.server_updated_at || (el.local_updated_at ?? '') > el.server_updated_at;
      if (willUpload) { pending++; notSynced.delete(c.id); }
      else notSynced.add(c.id);
    }
    // A hold may have been taken since `prev` was read (the one at open, S365).
    held = notices.get(worldId)?.held ?? held;
    // The question's count is what is WAITING, recounted, never a running
    // sum: the hold at open and the revive pass after it see the same edits
    // (S365 gate lens A M3 asked about 102 changes when there were 51).
    const waiting = async (): Promise<number> => (await store.listLocallyChangedSince(null)).length;
    if (held) {
      held = { ...held, count: await waiting() };
      persistHeld(worldId, held.count);
    } else if (pending > BIG_BATCH) {
      const release = await engine.hold('disk');
      if (!stillHere()) { release(); abandoned.set(store, changes); return { changes: [], skipped: 'closed' }; } // B4
      const standing = notices.get(worldId)?.held;
      if (standing) {
        // Another path held while this one awaited: one question, one hold.
        release();
        held = { ...standing, count: await waiting() };
      } else {
        held = { count: await waiting(), release };
      }
      persistHeld(worldId, held.count);
    } else if (pending > 0) {
      requestPushIfLinked();
    }
  }
  if (!stillHere()) { abandoned.set(store, changes); return { changes: [], skipped: 'closed' }; }

  setNotice({
    worldId,
    marked,
    notSynced,
    unreadable: [...new Set([...prev.unreadable, ...unreadable])],
    removed: [...prev.removed, ...applied.filter(c => c.kind === 'deleted').map(c => c.before?.name || 'an unnamed element')],
    held,
    showOnly: prev.showOnly,
  });

  // The arrival flash on the rows, and each room's reload hook.
  const arrived = applied.filter(c => c.kind !== 'deleted').map(c => c.id);
  if (arrived.length > 0) document.dispatchEvent(new CustomEvent('atlas:pulled-ids', { detail: { ids: arrived } }));
  document.dispatchEvent(new CustomEvent('atlas:disk-changes', { detail: { changes } }));
  return { changes };
}

/** Carried changes first; a later report for the same id and kind wins its `before` from the earlier one. */
function mergeChanges(first: DiskChange[], then: DiskChange[]): DiskChange[] {
  if (first.length === 0) return then;
  const out = [...first];
  for (const c of then) {
    if (c.id && out.some(o => o.id === c.id && o.kind === c.kind)) continue;
    out.push(c);
  }
  return out;
}

/**
 * Triggers: the window regaining focus and the tab becoming visible. The
 * revive trigger is called by `activateWorld` (a parked world's caches are
 * trusted on switch-back, so edits made meanwhile show only after a pass).
 * Opening an element, scene, knowledge entry or page clears its mark (B8).
 * Notices are per world: leaving a world keeps them for the return.
 */
export function installLiveFolder(): () => void {
  const onFocus = () => { void rescanNow(); };
  const onVisible = () => { if (document.visibilityState === 'visible') void rescanNow(); };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);
  const unsubHash = onHashChange(() => {
    const route = parseHash(window.location.hash);
    const opened = route.elementId ?? route.narrativeId ?? route.knowledgeId ?? route.pageId;
    if (opened) markSeen(opened);
  });
  return () => {
    if (trailing) { clearTimeout(trailing); trailing = null; }
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisible);
    unsubHash();
  };
}

/**
 * THE SIDECAR RULE for a reload (S364): an outside tool edits `story` (the
 * schema's field) and never the atlas-only rich-text copy, and the editors
 * prefer the copy whenever it is non-empty. So when `story` changed on disk
 * and the copy did not, the copy is stale and the story is the text to load;
 * the next save writes a fresh copy from it.
 */
export function storyChangedAlone(before: Element | undefined, after: Element, sidecarField: string): boolean {
  if (!before) return false;
  const rec = (e: Element) => e as Record<string, unknown>;
  if ((rec(before).story ?? '') === (rec(after).story ?? '')) return false;
  return JSON.stringify(rec(before)[sidecarField] ?? null) === JSON.stringify(rec(after)[sidecarField] ?? null);
}

/** The change `atlas:disk-changes` reports for this element, when its body changed. */
export function diskChangeFor(ev: Event, id: string | null): DiskChange | undefined {
  if (!id) return undefined;
  const changes = (ev as CustomEvent<{ changes?: DiskChange[] }>).detail?.changes ?? [];
  return changes.find(c => c.id === id && c.kind === 'changed');
}

/** Tests: forget throttle, notices and the persisted hold between cases. */
export function __resetLiveFolderForTests(): void {
  notices.clear();
  lastRunAt = 0;
  running = null;
  if (trailing) { clearTimeout(trailing); trailing = null; }
  try { localStorage.removeItem(HELD_KEY); } catch { /* none */ }
  emit();
}
