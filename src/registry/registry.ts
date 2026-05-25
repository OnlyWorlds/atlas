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
import type { WorldRegistryEntry, WorldsRegistry, RightTabsSnapshot, RightTabRef } from '../core/types';

// ---- Persistence ----

export function loadRegistry(): WorldsRegistry {
  try {
    const raw = localStorage.getItem(REGISTRY_STORAGE_KEY);
    if (!raw) return defaultRegistry();
    const parsed = JSON.parse(raw) as Partial<WorldsRegistry> & { sync_default_policy?: string };
    if (!parsed || !Array.isArray(parsed.worlds)) return defaultRegistry();
    // Migrate legacy conflict-policy names (Phase 3.5+ simplified to two values).
    let policy: string | undefined = parsed.sync_default_policy;
    if (policy === 'drain-blind') policy = 'local-wins';
    else if (policy === 'pause-on-conflict' || policy === 'ask') policy = 'pause-and-review';
    else if (policy !== 'local-wins' && policy !== 'pause-and-review') policy = undefined;
    // Spread all stored fields (including atlas_root and any future additions),
    // then narrow with defaults. Hand-picking fields silently drops new ones.
    return {
      ...parsed,
      version: parsed.version ?? 1,
      worlds: parsed.worlds,
      sync_default_policy: policy as 'local-wins' | 'pause-and-review' | undefined,
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
  /** Server-side world name from `client.worlds.get()`. Display-only. */
  apiWorldName?: string;
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
  const apiBlock: WorldRegistryEntry['api'] = {
    world_id: opts.apiWorldId,
    api_key: opts.apiKey,
  };
  if (opts.apiWorldName) apiBlock.world_name = opts.apiWorldName;
  const entry: WorldRegistryEntry = {
    id: crypto.randomUUID(),
    name: opts.name.trim() || 'untitled world',
    state: 'api-linked',
    api: apiBlock,
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
  api: { worldId: string; apiKey: string; worldName?: string }
): WorldsRegistry {
  return {
    ...reg,
    worlds: reg.worlds.map(w => {
      if (w.id !== worldId) return w;
      const apiBlock: WorldRegistryEntry['api'] = {
        world_id: api.worldId,
        api_key: api.apiKey,
      };
      if (api.worldName) apiBlock.world_name = api.worldName;
      return { ...w, state: 'api-linked', api: apiBlock };
    }),
  };
}

/**
 * Update only the cached `world_name` on an already-api-linked world's api
 * block. Used by Test Connection: when `client.worlds.get()` returns a name
 * different from the one we stored at link time, refresh the cache so the
 * Settings → World tab reflects the live name. No-op if the world isn't
 * api-linked.
 */
export function setApiWorldName(
  reg: WorldsRegistry,
  worldId: string,
  worldName: string
): WorldsRegistry {
  return {
    ...reg,
    worlds: reg.worlds.map(w => {
      if (w.id !== worldId || !w.api) return w;
      return { ...w, api: { ...w.api, world_name: worldName } };
    }),
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

/**
 * Find a registered world already linked to the given api world id. Used to
 * block double-linking: linking two local worlds to the same api world is
 * confusing and has no legitimate use case in a single atlas instance
 * (multi-device is handled by separate atlases, not separate worlds).
 */
export function findLinkedWorld(
  reg: WorldsRegistry,
  apiWorldId: string,
  exceptWorldId?: string
): WorldRegistryEntry | undefined {
  return reg.worlds.find(w =>
    w.id !== exceptWorldId &&
    w.state === 'api-linked' &&
    w.api?.world_id === apiWorldId
  );
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
 * Generic per-world field merge. Returns a NEW registry with `patch` shallow-
 * merged into the matching world entry (no-op if the world isn't found).
 * Caller is responsible for `saveRegistry` + `patchSlice`.
 *
 * Prefer this over hand-rolling `findIndex` + `worlds.map(...)` for one-off
 * per-world settings that don't warrant their own named setter (e.g. the
 * writing-font and context-pane prefs in the settings panel).
 */
export function updateWorldEntry(
  reg: WorldsRegistry,
  worldId: string,
  patch: Partial<WorldRegistryEntry>
): WorldsRegistry {
  return {
    ...reg,
    worlds: reg.worlds.map(w => (w.id === worldId ? { ...w, ...patch } : w)),
  };
}

/**
 * Toggle a node's collapsed state in a world's writing tree. Collapsed = node
 * id appears in `writing_tree_collapsed`; expanded = absent. Returns a NEW
 * registry — caller is responsible for `saveRegistry` + `patchSlice`.
 */
export function toggleWritingTreeCollapsed(
  reg: WorldsRegistry,
  worldId: string,
  nodeId: string,
): WorldsRegistry {
  return {
    ...reg,
    worlds: reg.worlds.map(w => {
      if (w.id !== worldId) return w;
      const current = w.writing_tree_collapsed ?? [];
      const next = current.includes(nodeId)
        ? current.filter(id => id !== nodeId)
        : [...current, nodeId];
      return { ...w, writing_tree_collapsed: next };
    }),
  };
}

// ---- Right-pane tab persistence (per-world) ----

/**
 * Read the right-tabs snapshot for a world. Returns null if absent or
 * structurally invalid (corrupted localStorage etc.). Callers default to
 * `[{kind:'map-index'}]` + index 0 on null.
 */
export function getWorldRightTabs(
  reg: WorldsRegistry,
  worldId: string,
): RightTabsSnapshot | null {
  const entry = reg.worlds.find(w => w.id === worldId);
  if (!entry?.right_tabs) return null;
  const snap = entry.right_tabs;
  if (!Array.isArray(snap.tabs) || typeof snap.activeIndex !== 'number') return null;
  // Filter out any malformed tab entries defensively. Legacy 'writing-context'
  // entries (ephemeral before session 231) are dropped — context is now a
  // permanent route-driven tab and narrativeId is irrelevant.
  const tabs = snap.tabs.filter((t): t is RightTabRef => {
    if (!t || typeof t !== 'object') return false;
    if (t.kind === 'context') return true;
    if (t.kind === 'map-index') return true;
    return t.kind === 'map' && typeof (t as { mapId?: unknown }).mapId === 'string';
  });
  const activeIndex = Math.max(0, Math.min(snap.activeIndex, tabs.length - 1));
  return { tabs, activeIndex };
}

/**
 * Snapshot a world's right-tabs into the registry. Returns the new registry
 * (pure, caller saves). Passing `null` clears the snapshot.
 */
export function setWorldRightTabs(
  reg: WorldsRegistry,
  worldId: string,
  snapshot: RightTabsSnapshot | null,
): WorldsRegistry {
  return {
    ...reg,
    worlds: reg.worlds.map(w => {
      if (w.id !== worldId) return w;
      const next: WorldRegistryEntry = { ...w };
      if (snapshot) next.right_tabs = snapshot;
      else delete next.right_tabs;
      return next;
    }),
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

// ---- Sync settings (Phase 3.5+) ----

export function setSyncPullOnActivate(reg: WorldsRegistry, on: boolean): WorldsRegistry {
  return { ...reg, sync_pull_on_activate: on };
}

export function setSyncCadenceMs(reg: WorldsRegistry, ms: number | null): WorldsRegistry {
  return { ...reg, sync_cadence_ms: ms };
}

export function setSyncDebounceMs(reg: WorldsRegistry, ms: number | null): WorldsRegistry {
  return { ...reg, sync_debounce_ms: ms };
}

export function setSyncDefaultPolicy(
  reg: WorldsRegistry,
  policy: 'local-wins' | 'pause-and-review'
): WorldsRegistry {
  return { ...reg, sync_default_policy: policy };
}

export function setSyncConfirmServerDeletes(reg: WorldsRegistry, on: boolean): WorldsRegistry {
  return { ...reg, sync_confirm_server_deletes: on };
}

export function setSyncPauseAll(reg: WorldsRegistry, paused: boolean): WorldsRegistry {
  return { ...reg, sync_pause_all: paused };
}

/** Per-world "stay offline" toggle. */
export function setWorldPaused(
  reg: WorldsRegistry,
  worldId: string,
  paused: boolean
): WorldsRegistry {
  return {
    ...reg,
    worlds: reg.worlds.map(w =>
      w.id === worldId ? { ...w, sync_paused: paused } : w
    ),
  };
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

// ---- Maps subsystem settings (DESIGN_MAPS.md §3.5) ----

export function setMapsSettings(
  reg: WorldsRegistry,
  patch: Partial<NonNullable<WorldsRegistry['maps_settings']>>
): WorldsRegistry {
  return {
    ...reg,
    maps_settings: {
      ...(reg.maps_settings ?? {}),
      ...patch,
    },
  };
}

/** Returns the registry's maps settings with defaults applied for unset toggles. */
export function getMapsSettings(reg: WorldsRegistry): {
  show_map_names_in_header: boolean;
  show_pin_map_names_in_header: boolean;
  show_pinned_element_names_in_header: boolean;
} {
  return {
    show_map_names_in_header: reg.maps_settings?.show_map_names_in_header ?? false,
    show_pin_map_names_in_header: reg.maps_settings?.show_pin_map_names_in_header ?? false,
    show_pinned_element_names_in_header: reg.maps_settings?.show_pinned_element_names_in_header ?? false,
  };
}

// ---- Editor settings (session 219 — field edit mode) ----

export type FieldEditMode = 'modal' | 'inline-single' | 'inline-multi';

export function setEditorSettings(
  reg: WorldsRegistry,
  patch: Partial<NonNullable<WorldsRegistry['editor_settings']>>
): WorldsRegistry {
  return {
    ...reg,
    editor_settings: {
      ...(reg.editor_settings ?? {}),
      ...patch,
    },
  };
}

/**
 * Returns the editor settings with defaults applied. `field_edit_mode`
 * defaults to 'modal' for back-compat with everything that shipped before
 * this setting existed.
 */
export function getEditorSettings(reg: WorldsRegistry): {
  field_edit_mode: FieldEditMode;
  refs_group_by_field: boolean;
  confirm_before_delete: boolean;
} {
  return {
    field_edit_mode: reg.editor_settings?.field_edit_mode ?? 'modal',
    refs_group_by_field: reg.editor_settings?.refs_group_by_field ?? false,
    confirm_before_delete: reg.editor_settings?.confirm_before_delete ?? true,
  };
}
