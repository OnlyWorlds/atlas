/**
 * A directory that lives only in memory, shaped like the File System Access
 * handles the FolderStore and the world file use (#126, S387).
 *
 * The demo world is built as a world file: downloaded into a FolderStore,
 * collected, zipped, then opened through the world-file door. Its first
 * folder is scratch that nobody reads from disk, and in Firefox every OPFS
 * write costs about 47 ms however many run at once (measured: 300 writes
 * took 14 s serial and 13.5 s sixteen-wide), so writing the scratch to OPFS
 * was half the demo's open time. Here the same store code writes the same
 * files (names, spelling, world.json) into memory instead.
 *
 * Only the subset of the API the store and `collectWorldFiles` call. A file
 * answers what they read (`text`, `arrayBuffer`, `size`, `lastModified`); a
 * missing entry throws `NotFoundError` and a wrong kind `TypeMismatchError`,
 * the names the browsers use.
 */

type Chunk = string | ArrayBuffer | ArrayBufferView | Blob;
type WriteParams = { type: 'write'; data: Chunk; position?: number } | { type: 'truncate'; size: number } | { type: 'seek'; position: number };

// Errors carry the browser's names; the readers ask the name (`isNotFound`),
// and a plain Error is an Error in every realm, which a DOMException is not
// in every test environment.
const fail = (name: string, message: string): Error => Object.assign(new Error(message), { name });
const notFound = (name: string) => fail('NotFoundError', `${name} was not found`);
const mismatch = (name: string) => fail('TypeMismatchError', `${name} is not of the asked kind`);

/** What `getFile()` answers: the members the store and the world file read. */
export class MemoryFile {
  readonly type = '';
  constructor(readonly name: string, private readonly bytes: Uint8Array, readonly lastModified: number) {}
  get size(): number { return this.bytes.length; }
  async text(): Promise<string> { return new TextDecoder().decode(this.bytes); }
  async arrayBuffer(): Promise<ArrayBuffer> { return this.bytes.slice().buffer as ArrayBuffer; }
}

export class MemoryFileHandle {
  readonly kind = 'file';
  private file: MemoryFile;
  constructor(readonly name: string) { this.file = new MemoryFile(name, new Uint8Array(0), Date.now()); }

  async getFile(): Promise<File> { return this.file as unknown as File; }

  async createWritable(opts: { keepExistingData?: boolean } = {}) {
    let bytes = opts.keepExistingData ? new Uint8Array(await this.file.arrayBuffer()) : new Uint8Array(0);
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
    return {
      write: async (v: Chunk | WriteParams) => {
        if (closed) throw fail('InvalidStateError', 'The stream is closed');
        if (typeof v === 'object' && v !== null && 'type' in v && !(v instanceof Blob)) {
          if (v.type === 'write') await put(v.data, v.position ?? position);
          else if (v.type === 'truncate') { bytes = bytes.slice(0, v.size); position = Math.min(position, v.size); }
          else position = v.position;
          return;
        }
        await put(v as Chunk);
      },
      truncate: async (size: number) => { bytes = bytes.slice(0, size); position = Math.min(position, size); },
      seek: async (p: number) => { position = p; },
      close: async () => {
        if (closed) return;
        closed = true;
        // The whole file swaps in at close, as a writable's does.
        this.file = new MemoryFile(this.name, bytes, Date.now());
      },
      abort: async () => { closed = true; },
    };
  }

  async queryPermission(): Promise<PermissionState> { return 'granted'; }
  async requestPermission(): Promise<PermissionState> { return 'granted'; }
  async isSameEntry(other: unknown): Promise<boolean> { return other === this; }
}

export class MemoryDirHandle {
  readonly kind = 'directory';
  private readonly children = new Map<string, MemoryDirHandle | MemoryFileHandle>();
  constructor(readonly name = '') {}

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<MemoryDirHandle> {
    const hit = this.children.get(name);
    if (hit) { if (hit instanceof MemoryDirHandle) return hit; throw mismatch(name); }
    if (!opts.create) throw notFound(name);
    const made = new MemoryDirHandle(name);
    this.children.set(name, made);
    return made;
  }

  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<MemoryFileHandle> {
    const hit = this.children.get(name);
    if (hit) { if (hit instanceof MemoryFileHandle) return hit; throw mismatch(name); }
    if (!opts.create) throw notFound(name);
    const made = new MemoryFileHandle(name);
    this.children.set(name, made);
    return made;
  }

  async removeEntry(name: string, opts: { recursive?: boolean } = {}): Promise<void> {
    const hit = this.children.get(name);
    if (!hit) throw notFound(name);
    if (hit instanceof MemoryDirHandle && hit.children.size > 0 && !opts.recursive) {
      throw fail('InvalidModificationError', `${name} is not empty`);
    }
    this.children.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, MemoryDirHandle | MemoryFileHandle]> {
    for (const e of [...this.children.entries()]) yield e;
  }
  async *keys(): AsyncIterableIterator<string> { for (const k of [...this.children.keys()]) yield k; }
  async *values(): AsyncIterableIterator<MemoryDirHandle | MemoryFileHandle> { for (const v of [...this.children.values()]) yield v; }
  [Symbol.asyncIterator]() { return this.entries(); }

  async resolve(target: MemoryDirHandle | MemoryFileHandle): Promise<string[] | null> {
    for (const [name, child] of this.children) {
      if (child === target) return [name];
      if (child instanceof MemoryDirHandle) {
        const below = await child.resolve(target);
        if (below) return [name, ...below];
      }
    }
    return null;
  }

  async queryPermission(): Promise<PermissionState> { return 'granted'; }
  async requestPermission(): Promise<PermissionState> { return 'granted'; }
  async isSameEntry(other: unknown): Promise<boolean> { return other === this; }
}

/** A fresh in-memory directory, typed as the browser's handle for the code that takes one. */
export function memoryDirectory(name = ''): FileSystemDirectoryHandle {
  return new MemoryDirHandle(name) as unknown as FileSystemDirectoryHandle;
}
