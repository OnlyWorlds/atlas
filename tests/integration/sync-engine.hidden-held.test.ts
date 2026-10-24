/**
 * Folder spec §4.8 on the push (conv. 170). keel #587, probed live S461
 * (`Notes/ui-snapshots/2026-10-23-s461/probe-48.log`): a create carrying
 * `hidden: true` from the owner or a co-builder makes it hidden; from anyone
 * else it is 403 `hidden_not_allowed` and nothing is made, single or as a
 * `/bulk` slot (an atomic batch then makes nothing). So:
 * - a key that can hide sends the mark on the create;
 * - a key that cannot holds the hidden element here, with what is anchored on
 *   it, never sent and never a failure, said once; links to it stay in the copy;
 * - a raise sends them;
 * - keel's 403 when the role was unknown is a hold, never a dead key;
 * - a hidden element here whose id OnlyWorlds shows is never adopted, so its
 *   content never goes up onto what every member sees (the S461 gate's F2).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let clock: MonotonicClock;

const ADA = '00000000-0000-4000-8000-0000000000b1';
const WREN = '00000000-0000-4000-8000-0000000000b2';
const MAP = '00000000-0000-4000-8000-0000000000b3';
const PIN = '00000000-0000-4000-8000-0000000000b4';
const DOCK = '00000000-0000-4000-8000-0000000000b5';

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  client.__enable_changes();
});

/** Wren hidden; Ada links to her; a pin of Wren on a map; the dock is plain. */
async function folderWithAHiddenOne(): Promise<void> {
  await folder.createElement('character', { id: WREN, name: 'Wren', description: 'The traitor.', hidden: true } as never);
  await folder.createElement('character', { id: ADA, name: 'Ada', friends: [WREN] } as never);
  await folder.createElement('map', { id: MAP, name: 'Harbour chart' } as never);
  await folder.createElement('pin', { id: PIN, name: 'Wren', map_id: MAP, element_id: WREN, element_type: 'character', x: 1, y: 1 } as never);
  await folder.createElement('location', { id: DOCK, name: 'The dock' } as never);
}

function asContributor(): void {
  client.keyRole = 'contributor';
  client.__as_member_seat('contributor');
}

const sentIds = () => client.calls.filter(c => c.method === 'create').map(c => (c.body as { id?: string }).id);

for (const bulk of [false, true]) {
  describe(bulk ? 'through /bulk' : 'one create at a time', () => {
    beforeEach(() => { if (bulk) client.__enable_bulk(true); });

    it('a key that can hide sends the mark on the create', async () => {
      await folderWithAHiddenOne();
      const r = await new SyncEngine({ folder, client }).syncNow();
      expect(r.failures).toEqual([]);
      expect(r.hidden_held_ids).toBeUndefined();
      const wren = (await client.listElements('character')).find(e => e.id === WREN) as Record<string, unknown>;
      expect(wren.hidden).toBe(true);
      expect((await folder.getElement(WREN))!.server_updated_at).toBeTruthy();
    });

    it('a contributor holds it here with its pin, sends the rest, the link stays in the copy, said once', async () => {
      asContributor();
      await folderWithAHiddenOne();
      const engine = new SyncEngine({ folder, client });
      const r = await engine.syncNow();
      expect(r.auth_blocked).toBeFalsy();
      expect(r.failures).toEqual([]);
      expect(r.hidden_held_ids).toEqual([WREN]);
      expect(sentIds()).not.toContain(WREN);
      expect(sentIds()).not.toContain(PIN);
      const ada = (await client.listElements('character')).find(e => e.id === ADA) as Record<string, unknown>;
      expect(ada).toBeTruthy();
      expect(ada.friends ?? []).not.toContain(WREN);
      expect(((await folder.getElement(ADA)) as unknown as Record<string, unknown>).friends).toEqual([WREN]);
      expect((await client.listElements('location')).map(e => e.id)).toEqual([DOCK]);
      expect(new Set((await folder.readSyncState()).hidden_held)).toEqual(new Set([WREN, PIN]));
      expect((await folder.getElement(WREN))!.server_updated_at).toBeFalsy();

      // The next round sends nothing for them, and nothing fails.
      client.calls = [];
      const r2 = await engine.syncNow();
      expect(r2.failures).toEqual([]);
      expect(sentIds()).toEqual([]);
      // A pull of Ada (someone else's edit) keeps the copy's link to the held one.
      await client.updateElement('character', ADA, { description: 'Edited online.' });
      await engine.syncNow();
      expect(((await folder.getElement(ADA)) as unknown as Record<string, unknown>).friends).toEqual([WREN]);
    });

    it('a raise to co-builder sends them, hidden, and the hold empties', async () => {
      asContributor();
      await folderWithAHiddenOne();
      const engine = new SyncEngine({ folder, client });
      await engine.syncNow();
      client.keyRole = 'co_builder';
      client.__as_member_seat('co_builder');
      const r = await engine.syncNow();
      expect(r.failures).toEqual([]);
      const wren = (await client.listElements('character')).find(e => e.id === WREN) as Record<string, unknown>;
      expect(wren.hidden).toBe(true);
      expect((await client.listElements('pin')).map(e => e.id)).toEqual([PIN]);
      expect(((await client.listElements('pin'))[0] as Record<string, unknown>).element_id).toBe(WREN);
      expect((await folder.readSyncState()).hidden_held ?? []).toEqual([]);
    });

    it('keel\'s 403 while the role is unknown is a hold, never a dead key', async () => {
      client.__as_member_seat('contributor');
      client.meFails = true;
      await folderWithAHiddenOne();
      const r = await new SyncEngine({ folder, client }).syncNow();
      expect(r.auth_blocked).toBeFalsy();
      expect(r.hidden_held_ids).toEqual([WREN]);
      expect(r.failures.filter(f => f.element_id === WREN)).toEqual([]);
      expect((await client.listElements('location')).map(e => e.id)).toEqual([DOCK]);
      expect((await client.listElements('character')).map(e => e.id)).not.toContain(WREN);
    });
  });
}

describe('a hidden element here whose id OnlyWorlds shows', () => {
  it('is never adopted while the key cannot hide it there (the role unread), so its content never goes up; said, and the same next round', async () => {
    // The owner's or a co-builder's key hides it there first and adopts (conv. 173, `sync-engine.hide-online.test.ts`).
    client.meFails = true;
    await client.createElement('character', { id: WREN, name: 'Wren', description: 'A sailor.' });
    await folder.createElement('character', { id: WREN, name: 'Wren', description: 'The traitor.', hidden: true } as never);
    const engine = new SyncEngine({ folder, client });
    const r = await engine.syncNow();
    expect(r.hidden_shown_ids).toEqual([WREN]);
    expect((await folder.getElement(WREN))!.server_updated_at).toBeFalsy();
    const r2 = await engine.syncNow();
    expect(client.calls.filter(c => c.method === 'update')).toEqual([]);
    expect(r2.hidden_shown_ids).toEqual([WREN]);
    const server = (await client.listElements('character')).find(e => e.id === WREN) as Record<string, unknown>;
    expect(server.description).toBe('A sailor.');
  });

  it('once hidden there too, it is adopted as any other', async () => {
    await client.createElement('character', { id: WREN, name: 'Wren', description: 'A sailor.', hidden: true });
    await folder.createElement('character', { id: WREN, name: 'Wren', description: 'The traitor.', hidden: true } as never);
    const r = await new SyncEngine({ folder, client }).syncNow();
    expect(r.hidden_shown_ids).toBeUndefined();
  });
});
