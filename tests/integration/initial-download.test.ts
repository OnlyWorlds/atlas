/**
 * initial-download — integration test against MSW + MockFolderStore.
 *
 * Verifies the helper used by the Link-Existing-API flow (Bout E):
 *   - Lists every element type from the (mocked) OW API.
 *   - Writes each record to the folder via `applyServerRecord`.
 *   - Stamps both timestamps to the server's value (no spurious re-push).
 *   - Reports progress per element with phase = 'list' then 'write'.
 *   - Survives per-element write failures (returns them in `failures`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { initialDownloadAll, DownloadCancelledError, type InitialDownloadProgress, type DownloadStop } from '../../src/sync/initial-download';

const TEST_BASE = 'https://test-ow.local/api/v2';

function makeAdapter(): OwV2ClientAdapter {
  return new OwV2ClientAdapter({ apiKey: 'test-key', apiPin: '1234', baseUrl: TEST_BASE });
}

let folder: MockFolderStore;
let clock: MonotonicClock;
let serverState: ReturnType<typeof statefulV2Handlers>;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  serverState = statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next });
  mswServer.use(...serverState.handlers);
});

afterEach(() => {
  mswServer.resetHandlers();
});

describe('initial-download', () => {
  it('downloads all elements from the server into the folder', async () => {
    // Seed three characters + one location on the server.
    serverState.handlers; // ensure handlers registered
    const adapter = makeAdapter();
    await adapter.createElement('character', { id: 'c1', name: 'Alice' });
    await adapter.createElement('character', { id: 'c2', name: 'Bob' });
    await adapter.createElement('character', { id: 'c3', name: 'Carol' });
    await adapter.createElement('location', { id: 'l1', name: 'Shire' });

    const result = await initialDownloadAll(folder, adapter);

    expect(result.totalDownloaded).toBe(4);
    expect(result.failures).toEqual([]);

    // Folder now has all four elements with both timestamps stamped.
    const all = await folder.listElements();
    expect(all).toHaveLength(4);
    const alice = all.find(e => e.id === 'c1')!;
    expect(alice.type).toBe('character');
    expect(alice.name).toBe('Alice');
    // applyServerRecord stamps both timestamps to the server's value, so
    // server == local — next sync sees nothing to push.
    expect(alice.local_updated_at).toBe(alice.server_updated_at);
  });

  it('returns zero counts for an empty server', async () => {
    const adapter = makeAdapter();
    const result = await initialDownloadAll(folder, adapter);
    expect(result.totalDownloaded).toBe(0);
    expect(result.failures).toEqual([]);
    expect(await folder.listElements()).toHaveLength(0);
  });

  it('reports progress for each element with list then write phases', async () => {
    const adapter = makeAdapter();
    await adapter.createElement('character', { id: 'c1', name: 'Alice' });
    await adapter.createElement('character', { id: 'c2', name: 'Bob' });

    const progressEvents: InitialDownloadProgress[] = [];
    await initialDownloadAll(folder, adapter, (p) => progressEvents.push({ ...p }));

    // Some list events (one per element type) plus 2 write events.
    const writeEvents = progressEvents.filter(p => p.phase === 'write');
    expect(writeEvents).toHaveLength(2);
    expect(writeEvents.map(e => e.done)).toEqual([1, 2]);
    expect(writeEvents[0].total).toBe(2);
    expect(writeEvents[1].total).toBe(2);
    // List events fire before any write.
    const firstWriteIdx = progressEvents.findIndex(p => p.phase === 'write');
    expect(firstWriteIdx).toBeGreaterThan(0);
    expect(progressEvents.slice(0, firstWriteIdx).every(p => p.phase === 'list')).toBe(true);
  });

  it('continues writing remaining records when one write fails (per-element resilience)', async () => {
    const adapter = makeAdapter();
    await adapter.createElement('character', { id: 'c1', name: 'Alice' });
    await adapter.createElement('character', { id: 'c2', name: 'Bob' });
    await adapter.createElement('character', { id: 'c3', name: 'Carol' });

    // Inject a folder-write failure on c2.
    folder.__inject_apply_failure('c2', 'simulated write error');

    const result = await initialDownloadAll(folder, adapter);

    // Two succeeded, one failed; all reported.
    expect(result.totalDownloaded).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      element_id: 'c2',
      type: 'character',
      operation: 'create',
    });

    const all = await folder.listElements();
    expect(all.map(e => e.id).sort()).toEqual(['c1', 'c3']);
  });

  it('downloads elements of every type, not just one', async () => {
    const adapter = makeAdapter();
    await adapter.createElement('character', { id: 'c1', name: 'Alice' });
    await adapter.createElement('location', { id: 'l1', name: 'Shire' });
    await adapter.createElement('species', { id: 's1', name: 'Hobbit' });
    await adapter.createElement('map', { id: 'm1', name: 'World Map' });

    const result = await initialDownloadAll(folder, adapter);
    expect(result.totalDownloaded).toBe(4);

    const all = await folder.listElements();
    const types = new Set(all.map(e => e.type));
    expect(types).toEqual(new Set(['character', 'location', 'species', 'map']));
  });
});

describe('initial-download: the user stops it (S360)', () => {
  async function seedFive(adapter: OwV2ClientAdapter) {
    for (const [id, name] of [['c1', 'Alice'], ['c2', 'Bob'], ['c3', 'Carol'], ['c4', 'Dan'], ['c5', 'Eve']]) {
      await adapter.createElement('character', { id, name });
    }
  }

  it('finish keeps what arrived and says it stopped early', async () => {
    const adapter = makeAdapter();
    await seedFive(adapter);
    let stop: DownloadStop = null;
    const result = await initialDownloadAll(folder, adapter, (p) => {
      if (p.phase === 'write' && p.done === 2) stop = 'finish';
    }, () => stop);
    expect(result.totalDownloaded).toBe(2);
    expect(result.stoppedEarly).toEqual({ total: 5 });
    expect(await folder.listElements()).toHaveLength(2);
  });

  it('cancel throws the cancel error mid-write', async () => {
    const adapter = makeAdapter();
    await seedFive(adapter);
    let stop: DownloadStop = null;
    await expect(initialDownloadAll(folder, adapter, (p) => {
      if (p.phase === 'write' && p.done === 1) stop = 'cancel';
    }, () => stop)).rejects.toBeInstanceOf(DownloadCancelledError);
  });

  it('cancel during listing throws before anything is written', async () => {
    const adapter = makeAdapter();
    await seedFive(adapter);
    await expect(initialDownloadAll(folder, adapter, undefined, () => 'cancel'))
      .rejects.toBeInstanceOf(DownloadCancelledError);
    expect(await folder.listElements()).toHaveLength(0);
  });

  it('never stopping is the old behaviour, with no stoppedEarly flag', async () => {
    const adapter = makeAdapter();
    await seedFive(adapter);
    const result = await initialDownloadAll(folder, adapter, undefined, () => null);
    expect(result.totalDownloaded).toBe(5);
    expect(result.stoppedEarly).toBeUndefined();
  });
});
