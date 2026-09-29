/**
 * The re-key kernel (`store/rekey.ts`) on the REAL FsFolderStore, over the
 * in-memory FS in `fixtures/fake-fs.ts`. The mock matrix (`rekey.test.ts`)
 * cannot see these: it has no directories, no layouts, no body cache separate
 * from disk, no loose media and no journal that exists but reads empty. Each
 * row came from an S363 gate lens A probe (`Forge/Notes/2026-09-29-s363-gate/`)
 * and asserts the FIXED behaviour; the probe ids are named per row.
 */
import { describe, it, expect } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { startRekey, recoverRekey, RekeyRefusedError } from '../../src/store/rekey';
import { RekeyPendingError } from '../../src/store/folder-store';
import type { FolderStore } from '../../src/store/folder-store';
import type { Element } from '../../src/core/types';

const O = '00000000-0000-4000-8000-0000000000a1';
const N = '00000000-0000-4000-8000-0000000000b1';
const R = '00000000-0000-4000-8000-0000000000c1';
const short = (id: string) => id.slice(-8);

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 1, 1, 0, 0, t++)).toISOString();

/** Mints N once; a second call means the kernel minted twice. */
const mintOnce = () => { let used = false; return () => { if (used) throw new Error('minted twice'); used = true; return N; }; };

async function open(root: FakeDirHandle): Promise<FsFolderStore> {
  const s = new FsFolderStore({ clock, tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
  await s.open(root as unknown as FileSystemDirectoryHandle);
  return s;
}

function baseWorld(): FakeDirHandle {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  return root;
}

/** Every file with its bytes, for "touched nothing" checks. */
function diskImage(root: FakeDirHandle): Record<string, string | null> {
  return Object.fromEntries(root.list().map(p => [p, root.get(p)]));
}

/** A store whose nth call of `method` throws: a tab closed at that point. */
function crashOn<T extends object>(target: T, method: string, nth: number): FolderStore {
  let n = 0;
  return new Proxy(target, {
    get(tt, prop, recv) {
      const v = Reflect.get(tt, prop, recv);
      if (typeof v !== 'function') return v;
      if (prop !== method) return v.bind(tt);
      return (...a: unknown[]) => { if (++n === nth) throw new Error('crash'); return v.apply(tt, a); };
    },
  }) as unknown as FolderStore;
}

describe('re-key on the real folder store', () => {
  it('row 1 (probe B1): loose and nested media under media/O are copied to media/N, byte for byte, before media/O goes', async () => {
    const root = baseWorld();
    root.put(`elements/location/rivendell--${short(O)}.json`, j({ id: O, type: 'location', name: 'Rivendell', image_media_id: 'm1', local_updated_at: '2026-01-01T00:00:00.000Z' }));
    root.put(`media/${O}/default/pic.png`, 'PNG');
    root.put(`media/${O}/default/m1.meta.json`, j({ id: 'm1', element_id: O, folder: 'default', filename: 'pic.png', mime: 'image/png', size_bytes: 3, added_at: 'x' }));
    root.put(`media/${O}/cover.jpg`, 'LOOSE');                // a file straight under the element dir
    root.put(`media/${O}/default/drafts/sketch.png`, 'NEST'); // a nested folder
    root.put(`media/${O}/default/bad.meta.json`, '{ this is not json'); // a sidecar that will not parse
    const s = await open(root);

    await startRekey(s, { worldId: 'w1', ids: [O], mintId: mintOnce() });
    await s.awaitTidies();

    expect(root.get(`media/${N}/cover.jpg`)).toBe('LOOSE');
    expect(root.get(`media/${N}/default/drafts/sketch.png`)).toBe('NEST');
    expect(root.get(`media/${N}/default/pic.png`)).toBe('PNG');
    expect(root.get(`media/${N}/default/bad.meta.json`)).toBe('{ this is not json');
    expect(JSON.parse(root.get(`media/${N}/default/m1.meta.json`)!).element_id).toBe(N);
    expect(root.list().filter(p => p.startsWith(`media/${O}/`))).toEqual([]);
    expect(await s.getMediaBlob('m1')).not.toBeNull();
  });

  it('row 2 (probe E1): an outside edit to O after open is on N after the kernel', async () => {
    const root = baseWorld();
    const oPath = `elements/location/rivendell--${short(O)}.json`;
    const rPath = `elements/character/elrond--${short(R)}.json`;
    root.put(oPath, j({ id: O, type: 'location', name: 'Rivendell', local_updated_at: '2026-01-01T00:00:00.000Z' }));
    root.put(rPath, j({ id: R, type: 'character', name: 'Elrond', location: O, local_updated_at: '2026-01-01T00:00:00.000Z' }));
    const s = await open(root);
    await s.listElements(); // the body cache is warm
    // Another tool (or a git pull) edits both files while atlas holds the world.
    root.put(oPath, j({ id: O, type: 'location', name: 'Rivendell', description: 'EDITED OUTSIDE', local_updated_at: '2026-01-01T00:00:00.000Z' }));
    root.put(rPath, j({ id: R, type: 'character', name: 'Elrond', location: O, description: 'ALSO OUTSIDE', local_updated_at: '2026-01-01T00:00:00.000Z' }));

    await startRekey(s, { worldId: 'w1', ids: [O], mintId: mintOnce() });

    expect((await s.getElement(N))?.description).toBe('EDITED OUTSIDE');
    const r = await s.getElement(R);
    expect(r?.description).toBe('ALSO OUTSIDE');
    expect(r?.location).toBe(N);
    expect(root.get(oPath)).toBeNull();
  });

  it('row 3 (probe B2): an O whose body type disagrees with its directory is really gone, and a reopen does not serve it', async () => {
    const root = baseWorld();
    // A foreign writer put a location body in the character directory.
    root.put(`elements/character/rivendell--${short(O)}.json`, j({ id: O, type: 'location', name: 'Rivendell' }));
    const s = await open(root);

    await startRekey(s, { worldId: 'w1', ids: [O], mintId: mintOnce() });
    await s.awaitTidies();

    expect(await s.getElement(O)).toBeNull();
    expect(root.list().filter(p => p.includes(short(O)))).toEqual([]);
    await s.close();
    const s2 = await open(root);
    expect(await s2.getElement(O)).toBeNull();
    expect((await s2.getElement(N))?.name).toBe('Rivendell');
  });

  it('row 4 (probe B3): an O in both elements/ and spatial/ is refused, touching nothing', async () => {
    const root = baseWorld();
    root.put(`spatial/map/old-map--${short(O)}.json`, j({ id: O, type: 'map', name: 'Old Map', local_updated_at: '2026-01-01T00:00:00.000Z' }));
    root.put(`elements/map/old-map--${short(O)}.json`, j({ id: O, type: 'map', name: 'Old Map v2', local_updated_at: '2026-01-02T00:00:00.000Z' }));
    const s = await open(root);
    await s.listElements(); // build the index, and let its filename tidy settle first
    await s.awaitTidies();
    const before = diskImage(root);

    const run = startRekey(s, { worldId: 'w1', ids: [O], mintId: mintOnce() });
    await expect(run).rejects.toBeInstanceOf(RekeyRefusedError);
    await expect(run).rejects.toThrow(/elements\/.*spatial\//);

    await s.awaitTidies();
    expect(await s.hasRekeyJournal()).toBe(false);
    expect(await s.getElement(N)).toBeNull();
    expect((await s.getElement(O))?.name).toBe('Old Map v2');
    expect(diskImage(root)).toEqual(before);
  });

  it('row 5 (probe F2 of f-recovery-real): an empty journal file is cleared by recovery and sync can run again', async () => {
    const root = baseWorld();
    root.put('.atlas/rekey-journal.json', ''); // a tab closed inside the journal's FIRST write
    const s = await open(root);
    expect(await s.hasRekeyJournal()).toBe(true);

    expect(await recoverRekey(s)).toBeNull();

    expect(await s.hasRekeyJournal()).toBe(false);
    expect(root.get('.atlas/rekey-journal.json')).toBeNull();
  });

  it('row 11, real store (lens A F9 + F4): O loses a field on disk between the journal and step 6; N does not keep it', async () => {
    const root = baseWorld();
    const oPath = `elements/location/rivendell--${short(O)}.json`;
    root.put(oPath, j({ id: O, type: 'location', name: 'Rivendell', description: 'first', local_updated_at: '2026-01-01T00:00:00.000Z' }));
    const s = await open(root);
    let edited = false;
    await startRekey(s, { worldId: 'w1', ids: [O], mintId: mintOnce() }, {
      rekeyPersistedState: () => {
        if (edited) return;
        edited = true; // another tool rewrites O's file with description cleared
        root.put(oPath, j({ id: O, type: 'location', name: 'Rivendell', local_updated_at: '2026-01-05T00:00:00.000Z' }));
      },
    });
    await s.awaitTidies();
    const n = (await s.getElement(N))!;
    expect(n.name).toBe('Rivendell');
    expect(n.description ?? null).toBeNull();
    const nFile = root.list().find(p => p.includes(short(N)))!;
    expect(root.get(nFile)).not.toContain('first');
    expect(root.get(oPath)).toBeNull();
  });

  it('row 9, real store (probe D2): while a journal is pending, a UI delete of O or N is refused and no link is scrubbed; a silent delete passes', async () => {
    const root = baseWorld();
    root.put(`elements/location/rivendell--${short(O)}.json`, j({ id: O, type: 'location', name: 'Rivendell' }));
    root.put(`elements/character/elrond--${short(R)}.json`, j({ id: R, type: 'character', name: 'Elrond', location: O }));
    const s = await open(root);
    // Crash on step 6's first delete: N exists, the referrer already names N.
    await expect(startRekey(crashOn(s, 'deleteElement', 1), { worldId: 'w1', ids: [O], mintId: mintOnce() })).rejects.toThrow('crash');
    expect(await s.hasRekeyJournal()).toBe(true);
    expect((await s.getElement(R))?.location).toBe(N);

    await expect(s.deleteElement(N)).rejects.toBeInstanceOf(RekeyPendingError);
    await expect(s.deleteElement(O)).rejects.toBeInstanceOf(RekeyPendingError);
    expect((await s.getElement(R))?.location).toBe(N);
    expect(await s.getElement(N)).not.toBeNull();
    expect(await s.getElement(O)).not.toBeNull();

    // The engine's and the kernel's own channel still works.
    await s.deleteElement(O, { silent: true, cascade: false });
    expect(await s.getElement(O)).toBeNull();
  });
});

describe('re-key convergence guards (upheld by the gate, kept as regressions)', () => {
  it('probe F1 of f-recovery-real: recovery racing the background tidy converges (non-canonical names for O, N and a referrer)', async () => {
    const root = baseWorld();
    root.put(`elements/location/${O}.json`, j({ id: O, type: 'location', name: 'Rivendell', local_updated_at: '2026-01-01T00:00:00.000Z' }));
    root.put(`elements/location/WRONG-${N}.json`, j({ id: N, type: 'location', name: 'Rivendell', local_updated_at: '2026-01-02T00:00:00.000Z' }));
    root.put(`elements/character/${R}.json`, j({ id: R, type: 'character', name: 'Elrond', location: O, local_updated_at: '2026-01-01T00:00:00.000Z' }));
    root.put('.atlas/rekey-journal.json', j({ version: 1, world_id: 'w1', map: { [O]: N }, types: { [O]: 'location' }, stamps: { [O]: '2026-01-01T00:00:00.000Z' }, unrewritten: [], started_at: 'x' }));
    const s = await open(root);

    await recoverRekey(s); // no awaitTidies first: the index build inside schedules the tidy
    await s.awaitTidies();

    const files = root.list().filter(p => p.startsWith('elements/'));
    expect(files.some(f => f.includes(short(O)))).toBe(false);
    expect(files.filter(f => f.includes(short(N)))).toHaveLength(1);
    expect(root.get(files.find(f => f.includes('character'))!)).toContain(N);
    expect(await s.hasRekeyJournal()).toBe(false);
  });

  it('probe H1: an EMPTY N file (a crash inside its first write) is written over by recovery, not skipped', async () => {
    const root = baseWorld();
    root.put(`elements/location/rivendell--${short(O)}.json`, j({ id: O, type: 'location', name: 'Rivendell', description: 'keep me' }));
    root.put(`elements/location/rivendell--${short(N)}.json`, '');
    root.put('.atlas/rekey-journal.json', j({ version: 1, world_id: 'w1', map: { [O]: N }, types: { [O]: 'location' }, stamps: {}, unrewritten: [], started_at: 'x' }));
    const s = await open(root);

    await recoverRekey(s);
    await s.awaitTidies();

    const files = root.list().filter(f => f.startsWith('elements/'));
    expect(files).toHaveLength(1);
    expect(files[0]).toContain(short(N));
    expect(root.get(files[0])).toContain('keep me');
    expect(await s.hasRekeyJournal()).toBe(false);
  });

  // On the mock (as the probe ran), for speed: every (k, k2) pair of a crash
  // in the run and a second crash inside recovery.
  it('probe G1: a crash at k, a second crash at k2 inside recovery, then recovery, ends where a clean run ends', async () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const minter = () => { let i = 900; return () => id(i++); };
    const MUT = new Set(['createElementVerbatim', 'copyMediaDir', 'updateElementWith', 'writeCharts', 'deleteElement', 'removeMediaDir', 'updateSyncState', 'writeRekeyJournal', 'clearRekeyJournal']);
    const crashAfter = (target: MockFolderStore, k: number) => {
      let n = 0;
      const p = new Proxy(target, {
        get(tt, prop, r) {
          const v = Reflect.get(tt, prop, r);
          if (typeof v !== 'function') return v;
          if (!MUT.has(prop as string)) return v.bind(tt);
          return (...a: unknown[]) => { if (++n > k) throw new Error('crash'); return v.apply(tt, a); };
        },
      });
      return { store: p as unknown as FolderStore, calls: () => n };
    };
    const world = async () => {
      const s = new MockFolderStore();
      s.setClock(new MonotonicClock('2026-02-01T00:00:00.000Z').next);
      await s.open(null);
      await s.createElement('location', { id: id(10), name: 'Riv' } as Partial<Element>);
      await s.createElement('character', { id: id(11), name: 'Elrond', location: id(10), story: `see ow://location/${id(10)}` } as Partial<Element>);
      await s.createElement('pin', { id: id(12), name: '', map_id: id(1), element_id: id(10), element_type: 'location', x: 1, y: 1 } as Partial<Element>);
      await s.createElement('narrative', { id: id(20), name: 'N', characters: [id(11)] } as Partial<Element>);
      await s.addMedia(id(10), new File(['x'], 'a.png'));
      await s.updateSyncState(() => ({ foreign: { api_world_id: 'a', ids: [{ id: id(10), type: 'location', first_seen: 'x' }] } }));
      return s;
    };
    const IDS = [id(11), id(10), id(12)];
    const snap = async (s: MockFolderStore) => {
      const els = (await s.listElements()).map(e => { const { local_updated_at: _l, created_at: _c, ...r } = e; return r; }).sort((a, b) => a.id.localeCompare(b.id));
      const media: Record<string, number> = {};
      for (const i of [...IDS, id(900), id(901), id(902)]) { const m = await s.listMedia(i); if (m.length) media[i] = m.length; }
      const st = await s.readSyncState();
      return { els, media, foreign: st.foreign, rekeyed: st.rekeyed, j: await s.hasRekeyJournal() };
    };

    const clean = await world();
    const c = crashAfter(clean, Infinity);
    await startRekey(c.store, { worldId: 'w', ids: IDS, mintId: minter() });
    const expected = await snap(clean);
    const total = c.calls();
    let pairs = 0;
    for (let k = 1; k < total; k++) {
      for (let k2 = 0; k2 < total; k2++) {
        const s = await world();
        await startRekey(crashAfter(s, k).store, { worldId: 'w', ids: IDS, mintId: minter() }).catch(() => {});
        if (!(await s.hasRekeyJournal())) continue;
        await recoverRekey(crashAfter(s, k2).store).catch(() => {});
        if (await s.hasRekeyJournal()) await recoverRekey(s);
        expect(await snap(s), `k=${k} k2=${k2}`).toEqual(expected);
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(100);
  });
});
