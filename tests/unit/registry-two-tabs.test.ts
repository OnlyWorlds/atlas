/**
 * PROMOTED from the S365 composition gate (lens A, kernel): two tabs, one registry: the per-field merge.
 * Each asserts the fixed behaviour; red on the code before the S365 gate fixes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadRegistry, saveRegistry, setActiveWorld, __setRegistryTabBaseForTests,
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

beforeEach(() => { localStorage.clear(); __setRegistryTabBaseForTests(null); });

describe('A1: the second tab opens the SAME world the first tab changed', () => {
  it('tab B switching to W (stamps last_opened_at on its stale W) keeps the notes typed in tab A', () => {
    const start = reg(w('W', { notes: 'old' }), w('V'));
    saveRegistry(start);
    const tabB = structuredClone(start);
    // Tab A types notes into W.
    __setRegistryTabBaseForTests(start);
    saveRegistry(reg(w('W', { notes: 'typed in tab A' }), w('V')));
    // Tab B (still holding `start`) clicks W in its worlds list.
    __setRegistryTabBaseForTests(tabB);
    saveRegistry(setActiveWorld(tabB, 'W'));
    expect(byId(stored(), 'W')?.notes).toBe('typed in tab A');
    expect(byId(stored(), 'W')?.last_opened_at).toBeTruthy();
  });

  it('tab B switching to W keeps a Make Online done on W in tab A', () => {
    const start = reg(w('W'), w('V'));
    saveRegistry(start);
    const tabB = structuredClone(start);
    __setRegistryTabBaseForTests(start);
    saveRegistry(reg(w('W', { state: 'api-linked', api: { world_id: 'W', api_key: 'ow_w_x' } } as Partial<WorldRegistryEntry>), w('V')));
    __setRegistryTabBaseForTests(tabB);
    saveRegistry(setActiveWorld(tabB, 'W'));
    expect(byId(stored(), 'W')?.state).toBe('api-linked');
    expect(byId(stored(), 'W')?.api?.api_key).toBe('ow_w_x');
  });
});

