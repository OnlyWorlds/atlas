/**
 * Giving elements new ids, from the app. The kernel (`store/rekey.ts`)
 * owns the disk; this owns everything around it that needs the app:
 *
 *   hold the engine (nothing syncs, a round in flight finishes first)
 *   → flush every room's pending save (the rooms hold ids in memory)
 *   → the guards only the app can check (tour world, open zone edit, the
 *     live foreign-id set)
 *   → the kernel, with the persisted browser state migrated inside it
 *   → one live pass: elements reloaded from disk, the UI slice, the URL
 *   → release (pushes only when nothing else keeps the world offline).
 *
 * The caller shows a locked modal for the whole run: no world switch, no map
 * gesture, no typing lands between the steps (re-key gate lens 1 F1, lens 3 F12).
 */
import { getState, setState, patchSlice } from '../core/state';
import type { ElementType, WorldRegistryEntry } from '../core/types';
import type { FolderStore } from '../store/folder-store';
import { startRekey, recoverRekey, rollbackRekey, repairRekeyedLinks, staleRekeyedLinks, RekeyRefusedError, type RekeyResult, type RekeyHooks } from '../store/rekey';
import { flushBeforeLeavingWorld } from '../core/leave-flush';
import { settleLivePass, remapDiskNoticeIds } from '../core/live-folder';
import { getCurrentSyncEngine, getCurrentSyncWorldId } from './sync-attach';
import { liveForeignIds } from './foreign-ids';
import { rekeyRouteHash } from './rekey-route';
import { readTourState, remapTourReturnHash } from '../tour/tour-engine';
import { hasPendingZoneEdit } from '../tabs/right/zone-edit-mode';
import { isZoneGestureActive } from '../core/zone-gesture';
import { disposeMapTab } from '../tabs/right/map-tab';
import { remapCollapsedMapIds } from '../tabs/right/map-index-tab';
import { rekeyRegistryEntry, saveRegistry } from '../registry/registry';
import { remapPersistedTabs } from '../tabs/right/right-tabs-persistence';
import { remapCameraStates } from '../core/map-camera-persist';
import { remapMapViewPrefs } from '../core/map-view-prefs';
import { remapRecents } from '../middle/writing-workspace-recents';
import { remapDraftStash } from '../middle/knowledge-room';

export { RekeyRefusedError };

/**
 * One id update at a time, app-wide: the locked modal
 * stops the mouse, not a keyboard Enter on a button behind it, a hash change
 * that re-activates the world (whose recovery would then run beside the live
 * run), or Finish/Discard on a Settings row re-rendered mid-run.
 */
let running = false;
async function singleFlight<T>(work: () => Promise<T>): Promise<T> {
  if (running) throw new RekeyRefusedError('An id update is already running.');
  running = true;
  try {
    // Taking the flag stops every new live-folder pass; one already running
    // could still land a pre-move element list over ours (lane B N2).
    await settleLivePass();
    return await work();
  } finally {
    running = false;
    // Surfaces that hid "did not finish" while the run owned the journal
    // re-read it now (Settings' row among them).
    window.dispatchEvent(new CustomEvent(ID_MOVE_SETTLED_EVENT));
  }
}

/** Fired when an id move (re-key or Route 2) lets go of the single flight, however it ended. */
export const ID_MOVE_SETTLED_EVENT = 'atlas:id-move-settled';

/**
 * The same single flight for Route 2 (`sync/make-online-run.ts`), which moves
 * ids too: one id move at a time app-wide, and `isRekeyRunning()` answers for
 * both, so the live folder and activation recovery stand down for either.
 */
export function withIdMoveLock<T>(work: () => Promise<T>): Promise<T> {
  return singleFlight(work);
}

export function isRekeyRunning(): boolean {
  return running;
}

/** The elements this world could re-key right now: recorded foreign, still here, never synced. */
export async function foreignIdsFor(
  store: FolderStore,
  entry: WorldRegistryEntry,
): Promise<Array<{ id: string; type: ElementType }>> {
  if (entry.state !== 'api-linked' || !entry.api || entry.api.read_only) return [];
  // The shown world's elements are already in memory; listing a 12k world from
  // the store clones every body, and Settings asks on every render (lens C F4).
  const elements = getState().active?.worldId === entry.id ? getState().data.elements : await store.listElements();
  return liveForeignIds((await store.readSyncState()).foreign, entry.api.world_id, elements);
}

/**
 * Step 6p: browser state that names old ids, for one world. Runs inside the
 * kernel (both the live run and recovery at activation), BEFORE the old
 * elements are removed, so no crash point leaves a stored route or tab on a
 * deleted element (lens 1 F8, lens 3 F11).
 */
export function rekeyPersistedState(worldId: string, map: ReadonlyMap<string, string>): void {
  const reg = getState().registry;
  const next = rekeyRegistryEntry(reg, worldId, map);
  if (next !== reg) {
    saveRegistry(next);
    patchSlice('registry', next);
  }
  remapPersistedTabs(worldId, map);
  remapCameraStates(map);
  remapMapViewPrefs(worldId, map);
  remapCollapsedMapIds(worldId, map);
  remapRecents(worldId, map);
  remapDraftStash(worldId, map);
  remapTourReturnHash(worldId, map);
}

/**
 * Step 7: the screen follows, in ONE state change. Elements come back from
 * disk (never a graft of the old entry under the new id: lens 3 F7 found that
 * doubles an element and leaves every referrer naming the old id in memory).
 * An open map tab on a re-keyed map is disposed first so its Leaflet
 * instance and handlers bound to the old id do not leak (lens 3 F10).
 */
export async function rekeyLiveUi(store: FolderStore, worldId: string, map: ReadonlyMap<string, string>): Promise<void> {
  if (map.size === 0) return;
  const before = getState();
  if (before.active?.worldId !== worldId) return;
  for (const tab of before.ui.rightTabs) {
    if (tab.kind === 'map' && map.has(tab.mapId)) disposeMapTab(tab.mapId);
  }
  const elements = await store.listElements();
  const cur = getState();
  if (cur.active?.worldId !== worldId) return;
  const sw = (id: string | null | undefined) => (id && map.get(id)) || id;
  // Not app state: the live folder's marks, kept per world beside it.
  remapDiskNoticeIds(worldId, map);
  const ui = cur.ui;
  setState({
    ...cur,
    data: { ...cur.data, elements },
    ui: {
      ...ui,
      selectedElementId: sw(ui.selectedElementId) ?? null,
      rightTabs: ui.rightTabs.map(t => (t.kind === 'map' && map.has(t.mapId) ? { ...t, mapId: map.get(t.mapId)! } : t)),
      pinPlacement: ui.pinPlacement ? { elementId: sw(ui.pinPlacement.elementId)! } : null,
      knowledgeLens: ui.knowledgeLens ? { knowerId: sw(ui.knowledgeLens.knowerId)! } : null,
    },
  });
  const next = rekeyRouteHash(window.location.hash, worldId, map);
  if (next) window.location.replace(next);
  window.dispatchEvent(new CustomEvent('atlas:charts-changed'));
}

/**
 * Give this world's foreign elements new ids. Throws `RekeyRefusedError`
 * (plain, user-readable) when a guard refuses, having touched nothing.
 */
export function giveForeignElementsNewIds(opts: {
  store: FolderStore;
  entry: WorldRegistryEntry;
  onProgress?: (done: number, total: number) => void;
  /** 'waiting' while a sync round in flight finishes; 'running' once the world is held. */
  onStage?: (stage: 'waiting' | 'running') => void;
}): Promise<RekeyResult> {
  return singleFlight(() => giveUnlocked(opts));
}

async function giveUnlocked(opts: Parameters<typeof giveForeignElementsNewIds>[0]): Promise<RekeyResult> {
  const { store, entry } = opts;
  const engine = getCurrentSyncWorldId() === entry.id ? getCurrentSyncEngine() : null;
  opts.onStage?.('waiting');
  const release = engine ? await engine.hold('rekey') : () => {};
  opts.onStage?.('running');
  try {
    await flushBeforeLeavingWorld();
    // Per world, never the device-wide tour flag (lens 3 F5).
    if (entry.demo === true || readTourState()?.worldId === entry.id) {
      throw new RekeyRefusedError('The tour world keeps its ids.');
    }
    if (isZoneGestureActive() || hasPendingZoneEdit(entry.id)) {
      throw new RekeyRefusedError('Finish editing the zone first.');
    }
    const foreign = await foreignIdsFor(store, entry);
    if (foreign.length === 0) throw new RekeyRefusedError('Nothing here needs a new id.');
    const hooks: RekeyHooks = { onProgress: opts.onProgress, rekeyPersistedState };
    let result: RekeyResult;
    try {
      result = await startRekey(store, { worldId: entry.id, ids: foreign.map(f => f.id) }, hooks);
    } catch (err) {
      if (err instanceof RekeyRefusedError || !(await store.hasRekeyJournal())) throw err;
      // Retry once as recovery; a second failure leaves the journal (sync
      // stays shut) and Settings offers to finish it (lens 1 F3).
      console.warn('[atlas:rekey] run failed, retrying from its journal', err);
      const recovered = await recoverRekey(store, hooks);
      if (!recovered) throw err;
      result = recovered;
    }
    await rekeyLiveUi(store, entry.id, result.map);
    return result;
  } finally {
    release();
  }
}

/**
 * Keep the tour world, step K3 (1.17, contract §7.3, §7.4): give every bundle
 * element still in this world a new id, so the kept world shares none with the
 * live demo world or a later tour. `giveUnlocked`'s discipline without its two
 * refusals (the world is still the tour's while this runs, and a local-only
 * world has no foreign ids). `bundleIds` is the tour bundle's; only the ones
 * this world's own store holds are moved (a user may have deleted some).
 * Resumable: a journal left by an earlier run is finished first, then the rest
 * move, so a second call after a crash or a refusal ends in the same world.
 */
export function giveTourWorldNewIds(opts: {
  store: FolderStore;
  entry: WorldRegistryEntry;
  bundleIds: ReadonlySet<string>;
  onProgress?: (done: number, total: number) => void;
  /**
   * Told the files that kept old links as soon as the journal is done, before
   * the screen pass: a throw after that point still reaches the caller's
   * toast.
   */
  onRekeyed?: (result: RekeyResult) => void;
}): Promise<RekeyResult> {
  return singleFlight(async () => {
    const { store, entry } = opts;
    await flushBeforeLeavingWorld();
    if (isZoneGestureActive() || hasPendingZoneEdit(entry.id)) {
      throw new RekeyRefusedError('Finish editing the zone first.');
    }
    const hooks: RekeyHooks = { onProgress: opts.onProgress, rekeyPersistedState };
    let earlier: string[] = [];
    if (await store.hasRekeyJournal()) {
      const recovered = await recoverRekey(store, hooks);
      if (recovered) {
        earlier = recovered.unrewritten;
        opts.onRekeyed?.(recovered);
        await rekeyLiveUi(store, entry.id, recovered.map);
      }
      if (await store.hasRekeyJournal()) throw new RekeyRefusedError('An earlier id update in this world is unfinished. Finish it first.');
    }
    const ids = (await store.listElements()).map(e => e.id).filter(id => opts.bundleIds.has(id));
    const run = await startRekey(store, { worldId: entry.id, ids }, hooks);
    const result = { ...run, unrewritten: [...new Set([...earlier, ...run.unrewritten])] };
    opts.onRekeyed?.(result);
    await rekeyLiveUi(store, entry.id, result.map);
    return result;
  });
}

/** Finish an interrupted re-key (Settings' Retry, and activation's automatic pass). */
export function finishInterruptedRekey(store: FolderStore, worldId: string): Promise<RekeyResult | null> {
  return singleFlight(async () => {
    const engine = getCurrentSyncWorldId() === worldId ? getCurrentSyncEngine() : null;
    const release = engine ? await engine.hold('rekey') : () => {};
    try {
      const result = await recoverRekey(store, { rekeyPersistedState });
      if (result) await rekeyLiveUi(store, worldId, result.map);
      return result;
    } finally {
      release();
    }
  });
}

/**
 * Settings' Discard: UNDO an interrupted re-key (gate lens A F6). Pairs that
 * had finished stay finished; the rest go back to their old ids, with every
 * link that had moved. Only a journal that will not parse (nothing to act on)
 * is forgotten outright: `forget: true`.
 */
export function discardInterruptedRekey(
  store: FolderStore,
  worldId: string,
  opts: { forget?: boolean } = {},
): Promise<{ restored: number; kept: number } | null> {
  return singleFlight(async () => {
    if (opts.forget) {
      await store.clearRekeyJournal();
      return null;
    }
    const engine = getCurrentSyncWorldId() === worldId ? getCurrentSyncEngine() : null;
    const release = engine ? await engine.hold('rekey') : () => {};
    try {
      const r = await rollbackRekey(store, { rekeyPersistedState });
      const elements = await store.listElements();
      const cur = getState();
      if (cur.active?.worldId === worldId) setState({ ...cur, data: { ...cur.data, elements } });
      return r;
    } finally {
      release();
    }
  });
}

/** How many elements still link to an id a finished re-key replaced. */
export async function staleLinkCount(store: FolderStore): Promise<number> {
  const rekeyed = (await store.readSyncState()).rekeyed;
  if (!rekeyed) return 0;
  return staleRekeyedLinks(await store.listElements(), rekeyed).length;
}

/** Point them at the new ids (Settings' "Update links"). */
export function repairStaleLinks(store: FolderStore): Promise<string[]> {
  return singleFlight(async () => {
    const fixed = await repairRekeyedLinks(store);
    const elements = await store.listElements();
    const cur = getState();
    setState({ ...cur, data: { ...cur.data, elements } });
    return fixed;
  });
}

/** Whether the re-keyed elements will go up now: an engine attached, not paused, not in error. */
export function willUploadNow(worldId: string): boolean {
  const engine = getCurrentSyncWorldId() === worldId ? getCurrentSyncEngine() : null;
  if (!engine || engine.isPaused()) return false;
  return engine.getState().kind !== 'error';
}

/** Plain count copy, shared by the Settings line and the toast. */
export function elementsWord(n: number): string {
  return `${n} ${n === 1 ? 'element' : 'elements'}`;
}
