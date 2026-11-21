/**
 * Two element refusals the round goes on past (1.124.35).
 *
 * keel's keeper rule: a world's Charter Laws and every Object a Law's text names are changed only by the
 * owner and co-builders; anyone else's write is 403 `keeper_only`. It is about that element, never the key:
 * the round's other elements land, nothing pauses, and the element stays dirty, so a round that runs again
 * sends it again (as a member's `not_author` is: neither is remembered between rounds).
 *
 * A create sent create-only that keel answers 200 (it replaced what it held, against its promise): the
 * element is not counted as sent, so the next round sends it again as a create, and keel's answer that it
 * holds the id brings the comparison of the two copies.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine, REPLACED_HELD_LINE } from '../../src/sync/sync-engine';
import { OwV2Error } from '../../src/sync/ow-v2-client-adapter';
import { classifyFailure } from '../../src/sync/sync-failure-copy';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;

beforeEach(async () => {
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  engine = new SyncEngine({ folder, client });
});

afterEach(() => engine.stop());

const keeperOnly = (): OwV2Error => new OwV2Error(403, {
  type: 'permission_error', code: 'keeper_only', param: null,
  message: 'Only the world\'s owner and co-builders change this element. Nothing was written. Ask one of them, or propose the change.',
}, '');

describe('a keeper_only refusal', () => {
  it('refuses that element only: the round\'s others land, nothing pauses, and each round sends it again', async () => {
    const law = await folder.createElement('law', { name: 'The charter' });
    const other = await folder.createElement('character', { name: 'Ada' });
    await engine.pushOnce();
    await folder.updateElement(law.id, { description: 'Mine' });
    await folder.updateElement(other.id, { description: 'Hers' });
    const real = client.updateElement.bind(client);
    const lawSends: string[] = [];
    client.updateElement = async (type, id, body, opts) => {
      if (id === law.id) { lawSends.push(id); throw keeperOnly(); }
      return real(type, id, body, opts);
    };

    const first = await engine.pushOnce();
    expect(first.auth_blocked).toBeFalsy();
    expect(first.transient_blocked).toBeFalsy();
    expect(engine.isPaused()).toBe(false);
    expect(first.pushed.updates).toBe(1);
    expect(client.__server_get('character', other.id)!.description).toBe('Hers');
    expect(first.failures.map(f => [f.element_id, f.code, classifyFailure(f)])).toEqual([[law.id, 'keeper_only', 'keeper_only']]);

    // Read as it is: nothing remembers the refusal, so the next round sends it again.
    const second = await engine.pushOnce();
    expect(lawSends).toEqual([law.id, law.id]);
    expect(second.failures.map(f => f.code)).toEqual(['keeper_only']);
  });
});

describe('a create keel answered as replaced (200 under create_only)', () => {
  it('is not counted as sent, and the next round sends it again: keel\'s 409 brings the comparison, the same copy adopted', async () => {
    client.__enable_bulk();
    const a = await folder.createElement('character', { name: 'A' });
    const b = await folder.createElement('character', { name: 'B' });
    const real = client.bulkCreate!;
    let replaced = false;
    client.bulkCreate = async (items, opts) => {
      const out = await real(items, opts);
      const i = items.findIndex(it => it.element.id === a.id);
      if (!replaced && i >= 0) { replaced = true; out.items[i] = { ...out.items[i], status: 200 }; }
      return out;
    };

    const first = await engine.pushOnce();
    const f = first.failures.find(x => x.element_id === a.id)!;
    expect(f).toMatchObject({ status: 200, operation: 'create', message: REPLACED_HELD_LINE });
    expect(classifyFailure(f)).toBe('replaced_held');
    expect((await folder.getElement(a.id))!.server_updated_at).toBeFalsy();
    expect((await folder.getElement(b.id))!.server_updated_at).toBeTruthy();

    const before = client.calls.length;
    const second = await engine.pushOnce();
    const sentAgain = client.calls.slice(before).filter(c => c.method === 'create' || c.method === 'bulk');
    expect(sentAgain.length).toBe(1);
    expect(second.failures).toEqual([]);
    expect((await folder.getElement(a.id))!.server_updated_at).toBeTruthy();
  });
});
