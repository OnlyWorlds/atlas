/**
 * Tour world scaffolding: a fresh Hyperion demo world in this browser.
 *
 * Since 1.17 (conv. 129, contract §1.2, §2.2) the tour world is a browser
 * world like any other: made through the make protocol (`scaffoldBrowserWorld`:
 * the Web Lock, `.atlas/making`, a nonced `browser-worlds/hyperion-<id8>-<n4>`,
 * a failure removes it), registered `where: 'browser'` AND `demo: true`. No
 * folder pick, no permission prompt. `demo` (registry + world.json mirror)
 * keeps tour gestures off the waypoints and keeps the flag on rediscovery.
 * Elements are NOT written here: the tour engine reveals them step by step.
 * The tour never asks the browser to keep worlds (§2.3: Keep does).
 */

import { getState, patchSlice } from '../core/state';
import { setActiveStore } from '../core/active-store';
import { createLocalWorld, setActiveWorld, saveRegistry, updateWorldEntry } from '../registry/registry';
import { abandonBrowserMake, scaffoldBrowserWorld, releasePriorWorld } from '../setup/atlas-root-flow';
import { attachSyncEngine } from '../sync/sync-attach';
import { atlasProducer } from '../core/provenance';
import type { WorldMeta, WorldRegistryEntry } from '../core/types';

export async function scaffoldTourWorld(): Promise<{ entry: WorldRegistryEntry }> {
  const bundle = (await import('../demo/hyperion-world.json')).default as unknown as {
    world: { name: string; description?: string; time_basic_unit?: string; time_range_min?: number; time_range_max?: number; time_current?: number };
  };
  const w = bundle.world;
  const { store, worldUuid, subName, handleKey, make } = await scaffoldBrowserWorld(w.name);
  let meta: WorldMeta;
  try {
    meta = await store.writeWorldMeta({
      id: worldUuid,
      name: w.name,
      description: w.description,
      demo: true,
      // Born empty in Atlas, the tour fills it (spec §4.2's `bare`).
      producer: atlasProducer('bare'),
      time_basic_unit: w.time_basic_unit,
      time_range_min: w.time_range_min,
      time_range_max: w.time_range_max,
      time_current: w.time_current,
    });
    // The commit point (S361). `clearStageForTour` has usually released the
    // prior world already; this keeps every world-swapping flow on one rule.
    await releasePriorWorld();
  } catch (err) {
    return abandonBrowserMake(store, make, err, 'starting the tour');
  }

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

  const { next, entry: made } = createLocalWorld(getState().registry, {
    name: w.name,
    folderName: subName,
    handleKey,
    pathHint: `browser storage/${subName}`,
    demo: true,
  });
  const placed = updateWorldEntry(next, made.id, { where: 'browser' });
  const entry = placed.worlds.find(x => x.id === made.id)!;
  const activated = setActiveWorld(placed, entry.id);
  await make.finish(() => {
    saveRegistry(activated);
    patchSlice('registry', activated);
  });
  // The store first (S364 gate lens C C9): a room mounts on the `active` patch
  // (DESIGN conv. 109) and must find its world's store already there.
  setActiveStore(store);
  patchSlice('active', { worldId: entry.id, meta, opened: true });
  patchSlice('data', { elements: [] });
  patchSlice('ui', { ...getState().ui, selectedElementId: null });
  attachSyncEngine(entry, store);
  return { entry };
}
