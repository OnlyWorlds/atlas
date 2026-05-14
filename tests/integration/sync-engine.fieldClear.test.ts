/**
 * Field-clear propagation contract.
 *
 * When the user clears a field through the UI (× on a single-link chip, blank
 * in a text/number popover), the intent must reach the server: subsequent
 * pulls or other clients must see the field as cleared.
 *
 * The trap: passing `undefined` as the "cleared" sentinel doesn't work. The
 * value gets dropped at write time (JSON.stringify omits undefined keys), and
 * the resulting PATCH body omits the field too. Real OW interprets a missing
 * key as "no change to this field," so the server retains the old value.
 *
 * The contract: use `null` (relations, numbers) or `''` (text). These
 * preserve through to the wire, and the server clears the field.
 *
 * These tests verify the contract at the engine layer. The UI is responsible
 * for passing the right sentinel — element-detail.ts:289 for single-link
 * unlink, field-edit-popover.ts for text/number clear.
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
  engine = new SyncEngine({ folder, client });
});

describe('SyncEngine field-clear contract', () => {
  describe('the trap — undefined does NOT propagate clears', () => {
    it('clearing a single-link to undefined leaves server unchanged', async () => {
      // Setup: server + local both have birthplace = 'loc-1', synced.
      const char = await folder.createElement('character', {
        name: 'Alice',
        birthplace: 'loc-1',
      });
      await engine.syncNow();
      expect(client.__server_get('character', char.id)?.birthplace).toBe('loc-1');

      // UI's buggy clear path: pass undefined.
      await folder.updateElement(char.id, { birthplace: undefined });

      const result = await engine.syncNow();
      expect(result.pushed.updates).toBe(1);

      // Server still has the old relation — the clear was silently lost.
      // This documents the bug the H1/H2 fix is designed to prevent.
      expect(client.__server_get('character', char.id)?.birthplace).toBe('loc-1');
    });

    it('clearing a text field to undefined leaves server unchanged', async () => {
      const char = await folder.createElement('character', {
        name: 'Bob',
        description: 'old description',
      });
      await engine.syncNow();
      expect(client.__server_get('character', char.id)?.description).toBe('old description');

      await folder.updateElement(char.id, { description: undefined });
      await engine.syncNow();

      expect(client.__server_get('character', char.id)?.description).toBe('old description');
    });
  });

  describe('the contract — null clears a single-link on the server', () => {
    it('clearing birthplace via null propagates to server', async () => {
      const char = await folder.createElement('character', {
        name: 'Carol',
        birthplace: 'loc-1',
      });
      await engine.syncNow();
      expect(client.__server_get('character', char.id)?.birthplace).toBe('loc-1');

      // UI's correct clear path: pass null.
      await folder.updateElement(char.id, { birthplace: null });

      const result = await engine.syncNow();
      expect(result.pushed.updates).toBe(1);

      // Server now has null — clear propagated.
      expect(client.__server_get('character', char.id)?.birthplace).toBeNull();
    });

    it('the push body carries birthplace: null (not omitted)', async () => {
      const char = await folder.createElement('character', {
        name: 'Dora',
        birthplace: 'loc-1',
      });
      await engine.syncNow();
      const callsBeforeClear = client.calls.length;

      await folder.updateElement(char.id, { birthplace: null });
      await engine.syncNow();

      const updateCalls = client.calls
        .slice(callsBeforeClear)
        .filter((c) => c.method === 'update');
      expect(updateCalls).toHaveLength(1);
      const updateCall = updateCalls[0];
      if (updateCall.method !== 'update') throw new Error('expected update');
      expect(updateCall.body).toHaveProperty('birthplace');
      expect(updateCall.body.birthplace).toBeNull();
    });
  });

  describe('the contract — empty string clears a text field on the server', () => {
    it('clearing description via empty string propagates to server', async () => {
      const char = await folder.createElement('character', {
        name: 'Eve',
        description: 'old description',
      });
      await engine.syncNow();
      expect(client.__server_get('character', char.id)?.description).toBe('old description');

      // UI's correct text-clear path: pass empty string.
      await folder.updateElement(char.id, { description: '' });

      await engine.syncNow();

      expect(client.__server_get('character', char.id)?.description).toBe('');
    });
  });

  describe('the contract — null clears a number field on the server', () => {
    it('clearing a number via null propagates to server', async () => {
      const char = await folder.createElement('character', {
        name: 'Frank',
        age: 42,
      });
      await engine.syncNow();
      expect(client.__server_get('character', char.id)?.age).toBe(42);

      await folder.updateElement(char.id, { age: null });
      await engine.syncNow();

      expect(client.__server_get('character', char.id)?.age).toBeNull();
    });
  });

  describe('regression — multi-link clear via empty array still works', () => {
    it('clearing a multi-link via [] propagates to server', async () => {
      const char = await folder.createElement('character', {
        name: 'Grace',
        species: ['species-1', 'species-2'],
      });
      await engine.syncNow();
      expect(client.__server_get('character', char.id)?.species).toEqual(['species-1', 'species-2']);

      // Multi-link clear already works (empty array is preserved by JSON).
      await folder.updateElement(char.id, { species: [] });
      await engine.syncNow();

      expect(client.__server_get('character', char.id)?.species).toEqual([]);
    });
  });
});
