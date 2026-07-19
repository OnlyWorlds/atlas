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
import { scaffoldWorldInRoot } from '../setup/atlas-root-flow';
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
  await store.writeWorldMeta({
    id: worldUuid,
    name: w.name,
    description: w.description,
    demo: true,
    time_basic_unit: w.time_basic_unit,
    time_range_min: w.time_range_min,
    time_range_max: w.time_range_max,
    time_current: w.time_current,
  });

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
  patchSlice('active', { worldId: entry.id, meta: { id: worldUuid, name: w.name, demo: true }, opened: true });
  setActiveStore(store);
  patchSlice('data', { elements: [] });
  patchSlice('ui', { ...getState().ui, selectedElementId: null });
  attachSyncEngine(entry, store);
  return { entry };
}
