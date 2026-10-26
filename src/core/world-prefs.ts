/**
 * THE WHOLE WORLD IN THE FOLDER. A world's notes, its cast (the home
 * protagonist and home), its calendar lens and its writing labels are things
 * the user wrote ABOUT the world, and they lived only in this browser's
 * localStorage registry: copying the folder, opening it on another machine,
 * "Forget world" or clearing site data lost them. They now also live in
 * `.atlas/world-prefs.json`, beside charts.json and styles.json.
 *
 * The registry stays the in-memory home every reader already uses (no call
 * site changes); the file is the durable copy. Two directions:
 *   - OPEN (`loadWorldPrefs`, from activateWorld, BEFORE re-key recovery):
 *     a three-way against the JSON this browser last wrote to the file, kept
 *     in its OWN localStorage key, never on the registry entry: recording it
 *     must not re-save the whole registry (a background registry save after a
 *     "clear site data" brought the forgotten worlds back, in a flaky test).
 *       file absent            -> seed it from the registry (the migration)
 *       no base yet, file here -> this browser's first sync of a folder another
 *                                 one seeded: MERGE (the file's keys win, keys
 *                                 it lacks keep this browser's value, and two
 *                                 different notes are both kept), then write
 *                                 the merge out
 *       file === base          -> only this browser changed things (or none):
 *                                 the registry wins and is written out
 *       file !== base          -> the folder changed elsewhere since this
 *                                 browser last synced it: the file wins
 *   - CHANGE (`installWorldPrefsSync`): a registry change to the active
 *     world's prefs is written to the file (debounced), wherever it came
 *     from: the notes overlay, the cast pin, a re-key or an id swap remapping
 *     the cast, the calendar chip.
 * Read-both-write-new: nothing is removed from the registry, so an older
 * Atlas keeps working from its copy (Titus).
 */

import { getState, patchSlice, subscribe } from './state';
import { getActiveStore } from './active-store';
import { onLeaveWorld } from './leave-flush';
import { saveRegistry } from '../registry/registry';
import { entryIsViewOnly } from './view-only';
import type { WorldRegistryEntry } from './types';
import type { FolderStore } from '../store/folder-store';

/** The registry fields that belong to the world, not to this browser. */
export const WORLD_PREF_KEYS = ['notes', 'favorites', 'active_calendar_id', 'writing_labels', 'writing_initialized'] as const;
type PrefKey = typeof WORLD_PREF_KEYS[number];

const FORMAT = 'atlas-world-prefs';
const WRITE_DEBOUNCE_MS = 250;
/** worldId -> canonical JSON of world-prefs.json as this browser last wrote or read it. */
const SYNCED_KEY = 'atlas_world_prefs_synced';

function syncedMap(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SYNCED_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, string> : {};
  } catch {
    return {};
  }
}

/** The three-way's base for a world, or undefined when this browser never synced its prefs. */
export function prefsSyncedFor(worldId: string): string | undefined {
  return syncedMap()[worldId];
}

function setPrefsSynced(worldId: string, key: string): void {
  try {
    localStorage.setItem(SYNCED_KEY, JSON.stringify({ ...syncedMap(), [worldId]: key }));
  } catch { /* storage full or blocked: the next open re-seeds */ }
}

/** The entry's prefs as the file stores them: only keys with a value, in a fixed order. */
export function prefsOf(entry: WorldRegistryEntry): Record<string, unknown> {
  const out: Record<string, unknown> = { format: FORMAT, version: 1 };
  for (const k of WORLD_PREF_KEYS) {
    const v = (entry as unknown as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Canonical JSON (top-level keys sorted) so equal prefs compare equal whatever wrote them. */
export function prefsKey(prefs: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(prefs).sort().map(k => [k, prefs[k]]));
}

function withFilePrefs(entry: WorldRegistryEntry, file: Record<string, unknown>): WorldRegistryEntry {
  const next = { ...entry } as unknown as Record<string, unknown>;
  for (const k of WORLD_PREF_KEYS) {
    if (k in file) next[k] = file[k as PrefKey];
    else delete next[k];
  }
  return next as unknown as WorldRegistryEntry;
}

/**
 * The first-sync merge: the file's keys win, keys it lacks keep the entry's
 * value, and when both hold different notes the file's come first, then
 * this browser's, under a line saying where they came from.
 */
function mergePrefs(entry: WorldRegistryEntry, file: Record<string, unknown>): WorldRegistryEntry {
  const next = { ...entry } as unknown as Record<string, unknown>;
  const mine = typeof entry.notes === 'string' ? entry.notes.trim() : '';
  for (const k of WORLD_PREF_KEYS) {
    if (k in file) next[k] = file[k as PrefKey];
  }
  const theirs = typeof file.notes === 'string' ? (file.notes as string).trim() : '';
  if (mine && theirs && mine !== theirs && !theirs.includes(mine) && !mine.includes(theirs)) {
    next.notes = `${file.notes as string}\n\nNotes from this browser:\n${entry.notes}`;
  } else if (mine && (!theirs || mine.includes(theirs))) {
    // Ours already holds theirs: the merge done at an earlier open whose
    // write-out failed (a view-only world). It re-runs at every open and
    // must neither grow nor shrink.
    next.notes = entry.notes;
  }
  return next as unknown as WorldRegistryEntry;
}

function patchEntry(worldId: string, fn: (e: WorldRegistryEntry) => WorldRegistryEntry): void {
  const reg = getState().registry;
  const idx = reg.worlds.findIndex(w => w.id === worldId);
  if (idx < 0) return;
  const worlds = reg.worlds.slice();
  worlds[idx] = fn(worlds[idx]);
  const next = { ...reg, worlds };
  saveRegistry(next);
  patchSlice('registry', next);
}

/**
 * Per world, the prefs key last written, applied or TRIED: the subscriber's
 * "did anything move?". A write that failed (a view-only world, a file that
 * will not parse) counts as seen, so it is retried when the prefs change
 * again, not on every state tick.
 */
const lastSeen = new Map<string, string>();
/** Worlds whose open-time reconcile ran in this page session (at most once each). */
const reconciled = new Set<string>();

/** The base a key encodes (`prefsKey` is canonical JSON of the pairs). */
function fromKey(key: string): Record<string, unknown> | null {
  try {
    const pairs = JSON.parse(key) as unknown;
    return Array.isArray(pairs) ? Object.fromEntries(pairs as [string, unknown][]) : null;
  } catch {
    return null;
  }
}

/**
 * The file moved since this browser last synced it while the world stayed
 * open (another machine through Dropbox or git): per key, a pref this browser
 * changed since the base is ours, any other is the file's; two different new
 * notes are both kept, the file's first.
 */
function threeWay(base: Record<string, unknown>, mine: Record<string, unknown>, file: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...file };
  for (const k of WORLD_PREF_KEYS) {
    const ours = JSON.stringify(mine[k]) !== JSON.stringify(base[k]);
    if (!ours) continue;
    const theirs = JSON.stringify(file[k]) !== JSON.stringify(base[k]);
    if (k === 'notes' && theirs && typeof file.notes === 'string' && typeof mine.notes === 'string' && file.notes.trim() && mine.notes.trim()) {
      out.notes = `${file.notes}\n\nNotes from this browser:\n${mine.notes}`;
    } else if (mine[k] === undefined) {
      delete out[k];
    } else {
      out[k] = mine[k];
    }
  }
  return out;
}

/** Write the entry's prefs to the file and remember what was written. View-only and corrupt files are left alone. */
async function writeOut(store: FolderStore, worldId: string): Promise<void> {
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  // A view-only world's store refuses every write: the prefs stay on the
  // registry entry, and the file is never tried (no warning at
  // every open).
  if (!entry || entry.demo || entryIsViewOnly(entry)) return;
  let prefs = prefsOf(entry);
  const base = prefsSyncedFor(worldId);
  if (base !== undefined && prefsKey(prefs) !== base) {
    let file: Record<string, unknown> | null = null;
    try { file = await store.readWorldPrefs(); } catch { file = null; }
    const baseObj = fromKey(base);
    if (file && baseObj && prefsKey(file) !== base) {
      const merged = threeWay(baseObj, prefs, file);
      // The file is folded in now, so it is the base: a write that then fails
      // (view-only, permission dropped, a synced file locked) must not merge
      // the same file again at every later pref change.
      setPrefsSynced(worldId, prefsKey(file));
      lastSeen.set(worldId, prefsKey({ ...prefsOf(entry), ...merged }));
      patchEntry(worldId, e => withFilePrefs(e, merged));
      const applied = getState().registry.worlds.find(w => w.id === worldId);
      if (!applied) return;
      prefs = prefsOf(applied);
    }
  }
  const key = prefsKey(prefs);
  lastSeen.set(worldId, key);
  if (prefsSyncedFor(worldId) === key) return;
  try {
    await store.writeWorldPrefs(prefs);
  } catch (err) {
    console.warn('[world-prefs] not written:', err instanceof Error ? err.message : err);
    return;
  }
  setPrefsSynced(worldId, key);
}

/**
 * OPEN: reconcile the file with the registry (see the header). Never throws;
 * a file that will not parse is left alone and the registry keeps serving.
 */
export async function loadWorldPrefs(store: FolderStore, worldId: string): Promise<void> {
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  if (!entry || entry.demo) return;
  reconciled.add(worldId);
  lastSeen.set(worldId, prefsKey(prefsOf(entry)));
  let file: Record<string, unknown> | null;
  try {
    file = await store.readWorldPrefs();
  } catch (err) {
    console.warn('[world-prefs] world-prefs.json will not open; using this browser\'s copy:', err instanceof Error ? err.message : err);
    return;
  }
  if (!file) { await writeOut(store, worldId); return; }
  const fileKey = prefsKey(file);
  const base = prefsSyncedFor(worldId);
  if (base === fileKey) { await writeOut(store, worldId); return; }
  if (base === undefined) {
    // First sync in this browser: nothing here is thrown away (B6).
    patchEntry(worldId, e => mergePrefs(e, file!));
    await writeOut(store, worldId);
    return;
  }
  // The folder's prefs win: they reach the registry (the one registry save
  // this module makes), and become the base.
  setPrefsSynced(worldId, fileKey);
  patchEntry(worldId, e => withFilePrefs(e, file!));
  const applied = getState().registry.worlds.find(w => w.id === worldId);
  if (applied) lastSeen.set(worldId, prefsKey(prefsOf(applied)));
}

/**
 * CHANGE: write the active world's prefs when they move. One subscriber for
 * every writer; the comparison is against the last key seen, so a tick that
 * changes nothing costs one small JSON.stringify.
 */
export function installWorldPrefsSync(): () => void {
  let timer: number | null = null;
  /** What the pending write is FOR, captured at schedule time (B7: a world switch must not drop it). */
  let pendingFor: { store: FolderStore; worldId: string } | null = null;
  const flushPending = async (): Promise<void> => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    const p = pendingFor;
    pendingFor = null;
    if (p) await writeOut(p.store, p.worldId);
  };
  // A world switch awaits this before the store changes hands (B7).
  const unLeave = onLeaveWorld(flushPending);
  const reconciling = new Set<string>();
  const unsub = subscribe(() => {
    const worldId = getState().active?.worldId;
    if (!worldId) return;
    const entry = getState().registry.worlds.find(w => w.id === worldId);
    if (!entry || entry.demo) return;
    if (!reconciled.has(worldId)) {
      // A world made active without activateWorld (create, link, the tour's
      // scaffold): run the open-time reconcile once.
      const store = getActiveStore();
      if (store && !reconciling.has(worldId)) {
        reconciling.add(worldId);
        // Fired and forgotten: a failure here keeps the registry's
        // prefs, so it is logged, never thrown at the background-error reporter.
        void loadWorldPrefs(store, worldId)
          .catch(err => console.warn('[atlas] world prefs did not reconcile:', err))
          .finally(() => reconciling.delete(worldId));
      }
      return;
    }
    if (reconciling.has(worldId)) return;
    const key = prefsKey(prefsOf(entry));
    if (key === lastSeen.get(worldId)) return;
    const store = getActiveStore();
    if (!store) return;
    if (pendingFor && pendingFor.worldId !== worldId) void flushPending();
    pendingFor = { store, worldId };
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => { void flushPending(); }, WRITE_DEBOUNCE_MS);
  });
  // A pending write when the page goes: best effort, like the rooms' pagehide.
  const onPageHide = () => { void flushPending(); };
  window.addEventListener('pagehide', onPageHide);
  return () => {
    unsub();
    unLeave();
    window.removeEventListener('pagehide', onPageHide);
    if (timer !== null) window.clearTimeout(timer);
  };
}

/** Tests: forget the per-session bookkeeping. */
export function __resetWorldPrefsForTests(): void {
  lastSeen.clear();
  reconciled.clear();
}
