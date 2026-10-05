/**
 * Minimal in-memory FileSystemDirectoryHandle for running the REAL FsFolderStore
 * in vitest (born as an S363 gate lens A probe harness; now the real-store
 * re-key tests' fixture). Writable streams commit on close (swap-file
 * semantics, like Chromium) and start EMPTY unless `keepExistingData` is set,
 * as the File System Access spec says. NotFoundError / TypeMismatchError /
 * InvalidModificationError named like DOMException.
 *
 * Test helpers: `put(path, data)` writes a file (creating folders), `get(path)`
 * reads one (null when absent), `list()` returns every file path, sorted.
 */
function err(name: string, msg: string): Error { const e = new Error(msg); e.name = name; return e; }

/**
 * `lastModified` (S364, the live folder): a monotonic counter, bumped on every
 * commit and every `put`, as Chromium bumps it on every `close()` even for
 * identical bytes. Monotonic rather than a clock so two writes in the same
 * millisecond still differ, which is what the real thing measured (0 of 200).
 */
let fakeClock = 1_700_000_000_000;
const tick = (): number => ++fakeClock;

/**
 * Optional latency (S366): the real file system resolves each step after a
 * variable delay, so two overlapping writes of one file interleave; this fake
 * resolves in microtask order and they never do. A test that is about a race
 * sets a jitter for its duration and clears it (`setFakeFsJitter(null)`).
 */
let jitter: (() => Promise<void>) | null = null;
export function setFakeFsJitter(fn: (() => Promise<void>) | null): void { jitter = fn; }
const settle = async (): Promise<void> => { if (jitter) await jitter(); };

/** Content reads across every fake file (`text()` calls): a cost probe for passes that should only stat. */
let contentReads = 0;
export const fakeContentReads = (): number => contentReads;

export class FakeBlob {
  constructor(public readonly data: string, public readonly type = '', public readonly lastModified = 0) {}
  get size() { return this.data.length; }
  async text() { contentReads++; return this.data; }
  async arrayBuffer() { contentReads++; return new TextEncoder().encode(this.data).buffer; }
}

/**
 * Chromium's wording when the swap-in at `close()` fails because another
 * program holds the file (S368, the Discord report; `native_file_util.cc` maps
 * every failed move to FILE_ERROR_FAILED, `file_error.cc` words it so).
 */
export const HELD_FILE_MESSAGE =
  'An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.';

export class FakeFileHandle {
  readonly kind = 'file';
  lastModified = tick();
  /** Set by `removeEntry`: a removed file's handle throws on read, as Chromium's does (S364 gate). */
  removed = false;
  /** Closes still to refuse while another program "holds" the file (`FakeDirHandle.hold`). */
  heldCloses = 0;
  constructor(public name: string, public data: string = '') {}
  async getFile() {
    await settle();
    if (this.removed) throw err('NotFoundError', `file ${this.name} was removed`);
    return new FakeBlob(this.data, '', this.lastModified);
  }
  async createWritable(opts: { keepExistingData?: boolean } = {}) {
    let buf = opts.keepExistingData ? this.data : '';
    return {
      truncate: async (n: number) => { await settle(); buf = buf.slice(0, n); },
      write: async (v: unknown) => {
        await settle();
        if (typeof v === 'string') buf += v;
        else if (v instanceof FakeBlob) buf += v.data;
        // Bytes from either realm (jsdom's and Node's Uint8Array differ).
        else if (ArrayBuffer.isView(v)) buf += new TextDecoder().decode(v as Uint8Array);
        else if (v && typeof (v as { text?: unknown }).text === 'function') buf += await (v as Blob).text();
        else buf += String(v);
      },
      close: async () => {
        await settle();
        if (this.heldCloses > 0) { this.heldCloses--; throw err('InvalidStateError', HELD_FILE_MESSAGE); }
        this.data = buf; this.lastModified = tick();
      },
      abort: async () => { buf = ''; },
    };
  }
}

export class FakeDirHandle {
  readonly kind = 'directory';
  children = new Map<string, FakeDirHandle | FakeFileHandle>();
  constructor(public name: string) {}
  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}) {
    const c = this.children.get(name);
    if (c) { if (c.kind !== 'directory') throw err('TypeMismatchError', 'not a dir'); return c as FakeDirHandle; }
    if (!opts.create) throw err('NotFoundError', `dir ${name} not found`);
    const d = new FakeDirHandle(name); this.children.set(name, d); return d;
  }
  async getFileHandle(name: string, opts: { create?: boolean } = {}) {
    const c = this.children.get(name);
    if (c) { if (c.kind !== 'file') throw err('TypeMismatchError', 'not a file'); return c as FakeFileHandle; }
    if (!opts.create) throw err('NotFoundError', `file ${name} not found`);
    const f = new FakeFileHandle(name); this.children.set(name, f); return f;
  }
  async removeEntry(name: string, opts: { recursive?: boolean } = {}) {
    const c = this.children.get(name);
    if (!c) throw err('NotFoundError', `entry ${name} not found`);
    if (c.kind === 'directory' && (c as FakeDirHandle).children.size > 0 && !opts.recursive) throw err('InvalidModificationError', 'not empty');
    this.children.delete(name);
    const detach = (h: FakeDirHandle | FakeFileHandle): void => {
      if (h.kind === 'file') (h as FakeFileHandle).removed = true;
      else for (const ch of (h as FakeDirHandle).children.values()) detach(ch);
    };
    detach(c);
  }
  /** The path from this directory to a descendant, or null (as OPFS `resolve()`). */
  async resolve(target: FakeDirHandle | FakeFileHandle): Promise<string[] | null> {
    for (const [name, child] of this.children) {
      if (child === target) return [name];
      if (child.kind === 'directory') {
        const rest = await (child as FakeDirHandle).resolve(target);
        if (rest) return [name, ...rest];
      }
    }
    return null;
  }
  async *values() { for (const v of [...this.children.values()]) yield v; }
  async *entries() { for (const [k, v] of [...this.children.entries()]) yield [k, v] as const; }
  async *keys() { for (const k of [...this.children.keys()]) yield k; }

  // ---- test helpers ----
  put(path: string, data: string): void {
    const segs = path.split('/');
    let d: FakeDirHandle = this;
    for (const s of segs.slice(0, -1)) {
      let c = d.children.get(s) as FakeDirHandle | undefined;
      if (!c) { c = new FakeDirHandle(s); d.children.set(s, c); }
      d = c;
    }
    d.children.set(segs[segs.length - 1], new FakeFileHandle(segs[segs.length - 1], data));
  }
  /** Bump a file's `lastModified` without changing its bytes (a `touch`). */
  touch(path: string): void {
    this.fileAt(path).lastModified = tick();
  }
  /**
   * Another program holds this file (S368): its next `closes` writable closes
   * fail as Chromium's do on Windows, leaving the bytes untouched. `Infinity`
   * holds until `release(path)`.
   */
  hold(path: string, closes = Infinity): void {
    this.fileAt(path).heldCloses = closes;
  }
  release(path: string): void {
    this.fileAt(path).heldCloses = 0;
  }
  private fileAt(path: string): FakeFileHandle {
    let cur: FakeDirHandle | FakeFileHandle | undefined = this;
    for (const s of path.split('/')) cur = cur && cur.kind === 'directory' ? (cur as FakeDirHandle).children.get(s) : undefined;
    if (!cur || cur.kind !== 'file') throw err('NotFoundError', `file ${path} not found`);
    return cur as FakeFileHandle;
  }
  get(path: string): string | null {
    let cur: FakeDirHandle | FakeFileHandle | undefined = this;
    for (const s of path.split('/')) {
      if (!cur || cur.kind !== 'directory') return null;
      cur = (cur as FakeDirHandle).children.get(s);
    }
    return cur && cur.kind === 'file' ? (cur as FakeFileHandle).data : null;
  }
  list(prefix = ''): string[] {
    const out: string[] = [];
    for (const [k, v] of this.children) {
      const p = prefix ? `${prefix}/${k}` : k;
      if (v.kind === 'file') out.push(p); else out.push(...(v as FakeDirHandle).list(p));
    }
    return out.sort();
  }
}
