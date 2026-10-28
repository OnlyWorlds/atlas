/**
 * A world that opens from memory and lands behind (`store/land-behind.ts`,
 * #865): disk is always the batch plus a prefix of the ops made after it, the
 * handles turn to disk once nothing is queued, a handle or a writable taken
 * before the turn works after it, and a stop or a refused write settles the
 * landing without turning it.
 */
import { describe, expect, it } from 'vitest';
import { memoryDirectory } from '../../src/store/memory-dir';
import { forgetLanding, hasLandingMarker, liveLanding, onLandingFailed, startLanding } from '../../src/store/land-behind';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { DownloadCancelledError } from '../../src/sync/initial-download';
import { isTransientPath } from '../../src/store/world-tree';

type Entries = { entries(): AsyncIterable<[string, FileSystemHandle]> };
async function tree(dir: FileSystemDirectoryHandle): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (d: FileSystemDirectoryHandle, p: string): Promise<void> => {
    for await (const [n, h] of (d as unknown as Entries).entries()) {
      const path = p ? `${p}/${n}` : n;
      if (h.kind === 'directory') { out.set(`${path}/`, ''); await walk(h as FileSystemDirectoryHandle, path); }
      else if (!isTransientPath(path)) out.set(path, await (await (h as FileSystemFileHandle).getFile()).text()); // the markers and the lock are no part of the world
    }
  };
  await walk(dir, '');
  return out;
}
const same = (a: Map<string, string>, b: Map<string, string>) =>
  [...new Set([...a.keys(), ...b.keys()])].filter(k => a.get(k) !== b.get(k));

async function put(dir: FileSystemDirectoryHandle, path: string, text: string): Promise<void> {
  const segs = path.split('/');
  let d = dir;
  for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s, { create: true });
  const w = await (await d.getFileHandle(segs[segs.length - 1], { create: true })).createWritable();
  await w.write(text);
  await w.close();
}

/**
 * A disk whose writes wait for `release()` and which records its whole tree
 * after every write and removal it finishes.
 */
function slowDisk(opts: { failOn?: string } = {}, real = memoryDirectory('disk')) {
  const snapshots: Array<Map<string, string>> = [];
  let waiters: Array<() => void> = [];
  let open = false;
  const gate = () => (open ? Promise.resolve() : new Promise<void>(r => waiters.push(r)));
  const wrapDir = (d: FileSystemDirectoryHandle): FileSystemDirectoryHandle => new Proxy(d, {
    get(t, k) {
      const v = Reflect.get(t, k, t);
      if (k === 'getDirectoryHandle') return async (n: string, o?: object) => wrapDir(await t.getDirectoryHandle(n, o));
      if (k === 'getFileHandle') return async (n: string, o?: object) => wrapFile(await t.getFileHandle(n, o), n);
      if (k === 'removeEntry') return async (n: string, o?: object) => { await gate(); await t.removeEntry(n, o); snapshots.push(await tree(real)); };
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const wrapFile = (f: FileSystemFileHandle, name: string): FileSystemFileHandle => new Proxy(f, {
    get(t, k) {
      const v = Reflect.get(t, k, t);
      if (k === 'createWritable') {
        return async () => {
          const w = await t.createWritable();
          return {
            write: (x: unknown) => w.write(x as never),
            abort: () => w.abort(),
            close: async () => {
              if (name !== 'landing') await gate(); // the landing's marker goes down before the batch
              if (opts.failOn === name) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
              await w.close();
              snapshots.push(await tree(real));
            },
          };
        };
      }
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return {
    real,
    disk: wrapDir(real),
    snapshots,
    release() { open = true; const w = waiters; waiters = []; w.forEach(r => r()); },
    hold() { open = false; },
  };
}

async function world(): Promise<FileSystemDirectoryHandle> {
  const mem = memoryDirectory('mem');
  await put(mem, 'world.json', '{"id":"w","name":"W"}');
  await put(mem, 'characters/alice-0001.json', '{"id":"1","name":"Alice"}');
  await put(mem, 'characters/bob-0002.json', '{"id":"2","name":"Bob"}');
  await put(mem, 'locations/keep-0003.json', '{"id":"3","name":"Keep"}');
  await (await mem.getDirectoryHandle('events', { create: true })); // an empty folder is part of the world too
  await put(mem, '.atlas/sync.json', '{}');
  return mem;
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('startLanding', () => {
  it('lands the whole tree, world.json last, then turns to disk', async () => {
    const mem = await world();
    const want = await tree(mem);
    const d = slowDisk();
    const l = await startLanding('w-1', mem, d.disk);
    d.release();
    await l.landed;
    expect(same(await tree(d.real), want)).toEqual([]);
    // world.json comes down only once every other file of the batch has (the marker's removal may follow it).
    const first = d.snapshots.findIndex(s => s.has('world.json'));
    expect(same(d.snapshots[first], want)).toEqual([]);
    // After the turn the root reads disk: a file put on disk directly is seen.
    await put(d.real, 'characters/carol-0004.json', '{"id":"4"}');
    const names: string[] = [];
    for await (const [n] of ((await l.root.getDirectoryHandle('characters')) as unknown as Entries).entries()) names.push(n);
    expect(names.sort()).toEqual(['alice-0001.json', 'bob-0002.json', 'carol-0004.json']);
  });

  it('answers its own writes from memory while landing, and disk is always a prefix of them', async () => {
    const mem = await world();
    const d = slowDisk();
    const l = await startLanding('w-2', mem, d.disk);
    const batchState = await tree(mem);
    // Ops made during the batch, through the root, as the store makes them.
    const ops: Array<(m: Map<string, string>) => void> = [];
    const model = new Map(batchState);
    const write = async (path: string, text: string) => {
      await put(l.root, path, text);
      // A new file is made empty first, then written: two states, as on any disk.
      if (!model.has(path)) ops.push(m => m.set(path, ''));
      ops.push(m => {
        const segs = path.split('/');
        for (let i = 1; i < segs.length; i++) m.set(`${segs.slice(0, i).join('/')}/`, '');
        m.set(path, text);
      });
      model.set(path, text);
    };
    const remove = async (dir: string, name: string, recursive = false) => {
      const h = dir ? await l.root.getDirectoryHandle(dir) : l.root;
      await h.removeEntry(name, { recursive });
      const full = dir ? `${dir}/${name}` : name;
      const gone = (m: Map<string, string>) => { for (const k of [...m.keys()]) if (k === full || k === `${full}/` || k.startsWith(`${full}/`)) m.delete(k); };
      ops.push(gone);
      gone(model);
    };
    await write('characters/alice-0001.json', '{"id":"1","name":"Alice the Second"}');
    expect(await (await (await (await l.root.getDirectoryHandle('characters')).getFileHandle('alice-0001.json')).getFile()).text())
      .toBe('{"id":"1","name":"Alice the Second"}'); // read your writes
    await write('species/elf-0005.json', '{"id":"5"}');
    await write('maps/m-0006/pins/p-0007.json', '{"id":"7"}');
    await remove('characters', 'bob-0002.json');
    await remove('maps', 'm-0006', true);
    await write('characters/bob-0002.json', '{"id":"2","name":"Bob again"}');
    const want = await tree(mem);

    d.release();
    await l.landed;
    expect(same(await tree(d.real), want)).toEqual([]);

    // Every snapshot after the batch is the batch plus a prefix of the ops (the
    // directories a write makes on the way are allowed to land before it).
    const stripDirs = (m: Map<string, string>) => new Map([...m].filter(([k]) => !k.endsWith('/')));
    const prefixes: Array<Map<string, string>> = [];
    const m = new Map(batchState);
    prefixes.push(stripDirs(m));
    for (const op of ops) { op(m); prefixes.push(stripDirs(m)); }
    const batchEnd = d.snapshots.findIndex(s => s.has('world.json'));
    let at = 0;
    for (const s of d.snapshots.slice(batchEnd)) {
      const files = stripDirs(s);
      while (at < prefixes.length && same(files, prefixes[at]).length > 0) at++;
      expect(at, `a snapshot matched no prefix: ${[...files.keys()].join(', ')}`).toBeLessThan(prefixes.length);
    }
  });

  it('a handle taken while landing reads disk after the turn; a writable opened before it lands after it', async () => {
    const mem = await world();
    const d = slowDisk();
    const l = await startLanding('w-3', mem, d.disk);
    const chars = await l.root.getDirectoryHandle('characters');
    const alice = await chars.getFileHandle('alice-0001.json');
    const w = await alice.createWritable();
    await w.write('{"id":"1","name":"Late Alice"}');
    d.release();
    await l.landed;
    await w.close(); // after the turn: straight to disk
    expect(await (await (await (await d.real.getDirectoryHandle('characters')).getFileHandle('alice-0001.json')).getFile()).text())
      .toBe('{"id":"1","name":"Late Alice"}');
    await put(d.real, 'characters/bob-0002.json', 'changed on disk');
    expect(await (await (await chars.getFileHandle('bob-0002.json')).getFile()).text()).toBe('changed on disk');
    expect(await l.root.resolve(alice)).toEqual(['characters', 'alice-0001.json']);
    expect(await alice.isSameEntry(await chars.getFileHandle('alice-0001.json'))).toBe(true);
  });

  it('does not turn while an op is between memory and the queue', async () => {
    // Memory's own write is held open while the batch lands around it.
    const m = slowDisk({}, await world());
    const d = slowDisk();
    d.release();
    const l = await startLanding('w-4', m.disk, d.disk);
    const pending = put(l.root, 'characters/zed-0009.json', '{"id":"9"}');
    let settled = false;
    void l.landed.then(() => { settled = true; });
    while (!(await tree(d.real)).has('world.json')) await flush(); // the batch is down
    for (let i = 0; i < 20; i++) await flush();
    expect(settled).toBe(false); // an op between memory and the queue holds the turn
    m.release();
    await pending;
    await l.landed;
    expect(await (await (await (await d.real.getDirectoryHandle('characters')).getFileHandle('zed-0009.json')).getFile()).text()).toBe('{"id":"9"}');
  });

  it('a stop ends it without world.json and without turning', async () => {
    const mem = await world();
    const d = slowDisk();
    const l = await startLanding('w-5', mem, d.disk);
    l.stop();
    d.release();
    await expect(l.landed).rejects.toBeInstanceOf(DownloadCancelledError);
    expect((await tree(d.real)).has('world.json')).toBe(false);
    // Still answering from memory: the world the person sees is whole.
    expect(await (await (await l.root.getFileHandle('world.json')).getFile()).text()).toBe('{"id":"w","name":"W"}');
  });

  it('a refused write rejects the landing with its error', async () => {
    const mem = await world();
    const d = slowDisk({ failOn: 'bob-0002.json' });
    const l = await startLanding('w-6', mem, d.disk);
    d.release();
    await expect(l.landed).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect((await tree(d.real)).has('world.json')).toBe(false);
  });

  it('the store opens on the root, writes while landing, and the landed disk opens to the same world', async () => {
    const mem = memoryDirectory('mem');
    const seed = new FsFolderStore();
    await seed.open(mem);
    await seed.writeWorldMeta({ id: 'w', name: 'W' } as never);
    await seed.createElement('character' as never, { name: 'Alice' } as never);
    await seed.close();

    const d = slowDisk();
    const l = await startLanding('w-7', mem, d.disk);
    const s = new FsFolderStore();
    await s.open(l.root);
    const made = await s.createElement('location' as never, { name: 'Keep' } as never);
    expect((await s.listElements()).map(e => e.name).sort()).toEqual(['Alice', 'Keep']);
    d.release();
    await l.landed;
    await s.updateElement(made.id, { description: 'after the turn' } as never);
    await s.close();

    const back = new FsFolderStore();
    await back.open(d.real);
    const els = await back.listElements();
    expect(els.map(e => e.name).sort()).toEqual(['Alice', 'Keep']);
    expect(els.find(e => e.name === 'Keep')?.description).toBe('after the turn');
    await back.close();
  });
});

// The contract gate's probes (2026-10-28), kept as guards.
/** A disk whose `nth` write of `blockName` waits for `release()`. */
function gatedDisk(blockName: string, nth = 1) {
  let seen = 0;
  const real = memoryDirectory('disk');
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  let reached!: () => void; const atGate = new Promise<void>(r => { reached = r; });
  const wrapDir = (d: FileSystemDirectoryHandle): FileSystemDirectoryHandle => new Proxy(d, { get(t, k) {
    const v = Reflect.get(t, k, t);
    if (k === 'getDirectoryHandle') return async (n: string, o?: object) => wrapDir(await t.getDirectoryHandle(n, o));
    if (k === 'getFileHandle') return async (n: string, o?: object) => {
      const fh = await t.getFileHandle(n, o);
      if (n !== blockName) return fh;
      return new Proxy(fh, { get(ft, fk) {
        const fv = Reflect.get(ft, fk, ft);
        if (fk === 'createWritable') return async (wo?: object) => {
          const w = await ft.createWritable(wo as never);
          return { write: w.write.bind(w), close: async () => { if (++seen === nth) { reached(); await gate; } await w.close(); }, abort: w.abort.bind(w) };
        };
        return typeof fv === 'function' ? fv.bind(ft) : fv;
      } });
    };
    return typeof v === 'function' ? v.bind(t) : v;
  } });
  return { disk: wrapDir(real), real, release: () => release(), atGate };
}

describe('the contract gate\'s probes', () => {
  it('G2: a stop while the last queued op is in flight does not turn the landing', async () => {
    // The gate's own probe waited for the batch's count, by which time the
    // landing had turned and its write went straight to disk: here the write
    // is queued during the batch, held as the last op, and the stop lands then.
    const mem = memoryDirectory('mem');
    await put(mem, 'world.json', '{"id":"w"}');
    await put(mem, 'late.json', 'old');
    const { disk, release, atGate } = gatedDisk('late.json', 2); // the batch's write passes, the edit's waits
    const landing = await startLanding('stop-probe', mem, disk);
    void put(landing.root, 'late.json', 'x'); // queued: the batch is still landing
    await atGate;
    expect(landing.progress.done).toBe(landing.progress.total);
    landing.stop();
    release();
    expect(await landing.landed.then(() => 'turned', () => 'stopped')).toBe('stopped');
  });

  it('G4: a file read while landing is a Blob, with its type', async () => {
    const mem = memoryDirectory('mem');
    await put(mem, 'world.json', '{"id":"w"}');
    await put(mem, 'media/e1/default/map.png', 'PNG');
    const { disk } = gatedDisk('world.json'); // the batch never ends: the memory phase
    const landing = await startLanding('blob-probe', mem, disk);
    const d = await (await landing.root.getDirectoryHandle('media')).getDirectoryHandle('e1');
    const f = await (await (await d.getDirectoryHandle('default')).getFileHandle('map.png')).getFile();
    expect(f instanceof Blob).toBe(true);
    expect(f.type).toBe('image/png');
    expect(await f.text()).toBe('PNG');
  });

  it('G10: opening the store alone is no unsaved change; an element is', async () => {
    const mem = memoryDirectory('mem');
    await put(mem, 'world.json', '{"id":"w","name":"W"}');
    const { disk } = gatedDisk('world.json');
    const landing = await startLanding('edits-probe', mem, disk);
    const store = new FsFolderStore({ disableHeartbeat: true, tabId: 't1' } as never);
    await store.open(landing.root);
    expect(landing.pendingEdits).toBe(0);
    await store.createElement('character' as never, { name: 'Ada' } as never);
    expect(landing.pendingEdits).toBeGreaterThan(0);
  });

  it('the marker is on disk before the batch and gone after the turn', async () => {
    const mem = await world();
    const d = slowDisk();
    const l = await startLanding('w-marker', mem, d.disk);
    expect(await hasLandingMarker(d.real)).toBe(true);
    expect((await tree(d.real)).has('world.json')).toBe(false);
    d.release();
    await l.landed;
    expect(await hasLandingMarker(d.real)).toBe(false);
    expect(liveLanding('w-marker')).toBeUndefined();
  });

  it('a failed landing stays known as failed until its cleanup forgets it, and is heard once', async () => {
    const heard: string[] = [];
    const off = onLandingFailed(l => heard.push(l.dir));
    const mem = await world();
    const d = slowDisk({ failOn: 'alice-0001.json' });
    const l = await startLanding('w-failed', mem, d.disk);
    d.release();
    await l.landed.catch(() => {});
    expect(liveLanding('w-failed')?.state).toBe('failed');
    expect(heard).toEqual(['w-failed']);
    forgetLanding('w-failed');
    expect(liveLanding('w-failed')).toBeUndefined();
    off();
  });
});
