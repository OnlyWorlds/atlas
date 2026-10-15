/**
 * #347: a linked world's roster is read once per world and session, and only
 * when asked; a failure is kept for a minute so a page that repaints on every
 * notify never asks keel again and again; a new key reads afresh.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OwV2Client, type OwMember } from '@onlyworlds/sdk';
import { rosterFor, rosterNow, resetRosterCache } from '../../src/sync/world-roster';
import type { WorldRegistryEntry } from '../../src/core/types';

const rows: OwMember[] = [{ id: 'm1', kind: 'agent', role: 'contributor', character: null, status: 'active', name: 'Skeld' }];
const linked = (key = 'ow_k_1') =>
  ({ id: 'w1', name: 'W', state: 'api-linked', api: { world_id: 'srv1', api_key: key } }) as unknown as WorldRegistryEntry;

beforeEach(() => {
  resetRosterCache();
  vi.restoreAllMocks();
});

describe('the world roster', () => {
  it('reads once, and answers from memory after', async () => {
    const spy = vi.spyOn(OwV2Client.prototype, 'members').mockResolvedValue(rows);
    expect(rosterNow(linked())).toBeNull();
    const [a, b] = await Promise.all([rosterFor(linked()), rosterFor(linked())]);
    expect(a).toEqual(rows);
    expect(b).toEqual(rows);
    expect(await rosterFor(linked())).toEqual(rows);
    expect(rosterNow(linked())).toEqual(rows);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a local world asks nothing', async () => {
    const spy = vi.spyOn(OwV2Client.prototype, 'members').mockResolvedValue(rows);
    const local = { id: 'w2', name: 'L', state: 'local-only' } as unknown as WorldRegistryEntry;
    expect(await rosterFor(local)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('a failure waits a minute before it asks again', async () => {
    const spy = vi.spyOn(OwV2Client.prototype, 'members').mockRejectedValue(new TypeError('Failed to fetch'));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    let now = 1_000_000;
    expect(await rosterFor(linked(), () => now)).toBeNull();
    now += 59_000;
    expect(await rosterFor(linked(), () => now)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    now += 2_000;
    spy.mockResolvedValue(rows);
    expect(await rosterFor(linked(), () => now)).toEqual(rows);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a read that never answers gives up, and is asked again after the wait (the S415 gate)', async () => {
    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(OwV2Client.prototype, 'members').mockReturnValue(new Promise<OwMember[]>(() => {}));
      vi.spyOn(console, 'info').mockImplementation(() => {});
      let now = 5_000_000;
      const first = rosterFor(linked(), () => now);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await first).toBeNull();
      now += 61_000;
      spy.mockResolvedValue(rows);
      expect(await rosterFor(linked(), () => now)).toEqual(rows);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a new key reads afresh', async () => {
    const spy = vi.spyOn(OwV2Client.prototype, 'members').mockResolvedValue(rows);
    await rosterFor(linked('ow_k_1'));
    expect(rosterNow(linked('ow_k_2'))).toBeNull();
    await rosterFor(linked('ow_k_2'));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
