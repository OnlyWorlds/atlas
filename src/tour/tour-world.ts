/**
 * Tour world scaffolding — a fresh OPFS-backed Hyperion demo world.
 *
 * Rides `scaffoldWorldInRoot`'s OPFS parentOverride (the old Bout DEMO hook):
 * no folder pick, no permission prompt. The world registers with
 * `demo: true` (registry + world.json mirror) so tour gestures never
 * complete waypoints and rediscovery keeps the flag. Elements are NOT
 * written here — the tour engine reveals them step by step.
 */

import { getState, patchSlice } from '../core/state';
import { setActiveStore } from '../core/active-store';
import { createLocalWorld, setActiveWorld, saveRegistry } from '../registry/registry';
import { scaffoldWorldInRoot, releasePriorWorld } from '../setup/atlas-root-flow';
import { attachSyncEngine } from '../sync/sync-attach';
import type { WorldRegistryEntry } from '../core/types';
import { TOUR_FOLDER } from './tour-engine';

export async function scaffoldTourWorld(): Promise<{ entry: WorldRegistryEntry }> {
  const opfs = await navigator.storage.getDirectory();
  const { store, worldUuid, subName, handleKey } = await scaffoldWorldInRoot(
    TOUR_FOLDER,
    { handle: opfs, label: 'browser storage' },
  );
  const bundle = (await import('../demo/hyperion-world.json')).default as unknown as {
    world: { name: string; description?: string; time_basic_unit?: string; time_range_min?: number; time_range_max?: number; time_current?: number };
  };
  const w = bundle.world;
  const meta = await store.writeWorldMeta({
    id: worldUuid,
    name: w.name,
    description: w.description,
    demo: true,
    time_basic_unit: w.time_basic_unit,
    time_range_min: w.time_range_min,
    time_range_max: w.time_range_max,
    time_current: w.time_current,
  });

  // The mirror below is `writeWorldMeta`'s OWN return value, never a re-listing
  // of fields and never a second read. The first version hand-built
  // `{id, name, demo}` while this call wrote four time_* fields too, so
  // `active.meta.time_current` was undefined for the whole first run: the
  // charts step promised "a gold line marking the now: year 15" while the room
  // showed the "set now time" button and no line. It self-healed on reload
  // (activateWorld reads world.json), which is precisely why it survived — the
  // bug only existed on the path every real user takes. A read-back would work
  // too, but it can miss: `readWorldMeta` falls back to `{id:'', name:''}` when
  // world.json is unreadable, which would silently install a mirror WORSE than
  // the hand-built one it replaced (close gate, LOW).

  // The commit point (S361). `clearStageForTour` has usually released the
  // prior world already; this keeps every world-swapping flow on one rule.
  await releasePriorWorld();
  const { next, entry } = createLocalWorld(getState().registry, {
    name: w.name,
    folderName: subName,
    handleKey,
    pathHint: `browser storage/${subName}`,
    demo: true,
  });
  const activated = setActiveWorld(next, entry.id);
  saveRegistry(activated);
  patchSlice('registry', activated);
  // The store first (S364 gate lens C C9): a room mounts on the `active` patch
  // (DESIGN conv. 109) and must find its world's store already there.
  setActiveStore(store);
  patchSlice('active', { worldId: entry.id, meta, opened: true });
  patchSlice('data', { elements: [] });
  patchSlice('ui', { ...getState().ui, selectedElementId: null });
  attachSyncEngine(entry, store);
  return { entry };
}
