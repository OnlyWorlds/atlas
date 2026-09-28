/**
 * S361 (lane b M4): a busy (503 server_busy), rate-limited (429) or
 * unreachable server ends the push round after ONE request. Before, the loop
 * went on element by element, each waiting out keel's admission gate: 150
 * pending edits could hold the pill on "Saving" for minutes, then toast a
 * generic failure. Nothing pauses and no baseline moves; one retry is
 * scheduled after Retry-After.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine, isTransientError } from '../../src/sync/sync-engine';
import { OwV2Error } from '../../src/sync/ow-v2-client-adapter';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;

function busy(status: number, code: string, retryAfter: string | null): OwV2Error {
  return new OwV2Error(status, { type: 'api_error', code, message: 'try later' }, '', retryAfter);
}

beforeEach(async () => {
  vi.useRealTimers();
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  engine = new SyncEngine({ folder, client });
});

afterEach(() => engine.stop());

async function throwOnCreate(err: Error): Promise<void> {
  client.createElement = async () => { throw err; };
}

describe('a busy or unreachable server', () => {
  it('ends the round after one request, keeps every element pending, and says when it will retry', async () => {
    for (const name of ['A', 'B', 'C']) await folder.createElement('character', { name });
    let attempts = 0;
    client.createElement = async () => { attempts++; throw busy(503, 'server_busy', '12'); };

    const result = await engine.pushOnce();

    expect(attempts).toBe(1);
    expect(result.transient_blocked).toBe(true);
    expect(result.transient_reason).toBe('busy');
    expect(result.retry_after_ms).toBe(12_000);
    expect(result.auth_blocked).toBeFalsy();
    expect(engine.getState().kind).toBe('idle'); // not paused, not red
    expect(await folder.listLocallyChangedSince(null)).toHaveLength(3);
  });

  it('names a 429 as rate limiting', async () => {
    await folder.createElement('character', { name: 'A' });
    await throwOnCreate(busy(429, 'rate_limited', '900'));
    const result = await engine.pushOnce();
    expect(result.transient_reason).toBe('rate_limited');
    expect(result.retry_after_ms).toBe(900_000);
  });

  it('a sync round skips the pull behind a busy push', async () => {
    await folder.createElement('character', { name: 'A' });
    await throwOnCreate(new TypeError('Failed to fetch'));
    const result = await engine.syncNow();
    expect(result.transient_reason).toBe('offline');
    expect(result.pulled).toEqual({ creates: 0, updates: 0, deletes: 0 });
  });
});

describe('isTransientError / Retry-After', () => {
  it('classifies statuses and network failures, not auth', () => {
    expect(isTransientError(busy(503, 'server_busy', null))).toBe(true);
    expect(isTransientError(busy(429, 'rate_limited', null))).toBe(true);
    expect(isTransientError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransientError(new OwV2Error(401, { code: 'invalid_credentials' }, ''))).toBe(false);
    expect(isTransientError(new OwV2Error(400, { code: 'invalid_link' }, ''))).toBe(false);
  });

  it('parses Retry-After as seconds or an HTTP date', () => {
    expect(busy(503, 'server_busy', '30').retryAfterMs).toBe(30_000);
    const soon = new Date(Date.now() + 60_000).toUTCString();
    const ms = busy(503, 'server_busy', soon).retryAfterMs!;
    expect(ms).toBeGreaterThan(50_000);
    expect(ms).toBeLessThanOrEqual(60_000);
    expect(busy(503, 'server_busy', null).retryAfterMs).toBeNull();
  });
});
