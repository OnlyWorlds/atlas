/**
 * The move keeps the source's lock (1.17 bout 4, contract §4.2 step 3, §4.4,
 * §9 invariant 7; S370 gate lens A A2 / M1-M2, lens B B4). Closing the source
 * store removed its lock, and another tab then opened the browser copy
 * mid-copy with no prompt: its edits were lost at the removal, or the removal
 * failed with its writable open. So the mover keeps the lock, heartbeating,
 * marked `moving`, and no other tab may take a moving lock, not even with the
 * take-over consent. Real FsFolderStore on fake-fs, two tab ids.
 */
import { describe, it, expect } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { ELockHeld, FsFolderStore } from '../../src/store/folder-store-fs';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const asDir = (d: FakeDirHandle) => d as unknown as FileSystemDirectoryHandle;

async function openA(): Promise<{ root: FakeDirHandle; a: FsFolderStore }> {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  const a = new FsFolderStore({ tabId: 'tab-a', disableHeartbeat: true });
  await a.open(asDir(root));
  return { root, a };
}

describe('the moving lock', () => {
  it('another tab cannot open a world being moved, even with the take-over consent', async () => {
    const { root, a } = await openA();
    await a.beginMove();
    for (const opts of [{}, { forceTakeLock: true }]) {
      const b = new FsFolderStore({ tabId: 'tab-b', disableHeartbeat: true, ...opts });
      const err = await b.open(asDir(root)).then(() => null, e => e);
      expect(err).toBeInstanceOf(ELockHeld);
      expect((err as ELockHeld).moving).toBe(true);
    }
    expect((await a.__debug_readLock())?.tab_id).toBe('tab-a');
  });

  it('the heartbeat keeps the lock moving', async () => {
    const { a } = await openA();
    await a.beginMove();
    await (a as unknown as { refreshHeartbeat(): Promise<void> }).refreshHeartbeat();
    expect(await a.__debug_readLock()).toMatchObject({ tab_id: 'tab-a', moving: true });
  });

  it('refuses edits while moving, and takes them again after endMove', async () => {
    const { a } = await openA();
    const el = await a.createElement('character', { name: 'Ana' } as never);
    await a.beginMove();
    await expect(a.updateElement(el.id, { name: 'Ana B' } as never)).rejects.toThrow(/being moved/);
    await a.endMove();
    expect((await a.__debug_readLock())?.moving).toBeUndefined();
    await expect(a.updateElement(el.id, { name: 'Ana B' } as never)).resolves.toBeTruthy();
  });

  it('a moving lock whose heartbeat went stale (the mover crashed) is taken as any stale lock', async () => {
    const { root } = await openA();
    root.put('.atlas/lock', j({ tab_id: 'tab-a', started_at: '2026-01-01T00:00:00.000Z', last_heartbeat: '2026-01-01T00:00:00.000Z', moving: true }));
    const b = new FsFolderStore({ tabId: 'tab-b', disableHeartbeat: true });
    await expect(b.open(asDir(root))).resolves.toBeUndefined();
    expect(await b.__debug_readLock()).toMatchObject({ tab_id: 'tab-b' });
    expect((await b.__debug_readLock())?.moving).toBeUndefined();
  });

  it('the same tab reopening after a crash mid-move is not locked out of its own world', async () => {
    const { root } = await openA();
    root.put('.atlas/lock', j({ tab_id: 'tab-a', started_at: new Date().toISOString(), last_heartbeat: new Date().toISOString(), moving: true }));
    const again = new FsFolderStore({ tabId: 'tab-a', disableHeartbeat: true });
    await expect(again.open(asDir(root))).resolves.toBeUndefined();
    expect((await again.__debug_readLock())?.moving).toBeUndefined();
  });

  it('closing the mover removes its lock (the step-7 order relies on it)', async () => {
    const { a } = await openA();
    await a.beginMove();
    const root = (a as unknown as { root: FakeDirHandle }).root;
    await a.close();
    expect(root.get('.atlas/lock')).toBeNull();
  });
});
