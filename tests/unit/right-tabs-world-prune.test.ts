/**
 * Pruning persisted right-pane tabs for a DELETED world.
 *
 * The guided tour's residue contract promises it leaves nothing behind. It
 * tore down the registry entry, the handle and the OPFS folder, but the
 * persisted right-tab snapshot kept a map tab stamped with the dead world's
 * id — so the first world a tour-finisher created opened with a ghost
 * "Hyperion" tab reading "This map isn't in the current world".
 *
 * Ordinary world SWITCHES must keep their tabs (DESIGN_MAPS.md §5); only
 * deletion prunes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  dropPersistedTabsForWorld,
  loadPersistedRightTabs,
  savePersistedRightTabs,
} from '../../src/tabs/right/right-tabs-persistence';
import type { RightTabRef } from '../../src/core/types';

const DEAD = 'tour-world-id';
const LIVE = 'real-world-id';

const mapTab = (mapId: string, worldId: string, label = 'Hyperion'): RightTabRef =>
  ({ kind: 'map', mapId, label, worldId }) as RightTabRef;

beforeEach(() => {
  localStorage.clear();
});

describe('dropPersistedTabsForWorld', () => {
  it('removes map tabs of the dead world and keeps everyone else', () => {
    savePersistedRightTabs(
      [{ kind: 'context' }, { kind: 'map-index' }, mapTab('m1', DEAD), mapTab('m2', LIVE, 'Sikelia')],
      0,
    );
    dropPersistedTabsForWorld(DEAD);
    const after = loadPersistedRightTabs();
    expect(after?.tabs.some(t => t.kind === 'map' && t.mapId === 'm1')).toBe(false);
    expect(after?.tabs.some(t => t.kind === 'map' && t.mapId === 'm2')).toBe(true);
    expect(after?.tabs.some(t => t.kind === 'context')).toBe(true);
    expect(after?.tabs.some(t => t.kind === 'map-index')).toBe(true);
  });

  it('shifts the active index left by what was dropped before it', () => {
    // active points at the LIVE map (index 3); dropping the dead tab at
    // index 2 must leave the same tab selected, not the one beside it.
    savePersistedRightTabs(
      [{ kind: 'context' }, { kind: 'map-index' }, mapTab('m1', DEAD), mapTab('m2', LIVE, 'Sikelia')],
      3,
    );
    dropPersistedTabsForWorld(DEAD);
    const after = loadPersistedRightTabs();
    expect(after?.activeIndex).toBe(2);
    const active = after?.tabs[after.activeIndex];
    expect(active?.kind === 'map' && active.mapId).toBe('m2');
  });

  it('clamps the active index when the dropped tab WAS the active one', () => {
    savePersistedRightTabs([{ kind: 'context' }, { kind: 'map-index' }, mapTab('m1', DEAD)], 2);
    dropPersistedTabsForWorld(DEAD);
    const after = loadPersistedRightTabs();
    expect(after?.tabs).toHaveLength(2);
    expect(after?.activeIndex).toBe(1);
  });

  it('leaves the snapshot untouched when the world owns no tabs (idempotent)', () => {
    savePersistedRightTabs([{ kind: 'context' }, { kind: 'map-index' }, mapTab('m2', LIVE)], 2);
    const before = localStorage.getItem('atlas_right_tabs');
    dropPersistedTabsForWorld(DEAD);
    expect(localStorage.getItem('atlas_right_tabs')).toBe(before);
  });

  it('is safe on an empty store', () => {
    expect(() => dropPersistedTabsForWorld(DEAD)).not.toThrow();
    expect(loadPersistedRightTabs()).toBeNull();
  });

  it('running twice changes nothing the second time', () => {
    savePersistedRightTabs([{ kind: 'context' }, { kind: 'map-index' }, mapTab('m1', DEAD)], 2);
    dropPersistedTabsForWorld(DEAD);
    const once = localStorage.getItem('atlas_right_tabs');
    dropPersistedTabsForWorld(DEAD);
    expect(localStorage.getItem('atlas_right_tabs')).toBe(once);
  });
});
