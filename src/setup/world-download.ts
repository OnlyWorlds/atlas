/**
 * Download the whole world as one file (1.17 bout 5, conv. 129; contract
 * §5.1, §9 invariant 13; S370 gate lens A A9, A11, lens B B9, B12).
 *
 * The file is the portable copy (`store/world-file.ts`): every file of the
 * world except the OnlyWorlds link and its key, the sync files and anything
 * transient. A linked world first pushes once (online), so the file holds
 * what the server holds, then holds sync for the walk. The walk is taken
 * twice: a world that changed while the file was made (a file added, changed
 * or unreadable mid-walk: gate A11, B9) is refused, never handed over torn.
 *
 * Where it goes is chosen INSIDE the click (`pickSaveTarget`): the save
 * picker on Chromium (the file is written where the user said), else a Blob
 * handed to the browser's own download (Atlas cannot know it was kept).
 */

import { getState, patchSlice } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { flushBeforeLeavingWorld } from '../core/leave-flush';
import { PlainError } from '../core/plain-error';
import { worldHandleFor } from '../core/browser-worlds';
import { hasFolderMode } from '../core/capabilities';
import { saveRegistry, updateWorldEntry } from '../registry/registry';
import { worldFileName, WORLD_FILE_MAX_BYTES } from '../store/world-tree';
import { getCurrentSyncEngine, getCurrentSyncWorldId } from '../sync/sync-attach';
import type { WorldRegistryEntry } from '../core/types';

export const TORN_LINE = 'The world changed while its file was being made. Try again.';
const TOUR_LINE = 'The tour world can be downloaded once you keep it at the end of the tour.';

/** Where the file goes, chosen inside the click. */
export interface SaveTarget {
  kind: 'picker' | 'blob' | 'test';
  write(name: string, bytes: Uint8Array): Promise<void>;
}

type SavePicker = (opts: { suggestedName: string; types?: unknown[] }) => Promise<FileSystemFileHandle>;

/**
 * Ask where to save, inside the click (the save picker needs the gesture).
 * `null`: the user cancelled. Without the picker the file goes to the
 * browser's own downloads.
 */
export async function pickSaveTarget(suggestedName: string): Promise<SaveTarget | null> {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (typeof picker !== 'function') return blobTarget();
  let handle: FileSystemFileHandle;
  try {
    handle = await picker({ suggestedName, types: [{ description: 'World file', accept: { 'application/zip': ['.zip'] } }] });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return null;
    throw err;
  }
  return {
    kind: 'picker',
    async write(_name, bytes) {
      const w = await handle.createWritable();
      try {
        await w.write(bytes as unknown as BufferSource);
        await w.close();
      } catch (err) {
        await w.abort().catch(() => {});
        throw err;
      }
    },
  };
}

function blobTarget(): SaveTarget {
  return {
    kind: 'blob',
    async write(name, bytes) {
      const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // The browser reads the Blob after the click returns: revoke later.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  };
}

/** The file's name, known before any work: the save picker suggests it inside the click. */
export function downloadName(world: WorldRegistryEntry, now = new Date()): string {
  const id = String((getState().active?.worldId === world.id ? getState().active?.meta?.id : undefined) ?? world.id);
  return worldFileName(world.name, id, now).file;
}

/**
 * Make the world file and hand it to `target`. Refusals and a torn walk throw
 * a `PlainError`; nothing is handed over unless the two walks agree.
 */
export async function downloadWorld(world: WorldRegistryEntry, target: SaveTarget, opts: { now?: Date; maxBytes?: number } = {}): Promise<{ file: string }> {
  if (world.demo === true) throw new PlainError(TOUR_LINE);
  const active = getState().active;
  const store = getActiveStore();
  if (active?.worldId !== world.id || !store) throw new PlainError('Open this world first, then download it.');
  if (await store.hasRekeyJournal()) {
    throw new PlainError('An id update in this world did not finish. Finish it in Settings, under This world, then download the world.');
  }
  const ws = await import('../store/world-file');
  const { file, dir } = worldFileName(world.name, String(active.meta?.id ?? world.id), opts.now);

  // A linked world: what is waiting goes up first (online), then sync holds
  // for the walk (a push mid-walk would rewrite stamps under it).
  const engine = getCurrentSyncWorldId() === world.id ? getCurrentSyncEngine() : null;
  if (engine && !engine.isPaused() && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
    await engine.pushOnce().catch(err => console.warn('[atlas:download] push before the download failed', err)); // raw-error-ok: a console record
  }
  const release = engine ? await engine.hold('download') : () => {};
  try {
    await flushBeforeLeavingWorld();
    const where = await worldHandleFor(world);
    if (where.kind !== 'ok') throw new PlainError('Atlas cannot reach this world\'s files right now. Open it again from the sidebar, then download it.');
    let bytes: Uint8Array;
    try {
      const collected = await ws.collectWorldFiles(where.handle);
      // A file no Atlas could open again is never handed over, on any target
      // (S373 gate F4): the reader's budget is the uncompressed size.
      if (collected.reduce((n, f) => n + f.data.byteLength, 0) > (opts.maxBytes ?? WORLD_FILE_MAX_BYTES)) {
        throw new PlainError(hasFolderMode()
          ? 'This world is too big for one file. Move it to a folder instead.'
          : 'This world is too big to download in this browser.');
      }
      bytes = ws.zipWorld(collected, dir);
      if (!ws.sameStamps(collected, await ws.portableStamps(where.handle))) throw new PlainError(TORN_LINE);
    } catch (err) {
      if (err instanceof PlainError) throw err;
      // A file that changed or vanished under the walk reads as a refused
      // snapshot (Chromium NotReadableError, Firefox AbortError): the same
      // case, never a disk-busy sentence (gate B9).
      const name = (err as { name?: string })?.name;
      if (name === 'NotReadableError' || name === 'AbortError' || name === 'NotFoundError') throw new PlainError(TORN_LINE);
      throw err;
    }
    await target.write(file, bytes);
  } finally {
    release();
  }
  const next = updateWorldEntry(getState().registry, world.id, { kept_download_at: (opts.now ?? new Date()).toISOString() });
  saveRegistry(next);
  patchSlice('registry', next);
  return { file };
}
