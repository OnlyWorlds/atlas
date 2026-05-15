/**
 * Registry — pure-function tests.
 *
 * Each helper is registry-in → registry-out. Persistence is tested separately
 * via load/save round-trip through jsdom's localStorage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defaultRegistry } from '../../src/core/types';
import {
  attachApi,
  childrenOf,
  createApiLinkedWorld,
  createLocalWorld,
  deleteWorldEntry,
  detachApi,
  findLinkedWorld,
  findWorld,
  getWorldRightTabs,
  isDescendantOf,
  loadRegistry,
  renameWorld,
  saveRegistry,
  setActiveWorld,
  setApiWorldName,
  setEmail,
  setFavorite,
  setParent,
  setPin,
  setSyncPullOnActivate,
  setSyncCadenceMs,
  setSyncDefaultPolicy,
  setSyncConfirmServerDeletes,
  setSyncPauseAll,
  setWorldPaused,
  setWorldRightTabs,
  setMapsSettings,
  getMapsSettings,
} from '../../src/registry/registry';

beforeEach(() => {
  localStorage.clear();
});

describe('registry — persistence', () => {
  it('loadRegistry returns default when empty', () => {
    const reg = loadRegistry();
    expect(reg).toEqual({ version: 1, worlds: [] });
  });

  it('save then load round-trips', () => {
    const start = defaultRegistry();
    const { next } = createLocalWorld(start, {
      name: 'Eldoria',
      folderName: 'eldoria-abc12',
      handleKey: 'vault-1',
    });
    saveRegistry(next);
    const loaded = loadRegistry();
    expect(loaded.worlds).toHaveLength(1);
    expect(loaded.worlds[0].name).toBe('Eldoria');
  });

  it('loadRegistry resets on malformed json', () => {
    localStorage.setItem('atlas_worlds_registry', 'not json');
    const reg = loadRegistry();
    expect(reg).toEqual({ version: 1, worlds: [] });
  });

  it('loadRegistry resets when worlds array is missing', () => {
    localStorage.setItem('atlas_worlds_registry', JSON.stringify({ version: 1 }));
    const reg = loadRegistry();
    expect(reg).toEqual({ version: 1, worlds: [] });
  });
});

describe('registry — createLocalWorld', () => {
  it('appends a local-only entry with folder', () => {
    const { next, entry } = createLocalWorld(defaultRegistry(), {
      name: 'Arda',
      folderName: 'arda-xyz',
      handleKey: 'vault-arda',
    });
    expect(next.worlds).toHaveLength(1);
    expect(entry.state).toBe('local-only');
    expect(entry.folder.folder_name).toBe('arda-xyz');
    expect(entry.api).toBeUndefined();
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('defaults to "untitled world" when name is blank', () => {
    const { entry } = createLocalWorld(defaultRegistry(), {
      name: '   ',
      folderName: 'x',
      handleKey: 'k',
    });
    expect(entry.name).toBe('untitled world');
  });

  it('respects parentId for nesting', () => {
    const { next: r1, entry: parent } = createLocalWorld(defaultRegistry(), {
      name: 'parent', folderName: 'p', handleKey: 'k1',
    });
    const { entry: child } = createLocalWorld(r1, {
      name: 'child', folderName: 'c', handleKey: 'k2', parentId: parent.id,
    });
    expect(child.parent_id).toBe(parent.id);
  });
});

describe('registry — createApiLinkedWorld', () => {
  it('creates an api-linked entry with both folder and api credentials', () => {
    const { entry } = createApiLinkedWorld(defaultRegistry(), {
      name: 'Sync World',
      apiWorldId: 'srv-12345',
      apiKey: 'key-abcde',
      folderName: 'sync-world-x',
      handleKey: 'vault-sw',
    });
    expect(entry.state).toBe('api-linked');
    expect(entry.api).toEqual({ world_id: 'srv-12345', api_key: 'key-abcde' });
    expect(entry.folder.folder_name).toBe('sync-world-x');
  });
});

describe('registry — attachApi / detachApi (Make-Online transitions)', () => {
  it('attachApi flips a local-only entry to api-linked in place', () => {
    const { next: r1, entry } = createLocalWorld(defaultRegistry(), {
      name: 'Local Eldoria', folderName: 'eldoria', handleKey: 'k',
    });
    const r2 = attachApi(r1, entry.id, { worldId: 'srv-99', apiKey: 'key-99' });
    expect(r2.worlds).toHaveLength(1);
    expect(r2.worlds[0].state).toBe('api-linked');
    expect(r2.worlds[0].api).toEqual({ world_id: 'srv-99', api_key: 'key-99' });
    expect(r2.worlds[0].folder.folder_name).toBe('eldoria');
  });

  it('detachApi removes api credentials and flips back to local-only', () => {
    const { next: r1, entry } = createApiLinkedWorld(defaultRegistry(), {
      name: 'World', apiWorldId: 'srv', apiKey: 'k', folderName: 'w', handleKey: 'h',
    });
    const r2 = detachApi(r1, entry.id);
    expect(r2.worlds[0].state).toBe('local-only');
    expect(r2.worlds[0].api).toBeUndefined();
    expect(r2.worlds[0].folder.folder_name).toBe('w');
  });

  it('attachApi → detachApi → attachApi cycles without data loss', () => {
    const { next: r1, entry } = createLocalWorld(defaultRegistry(), {
      name: 'Cycle', folderName: 'c', handleKey: 'h',
    });
    const r2 = attachApi(r1, entry.id, { worldId: 'a', apiKey: 'k1' });
    const r3 = detachApi(r2, entry.id);
    const r4 = attachApi(r3, entry.id, { worldId: 'b', apiKey: 'k2' });
    expect(r4.worlds[0].state).toBe('api-linked');
    expect(r4.worlds[0].api?.world_id).toBe('b');
    expect(r4.worlds[0].folder.folder_name).toBe('c');
  });

  // Bout Z — cache the server-side world name so settings can flag when local
  // and api names diverge (e.g., user picked a different display name during
  // Make-Online). attachApi accepts an optional worldName; setApiWorldName
  // refreshes it when Test Connection fetches a different name later.
  it('attachApi persists worldName when supplied', () => {
    const { next: r1, entry } = createLocalWorld(defaultRegistry(), {
      name: 'My Working Name', folderName: 'work', handleKey: 'h',
    });
    const r2 = attachApi(r1, entry.id, { worldId: 'srv-1', apiKey: 'k', worldName: 'Cool World v1' });
    expect(r2.worlds[0].api?.world_name).toBe('Cool World v1');
    // Local name untouched — different identities by design.
    expect(r2.worlds[0].name).toBe('My Working Name');
  });

  it('attachApi omits worldName when not supplied (no spurious key)', () => {
    const { next: r1, entry } = createLocalWorld(defaultRegistry(), {
      name: 'Plain', folderName: 'p', handleKey: 'h',
    });
    const r2 = attachApi(r1, entry.id, { worldId: 'srv-2', apiKey: 'k' });
    expect(r2.worlds[0].api).toEqual({ world_id: 'srv-2', api_key: 'k' });
    expect(r2.worlds[0].api?.world_name).toBeUndefined();
  });

  it('setApiWorldName refreshes the cached name on an already-linked world', () => {
    const { next: r1, entry } = createLocalWorld(defaultRegistry(), {
      name: 'Local', folderName: 'l', handleKey: 'h',
    });
    const r2 = attachApi(r1, entry.id, { worldId: 'srv', apiKey: 'k', worldName: 'Old Name' });
    expect(r2.worlds[0].api?.world_name).toBe('Old Name');
    const r3 = setApiWorldName(r2, entry.id, 'New Name');
    expect(r3.worlds[0].api?.world_name).toBe('New Name');
    // Other api fields untouched.
    expect(r3.worlds[0].api?.world_id).toBe('srv');
    expect(r3.worlds[0].api?.api_key).toBe('k');
  });

  it('setApiWorldName is a no-op on a local-only world', () => {
    const { next: r1, entry } = createLocalWorld(defaultRegistry(), {
      name: 'Local', folderName: 'l', handleKey: 'h',
    });
    const r2 = setApiWorldName(r1, entry.id, 'Should Not Appear');
    expect(r2.worlds[0].api).toBeUndefined();
    expect(r2.worlds[0].state).toBe('local-only');
  });

  it('detachApi drops the cached worldName along with everything else in api', () => {
    const { next: r1, entry } = createApiLinkedWorld(defaultRegistry(), {
      name: 'W', apiWorldId: 's', apiKey: 'k', folderName: 'w', handleKey: 'h',
      apiWorldName: 'Server Side Name',
    });
    expect(r1.worlds[0].api?.world_name).toBe('Server Side Name');
    const r2 = detachApi(r1, entry.id);
    expect(r2.worlds[0].api).toBeUndefined();
  });
});

describe('registry — rename / delete / active / favorite', () => {
  it('renameWorld updates the entry', () => {
    const { next, entry } = createLocalWorld(defaultRegistry(), { name: 'old', folderName: 'f', handleKey: 'h' });
    const r2 = renameWorld(next, entry.id, 'new');
    expect(findWorld(r2, entry.id)?.name).toBe('new');
  });

  it('renameWorld ignores blank input', () => {
    const { next, entry } = createLocalWorld(defaultRegistry(), { name: 'keep', folderName: 'f', handleKey: 'h' });
    const r2 = renameWorld(next, entry.id, '   ');
    expect(findWorld(r2, entry.id)?.name).toBe('keep');
  });

  it('deleteWorldEntry removes the entry and re-parents children', () => {
    const { next: r1, entry: parent } = createLocalWorld(defaultRegistry(), { name: 'p', folderName: 'p', handleKey: 'k1' });
    const { next: r2, entry: child } = createLocalWorld(r1, {
      name: 'c', folderName: 'c', handleKey: 'k2', parentId: parent.id,
    });
    const r3 = deleteWorldEntry(r2, parent.id);
    expect(r3.worlds).toHaveLength(1);
    expect(findWorld(r3, child.id)?.parent_id).toBeUndefined();
  });

  it('deleteWorldEntry clears active_world_id if it was the deleted one', () => {
    const { next: r1, entry } = createLocalWorld(defaultRegistry(), { name: 'x', folderName: 'x', handleKey: 'h' });
    const r2 = setActiveWorld(r1, entry.id);
    expect(r2.active_world_id).toBe(entry.id);
    const r3 = deleteWorldEntry(r2, entry.id);
    expect(r3.active_world_id).toBeUndefined();
  });

  it('setActiveWorld stamps last_opened_at on the chosen world', () => {
    const { next: r1, entry } = createLocalWorld(defaultRegistry(), { name: 'a', folderName: 'a', handleKey: 'h' });
    const beforeStamp = findWorld(r1, entry.id)!.last_opened_at!;
    // Force a small clock advance by simulating later setActive.
    const r2 = setActiveWorld(r1, entry.id);
    const afterStamp = findWorld(r2, entry.id)!.last_opened_at!;
    expect(afterStamp >= beforeStamp).toBe(true);
  });

  it('setActiveWorld(undefined) clears active', () => {
    const { next: r1, entry } = createLocalWorld(defaultRegistry(), { name: 'a', folderName: 'a', handleKey: 'h' });
    const r2 = setActiveWorld(r1, entry.id);
    const r3 = setActiveWorld(r2, undefined);
    expect(r3.active_world_id).toBeUndefined();
  });

  it('setFavorite toggles the flag', () => {
    const { next, entry } = createLocalWorld(defaultRegistry(), { name: 'a', folderName: 'a', handleKey: 'h' });
    const r2 = setFavorite(next, entry.id, true);
    expect(findWorld(r2, entry.id)?.favorite).toBe(true);
    const r3 = setFavorite(r2, entry.id, false);
    expect(findWorld(r3, entry.id)?.favorite).toBe(false);
  });
});

describe('registry — nesting helpers', () => {
  it('childrenOf returns direct children only', () => {
    const { next: r1, entry: parent } = createLocalWorld(defaultRegistry(), { name: 'p', folderName: 'p', handleKey: 'k' });
    const { next: r2, entry: childA } = createLocalWorld(r1, {
      name: 'a', folderName: 'a', handleKey: 'k', parentId: parent.id,
    });
    const { next: r3, entry: childB } = createLocalWorld(r2, {
      name: 'b', folderName: 'b', handleKey: 'k', parentId: parent.id,
    });
    const { next: r4 } = createLocalWorld(r3, {
      name: 'grand', folderName: 'g', handleKey: 'k', parentId: childA.id,
    });
    expect(childrenOf(r4, parent.id).map(w => w.id).sort()).toEqual([childA.id, childB.id].sort());
    expect(childrenOf(r4, childA.id)).toHaveLength(1);
  });

  it('isDescendantOf returns true for direct + indirect descendants', () => {
    const { next: r1, entry: parent } = createLocalWorld(defaultRegistry(), { name: 'p', folderName: 'p', handleKey: 'k' });
    const { next: r2, entry: mid } = createLocalWorld(r1, {
      name: 'm', folderName: 'm', handleKey: 'k', parentId: parent.id,
    });
    const { next: r3, entry: leaf } = createLocalWorld(r2, {
      name: 'l', folderName: 'l', handleKey: 'k', parentId: mid.id,
    });
    expect(isDescendantOf(r3, leaf.id, parent.id)).toBe(true);
    expect(isDescendantOf(r3, leaf.id, mid.id)).toBe(true);
    expect(isDescendantOf(r3, parent.id, leaf.id)).toBe(false);
  });

  it('setParent rejects cycles', () => {
    const { next: r1, entry: a } = createLocalWorld(defaultRegistry(), { name: 'a', folderName: 'a', handleKey: 'k' });
    const { next: r2, entry: b } = createLocalWorld(r1, {
      name: 'b', folderName: 'b', handleKey: 'k', parentId: a.id,
    });
    // Trying to make a a child of b (its descendant) → no-op.
    const r3 = setParent(r2, a.id, b.id);
    expect(findWorld(r3, a.id)?.parent_id).toBeUndefined();
  });

  it('setParent rejects self-parenting', () => {
    const { next, entry } = createLocalWorld(defaultRegistry(), { name: 'a', folderName: 'a', handleKey: 'k' });
    const r2 = setParent(next, entry.id, entry.id);
    expect(findWorld(r2, entry.id)?.parent_id).toBeUndefined();
  });
});

describe('registry — global identity (PIN + email)', () => {
  it('setPin / setEmail store on registry root', () => {
    const r1 = setPin(defaultRegistry(), '1234');
    const r2 = setEmail(r1, 'titus@example.com');
    expect(r2.pin).toBe('1234');
    expect(r2.email).toBe('titus@example.com');
  });

  it('setPin trims whitespace and treats empty as undefined', () => {
    const r1 = setPin(defaultRegistry(), '  9876  ');
    expect(r1.pin).toBe('9876');
    const r2 = setPin(r1, '   ');
    expect(r2.pin).toBeUndefined();
  });

  it('setEmail same treatment as setPin', () => {
    const r1 = setEmail(defaultRegistry(), '  a@b  ');
    expect(r1.email).toBe('a@b');
    const r2 = setEmail(r1, '');
    expect(r2.email).toBeUndefined();
  });
});

describe('registry — sync settings (Phase 3.5+)', () => {
  it('setSyncPullOnActivate stores boolean', () => {
    const r1 = setSyncPullOnActivate(defaultRegistry(), true);
    expect(r1.sync_pull_on_activate).toBe(true);
    const r2 = setSyncPullOnActivate(r1, false);
    expect(r2.sync_pull_on_activate).toBe(false);
  });

  it('setSyncCadenceMs accepts number or null (off)', () => {
    const r1 = setSyncCadenceMs(defaultRegistry(), 5 * 60_000);
    expect(r1.sync_cadence_ms).toBe(300_000);
    const r2 = setSyncCadenceMs(r1, null);
    expect(r2.sync_cadence_ms).toBeNull();
  });

  it('setSyncDefaultPolicy stores the chosen policy', () => {
    const r1 = setSyncDefaultPolicy(defaultRegistry(), 'pause-and-review');
    expect(r1.sync_default_policy).toBe('pause-and-review');
    const r2 = setSyncDefaultPolicy(r1, 'local-wins');
    expect(r2.sync_default_policy).toBe('local-wins');
  });

  it('setSyncConfirmServerDeletes stores boolean', () => {
    const r1 = setSyncConfirmServerDeletes(defaultRegistry(), false);
    expect(r1.sync_confirm_server_deletes).toBe(false);
  });

  it('setSyncPauseAll stores boolean', () => {
    const r1 = setSyncPauseAll(defaultRegistry(), true);
    expect(r1.sync_pause_all).toBe(true);
  });

  it('setWorldPaused only flips the named world', () => {
    let reg = defaultRegistry();
    reg = createLocalWorld(reg, { name: 'A', folderName: 'a', handleKey: 'kA' }).next;
    reg = createLocalWorld(reg, { name: 'B', folderName: 'b', handleKey: 'kB' }).next;
    const targetId = reg.worlds[0].id;
    const after = setWorldPaused(reg, targetId, true);
    expect(after.worlds[0].sync_paused).toBe(true);
    expect(after.worlds[1].sync_paused).toBeUndefined();
  });

  it('all sync settings round-trip through save/load', () => {
    let reg = setSyncPullOnActivate(defaultRegistry(), true);
    reg = setSyncCadenceMs(reg, 60_000);
    reg = setSyncDefaultPolicy(reg, 'pause-and-review');
    reg = setSyncConfirmServerDeletes(reg, false);
    reg = setSyncPauseAll(reg, true);
    saveRegistry(reg);
    const loaded = loadRegistry();
    expect(loaded.sync_pull_on_activate).toBe(true);
    expect(loaded.sync_cadence_ms).toBe(60_000);
    expect(loaded.sync_default_policy).toBe('pause-and-review');
    expect(loaded.sync_confirm_server_deletes).toBe(false);
    expect(loaded.sync_pause_all).toBe(true);
  });

  it('findLinkedWorld returns the world linked to a given api world id', () => {
    let reg = defaultRegistry();
    reg = createLocalWorld(reg, { name: 'Local Only', folderName: 'lo', handleKey: 'kL' }).next;
    reg = createApiLinkedWorld(reg, {
      name: 'Linked',
      apiWorldId: 'srv-xyz',
      apiKey: 'key-1',
      folderName: 'linked',
      handleKey: 'kA',
    }).next;
    expect(findLinkedWorld(reg, 'srv-xyz')).toBeDefined();
    expect(findLinkedWorld(reg, 'srv-xyz')!.name).toBe('Linked');
    expect(findLinkedWorld(reg, 'srv-other')).toBeUndefined();
  });

  it('findLinkedWorld can exclude a specific world id (for self-update checks)', () => {
    let reg = defaultRegistry();
    const { next, entry } = createApiLinkedWorld(reg, {
      name: 'Linked',
      apiWorldId: 'srv-xyz',
      apiKey: 'key',
      folderName: 'l',
      handleKey: 'k',
    });
    reg = next;
    // If we exclude that world's own id, no dupe found.
    expect(findLinkedWorld(reg, 'srv-xyz', entry.id)).toBeUndefined();
    // Otherwise the world matches itself.
    expect(findLinkedWorld(reg, 'srv-xyz')).toBeDefined();
  });

  it('migrates legacy policy names on load', () => {
    // Simulate a registry written by an older atlas version.
    const legacy = {
      version: 1,
      worlds: [],
      sync_default_policy: 'drain-blind',
    };
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(legacy));
    expect(loadRegistry().sync_default_policy).toBe('local-wins');

    localStorage.setItem('atlas_worlds_registry', JSON.stringify({ ...legacy, sync_default_policy: 'pause-on-conflict' }));
    expect(loadRegistry().sync_default_policy).toBe('pause-and-review');

    localStorage.setItem('atlas_worlds_registry', JSON.stringify({ ...legacy, sync_default_policy: 'ask' }));
    expect(loadRegistry().sync_default_policy).toBe('pause-and-review');

    // Unknown value → coerced to undefined (engine treats as default).
    localStorage.setItem('atlas_worlds_registry', JSON.stringify({ ...legacy, sync_default_policy: 'gibberish' }));
    expect(loadRegistry().sync_default_policy).toBeUndefined();
  });
});

// ---- Per-world right-tab persistence (DESIGN_MAPS.md §5 / Issue C) ----

describe('registry — right-pane tab persistence', () => {
  function withTwoWorlds(): { reg: ReturnType<typeof defaultRegistry>; aId: string; bId: string } {
    let reg = defaultRegistry();
    const a = createLocalWorld(reg, { name: 'World A', folderName: 'a', handleKey: 'ka' });
    reg = a.next;
    const b = createLocalWorld(reg, { name: 'World B', folderName: 'b', handleKey: 'kb' });
    reg = b.next;
    return { reg, aId: a.entry.id, bId: b.entry.id };
  }

  it('getWorldRightTabs returns null for unknown world', () => {
    const reg = defaultRegistry();
    expect(getWorldRightTabs(reg, 'no-such-id')).toBeNull();
  });

  it('getWorldRightTabs returns null when no snapshot exists', () => {
    const { reg, aId } = withTwoWorlds();
    expect(getWorldRightTabs(reg, aId)).toBeNull();
  });

  it('setWorldRightTabs writes a snapshot, getWorldRightTabs reads it back', () => {
    const { reg, aId } = withTwoWorlds();
    const next = setWorldRightTabs(reg, aId, {
      tabs: [{ kind: 'map-index' }, { kind: 'map', mapId: 'map-1', label: 'World Map' }],
      activeIndex: 1,
    });
    const got = getWorldRightTabs(next, aId);
    expect(got).toEqual({
      tabs: [{ kind: 'map-index' }, { kind: 'map', mapId: 'map-1', label: 'World Map' }],
      activeIndex: 1,
    });
  });

  it('snapshots survive serialization (save + load round-trip)', () => {
    const { reg, aId } = withTwoWorlds();
    const withSnap = setWorldRightTabs(reg, aId, {
      tabs: [{ kind: 'map-index' }, { kind: 'map', mapId: 'm-42', label: 'Atlas' }],
      activeIndex: 1,
    });
    saveRegistry(withSnap);
    const reloaded = loadRegistry();
    expect(getWorldRightTabs(reloaded, aId)).toEqual({
      tabs: [{ kind: 'map-index' }, { kind: 'map', mapId: 'm-42', label: 'Atlas' }],
      activeIndex: 1,
    });
  });

  it('snapshots are isolated per world (the bug behind Issue C)', () => {
    const { reg, aId, bId } = withTwoWorlds();
    let next = setWorldRightTabs(reg, aId, {
      tabs: [{ kind: 'map-index' }, { kind: 'map', mapId: 'A-map', label: "A's map" }],
      activeIndex: 1,
    });
    next = setWorldRightTabs(next, bId, {
      tabs: [{ kind: 'map-index' }],
      activeIndex: 0,
    });
    expect(getWorldRightTabs(next, aId)).toEqual({
      tabs: [{ kind: 'map-index' }, { kind: 'map', mapId: 'A-map', label: "A's map" }],
      activeIndex: 1,
    });
    expect(getWorldRightTabs(next, bId)).toEqual({
      tabs: [{ kind: 'map-index' }],
      activeIndex: 0,
    });
  });

  it('setWorldRightTabs(..., null) clears the snapshot', () => {
    const { reg, aId } = withTwoWorlds();
    const withSnap = setWorldRightTabs(reg, aId, {
      tabs: [{ kind: 'map-index' }],
      activeIndex: 0,
    });
    expect(getWorldRightTabs(withSnap, aId)).not.toBeNull();
    const cleared = setWorldRightTabs(withSnap, aId, null);
    expect(getWorldRightTabs(cleared, aId)).toBeNull();
  });

  it('getWorldRightTabs filters out malformed tab entries defensively', () => {
    // Simulate a corrupted localStorage payload.
    let reg = defaultRegistry();
    reg = createLocalWorld(reg, { name: 'X', folderName: 'x', handleKey: 'kx' }).next;
    const id = reg.worlds[0].id;
    // Inject garbage directly to mimic a tampered registry.
    const malformed = {
      ...reg,
      worlds: reg.worlds.map(w => ({
        ...w,
        right_tabs: {
          tabs: [
            { kind: 'map-index' },
            { kind: 'map', mapId: 'ok', label: 'fine' },
            // bad entries:
            null,
            { kind: 'map' /* missing mapId */ },
            { kind: 'something-else' },
          ],
          activeIndex: 1,
        },
      })),
    };
    saveRegistry(malformed as ReturnType<typeof defaultRegistry>);
    const loaded = loadRegistry();
    const got = getWorldRightTabs(loaded, id);
    expect(got).not.toBeNull();
    expect(got!.tabs).toEqual([
      { kind: 'map-index' },
      { kind: 'map', mapId: 'ok', label: 'fine' },
    ]);
    // activeIndex clamped into valid range.
    expect(got!.activeIndex).toBe(1);
  });

  it('getWorldRightTabs returns null when activeIndex isnt a number (structural invalid)', () => {
    let reg = defaultRegistry();
    reg = createLocalWorld(reg, { name: 'X', folderName: 'x', handleKey: 'kx' }).next;
    const malformed = {
      ...reg,
      worlds: reg.worlds.map(w => ({
        ...w,
        right_tabs: { tabs: [{ kind: 'map-index' }], activeIndex: 'oops' as unknown as number },
      })),
    };
    saveRegistry(malformed as ReturnType<typeof defaultRegistry>);
    const loaded = loadRegistry();
    expect(getWorldRightTabs(loaded, reg.worlds[0].id)).toBeNull();
  });
});

describe('registry — maps settings (DESIGN_MAPS.md §3.5)', () => {
  it('getMapsSettings returns defaults (all three toggles OFF) for a fresh registry', () => {
    const reg = defaultRegistry();
    expect(getMapsSettings(reg)).toEqual({
      show_map_names_in_header: false,
      show_pin_map_names_in_header: false,
      show_pinned_element_names_in_header: false,
    });
  });

  it('setMapsSettings round-trips show_map_names_in_header', () => {
    const reg = defaultRegistry();
    const next = setMapsSettings(reg, { show_map_names_in_header: true });
    expect(next.maps_settings?.show_map_names_in_header).toBe(true);
    expect(getMapsSettings(next).show_map_names_in_header).toBe(true);
  });

  it('setMapsSettings is partial-merge — unset keys retain prior values', () => {
    const reg = setMapsSettings(defaultRegistry(), { show_map_names_in_header: true });
    // Now flip a different toggle on. show_map_names_in_header must persist.
    const next = setMapsSettings(reg, { show_pin_map_names_in_header: true });
    expect(next.maps_settings?.show_map_names_in_header).toBe(true);
    expect(next.maps_settings?.show_pin_map_names_in_header).toBe(true);
  });

  it('all three toggles are independent', () => {
    const reg = setMapsSettings(defaultRegistry(), {
      show_map_names_in_header: true,
      show_pin_map_names_in_header: false,
      show_pinned_element_names_in_header: true,
    });
    const settings = getMapsSettings(reg);
    expect(settings.show_map_names_in_header).toBe(true);
    expect(settings.show_pin_map_names_in_header).toBe(false);
    expect(settings.show_pinned_element_names_in_header).toBe(true);
  });

  it('maps_settings persists across save → load', () => {
    const reg = setMapsSettings(defaultRegistry(), {
      show_map_names_in_header: true,
      show_pinned_element_names_in_header: true,
    });
    saveRegistry(reg);
    const loaded = loadRegistry();
    const settings = getMapsSettings(loaded);
    expect(settings.show_map_names_in_header).toBe(true);
    expect(settings.show_pinned_element_names_in_header).toBe(true);
    expect(settings.show_pin_map_names_in_header).toBe(false);
  });
});
