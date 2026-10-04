/**
 * Route 2 from the app (S367): link a local world to an existing api world.
 * `mergeLocalIntoApi` owns the disk and the server; this owns what needs the
 * app, in the order the re-key run taught (`sync/rekey-run.ts`):
 *
 *   the id-move single flight (one id move app-wide; the live folder and
 *     activation recovery stand down while it is held, a pass in flight is
 *     waited out)
 *   → the app `inert` (no keyboard reaches a button behind the locked modal)
 *   → every room's pending save flushed (rooms hold ids in memory)
 *   → the guard only the app can check (an open zone edit)
 *   → the merge: plan, the journaled kernel, then the server phase; the
 *     screen follows the disk the moment ids move (`rekeyLiveUi`)
 *   → on a kernel failure: once more as recovery from its journal, then the
 *     merge again (every element now matches by id); a second failure
 *     leaves the journal, the world local-only, and Settings says what to do
 *   → the caller's link step (registry, world.json, the engine), still inside
 *     the lock, so no live pass sees a half-linked world
 *   → the element list reloaded from disk, on every exit once the folder
 *     changed (a throw after the kernel included, gate B1).
 *
 * Nothing moves in the registry, the URL or the element list before the
 * kernel runs, so a refusal or a failure before it leaves the app as it was
 * (lane A H7: the old route moved the UI in its match phase).
 */
import { getState, patchSlice } from '../core/state';
import type { FolderStore } from '../store/folder-store';
import { recoverRekey, RekeyRefusedError } from '../store/rekey';
import { flushBeforeLeavingWorld } from '../core/leave-flush';
import { hasPendingZoneEdit } from '../tabs/right/zone-edit-mode';
import { isZoneGestureActive } from '../core/zone-gesture';
import { mergeLocalIntoApi, MergeRefusedError, type MergePolicy, type MergeProgress, type MergeResult } from './make-online';
import { withIdMoveLock, rekeyPersistedState, rekeyLiveUi } from './rekey-run';
import type { OwApiClient } from './sync-engine';

export { MergeRefusedError };

/** Said when the id move stopped and could not be finished in this run. */
export const LINK_STOPPED_LINE = 'Linking stopped part way, before anything was uploaded. In Settings, under This world, use Finish it, then run Make online again with the same key.';

/** The app behind the modal: inert for the run, restored on every exit. */
function appRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.atlas-shell');
}

export interface Route2RunOpts {
  store: FolderStore;
  worldId: string;
  adapter: OwApiClient;
  policy: MergePolicy;
  matchByName: boolean;
  onProgress?: (p: MergeProgress) => void;
  /** Registry, world.json and the engine: runs inside the lock after a merge that returned. */
  link: (result: MergeResult) => Promise<void>;
}

export function runRoute2(opts: Route2RunOpts): Promise<MergeResult> {
  return withIdMoveLock(async () => {
    const root = appRoot();
    root?.setAttribute('inert', '');
    // Set once the folder has changed (ids moved, or the server phase began):
    // from then on every exit reloads the element list, success or not, so a
    // throw after the kernel never leaves downloads and creates off screen
    // (S367 gate B1). Before it, a failure leaves the list untouched (inv. 8).
    let diskTouched = false;
    try {
      await flushBeforeLeavingWorld();
      if (isZoneGestureActive() || hasPendingZoneEdit(opts.worldId)) {
        throw new MergeRefusedError('Finish editing the zone first.');
      }
      const run = () => mergeLocalIntoApi(opts.store, opts.adapter, opts.policy, {
        matchByName: opts.matchByName,
        onProgress: p => {
          if (p.phase === 'apply') diskTouched = true;
          opts.onProgress?.(p);
        },
        worldId: opts.worldId,
        rekeyPersistedState,
        onRekeyed: map => { diskTouched = true; return rekeyLiveUi(opts.store, opts.worldId, map); },
      });
      let result: MergeResult;
      try {
        result = await run();
      } catch (err) {
        if (err instanceof MergeRefusedError || err instanceof RekeyRefusedError) throw err;
        if (!(await opts.store.hasRekeyJournal())) throw err;
        // The kernel stopped with its journal on disk and the server
        // untouched. Finish it from the journal, then merge again: every
        // renamed element now carries its server id and matches by id.
        console.warn('[atlas:make-online] the id move failed, finishing it from its journal', err);
        let recovered: Awaited<ReturnType<typeof recoverRekey>>;
        try {
          recovered = await recoverRekey(opts.store, { rekeyPersistedState });
        } catch (again) {
          // Twice stopped: the journal stays and the server was never
          // touched. The raw error says nothing a user can act on (gate B3).
          console.warn('[atlas:make-online] finishing the id move failed too', again);
          throw new MergeRefusedError(LINK_STOPPED_LINE);
        }
        if (!recovered) throw err;
        diskTouched = true;
        await rekeyLiveUi(opts.store, opts.worldId, recovered.map);
        result = await run();
        // The first run's moves, and the files it could not rewrite, are part
        // of this link's story too (S367 gate B2).
        result = {
          ...result,
          rekeyed: new Map([...recovered.map, ...result.rekeyed]),
          unrewritten: [...new Set([...recovered.unrewritten, ...result.unrewritten])],
        };
      }
      await opts.link(result);
      // Linked: nothing this route uploaded is waiting for a rerun (gate A3).
      await opts.store.updateSyncState(() => ({ route2_created: undefined }));
      return result;
    } finally {
      if (diskTouched) {
        try {
          patchSlice('data', { elements: await opts.store.listElements() });
        } catch (err) {
          console.warn('[atlas:make-online] refresh after the merge failed:', err);
        }
      }
      root?.removeAttribute('inert');
    }
  });
}

/**
 * The toast's line about names left unmatched (Captain's ruling: skip and
 * say so). First three names, the rest counted; nothing persisted.
 */
export function ambiguousLine(ambiguous: MergeResult['ambiguous']): string | null {
  if (ambiguous.length === 0) return null;
  const names = ambiguous.slice(0, 3).map(a => a.name || 'unnamed');
  const rest = ambiguous.length - names.length;
  const list = names.join(', ') + (rest > 0 ? ` and ${rest} more` : '');
  return `${ambiguous.length === 1 ? 'One name was' : `${ambiguous.length} names were`} not matched because more than one element has it (${list}): each stays its own element`;
}

/**
 * The toast's line about maps and zones left unmatched because the local and
 * the online one both have pins or markers on them (gate A4/A5, Captain's
 * ruling 2026-10-04). Same shape as `ambiguousLine`.
 */
export function childClashLine(clashes: MergeResult['childClashes']): string | null {
  if (clashes.length === 0) return null;
  const names = clashes.slice(0, 3).map(c => c.name || 'unnamed');
  const rest = clashes.length - names.length;
  const list = names.join(', ') + (rest > 0 ? ` and ${rest} more` : '');
  const one = clashes.length === 1;
  const maps = clashes.every(c => c.type === 'map');
  const zones = clashes.every(c => c.type === 'zone');
  const noun = maps ? (one ? 'map' : 'maps') : zones ? (one ? 'zone' : 'zones') : 'maps and zones';
  const head = one ? `One ${noun} was` : `${clashes.length} ${noun} were`;
  const children = zones ? 'markers' : 'pins or markers';
  const sides = one ? 'the local and the online one both have' : 'the local and the online ones both have';
  return `${head} not matched because ${sides} ${children} on ${one ? 'it' : 'them'} (${list}): each stays its own element`;
}
