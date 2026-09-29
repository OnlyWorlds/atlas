/**
 * Re-key (S363): browser-persisted state follows the id map.
 * One describe per remapper; each seeds the module's real storage key.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rekeyRegistryEntry } from '../../src/registry/registry';
import { defaultRegistry } from '../../src/core/types';
import type { WorldsRegistry } from '../../src/core/types';
import { remapPersistedTabs } from '../../src/tabs/right/right-tabs-persistence';
import { remapCameraStates } from '../../src/core/map-camera-persist';
import { remapMapViewPrefs } from '../../src/core/map-view-prefs';
import { remapRecents } from '../../src/middle/writing-workspace-recents';
import { remapDraftStash } from '../../src/middle/knowledge-room';
import { remapTourReturnHash } from '../../src/tour/tour-engine';
import { elementHash } from '../../src/core/router';
import {
  RIGHT_TABS_STORAGE_KEY, MAP_CAMERA_STATE_KEY, MAP_VIEW_PREFS_BY_MAP_KEY,
  KNOWLEDGE_DRAFT_STASH_PREFIX,
} from '../../src/core/constants';

const MAP = new Map([['O', 'N']]);
const j = (k: string): any => JSON.parse(localStorage.getItem(k) as string);

beforeEach(() => { localStorage.clear(); });

describe('rekeyRegistryEntry', () => {
  function reg(): WorldsRegistry {
    const base = defaultRegistry();
    return {
      ...base,
      worlds: [
        { id: 'w1', favorites: { protagonist_id: 'O', nexus_id: 'O' }, active_calendar_id: 'O',
          writing_tree_collapsed: ['O', 'keep'], last_writing_narrative_id: 'O' },
        { id: 'w2', favorites: { protagonist_id: 'O' }, active_calendar_id: 'O',
          writing_tree_collapsed: ['O'], last_writing_narrative_id: 'O' },
      ] as any,
    };
  }
  it('remaps every id field of that world only', () => {
    const r = rekeyRegistryEntry(reg(), 'w1', MAP);
    const w1: any = r.worlds[0]; const w2: any = r.worlds[1];
    expect(w1.favorites).toEqual({ protagonist_id: 'N', nexus_id: 'N' });
    expect(w1.active_calendar_id).toBe('N');
    expect(w1.writing_tree_collapsed).toEqual(['N', 'keep']);
    expect(w1.last_writing_narrative_id).toBe('N');
    expect(w2.favorites.protagonist_id).toBe('O');
    expect(w2.writing_tree_collapsed).toEqual(['O']);
    expect(w2.last_writing_narrative_id).toBe('O');
  });
  it('returns the same object when nothing matches', () => {
    const r = reg();
    expect(rekeyRegistryEntry(r, 'w1', new Map([['X', 'Y']]))).toBe(r);
    expect(rekeyRegistryEntry(r, 'nope', MAP)).toBe(r);
  });
});

describe('remapPersistedTabs', () => {
  it('rewrites map tabs of that world, leaves other worlds and non-map tabs', () => {
    localStorage.setItem(RIGHT_TABS_STORAGE_KEY, JSON.stringify({
      tabs: [{ kind: 'context' }, { kind: 'map-index' },
        { kind: 'map', mapId: 'O', label: 'a', worldId: 'w1' },
        { kind: 'map', mapId: 'O', label: 'b', worldId: 'w2' }],
      activeIndex: 2,
    }));
    remapPersistedTabs('w1', MAP);
    const s = j(RIGHT_TABS_STORAGE_KEY);
    expect(s.tabs[2].mapId).toBe('N');
    expect(s.tabs[3].mapId).toBe('O');
    expect(s.activeIndex).toBe(2);
  });
  it('is a no-op on absent or malformed storage', () => {
    expect(() => remapPersistedTabs('w1', MAP)).not.toThrow();
    localStorage.setItem(RIGHT_TABS_STORAGE_KEY, '{bad');
    expect(() => remapPersistedTabs('w1', MAP)).not.toThrow();
  });
});

describe('remapCameraStates', () => {
  it('moves the entry to the new id', () => {
    localStorage.setItem(MAP_CAMERA_STATE_KEY, JSON.stringify({
      O: { center: [1, 2], zoom: 3 }, other: { center: [4, 5], zoom: 6 },
    }));
    remapCameraStates(MAP);
    const s = j(MAP_CAMERA_STATE_KEY);
    expect(s.N).toEqual({ center: [1, 2], zoom: 3 });
    expect('O' in s).toBe(false);
    expect(s.other.zoom).toBe(6);
  });
});

describe('remapMapViewPrefs', () => {
  it('moves the override to the new id and keeps the rest', () => {
    localStorage.setItem(MAP_VIEW_PREFS_BY_MAP_KEY, JSON.stringify({ O: { a: 1 }, other: { b: 2 } }));
    remapMapViewPrefs('w1', MAP);
    const s = j(MAP_VIEW_PREFS_BY_MAP_KEY);
    expect(s.N).toEqual({ a: 1 });
    expect('O' in s).toBe(false);
    expect(s.other).toEqual({ b: 2 });
  });
});

describe('remapCollapsedMapIds', () => {
  const KEY = 'atlas_map_tree_collapsed_v1';
  it('remaps memory and storage, and a later toggle keeps N', async () => {
    localStorage.setItem(KEY, JSON.stringify({ w1: ['O', 'keep'], w2: ['O'] }));
    vi.resetModules();
    const m = await import('../../src/tabs/right/map-index-tab');
    m.remapCollapsedMapIds('w1', MAP);
    expect(j(KEY).w1.sort()).toEqual(['N', 'keep']);
    expect(j(KEY).w2).toEqual(['O']);
    m.toggleNodeCollapsed('w1', 'another');
    const after = j(KEY);
    expect(after.w1).toContain('N');
    expect(after.w1).not.toContain('O');
    expect(after.w2).toEqual(['O']);
  });
});

describe('remapRecents', () => {
  it('remaps in order, other worlds untouched', () => {
    localStorage.setItem('atlas_picker_recents_w1', JSON.stringify(['a', 'O', 'b']));
    localStorage.setItem('atlas_picker_recents_w2', JSON.stringify(['O']));
    remapRecents('w1', MAP);
    expect(j('atlas_picker_recents_w1')).toEqual(['a', 'N', 'b']);
    expect(j('atlas_picker_recents_w2')).toEqual(['O']);
  });
});

describe('remapDraftStash', () => {
  it('remaps ids, prose links and the rich-text sidecar', () => {
    const chip = { type: 'elementChip', attrs: { id: 'O', type: 'character', label: 'Ann' } };
    localStorage.setItem(KNOWLEDGE_DRAFT_STASH_PREFIX + 'w1', JSON.stringify({
      name: 'n', story: 'see [Ann](ow://character/O) now',
      richtextJson: { type: 'doc', content: [{ type: 'paragraph', content: [chip] }] },
      narrator: 'O', collectives: ['O', 'c'], aboutIds: ['x', 'O'],
    }));
    localStorage.setItem(KNOWLEDGE_DRAFT_STASH_PREFIX + 'w2', JSON.stringify({ narrator: 'O', story: '(ow://character/O)' }));
    remapDraftStash('w1', MAP);
    const d = j(KNOWLEDGE_DRAFT_STASH_PREFIX + 'w1');
    expect(d.narrator).toBe('N');
    expect(d.collectives).toEqual(['N', 'c']);
    expect(d.aboutIds).toEqual(['x', 'N']);
    expect(d.story).toBe('see [Ann](ow://character/N) now');
    expect(d.richtextJson.content[0].content[0].attrs.id).toBe('N');
    expect(j(KNOWLEDGE_DRAFT_STASH_PREFIX + 'w2').narrator).toBe('O');
  });
});

describe('remapTourReturnHash', () => {
  it('rewrites the saved return hash for that world', () => {
    localStorage.setItem('atlas_tour_v1', JSON.stringify({
      active: true, step: 2, worldId: 'tour', returnHash: elementHash('w1', 'O'),
    }));
    remapTourReturnHash('w1', MAP);
    expect(j('atlas_tour_v1').returnHash).toBe(elementHash('w1', 'N'));
    expect(j('atlas_tour_v1').step).toBe(2);
  });
  it('leaves another world return hash alone', () => {
    const h = elementHash('w2', 'O');
    localStorage.setItem('atlas_tour_v1', JSON.stringify({ active: true, step: 2, worldId: 'tour', returnHash: h }));
    remapTourReturnHash('w1', MAP);
    expect(j('atlas_tour_v1').returnHash).toBe(h);
  });
});
