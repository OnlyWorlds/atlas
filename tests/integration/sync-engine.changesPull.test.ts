/**
 * SyncEngine pullPhaseChanges — the v2 cursor-delta pull.
 *
 * Design + adversarial-gate resolutions: Forge/Notes/2026-07-12-v2-changes-pull-design.md.
 * Every gate finding gets a regression lock here:
 *   G-A  delete-then-recreate revival (upsert cancels the delete-review entry,
 *        in-round AND persisted) + stale-delete guard on cursor-overlap replay
 *   G-B  cursor + side-effects persist ATOMICALLY on a mid-walk throw
 *   G-C  stop() aborts applies and the terminal persist
 *   trap non-advancing cursor aborts instead of looping forever
 *
 * Semantic tests drive the upgraded FakeOwApiClient (__enable_changes);
 * walk-mechanics tests script pullChanges pages by hand.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import type { ChangesPage } from '../../src/sync/sync-engine';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;
let clock: MonotonicClock;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  client.__enable_changes();
  engine = new SyncEngine({ folder, client });
});

describe('changes pull: cursor delta semantics', () => {
  it('cold-starts from the epoch, applies creates, persists the cursor, and the next pull is a no-op', async () => {
    await client.createElement('character', { id: '00000000-0000-4000-8000-000000000001', name: 'Remote A' });
    await client.createElement('location', { id: '00000000-0000-4000-8000-000000000002', name: 'Remote B' });

    const r1 = await engine.pullNow();
    expect(r1.pulled.creates).toBe(2);
    const state1 = await folder.readSyncState();
    expect(state1.changes_cursor).toBeTruthy();

    const r2 = await engine.pullNow();
    expect(r2.pulled.creates).toBe(0);
    expect(r2.pulled.updates).toBe(0);
  });

  it('skips our own push echoes (serverChanged false against the stamped baseline)', async () => {
    const el = await folder.createElement('character', { name: 'Mine' });
    await engine.syncNow(); // push CREATE, then pull sees its own upsert op
    const after = await folder.getElement(el.id);
    expect(after?.server_updated_at).toBeTruthy();
    const r = await engine.pullNow();
    expect(r.pulled.updates).toBe(0);
    expect(r.conflicts).toHaveLength(0);
  });

  it('applies a genuine server-side update and detects both-changed conflicts (local-wins skip)', async () => {
    const el = await folder.createElement('character', { name: 'Shared' });
    await engine.syncNow();

    // Server-side edit only → applied.
    client.__server_mutate('character', el.id, { description: 'server edit' });
    const r1 = await engine.pullNow();
    expect(r1.pulled.updates).toBe(1);
    expect((await folder.getElement(el.id))?.description).toBe('server edit');

    // Both sides move → conflict; local preserved under local-wins.
    client.__server_mutate('character', el.id, { description: 'server again' });
    await folder.updateElement(el.id, { description: 'local wins' });
    const r2 = await engine.pullNow();
    expect(r2.conflicts).toHaveLength(1);
    expect((await folder.getElement(el.id))?.description).toBe('local wins');
  });

  it('explicit delete op queues the server-delete review (never auto-deletes locally)', async () => {
    const el = await folder.createElement('character', { name: 'Doomed' });
    await engine.syncNow();
    await client.deleteElement('character', el.id); // appends the delete op
    const r = await engine.pullNow();
    expect(r.pulled.deletes).toBe(0); // nothing destroyed
    expect(await folder.getElement(el.id)).toBeTruthy(); // file intact
    const state = await folder.readSyncState();
    expect((state.server_deletes ?? []).map(d => d.id)).toContain(el.id);
  });

  it('G-A: delete-then-recreate in ONE walk leaves the element alive with ZERO review entries', async () => {
    const el = await folder.createElement('character', { name: 'Phoenix' });
    await engine.syncNow();
    await client.deleteElement('character', el.id);
    await client.createElement('character', { id: el.id, name: 'Phoenix reborn' });

    const r = await engine.pullNow();
    expect(r.pulled.updates).toBe(1);
    expect((await folder.getElement(el.id))?.name).toBe('Phoenix reborn');
    const state = await folder.readSyncState();
    expect((state.server_deletes ?? []).filter(d => d.id === el.id)).toHaveLength(0);
  });

  it('G-A cross-round: an upsert in a LATER round removes the persisted review entry from the earlier one', async () => {
    const el = await folder.createElement('character', { name: 'Lazarus' });
    await engine.syncNow();

    await client.deleteElement('character', el.id);
    await engine.pullNow(); // round 1: delete op → entry persisted
    let state = await folder.readSyncState();
    expect((state.server_deletes ?? []).map(d => d.id)).toContain(el.id);

    await client.createElement('character', { id: el.id, name: 'Lazarus lives' });
    await engine.pullNow(); // round 2: upsert revives → persisted entry removed
    state = await folder.readSyncState();
    expect((state.server_deletes ?? []).filter(d => d.id === el.id)).toHaveLength(0);
    expect((await folder.getElement(el.id))?.name).toBe('Lazarus lives');
  });

  it('G-A replay: cursor rollback re-delivers old ops idempotently — stale delete skipped, no phantom entry', async () => {
    const el = await folder.createElement('character', { name: 'Replayed' });
    await engine.syncNow();
    await client.deleteElement('character', el.id);
    await client.createElement('character', { id: el.id, name: 'Replayed v2' });
    await engine.pullNow();
    const cursorAfter = (await folder.readSyncState()).changes_cursor;

    // Rewind the cursor to the epoch (simulates the overlap after an aborted
    // walk) — the full op history replays.
    await folder.updateSyncState(() => ({ changes_cursor: null }));
    const r = await engine.pullNow();
    // The old delete op is STALE against the baseline (deleted_at <= stamped
    // server_updated_at of the recreate) → skipped; the upserts are own-state
    // echoes → skipped. Nothing changes, nothing gets queued.
    expect(r.pulled.creates + r.pulled.updates).toBe(0);
    const state = await folder.readSyncState();
    expect((state.server_deletes ?? []).filter(d => d.id === el.id)).toHaveLength(0);
    expect((await folder.getElement(el.id))?.name).toBe('Replayed v2');
    expect(state.changes_cursor).toBe(cursorAfter); // walk re-converged to the head
  });

  it('never destroys a never-synced local that a delete op happens to name', async () => {
    // Local-only element (no baseline) whose id coincides with a server
    // delete op (uuid-collision territory; must never be destroyed).
    const el = await folder.createElement('character', { name: 'Innocent' });
    await client.createElement('character', { id: el.id, name: 'ghost' });
    await client.deleteElement('character', el.id);
    // el has NO server_updated_at (we never pushed it).
    const r = await engine.pullNow();
    void r;
    expect(await folder.getElement(el.id)).toBeTruthy();
    const state = await folder.readSyncState();
    expect((state.server_deletes ?? []).filter(d => d.id === el.id)).toHaveLength(0);
  });
});

describe('changes pull: walk mechanics (scripted pages)', () => {
  /** Replace the fake's pullChanges with a scripted page sequence. */
  function scriptPages(pages: Array<ChangesPage | Error>): { calls: Array<string | null> } {
    const calls: Array<string | null> = [];
    let i = 0;
    client.pullChanges = async (since) => {
      calls.push(since);
      const next = pages[Math.min(i, pages.length - 1)];
      i++;
      if (next instanceof Error) throw next;
      return next;
    };
    return { calls };
  }

  const upsertOp = (id: string, name: string, seq: number, updatedAt: string): ChangesPage['changes'][number] => ({
    op: 'upsert',
    type: 'character',
    id,
    changeSeq: seq,
    updatedAt,
    element: { id, name, updated_at: updatedAt },
  });

  it('trap: a non-advancing cursor with hasMore aborts the walk instead of looping', async () => {
    const { calls } = scriptPages([
      { cursor: 'stuck:cursor', hasMore: true, changes: [upsertOp('00000000-0000-4000-8000-0000000000aa', 'A', 1, '2026-02-01T00:00:00Z')] },
      { cursor: 'stuck:cursor', hasMore: true, changes: [] },
    ]);
    const r = await engine.pullNow();
    expect(r.pulled.creates).toBe(1); // page 1 applied
    expect(calls.length).toBe(2);     // page 2 detected the stuck cursor and stopped
    const state = await folder.readSyncState();
    expect(state.changes_cursor).toBe('stuck:cursor'); // last fully-applied page
  });

  it('G-B: a mid-walk throw persists the cursor AND the collected side-effects atomically', async () => {
    const el = await folder.createElement('character', { name: 'Casualty' });
    await client.createElement('character', { id: el.id, name: 'Casualty' });
    // Give it a baseline so the delete op routes to review.
    await engine.syncNow();

    scriptPages([
      {
        cursor: 'page1:end',
        hasMore: true,
        changes: [{ op: 'delete', type: 'character', id: el.id, changeSeq: 9, deletedAt: '2026-03-01T00:00:00Z' }],
      },
      new Error('network blip on page 2'),
    ]);
    await expect(engine.pullNow()).rejects.toThrow('network blip');
    const state = await folder.readSyncState();
    // The cursor moved to page 1's end AND page 1's delete review entry
    // moved with it — never one without the other.
    expect(state.changes_cursor).toBe('page1:end');
    expect((state.server_deletes ?? []).map(d => d.id)).toContain(el.id);
  });

  it('G-C: stop() mid-walk aborts applies and the terminal persist (cursor stays cleared)', async () => {
    let stopAfterFetch = false;
    client.pullChanges = async () => {
      if (stopAfterFetch) engine.stop();
      stopAfterFetch = true;
      // First call returns a page; stop() fires at the SECOND fetch, before
      // its ops are applied.
      return {
        cursor: stopAfterFetch ? 'p1:c' : 'p2:c',
        hasMore: true,
        changes: [upsertOp(`00000000-0000-4000-8000-0000000000${stopAfterFetch ? 'b1' : 'b2'}`, 'X', 1, '2026-02-01T00:00:00Z')],
      } as ChangesPage;
    };
    const r = await engine.pullNow();
    void r;
    const state = await folder.readSyncState();
    // stop() landed before the terminal persist — the cursor was never
    // written (resetSyncBaseline's clear stays cleared in the real unlink
    // flow this models).
    expect(state.changes_cursor ?? null).toBeNull();
  });
});

describe('changes pull: rewind guard (v2 tail — head below last-applied seq)', () => {
  it('normal operation never triggers the guard (head >= last-applied seq)', async () => {
    await client.createElement('character', { id: '00000000-0000-4000-8000-00000000r001', name: 'A' });
    await engine.pullNow();
    await client.createElement('character', { id: '00000000-0000-4000-8000-00000000r002', name: 'B' });
    const r = await engine.pullNow();
    expect(r.pulled.creates).toBe(1);
    const state = await folder.readSyncState();
    expect(state.changes_last_seq).toBeGreaterThan(0);
  });

  it('server restore-from-backup: head < persisted seq → cursor dropped, cold walk re-baselines', async () => {
    // Reach seq 2 and persist it.
    await client.createElement('character', { id: '00000000-0000-4000-8000-00000000r011', name: 'Keep' });
    await client.createElement('character', { id: '00000000-0000-4000-8000-00000000r012', name: 'Lost in restore' });
    await engine.pullNow();
    const before = await folder.readSyncState();
    expect(before.changes_last_seq).toBe(2);

    // Disaster: server restored from a backup taken at seq 1.
    client.__rewind_op_log(1);
    // The restored server then takes ONE new edit (seq 2 again, different content).
    await client.createElement('location', { id: '00000000-0000-4000-8000-00000000r013', name: 'Post-restore town' });

    // Our persisted seq (2) equals the new head (2) — no rewind signal yet;
    // rewind detection needs head strictly BELOW our memory. Rewind further:
    client.__rewind_op_log(1);

    const r = await engine.pullNow();
    // Guard fired: cursor dropped, cold walk replayed the world from the epoch.
    expect(r.pulled.creates + r.pulled.updates).toBeGreaterThanOrEqual(0); // walk completed, no throw
    const after = await folder.readSyncState();
    expect(after.changes_last_seq).toBe(1); // re-baselined to the restored head
    expect(after.changes_cursor).toBe('1:00000000-0000-4000-8000-00000000r011');
  });

  it('a head that stays behind after one reset does not loop (single reset per round)', async () => {
    await client.createElement('character', { id: '00000000-0000-4000-8000-00000000r021', name: 'A' });
    await engine.pullNow();
    // Pathological server: claims head 0 forever but still serves ops.
    const real = client.pullChanges!.bind(client);
    client.pullChanges = async (since, limit) => {
      const page = await real(since, limit);
      return { ...page, head: 0 };
    };
    // Must complete (SAFETY_CAP protects regardless; the single-reset latch
    // means we don't even spin to the cap).
    const r = await engine.pullNow();
    expect(r).toBeDefined();
  });
});
