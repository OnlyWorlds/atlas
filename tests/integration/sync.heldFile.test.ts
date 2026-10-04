/**
 * A FILE ANOTHER PROGRAM HOLDS (S368, the Discord report).
 *
 * A user adding characters to a linked world kept getting "1 change could not
 * sync (An operation that depends on state cached in an interface object was
 * made but the state had changed since it was read from disk.)". The upload
 * had succeeded; the stamp Atlas writes afterwards failed because something on
 * their machine (a cloud sync client, antivirus, the indexer) had the brand-new
 * file open, which Windows refuses and Chromium words as above. Atlas never
 * retried, and a second hit next round threw out of the whole round.
 *
 * The real FsFolderStore, SyncEngine and v2 adapter run here against the MSW
 * keel; `fake-fs` refuses closes on a held file as Chromium does.
 * (Investigation: `Forge/Notes/2026-10-04-s368-orient/lane-e/report.md`.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { writeJsonAtomic, setBusyRetryDelaysForTests } from '../../src/store/fs-utils';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { SyncEngine } from '../../src/sync/sync-engine';
import { failureToastOnce, __resetFailureToasts } from '../../src/sync/sync-failure-copy';

const V2 = 'https://test-ow.local/api/v2';
const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 9, 4, 0, 0, t++)).toISOString();

let server: ReturnType<typeof statefulV2Handlers>;
let adapter: OwV2ClientAdapter;
const engines: SyncEngine[] = [];
beforeEach(() => {
  server = statefulV2Handlers({ baseUrl: V2, clock });
  mswServer.use(...server.handlers);
  adapter = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: V2 });
  __resetFailureToasts();
  setBusyRetryDelaysForTests([0, 0, 0, 0]);
});
afterEach(() => {
  setBusyRetryDelaysForTests(null);
  for (const e of engines.splice(0)) e.stop?.();
});

async function world() {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  root.put('elements/character/.keep', '');
  const store = new FsFolderStore({ clock, tabId: 't', disableHeartbeat: true, forceTakeLock: true });
  await store.open(root as unknown as FileSystemDirectoryHandle);
  await store.listElements();
  await store.awaitTidies();
  const engine = new SyncEngine({ folder: store, client: adapter });
  engines.push(engine);
  return { root, store, engine };
}
const charFile = (root: FakeDirHandle) =>
  root.list().find(p => p.startsWith('elements/character/') && !p.endsWith('.keep'))!;

describe('the file writer and a held file (S368)', () => {
  it('waits out a short hold and writes once, leaving no .tmp', async () => {
    const root = new FakeDirHandle('w');
    root.put('a.json', j({ v: 1 }));
    root.hold('a.json', 2); // let go after two refused closes
    await writeJsonAtomic(root as unknown as FileSystemDirectoryHandle, 'a.json', { v: 2 });
    expect(JSON.parse(root.get('a.json')!)).toEqual({ v: 2 });
    expect(root.list()).toEqual(['a.json']);
  });

  it('a held file met by the first read does not escape the retries (gate A H2)', async () => {
    const root = new FakeDirHandle('w');
    root.put('a.json', j({ v: 1 }));
    const h = await root.getFileHandle('a.json');
    const g = h.getFile.bind(h);
    // The blob comes back; reading it rejects, as Chromium's does on a held file.
    h.getFile = async () => {
      h.getFile = g;
      const blob = await g();
      return Object.assign(Object.create(Object.getPrototypeOf(blob)), blob, {
        text: async () => { const e = new Error('held'); e.name = 'NotReadableError'; throw e; },
      });
    };
    await writeJsonAtomic(root as unknown as FileSystemDirectoryHandle, 'a.json', { v: 2 });
    expect(JSON.parse(root.get('a.json')!)).toEqual({ v: 2 });
  });

  it('a file changed after our write is not written over again (gate A M2)', async () => {
    const root = new FakeDirHandle('w');
    root.put('a.json', j({ v: 1 }));
    const h = await root.getFileHandle('a.json');
    const g = h.getFile.bind(h);
    let reads = 0;
    // The before-read passes; the read-back meets an outside write in progress.
    h.getFile = async () => {
      if (++reads === 2) { h.data = j({ v: 'outside' }); const e = new Error('changed'); e.name = 'NotReadableError'; throw e; }
      return g();
    };
    await expect(writeJsonAtomic(root as unknown as FileSystemDirectoryHandle, 'a.json', { v: 2 }))
      .rejects.toMatchObject({ name: 'NotReadableError' });
    expect(JSON.parse(root.get('a.json')!)).toEqual({ v: 'outside' });
  });

  it('gives up on a long hold with the error, and leaves the file whole', async () => {
    const root = new FakeDirHandle('w');
    root.put('a.json', j({ v: 1 }));
    root.hold('a.json');
    await expect(writeJsonAtomic(root as unknown as FileSystemDirectoryHandle, 'a.json', { v: 2 }))
      .rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(JSON.parse(root.get('a.json')!)).toEqual({ v: 1 });
    expect(root.list()).toEqual(['a.json']);
  });
});

describe('a push while a new character is held (S368)', () => {
  it('records the hold against the element, keeps the round alive, and heals once released', async () => {
    const { root, store, engine } = await world();
    const el = await store.createElement('character', { name: 'Aldric Vane' });
    const file = charFile(root);
    root.hold(file);

    // Round 1: the POST lands, the stamp after it is refused.
    const r1 = await engine.pushOnce();
    expect(server.state.get('character')?.has(el.id)).toBe(true);
    expect(r1.failures).toEqual([
      expect.objectContaining({ element_id: el.id, operation: 'create', error_name: 'InvalidStateError' }),
    ]);
    expect(failureToastOnce(r1.failures)).toBeNull(); // the first hold stays quiet

    // Round 2, still held: the re-POST answers 409 and the adopt's stamp is
    // refused again. Before S368 that escaped the loop and the round threw.
    const r2 = await engine.pushOnce();
    expect(r2.failures).toEqual([expect.objectContaining({ element_id: el.id, error_name: 'InvalidStateError' })]);
    const toast = failureToastOnce(r2.failures);
    expect(toast).toContain('another program was using its file');
    expect(toast).not.toContain('interface object');

    // Released: the next round adopts the server copy; nothing is left to do.
    root.release(file);
    const r3 = await engine.pushOnce();
    expect(r3.failures).toEqual([]);
    expect((await store.listLocallyChangedSince(null)).map(e => e.id)).not.toContain(el.id);
    expect(server.state.get('character')?.size).toBe(1);
    expect(root.list().filter(p => p.endsWith('.tmp'))).toEqual([]);
  });

  it('the round survives a held sync-state file too, and keeps its failures (gate A H1)', async () => {
    const { root, store, engine } = await world();
    root.put('.atlas/sync-state.json', '{}\n');
    const el = await store.createElement('character', { name: 'Aldric Vane' });
    root.hold(charFile(root));
    root.hold('.atlas/sync-state.json');
    const r = await engine.pushOnce();
    // The element's stamp and the sync-state writes (world-meta step, round end) each report.
    expect(new Set(r.failures.map(f => f.element_id))).toEqual(new Set([el.id, 'world']));
    expect((engine as unknown as { transientRetryTimer: unknown }).transientRetryTimer).not.toBeNull();
  });

  it('a held folder under a bulk upload: every create is recorded, none throws (gate A M3, L6)', async () => {
    const { root, store, engine } = await world();
    for (const n of ['A', 'B', 'C', 'D', 'E']) await store.createElement('character', { name: n });
    const files = root.list().filter(p => p.startsWith('elements/character/') && !p.endsWith('.keep'));
    for (const f of files) root.hold(f, 100);
    const r = await engine.pushOnce();
    // Three files wait out their retries (5 closes each); the other two are
    // recorded without trying, so the round does not cost 5 x 2 s.
    const dir = await root.getDirectoryHandle('elements').then(d => d.getDirectoryHandle('character'));
    let closes = 0;
    for (const f of files) closes += 100 - (await dir.getFileHandle(f.split('/').pop()!)).heldCloses;
    expect(closes).toBe(15);
    expect(server.state.get('character')?.size).toBe(5);
    expect(r.failures).toHaveLength(5);
    expect(r.failures.every(f => f.error_name === 'InvalidStateError')).toBe(true);
    for (const f of files) root.release(f);
    const r2 = await engine.pushOnce(); // the re-POSTs answer 409 and adopt
    expect(r2.failures).toEqual([]);
    expect(await store.listLocallyChangedSince(null)).toEqual([]);
  });

  it('stops retrying after five rounds in a row on a file that never frees up (gate A L4)', async () => {
    const { root, store, engine } = await world();
    await store.createElement('character', { name: 'Mira' });
    root.hold(charFile(root));
    const timer = () => (engine as unknown as { transientRetryTimer: unknown }).transientRetryTimer;
    for (let i = 0; i < 5; i++) { await engine.pushOnce(); expect(timer()).not.toBeNull(); }
    (engine as unknown as { transientRetryTimer: ReturnType<typeof setTimeout> | null }).transientRetryTimer &&
      clearTimeout((engine as unknown as { transientRetryTimer: ReturnType<typeof setTimeout> }).transientRetryTimer);
    (engine as unknown as { transientRetryTimer: unknown }).transientRetryTimer = null;
    await engine.pushOnce();
    expect(timer()).toBeNull();
  });

  it('a held file schedules a retry instead of waiting for the next edit', async () => {
    const { root, store, engine } = await world();
    await store.createElement('character', { name: 'Mira' });
    root.hold(charFile(root));
    await engine.pushOnce();
    expect((engine as unknown as { transientRetryTimer: unknown }).transientRetryTimer).not.toBeNull();
  });
});
