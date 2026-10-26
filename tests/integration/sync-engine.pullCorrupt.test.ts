/**
 * A pull now reads the element AS ON DISK
 * before applying (`applyServerRecordIfUnchanged` via `readForWrite`, so a
 * stamped outside edit is never overwritten). A served file that will not
 * parse (git conflict markers) therefore throws `CorruptFileError` in the
 * pull, and the round pauses with the file named, the posture convention 99
 * already set for push rounds: never write over a file Atlas cannot read.
 * Before this, the pull silently wrote the server body over the conflict.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { CorruptFileError } from '../../src/store/fs-utils';
import type { SyncEngineState } from '../../src/core/types';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;
let states: SyncEngineState[];

beforeEach(async () => {
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

describe('a pull that meets a file that will not parse', () => {
  it('pauses the world with the file named, and writes nothing over it', async () => {
    await client.createElement('character', { id: 'srv-1', name: 'Alice', type: 'character' });
    await engine.syncNow(); // Alice lands locally
    expect((await folder.getElement('srv-1'))?.name).toBe('Alice');

    // The server changes Alice; locally her file now holds conflict markers.
    await client.updateElement('character', 'srv-1', { name: 'Alice Liddell' } as never);
    const realApply = folder.applyServerRecordIfUnchanged.bind(folder);
    let applied = 0;
    folder.applyServerRecordIfUnchanged = async (type, record, sua, expected) => {
      if (record.id === 'srv-1') throw new CorruptFileError('alice--srv-1.json', new SyntaxError('Unexpected token <'));
      applied++;
      return realApply(type, record, sua, expected);
    };

    await engine.syncNow().catch(() => {});
    const last = engine.getState();
    expect(last.kind).toBe('error');
    expect(JSON.stringify(last)).toContain('alice--srv-1.json');
    expect((await folder.getElement('srv-1'))?.name).toBe('Alice'); // not overwritten
    expect(applied).toBe(0);
  });
});
