/**
 * keel's door record read from the element itself (the trail; the feed serves none): asked once,
 * again once a minute old or once the copy moved past the read (once per copy), the listeners
 * told only when the answer moved, a refusal quiet.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { doorsNow, onDoorsChanged, refreshDoors, setDoorsClientFactoryForTests } from '../../src/sync/element-doors';
import type { WorldRegistryEntry } from '../../src/core/types';

let n = 0;
const entry = (): WorldRegistryEntry =>
  ({ id: `w-doors-${++n}`, state: 'api-linked', api: { world_id: `world-doors-${n}`, api_key: `key-${n}` } }) as unknown as WorldRegistryEntry;
const T1 = '2026-10-31T05:00:00Z';
const T2 = '2026-10-31T05:30:00Z';

afterEach(() => setDoorsClientFactoryForTests(null));

describe('refreshDoors', () => {
  it('asks once, keeps the answer a minute, then asks again; tells only when the answer moved', async () => {
    const answers: unknown[] = [
      { updated_at: T1, doors: { atlas: T1 } },
      { updated_at: T1, doors: { atlas: T1 } },
      { updated_at: T2, doors: { lantern: T2, atlas: T1 } },
    ];
    let calls = 0;
    setDoorsClientFactoryForTests(() => ({ get: async () => answers[calls++] as never }));
    const told: number[] = [];
    const stop = onDoorsChanged(() => told.push(calls));
    const e = entry();
    let t = 1_000;
    const clock = () => t;
    await Promise.all([refreshDoors(e, 'character', 'c1', T1, clock), refreshDoors(e, 'character', 'c1', T1, clock)]);
    expect(calls).toBe(1);
    expect(doorsNow(e, 'character', 'c1')).toMatchObject({ updated_at: T1, doors: { atlas: T1 } });
    expect(told).toEqual([1]);
    t += 30_000;
    await refreshDoors(e, 'character', 'c1', T1, clock);
    expect(calls).toBe(1);
    t += 31_000;
    await refreshDoors(e, 'character', 'c1', T1, clock);
    expect(calls).toBe(2);
    expect(told).toEqual([1]);
    t += 61_000;
    await refreshDoors(e, 'character', 'c1', T1, clock);
    expect(doorsNow(e, 'character', 'c1')).toMatchObject({ updated_at: T2, doors: { lantern: T2, atlas: T1 } });
    expect(told).toEqual([1, 3]);
    stop();
  });

  it('asks again at once when the copy moved past the read, once per copy', async () => {
    let calls = 0;
    setDoorsClientFactoryForTests(() => ({ get: async () => { calls++; return { updated_at: T1, doors: { atlas: T1 } } as never; } }));
    const e = entry();
    const clock = () => 5_000;
    await refreshDoors(e, 'character', 'c6', T1, clock);
    expect(calls).toBe(1);
    await refreshDoors(e, 'character', 'c6', T2, clock);
    expect(calls).toBe(2);
    // keel still answers the older time: no ask again for the same copy.
    await refreshDoors(e, 'character', 'c6', T2, clock);
    expect(calls).toBe(2);
  });

  it('a refusal or a client that throws leaves none, a body without doors says none, and none rejects', async () => {
    const e = entry();
    setDoorsClientFactoryForTests(() => ({ get: async () => { throw Object.assign(new Error('nope'), { status: 404 }); } }));
    await expect(refreshDoors(e, 'character', 'c2')).resolves.toBeUndefined();
    expect(doorsNow(e, 'character', 'c2')).toBeNull();
    setDoorsClientFactoryForTests(() => { throw new Error('no client'); });
    await expect(refreshDoors(e, 'character', 'c3')).resolves.toBeUndefined();
    expect(doorsNow(e, 'character', 'c3')).toBeNull();
    setDoorsClientFactoryForTests(() => ({ get: async () => ({ id: 'c4', name: 'A public view' }) as never }));
    await refreshDoors(e, 'character', 'c4');
    expect(doorsNow(e, 'character', 'c4')?.doors).toBeNull();
  });

  it('a line that left the page is let go when the next one listens, and never called', async () => {
    let answer = 0;
    setDoorsClientFactoryForTests(() => ({ get: async () => ({ updated_at: T1, doors: { atlas: `2026-10-31T05:00:0${answer++}Z` } }) as never }));
    const calls: string[] = [];
    let onPage = true;
    for (let i = 0; i < 200; i++) onDoorsChanged(() => calls.push('old'), () => false);
    onDoorsChanged(() => calls.push('live'), () => onPage);
    onDoorsChanged(() => { throw new Error('a broken line'); }, () => true);
    const after = onDoorsChanged(() => calls.push('after'), () => true);
    await refreshDoors(entry(), 'character', 'c7', T1, () => 9_000);
    expect(calls).toEqual(['live', 'after']);
    onPage = false;
    await refreshDoors(entry(), 'character', 'c8', T1, () => 9_000);
    expect(calls).toEqual(['live', 'after', 'after']);
    after();
  });

  it('asks nothing for a world that is not online', async () => {
    let calls = 0;
    setDoorsClientFactoryForTests(() => ({ get: async () => { calls++; return {} as never; } }));
    const local = { id: 'w-local', state: 'local' } as unknown as WorldRegistryEntry;
    await refreshDoors(local, 'character', 'c5');
    expect(calls).toBe(0);
    expect(doorsNow(local, 'character', 'c5')).toBeNull();
  });
});
