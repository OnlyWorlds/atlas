/**
 * ONE WRITER PER FILE (S366, the park/unpark flake, lane C's mechanism).
 *
 * `writeJsonAtomic` stages every write through one fixed `<name>.tmp`, so two
 * writes of the same file that overlap corrupt each other's staging: the
 * first one's verify reads the second one's bytes, removes the tmp, and the
 * second one then fails on a missing file. `park()` fired a lock write it
 * never waited for and `unpark()` wrote the same lock in the same tick, so a
 * tab switch under load came back "not revived" (21 of 320 under 4 workers).
 * The rule since: every read-modify-write or whole-file write of a shared
 * `.atlas/` file (and the lock) runs on a chain for that file.
 *
 * Two jitter shapes, because one lines the operations up the same way every
 * run and so never meets some races (the S366 gate, lens A, found two rows of
 * the first version green with the whole fix removed). Every row below was
 * revert-checked red against the store at HEAD `b3466ef`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FakeDirHandle, setFakeFsJitter } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const hop = (): Promise<void> => new Promise(r => setImmediate(r));

function freshRoot(): FakeDirHandle {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  return root;
}

async function openWorld(root = freshRoot()): Promise<{ root: FakeDirHandle; store: FsFolderStore }> {
  const store = new FsFolderStore({ tabId: 'tab-a', disableHeartbeat: true });
  await store.open(root as unknown as FileSystemDirectoryHandle);
  return { root, store };
}

async function dropLock(root: FakeDirHandle): Promise<void> {
  const d = await (root as unknown as FileSystemDirectoryHandle).getDirectoryHandle('.atlas');
  await d.removeEntry('lock').catch(() => {});
}

describe('one writer per file: lockstep jitter', () => {
  beforeEach(() => {
    let k = 0;
    setFakeFsJitter(() => (k++ % 2 === 0 ? hop() : Promise.resolve()));
  });
  afterEach(() => { setFakeFsJitter(null); });

  it('park then unpark with no gap revives, 200 times, and leaves a live heartbeat', async () => {
    const { store } = await openWorld();
    let falses = 0;
    let epoch = 0;
    for (let i = 0; i < 200; i++) {
      store.park();
      if (!(await store.unpark())) falses++;
      const lock = await store.__debug_readLock();
      // The parked write landing AFTER the revive would leave a lock any
      // other tab may take at once while this tab is live.
      if (lock && Date.parse(lock.last_heartbeat) === 0) epoch++;
    }
    expect({ falses, epoch }).toEqual({ falses: 0, epoch: 0 });
    await store.close();
  }, 30_000);

  it('overlapping writes of one .atlas file all land, the last one wins', async () => {
    const { root, store } = await openWorld();
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      writes.push(store.writeWorldPrefs({ n: i }));
      writes.push(store.writeStyles({ version: 1, rules: [], n: i } as never));
      writes.push(store.writeCharts([{ id: `c${i}` } as never]));
    }
    const results = await Promise.allSettled(writes);
    expect(results.filter(r => r.status === 'rejected')).toEqual([]);
    expect(JSON.parse(root.get('.atlas/world-prefs.json')!)).toEqual({ n: 19 });
    expect(JSON.parse(root.get('.atlas/charts.json')!).charts[0].id).toBe('c19');
    expect(root.list().filter(p => p.endsWith('.tmp'))).toEqual([]);
    await store.close();
  });
});

describe('one writer per file: seeded random jitter, streamed contenders', () => {
  // 0 to 3 macrotask hops per file step, from a fixed seed, and contenders
  // that keep arriving until the slow operation settles, so a slow op (the
  // reset's element walk, a heartbeat) meets a writer at every phase.
  let seed = 12345;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  beforeEach(() => {
    seed = 12345;
    setFakeFsJitter(async () => { const n = Math.floor(rnd() * 4); for (let i = 0; i < n; i++) await hop(); });
  });
  afterEach(() => { setFakeFsJitter(null); });

  it('a heartbeat racing close never writes the lock back after close removed it', async () => {
    // Before the chain: 112 of 150 rounds left a lock behind, so a closed
    // world read as "open in another tab" for 90 seconds.
    const root = freshRoot();
    let resurrected = 0;
    let rejected = 0;
    for (let i = 0; i < 150; i++) {
      const { store } = await openWorld(root);
      const hb = store.__debug_heartbeat();
      for (let k = 0; k < (i % 5); k++) await hop();
      const c = store.close();
      rejected += (await Promise.allSettled([hb, c])).filter(r => r.status === 'rejected').length;
      if (root.get('.atlas/lock') !== null) { resurrected++; await dropLock(root); }
    }
    expect({ resurrected, rejected }).toEqual({ resurrected: 0, rejected: 0 });
  }, 60_000);

  it('park then close leaves no lock behind', async () => {
    const root = freshRoot();
    let left = 0;
    for (let i = 0; i < 50; i++) {
      const { store } = await openWorld(root);
      store.park();
      await store.close();
      await new Promise(r => setTimeout(r, 0));
      if (root.get('.atlas/lock') !== null) left++;
      await dropLock(root);
    }
    expect(left).toBe(0);
  }, 30_000);

  it('unlinking while sync-state writes stream in: no rejection, no torn file', async () => {
    const { root, store } = await openWorld();
    let rejected = 0;
    const reasons = new Set<string>();
    for (let round = 0; round < 10; round++) {
      let done = false;
      const reset = store.resetSyncBaseline().finally(() => { done = true; });
      while (!done) {
        await store.updateSyncState(() => ({ last_pull_at: `2026-01-0${1 + (round % 8)}T00:00:00.000Z` }))
          .catch(e => { rejected++; reasons.add(String(e)); });
      }
      await reset.catch(e => { rejected++; reasons.add(String(e)); });
      JSON.parse(root.get('.atlas/sync-state.json')!);
    }
    expect({ rejected, reasons: [...reasons] }).toEqual({ rejected: 0, reasons: [] });
    await store.close();
  }, 60_000);

  it('unlinking while deletes stream tombstones in: no rejection', async () => {
    const { store } = await openWorld();
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) {
      const el = await store.createElement('character' as never, { name: `c${i}` } as never) as unknown as { id: string };
      await store.stampServerUpdatedAt(el.id, 'character' as never, '2026-01-01T00:00:00.000Z');
      ids.push(el.id);
    }
    let rejected = 0;
    const reasons = new Set<string>();
    for (let round = 0; round < 3; round++) {
      let done = false;
      const reset = store.resetSyncBaseline().finally(() => { done = true; });
      while (!done && ids.length) {
        await store.deleteElement(ids.pop()!).catch(e => { rejected++; reasons.add(String(e)); });
      }
      await reset.catch(e => { rejected++; reasons.add(String(e)); });
    }
    expect({ rejected, reasons: [...reasons] }).toEqual({ rejected: 0, reasons: [] });
    await store.close();
  }, 60_000);

  it('re-key journal writes racing its clear: no rejection, no tmp left', async () => {
    const { root, store } = await openWorld();
    let rejected = 0;
    for (let i = 0; i < 40; i++) {
      const ops = [
        store.writeRekeyJournal({ version: 1, n: i } as never),
        store.writeRekeyJournal({ version: 1, n: i + 1000 } as never),
        store.clearRekeyJournal(),
      ];
      rejected += (await Promise.allSettled(ops)).filter(r => r.status === 'rejected').length;
    }
    expect(rejected).toBe(0);
    expect(root.get('.atlas/rekey-journal.json')).toBeNull();
    expect(root.list().filter(p => p.endsWith('.tmp'))).toEqual([]);
    await store.close();
  }, 30_000);
});
