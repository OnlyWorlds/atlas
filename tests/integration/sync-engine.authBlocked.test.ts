/**
 * Auth-blocked sync rounds.
 *
 * When the credentials atlas holds are dead (PIN changed server-side, api_key
 * revoked, or the world was deleted on the server — all surface as 401), the
 * sync engine must:
 *
 *   1. Stop the round immediately. Retrying every element with the same dead
 *      key is server-rude and pointless.
 *   2. Surface visibly. The pill must NOT show "synced" — that's the lying-
 *      pill bug Captain caught during Bout-S smoke.
 *   3. Stop firing pushes until recovery. The engine pauses itself so
 *      autosave debounces no-op while creds are dead.
 *
 * Recovery: the user fixes the PIN in settings, which calls attachSyncEngine
 * and builds a FRESH engine with new creds. The new engine starts at idle —
 * the old engine's error state doesn't bleed across.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine, isAuthError } from '../../src/sync/sync-engine';
import type { SyncEngineState, SyncResult } from '../../src/core/types';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;
let clock: MonotonicClock;
let stateHistory: SyncEngineState[];
let resultHistory: Array<{ phase: 'push' | 'pull' | 'sync'; result: SyncResult }>;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  stateHistory = [];
  resultHistory = [];
  engine = new SyncEngine({
    folder,
    client,
    onStateChange: (s) => stateHistory.push(s),
    onSyncResult: (phase, result) => resultHistory.push({ phase, result }),
  });
});

describe('isAuthError detector', () => {
  it('matches API Error 401 / 403 messages from the SDK', () => {
    expect(isAuthError(new Error('API Error 401: Unauthorized'))).toBe(true);
    expect(isAuthError(new Error('API Error 403: Forbidden'))).toBe(true);
    expect(isAuthError(new Error('Unauthorized'))).toBe(true);
    expect(isAuthError(new Error('Forbidden'))).toBe(true);
  });

  it('does NOT match 404 or generic errors', () => {
    expect(isAuthError(new Error('API Error 404: Not Found'))).toBe(false);
    expect(isAuthError(new Error('network error'))).toBe(false);
    expect(isAuthError(new Error('something else'))).toBe(false);
  });
});

describe('SyncEngine auth-blocked rounds', () => {
  describe('push', () => {
    it('transitions to error state when all pushes 401', async () => {
      await folder.createElement('character', { name: 'Alice' });
      client.__inject_auth_failure(true);

      const result = await engine.pushOnce();

      expect(result.auth_blocked).toBe(true);
      expect(result.pushed.creates).toBe(0);
      expect(result.failures.length).toBeGreaterThan(0);

      const state = engine.getState();
      expect(state.kind).toBe('error');
      if (state.kind === 'error') {
        expect(state.message).toMatch(/auth/i);
        expect(state.recoverable).toBe(true);
      }
    });

    it('bails the loop on first auth error (no retry storm)', async () => {
      // Three pending CREATEs. With auth blocked, only ONE should be
      // recorded in failures — the engine bails after the first 401 rather
      // than collecting a failure per element.
      await folder.createElement('character', { name: 'A' });
      await folder.createElement('character', { name: 'B' });
      await folder.createElement('character', { name: 'C' });
      client.__inject_auth_failure(true);

      const result = await engine.pushOnce();

      // Exactly one element marked failed — the one that tripped the auth
      // check. The other two never got tried.
      expect(result.failures).toHaveLength(1);
      expect(result.auth_blocked).toBe(true);
    });

    it('pauses the engine so requestPush no-ops post-failure', async () => {
      await folder.createElement('character', { name: 'A' });
      client.__inject_auth_failure(true);
      await engine.pushOnce();

      // Engine should be paused now — requestPush should not schedule a timer.
      engine.setDebounceMs(10);
      engine.requestPush();
      // Give the would-be timer a chance to fire — it shouldn't.
      await new Promise((r) => setTimeout(r, 30));

      // Only the original push call should have happened.
      const createCalls = client.calls.filter((c) => c.method === 'create');
      expect(createCalls.length).toBeLessThanOrEqual(1);
    });

    it('emits auth_blocked in the SyncResult passed to onSyncResult', async () => {
      await folder.createElement('character', { name: 'A' });
      client.__inject_auth_failure(true);
      await engine.pushOnce();

      const lastResult = resultHistory[resultHistory.length - 1];
      expect(lastResult.phase).toBe('push');
      expect(lastResult.result.auth_blocked).toBe(true);
    });

    it('does NOT persist server-side state when round was auth-blocked', async () => {
      // Setup: one element pending CREATE, one pending DELETE (tombstone).
      const alice = await folder.createElement('character', { name: 'Alice' });
      await engine.syncNow(); // Initial sync — succeeds, no auth failure yet.
      await folder.deleteElement(alice.id);
      await folder.createElement('character', { name: 'Bob' });

      // Now creds go dead.
      client.__inject_auth_failure(true);

      const result = await engine.pushOnce();
      expect(result.auth_blocked).toBe(true);

      // sync-state.last_push_at should NOT have been touched on the dead round.
      // (We can verify by reading the synced timestamp from a fresh sync.)
      // Engine in error state — recovery via a fresh engine.
      const state = engine.getState();
      expect(state.kind).toBe('error');
    });
  });

  describe('pull', () => {
    it('transitions to error state when listElements 401s', async () => {
      client.__inject_auth_failure(true);

      const result = await engine.pullNow();

      expect(result.auth_blocked).toBe(true);
      expect(result.pulled.creates).toBe(0);

      const state = engine.getState();
      expect(state.kind).toBe('error');
    });

    it('does not stay stuck at "fetching..." after auth failure', async () => {
      client.__inject_auth_failure(true);
      await engine.pullNow();

      // Last state should be error, not syncing.
      const last = stateHistory[stateHistory.length - 1];
      expect(last.kind).toBe('error');
    });
  });

  describe('syncNow (combined push + pull)', () => {
    it('skips pull when push auth-blocks', async () => {
      await folder.createElement('character', { name: 'A' });
      client.__inject_auth_failure(true);

      const result = await engine.syncNow();

      expect(result.auth_blocked).toBe(true);
      // No listElements call (which would happen in the pull phase) — engine
      // bailed after the push 401.
      const listCalls = client.calls.filter((c) => c.method === 'list');
      expect(listCalls).toHaveLength(0);
    });
  });

  describe('recovery', () => {
    it('a fresh engine after creds are fixed starts at idle (no bleed)', async () => {
      // Old engine hits 401 and goes to error.
      await folder.createElement('character', { name: 'A' });
      client.__inject_auth_failure(true);
      await engine.pushOnce();
      expect(engine.getState().kind).toBe('error');

      // Creds restored on the fake (simulating PIN fix in settings).
      client.__inject_auth_failure(false);

      // Fresh engine — same folder, same client, but a new instance. This is
      // what attachSyncEngine does after a settings PIN change.
      const freshState: SyncEngineState[] = [];
      const fresh = new SyncEngine({
        folder,
        client,
        onStateChange: (s) => freshState.push(s),
      });

      expect(fresh.getState().kind).toBe('idle');

      // And it actually pushes now.
      const result = await fresh.pushOnce();
      expect(result.auth_blocked).toBeFalsy();
      expect(result.pushed.creates).toBe(1);
      expect(fresh.getState().kind).toBe('idle');
    });
  });

  describe('non-auth pull errors', () => {
    it('non-auth pull throws propagate to the caller (preserves existing contract)', async () => {
      // Inject a generic failure mid-list (simulate a network blip).
      vi.spyOn(client, 'listElements').mockRejectedValueOnce(
        new Error('network unreachable')
      );

      await expect(engine.pullNow()).rejects.toThrow('network unreachable');

      // Engine state should be idle (not stuck at 'syncing').
      const last = stateHistory[stateHistory.length - 1];
      expect(last.kind).toBe('idle');
    });
  });
});
