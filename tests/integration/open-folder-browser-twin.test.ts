/**
 * Opening a world FOLDER whose id is a browser world's (1.17, contract §5.2,
 * S370 gate B17). The path: unzip a downloaded world onto the drive, then
 * open the folder. A browser world the browser CLEARED takes the folder as
 * its home (its row, link and settings kept); a LIVE one refuses, says where
 * the world is, and stores nothing (the browser copy is the world).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { FakeDirHandle } from '../fixtures/fake-fs';

const vault = vi.hoisted(() => ({ handles: new Map<string, unknown>() }));
vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: async (key: string, h: unknown) => { vault.handles.set(key, h); },
  loadHandle: async (key: string) => vault.handles.get(key),
  ensureWritable: async () => true,
  queryWritable: async () => true,
  deleteHandle: async (key: string) => { vault.handles.delete(key); },
  listHandleKeys: async () => [...vault.handles.keys()],
}));

import { openWorldFolder } from '../../src/setup/atlas-root-flow';

const WID = '0192a000-aaaa-7bbb-8ccc-000000000001';
const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

function picked(): FileSystemDirectoryHandle {
  const d = new FakeDirHandle('hollow-reach-0192a000');
  d.put('world.json', j({ id: WID, name: 'Hollow Reach' }));
  return d as unknown as FileSystemDirectoryHandle;
}
function browserEntry(over: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry {
  return {
    id: 'w1', name: 'Hollow Reach', state: 'local-only', where: 'browser', created_at: '2026-10-05T00:00:00.000Z',
    folder: { handle_key: `world-${WID}`, folder_name: 'hollow-reach-0192a000-1a2b', last_path_hint: 'browser storage/hollow-reach-0192a000-1a2b' },
    ...over,
  };
}

beforeEach(() => { vault.handles.clear(); });

describe('opening a world folder that is a browser world', () => {
  it('a cleared browser world takes the folder as its home: the same row, now a folder world', async () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [browserEntry({ cleared_at: '2026-10-05T09:00:00.000Z' })] });
    const dir = picked();
    expect(await openWorldFolder(dir)).toEqual({ worldId: 'w1', already: true });
    const e = getState().registry.worlds[0];
    expect(getState().registry.worlds).toHaveLength(1);
    expect(e.where).toBeUndefined();
    expect(e.cleared_at).toBeUndefined();
    expect(e.folder.folder_name).toBe('hollow-reach-0192a000');
    expect(vault.handles.get(`world-${WID}`)).toBe(dir);
  });

  it('a cleared LINKED twin adopts the folder with its first sync held for review (S376 gate B3, Skeld condition 3)', async () => {
    const linked = browserEntry({ cleared_at: '2026-10-05T09:00:00.000Z', state: 'api-linked', api: { world_id: WID, api_key: 'k' } });
    patchSlice('registry', { ...defaultRegistry(), worlds: [linked] });
    expect(await openWorldFolder(picked())).toEqual({ worldId: 'w1', already: true });
    const e = getState().registry.worlds[0];
    expect(e.api?.world_id).toBe(WID);
    expect(e.review_first_sync).toBe(true);
  });

  it('a cleared row matched only through a former link is not adopted: the folder opens as its own world (S376 gate B3)', async () => {
    const former = browserEntry({
      id: 'w9', cleared_at: '2026-10-05T09:00:00.000Z', former_api_world_id: WID,
      folder: { handle_key: 'world-0192ffff-other', folder_name: 'other-0192ffff-9a9a', last_path_hint: 'browser storage/other-0192ffff-9a9a' },
    } as Partial<WorldRegistryEntry>);
    patchSlice('registry', { ...defaultRegistry(), worlds: [former] });
    const out = await openWorldFolder(picked());
    expect(out.worldId).not.toBe('w9');
    const w9 = getState().registry.worlds.find(w => w.id === 'w9')!;
    expect(w9.where).toBe('browser');
    expect(w9.cleared_at).toBeTruthy();
    expect(vault.handles.get(`world-${WID}`)).toBeTruthy();
  });

  it('the exact cleared twin is found even behind a row matched only through a former link (S377 D2 gate note)', async () => {
    const former = browserEntry({
      id: 'w9', cleared_at: '2026-10-05T09:00:00.000Z', former_api_world_id: WID,
      folder: { handle_key: 'world-0192ffff-other', folder_name: 'other-0192ffff-9a9a', last_path_hint: 'browser storage/other-0192ffff-9a9a' },
    } as Partial<WorldRegistryEntry>);
    // The own twin is matched by its link's server id (a world made online keeps its local handle key).
    const own = browserEntry({
      cleared_at: '2026-10-05T09:00:00.000Z', state: 'api-linked', api: { world_id: WID, api_key: 'k' },
      folder: { handle_key: 'world-0192eeee-local', folder_name: 'hollow-reach-0192eeee-1a2b', last_path_hint: 'browser storage/hollow-reach-0192eeee-1a2b' },
    });
    patchSlice('registry', { ...defaultRegistry(), worlds: [former, own] });
    expect(await openWorldFolder(picked())).toEqual({ worldId: 'w1', already: true });
  });

  it('a live browser world refuses, says where the world is, and stores nothing', async () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [browserEntry()] });
    await expect(openWorldFolder(picked())).rejects.toThrow(/already in Atlas, kept in this browser/);
    expect(vault.handles.size).toBe(0);
    expect(getState().registry.worlds[0].where).toBe('browser');
  });
});
