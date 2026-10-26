/**
 * FolderStore.updateElementWith — the in-chain read-merge-write contract
 * (resilience gate HIGH-2): a patch computed from current state must
 * see the latest committed value, so a concurrent writer's fields are never
 * reverted from a stale snapshot.
 *
 * Run against MockFolderStore (which mirrors the real store's chain + read
 * gap); the FS impl shares the same writeChain machinery.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';

let folder: MockFolderStore;

beforeEach(async () => {
  folder = new MockFolderStore();
  folder.setClock(new MonotonicClock('2026-01-01T00:00:00.000Z').next);
  await folder.open(null);
});

describe('FolderStore.updateElementWith', () => {
  it('applies the patch computed from the on-disk element', async () => {
    await folder.createElement('character', { id: 'c1', name: 'Alice', abilities: ['a1'] });
    const result = await folder.updateElementWith('c1', existing => ({
      abilities: [...((existing as Record<string, unknown>).abilities as string[]), 'a2'],
    }));
    expect((result as Record<string, unknown>)?.abilities).toEqual(['a1', 'a2']);
    const onDisk = await folder.getElement('c1');
    expect((onDisk as Record<string, unknown>)?.abilities).toEqual(['a1', 'a2']);
  });

  it('returns null for a missing element without calling mutate', async () => {
    let called = false;
    const result = await folder.updateElementWith('ghost', () => { called = true; return {}; });
    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it('mutate returning null writes nothing and does not bump local_updated_at', async () => {
    const created = await folder.createElement('character', { id: 'c1', name: 'Alice' });
    const result = await folder.updateElementWith('c1', () => null);
    expect(result?.local_updated_at).toBe(created.local_updated_at);
    const onDisk = await folder.getElement('c1');
    expect(onDisk?.local_updated_at).toBe(created.local_updated_at);
  });

  it('a concurrent updateElement is not reverted (the TOCTOU lock)', async () => {
    await folder.createElement('character', { id: 'c1', name: 'Alice', abilities: ['a1'] });
    // Fire both without awaiting between them: the chain serializes, and the
    // second writer's mutate reads the FIRST writer's committed result — a
    // pre-chain-snapshot implementation loses 'user-add' here.
    const userAdd = folder.updateElement('c1', { abilities: ['a1', 'user-add'] } as never);
    const heal = folder.updateElementWith('c1', existing => {
      const have = (existing as Record<string, unknown>).abilities as string[];
      return have.includes('healed') ? null : { abilities: [...have, 'healed'] } as never;
    });
    await Promise.all([userAdd, heal]);
    const onDisk = await folder.getElement('c1');
    expect((onDisk as Record<string, unknown>)?.abilities).toEqual(['a1', 'user-add', 'healed']);
  });
});
