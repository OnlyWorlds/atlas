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

/**
 * TWO TABS, ONE REGISTRY (S365 lane B M2). Every tab holds the whole registry
 * in memory and every save used to write all of it, so a tab saving for world
 * V (a world switch stamps last_opened_at) put back ITS old copy of world W:
 * notes typed in the other tab, a Make Online done there. A save now merges
 * per entry against `tabBase`, this tab's view as it last loaded or saved it:
 * an entry (or top-level field) this tab did not change is taken from storage
 * as it is now; one it changed, added or removed is this tab's. Inside an
 * entry the same rule runs PER FIELD (gate lens A H1: opening world W stamps
 * `last_opened_at`, and a whole-entry rule then let this tab's stale copy of
 * W erase the other tab's notes or Make Online). Two tabs changing the SAME
 * field: the later save wins. And a tab learns of another's saves as they
 * happen (`adoptStoredRegistry`, called on the `storage` event), so its
 * memory does not go stale in the first place.
 */
let tabBase: WorldsRegistry | null = null;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Three-way per key: a key this side left as the base says takes the stored value. */
function mergeFields(b: Record<string, unknown>, m: Record<string, unknown>, d: Record<string, unknown>, skip?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(d)])) {
    if (k === skip) continue;
    const src = same(m[k], b[k]) ? d : m;
    if (k in src && src[k] !== undefined) out[k] = src[k];
  }
  return out;
}

/** The merge behind `saveRegistry`: per entry, and per field inside an entry. Pure; exported for tests. */
export function mergeRegistry(base: WorldsRegistry, mine: WorldsRegistry, stored: WorldsRegistry): WorldsRegistry {
  const out = mergeFields(base as unknown as Record<string, unknown>, mine as unknown as Record<string, unknown>, stored as unknown as Record<string, unknown>, 'worlds');
  const baseById = new Map(base.worlds.map(w => [w.id, w]));
  const storedById = new Map(stored.worlds.map(w => [w.id, w]));
  const mineIds = new Set(mine.worlds.map(w => w.id));
  const worlds: WorldRegistryEntry[] = [];
  for (const w of mine.worlds) {
    const was = baseById.get(w.id);
    const now = storedById.get(w.id);
    if (was && same(w, was)) {
      if (now) worlds.push(now); // unchanged here: storage's copy (absent = another tab forgot it)
    } else if (was && now) {
      // Changed here AND still stored: field by field.
      worlds.push(mergeFields(was as unknown as Record<string, unknown>, w as unknown as Record<string, unknown>, now as unknown as Record<string, unknown>) as unknown as WorldRegistryEntry);
    } else {
      worlds.push(w);
    }
  }
  for (const w of stored.worlds) {
    if (!mineIds.has(w.id) && !baseById.has(w.id)) worlds.push(w); // another tab added it
  }
  out.worlds = worlds;
  return out as unknown as WorldsRegistry;
}

export function loadRegistry(): WorldsRegistry {
  const reg = readRegistry();
  tabBase = JSON.parse(JSON.stringify(reg)) as WorldsRegistry;
  return reg;
}

/**
 * Another tab saved (the `storage` event): fold storage into this tab's view,
 * keeping what this tab changed and has not saved yet, and re-base. Returns
 * the registry to patch into state, or null when nothing changed here.
 */
export function adoptStoredRegistry(current: WorldsRegistry): WorldsRegistry | null {
  const stored = readRegistry();
  const merged = tabBase ? mergeRegistry(tabBase, current, stored) : stored;
  tabBase = JSON.parse(JSON.stringify(stored)) as WorldsRegistry;
  return same(merged, current) ? null : merged;
}

/** Tests: make the next save merge as a tab whose view is `reg` would. */
export function __setRegistryTabBaseForTests(reg: WorldsRegistry | null): void {
  tabBase = reg ? JSON.parse(JSON.stringify(reg)) as WorldsRegistry : null;
}

/** The registry as it sits in storage now (a save that must have landed reads it back). */
export function storedRegistry(): WorldsRegistry {
  return readRegistry();
}

function readRegistry(): WorldsRegistry {
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

/** Saves the registry; answers whether it reached storage (a step that must not run on a lost save checks it). */
export function saveRegistry(reg: WorldsRegistry): boolean {
  try {
    let out = reg;
    if (tabBase) {
      const raw = localStorage.getItem(REGISTRY_STORAGE_KEY);
      // Nothing stored = nothing another tab kept: entries this tab did not
      // change are dropped with it (a save after "clear site data" must not
      // bring the forgotten worlds back, S364's flake).
      // Stored but unreadable: write this tab's copy whole, as before.
      let readable = true;
      try { readable = !raw || Array.isArray((JSON.parse(raw) as { worlds?: unknown })?.worlds); } catch { readable = false; }
      if (readable) out = mergeRegistry(tabBase, reg, raw ? readRegistry() : defaultRegistry());
    }
    localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(out));
    tabBase = JSON.parse(JSON.stringify(reg)) as WorldsRegistry;
    return true;
  } catch (err) {
    console.error('[registry] save failed:', err);
    // Said once per session (S369): the list of worlds lives in this
    // browser's storage, and a failed save is lost on the next reload.
    if (!registrySaveFailureSaid) {
      registrySaveFailureSaid = true;
      // Worlds kept in this browser share its storage (1.17): the same
      // pressure can reach them, so "not affected" is said only of folders.
      const browserWorlds = reg.worlds.some(w => w.where === 'browser' && w.demo !== true);
      void import('../ui/toast-manager').then(({ toastManager }) => {
        toastManager.show(
          browserWorlds
            ? 'Atlas could not save your list of worlds in this browser, so changes to it may be gone after a reload. Worlds kept in this browser share its storage, so free some space, then reload.'
            : 'Atlas could not save your list of worlds in this browser, so changes to it may be gone after a reload. Your world folders are not affected. If the browser is low on storage, free some, then reload.',
          'error', 8000, { sticky: true },
        );
      }).catch(() => {});
    }
    return false;
  }
}

let registrySaveFailureSaid = false;

// ---- Constructors ----

export interface CreateLocalWorldOpts {
  name: string;
  folderName: string;
  handleKey: string;
  pathHint?: string;
  parentId?: string;
  /** The bundled sample world (mirrors WorldMeta.demo — see waypoints). */
  demo?: boolean;
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
    ...(opts.demo ? { demo: true } : {}),
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
  /** View-only world linked with a READ key (S264) — no PIN, engine pull-only. */
  readOnly?: boolean;
  /** Linked as an agent seat (#104): the marker, and its secret when this browser holds it. */
  seat?: { role?: string };
  seatSecret?: string;
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
  if (opts.readOnly) apiBlock.read_only = true;
  if (opts.seat && !opts.readOnly) {
    apiBlock.seat = { ...opts.seat };
    if (opts.seatSecret) apiBlock.seat_secret = opts.seatSecret;
  }
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
  api: { worldId: string; apiKey: string; worldName?: string; seatSecret?: string }
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
      // Linked with a seat's key and secret (#104): the secret is this world's.
      if (api.seatSecret) { apiBlock.seat = {}; apiBlock.seat_secret = api.seatSecret; }
      // Making a world online also un-demos it (Bout OW class rule): the
      // world is genuinely the user's now, so gestures in it count.
      // A former-link memory is stale the moment a live link exists.
      const { demo: _clearDemo, former_api_world_id: _clearFormer, ...rest } = w;
      return { ...rest, state: 'api-linked', api: apiBlock };
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
 * The server world id is remembered as `former_api_world_id` so the account-
 * mode remote list can suppress a world that's already here as a folder.
 */
export function detachApi(reg: WorldsRegistry, worldId: string): WorldsRegistry {
  return {
    ...reg,
    worlds: reg.worlds.map(w => {
      if (w.id !== worldId) return w;
      const { api, ...rest } = w;
      return {
        ...rest,
        state: 'local-only',
        ...(api?.world_id ? { former_api_world_id: api.world_id } : {}),
      };
    }),
  };
}

/**
 * Find any registry entry associated with the given server world id — a LIVE
 * link (`api.world_id`) or a remembered former link (`former_api_world_id`,
 * any state). Broader than `findLinkedWorld`: used by account-mode to decide
 * whether a remote world is "already here" and by the open flow's just-
 * before-commit duplicate check.
 */
export function findWorldByServerId(
  reg: WorldsRegistry,
  serverWorldId: string
): WorldRegistryEntry | undefined {
  return reg.worlds.find(w =>
    w.api?.world_id === serverWorldId || w.former_api_world_id === serverWorldId
  );
}

/**
 * The local world (if any) that already carries an OW world id, wherever that
 * identity lives: the `world-<id>` handle-key convention (adopt-imported and
 * created-local worlds) OR the api link fields (api-linked worlds mint a
 * DISTINCT local uuid for their handle key and keep the server id in
 * `api.world_id`/`former_api_world_id`). The import room's merge-vs-copy
 * collision detection rides this; checking only the handle key let re-importing
 * an api-linked world's own export fork its identity (S315 gate HIGH).
 */
export function findWorldByOwIdentity(
  reg: WorldsRegistry,
  owWorldId: string
): WorldRegistryEntry | undefined {
  return reg.worlds.find(w => w.folder?.handle_key === `world-${owWorldId}`)
    ?? findWorldByServerId(reg, owWorldId);
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
/**
 * Set (or clear, with null) a world's cast favorite (D2b): 'protagonist'
 * (character) or 'nexus' (the home location). Returns a NEW registry —
 * caller saves + patches state like every other setter here.
 */
/** Persist a home-tour card dismissal (S264). Idempotent; caller saves +
 *  patches state like every other setter here. */
export function dismissTourCard(
  reg: WorldsRegistry,
  worldId: string,
  cardId: string,
): WorldsRegistry {
  return {
    ...reg,
    worlds: reg.worlds.map(w => {
      if (w.id !== worldId) return w;
      const dismissed = new Set(w.tour_dismissed ?? []);
      dismissed.add(cardId);
      return { ...w, tour_dismissed: [...dismissed] };
    }),
  };
}

export function setWorldFavoriteElement(
  reg: WorldsRegistry,
  worldId: string,
  kind: 'protagonist' | 'nexus',
  elementId: string | null,
): WorldsRegistry {
  return {
    ...reg,
    worlds: reg.worlds.map(w => {
      if (w.id !== worldId) return w;
      const favorites = { ...(w.favorites ?? {}) };
      if (kind === 'protagonist') favorites.protagonist_id = elementId;
      else favorites.nexus_id = elementId;
      return { ...w, favorites };
    }),
  };
}

/**
 * The charts room's active calendar lens for a world (2B). Device-local room
 * state; null = bare numbers. Dangling ids are resolved (to bare numbers) at
 * read time by calendar-lens.ts, so no cleanup pass is needed here.
 */
export function setWorldActiveCalendar(
  reg: WorldsRegistry,
  worldId: string,
  calendarId: string | null,
): WorldsRegistry {
  return {
    ...reg,
    worlds: reg.worlds.map(w =>
      w.id === worldId ? { ...w, active_calendar_id: calendarId } : w),
  };
}

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

/**
 * The re-key (S363) moves ids; stored state follows. Remaps the element ids a
 * world entry carries (favourites, calendar lens, writing-tree collapse, last
 * writing narrative). Returns the SAME registry when nothing matched; the
 * caller saves.
 */
export function rekeyRegistryEntry(
  reg: WorldsRegistry,
  worldId: string,
  map: ReadonlyMap<string, string>,
): WorldsRegistry {
  const one = (v: string | null | undefined): string | null | undefined =>
    typeof v === 'string' && map.has(v) ? map.get(v)! : v;
  let changed = false;
  const worlds = reg.worlds.map(w => {
    if (w.id !== worldId) return w;
    let next = w;
    if (w.favorites) {
      const p = one(w.favorites.protagonist_id);
      const n = one(w.favorites.nexus_id);
      if (p !== w.favorites.protagonist_id || n !== w.favorites.nexus_id) {
        const favorites = { ...w.favorites };
        if (p !== w.favorites.protagonist_id) favorites.protagonist_id = p as string | null;
        if (n !== w.favorites.nexus_id) favorites.nexus_id = n as string | null;
        next = { ...next, favorites };
      }
    }
    const cal = one(w.active_calendar_id);
    if (cal !== w.active_calendar_id) next = { ...next, active_calendar_id: cal };
    if (Array.isArray(w.writing_tree_collapsed) && w.writing_tree_collapsed.some(id => map.has(id))) {
      next = { ...next, writing_tree_collapsed: w.writing_tree_collapsed.map(id => map.get(id) ?? id) };
    }
    const last = one(w.last_writing_narrative_id);
    if (last !== w.last_writing_narrative_id) next = { ...next, last_writing_narrative_id: last as string };
    if (next !== w) changed = true;
    return next;
  });
  return changed ? { ...reg, worlds } : reg;
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

/**
 * Set (or clear) the OnlyWorlds account token + its display-name cache.
 * Clearing ("forget") drops both; worlds already opened via minted keys keep
 * working — their keys live in world.json, independent of the token.
 */
export function setAccountToken(
  reg: WorldsRegistry,
  token: string | undefined,
  username?: string
): WorldsRegistry {
  const trimmed = token?.trim() || undefined;
  return {
    ...reg,
    account_token: trimmed,
    account_username: trimmed ? (username?.trim() || reg.account_username) : undefined,
  };
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

/**
 * The one answer to "should this world's engine be paused by the user?":
 * Pause all OR the world's own Stay offline. Every pause/resume handler and
 * attach read this, so neither switch can undo the other (S367 critic C7).
 */
export function effectiveSyncPaused(
  entry: Pick<WorldRegistryEntry, 'sync_paused'> | null | undefined,
  reg: Pick<WorldsRegistry, 'sync_pause_all'>,
): boolean {
  return !!reg.sync_pause_all || !!entry?.sync_paused;
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
  show_element_images: boolean;
  hide_empty_fields: boolean;
} {
  return {
    field_edit_mode: reg.editor_settings?.field_edit_mode ?? 'modal',
    refs_group_by_field: reg.editor_settings?.refs_group_by_field ?? false,
    confirm_before_delete: reg.editor_settings?.confirm_before_delete ?? true,
    show_element_images: reg.editor_settings?.show_element_images ?? true,
    hide_empty_fields: reg.editor_settings?.hide_empty_fields ?? false,
  };
}
