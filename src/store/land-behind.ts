/**
 * A browser world that opens from memory and lands behind (#865).
 *
 * Firefox pays tens of milliseconds for every file written to browser
 * storage, one at a time whatever the API, and almost nothing to read one
 * back: a 310-element world took 20 to 40 s to land and opens again in about
 * a second. So a first download (or a world file) that is already whole in
 * memory opens on that memory at once, and its files land behind it.
 *
 * `startLanding` gives a directory shaped like the File System Access subset
 * the store uses (`memory-dir.ts`'s subset). The store opens on it and never
 * knows. Two phases:
 *
 * - **memory**: reads answer from the memory copy; every write (a writable's
 *   close, a removal, a directory made) applies there, then queues for disk.
 *   The first batch is the whole tree (folders first, eight files at once,
 *   `world.json` last, through `writeAll`); what is queued during it runs
 *   after it, one op at a time, in the order it was made. Disk is always the
 *   batch's landed files plus a prefix of those ops.
 * - **disk**: the moment nothing is queued and nothing is mid-op, every
 *   handle resolves its disk handle by path; the memory copy is let go.
 *
 * Handles carry a path, never a real handle, so one taken in the first phase
 * works in the second. A writable buffers here and decides at `close()`.
 */
import { DownloadCancelledError } from '../sync/initial-download';
import { isTransientPath } from './world-tree';
import { MemoryFile } from './memory-dir';

/**
 * `.atlas/landing`: on disk from before the batch until after the turn. A
 * world found with it and a free landing lock did not finish landing; its
 * `world.json` (written last) says whether the batch did (contract L6').
 */
export const LANDING_MARKER = 'landing';
const ATLAS_DIR = '.atlas';
const REMOVE_RETRY_MS = [100, 250, 500, 1000];

type Locks = { request: (name: string, opts: unknown, cb: (lock: unknown) => Promise<unknown> | unknown) => Promise<unknown> };
function locks(): Locks | null {
  const l = (globalThis.navigator as unknown as { locks?: Locks } | undefined)?.locks;
  return l && typeof l.request === 'function' ? l : null;
}
/** The landing's own Web Lock, never the make's (`atlas-world:`): a landing is no make and no move. */
export const landingLockName = (dir: string) => `atlas-landing:${dir}`;

/** Is a landing of this directory live in some tab? (No Web Locks: none is.) */
export async function landingLockHeld(dir: string): Promise<boolean> {
  const l = locks();
  if (!l) return false;
  return l.request(landingLockName(dir), { ifAvailable: true }, lock => lock === null) as Promise<boolean>;
}

async function holdLandingLock(dir: string): Promise<() => void> {
  const l = locks();
  if (!l) return () => {};
  let release: () => void = () => {};
  await new Promise<void>(acquired => {
    void l.request(landingLockName(dir), {}, () => {
      acquired();
      return new Promise<void>(done => { release = done; });
    });
  });
  return release;
}

/** Does this world's directory hold the landing marker? */
export async function hasLandingMarker(dir: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    await (await dir.getDirectoryHandle(ATLAS_DIR)).getFileHandle(LANDING_MARKER);
    return true;
  } catch {
    return false;
  }
}

/** Remove the landing marker, retrying a busy refusal; a marker already gone counts as removed. */
export async function removeLandingMarker(dir: FileSystemDirectoryHandle): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await (await dir.getDirectoryHandle(ATLAS_DIR)).removeEntry(LANDING_MARKER);
      return;
    } catch (err) {
      if (isNotFound(err)) return;
      if (attempt >= REMOVE_RETRY_MS.length) throw err;
      await new Promise(r => setTimeout(r, REMOVE_RETRY_MS[attempt]));
    }
  }
}

/** The type a browser gives a file by its extension, for the few a world carries. */
function typeOf(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', json: 'application/json', md: 'text/markdown', txt: 'text/plain' } as Record<string, string>)[ext] ?? '';
}

/** A real File (a Blob, so an object URL takes it) whose reads answer its own bytes in every engine. */
class LandingFile extends File {
  constructor(private readonly view: Uint8Array, name: string, lastModified: number) {
    super([view as BlobPart], name, { lastModified, type: typeOf(name) });
  }
  override async text(): Promise<string> { return new TextDecoder().decode(this.view); }
  override async arrayBuffer(): Promise<ArrayBuffer> { return this.view.slice().buffer as ArrayBuffer; }
}

type Phase = 'memory' | 'disk';
type Op =
  | { kind: 'write'; path: string[]; bytes: Uint8Array; counts: boolean }
  | { kind: 'mkdir'; path: string[] }
  | { kind: 'remove'; path: string[]; recursive: boolean };

type Entries = { entries(): AsyncIterable<[string, FileSystemHandle]> };
type Chunk = string | ArrayBuffer | ArrayBufferView | Blob;
type WriteParams = { type: 'write'; data: Chunk; position?: number } | { type: 'truncate'; size: number } | { type: 'seek'; position: number };

const fail = (name: string, message: string): Error => Object.assign(new Error(message), { name });
const isNotFound = (err: unknown) => (err as { name?: unknown } | null)?.name === 'NotFoundError';

export interface LandingProgress { done: number; total: number }

/** A landing in progress, from `startLanding`. */
export interface Landing {
  /** The world's directory as the store sees it. */
  readonly root: FileSystemDirectoryHandle;
  /** Settles when every file is on disk and the handles have turned to it; rejects on a failed write or a stop. */
  readonly landed: Promise<void>;
  /** Stop starting files (a delete is coming): `landed` rejects with `DownloadCancelledError`. */
  stop(): void;
  readonly progress: LandingProgress;
  onProgress(fn: (p: LandingProgress) => void): () => void;
  /** The world's own files written since it opened that have not reached disk (the batch and the store's own lock excluded). */
  readonly pendingEdits: number;
  /** `failed` stays until the cleanup calls `forgetLanding` (contract L9'): the world is refused meanwhile. */
  readonly state: 'landing' | 'landed' | 'failed';
  readonly dir: string;
  /** Why it failed (a stop's `DownloadCancelledError` included); null until then. */
  readonly error: unknown;
}

class LandingState implements Landing {
  phase: Phase = 'memory';
  state: 'landing' | 'landed' | 'failed' = 'landing';
  mem: FileSystemDirectoryHandle | null;
  readonly disk: FileSystemDirectoryHandle;
  readonly root: FileSystemDirectoryHandle;
  readonly landed: Promise<void>;
  progress: LandingProgress = { done: 0, total: 0 };
  private queue: Op[] = [];
  private inflight = 0;
  private batchDone = false;
  private draining = false;
  private stopped = false;
  error: unknown = null;
  private settle!: { ok: () => void; fail: (e: unknown) => void };
  private listeners = new Set<(p: LandingProgress) => void>();
  private diskDirs = new Map<string, Promise<FileSystemDirectoryHandle>>();
  edits = 0;

  constructor(readonly dir: string, mem: FileSystemDirectoryHandle, disk: FileSystemDirectoryHandle) {
    this.mem = mem;
    this.disk = disk;
    this.landed = new Promise<void>((ok, no) => { this.settle = { ok, fail: no }; });
    this.landed.catch(() => {}); // a caller that never awaits it leaves no unhandled rejection
    this.root = new LandingDirHandle(this, [], disk.name) as unknown as FileSystemDirectoryHandle;
  }

  get pendingEdits(): number { return this.phase === 'disk' ? 0 : this.edits; }

  stop(): void { this.stopped = true; }

  onProgress(fn: (p: LandingProgress) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setProgress(done: number, total: number): void {
    this.progress = { done, total };
    // A listener's own fault never fails the landing (code gate C4): its last call comes after world.json landed.
    for (const fn of this.listeners) { try { fn(this.progress); } catch (err) { console.warn('[landing] a progress listener threw', err); } } // raw-error-ok: a console record
  }

  /** The memory or disk directory at `path` in the phase now. */
  async dirAt(path: string[], phase = this.phase): Promise<FileSystemDirectoryHandle> {
    if (phase === 'memory') {
      let d = this.mem!;
      for (const seg of path) d = await d.getDirectoryHandle(seg);
      return d;
    }
    return this.diskDir(path);
  }

  diskDir(path: string[]): Promise<FileSystemDirectoryHandle> {
    if (path.length === 0) return Promise.resolve(this.disk);
    const key = path.join('/');
    let p = this.diskDirs.get(key);
    if (!p) {
      p = this.diskDir(path.slice(0, -1)).then(parent => parent.getDirectoryHandle(path[path.length - 1]));
      p.catch(() => this.diskDirs.delete(key)); // a miss is not cached
      this.diskDirs.set(key, p);
    }
    return p;
  }

  /** A removal on disk forgets every cached directory at or below it. */
  forget(path: string[]): void {
    const key = path.join('/');
    for (const k of [...this.diskDirs.keys()]) if (k === key || k.startsWith(`${key}/`)) this.diskDirs.delete(k);
  }

  /**
   * Run `fn` against the phase now. In the memory phase the op it returns
   * (if any) is queued before the phase can turn, so nothing written to
   * memory is let go before disk has it.
   */
  async apply<T>(fn: (phase: Phase) => Promise<{ value: T; op?: Op }>): Promise<T> {
    const phase = this.phase;
    if (phase === 'disk') return (await fn('disk')).value;
    this.inflight++;
    try {
      const { value, op } = await fn('memory');
      if (op) {
        if (op.kind === 'write' && op.counts) this.edits++;
        this.queue.push(op);
      }
      return value;
    } finally {
      this.inflight--;
      this.pump();
    }
  }

  /** Land the batch, then the queue; turn to disk when both are empty. */
  async run(batch: { dirs: string[][]; files: Array<{ path: string; data: Uint8Array }>; worldJson: Uint8Array }): Promise<void> {
    try {
      for (const d of batch.dirs) await this.mkdirOnDisk(d);
      // Late: the world-file door imports the store's side, never the other way.
      const { writeAll } = await import('../setup/world-file-open');
      await writeAll(this.disk, batch.files, batch.worldJson, (done, total) => this.setProgress(done, total), () => this.stopped);
      this.batchDone = true;
      this.pump();
    } catch (err) {
      this.fail(err);
    }
  }

  private async mkdirOnDisk(path: string[]): Promise<void> {
    let d = this.disk;
    for (const seg of path) d = await d.getDirectoryHandle(seg, { create: true });
  }

  private fail(err: unknown): void {
    if (this.error) return;
    this.error = err;
    this.queue = [];
    this.state = 'failed'; // memory stays: the open world reads on until its cleanup closes it
    this.settle.fail(err);
  }

  pump(): void {
    if (!this.batchDone || this.draining || this.error || this.phase === 'disk') return;
    if (this.queue.length === 0) {
      if (this.inflight > 0) return;
      // A stop never turns (a delete is coming), even with nothing left to land.
      if (this.stopped) { this.fail(new DownloadCancelledError()); return; }
      this.phase = 'disk';
      this.mem = null;
      void removeLandingMarker(this.disk)
        .catch(err => console.warn('[landing] the landing marker stayed; the next boot removes it', err)) // raw-error-ok: a console record
        .then(() => { this.state = 'landed'; this.settle.ok(); });
      return;
    }
    this.draining = true;
    void (async () => {
      try {
        while (this.queue.length > 0 && !this.error) {
          if (this.stopped) throw new DownloadCancelledError();
          await this.runOp(this.queue[0]);
          this.queue.shift();
        }
      } catch (err) {
        this.fail(err);
      } finally {
        this.draining = false;
        this.pump();
      }
    })();
  }

  private async runOp(op: Op): Promise<void> {
    const parent = op.path.slice(0, -1);
    const name = op.path[op.path.length - 1];
    if (op.kind === 'mkdir') return this.mkdirOnDisk(op.path);
    if (op.kind === 'remove') {
      try {
        await (await this.diskDir(parent)).removeEntry(name, { recursive: op.recursive });
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
      this.forget(op.path);
      return;
    }
    await this.mkdirOnDisk(parent);
    const w = await (await (await this.diskDir(parent)).getFileHandle(name, { create: true })).createWritable();
    try {
      await w.write(op.bytes as unknown as BufferSource);
      await w.close();
    } catch (err) {
      await w.abort().catch(() => {});
      throw err;
    }
    if (op.counts) this.edits = Math.max(0, this.edits - 1);
  }
}

class LandingDirHandle {
  readonly kind = 'directory';
  constructor(private readonly l: LandingState, readonly path: string[], readonly name: string) {}

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<LandingDirHandle> {
    const path = [...this.path, name];
    await this.l.apply(async phase => {
      const d = await this.l.dirAt(this.path, phase);
      if (phase === 'disk') return { value: await d.getDirectoryHandle(name, opts) };
      let existed = true;
      try { await d.getDirectoryHandle(name); } catch (err) { if (!isNotFound(err)) throw err; existed = false; }
      await d.getDirectoryHandle(name, opts); // throws as the browser does: not found, wrong kind
      return { value: undefined, op: existed ? undefined : { kind: 'mkdir', path } };
    });
    return new LandingDirHandle(this.l, path, name);
  }

  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<LandingFileHandle> {
    const path = [...this.path, name];
    await this.l.apply(async phase => {
      const d = await this.l.dirAt(this.path, phase);
      if (phase === 'disk') return { value: await d.getFileHandle(name, opts) };
      let existed = true;
      try { await d.getFileHandle(name); } catch (err) { if (!isNotFound(err)) throw err; existed = false; }
      await d.getFileHandle(name, opts);
      // A file made and not yet written is an empty file, on disk too.
      return { value: undefined, op: existed ? undefined : { kind: 'write', path, bytes: new Uint8Array(0), counts: false } };
    });
    return new LandingFileHandle(this.l, path, name);
  }

  async removeEntry(name: string, opts: { recursive?: boolean } = {}): Promise<void> {
    const path = [...this.path, name];
    await this.l.apply(async phase => {
      const d = await this.l.dirAt(this.path, phase);
      await d.removeEntry(name, opts);
      if (phase === 'disk') { this.l.forget(path); return { value: undefined }; }
      return { value: undefined, op: { kind: 'remove', path, recursive: !!opts.recursive } };
    });
  }

  async *entries(): AsyncIterableIterator<[string, LandingDirHandle | LandingFileHandle]> {
    const d = await this.l.dirAt(this.path);
    const out: Array<[string, LandingDirHandle | LandingFileHandle]> = [];
    for await (const [name, h] of (d as unknown as Entries).entries()) {
      out.push([name, h.kind === 'directory'
        ? new LandingDirHandle(this.l, [...this.path, name], name)
        : new LandingFileHandle(this.l, [...this.path, name], name)]);
    }
    for (const e of out) yield e;
  }
  async *keys(): AsyncIterableIterator<string> { for await (const [k] of this.entries()) yield k; }
  async *values(): AsyncIterableIterator<LandingDirHandle | LandingFileHandle> { for await (const [, v] of this.entries()) yield v; }
  [Symbol.asyncIterator]() { return this.entries(); }

  async resolve(target: unknown): Promise<string[] | null> {
    if (!(target instanceof LandingDirHandle || target instanceof LandingFileHandle) || target.landing !== this.l) return null;
    if (target.path.length < this.path.length || this.path.some((s, i) => target.path[i] !== s)) return null;
    return target.path.slice(this.path.length);
  }

  get landing(): LandingState { return this.l; }
  async isSameEntry(other: unknown): Promise<boolean> {
    return other instanceof LandingDirHandle && other.l === this.l && other.path.join('/') === this.path.join('/');
  }
  async queryPermission(): Promise<PermissionState> { return 'granted'; }
  async requestPermission(): Promise<PermissionState> { return 'granted'; }
}

class LandingFileHandle {
  readonly kind = 'file';
  constructor(private readonly l: LandingState, readonly path: string[], readonly name: string) {}

  get landing(): LandingState { return this.l; }

  private async fileIn(phase: Phase): Promise<FileSystemFileHandle> {
    return (await this.l.dirAt(this.path.slice(0, -1), phase)).getFileHandle(this.name);
  }

  async getFile(): Promise<File> {
    const f: File | MemoryFile = await (await this.fileIn(this.l.phase)).getFile() as File | MemoryFile;
    // Memory's file is no Blob; a map's picture makes an object URL of what this answers (gate G4).
    if (f instanceof MemoryFile) return new LandingFile(f.bytesView(), this.name, f.lastModified);
    return f;
  }

  async createWritable(opts: { keepExistingData?: boolean } = {}) {
    const start = await this.getFile(); // a removed file refuses, as the browser's does
    let bytes = opts.keepExistingData ? new Uint8Array(await start.arrayBuffer()) : new Uint8Array(0);
    let position = 0;
    let closed = false;
    const put = async (data: Chunk, at = position) => {
      const add = typeof data === 'string' ? new TextEncoder().encode(data)
        : data instanceof Blob ? new Uint8Array(await data.arrayBuffer())
        : data instanceof ArrayBuffer ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const next = new Uint8Array(Math.max(bytes.length, at + add.length));
      next.set(bytes);
      next.set(add, at);
      bytes = next;
      position = at + add.length;
    };
    const guard = () => { if (closed) throw fail('InvalidStateError', 'The stream is closed'); };
    return {
      write: async (v: Chunk | WriteParams) => {
        guard();
        if (typeof v === 'object' && v !== null && 'type' in v && !(v instanceof Blob)) {
          if (v.type === 'write') await put(v.data, v.position ?? position);
          else if (v.type === 'truncate') { bytes = bytes.slice(0, v.size); position = Math.min(position, v.size); }
          else position = v.position;
          return;
        }
        await put(v as Chunk);
      },
      truncate: async (size: number) => { guard(); bytes = bytes.slice(0, size); position = Math.min(position, size); },
      seek: async (p: number) => { guard(); position = p; },
      close: async () => {
        guard();
        closed = true;
        const final = bytes.slice();
        await this.l.apply(async phase => {
          const fh = await this.fileIn(phase);
          const w = await fh.createWritable();
          try {
            await w.write(final as unknown as BufferSource);
            await w.close();
          } catch (err) {
            await w.abort().catch(() => {});
            throw err;
          }
          return { value: undefined, op: phase === 'memory' ? { kind: 'write', path: this.path, bytes: final, counts: !isTransientPath(this.path.join('/')) } : undefined };
        });
      },
      abort: async () => { closed = true; },
    };
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other instanceof LandingFileHandle && other.l === this.l && other.path.join('/') === this.path.join('/');
  }
  async queryPermission(): Promise<PermissionState> { return 'granted'; }
  async requestPermission(): Promise<PermissionState> { return 'granted'; }
}

/** The whole tree under `dir`: every directory (parents first) and every file's bytes. */
async function readTree(dir: FileSystemDirectoryHandle): Promise<{ dirs: string[][]; files: Array<{ path: string; data: Uint8Array }> }> {
  const dirs: string[][] = [];
  const files: Array<{ path: string; data: Uint8Array }> = [];
  const walk = async (d: FileSystemDirectoryHandle, prefix: string[]): Promise<void> => {
    for await (const [name, h] of (d as unknown as Entries).entries()) {
      const path = [...prefix, name];
      if (h.kind === 'directory') {
        dirs.push(path);
        await walk(h as FileSystemDirectoryHandle, path);
      } else if (!/\.(crswap|tmp)$/i.test(name)) {
        const f: File | MemoryFile = await (h as FileSystemFileHandle).getFile() as File | MemoryFile;
        files.push({ path: path.join('/'), data: f instanceof MemoryFile ? f.bytesView() : new Uint8Array(await f.arrayBuffer()) }); // no extra copy (G14)
      }
    }
  };
  await walk(dir, []);
  return { dirs, files };
}

const live = new Map<string, LandingState>();
/** Each landing's lock release, called when it landed or when its cleanup forgets it (code gate C1). */
const releases = new Map<LandingState, () => void>();
const failedListeners = new Set<(landing: Landing, err: unknown) => void>();

/** The landing this tab holds for a browser world's directory: live, or failed until its cleanup forgets it. */
export function liveLanding(dirName: string): Landing | undefined {
  return live.get(dirName);
}

/** Every landing this tab holds (the test hook waits on them). */
export function allLandings(): Landing[] {
  return [...live.values()];
}

/** The cleanup of a failed landing is done: the directory is gone, the entry settled. */
export function forgetLanding(dirName: string): void {
  const l = live.get(dirName);
  if (!l || l.state === 'landing') return;
  live.delete(dirName);
  // Only now does another tab see a free lock beside the marker: a failed or
  // stopped landing keeps it until its directory is settled (code gate C1).
  releases.get(l)?.();
  releases.delete(l);
}

/** One listener, registered once by the app, hears every landing that fails after its open (contract L9'). */
export function onLandingFailed(fn: (landing: Landing, err: unknown) => void): () => void {
  failedListeners.add(fn);
  return () => failedListeners.delete(fn);
}

/** Is any landing still writing in this tab? (The leave prompt asks this.) */
export function anyLandingLive(): boolean {
  for (const l of live.values()) if (l.state === 'landing') return true;
  return false;
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (!anyLandingLive()) return;
  e.preventDefault();
  e.returnValue = ''; // the browser's own leave prompt; the words are its own
}

/**
 * Open a world that is whole in `mem` and land it in `disk` behind it.
 * `dirName` is the browser world's directory: it keys `liveLanding` and the
 * landing lock. Before this returns, the landing lock is held, the marker is
 * on disk and the tree is read, so the store opened on `root` afterwards
 * changes nothing the batch carries. A stop or a failure before the door's
 * commit is the door's to clean up; after it, `onLandingFailed`'s.
 */
export async function startLanding(dirName: string, mem: FileSystemDirectoryHandle, disk: FileSystemDirectoryHandle): Promise<Landing> {
  const tree = await readTree(mem);
  const worldJson = tree.files.find(f => f.path === 'world.json')?.data;
  if (!worldJson) throw new Error('landing: the world in memory has no world.json');
  const release = await holdLandingLock(dirName);
  try {
    const atlas = await disk.getDirectoryHandle(ATLAS_DIR, { create: true });
    const w = await (await atlas.getFileHandle(LANDING_MARKER, { create: true })).createWritable();
    await w.write(new Date().toISOString());
    await w.close();
  } catch (err) {
    release();
    throw err;
  }
  const state = new LandingState(dirName, mem, disk);
  live.set(dirName, state);
  releases.set(state, release);
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', onBeforeUnload);
  state.landed.then(() => {
    if (live.get(dirName) === state) live.delete(dirName);
    releases.delete(state);
    release();
    if (!anyLandingLive() && typeof window !== 'undefined') window.removeEventListener('beforeunload', onBeforeUnload);
  }, err => {
    // Stays in `live` as failed, its lock held, until its cleanup forgets it.
    if (!anyLandingLive() && typeof window !== 'undefined') window.removeEventListener('beforeunload', onBeforeUnload);
    if (!(err instanceof DownloadCancelledError)) for (const fn of failedListeners) fn(state, err);
  });
  void state.run({ dirs: tree.dirs, files: tree.files, worldJson });
  return state;
}
