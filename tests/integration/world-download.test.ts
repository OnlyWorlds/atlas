/**
 * Download the whole world (1.17 bout 5, contract §5.1, §9 invariant 13; S370
 * gate lens A A9, A11, lens B B9, B12): one file holding the portable copy,
 * refused when anything changed while it was made (two walks), refused for
 * the tour world; a linked world pushes first, then holds sync for the walk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { setActiveStore } from '../../src/core/active-store';
import { FakeDirHandle, FakeFileHandle } from '../fixtures/fake-fs';
import { BROWSER_HOME, setOpfsRootForTests } from '../../src/core/browser-worlds';
import { FsFolderStore } from '../../src/store/folder-store-fs';

const sync = vi.hoisted(() => ({ worldId: null as string | null, order: [] as string[] }));
vi.mock('../../src/sync/sync-attach', () => ({
  getCurrentSyncWorldId: () => sync.worldId,
  getCurrentSyncEngine: () => ({
    pushOnce: async () => { sync.order.push('push'); return {}; },
    isPaused: () => false,
    hold: async (r: string) => { sync.order.push(`hold:${r}`); return () => { sync.order.push('release'); }; },
  }),
}));

import { downloadWorld, TORN_LINE, type RecordsAnswer, type RecordsQuestion } from '../../src/setup/world-download';
import { setExportMeReaderForTests } from '../../src/sync/export-provenance';
import { FOLDER_FORMAT_VERSION } from '../../src/core/constants';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const asDir = (d: FakeDirHandle) => d as unknown as FileSystemDirectoryHandle;
const DIR = 'hollow-reach-0192a000-1a2b';
const WID = '0192a000-aaaa-7bbb-8ccc-000000000001';
let opfs: FakeDirHandle;
let world: FakeDirHandle;
let store: FsFolderStore;
let saved: { name: string; bytes: Uint8Array } | null;
let meReads: string[] = [];
let meAnswer: () => { role: string; character?: string | null; world?: { id?: string } } = () => ({ role: 'owner', character: null, world: { id: 'srv' } });

function entry(over: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry {
  return {
    id: 'w1', name: 'Hollow Reach', state: 'local-only', where: 'browser', created_at: '2026-10-05T00:00:00.000Z',
    folder: { handle_key: `world-${WID}`, folder_name: DIR }, ...over,
  };
}
const cur = () => getState().registry.worlds[0];
const save = { kind: 'test' as const, write: async (name: string, bytes: Uint8Array) => { saved = { name, bytes }; } };

beforeEach(async () => {
  saved = null;
  sync.worldId = null; sync.order = [];
  opfs = new FakeDirHandle('opfs');
  const home = await opfs.getDirectoryHandle(BROWSER_HOME, { create: true });
  world = await home.getDirectoryHandle(DIR, { create: true });
  world.put('world.json', j({ id: WID, name: 'Hollow Reach', api: { world_id: 'srv', api_key: 'ow_w_secret' } }));
  world.put('.atlas/sync-state.json', '{}');
  world.put('media/map.png', 'PNG');
  setOpfsRootForTests(async () => asDir(opfs));
  store = new FsFolderStore({ tabId: 't', disableHeartbeat: true });
  await store.open(asDir(world));
  await store.createElement('character', { name: 'Ana' } as never);
  setActiveStore(store);
  meReads = [];
  meAnswer = () => ({ role: 'owner', character: null, world: { id: 'srv' } });
  setExportMeReaderForTests(async (key) => { meReads.push(key); return meAnswer(); });
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry()] });
  patchSlice('active', { worldId: 'w1', meta: { id: WID, name: 'Hollow Reach' }, opened: true } as never);
});
afterEach(async () => {
  setExportMeReaderForTests(null);
  await store.close().catch(() => {});
  setActiveStore(null);
  setOpfsRootForTests(null);
  patchSlice('active', null);
});

describe('downloadWorld', () => {
  it('hands over one file: the portable copy under one folder, and records when', async () => {
    const out = await downloadWorld(cur(), save, { now: new Date('2026-10-05T10:00:00Z') });
    expect(out!.file).toBe('hollow-reach-2026-10-05.zip');
    expect(saved!.name).toBe('hollow-reach-2026-10-05.zip');
    const files = Object.keys(unzipSync(saved!.bytes)).sort();
    // Everything under one folder, but §4.7's marker, the archive's first entry at its root (SDK 4.49).
    expect(files.filter(f => !f.startsWith('hollow-reach-0192a000/'))).toEqual(['mimetype']);
    expect(files).toContain('hollow-reach-0192a000/world.json');
    expect(files).toContain('hollow-reach-0192a000/media/map.png');
    expect(files.some(f => f.includes('sync-state') || f.endsWith('/lock'))).toBe(false);
    expect(new TextDecoder().decode(unzipSync(saved!.bytes)['hollow-reach-0192a000/world.json'])).not.toContain('ow_w_secret');
    expect(cur().kept_download_at).toBeTruthy();
  });

  it('refuses a world that changed while the file was made (a file added between the walks)', async () => {
    const realGetFile = FakeFileHandle.prototype.getFile;
    let reads = 0;
    FakeFileHandle.prototype.getFile = async function (this: FakeFileHandle) {
      if (++reads === 2) world.put('elements/character/bel--00000002.json', j({ id: '2', name: 'Bel' }));
      return realGetFile.call(this);
    };
    try {
      await expect(downloadWorld(cur(), save)).rejects.toThrow(TORN_LINE);
    } finally {
      FakeFileHandle.prototype.getFile = realGetFile;
    }
    expect(saved).toBeNull();
    expect(cur().kept_download_at).toBeUndefined();
  });

  it('a file that cannot be read mid-walk is the same refusal, never a disk-busy sentence', async () => {
    const realGetFile = FakeFileHandle.prototype.getFile;
    FakeFileHandle.prototype.getFile = async function (this: FakeFileHandle) {
      if (this.name === 'map.png') throw Object.assign(new Error('snapshot'), { name: 'NotReadableError' });
      return realGetFile.call(this);
    };
    try {
      await expect(downloadWorld(cur(), save)).rejects.toThrow(TORN_LINE);
    } finally {
      FakeFileHandle.prototype.getFile = realGetFile;
    }
  });

  it('a linked world pushes first, then holds sync for the walk, then lets go', async () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry({ state: 'api-linked', api: { world_id: 'srv', api_key: 'k' } })] });
    sync.worldId = 'w1';
    await downloadWorld(cur(), save);
    expect(sync.order).toEqual(['push', 'hold:download', 'release']);
  });

  // Folder spec §4.2 (W1-W3): a linked world's file says where it came from and which slice it is.
  const fileMeta = () => JSON.parse(new TextDecoder().decode(unzipSync(saved!.bytes)['hollow-reach-0192a000/world.json']));

  it('a linked world\'s file carries source and its slice from /me, asked with its own key', async () => {
    const ana = (await store.listElements('character'))[0];
    meAnswer = () => ({ role: 'guest', character: ana.id, world: { id: 'srv' } });
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry({ state: 'api-linked', api: { world_id: 'srv', api_key: 'ow_w_mine' } })] });
    await downloadWorld(cur(), save, { now: new Date('2026-10-20T19:00:00Z') });
    expect(meReads).toEqual(['ow_w_mine']);
    const meta = fileMeta();
    expect(meta.source).toEqual({ server: 'https://www.onlyworlds.com', world: 'srv', at: '2026-10-20T19:00:00.000Z' });
    expect(meta.exported_as).toEqual({ kind: 'character', role: 'guest', character: { id: ana.id, name: 'Ana' } });
    expect(meta.format_version).toBe(FOLDER_FORMAT_VERSION);
    // The world's own world.json is left as it was.
    expect((await store.readWorldMeta() as unknown as Record<string, unknown>).source).toBeUndefined();
  });

  it('a local world\'s file asks nothing and adds no line', async () => {
    await downloadWorld(cur(), save);
    expect(meReads).toEqual([]);
    expect(fileMeta().source).toBeUndefined();
    expect(fileMeta().exported_as).toBeUndefined();
  });

  it('refuses a world bigger than Atlas can open again, on every target (gate F4)', async () => {
    const out = downloadWorld(cur(), { ...save, kind: 'picker' }, { maxBytes: 10 });
    await expect(out).rejects.toThrow(/too big/);
    expect(saved).toBeNull();
  });

  it('refuses the tour world', async () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry({ demo: true })] });
    await expect(downloadWorld(cur(), save)).rejects.toThrow(/keep it at the end of the tour/);
    expect(saved).toBeNull();
  });
});

// Folder spec §4.5 rule 11, §4.7 OW-8 (v0.3.15; Skeld h58 #10911; SDK 4.63.0):
// a download leaves a producer's private records out unless the person asks.
describe('downloadWorld and private records', () => {
  const list = (body: unknown) => world.put('records/RECORDS.json', typeof body === 'string' ? body : JSON.stringify(body));
  const savedPaths = () => Object.keys(unzipSync(saved!.bytes)).map(p => p.slice(p.indexOf('/') + 1));
  let asked: RecordsQuestion[];
  const answering = (a: RecordsAnswer) => async (q: RecordsQuestion) => { asked.push(q); sync.order.push('ask'); return a; };
  beforeEach(() => {
    asked = [];
    world.put('records/fold/spine.jsonl', '{}');
    world.put('records/fold/.head', 'h');
    world.put('records/lab/ledger.bin', 'L');
  });
  const foldPrivate = () => list([
    { producer: 'lab', format: 'x', version: '1', deltas: false },
    { producer: 'fold', format: 'y', version: '1', deltas: false, private: true },
  ]);

  it('asks when a producer keeps its records private; left out, the file holds the list and lab, and says whose went', async () => {
    foldPrivate();
    const out = await downloadWorld(cur(), save, { ask: answering('leave-out') });
    expect(asked).toEqual([{ kind: 'private', producers: ['fold'] }]);
    expect(out).toEqual({ file: expect.any(String), leftOut: ['fold'] });
    expect(savedPaths()).toContain('records/RECORDS.json');
    expect(savedPaths()).toContain('records/lab/ledger.bin');
    expect(savedPaths().some(p => p.startsWith('records/fold/'))).toBe(false);
    expect(cur().kept_download_at).toBeTruthy();
  });

  it('asked to include them, fold travels whole, its dot-file too', async () => {
    foldPrivate();
    const out = await downloadWorld(cur(), save, { ask: answering('include') });
    expect(out!.leftOut).toEqual([]);
    expect(savedPaths()).toEqual(expect.arrayContaining(['records/fold/spine.jsonl', 'records/fold/.head', 'records/lab/ledger.bin']));
  });

  it('closing the question makes no file and records no download', async () => {
    foldPrivate();
    expect(await downloadWorld(cur(), save, { ask: answering(null) })).toBeNull();
    expect(saved).toBeNull();
    expect(cur().kept_download_at).toBeUndefined();
  });

  it('a list that will not read asks to include every record, or makes no file; it is never left out by guess', async () => {
    list({ producers: [{ producer: 'fold', private: true }] }); // the shape before v0.3.12
    expect(await downloadWorld(cur(), save, { ask: answering('leave-out') })).toBeNull();
    expect(saved).toBeNull();
    expect(asked).toEqual([{ kind: 'unreadable' }]);
    await downloadWorld(cur(), save, { ask: answering('include') });
    expect(savedPaths()).toEqual(expect.arrayContaining(['records/fold/spine.jsonl', 'records/RECORDS.json']));
  });

  it('without a person to ask, the rule\'s default: private records out, and no file for a list that will not read', async () => {
    foldPrivate();
    expect((await downloadWorld(cur(), save))!.leftOut).toEqual(['fold']);
    saved = null;
    list('{nope');
    expect(await downloadWorld(cur(), save)).toBeNull();
    expect(saved).toBeNull();
  });

  it('a world with records and nothing private asks nothing and carries them all', async () => {
    list([{ producer: 'fold', format: 'y', version: '1', deltas: false }]);
    const out = await downloadWorld(cur(), save, { ask: answering('leave-out') });
    expect(asked).toEqual([]);
    expect(out!.leftOut).toEqual([]);
    expect(savedPaths()).toContain('records/fold/.head');
  });

  it('a linked world lets sync go before the person is asked', async () => {
    foldPrivate();
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry({ state: 'api-linked', api: { world_id: 'srv', api_key: 'k' } })] });
    sync.worldId = 'w1';
    await downloadWorld(cur(), save, { ask: answering('leave-out') });
    expect(sync.order).toEqual(['push', 'hold:download', 'release', 'ask']);
  });
});
