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
import { storeHandle, loadHandle, ensureWritable, deleteHandle } from '../store/handle-vault';
import {
  setAtlasRoot,
  createLocalWorld,
  createApiLinkedWorld,
  setActiveWorld,
  setPin,
  saveRegistry,
  findLinkedWorld,
  findWorldByServerId,
} from '../registry/registry';
import { FsFolderStore } from '../store/folder-store-fs';
import { newId } from '../store/folder-store';
import { writeJsonAtomic, readJson, tryGetDir, isNotFound } from '../store/fs-utils';
import { getActiveStore, setActiveStore } from '../core/active-store';
import { attachSyncEngine, refreshElementsAfterWrite } from '../sync/sync-attach';
import { buildV2Adapter } from '../sync/make-online';
import { initialDownloadAll, type InitialDownloadProgress } from '../sync/initial-download';
import { applyImportPlan, type ApplyProgress, type ApplyResult } from '../import/apply-import-plan';
import type { ImportPlan } from '../import/types';
import type { WorldRegistryEntry, PerElementFailure } from '../core/types';

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
    throw new Error('Folder is read-only; atlas needs write access');
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
  let seen = 0;
  let skippedDot = 0;
  let skippedNoWorldJson = 0;
  let skippedBadMeta = 0;
  let alreadyTrackedCount = 0;
  const existingHandles = await Promise.all(
    getState().registry.worlds.map(w => loadHandle(w.folder.handle_key))
  );

  for await (const entry of (rootHandle as any).values()) {
    seen++;
    if (entry.kind !== 'directory') continue;
    if (entry.name.startsWith('.')) {
      skippedDot++;
      continue;
    }
    const folderHandle = entry as FileSystemDirectoryHandle;

    // Already tracked? Same on-disk folder as some registered world?
    let alreadyTracked = false;
    for (const existing of existingHandles) {
      if (!existing) continue;
      try {
        if (await folderHandle.isSameEntry(existing)) { alreadyTracked = true; break; }
      } catch { /* isSameEntry can throw on cross-origin handles; treat as not-same */ }
    }
    if (alreadyTracked) {
      alreadyTrackedCount++;
      continue;
    }

    // Is this an atlas world folder? Read world.json.
    let meta: { id?: string; name?: string; demo?: boolean; api?: { world_id?: string; api_key?: string; world_name?: string; read_only?: boolean } } | null = null;
    try {
      meta = await readJson(folderHandle, 'world.json');
    } catch (err) {
      if (!isNotFound(err)) console.warn(`[discover] read ${entry.name}/world.json threw:`, err);
      skippedNoWorldJson++;
      continue;
    }
    if (!meta) {
      skippedNoWorldJson++;
      continue;
    }
    if (typeof meta.id !== 'string' || typeof meta.name !== 'string') {
      console.warn('[discover] bad meta in', entry.name, meta);
      skippedBadMeta++;
      continue;
    }

    // Adopt: store handle, register as local-only OR api-linked depending on
    // whether world.json carries an `api` block. Without this, recovered
    // api-linked worlds would lose their sync wiring on recovery.
    const handleKey = `world-${meta.id}`;
    await storeHandle(handleKey, folderHandle);
    const reg = getState().registry;
    const hasApi = !!(meta.api && typeof meta.api.world_id === 'string' && typeof meta.api.api_key === 'string');
    let next: typeof reg;
    if (hasApi) {
      ({ next } = createApiLinkedWorld(reg, {
        name: meta.name,
        apiWorldId: meta.api!.world_id!,
        apiKey: meta.api!.api_key!,
        folderName: entry.name,
        handleKey,
        pathHint: `${rootPathHint}/${entry.name}`,
        apiWorldName: meta.api!.world_name,
        readOnly: !!meta.api!.read_only,
      }));
    } else {
      ({ next } = createLocalWorld(reg, {
        name: meta.name,
        folderName: entry.name,
        handleKey,
        pathHint: `${rootPathHint}/${entry.name}`,
        // Re-mirror the demo flag from world.json — without this, a
        // localStorage wipe + rediscovery would silently un-demo the sample
        // world and its gestures would start completing waypoints.
        demo: meta.demo === true,
      }));
    }
    saveRegistry(next);
    patchSlice('registry', next);
    imported++;
  }
  console.info('[atlas-root] discover summary', { seen, imported, skippedDot, skippedNoWorldJson, skippedBadMeta, alreadyTrackedCount });
  return { imported };
}

/**
 * Open an existing world folder from anywhere on disk (2026-07-19, the
 * obsidian-alignment ask). The folder IS the world — no copy, no download:
 * validate world.json, store the handle, register (api-linked when the meta
 * carries an api block, exactly like root discovery). The world lives where
 * it is ("external world" — DESIGN's advanced path, now with UI).
 *
 * Returns the worldId to activate, or null with a thrown Error describing
 * why the folder was refused. A world whose id is already registered is NOT
 * re-registered (two folders with one id would fight over the same handle
 * slot): the caller activates the existing entry instead.
 */
export async function openWorldFolder(
  picked: FileSystemDirectoryHandle
): Promise<{ worldId: string; already: boolean }> {
  let meta: { id?: string; name?: string; demo?: boolean; api?: { world_id?: string; api_key?: string; world_name?: string; read_only?: boolean } } | null = null;
  try {
    meta = await readJson(picked, 'world.json');
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  if (!meta) {
    throw new Error('That folder has no world.json. Pick the world folder itself (the one containing world.json, elements/, spatial/).');
  }
  if (typeof meta.id !== 'string' || !meta.id || typeof meta.name !== 'string') {
    throw new Error('world.json must carry a valid id and name.');
  }

  // Registry entry ids are minted fresh (never the world.json id — existing
  // model), so dedupe by the handle key convention `world-<meta.id>` that
  // discovery also uses. This both catches a re-open of the same world AND
  // protects an already-registered world's handle slot from being
  // overwritten by a second folder carrying the same world id.
  const handleKey = `world-${meta.id}`;
  const existing = getState().registry.worlds.find(w => w.folder.handle_key === handleKey);
  if (existing) {
    return { worldId: existing.id, already: true };
  }

  await storeHandle(handleKey, picked);
  const reg = getState().registry;
  const hasApi = !!(meta.api && typeof meta.api.world_id === 'string' && typeof meta.api.api_key === 'string');
  let next: typeof reg;
  let entry: { id: string };
  if (hasApi) {
    ({ next, entry } = createApiLinkedWorld(reg, {
      name: meta.name,
      apiWorldId: meta.api!.world_id!,
      apiKey: meta.api!.api_key!,
      folderName: picked.name,
      handleKey,
      pathHint: picked.name,
      apiWorldName: meta.api!.world_name,
      readOnly: !!meta.api!.read_only,
    }));
  } else {
    ({ next, entry } = createLocalWorld(reg, {
      name: meta.name,
      folderName: picked.name,
      handleKey,
      pathHint: picked.name,
      demo: meta.demo === true,
    }));
  }
  saveRegistry(next);
  patchSlice('registry', next);
  return { worldId: entry.id, already: false };
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
 * Also detects the "orphan handle" case — registry has no atlas_root (e.g.
 * user cleared site data / localStorage) but the vault still holds the handle
 * under the fixed `ATLAS_ROOT_HANDLE_KEY`. We surface this as
 * `atlasRootRecoverable` so the UI can offer a one-click recover CTA.
 *
 * Does NOT re-grant permission here (no user gesture available at boot).
 * Permission is requested lazily on first use (creating a world inside it,
 * or via the recover CTA).
 */
export async function hydrateAtlasRoot(): Promise<void> {
  const reg = getState().registry;
  if (!reg.atlas_root) {
    // Registry has no atlas_root, but the vault might still have an orphan
    // handle from a prior session. Localstorage clear + IDB survival is the
    // common path. Surface as recoverable so the UI offers a restore button.
    const orphan = await loadHandle(ATLAS_ROOT_HANDLE_KEY);
    patchSlice('atlasRoot', null);
    patchSlice('atlasRootRecoverable', orphan ? { folderName: orphan.name } : null);
    return;
  }
  const handle = await loadHandle(reg.atlas_root.handle_key);
  if (!handle) {
    patchSlice('atlasRoot', null);
    patchSlice('atlasRootRecoverable', null);
    return;
  }
  patchSlice('atlasRoot', {
    folderName: reg.atlas_root.folder_name,
    pathHint: reg.atlas_root.path_hint,
  });
  patchSlice('atlasRootRecoverable', null);
}

/**
 * Recover an orphan atlas root: the vault has a handle under
 * `ATLAS_ROOT_HANDLE_KEY` but the registry doesn't reference it (typically
 * after a localStorage clear). Re-grants permission via a user gesture,
 * validates the on-disk marker, restores the registry entry, then runs
 * `discoverWorldsInRoot` to repopulate the world list from disk.
 *
 * Throws on permission denied, missing handle, or missing marker (the orphan
 * is cleared from the vault in the missing-marker case — the folder is no
 * longer an atlas root and the stale handle would block fresh setup).
 *
 * Returns the number of worlds discovered + adopted, or null if no orphan
 * existed (defensive — UI should check `state.atlasRootRecoverable` first).
 */
export async function recoverAtlasRoot(): Promise<{ imported: number } | null> {
  const handle = await loadHandle(ATLAS_ROOT_HANDLE_KEY);
  if (!handle) {
    patchSlice('atlasRootRecoverable', null);
    return null;
  }
  const granted = await ensureWritable(handle);
  if (!granted) {
    throw new Error('Write permission denied');
  }
  // Validate marker so a re-purposed folder doesn't masquerade as an atlas
  // root. If the marker's gone, clear the orphan and let the user pick fresh.
  const hasMarker = await hasAtlasRootMarker(handle);
  if (!hasMarker) {
    await deleteHandle(ATLAS_ROOT_HANDLE_KEY);
    patchSlice('atlasRootRecoverable', null);
    throw new Error('Folder no longer looks like an OnlyWorlds folder. Pick again');
  }
  const pathHint = handle.name;
  const nextRegistry = setAtlasRoot(getState().registry, {
    handleKey: ATLAS_ROOT_HANDLE_KEY,
    folderName: handle.name,
    pathHint,
  });
  saveRegistry(nextRegistry);
  patchSlice('registry', nextRegistry);
  patchSlice('atlasRoot', { folderName: handle.name, pathHint });
  patchSlice('atlasRootRecoverable', null);

  let imported = 0;
  try {
    const result = await discoverWorldsInRoot(handle, pathHint);
    imported = result.imported;
  } catch (err) {
    console.warn('[atlas-root] recover-time discovery failed:', err);
  }
  // Post-recovery URL hygiene: if the hash still points at a deep route
  // (`/w/<id>/...`) from before the localStorage wipe, sidebar mode would
  // stay 'elements' showing the "no active world" empty state — the just-
  // restored worlds list would only be reachable via the Worlds tab.
  // Reset to root so the user lands looking at the populated list.
  if (window.location.hash && window.location.hash !== '#/' && window.location.hash !== '#') {
    window.location.hash = '#/';
  }
  return { imported };
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
/**
 * Scaffold a fresh local world subfolder under the atlas root: validate the
 * root, close the prior active store, create the subfolder + persist its handle,
 * open an FsFolderStore. Returns the open store + identity bits; the caller
 * writes world.json, registers, and activates. Shared by createWorldInRoot
 * (empty world) and createWorldFromImportedData (populated from an import).
 */
async function scaffoldWorldInRoot(
  name: string,
  // Sample-world path (Bout DEMO): scaffold under an explicit parent handle
  // (OPFS on first launch) instead of the atlas root — no folder pick, no
  // permission prompt (OPFS needs none).
  parentOverride?: { handle: FileSystemDirectoryHandle; label: string },
): Promise<{
  store: FsFolderStore;
  worldUuid: string;
  subName: string;
  handleKey: string;
  rootFolderName: string;
}> {
  let rootHandle: FileSystemDirectoryHandle;
  let rootLabel: string;
  if (parentOverride) {
    rootHandle = parentOverride.handle;
    rootLabel = parentOverride.label;
  } else {
    const reg = getState().registry;
    if (!reg.atlas_root) {
      throw new Error('OnlyWorlds folder is not set up. Pick a folder first');
    }
    const loaded = await loadHandle(reg.atlas_root.handle_key);
    if (!loaded) {
      throw new Error('OnlyWorlds folder link is missing. Re-pick it in settings');
    }
    // Re-grant permission on the root (user gesture at click-time is acceptable here).
    const granted = await ensureWritable(loaded);
    if (!granted) {
      throw new Error('Write permission for the OnlyWorlds folder was denied');
    }
    rootHandle = loaded;
    rootLabel = reg.atlas_root.folder_name;
  }

  // Close any prior active store before we open a new one.
  const prior = getActiveStore();
  if (prior) await prior.close().catch(() => {});
  setActiveStore(null);

  const trimmed = name.trim() || 'Untitled world';
  const worldUuid = newId();
  const slug = slugify(trimmed);
  const subName = `${slug}-${worldUuid.slice(0, 8)}`;

  // Create the subfolder under the root + persist its own handle (so future
  // opens don't depend on the root).
  const worldHandle = await rootHandle.getDirectoryHandle(subName, { create: true });
  const handleKey = `world-${worldUuid}`;
  await storeHandle(handleKey, worldHandle);

  const store = new FsFolderStore();
  await store.open(worldHandle);

  return { store, worldUuid, subName, handleKey, rootFolderName: rootLabel };
}

export async function createWorldInRoot(name: string): Promise<{ entry: WorldRegistryEntry }> {
  const trimmed = name.trim() || 'Untitled world';
  const { store, worldUuid, subName, handleKey, rootFolderName } = await scaffoldWorldInRoot(trimmed);
  await store.writeWorldMeta({ id: worldUuid, name: trimmed });

  // Register + activate.
  const { next, entry } = createLocalWorld(getState().registry, {
    name: trimmed,
    folderName: subName,
    handleKey,
    pathHint: `${rootFolderName}/${subName}`,
  });
  const activated = setActiveWorld(next, entry.id);
  saveRegistry(activated);
  patchSlice('registry', activated);
  patchSlice('active', { worldId: entry.id, meta: { id: worldUuid, name: trimmed }, opened: true });
  setActiveStore(store);
  // Fresh world: no elements yet. Reset cache + selection for the new active world.
  patchSlice('data', { elements: [] });
  patchSlice('ui', { ...getState().ui, selectedElementId: null });

  // Local-only world: this detaches any prior engine. The make-online flow
  // (later) is what attaches a real engine once api credentials exist.
  attachSyncEngine(entry, store);

  return { entry };
}

/**
 * Import-as-new-world (DESIGN_IMPORT.md Mode A). Creates a fresh local world
 * under the atlas root, populated from a reconciled ImportPlan. World metadata
 * comes from the plan's worldMeta (api_key + world id deliberately absent — the
 * world stays local-only; linking to the API is a separate, consent-gated step,
 * convention #85). Returns the new entry + apply counts.
 */
export async function createWorldFromImportedData(
  plan: ImportPlan,
  opts: {
    name?: string;
    onProgress?: (p: ApplyProgress) => void;
    /** Scaffold under this handle instead of the atlas root (sample world / OPFS). */
    parentHandle?: { handle: FileSystemDirectoryHandle; label: string };
    /** ONLY the bundled sample world sets this (Bout OW demo-origin contract). */
    demo?: boolean;
  } = {},
): Promise<{ entry: WorldRegistryEntry; applied: ApplyResult }> {
  const name = (plan.worldMeta?.name ?? opts.name ?? '').trim() || 'Imported world';
  const { store, worldUuid, subName, handleKey, rootFolderName } = await scaffoldWorldInRoot(name, opts.parentHandle);

  // World metadata from the import; id/name forced (export carries no world id).
  // `demo` never rides an import plan — only the explicit sample-world opt sets
  // it (an exported demo world must re-import as an ordinary world, or its
  // gestures would silently stop completing waypoints).
  const { demo: _dropDemo, ...importedMeta } = plan.worldMeta ?? {};
  await store.writeWorldMeta({ ...importedMeta, id: worldUuid, name, ...(opts.demo ? { demo: true } : {}) });

  // Apply the elements BEFORE the world goes active.
  const applied = await applyImportPlan(store, plan, { onProgress: opts.onProgress });

  const { next, entry } = createLocalWorld(getState().registry, {
    name,
    folderName: subName,
    handleKey,
    pathHint: `${rootFolderName}/${subName}`,
    demo: opts.demo === true,
  });
  const activated = setActiveWorld(next, entry.id);
  saveRegistry(activated);
  patchSlice('registry', activated);
  patchSlice('active', { worldId: entry.id, meta: { id: worldUuid, name }, opened: true });
  setActiveStore(store);
  const elements = await store.listElements();
  patchSlice('data', { elements });
  patchSlice('ui', { ...getState().ui, selectedElementId: null });

  attachSyncEngine(entry, store); // local-only → no-op/detach

  return { entry, applied };
}

/**
 * Import-into-current-world (DESIGN_IMPORT.md Mode B merge). Applies a reconciled
 * ImportPlan to the ACTIVE world's folder, then refreshes the elements cache +
 * fires one debounced push (if the world is api-linked). Throws if no world is
 * open. Returns apply counts.
 */
export async function importIntoActiveWorld(
  plan: ImportPlan,
  opts: { onProgress?: (p: ApplyProgress) => void } = {},
): Promise<ApplyResult> {
  const store = getActiveStore();
  if (!store) throw new Error('No active world to import into');
  const applied = await applyImportPlan(store, plan, { onProgress: opts.onProgress });
  await refreshElementsAfterWrite(store); // re-prime state + requestPushIfLinked once
  return applied;
}

/**
 * Link an existing OnlyWorlds API world to atlas, downloading all elements
 * into a fresh subfolder under the atlas root.
 *
 * Steps:
 *   1. Validate creds — `client.worlds.get()` returns `{id, name}`.
 *   2. Build slug from display name + uuid prefix from server world id.
 *   3. Create subfolder under atlas root, persist handle in vault.
 *   4. Open FsFolderStore, write world.json with id + name + api fields.
 *   5. Download all elements via `initialDownloadAll`.
 *   6. Register entry as api-linked, set active, attach SyncEngine.
 *   7. Persist PIN globally if registry didn't have one.
 *
 * Throws on validation failure (bad creds, world not found, network error)
 * or on root-folder issues. Per-element download failures are non-fatal:
 * returned in `failures` for the modal to surface as a toast count.
 */
export interface LinkExistingApiWorldOpts {
  apiKey: string;
  apiPin: string;
  /** Optional override; empty falls back to the server-reported world name. */
  displayName?: string;
  /** Per-element progress during the initial download. */
  onProgress?: (p: InitialDownloadProgress) => void;
  /**
   * World identity already known to the caller (account-mode open flow: the
   * account list returned `{id, name}` moments ago). Skips the GET /world
   * validation round-trip — one fewer post-mint failure window (gate R1b).
   */
  knownWorld?: { id: string; name: string };
  /**
   * View-only link (S264): the key is a READ key, no PIN required or stored.
   * The world registers with `api.read_only`, the store blocks UI writes,
   * and the engine attaches pull-only.
   */
  readOnly?: boolean;
}

export interface LinkExistingApiWorldResult {
  entry: WorldRegistryEntry;
  downloaded: number;
  failures: PerElementFailure[];
}

export async function linkExistingApiWorldInRoot(
  opts: LinkExistingApiWorldOpts
): Promise<LinkExistingApiWorldResult> {
  const reg = getState().registry;
  if (!reg.atlas_root) {
    throw new Error('OnlyWorlds folder is not set up. Pick a folder first');
  }
  const apiKey = opts.apiKey.trim();
  const apiPin = opts.apiPin.trim();
  if (!apiKey) throw new Error('API key is required');
  // View-only links run on a READ key — keel reads are keyless-PIN (S264).
  if (!apiPin && !opts.readOnly) throw new Error('PIN is required');

  // Validate creds via v2 GET /world (live 2026-07-12; replaced the v1 SDK
  // lane). OwV2Error keeps the "API Error NNN: ..." prefix these regexes read.
  // Skipped when the caller already holds the world identity (account-mode
  // list → open; gate R1b — the fresh minted key needs no re-validation).
  let world: { id?: string; name?: string };
  if (opts.knownWorld) {
    world = opts.knownWorld;
  } else {
    const client = buildV2Adapter(apiKey, apiPin);
    try {
      world = await client.getWorld();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/401|403/.test(msg)) throw new Error('API key or PIN invalid');
      if (/404/.test(msg)) throw new Error('No world found for that API key');
      if (/network|fetch/i.test(msg)) throw new Error('Could not reach onlyworlds. Check your connection');
      throw new Error(msg);
    }
  }
  if (!world.id) throw new Error('Server returned no world ID (unexpected)');

  const serverWorldId = world.id;
  const displayName = (opts.displayName ?? '').trim() || world.name?.trim() || 'Untitled world';

  // Block double-linking: atlas refuses to register a second local world to
  // the same api world. Multi-device is handled by separate atlas instances
  // (each with its own folder); two locals in one atlas linked to the same
  // api would cause confusing sync amplification and has no valid use case.
  // Gate R3c: match ANY entry associated with this server world — a live link
  // OR a former one (unlinked world whose folder is still here). Re-checked
  // here (inside the activation-chained task) so two concurrent link attempts
  // for the same world can't both pass a stale read.
  const existingLink = findLinkedWorld(getState().registry, serverWorldId)
    ?? findWorldByServerId(getState().registry, serverWorldId);
  if (existingLink) {
    const live = existingLink.state === 'api-linked';
    throw new Error(
      live
        ? `This API world is already linked to a local world ("${existingLink.name}"). ` +
          `Open it from the sidebar, or unlink it first if you want to start fresh.`
        : `This world is already here as a local folder ("${existingLink.name}") from an earlier link. ` +
          `Open it from the sidebar; use Make Online → link to reconnect it.`
    );
  }

  const rootHandle = await loadHandle(reg.atlas_root.handle_key);
  if (!rootHandle) {
    throw new Error('OnlyWorlds folder link is missing. Re-pick it in settings');
  }
  const granted = await ensureWritable(rootHandle);
  if (!granted) {
    throw new Error('Write permission for the OnlyWorlds folder was denied');
  }

  // Close any prior active store before we open a new one.
  const prior = getActiveStore();
  if (prior) await prior.close().catch(() => {});
  setActiveStore(null);

  const slug = slugify(displayName);
  let subName = `${slug}-${serverWorldId.slice(0, 8)}`;

  // Folder-collision guard (gate R3b): the deterministic name can already be
  // taken by a leftover folder (unlink/forget keeps folders on disk). Never
  // download into existing data — fall to a numeric suffix instead.
  for (let n = 2; ; n++) {
    try {
      await rootHandle.getDirectoryHandle(subName); // probe, no create
      subName = `${slug}-${serverWorldId.slice(0, 8)}-${n}`;
    } catch {
      break; // name is free
    }
    if (n > 20) throw new Error('Could not find a free folder name for this world');
  }

  // Create the subfolder under the root.
  const worldHandle = await rootHandle.getDirectoryHandle(subName, { create: true });

  // Local-side uuid for the registry/folder identity. Distinct from serverWorldId.
  const localWorldUuid = newId();
  const handleKey = `world-${localWorldUuid}`;
  await storeHandle(handleKey, worldHandle);

  // Open FolderStore + write meta with api credentials so reload-after-restart
  // can rebuild the engine from registry+world.json alone.
  const store = new FsFolderStore();
  await store.open(worldHandle);
  await store.writeWorldMeta({
    id: localWorldUuid,
    name: displayName,
    // Cache the server-side name so settings can show api-vs-local
    // divergence without a network fetch on reload.
    api: {
      world_id: serverWorldId,
      api_key: apiKey,
      ...(world.name ? { world_name: world.name } : {}),
      // Mirrored so root discovery restores view-only status (S264).
      ...(opts.readOnly ? { read_only: true } : {}),
    },
  });

  // Initial download — all elements of all types stamped with
  // `server_updated_at`, fetched over the v2 dialect.
  const adapter = buildV2Adapter(apiKey, apiPin);
  const downloadResult = await initialDownloadAll(store, adapter, opts.onProgress);

  // Register the world in registry. Persist PIN globally if not set yet
  // (never from a view-only link — there is no PIN to persist).
  let regAfter = getState().registry;
  if (!regAfter.pin && apiPin) regAfter = setPin(regAfter, apiPin);
  const { next, entry } = createApiLinkedWorld(regAfter, {
    name: displayName,
    apiWorldId: serverWorldId,
    apiKey,
    folderName: subName,
    handleKey,
    pathHint: `${reg.atlas_root.folder_name}/${subName}`,
    apiWorldName: world.name,
    readOnly: !!opts.readOnly,
  });
  const activated = setActiveWorld(next, entry.id);
  saveRegistry(activated);
  patchSlice('registry', activated);
  patchSlice('active', { worldId: entry.id, meta: { id: localWorldUuid, name: displayName }, opened: true });
  // Arm the view-only guard AFTER the setup writes above (they are this
  // flow's own, legitimate writes) and BEFORE the store reaches the UI.
  if (opts.readOnly) store.setViewOnly(true);
  setActiveStore(store);

  // Prime the elements cache from the newly-downloaded folder.
  try {
    const elements = await store.listElements();
    patchSlice('data', { elements });
  } catch (err) {
    console.warn('[link-api] failed to prime elements after download:', err);
    patchSlice('data', { elements: [] });
  }
  patchSlice('ui', { ...getState().ui, selectedElementId: null });

  // Attach SyncEngine — api-linked entry, so the engine spins up.
  attachSyncEngine(entry, store);

  return {
    entry,
    downloaded: downloadResult.totalDownloaded,
    failures: downloadResult.failures,
  };
}

/**
 * Permanently delete a world's folder under the atlas root. The world MUST
 * be inside the configured root (i.e., a real subfolder of the atlas-root
 * handle) — external worlds are not supported here for safety.
 *
 * Steps:
 *   1. Verify atlas root + world exists in registry.
 *   2. Find the world subfolder by name under root.
 *   3. `rootHandle.removeEntry(name, { recursive: true })`.
 *   4. Caller is responsible for closing the FolderStore + registry cleanup.
 *
 * Throws on any failure — caller surfaces as toast.
 */
export async function deleteWorldFolderUnderRoot(folderName: string): Promise<void> {
  const reg = getState().registry;
  if (!reg.atlas_root) {
    throw new Error('OnlyWorlds folder not configured; cannot delete');
  }
  const rootHandle = await loadHandle(reg.atlas_root.handle_key);
  if (!rootHandle) {
    throw new Error('OnlyWorlds folder link missing. Re-pick it in settings');
  }
  const granted = await ensureWritable(rootHandle);
  if (!granted) {
    throw new Error('Write permission denied for the OnlyWorlds folder');
  }
  await rootHandle.removeEntry(folderName, { recursive: true });
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
