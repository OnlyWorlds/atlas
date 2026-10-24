/**
 * THE LIVE FOLDER kernel (S364): `FsFolderStore.rescanDisk()` on the REAL
 * store over the in-memory file system (the mock store has one map and no
 * cache separate from disk, so it cannot be stale). Every "outside" write
 * below goes straight to the fake FS, the way an AI agent, a text editor or
 * git would, never through the store. Lane C's probes P1-P4 asserted today's
 * gaps; these are their inversions plus the kernel's own contract.
 */
import { describe, it, expect } from 'vitest';
import { FakeDirHandle, fakeContentReads } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import type { Element } from '../../src/core/types';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 1, 1, 0, 0, t++)).toISOString();
async function open(root: FakeDirHandle): Promise<FsFolderStore> {
  const s = new FsFolderStore({ clock, tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
  await s.open(root as unknown as FileSystemDirectoryHandle);
  return s;
}
function world(): FakeDirHandle {
  const r = new FakeDirHandle('w');
  r.put('world.json', j({ id: 'w1', name: 'W' }));
  return r;
}
const pathOf = (root: FakeDirHandle, id: string) =>
  root.list().find(p => p.startsWith('elements/') && p.includes(id.slice(-8)) && p.endsWith('.json'))!;
function editOutside(root: FakeDirHandle, id: string, patch: Record<string, unknown>): void {
  const p = pathOf(root, id);
  root.put(p, j({ ...JSON.parse(root.get(p)!), ...patch }));
}
const kinds = (r: { changes: Array<{ kind: string; id: string }> }) => r.changes.map(c => `${c.kind}:${c.id}`);

describe('rescanDisk: what another tool did shows', () => {
  it('an outside edit is served after a rescan and reported with the body it replaced', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Aldric', description: 'atlas' });
    await s.listElements();
    editOutside(root, el.id, { description: 'agent' });
    expect((await s.getElement(el.id))!.description).toBe('atlas'); // cached until the pass

    const r = await s.rescanDisk();
    expect(kinds(r)).toEqual([`changed:${el.id}`]);
    expect(r.changes[0].before?.description).toBe('atlas');
    expect((await s.getElement(el.id))!.description).toBe('agent');
    expect((await s.listElements('character'))[0].description).toBe('agent');
    // Nothing moved since: a second pass is quiet.
    expect((await s.rescanDisk()).changes).toEqual([]);
  });

  it('outside creates and deletes appear, and a delete writes no tombstone', async () => {
    const root = world();
    const s = await open(root);
    await s.createElement('character', { name: 'Keep' });
    const gone = await s.createElement('character', { name: 'Gone' });
    await s.listElements();
    const newId = '11111111-1111-4111-8111-111111111111';
    root.put('elements/character/new--11111111.json', j({ id: newId, type: 'character', name: 'New' }));
    const [, , file] = pathOf(root, gone.id).split('/');
    await (await (await root.getDirectoryHandle('elements')).getDirectoryHandle('character')).removeEntry(file);

    const r = await s.rescanDisk();
    expect(kinds(r).sort()).toEqual([`created:${newId}`, `deleted:${gone.id}`].sort());
    expect((await s.listElements('character')).map(e => e.name).sort()).toEqual(['Keep', 'New']);
    expect(await s.listTombstonesSince(null)).toEqual([]);
  });

  it('a new file of a type with no directory yet at open is not seen (only indexed types are scanned), and is read when listed', async () => {
    const root = world();
    const s = await open(root);
    await s.listElements('character');
    root.put('elements/species/elves--22222222.json', j({ id: '22222222-2222-4222-8222-222222222222', type: 'species', name: 'Elves' }));
    await s.rescanDisk();
    expect((await s.listElements('species')).map(e => e.name)).toEqual(['Elves']);
  });
});

describe('rescanDisk: Atlas\'s own writes never report', () => {
  it('create, update, rename, both sync stamps, a delete and a verbatim create are all quiet', async () => {
    const root = world();
    const s = await open(root);
    const a = await s.createElement('character', { name: 'Ann' });
    const b = await s.createElement('character', { name: 'Bo' });
    await s.listElements();
    await s.updateElement(a.id, { description: 'edited' });
    await s.updateElement(a.id, { name: 'Anneliese' }); // renames the file
    await s.stampServerUpdatedAt(a.id, 'character', '2026-03-01T00:00:00.000Z');
    await s.clearServerBaseline(a.id);
    await s.deleteElement(b.id);
    await s.createElementVerbatim('character', { id: '33333333-3333-4333-8333-333333333333', type: 'character', name: 'Cy' } as Element);
    expect((await s.rescanDisk()).changes).toEqual([]);
  });

  // The stamps are the COST half of the contract: content comparison alone
  // would also keep Atlas's writes quiet, but by reading every file it wrote.
  // A pass over a world nobody else touched stats files and reads none.
  it('a pass after Atlas\'s own writes reads no file contents', async () => {
    const root = world();
    const s = await open(root);
    const a = await s.createElement('character', { name: 'Ann' });
    await s.createElement('location', { name: 'Keep' });
    await s.listElements();
    await s.updateElement(a.id, { name: 'Anneliese', description: 'edited' });
    await s.stampServerUpdatedAt(a.id, 'character', '2026-03-01T00:00:00.000Z');
    await s.rescanDisk(); // the journal probe and first-pass bookkeeping
    const before = fakeContentReads();
    expect((await s.rescanDisk()).changes).toEqual([]);
    expect(fakeContentReads() - before).toBe(0);
    await s.updateElement(a.id, { description: 'again' });
    const mid = fakeContentReads();
    expect((await s.rescanDisk()).changes).toEqual([]);
    expect(fakeContentReads() - mid).toBe(0);
  });

  it('the open-time tidy renaming files to canonical form is quiet', async () => {
    const root = world();
    const id = '44444444-4444-4444-8444-444444444444';
    root.put('elements/character/whatever-name.json', j({ id, type: 'character', name: 'Dora' }));
    const s = await open(root);
    await s.listElements();
    await s.awaitTidies();
    expect(root.list().some(p => p.includes('dora--44444444'))).toBe(true); // the tidy ran
    expect((await s.rescanDisk()).changes).toEqual([]);
  });

  it('a touch (same bytes, new mtime) is adopted silently', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Eve' });
    await s.listElements();
    root.touch(pathOf(root, el.id));
    expect((await s.rescanDisk()).changes).toEqual([]);
    expect((await s.rescanDisk()).changes).toEqual([]);
  });
});

describe('rescanDisk: moves, twins and broken files', () => {
  it('a file renamed outside keeps its id: no delete, and the next Atlas write leaves exactly one file', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Finn' });
    await s.listElements();
    const old = pathOf(root, el.id);
    const text = root.get(old)!;
    const [, , file] = old.split('/');
    await (await (await root.getDirectoryHandle('elements')).getDirectoryHandle('character')).removeEntry(file);
    root.put('elements/character/renamed-by-hand.json', text);

    const r = await s.rescanDisk();
    expect(r.changes).toEqual([]); // same content, new home: nothing to show
    // The write goes to the file the index now names (a non-canonical name is
    // converged to canonical on write, as always), never to the vanished one.
    await s.updateElement(el.id, { description: 'after' });
    const files = root.list().filter(p => p.startsWith('elements/character/'));
    expect(files).toHaveLength(1);
    expect(JSON.parse(root.get(files[0])!).description).toBe('after');
    expect((await s.rescanDisk()).changes).toEqual([]);
  });

  it('a second file claiming a served id is left alone: not served, not moved, not reported twice', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Gil', description: 'served' });
    await s.listElements();
    root.put('elements/character/gil-copy.json', j({ ...JSON.parse(root.get(pathOf(root, el.id))!), description: 'copy' }));
    expect((await s.rescanDisk()).changes).toEqual([]);
    expect((await s.getElement(el.id))!.description).toBe('served');
    expect(root.get('elements/character/gil-copy.json')).not.toBeNull();
    expect((await s.rescanDisk()).changes).toEqual([]);
  });

  it('a half-written file is reported once as unreadable and the cached body keeps serving', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Hal', description: 'whole' });
    await s.listElements();
    root.put(pathOf(root, el.id), '{ "id": "' + el.id + '", "name": "Ha');
    const r = await s.rescanDisk();
    expect(r.changes.map(c => c.kind)).toEqual(['unreadable']);
    expect((await s.getElement(el.id))!.description).toBe('whole');
    expect((await s.rescanDisk()).changes).toEqual([]);
    // The writer finishes: the next pass serves it.
    root.put(pathOf(root, el.id), j({ id: el.id, type: 'character', name: 'Hal', description: 'finished' }));
    expect(kinds(await s.rescanDisk())).toEqual([`changed:${el.id}`]);
    expect((await s.getElement(el.id))!.description).toBe('finished');
  });

  it('an overwrite that kept its mtime and size is missed by the stat pass and found by a full pass', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Kai', description: 'aaaa' });
    await s.listElements();
    // Reach under the stat: same length, same lastModified (a `cp -p` of an older copy).
    const [dirName, typeName, file] = pathOf(root, el.id).split('/');
    const handle = await (await (await root.getDirectoryHandle(dirName)).getDirectoryHandle(typeName)).getFileHandle(file);
    handle.data = handle.data.replace('"aaaa"', '"bbbb"');
    expect((await s.rescanDisk()).changes).toEqual([]);
    expect(kinds(await s.rescanDisk({ full: true }))).toEqual([`changed:${el.id}`]);
    expect((await s.getElement(el.id))!.description).toBe('bbbb');
  });

  it('refuses while a re-key journal exists', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Ivy' });
    await s.listElements();
    await s.writeRekeyJournal({ version: 1, world_id: 'w', map: {}, types: {}, stamps: {}, unrewritten: [], started_at: clock() });
    editOutside(root, el.id, { description: 'outside' });
    expect(await s.rescanDisk()).toEqual({ changes: [], skipped: 'rekey' });
    await s.clearRekeyJournal();
    expect(kinds(await s.rescanDisk())).toEqual([`changed:${el.id}`]);
  });

  it('concurrent calls share runs: the change is reported once', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Jo' });
    await s.listElements();
    editOutside(root, el.id, { description: 'outside' });
    const [r1, r2, r3] = await Promise.all([s.rescanDisk(), s.rescanDisk(), s.rescanDisk()]);
    expect([...r1.changes, ...r2.changes, ...r3.changes].map(c => c.id)).toEqual([el.id]);
  });
});

describe('rescanDisk and sync: a compliant outside edit', () => {
  it('a fresh local_updated_at (the toolkit rule) joins the push set after a rescan', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Kit', description: 'v1' });
    await s.stampServerUpdatedAt(el.id, 'character', '2026-03-01T00:00:00.000Z');
    await s.listElements();
    expect((await s.listLocallyChangedSince(null)).map(e => e.id)).toEqual([]);
    editOutside(root, el.id, { description: 'agent', local_updated_at: '2026-04-01T00:00:00.000Z' });
    await s.rescanDisk();
    expect((await s.listLocallyChangedSince(null)).map(e => e.id)).toEqual([el.id]);
  });

  it('a pull decided on the cached stamp backs off from a compliant outside edit, even with no rescan', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Lu', description: 'v1' });
    await s.stampServerUpdatedAt(el.id, 'character', '2026-03-01T00:00:00.000Z');
    const decidedOn = (await s.getElement(el.id))!.local_updated_at ?? null;
    editOutside(root, el.id, { description: 'agent', local_updated_at: '2026-04-01T00:00:00.000Z' });
    const applied = await s.applyServerRecordIfUnchanged('character',
      { id: el.id, name: 'Lu', description: 'server v2' }, '2026-05-01T00:00:00.000Z', decidedOn);
    expect(applied).toBe(false);
    expect(JSON.parse(root.get(pathOf(root, el.id))!).description).toBe('agent');
  });
});

describe('unreadableFiles: what an open left out (conv. 176, Seethe h20 #12538)', () => {
  it('names a cut-short file and an id-less one after the index, leaves both on disk, and drops one fixed since', async () => {
    const root = world();
    const id = '0192a000-0000-7000-8000-00000000b0b0';
    root.put('elements/character/ada--0000ada0.json', j({ id: '0192a000-0000-7000-8000-00000000ada0', type: 'character', name: 'Ada' }));
    root.put('elements/character/broken.json', '{"id": "' + id + '", "name": "Broken');
    root.put('elements/location/no-id.json', j({ type: 'location', name: 'Nowhere' }));
    const s = await open(root);
    expect((await s.listElements()).map(e => e.name)).toEqual(['Ada']);
    expect(s.unreadableFiles()).toEqual(['character/broken.json', 'location/no-id.json']);
    expect(root.get('elements/character/broken.json')).toBe('{"id": "' + id + '", "name": "Broken');

    root.put('elements/character/broken.json', j({ id, type: 'character', name: 'Mended' }));
    expect(kinds(await s.rescanDisk())).toEqual([`created:${id}`]);
    expect(s.unreadableFiles()).toEqual(['location/no-id.json']);
  });

  it('a world with nothing unreadable has an empty list', async () => {
    const root = world();
    root.put('elements/character/ada--0000ada0.json', j({ id: '0192a000-0000-7000-8000-00000000ada0', type: 'character', name: 'Ada' }));
    const s = await open(root);
    await s.listElements();
    expect(s.unreadableFiles()).toEqual([]);
  });
});
