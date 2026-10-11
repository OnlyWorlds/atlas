/**
 * #122 (S390): "Delete all locally" in the server-delete review. One step
 * clears many rows; a copy holding edits never synced is named and kept
 * unless the caller includes it; each delete is guarded by the stamp the
 * review read, inside the per-id chain, so a copy edited since is kept.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { SyncEngine } from '../../src/sync/sync-engine';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;

/** Three synced characters, all deleted on the server and recorded for review. */
beforeEach(async () => {
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  engine = new SyncEngine({ folder, client });
  for (const [id, name] of [['c1', 'Alice'], ['c2', 'Bob'], ['c3', 'Cora']]) {
    await client.createElement('character', { id, name, type: 'character' });
  }
  await engine.syncNow();
  for (const id of ['c1', 'c2', 'c3']) await client.deleteElement('character', id);
  await engine.pullNow();
  expect((await engine.listServerDeletes()).map(d => d.id).sort()).toEqual(['c1', 'c2', 'c3']);
});

const ids = (xs: Array<{ id: string }>) => xs.map(x => x.id).sort();
const stamps = (e: { local_updated_at?: string; server_updated_at?: string }) =>
  ({ local_updated_at: e.local_updated_at ?? null, server_updated_at: e.server_updated_at ?? null });

describe('reviewServerDeletes', () => {
  it('names the copies holding edits never synced, and only those', async () => {
    await folder.updateElement('c2', { description: 'written here after the last sync' });
    const rows = await engine.reviewServerDeletes();
    expect(rows.filter(r => r.unsynced).map(r => r.id)).toEqual(['c2']);
    expect(rows.every(r => typeof r.local_updated_at === 'string')).toBe(true);
  });
});

describe('deleteServerDeletesLocally', () => {
  it('clears every clean row in one step: files gone, no tombstones, entries cleared', async () => {
    const rows = await engine.reviewServerDeletes();
    const res = await engine.deleteServerDeletesLocally(rows);
    expect(res.deleted.sort()).toEqual(['c1', 'c2', 'c3']);
    expect(res.kept).toEqual([]);
    for (const id of ['c1', 'c2', 'c3']) expect(await folder.getElement(id)).toBeNull();
    expect(await folder.listTombstonesSince(null)).toEqual([]);
    expect(await engine.listServerDeletes()).toEqual([]);
  });

  it('the caller leaves an unsynced copy out by default: it stays, with its entry', async () => {
    await folder.updateElement('c2', { description: 'mine' });
    const rows = await engine.reviewServerDeletes();
    const res = await engine.deleteServerDeletesLocally(rows.filter(r => !r.unsynced));
    expect(res.deleted.sort()).toEqual(['c1', 'c3']);
    expect((await folder.getElement('c2'))!.description).toBe('mine');
    expect(ids(await engine.listServerDeletes())).toEqual(['c2']);
  });

  it('an unsynced copy the user ticked is deleted with the rest', async () => {
    await folder.updateElement('c2', { description: 'mine' });
    const res = await engine.deleteServerDeletesLocally(await engine.reviewServerDeletes());
    expect(res.deleted.sort()).toEqual(['c1', 'c2', 'c3']);
    expect(await folder.getElement('c2')).toBeNull();
  });

  it('a copy edited after the review read it is kept, entry and all', async () => {
    const rows = await engine.reviewServerDeletes();
    await folder.updateElement('c3', { description: 'typed while the dialog was open' });
    const res = await engine.deleteServerDeletesLocally(rows);
    expect(res.deleted.sort()).toEqual(['c1', 'c2']);
    expect(res.kept).toEqual(['c3']);
    expect((await folder.getElement('c3'))!.description).toBe('typed while the dialog was open');
    expect(ids(await engine.listServerDeletes())).toEqual(['c3']);
  });

  it('an edit queued in the chain before the delete wins (the check is inside the slot)', async () => {
    const rows = await engine.reviewServerDeletes();
    const save = folder.updateElement('c1', { description: 'queued' });
    const res = await engine.deleteServerDeletesLocally(rows);
    await save;
    expect(res.kept).toEqual(['c1']);
    expect((await folder.getElement('c1'))!.description).toBe('queued');
  });

  it('a row resolved elsewhere meanwhile is skipped, not deleted', async () => {
    const rows = await engine.reviewServerDeletes();
    await engine.resolveServerDelete('c2', 'keep');
    const res = await engine.deleteServerDeletesLocally(rows);
    expect(res.deleted.sort()).toEqual(['c1', 'c3']);
    expect(await folder.getElement('c2')).not.toBeNull();
  });

  it('a Keep that lands after the review read its rows wins: kept, and re-created by its push (gate F1)', async () => {
    const rows = await engine.reviewServerDeletes();
    // The Keep clears the entry and the server stamp; the edit time stays.
    await engine.resolveServerDelete('c3', 'keep');
    const res = await engine.deleteServerDeletesLocally(rows);
    expect(res.deleted.sort()).toEqual(['c1', 'c2']);
    expect(await folder.getElement('c3')).not.toBeNull();
  });

  it('a Keep whose entry is still listed (cleared baseline only) is kept by the server-stamp guard', async () => {
    const rows = await engine.reviewServerDeletes();
    await folder.clearServerBaseline('c2');
    const res = await engine.deleteServerDeletesLocally(rows);
    expect(res.kept).toEqual(['c2']);
    expect(await folder.getElement('c2')).not.toBeNull();
  });

  it('a row that fails is reported and the rest still run (gate F4)', async () => {
    const rows = await engine.reviewServerDeletes();
    folder.deleteFailures.add('c1');
    const res = await engine.deleteServerDeletesLocally(rows);
    expect(res.failed).toEqual(['c1']);
    expect(res.deleted.sort()).toEqual(['c2', 'c3']);
    expect(ids(await engine.listServerDeletes())).toEqual(['c1']);
  });

  it('stops at an unlink: the rest stay to review', async () => {
    const rows = await engine.reviewServerDeletes();
    engine.stop();
    const res = await engine.deleteServerDeletesLocally(rows);
    expect(res.deleted).toEqual([]);
    expect(await folder.getElement('c1')).not.toBeNull();
  });
});

describe('FsFolderStore.deleteSilentlyIfUnchanged (the real store reads the disk)', () => {
  const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
  let t = 0;
  const clock = () => new Date(Date.UTC(2026, 1, 1, 0, 0, t++)).toISOString();
  async function open(): Promise<{ s: FsFolderStore; root: FakeDirHandle }> {
    const root = new FakeDirHandle('w');
    root.put('world.json', j({ id: 'w1', name: 'W' }));
    const s = new FsFolderStore({ clock, tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
    await s.open(root as unknown as FileSystemDirectoryHandle);
    return { s, root };
  }
  const fileOf = (root: FakeDirHandle, id: string) =>
    root.list().find(p => p.startsWith('elements/') && p.includes(id.slice(-8)) && p.endsWith('.json'));

  it('deletes an unchanged copy silently: the file goes, no tombstone', async () => {
    const { s, root } = await open();
    const el = await s.createElement('character', { name: 'Lu' });
    expect(await s.deleteSilentlyIfUnchanged(el.id, stamps(el))).toBe(true);
    expect(fileOf(root, el.id)).toBeUndefined();
    expect(await s.listTombstonesSince(null)).toEqual([]);
  });

  it('keeps a copy whose server stamp moved (a Keep cleared it), edit time unchanged', async () => {
    const { s, root } = await open();
    const el = await s.createElement('character', { name: 'Lu' });
    await s.stampServerUpdatedAt(el.id, 'character', '2026-03-01T00:00:00.000Z');
    const seen = stamps((await s.getElement(el.id))!);
    await s.clearServerBaseline(el.id);
    expect(await s.deleteSilentlyIfUnchanged(el.id, seen)).toBe(false);
    expect(fileOf(root, el.id)).toBeDefined();
  });

  it('keeps a copy an outside writer changed on disk, even before any pass adopted it', async () => {
    const { s, root } = await open();
    const el = await s.createElement('character', { name: 'Lu', description: 'v1' });
    await s.listElements();
    const p = fileOf(root, el.id)!;
    root.put(p, j({ ...JSON.parse(root.get(p)!), description: 'agent', local_updated_at: '2026-04-01T00:00:00.000Z' }));
    expect(await s.deleteSilentlyIfUnchanged(el.id, stamps(el))).toBe(false);
    expect(fileOf(root, el.id)).toBe(p);
  });

  it('an absent copy is done (true), and writes nothing', async () => {
    const { s } = await open();
    expect(await s.deleteSilentlyIfUnchanged('0695db83-0000-7000-8000-000000000000',
      { local_updated_at: null, server_updated_at: null })).toBe(true);
  });
});
