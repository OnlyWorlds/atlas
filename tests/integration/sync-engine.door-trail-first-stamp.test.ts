/**
 * A first stamp is a new row on keel, so the trail names only what that row's answer says (#760,
 * the code gate's G1): doors left from the element's older life never survive a create, and a
 * `/bulk` echo, which brings no body, leaves no trail rather than a wrong one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { doorTrail } from '../../src/core/door-trail';
import { stampedBody } from '../../src/store/sync-stamp';
import type { Element } from '../../src/core/types';

const OLD = { lantern: '2026-09-01T00:00:00Z' };

let folder: MockFolderStore;
let client: FakeOwApiClient;

beforeEach(async () => {
  const clock = new MonotonicClock('2026-10-29T10:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  client.__enable_changes();
  client.__stamp_doors('atlas');
});

describe('a create after a cleared baseline', () => {
  it('through /bulk: the older life\'s doors go, and the trail says nothing rather than Lantern', async () => {
    client.__enable_bulk();
    const a = await folder.createElement('character', { name: 'Ada', doors: OLD } as never);
    const b = await folder.createElement('character', { name: 'Bo', doors: OLD } as never);
    await new SyncEngine({ folder, client }).syncNow();
    expect(client.calls.some(c => c.method === 'bulk')).toBe(true);
    for (const id of [a.id, b.id]) {
      const el = (await folder.getElement(id))!;
      expect(el.server_updated_at).toBeTruthy();
      expect((el as Record<string, unknown>).doors).toBeUndefined();
      expect(doorTrail(el)).toEqual([]);
    }
  });

  it('one at a time: the answer\'s doors replace them, and the trail says Atlas', async () => {
    const a = await folder.createElement('character', { name: 'Ada', doors: OLD } as never);
    await new SyncEngine({ folder, client }).syncNow();
    const el = (await folder.getElement(a.id))!;
    expect(doorTrail(el).map(s => s.where)).toEqual(['in Atlas']);
  });
});

describe('stampedBody', () => {
  const base = { id: '00000000-0000-4000-8000-0000000000e1', type: 'character', name: 'Ada', doors: OLD } as unknown as Element;
  it('keeps the doors on a later stamp with no answer, since they are still this row\'s', () => {
    const next = stampedBody({ ...base, server_updated_at: '2026-10-01T00:00:00Z' } as Element, '2026-10-29T00:00:00Z');
    expect((next as Record<string, unknown>).doors).toEqual(OLD);
  });
  it('drops them on a first stamp with no answer, and takes the answer\'s on a first stamp with one', () => {
    expect((stampedBody(base, '2026-10-29T00:00:00Z') as Record<string, unknown>).doors).toBeUndefined();
    const doors = { atlas: '2026-10-29T00:00:00Z' };
    expect((stampedBody(base, '2026-10-29T00:00:00Z', undefined, { doors }) as Record<string, unknown>).doors).toEqual(doors);
  });
});
