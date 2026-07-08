/**
 * The bundled sample world (Bout DEMO, workplan D10) — Moppetopia as a
 * shipped JSON snapshot, turned into a LOCAL-ONLY world through the normal
 * import engine (Mode A). First contact never depends on a server.
 *
 * - With an atlas root: the sample becomes a real folder world like any other.
 * - On true first launch (no root picked yet): it scaffolds under OPFS —
 *   zero folder pick, zero permission prompt. "Make it yours" = pick a real
 *   atlas folder later and use Import & export to move it (fast-follow:
 *   a one-click move).
 * - The snapshot is versioned with releases; refresh it by re-running the
 *   session-248 build script against the source world.
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
import type { WorldRegistryEntry } from '../core/types';

export const SAMPLE_WORLD_NAME = 'Moppetopia (sample)';

/** The already-created sample world, if any (match by name — atlas-local). */
export function existingSampleWorld(): WorldRegistryEntry | undefined {
  return getState().registry.worlds.find(w => w.name === SAMPLE_WORLD_NAME);
}

/**
 * Create (and activate) the sample world. Throws with a user-readable message
 * on failure. The 292KB snapshot loads lazily — it never rides the main chunk.
 */
export async function createSampleWorld(): Promise<WorldRegistryEntry> {
  const raw = (await import('./sample-world.json')).default as unknown;
  const parsed = parsePayload(raw);
  if (!parsed.ok) throw new Error(parsed.error ?? 'The sample world data did not load.');
  const plan = reconcile(parsed, [], { onConflict: 'skip', matchByName: true });
  plan.worldMeta = { ...(plan.worldMeta ?? {}), name: SAMPLE_WORLD_NAME };

  if (getState().registry.atlas_root) {
    const { entry } = await createWorldFromImportedData(plan, { demo: true });
    return entry;
  }
  // First launch — no atlas folder yet. OPFS keeps the demo zero-friction.
  const opfs = await navigator.storage.getDirectory();
  const { entry } = await createWorldFromImportedData(plan, {
    parentHandle: { handle: opfs, label: 'browser storage' },
    demo: true,
  });
  return entry;
}
