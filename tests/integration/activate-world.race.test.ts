/**
 * World-activation serialization — the "world opens empty sometimes" race
 * (Captain repro, 2026-07-10).
 *
 * Concurrent activations interleave on the SHARED active store: the second
 * call's `prior.close()` closes the first call's just-opened store mid-flight,
 * its listElements throws "FsFolderStore not open", and the catch primes
 * `elements: []`. Fix: all activations serialize through a module chain;
 * queued requests superseded by a newer click are skipped.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setActiveStore, clearParkedStores } from '../../src/core/active-store';

const events: string[] = [];
let storeSeq = 0;

vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: async () => {},
  loadHandle: async () => ({ kind: 'directory', name: 'fake' }),
  ensureWritable: async () => true,
  queryWritable: async () => true,
  deleteHandle: async () => {},
}));

// Strict + slow store: tracks open-state (throws like the real FsFolderStore
// when used closed) and sleeps inside open() to widen the race window.
vi.mock('../../src/store/folder-store-fs', async () => {
  const { MockFolderStore } = await import('../fixtures/mock-folder-store');
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  class StrictSlowStore extends MockFolderStore {
    private strictOpen = false;
    private n = ++storeSeq;
    async open(handle: unknown): Promise<void> {
      events.push(`open-start:${this.n}`);
      await sleep(10);
      await super.open(handle as never);
      this.strictOpen = true;
      events.push(`open-end:${this.n}`);
    }
    async close(): Promise<void> {
      this.strictOpen = false;
      events.push(`close:${this.n}`);
      await super.close();
    }
    // Park contract (speed bout 2026-07-19): switching away parks instead of
    // closing — the store stays open/usable, only the heartbeat stops.
    park(): void {
      events.push(`park:${this.n}`);
    }
    async unpark(): Promise<boolean> {
      events.push(`unpark:${this.n}`);
      return this.strictOpen;
    }
    private req(): void {
      if (!this.strictOpen) throw new Error('FsFolderStore not open');
    }
    async listElements(type?: never): Promise<never[]> {
      this.req();
      await sleep(3); // keep the post-open window open for the racing close
      return super.listElements(type) as Promise<never[]>;
    }
    async readWorldMeta() {
      this.req();
      return super.readWorldMeta();
    }
  }
  return { FsFolderStore: StrictSlowStore };
});

import { activateWorld } from '../../src/sidebar/worlds-sidebar';

const toastStub = { error() {}, info() {}, success() {} } as never;

function worldEntry(id: string, name: string) {
  return {
    id,
    name,
    state: 'local-only',
    folder: { handle_key: `k-${id}`, folder_name: `f-${id}` },
  } as never;
}

beforeEach(() => {
  events.length = 0;
  storeSeq = 0;
  localStorage.clear();
  setActiveStore(null);
  clearParkedStores();
  patchSlice('active', null);
  patchSlice('data', { elements: [] });
  patchSlice('registry', {
    ...defaultRegistry(),
    worlds: [worldEntry('w1', 'World One'), worldEntry('w2', 'World Two')],
  });
  window.location.hash = '#/';
});

describe('activateWorld — serialization under concurrent calls', () => {
  it('a click during an in-flight activation never closes the store mid-use', async () => {
    // Fire the second activation while the first is inside open(). Without
    // serialization the interleave order is open-start:1, open-start:2 … and
    // the second call's prior-close hits store 1 while activation 1 is still
    // priming from it.
    const p1 = activateWorld('w1', toastStub);
    await new Promise((r) => setTimeout(r, 2)); // p1 is inside open(10ms)
    const p2 = activateWorld('w2', toastStub);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    // Strictly serial: activation 1 fully completes (open 1 start→end, no
    // second open interleaved) before activation 2 PARKS store 1 (the
    // switch-away contract since the speed bout — close only on eviction)
    // and opens store 2.
    expect(events).toEqual([
      'open-start:1',
      'open-end:1',
      'park:1',
      'open-start:2',
      'open-end:2',
    ]);
    expect(getState().active?.worldId).toBe('w2');
  });

  it('rapid triple-click: only the LAST request runs (stale queued skipped)', async () => {
    const [r1, r2, r3] = await Promise.all([
      activateWorld('w1', toastStub),
      activateWorld('w2', toastStub),
      activateWorld('w1', toastStub),
    ]);
    // All three were queued before any ran; the first two are superseded.
    expect(r1).toBe(false);
    expect(r2).toBe(false);
    expect(r3).toBe(true);
    expect(getState().active?.worldId).toBe('w1');
    // Exactly one store was ever opened — no wasted FS work, no interleave.
    expect(events.filter((e) => e.startsWith('open-start')).length).toBe(1);
  });
});
