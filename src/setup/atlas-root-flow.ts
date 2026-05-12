/**
 * Atlas-root setup and world-in-root creation flows.
 *
 * The atlas root is a single user-chosen folder that contains all atlas-managed
 * worlds. Setting it up is a one-time step (per browser profile); after that,
 * `[ + create local ]` becomes a name-only modal that creates a subfolder under
 * the root and registers it.
 *
 * Existing worlds created via per-world picker keep working — they have their
 * own handles in the vault. The root is a *creation default*, not a registry
 * of where existing worlds live.
 */

import {
  ATLAS_ROOT_HANDLE_KEY,
  ATLAS_ROOT_MARKER,
  ATLAS_ROOT_SUBFOLDER,
  ATLAS_ROOT_SUBFOLDER_LEGACY_NAMES,
} from '../core/constants';
import { getState, patchSlice } from '../core/state';
import { pickDirectory } from '../ui/directory-picker';
import { storeHandle, loadHandle, ensureWritable } from '../store/handle-vault';
import {
  setAtlasRoot,
  createLocalWorld,
  setActiveWorld,
  saveRegistry,
} from '../registry/registry';
import { FsFolderStore } from '../store/folder-store-fs';
import { newId } from '../store/folder-store';
import { writeJsonAtomic, readJson, tryGetDir, isNotFound } from '../store/fs-utils';
import { getActiveStore, setActiveStore } from '../ui/create-world-modal';
import type { WorldRegistryEntry } from '../core/types';

/**
 * Prompt the user to pick the atlas root folder. On success: resolve the
 * actual root (may be a subfolder of the pick), write a marker, persist the
 * handle, update registry + state.
 *
 * Re-use logic (matches typical "library folder" conventions):
 * 1. If the picked folder ALREADY has `.atlas-root` → use it directly (returning user).
 * 2. Else if it contains `atlas-worlds/` with `.atlas-root` inside → use that subfolder.
 * 3. Else create `atlas-worlds/` inside the pick, mark it, use it.
 *
 * Returns true if a root was set; false if the user cancelled.
 */
export interface SetupAtlasRootResult {
  imported: number;
}

export async function setupAtlasRoot(): Promise<SetupAtlasRootResult | null> {
  const picked = await pickDirectory();
  if (!picked) return null;

  const granted = await ensureWritable(picked);
  if (!granted) {
    throw new Error('folder is read-only — atlas needs write access');
  }

  const rootHandle = await resolveOrCreateRoot(picked);

  // Persist handle under the fixed key.
  await storeHandle(ATLAS_ROOT_HANDLE_KEY, rootHandle);

  // Update registry + state.
  const pathHint = rootHandle.name === picked.name ? picked.name : `${picked.name}/${rootHandle.name}`;
  const nextRegistry = setAtlasRoot(getState().registry, {
    handleKey: ATLAS_ROOT_HANDLE_KEY,
    folderName: rootHandle.name,
    pathHint,
  });
  saveRegistry(nextRegistry);
  patchSlice('registry', nextRegistry);
  patchSlice('atlasRoot', { folderName: rootHandle.name, pathHint });

  // Scan the root for existing world subfolders that aren't in the registry yet.
  // Important when the user picked an existing atlas root after clearing
  // localStorage, or when sharing a folder across devices.
  let imported = 0;
  try {
    const result = await discoverWorldsInRoot(rootHandle, pathHint);
    imported = result.imported;
  } catch (err) {
    console.warn('[atlas-root] world discovery failed:', err);
  }
  return { imported };
}

/**
 * Scan an atlas root for world subfolders and import any that aren't already
 * tracked. A "world folder" is detected by the presence of a readable
 * `world.json` with id + name.
 *
 * Uses `handle.isSameEntry` against existing registry handles to avoid
 * importing the same folder twice if the user is just re-confirming setup.
 */
export async function discoverWorldsInRoot(
  rootHandle: FileSystemDirectoryHandle,
  rootPathHint: string
): Promise<{ imported: number }> {
  let imported = 0;
  const existingHandles = await Promise.all(
    getState().registry.worlds.map(w => loadHandle(w.folder.handle_key))
  );

  for await (const entry of (rootHandle as any).values()) {
    if (entry.kind !== 'directory') continue;
    if (entry.name.startsWith('.')) continue; // skip .atlas etc.
    const folderHandle = entry as FileSystemDirectoryHandle;

    // Already tracked? Same on-disk folder as some registered world?
    let alreadyTracked = false;
    for (const existing of existingHandles) {
      if (!existing) continue;
      try {
        if (await folderHandle.isSameEntry(existing)) { alreadyTracked = true; break; }
      } catch { /* isSameEntry can throw on cross-origin handles; treat as not-same */ }
    }
    if (alreadyTracked) continue;

    // Is this an atlas world folder? Read world.json.
    let meta: { id?: string; name?: string } | null = null;
    try {
      meta = await readJson<{ id?: string; name?: string }>(folderHandle, 'world.json');
    } catch (err) {
      if (!isNotFound(err)) console.warn(`[discover] read ${entry.name}/world.json:`, err);
      continue;
    }
    if (!meta || typeof meta.id !== 'string' || typeof meta.name !== 'string') continue;

    // Adopt: store handle, register, push to state.
    const handleKey = `world-${meta.id}`;
    await storeHandle(handleKey, folderHandle);
    const reg = getState().registry;
    const { next } = createLocalWorld(reg, {
      name: meta.name,
      folderName: entry.name,
      handleKey,
      pathHint: `${rootPathHint}/${entry.name}`,
    });
    saveRegistry(next);
    patchSlice('registry', next);
    imported++;
  }
  return { imported };
}

/**
 * Given a user-picked folder, return the handle to the actual atlas root.
 * Either picked itself (already a root), an existing wrapper subfolder
 * (current or legacy name), or a freshly-created wrapper.
 */
async function resolveOrCreateRoot(picked: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  // Case 1: picked is already an atlas root.
  if (await hasAtlasRootMarker(picked)) {
    return picked;
  }
  // Case 2a: picked contains the current wrapper that's already a root.
  const currentChild = await tryGetDir(picked, [ATLAS_ROOT_SUBFOLDER]);
  if (currentChild && await hasAtlasRootMarker(currentChild)) {
    return currentChild;
  }
  // Case 2b: picked contains a legacy-named wrapper that's already a root.
  // Don't rename it on disk — users have file watchers, backups, registry handles
  // pointing at it. Just use it where it is.
  for (const legacyName of ATLAS_ROOT_SUBFOLDER_LEGACY_NAMES) {
    const legacyChild = await tryGetDir(picked, [legacyName]);
    if (legacyChild && await hasAtlasRootMarker(legacyChild)) {
      return legacyChild;
    }
  }
  // Case 3: create the wrapper with the current name.
  const newChild = await picked.getDirectoryHandle(ATLAS_ROOT_SUBFOLDER, { create: true });
  await writeJsonAtomic(newChild, ATLAS_ROOT_MARKER, {
    version: 1,
    created_at: new Date().toISOString(),
  });
  return newChild;
}

async function hasAtlasRootMarker(dir: FileSystemDirectoryHandle): Promise<boolean> {
  const marker = await readJson<unknown>(dir, ATLAS_ROOT_MARKER);
  return marker !== null;
}

/**
 * Try to recover the atlas root on app boot. If the registry says we have one
 * and the vault still has a handle for it, push the runtime ref into state.
 *
 * Does NOT re-grant permission here (no user gesture available at boot).
 * Permission is requested lazily on first use (creating a world inside it).
 */
export async function hydrateAtlasRoot(): Promise<void> {
  const reg = getState().registry;
  if (!reg.atlas_root) {
    patchSlice('atlasRoot', null);
    return;
  }
  const handle = await loadHandle(reg.atlas_root.handle_key);
  if (!handle) {
    patchSlice('atlasRoot', null);
    return;
  }
  patchSlice('atlasRoot', {
    folderName: reg.atlas_root.folder_name,
    pathHint: reg.atlas_root.path_hint,
  });
}

/**
 * Create a new local world INSIDE the configured atlas root.
 *
 * - Slug the name + append a short uuid for the subfolder name.
 * - Open the subfolder via `getDirectoryHandle(slug, { create: true })`.
 * - Store the world's own handle in the vault (independent of the root handle).
 * - Open FsFolderStore, write world.json, register, activate.
 *
 * Throws if no atlas root is configured.
 */
export async function createWorldInRoot(name: string): Promise<{ entry: WorldRegistryEntry }> {
  const reg = getState().registry;
  if (!reg.atlas_root) {
    throw new Error('atlas root is not set up — pick a folder first');
  }
  const rootHandle = await loadHandle(reg.atlas_root.handle_key);
  if (!rootHandle) {
    throw new Error('atlas root handle is missing from the vault — re-pick it from settings');
  }
  // Re-grant permission on the root (user gesture at click-time is acceptable here).
  const granted = await ensureWritable(rootHandle);
  if (!granted) {
    throw new Error('write permission for the atlas folder was denied');
  }

  // Close any prior active store before we open a new one.
  const prior = getActiveStore();
  if (prior) await prior.close().catch(() => {});
  setActiveStore(null);

  const trimmed = name.trim() || 'untitled world';
  const worldUuid = newId();
  const slug = slugify(trimmed);
  const subName = `${slug}-${worldUuid.slice(0, 8)}`;

  // Create the subfolder under the root.
  const worldHandle = await rootHandle.getDirectoryHandle(subName, { create: true });

  // Persist this world's own handle (so future opens don't depend on the root).
  const handleKey = `world-${worldUuid}`;
  await storeHandle(handleKey, worldHandle);

  // Open the FolderStore, write meta.
  const store = new FsFolderStore();
  await store.open(worldHandle);
  await store.writeWorldMeta({ id: worldUuid, name: trimmed });

  // Register + activate.
  const { next, entry } = createLocalWorld(reg, {
    name: trimmed,
    folderName: subName,
    handleKey,
    pathHint: `${reg.atlas_root.folder_name}/${subName}`,
  });
  const activated = setActiveWorld(next, entry.id);
  saveRegistry(activated);
  patchSlice('registry', activated);
  patchSlice('active', { worldId: entry.id, meta: { id: worldUuid, name: trimmed }, opened: true });
  setActiveStore(store);

  return { entry };
}

/**
 * Slugify a world name for use as an on-disk subfolder.
 * Lowercased, ascii-ish, hyphen-separated, length-capped, fallback `world`.
 */
export function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || 'world';
}
