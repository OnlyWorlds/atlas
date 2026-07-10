/**
 * Demo-flag lifecycle — the Bout OW contract (waypoints must never complete
 * from demo-world gestures) rides three guarded paths that carried explicit
 * regression-warning comments but zero coverage (2026-07-10 sweep, HIGH):
 *
 *   1. `discoverWorldsInRoot` re-mirrors `demo` from world.json into the
 *      registry — without it, a localStorage wipe + rediscovery silently
 *      un-demos the sample world (atlas-root-flow.ts).
 *   2. `createWorldFromImportedData` STRIPS `demo` from import plans — an
 *      exported demo world must re-import as an ordinary world.
 *   3. Only the explicit sample-world opt (`opts.demo`) sets the flag, on
 *      both world.json and the registry entry.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { parsePayload } from '../../src/import/parse';
import { reconcile } from '../../src/import/reconcile';
import { getActiveStore, setActiveStore } from '../../src/core/active-store';

// Handle-vault is IDB-backed; fake-indexeddb cannot structured-clone our fake
// directory handles (they carry methods). Stub the whole vault.
vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: async () => {},
  loadHandle: async () => null,
  ensureWritable: async () => true,
  queryWritable: async () => true,
  deleteHandle: async () => {},
}));

// The import path opens a real FsFolderStore on the scaffolded subfolder;
// swap in the in-memory MockFolderStore (same contract, no real FS).
vi.mock('../../src/store/folder-store-fs', async () => {
  const { MockFolderStore } = await import('../fixtures/mock-folder-store');
  return { FsFolderStore: MockFolderStore };
});

import { discoverWorldsInRoot, createWorldFromImportedData } from '../../src/setup/atlas-root-flow';

// ---- fakes: minimal FileSystemDirectoryHandle shapes ----

function fakeWorldDir(name: string, worldJson: unknown) {
  return {
    kind: 'directory' as const,
    name,
    async getFileHandle(fname: string) {
      if (fname === 'world.json') {
        return { async getFile() { return { async text() { return JSON.stringify(worldJson); } }; } };
      }
      throw new DOMException('not found', 'NotFoundError');
    },
    async isSameEntry() { return false; },
  };
}

function fakeRoot(children: unknown[]) {
  return {
    kind: 'directory' as const,
    name: 'onlyworlds-atlas',
    async *values() { for (const c of children) yield c; },
    async getDirectoryHandle(name: string) { return fakeWorldDir(name, null); },
  };
}

beforeEach(() => {
  localStorage.clear();
  patchSlice('registry', defaultRegistry());
  patchSlice('active', null);
  patchSlice('data', { elements: [] });
  setActiveStore(null);
});

describe('discoverWorldsInRoot — demo re-mirror from world.json', () => {
  it('re-mirrors demo:true into the registry entry (localStorage-wipe recovery)', async () => {
    const root = fakeRoot([
      fakeWorldDir('sample-abc123', { id: 'w-sample', name: 'Moppetopia (sample)', demo: true }),
      fakeWorldDir('real-def456', { id: 'w-real', name: 'My World' }),
    ]);

    const { imported } = await discoverWorldsInRoot(root as any, 'test-root');

    expect(imported).toBe(2);
    const worlds = getState().registry.worlds;
    const sample = worlds.find(w => w.name === 'Moppetopia (sample)');
    const real = worlds.find(w => w.name === 'My World');
    expect(sample?.demo).toBe(true);
    expect(real?.demo).toBeFalsy();
  });

  it('treats a non-boolean demo value as not-demo', async () => {
    const root = fakeRoot([
      fakeWorldDir('odd-777', { id: 'w-odd', name: 'Odd', demo: 'yes' }),
    ]);

    await discoverWorldsInRoot(root as any, 'test-root');

    expect(getState().registry.worlds.find(w => w.name === 'Odd')?.demo).toBeFalsy();
  });
});

describe('createWorldFromImportedData — demo strip + explicit sample opt', () => {
  const parent = { handle: fakeRoot([]) as any, label: 'test-parent' };

  function planWithDemoMeta() {
    const plan = reconcile(
      parsePayload({
        World: { api_key: 'x', name: 'Exported Demo' },
        Character: [{ id: '068e5012-d77c-799d-8000-95548fbae78d', name: 'Someone' }],
      }),
      [],
      { genId: () => 'gen-1' },
    );
    // Simulate an export that carried the flag in its World block — the
    // threat the strip exists for.
    plan.worldMeta = { ...(plan.worldMeta ?? {}), demo: true } as any;
    return plan;
  }

  it('strips demo from an import plan (exported demo world re-imports as ordinary)', async () => {
    const { entry } = await createWorldFromImportedData(planWithDemoMeta(), { parentHandle: parent });

    expect(entry.demo).toBeFalsy();
    const regEntry = getState().registry.worlds.find(w => w.id === entry.id);
    expect(regEntry?.demo).toBeFalsy();
    const meta = await getActiveStore()!.readWorldMeta();
    expect((meta as any).demo).toBeUndefined();
  });

  it('sets demo on both world.json and the registry ONLY via the explicit sample opt', async () => {
    const { entry } = await createWorldFromImportedData(planWithDemoMeta(), {
      parentHandle: parent,
      demo: true,
    });

    expect(entry.demo).toBe(true);
    expect(getState().registry.worlds.find(w => w.id === entry.id)?.demo).toBe(true);
    const meta = await getActiveStore()!.readWorldMeta();
    expect((meta as any).demo).toBe(true);
  });
});
