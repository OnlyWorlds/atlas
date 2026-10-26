/**
 * The engine hold and the re-key journal gate (re-key gate lens 2 R1/R2).
 *
 * `pause()` was never enough for an exclusive local operation: a round in
 * flight keeps creating and stamping (it checks `stopped`, never `paused`),
 * and `resume()` is one shared flag, so the re-key's own resume would push a
 * world the user had set to stay offline. These pin the replacement.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import type { SyncEngineState } from '../../src/core/types';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;
let states: SyncEngineState[];

beforeEach(async () => {
  // The suite runs in one fork: a file that left fake timers installed would
  // freeze every setTimeout below.
  vi.useRealTimers();
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  states = [];
  engine = new SyncEngine({ folder, client, onStateChange: s => states.push(s) });
});

const serverCalls = () => client.calls.map(c => (c as { method: string }).method);
const tick = () => new Promise(r => setTimeout(r, 0));

/** Hold the first createElement at a gate; resolves `entered` once inside. */
function gateFirstCreate(): { entered: Promise<void>; open: () => void } {
  let open!: () => void;
  const gate = new Promise<void>(r => { open = r; });
  let signal!: () => void;
  const entered = new Promise<void>(r => { signal = r; });
  const real = client.createElement.bind(client);
  let first = true;
  client.createElement = async (t, body) => {
    if (first) { first = false; signal(); await gate; }
    return real(t, body);
  };
  return { entered, open };
}

describe('SyncEngine.hold', () => {
  it('resolves only after the round in flight has finished', async () => {
    await folder.createElement('character', { name: 'A' });
    const { entered, open } = gateFirstCreate();
    const round = engine.pushOnce();
    await entered;
    let held = false;
    const holding = engine.hold('rekey').then(r => { held = true; return r; });
    await tick();
    expect(held).toBe(false);
    open();
    await round;
    const release = await holding;
    expect(held).toBe(true);
    expect(engine.getState()).toMatchObject({ kind: 'paused', reason: 'held' });
    release();
  });

  it('nothing reaches the server while held: autosave, flush, push, pull, sync', async () => {
    engine.setDebounceMs(0);
    await folder.createElement('character', { name: 'A' });
    const release = await engine.hold('rekey');
    client.calls.length = 0;
    engine.requestPush();
    expect(engine.flushPendingPush()).toBeNull();
    await engine.pushOnce();
    await engine.pullNow();
    await engine.syncNow();
    await tick();
    expect(serverCalls()).toEqual([]);
    release();
  });

  it('a debounce armed before the hold never fires', async () => {
    engine.setDebounceMs(20);
    await folder.createElement('character', { name: 'A' });
    engine.requestPush();
    const release = await engine.hold('rekey');
    client.calls.length = 0;
    await new Promise(r => setTimeout(r, 60));
    expect(serverCalls()).toEqual([]);
    release();
  });

  it('resume() does not release a hold', async () => {
    await folder.createElement('character', { name: 'A' });
    const release = await engine.hold('rekey');
    client.calls.length = 0;
    engine.resume();
    await tick();
    await engine.pushOnce();
    expect(serverCalls()).toEqual([]);
    expect(engine.isHeld()).toBe(true);
    release();
  });

  it('release does not un-pause a world the user set to stay offline', async () => {
    await folder.createElement('character', { name: 'offline edit' });
    engine.pause('manual');
    const release = await engine.hold('rekey');
    client.calls.length = 0;
    release();
    await tick();
    await engine.pushOnce();
    expect(serverCalls()).toEqual([]);
    expect(engine.getState()).toMatchObject({ kind: 'paused', reason: 'manual' });
  });

  it('release on a running world pushes what waited', async () => {
    const release = await engine.hold('rekey');
    await folder.createElement('character', { name: 'made while held' });
    client.calls.length = 0;
    release();
    await tick();
    await tick();
    expect(serverCalls()).toContain('create');
  });

  it('release is single-use: a second call cannot drop another holder', async () => {
    const r1 = await engine.hold('rekey');
    const r2 = await engine.hold('rekey');
    r1();
    r1();
    expect(engine.isHeld()).toBe(true);
    r2();
    expect(engine.isHeld()).toBe(false);
  });

  it('conflict and server-delete resolution refuse while held', async () => {
    const release = await engine.hold('rekey');
    await expect(engine.resolveConflict('x', 'overwrite-mine')).rejects.toThrow(/ids are being updated/i);
    await expect(engine.resolveServerDelete('x', 'keep')).rejects.toThrow(/ids are being updated/i);
    await expect(engine.resolveMetaConflict('name', 'mine')).rejects.toThrow(/ids are being updated/i);
    release();
  });
});

describe('the re-key journal gate', () => {
  it('a journal on disk stops push, pull and sync on any engine', async () => {
    await folder.createElement('character', { name: 'A' });
    await folder.writeRekeyJournal({
      version: 1, world_id: 'w', map: {}, types: {}, stamps: {}, unrewritten: [], started_at: '2026-01-01T00:00:00.000Z',
    });
    client.calls.length = 0;
    await engine.pushOnce();
    await engine.pullNow();
    await engine.syncNow();
    expect(serverCalls()).toEqual([]);
    expect(engine.getState()).toMatchObject({ kind: 'paused', reason: 'held' });
    await folder.clearRekeyJournal();
    await engine.pushOnce();
    expect(serverCalls()).toContain('create');
  });

  it('a journal that will not parse still stops every round', async () => {
    await folder.createElement('character', { name: 'A' });
    folder.rekeyJournalCorrupt = true;
    client.calls.length = 0;
    await engine.pushOnce();
    expect(serverCalls()).toEqual([]);
  });
});
