/**
 * Two tabs, one registry (S365 lane B M2): a save merges per entry against
 * this tab's own view, so an entry this tab did not change comes from
 * storage as it is now. Each case is a way a second tab used to lose or
 * resurrect something.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadRegistry, saveRegistry, mergeRegistry, __setRegistryTabBaseForTests,
} from '../../src/registry/registry';
import { REGISTRY_STORAGE_KEY } from '../../src/core/constants';
import { defaultRegistry } from '../../src/core/types';
import type { WorldRegistryEntry, WorldsRegistry } from '../../src/core/types';

const w = (id: string, extra: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry => ({
  id, name: id, state: 'local-only', folder: { handle_key: `k-${id}`, folder_name: id }, created_at: 'x', ...extra,
} as WorldRegistryEntry);
const reg = (...worlds: WorldRegistryEntry[]): WorldsRegistry => ({ ...defaultRegistry(), worlds });
const stored = (): WorldsRegistry => JSON.parse(localStorage.getItem(REGISTRY_STORAGE_KEY)!) as WorldsRegistry;
const byId = (r: WorldsRegistry, id: string) => r.worlds.find(x => x.id === id);

/** Tab A saves `a`, then tab B (whose view is `bView`) saves `bNext`. */
function twoTabs(bView: WorldsRegistry, a: WorldsRegistry, bNext: WorldsRegistry): WorldsRegistry {
  __setRegistryTabBaseForTests(bView); // both tabs loaded the same registry
  saveRegistry(a);
  __setRegistryTabBaseForTests(bView);
  saveRegistry(bNext);
  return stored();
}

beforeEach(() => { localStorage.clear(); __setRegistryTabBaseForTests(null); });

describe('a second tab saving its older copy', () => {
  it('keeps notes typed in the other tab', () => {
    const start = reg(w('W', { notes: 'old' }), w('V'));
    saveRegistry(start);
    const out = twoTabs(
      start,
      reg(w('W', { notes: 'typed in tab A' }), w('V')),
      reg(w('W', { notes: 'old' }), w('V', { last_opened_at: 'now' })),
    );
    expect(byId(out, 'W')?.notes).toBe('typed in tab A');
    expect(byId(out, 'V')?.last_opened_at).toBe('now');
  });

  it('keeps a Make Online done in the other tab', () => {
    const start = reg(w('W'), w('V'));
    saveRegistry(start);
    const online = w('W', { state: 'api-linked', api: { world_id: 'W', api_key: 'ow_w_x' } } as Partial<WorldRegistryEntry>);
    const out = twoTabs(start, reg(online, w('V')), reg(w('W'), w('V', { last_opened_at: 'now' })));
    expect(byId(out, 'W')?.state).toBe('api-linked');
  });

  it('keeps a world the other tab added, and drops one the other tab forgot', () => {
    const start = reg(w('W'), w('V'));
    saveRegistry(start);
    const out = twoTabs(start, reg(w('V'), w('NEW')), reg(w('W'), w('V', { last_opened_at: 'now' })));
    expect(out.worlds.map(x => x.id).sort()).toEqual(['NEW', 'V']);
  });

  it('a top-level field the saving tab did not change comes from storage', () => {
    const start = reg(w('W'));
    saveRegistry(start);
    const out = twoTabs(start, { ...start, global_pin: '9999' } as WorldsRegistry, reg(w('W', { notes: 'b' })));
    expect((out as unknown as { global_pin?: string }).global_pin).toBe('9999');
    expect(byId(out, 'W')?.notes).toBe('b');
  });
});

describe('what this tab changed is this tab\'s', () => {
  it('the later save of the SAME entry wins (unchanged behaviour)', () => {
    const start = reg(w('W', { notes: 'old' }));
    saveRegistry(start);
    const out = twoTabs(start, reg(w('W', { notes: 'A' })), reg(w('W', { notes: 'B' })));
    expect(byId(out, 'W')?.notes).toBe('B');
  });

  it('a world this tab removed stays removed', () => {
    loadRegistry();
    saveRegistry(reg(w('W'), w('V')));
    saveRegistry(reg(w('V')));
    expect(stored().worlds.map(x => x.id)).toEqual(['V']);
  });
});

describe('storage that is empty or unreadable', () => {
  it('a save after the storage was cleared does not bring the forgotten worlds back', () => {
    saveRegistry(reg(w('W')));
    loadRegistry();
    localStorage.clear();
    saveRegistry(reg(w('W'), w('ADDED')));
    expect(stored().worlds.map(x => x.id)).toEqual(['ADDED']);
  });

  it('an unreadable stored registry is written over whole, as before', () => {
    loadRegistry();
    saveRegistry(reg(w('W')));
    localStorage.setItem(REGISTRY_STORAGE_KEY, 'not json');
    saveRegistry(reg(w('W'), w('V')));
    expect(stored().worlds.map(x => x.id)).toEqual(['W', 'V']);
  });
});

describe('mergeRegistry (pure)', () => {
  it('with base = mine the result is the stored registry', () => {
    const mine = reg(w('W'));
    const s = reg(w('W', { notes: 'other' }), w('X'));
    expect(mergeRegistry(structuredClone(mine), mine, s)).toEqual(s);
  });
});
