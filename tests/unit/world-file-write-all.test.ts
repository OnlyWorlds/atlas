import { describe, it, expect } from 'vitest';
import { writeAll, WRITE_CONCURRENCY } from '../../src/setup/world-file-open';

// S407: a world file's files are written a few at once (Firefox paid ~40 ms
// per file, one after another), folders looked up once, world.json still last,
// a refusal stops the rest, and the count reaches the overlay.

type Log = { order: string[]; inFlight: number; maxInFlight: number; dirLookups: Map<string, number> };

function fakeDir(log: Log, opts: { failOn?: string } = {}, prefix = ''): FileSystemDirectoryHandle {
  const tick = () => new Promise(r => setTimeout(r, 1));
  return {
    async getDirectoryHandle(name: string) {
      const key = prefix + name;
      log.dirLookups.set(key, (log.dirLookups.get(key) ?? 0) + 1);
      await tick();
      return fakeDir(log, opts, key + '/');
    },
    async getFileHandle(name: string) {
      const path = prefix + name;
      return {
        async createWritable() {
          log.inFlight++;
          log.maxInFlight = Math.max(log.maxInFlight, log.inFlight);
          return {
            async write() {
              await tick();
              if (path === opts.failOn) throw new Error('refused');
            },
            async close() { log.order.push(path); log.inFlight--; },
            async abort() { log.inFlight--; },
          };
        },
      };
    },
  } as unknown as FileSystemDirectoryHandle;
}

const files = (n: number) => [
  { path: 'world.json', data: new Uint8Array([1]) },
  ...Array.from({ length: n }, (_, i) => ({ path: `elements/character/c${i}.json`, data: new Uint8Array([2]) })),
];
const newLog = (): Log => ({ order: [], inFlight: 0, maxInFlight: 0, dirLookups: new Map() });

describe('writeAll', () => {
  it('writes several at once, never more than the bound, world.json last', async () => {
    const log = newLog();
    await writeAll(fakeDir(log), files(40) as never, new Uint8Array([9]));
    expect(log.order).toHaveLength(41);
    expect(log.order[40]).toBe('world.json');
    expect(log.maxInFlight).toBeGreaterThan(1);
    expect(log.maxInFlight).toBeLessThanOrEqual(WRITE_CONCURRENCY);
  });

  it('looks each folder up once', async () => {
    const log = newLog();
    await writeAll(fakeDir(log), files(40) as never, new Uint8Array([9]));
    expect(log.dirLookups.get('elements')).toBe(1);
    expect(log.dirLookups.get('elements/character')).toBe(1);
  });

  it('counts every file to the total, world.json included', async () => {
    const seen: Array<[number, number]> = [];
    await writeAll(fakeDir(newLog()), files(12) as never, new Uint8Array([9]), (d, t) => seen.push([d, t]));
    expect(seen.map(s => s[0])).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(seen.every(s => s[1] === 13)).toBe(true);
  });

  it('a refused file stops the rest and never writes world.json', async () => {
    const log = newLog();
    await expect(writeAll(fakeDir(log, { failOn: 'elements/character/c3.json' }), files(60) as never, new Uint8Array([9]))).rejects.toThrow('refused');
    expect(log.order).not.toContain('world.json');
    expect(log.order.length).toBeLessThan(60);
  });
});
