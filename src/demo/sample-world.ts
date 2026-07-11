/**
 * The bundled sample world (Bout DEMO, workplan D10; Sikelia since session
 * 254) — Captain's ancient-Sicily world as a shipped JSON snapshot, turned
 * into a LOCAL-ONLY world through the normal import engine (Mode A). First
 * contact never depends on a server.
 *
 * - With an atlas root: the sample becomes a real folder world like any other.
 * - On true first launch (no root picked yet): it scaffolds under OPFS —
 *   zero folder pick, zero permission prompt. "Make it yours" = pick a real
 *   atlas folder later and use Import & export to move it (fast-follow:
 *   a one-click move).
 * - The map background ships as a bundled webp (full-resolution recompress of
 *   the source art) and is attached through the normal media path (addMedia
 *   'base-image' → image_media_id), so the demo folder is self-contained.
 * - The snapshot is versioned with releases; regenerate from
 *   Forge/Notes/sikelia/ (generate_world.py) + the session-254 trim step.
 *
 * ⚠ Bout OW contract (workplan D11c): everything this module creates counts
 * as DEMO-origin — waypoint action-hooks never fire from it. Implemented via
 * `demo: true` below (world.json + registry); `src/core/waypoints.ts` gates
 * world-data waypoints on the active world's demo flag. Contract doc:
 * Forge/Notes/2026-07-07-atlas-waypoint-hookmap.md.
 */

import { parsePayload } from '../import/parse';
import { reconcile } from '../import/reconcile';
import { createWorldFromImportedData } from '../setup/atlas-root-flow';
import { getState } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite } from '../sync/sync-attach';
import type { WorldRegistryEntry, WorldMap } from '../core/types';

export const SAMPLE_WORLD_NAME = 'Sikelia (sample)';

/** The island map element inside the snapshot (ids are deterministic). */
const SAMPLE_MAP_ID = 'c64ab2a5-4c8c-5d82-aa43-5ed6fa100913';

/** The already-created sample world, if any (match by name — atlas-local). */
export function existingSampleWorld(): WorldRegistryEntry | undefined {
  return getState().registry.worlds.find(w => w.name === SAMPLE_WORLD_NAME);
}

/**
 * Create (and activate) the sample world. Throws with a user-readable message
 * on failure. The snapshot (365KB) and the map image (1.5MB webp) both load
 * lazily — neither rides the main chunk.
 */
export async function createSampleWorld(): Promise<WorldRegistryEntry> {
  const raw = (await import('./sample-world.json')).default as unknown;
  const parsed = parsePayload(raw);
  if (!parsed.ok) throw new Error(parsed.error ?? 'The sample world data did not load.');
  const plan = reconcile(parsed, [], { onConflict: 'skip', matchByName: true });
  plan.worldMeta = { ...(plan.worldMeta ?? {}), name: SAMPLE_WORLD_NAME };

  let entry: WorldRegistryEntry;
  if (getState().registry.atlas_root) {
    ({ entry } = await createWorldFromImportedData(plan, { demo: true }));
  } else {
    // First launch — no atlas folder yet. OPFS keeps the demo zero-friction.
    const opfs = await navigator.storage.getDirectory();
    ({ entry } = await createWorldFromImportedData(plan, {
      parentHandle: { handle: opfs, label: 'browser storage' },
      demo: true,
    }));
  }
  await attachSampleMapImage();
  return entry;
}

/**
 * Fetch the bundled map art and attach it through the normal media path.
 * Progressive enhancement: if this fails (offline after a partial cache,
 * quota), the world still opens — the map is just blank until the user
 * attaches an image themselves.
 */
async function attachSampleMapImage(): Promise<void> {
  try {
    const store = getActiveStore();
    if (!store) return;
    const maps = (await store.listElements()).filter(e => e.id === SAMPLE_MAP_ID) as WorldMap[];
    if (!maps.length || maps[0].image_media_id) return;
    const assetUrl = new URL('./sikelia-map.webp', import.meta.url).href;
    const blob = await (await fetch(assetUrl)).blob();
    const file = new File([blob], 'sikelia-map.webp', { type: 'image/webp' });
    const media = await store.addMedia(SAMPLE_MAP_ID, file, 'base-image');
    await store.updateMap(SAMPLE_MAP_ID, { image_media_id: media.id });
    // Re-prime the state cache so the map tree / home see the image without
    // a reopen (updateMap writes the folder, not state.data).
    await refreshElementsAfterWrite(store);
  } catch (err) {
    console.warn('[sample-world] map image attach skipped:', err);
  }
}
