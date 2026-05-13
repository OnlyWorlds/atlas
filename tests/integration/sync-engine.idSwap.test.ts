/**
 * Server-assigned id on CREATE — engine swaps local id + rewrites references.
 *
 * Real OW server (as of 2026-05) silently replaces client-sent v4 UUIDs with
 * its own v7 UUIDs on CREATE. Without the swap, subsequent UPDATEs that
 * reference the local element via foreign-key would 400 with "Invalid FK".
 *
 * Covers:
 *   - response.id !== local.id triggers id swap (delete old + write new).
 *   - References in OTHER local elements get rewritten to the new id.
 *   - Old local file is removed silently (no tombstone — no server DELETE).
 *   - The next UPDATE for a referencing element uses the new id correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

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
  client.assignServerIds = true; // simulate real OW
  engine = new SyncEngine({ folder, client });
});

describe('id-swap on CREATE when server assigns its own id', () => {
  it('swaps local id to server id + removes old file silently', async () => {
    const local = await folder.createElement('location', { name: 'Bag End' });
    const localId = local.id;

    await engine.syncNow();

    // Old local file gone.
    expect(await folder.getElement(localId)).toBeNull();
    // No tombstone for the old id (silent removal).
    const tombs = await folder.listTombstonesSince(null);
    expect(tombs.find(t => t.id === localId)).toBeUndefined();
    // Local has the element at the SERVER's id now.
    const allLocal = await folder.listElements();
    expect(allLocal).toHaveLength(1);
    const onlyLocal = allLocal[0];
    expect(onlyLocal.id).not.toBe(localId);
    expect(onlyLocal.name).toBe('Bag End');
    expect(onlyLocal.server_updated_at).toBeTruthy();
    // Server has the element under its own id.
    expect(client.__server_count('location')).toBe(1);
    expect(client.__server_get('location', onlyLocal.id)?.name).toBe('Bag End');
  });

  it('rewrites foreign-key references in OTHER local elements after swap', async () => {
    const loc = await folder.createElement('location', { name: 'Shire' });
    await folder.createElement('character', { name: 'Frodo', birthplace: loc.id });

    await engine.syncNow();

    // Find the post-swap location id (server-assigned).
    const allLocal = await folder.listElements();
    const newLoc = allLocal.find(e => e.name === 'Shire')!;
    expect(newLoc.id).not.toBe(loc.id);

    // Frodo's birthplace was rewritten to point at the new id.
    const frodo = allLocal.find(e => e.name === 'Frodo')!;
    expect(frodo.birthplace).toBe(newLoc.id);
    expect(frodo.birthplace).not.toBe(loc.id);
  });

  it('rewrites multi-link foreign-key references after swap', async () => {
    const hobbit = await folder.createElement('species', { name: 'Hobbit' });
    const elf = await folder.createElement('species', { name: 'Elf' });
    await folder.createElement('character', {
      name: 'Half-elven',
      species: [hobbit.id, elf.id, 'untouched-id'],
    });

    await engine.syncNow();

    const allLocal = await folder.listElements();
    const newHobbit = allLocal.find(e => e.name === 'Hobbit')!;
    const newElf = allLocal.find(e => e.name === 'Elf')!;
    const char = allLocal.find(e => e.name === 'Half-elven')!;

    expect(char.species).toEqual([newHobbit.id, newElf.id, 'untouched-id']);
  });

  it('sequential push: CREATE then UPDATE that references the new server id', async () => {
    // Push CREATE for Location.
    const loc = await folder.createElement('location', { name: 'Bree' });
    const localLocId = loc.id;
    await engine.syncNow();

    const newLocId = (await folder.listElements()).find(e => e.name === 'Bree')!.id;
    expect(newLocId).not.toBe(localLocId);

    // Now CREATE Character referencing the swapped location id.
    await folder.createElement('character', { name: 'Strider', birthplace: newLocId });
    await engine.syncNow();

    // Server has both, character's body referenced the SERVER location id.
    const charsOnServer = await client.listElements('character');
    expect(charsOnServer).toHaveLength(1);
    expect((charsOnServer[0] as Record<string, unknown>).birthplace_id ?? charsOnServer[0].birthplace).toBe(newLocId);
  });

  it('no swap when response.id matches local.id (server preserved the client uuid)', async () => {
    client.assignServerIds = false; // server preserves the client uuid path
    const loc = await folder.createElement('location', { name: 'Hobbiton' });
    const before = loc.id;

    await engine.syncNow();

    const after = await folder.getElement(before);
    expect(after).not.toBeNull();
    expect(after!.id).toBe(before);
    expect(after!.server_updated_at).toBeTruthy();
  });
});
