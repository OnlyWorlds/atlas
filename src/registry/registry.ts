/**
 * WorldsRegistry — index of every world Atlas knows about.
 *
 * Persists to localStorage. Each entry has a folder (every world has a folder
 * in the folder-first model) and optional api credentials (iff state is
 * 'api-linked'). The global PIN and email live at the registry level.
 *
 * All functions here are pure (registry-in → registry-out). Side-effect-free
 * except for `loadRegistry` / `saveRegistry`, which are the only callers of
 * localStorage.
 */

import { REGISTRY_STORAGE_KEY } from '../core/constants';
import { defaultRegistry } from '../core/types';
import type { WorldRegistryEntry, WorldsRegistry } from '../core/types';

// ---- Persistence ----

export function loadRegistry(): WorldsRegistry {
  try {
    const raw = localStorage.getItem(REGISTRY_STORAGE_KEY);
    if (!raw) return defaultRegistry();
    const parsed = JSON.parse(raw) as Partial<WorldsRegistry>;
    if (!parsed || !Array.isArray(parsed.worlds)) return defaultRegistry();
    // Spread all stored fields (including atlas_root and any future additions),
    // then narrow with defaults. Hand-picking fields silently drops new ones.
    return {
      ...parsed,
      version: parsed.version ?? 1,
      worlds: parsed.worlds,
    };
  } catch (err) {
    console.error('[registry] load failed, resetting:', err);
    return defaultRegistry();
  }
}

export function saveRegistry(reg: WorldsRegistry): void {
  try {
    localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(reg));
  } catch (err) {
    console.error('[registry] save failed:', err);
  }
}

// ---- Constructors ----

export interface CreateLocalWorldOpts {
  name: string;
  folderName: string;
  handleKey: string;
  pathHint?: string;
  parentId?: string;
}

export function createLocalWorld(
  reg: WorldsRegistry,
  opts: CreateLocalWorldOpts
): { next: WorldsRegistry; entry: WorldRegistryEntry } {
  const now = new Date().toISOString();
  const entry: WorldRegistryEntry = {
    id: crypto.randomUUID(),
    name: opts.name.trim() || 'untitled world',
    state: 'local-only',
    folder: {
      handle_key: opts.handleKey,
      folder_name: opts.folderName,
      last_path_hint: opts.pathHint,
    },
    parent_id: opts.parentId,
    created_at: now,
    last_opened_at: now,
  };
  return { next: { ...reg, worlds: [...reg.worlds, entry] }, entry };
}

export interface CreateApiLinkedWorldOpts {
  name: string;
  apiWorldId: string;
  apiKey: string;
  folderName: string;
  handleKey: string;
  pathHint?: string;
  parentId?: string;
}

/**
 * Register a world that's api-linked from the start (link-existing flow).
 * Caller is responsible for the initial download into the folder.
 */
export function createApiLinkedWorld(
  reg: WorldsRegistry,
  opts: CreateApiLinkedWorldOpts
): { next: WorldsRegistry; entry: WorldRegistryEntry } {
  const now = new Date().toISOString();
  const entry: WorldRegistryEntry = {
    id: crypto.randomUUID(),
    name: opts.name.trim() || 'untitled world',
    state: 'api-linked',
    api: { world_id: opts.apiWorldId, api_key: opts.apiKey },
    folder: {
      handle_key: opts.handleKey,
      folder_name: opts.folderName,
      last_path_hint: opts.pathHint,
    },
    parent_id: opts.parentId,
    created_at: now,
    last_opened_at: now,
  };
  return { next: { ...reg, worlds: [...reg.worlds, entry] }, entry };
}

// ---- State transitions (Make-Online / Unlink) ----

/**
 * Flip a local-only world to api-linked. Folder unchanged. State changes
 * in-place — no duplicate entries.
 */
export function attachApi(
  reg: WorldsRegistry,
  worldId: string,
  api: { worldId: string; apiKey: string }
): WorldsRegistry {
  return {
    ...reg,
    worlds: reg.worlds.map(w =>
      w.id === worldId
        ? { ...w, state: 'api-linked', api: { world_id: api.worldId, api_key: api.apiKey } }
        : w
    ),
  };
}

/**
 * Flip an api-linked world back to local-only. Folder remains; api credentials
 * stripped from the entry. The remote api world is NOT deleted server-side.
 */
export function detachApi(reg: WorldsRegistry, worldId: string): WorldsRegistry {
  return {
    ...reg,
    worlds: reg.worlds.map(w => {
      if (w.id !== worldId) return w;
      const { api, ...rest } = w;
      return { ...rest, state: 'local-only' };
    }),
  };
}

// ---- Lookups ----

export function findWorld(reg: WorldsRegistry, worldId: string): WorldRegistryEntry | undefined {
  return reg.worlds.find(w => w.id === worldId);
}

export function childrenOf(
  reg: WorldsRegistry,
  worldId: string | undefined
): WorldRegistryEntry[] {
  return reg.worlds.filter(w => w.parent_id === worldId);
}

export function isDescendantOf(
  reg: WorldsRegistry,
  descendantId: string,
  ancestorId: string
): boolean {
  let current = reg.worlds.find(w => w.id === descendantId);
  const seen = new Set<string>();
  while (current && current.parent_id && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parent_id === ancestorId) return true;
    current = reg.worlds.find(w => w.id === current!.parent_id);
  }
  return false;
}

// ---- Mutations ----

export function renameWorld(
  reg: WorldsRegistry,
  worldId: string,
  newName: string
): WorldsRegistry {
  return {
    ...reg,
    worlds: reg.worlds.map(w =>
      w.id === worldId ? { ...w, name: newName.trim() || w.name } : w
    ),
  };
}

/**
 * Remove a world entry. Children get re-parented to the deleted world's
 * parent (or root). Active-world cleared if it was this one.
 */
export function deleteWorldEntry(reg: WorldsRegistry, worldId: string): WorldsRegistry {
  const deleted = reg.worlds.find(w => w.id === worldId);
  const remaining = reg.worlds.filter(w => w.id !== worldId);
  const reparented = remaining.map(w =>
    w.parent_id === worldId ? { ...w, parent_id: deleted?.parent_id } : w
  );
  return {
    ...reg,
    worlds: reparented,
    active_world_id: reg.active_world_id === worldId ? undefined : reg.active_world_id,
  };
}

export function setActiveWorld(
  reg: WorldsRegistry,
  worldId: string | undefined
): WorldsRegistry {
  if (!worldId) return { ...reg, active_world_id: undefined };
  const now = new Date().toISOString();
  return {
    ...reg,
    active_world_id: worldId,
    worlds: reg.worlds.map(w => (w.id === worldId ? { ...w, last_opened_at: now } : w)),
  };
}

export function setFavorite(
  reg: WorldsRegistry,
  worldId: string,
  favorite: boolean
): WorldsRegistry {
  return {
    ...reg,
    worlds: reg.worlds.map(w => (w.id === worldId ? { ...w, favorite } : w)),
  };
}

/**
 * Set parent. Refuses cycles and self-parenting (returns reg unchanged).
 */
export function setParent(
  reg: WorldsRegistry,
  worldId: string,
  parentId: string | undefined
): WorldsRegistry {
  if (worldId === parentId) return reg;
  if (parentId && isDescendantOf(reg, parentId, worldId)) return reg;
  return {
    ...reg,
    worlds: reg.worlds.map(w => (w.id === worldId ? { ...w, parent_id: parentId } : w)),
  };
}

// ---- Global identity ----

export function setPin(reg: WorldsRegistry, pin: string | undefined): WorldsRegistry {
  return { ...reg, pin: pin?.trim() || undefined };
}

export function setEmail(reg: WorldsRegistry, email: string | undefined): WorldsRegistry {
  return { ...reg, email: email?.trim() || undefined };
}

// ---- Atlas root (default container for new local worlds) ----

export interface SetAtlasRootOpts {
  handleKey: string;
  folderName: string;
  pathHint?: string;
}

export function setAtlasRoot(reg: WorldsRegistry, opts: SetAtlasRootOpts): WorldsRegistry {
  return {
    ...reg,
    atlas_root: {
      handle_key: opts.handleKey,
      folder_name: opts.folderName,
      path_hint: opts.pathHint,
      set_at: new Date().toISOString(),
    },
  };
}

export function clearAtlasRoot(reg: WorldsRegistry): WorldsRegistry {
  const { atlas_root, ...rest } = reg;
  return rest;
}
