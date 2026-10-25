/**
 * A world file whose world is already here opens BESIDE it as a view-only
 * copy (#527's second half, conv. 177): a fresh world id under the snapshot
 * rule, the files byte-exact, the world it copies untouched; the same copy
 * twice is one copy; a file another writer marked `writable: false` opens
 * view-only; a copy never attaches sync.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { BROWSER_HOME, setOpfsRootForTests } from '../../src/core/browser-worlds';
import { openWorldFile } from '../../src/setup/world-file-open';
import { attachSyncEngine, detachSyncEngine } from '../../src/sync/sync-attach';
import { MockFolderStore } from '../fixtures/mock-folder-store';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const asDir = (d: FakeDirHandle) => d as unknown as FileSystemDirectoryHandle;
const WID = '0192a000-aaaa-7bbb-8ccc-000000000001';
const AT = '2026-10-24T03:30:00+00:00';
const ANA = j({ id: '0192a000-aaaa-7bbb-8ccc-0000000000a1', name: 'Ana', change_seq: 7 });
let opfs: FakeDirHandle;
let home: FakeDirHandle;

function worldZip(meta: Record<string, unknown>): Uint8Array {
  return zipSync({
    'hollow-reach/world.json': strToU8(j(meta)),
    'hollow-reach/elements/character/ana--000000a1.json': strToU8(ANA),
  });
}
const DAY_FILE = { id: WID, name: 'Hollow Reach', time_format_names: ['Year'], source: { server: 'https://www.onlyworlds.com', world: WID, at: AT }, producer: { tool: 'keel', version: 'abc', input: 'server' } };
const reg = () => getState().registry;
const HERE: WorldRegistryEntry = {
  id: 'w1', name: 'Hollow Reach', state: 'api-linked', created_at: '2026-10-05T00:00:00.000Z',
  api: { world_id: WID, api_key: 'k' },
  folder: { handle_key: `world-${WID}`, folder_name: 'hollow-reach-0192a000' },
};
async function fileText(dir: FakeDirHandle, path: string): Promise<string> {
  const segs = path.split('/');
  let d = dir;
  for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s) as FakeDirHandle;
  const f = await (await d.getFileHandle(segs[segs.length - 1])).getFile();
  return await f.text();
}

beforeEach(async () => {
  opfs = new FakeDirHandle('opfs');
  home = await opfs.getDirectoryHandle(BROWSER_HOME, { create: true });
  setOpfsRootForTests(async () => asDir(opfs));
  patchSlice('registry', { ...defaultRegistry(), worlds: [HERE] });
});
afterEach(() => { setOpfsRootForTests(null); detachSyncEngine(); });

describe('a copy beside the world (conv. 177)', () => {
  it('opens under a fresh id by the snapshot rule, the files byte-exact, the world it copies untouched', async () => {
    const before = JSON.stringify(reg().worlds[0]);
    const out = await openWorldFile(worldZip(DAY_FILE), { asCopy: true });
    expect(out.kind).toBe('copied');
    const copy = reg().worlds.find(w => w.id === (out as { worldId: string }).worldId)!;
    expect(copy).toMatchObject({ name: 'Hollow Reach', state: 'local-only', where: 'browser', copy_of: { world_id: WID, at: AT } });
    expect(copy.api).toBeUndefined();
    const dir = home.children.get(copy.folder.folder_name) as FakeDirHandle;
    const meta = JSON.parse(await fileText(dir, 'world.json')) as Record<string, unknown>;
    expect(meta.id).not.toBe(WID);
    expect(copy.folder.handle_key).toBe(`world-${meta.id as string}`);
    expect(meta).toEqual({ ...DAY_FILE, id: meta.id, snapshot_of: WID, snapshot_at: AT, writable: false });
    expect(await fileText(dir, 'elements/character/ana--000000a1.json')).toBe(ANA);
    expect(JSON.stringify(reg().worlds.find(w => w.id === 'w1'))).toBe(before);
    expect(reg().worlds).toHaveLength(2);
  });

  it('the same copy twice is one copy, and nothing is written the second time', async () => {
    const first = await openWorldFile(worldZip(DAY_FILE), { asCopy: true });
    const dirsAfterFirst = [...home.children.keys()].sort();
    // Nothing written, not even a directory taken back (the re-check after
    // the write would answer the same, after writing).
    const created: string[] = [];
    const real = FakeDirHandle.prototype.getFileHandle;
    FakeDirHandle.prototype.getFileHandle = function (this: FakeDirHandle, name: string, o?: { create?: boolean }) {
      if (o?.create) created.push(name);
      return real.call(this, name, o);
    };
    let second;
    try { second = await openWorldFile(worldZip(DAY_FILE), { asCopy: true }); } finally { FakeDirHandle.prototype.getFileHandle = real; }
    expect(created).toEqual([]);
    expect(second).toEqual({ kind: 'already', worldId: (first as { worldId: string }).worldId });
    expect([...home.children.keys()].sort()).toEqual(dirsAfterFirst);
    expect(reg().worlds).toHaveLength(2);
  });

  it('another day is another copy; a file with no time is never "the same"', async () => {
    await openWorldFile(worldZip(DAY_FILE), { asCopy: true });
    await openWorldFile(worldZip({ ...DAY_FILE, source: { ...DAY_FILE.source, at: '2026-10-23T03:30:00+00:00' } }), { asCopy: true });
    const undated = { id: WID, name: 'Hollow Reach' };
    const a = await openWorldFile(worldZip(undated), { asCopy: true });
    const b = await openWorldFile(worldZip(undated), { asCopy: true });
    expect([a.kind, b.kind]).toEqual(['copied', 'copied']);
    expect(reg().worlds.filter(w => w.copy_of)).toHaveLength(4);
    expect(reg().worlds.find(w => w.id === (a as { worldId: string }).worldId)!.copy_of).toEqual({ world_id: WID });
  });

  it('the plain open still answers "already here"', async () => {
    expect(await openWorldFile(worldZip(DAY_FILE))).toEqual({ kind: 'already', worldId: 'w1' });
  });

  it('a file another writer marked writable: false opens view-only, its copy_of mirrored', async () => {
    patchSlice('registry', defaultRegistry());
    const snap = { id: '0192a000-aaaa-7bbb-8ccc-0000000000ff', name: 'Hollow Reach', snapshot_of: WID, snapshot_at: AT, writable: false };
    const out = await openWorldFile(worldZip(snap));
    expect(out.kind).toBe('opened');
    expect(reg().worlds[0].copy_of).toEqual({ world_id: WID, at: AT });
  });

  it('a copy never attaches sync, even with a link on its entry', () => {
    const linkedCopy: WorldRegistryEntry = { ...HERE, id: 'c1', copy_of: { world_id: WID } };
    patchSlice('registry', { ...defaultRegistry(), worlds: [linkedCopy], pin: '1234' });
    expect(attachSyncEngine(linkedCopy, new MockFolderStore())).toBeNull();
  });
});

void strFromU8;
