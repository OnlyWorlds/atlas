/**
 * The way OUT of a hold. The hold itself was
 * airtight; each defect here left a world quietly not syncing afterwards, or
 * (Q4) offered a re-key that would duplicate an element on the server. Each
 * `it` was a lens probe that observed the defect, turned round.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { liveForeignIds } from '../../src/sync/foreign-ids';
import type { SyncEngineState, Element } from '../../src/core/types';

// The scheduler's online/offline listeners read the attached engine from
// sync-attach; stand in for it so the REAL listener code runs.
let currentEngine: SyncEngine | null = null;
vi.mock('../../src/sync/sync-attach', () => ({
  getCurrentSyncEngine: () => currentEngine,
  pullNowAndRefresh: async () => null,
}));
import { initAutoPullScheduler } from '../../src/sync/auto-pull-scheduler';
import { getState, patchSlice } from '../../src/core/state';

const API_WORLD = 'api-world-1';
const KEEL_FOREIGN = 'An element with id x already exists in another world. give this element a new id (a copied world folder needs fresh ids).';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;
let states: SyncEngineState[];

const methods = () => client.calls.map(c => (c as { method: string }).method);
const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(async () => {
  vi.useRealTimers();
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  states = [];
  engine = new SyncEngine({
    folder, client, apiWorldId: API_WORLD,
    onStateChange: s => {
      states.push(s);
      patchSlice('sync', { ...getState().sync, activeSync: s }); // what publishSyncState does
    },
  });
  currentEngine = engine;
});

describe('the network coming back during a hold', () => {
  it('lifts the network pause, and the release pushes', async () => {
    initAutoPullScheduler();
    await folder.createElement('character', { name: 'A' });
    window.dispatchEvent(new Event('offline'));
    expect(engine.getState()).toMatchObject({ kind: 'paused', reason: 'network' });
    const release = await engine.hold('rekey');
    window.dispatchEvent(new Event('online'));
    client.calls.length = 0;
    release();
    await tick(); await tick();
    expect(methods()).toContain('create');
  });

  it('control: without a hold the same online event resumes and pushes', async () => {
    await folder.createElement('character', { name: 'A' });
    window.dispatchEvent(new Event('offline'));
    client.calls.length = 0;
    window.dispatchEvent(new Event('online'));
    await tick(); await tick();
    expect(methods()).toContain('create');
  });
});

it('an auth error comes out of the hold still red, with its message', async () => {
  await folder.createElement('character', { name: 'A' });
  client.__inject_auth_failure(true);
  await engine.pushOnce();
  const before = engine.getState();
  expect(before.kind).toBe('error');
  const release = await engine.hold('rekey');
  release();
  expect(engine.getState()).toEqual(before);
});

it('a journal check that throws settles the round instead of pinning "Saving"', async () => {
  await folder.createElement('character', { name: 'A' });
  folder.hasRekeyJournal = async () => { throw new DOMException('The directory handle is gone', 'NotAllowedError'); };
  await expect(engine.pushOnce()).rejects.toThrow(/directory handle/);
  expect(engine.getState().kind).not.toBe('syncing');
  await expect(engine.pullNow()).rejects.toThrow();
  expect(engine.getState().kind).not.toBe('syncing');
});

it('an id that landed on THIS server with its backfill missing leaves the foreign list', async () => {
  client.__enable_bulk();
  const a = await folder.createElement('character', { name: 'Aragorn' });
  await folder.createElement('character', { name: 'B' });
  client.__inject_bulk_item_failure(a.id, { code: 'id_conflict', message: KEEL_FOREIGN, param: 'id' });
  await engine.pushOnce();
  const live = async () => liveForeignIds((await folder.readSyncState()).foreign, API_WORLD, await folder.listElements());
  expect((await live()).map(e => e.id)).toEqual([a.id]);
  // The other world freed the id; A goes up again and LANDS, but the read-back fails.
  await folder.createElement('character', { name: 'C' });
  client.__omit_bulk_timestamps(true);
  const realGet = client.getElement.bind(client);
  client.getElement = async () => { throw new Error('API Error 503: Service Unavailable'); };
  await engine.pushOnce();
  client.getElement = realGet;
  client.__omit_bulk_timestamps(false);
  expect(await realGet('character', a.id)).not.toBeNull();
  expect(await live()).toEqual([]); // no longer offered for a re-key
});

describe('the hold-back scans wire fields only', () => {
  for (const field of ['atlas_page_refs', 'atlas_dismissed_suggestions'] as const) {
    it(`a synced narrative naming a refused id only in ${field} still uploads its edits`, async () => {
      client.__enable_bulk();
      const f = await folder.createElement('character', { name: 'Foreign' });
      await folder.createElement('character', { name: 'Other' });
      const page = await folder.createElement('narrative', { name: 'Page' });
      client.__inject_bulk_item_failure(f.id, { code: 'id_conflict', message: KEEL_FOREIGN, param: 'id' });
      await engine.pushOnce();
      expect((await folder.getElement(page.id))!.server_updated_at).toBeTruthy();
      await folder.updateElement(page.id, { description: 'real edit', [field]: [f.id] } as Partial<Element>);
      await folder.createElement('character', { name: 'pad' }); // keep the bulk path
      client.__inject_bulk_item_failure(f.id, { code: 'id_conflict', message: KEEL_FOREIGN, param: 'id' });
      client.calls.length = 0;
      const res = await engine.pushOnce();
      // The engine sends it (the real adapter strips the local-only field on
      // the way out; this fake stands BELOW the adapter and refuses such
      // fields on purpose, so what it does with the body is not the question).
      expect(methods()).toContain('update');
      expect(res.failures.find(x => x.element_id === page.id)?.message ?? '').not.toMatch(/waits for an element/);
    });
  }
});

it('the round a hold waited for leaves the state to the hold', async () => {
  await folder.createElement('character', { name: 'A' });
  let open!: () => void;
  const gate = new Promise<void>(r => { open = r; });
  let entered!: () => void;
  const inside = new Promise<void>(r => { entered = r; });
  const real = client.createElement.bind(client);
  client.createElement = async (t, b) => { entered(); await gate; return real(t, b); };
  const round = engine.pushOnce();
  await inside;
  const mark = states.length;
  const holding = engine.hold('rekey');
  open();
  await round;
  const release = await holding;
  const after = states.slice(mark).map(s => s.kind + ('reason' in s ? `:${s.reason}` : ''));
  expect(after).toEqual(['paused:held']);
  release();
});

it('a transient retry armed by the round the hold waited for sends nothing until release', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    await folder.createElement('character', { name: 'A' });
    let open!: () => void;
    const gate = new Promise<void>(r => { open = r; });
    let entered!: () => void;
    const inside = new Promise<void>(r => { entered = r; });
    const real = client.createElement.bind(client);
    client.createElement = async () => { entered(); await gate; throw new Error('API Error 503: Service Unavailable'); };
    const round = engine.pushOnce();
    await inside;
    const holding = engine.hold('rekey');
    open();
    expect((await round).transient_blocked).toBe(true);
    const release = await holding;
    client.createElement = real;
    client.calls.length = 0;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(methods()).toEqual([]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(methods()).toContain('create');
  } finally {
    vi.useRealTimers();
  }
});
