/**
 * SyncResult.auth_reason — refines auth_blocked when the server's typed error
 * distinguished a REVOKED key from a plain bad credential (gate R4, 2026-07-13).
 *
 * A revoked minted key (account mode) wants "reopen it from the sidebar" copy,
 * not "check your PIN" — so the engine reads the thrown error's `code` and
 * threads `key_revoked` into the round result. A message-only 401 (the historic
 * shape) stays untyped, so auth_reason is left undefined and the default
 * "verify pin" pill copy applies.
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

describe('SyncEngine push auth_reason', () => {
  it('sets auth_reason=key_revoked when the 401 carries that typed code', async () => {
    await folder.createElement('character', { name: 'Alice' });
    client.__inject_auth_failure(true, 'key_revoked');

    const result = await engine.pushOnce();

    expect(result.auth_blocked).toBe(true);
    expect(result.auth_reason).toBe('key_revoked');

    // The pill copy branches on the same signal.
    const state = engine.getState();
    expect(state.kind).toBe('error');
    if (state.kind === 'error') {
      expect(state.message).toMatch(/revoked/i);
    }
  });

  it('tells a key keel no longer knows from a refused PIN', async () => {
    await folder.createElement('character', { name: 'Cleo' });
    client.__inject_auth_failure(true, 'invalid_credentials');
    const unknown = await engine.pushOnce();
    expect(unknown.auth_reason).toBe('key_unknown');
    let state = engine.getState();
    expect(state.kind === 'error' && state.message).toMatch(/no longer knows this world's key/);

    const again = new SyncEngine({ folder, client });
    client.__inject_auth_failure(true, 'invalid_credentials', 'API-Pin');
    const pin = await again.pushOnce();
    expect(pin.auth_reason).toBe('pin');
    state = again.getState();
    expect(state.kind === 'error' && state.message).toMatch(/did not accept your PIN/);
    expect(state.kind === 'error' && state.message).not.toMatch(/Unlink/);
  });

  it('leaves auth_reason undefined for a plain (untyped) 401', async () => {
    await folder.createElement('character', { name: 'Bob' });
    client.__inject_auth_failure(true); // no code — historic message-only shape

    const result = await engine.pushOnce();

    expect(result.auth_blocked).toBe(true);
    expect(result.auth_reason).toBeUndefined();

    const state = engine.getState();
    expect(state.kind).toBe('error');
    if (state.kind === 'error') {
      // Default guidance, not the revoked-key copy.
      expect(state.message).toMatch(/Check your PIN in Settings/);
    }
  });
});
