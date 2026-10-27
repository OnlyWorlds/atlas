/**
 * keel serves a message to a key that may not see every linked Character with those ids left out,
 * and names each field that lost one in `x_served_trimmed` (the message profile, "A list trimmed
 * for the reader"). The folder keeps it exactly as served; a writer never sends it up, and keel
 * refuses a body that carries it (422 `served_trimmed_not_writable`; folder spec §4.4 rule 6,
 * v0.3.19). Atlas keeps it like keel's hidden mark: as received, never sent on a create or an
 * update, never a difference anyone made, and gone when a whole body arrives.
 */
import { describe, it, expect } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { toV2WireShape } from '../../src/sync/ow-v2-client-adapter';
import { diffFieldNames } from '../../src/sync/sync-engine';
import type { FolderStore } from '../../src/store/folder-store';

const NOTE = '00000000-0000-4000-8000-0000000007a1';
const SEEN = '00000000-0000-4000-8000-0000000007a2';
const STAMP = '2026-01-01T00:00:05.000Z';
const LATER = '2026-01-01T00:01:05.000Z';
const MARK = 'x_served_trimmed';
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

const trimmed = { id: NOTE, type: 'narrative', name: 'Orders', supertype: 'Message', characters: [SEEN], [MARK]: ['characters'] };

describe.each([['the real store', realStore], ['the mock store', mockStore]] as const)('%s', (_name, make) => {
  it('keeps the mark as served, through a local edit, and loses it when a whole body arrives', async () => {
    const s = await make();
    await s.applyServerRecord('narrative', { ...trimmed, updated_at: STAMP }, STAMP);
    expect(((await s.getElement(NOTE)) as unknown as Record<string, unknown>)[MARK]).toEqual(['characters']);
    // The file keeps it; only the push strips it.
    await s.updateElement(NOTE, { name: 'Orders, sealed' } as never);
    expect(((await s.getElement(NOTE)) as unknown as Record<string, unknown>)[MARK]).toEqual(['characters']);
    await s.applyServerRecord('narrative', { id: NOTE, type: 'narrative', name: 'Orders, sealed', supertype: 'Message', characters: [SEEN], updated_at: LATER }, LATER);
    expect(MARK in ((await s.getElement(NOTE)) as unknown as Record<string, unknown>)).toBe(false);
  });
});

describe('the wire', () => {
  it('never sends it up, on an update or a create, and keeps the trimmed field', () => {
    for (const op of ['update', 'create'] as const) {
      const body = toV2WireShape({ ...trimmed }, 'narrative', op);
      expect(MARK in body).toBe(false);
      expect(body.characters).toEqual([SEEN]);
    }
  });

  it("is never a difference: a copy without it is the same as keel's body with it", () => {
    const { [MARK]: _mark, ...bare } = trimmed;
    expect(diffFieldNames(bare as never, trimmed)).toEqual([]);
    // The control: a real difference still is one.
    expect(diffFieldNames(bare as never, { ...trimmed, name: 'Orders B' })).toEqual(['name']);
  });
});
