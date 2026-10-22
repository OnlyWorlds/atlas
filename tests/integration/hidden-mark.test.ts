/**
 * keel #537 (PR 160, live 2026-10-22, Skeld h66 #9842): a body served to a reader who sees a
 * hidden element (the owner, a co-builder, its maker) carries `hidden: true` at the top level,
 * absent on every other body; echoed back in a write it is ignored. Atlas keeps it as keel's
 * word, like who wrote the element: never sent, never a difference anyone made, dropped on
 * import, and gone again when the owner unhides.
 */
import { describe, it, expect } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { toV2WireShape } from '../../src/sync/ow-v2-client-adapter';
import { diffFieldNames } from '../../src/sync/sync-engine';
import type { FolderStore } from '../../src/store/folder-store';

const ANA = '00000000-0000-4000-8000-0000000005a7';
const STAMP = '2026-01-01T00:00:05.000Z';
const LATER = '2026-01-01T00:01:05.000Z';
const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const tick = () => new Date(Date.UTC(2026, 1, 1, 0, 0, t++)).toISOString();

async function realStore(): Promise<FolderStore> {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  const s = new FsFolderStore({ clock: tick, tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
  await s.open(root as unknown as FileSystemDirectoryHandle);
  return s;
}
async function mockStore(): Promise<FolderStore> {
  const s = new MockFolderStore();
  await s.open(null);
  return s;
}

describe.each([['the real store', realStore], ['the mock store', mockStore]] as const)('%s', (_name, make) => {
  it('keeps keel\'s hidden mark as served, and loses it when keel stops sending it (an unhide)', async () => {
    const s = await make();
    await s.applyServerRecord('character', { id: ANA, type: 'character', name: 'Ana', hidden: true, updated_at: STAMP }, STAMP);
    expect(((await s.getElement(ANA)) as unknown as Record<string, unknown>).hidden).toBe(true);
    await s.applyServerRecord('character', { id: ANA, type: 'character', name: 'Ana', updated_at: LATER }, LATER);
    expect('hidden' in ((await s.getElement(ANA)) as unknown as Record<string, unknown>)).toBe(false);
  });
});

describe('the wire', () => {
  it('never sends it back', () => {
    const body = toV2WireShape({ id: ANA, name: 'Ana', hidden: true }, 'character', 'update');
    expect('hidden' in body).toBe(false);
  });

  it("is never a difference: a copy without it is the same as keel's body with it", () => {
    const local = { id: ANA, type: 'character', name: 'Ana' } as never;
    expect(diffFieldNames(local, { id: ANA, type: 'character', name: 'Ana', hidden: true })).toEqual([]);
    // The control: a real difference still is one.
    expect(diffFieldNames(local, { id: ANA, type: 'character', name: 'Ana B', hidden: true })).toEqual(['name']);
  });
});
