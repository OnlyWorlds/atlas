/**
 * A world synced through a member's seat.
 *
 * keel refuses a contributor's change to someone else's element (403
 * `not_author`) and any member's change to the world's own settings (403
 * `owner_only`). Both are about one item, not the key: the round goes on,
 * the engine stays out of the red, and each refusal is a `not_yours` failure.
 * Before #104 every 403 read as a dead key: one edit to a co-writer's
 * character froze the whole world's sync.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { classifyFailure, describeFailures } from '../../src/sync/sync-failure-copy';
import { classifyError, problemFor } from '../../src/core/problems';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let clock: MonotonicClock;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
});

/** Two characters already on the server and in sync, made by someone else. */
async function twoSyncedCharacters(engine: SyncEngine): Promise<{ a: string; b: string }> {
  const a = await folder.createElement('character', { name: 'Fluffington' });
  const b = await folder.createElement('character', { name: 'Grimble' });
  await engine.syncNow();
  return { a: a.id, b: b.id };
}

describe('a contributor seat', () => {
  it('pushes its own work and leaves someone else\'s element as a not_yours failure, never an auth bail', async () => {
    const engine = new SyncEngine({ folder, client });
    const { a } = await twoSyncedCharacters(engine);
    client.__as_member_seat('contributor');

    await folder.updateElement(a, { description: 'edited here' });
    const mine = await folder.createElement('character', { name: 'Mine' });
    const result = await engine.pushOnce();

    expect(result.auth_blocked).toBeFalsy();
    expect(engine.getState().kind).not.toBe('error');
    expect(result.pushed.creates).toBe(1);
    expect(result.failures).toHaveLength(1);
    const f = result.failures[0];
    expect(f.element_id).toBe(a);
    expect(f.code).toBe('not_author');
    expect(classifyFailure(f)).toBe('not_yours');
    expect(describeFailures(result.failures)).toMatch(/made by someone else/);

    // Its own element stays changeable: a second edit pushes.
    await folder.updateElement(mine.id, { description: 'mine, edited' });
    const again = await engine.pushOnce();
    expect(again.auth_blocked).toBeFalsy();
    expect(again.pushed.updates).toBe(1);
  });

  it('a refused delete keeps the round going', async () => {
    const engine = new SyncEngine({ folder, client });
    const { a, b } = await twoSyncedCharacters(engine);
    client.__as_member_seat('contributor');

    await folder.deleteElement(a);
    await folder.updateElement(b, { description: 'also not mine' });
    const result = await engine.pushOnce();

    expect(result.auth_blocked).toBeFalsy();
    expect(result.failures.map(f => f.code).sort()).toEqual(['not_author', 'not_author']);
  });
});

describe('any member seat and the world\'s own settings', () => {
  it('owner_only on PATCH /world is a world failure; the elements still push', async () => {
    const engine = new SyncEngine({ folder, client });
    await engine.syncNow(); // seed the meta baseline
    client.__as_member_seat('co_builder');

    await folder.writeWorldMeta({ description: 'changed here' });
    await folder.createElement('character', { name: 'New' });
    const result = await engine.syncNow();

    expect(result.auth_blocked).toBeFalsy();
    expect(engine.getState().kind).not.toBe('error');
    expect(result.pushed.creates).toBe(1);
    const world = result.failures.find(f => f.type === 'world');
    expect(world?.code).toBe('owner_only');
    expect(classifyFailure(world!)).toBe('not_yours');
    expect(describeFailures(result.failures)).toMatch(/only its owner can change them/);
  });

  it('a co-builder may change anyone\'s element', async () => {
    const engine = new SyncEngine({ folder, client });
    const { a } = await twoSyncedCharacters(engine);
    client.__as_member_seat('co_builder');
    await folder.updateElement(a, { description: 'a co-builder may' });
    const result = await engine.pushOnce();
    expect(result.failures).toEqual([]);
    expect(result.pushed.updates).toBe(1);
  });
});

describe('the problem sentence for a member refusal', () => {
  it('is its own kind, not a key or PIN problem', () => {
    const err = Object.assign(new Error('API Error 403'), { status: 403, code: 'not_author', param: null });
    expect(classifyError(err)).toBe('not-yours');
    expect(problemFor(err, { doing: 'saving' }).sentence).toMatch(/someone else made this/);
    const owner = Object.assign(new Error('API Error 403'), { status: 403, code: 'owner_only', param: null });
    expect(problemFor(owner, { doing: 'saving' }).sentence).toMatch(/Only the world's owner/);
    const readOnly = Object.assign(new Error('API Error 403'), { status: 403, code: 'permission_error', param: null });
    expect(classifyError(readOnly)).toBe('auth');
  });
});
