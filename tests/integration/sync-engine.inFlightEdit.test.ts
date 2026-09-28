/**
 * S360 H1 — an edit made while its push is in flight must still reach the
 * server.
 *
 * The push reads the element, sends it, then stamps `server_updated_at` from
 * the response. An edit landing during the request, which the server
 * processes after the edit, used to end with `local_updated_at <=
 * server_updated_at`: the element read clean and the edit was never sent.
 * `stampServerUpdatedAt(…, sentLocalUpdatedAt)` keeps such an element dirty.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { stampedBody } from '../../src/store/sync-stamp';

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
  engine = new SyncEngine({ folder, client });
});

describe('SyncEngine: an edit during an in-flight UPDATE', () => {
  it('stays dirty and goes out on the next push', async () => {
    const el = await folder.createElement('character', { name: 'Rhea', description: 'one' });
    await engine.syncNow();
    expect((await client.getElement('character', el.id))!.description).toBe('one');

    await folder.updateElement(el.id, { description: 'two' });

    // The user types again WHILE the PATCH for "two" is on the wire; the
    // server then processes the request (its clock reads after the edit).
    const realUpdate = client.updateElement.bind(client);
    let once = true;
    client.updateElement = async (type, id, body) => {
      if (once) {
        once = false;
        await folder.updateElement(el.id, { description: 'three' });
      }
      return realUpdate(type, id, body);
    };

    await engine.syncNow();
    expect((await client.getElement('character', el.id))!.description).toBe('two');

    const pending = await folder.listLocallyChangedSince(null);
    expect(pending.map(e => e.id)).toContain(el.id);

    await engine.syncNow();
    expect((await client.getElement('character', el.id))!.description).toBe('three');
    expect(await folder.listLocallyChangedSince(null)).toHaveLength(0);
  });

  it('an untouched element is stamped clean as before', async () => {
    const el = await folder.createElement('character', { name: 'Kronos' });
    await engine.syncNow();
    await folder.updateElement(el.id, { description: 'edited' });
    await engine.syncNow();
    expect(await folder.listLocallyChangedSince(null)).toHaveLength(0);
  });
});

describe('stampedBody', () => {
  const base = { id: 'a', type: 'character', name: 'A' } as never;

  it('no sent stamp: baseline only (pull and legacy callers)', () => {
    const out = stampedBody({ ...(base as object), local_updated_at: '2026-01-01T00:00:05.000Z' } as never, '2026-01-01T00:00:09.000Z');
    expect(out.local_updated_at).toBe('2026-01-01T00:00:05.000Z');
    expect(out.server_updated_at).toBe('2026-01-01T00:00:09.000Z');
  });

  it('edited in flight and sorting below the server stamp: lifted just past it', () => {
    const out = stampedBody({ ...(base as object), local_updated_at: '2026-01-01T00:00:05.000Z' } as never,
      '2026-01-01T00:00:09.166516+00:00', '2026-01-01T00:00:01.000Z');
    expect(out.local_updated_at! > out.server_updated_at!).toBe(true);
    expect(out.local_updated_at).toBe('2026-01-01T00:00:09.167Z');
  });

  it('edited in flight and already newer: left alone', () => {
    const out = stampedBody({ ...(base as object), local_updated_at: '2026-01-01T00:00:12.000Z' } as never,
      '2026-01-01T00:00:09.000Z', '2026-01-01T00:00:01.000Z');
    expect(out.local_updated_at).toBe('2026-01-01T00:00:12.000Z');
  });
});
