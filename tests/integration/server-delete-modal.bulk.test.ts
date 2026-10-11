/**
 * #122 (S390): the review modal's side of "Delete all locally", in jsdom.
 * Promoted from the S390 gate's probes (Forge/Notes/2026-10-11-s390-gate/):
 * F2, an outside edit the live folder calls "not synced" counts as edited
 * here too; F3, a run owns the dialog until it ends.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { patchSlice } from '../../src/core/state';

const ref: { engine: SyncEngine | null; folder: MockFolderStore | null } = { engine: null, folder: null };
vi.mock('../../src/sync/sync-attach', () => ({
  getCurrentSyncEngine: () => ref.engine,
  getCurrentSyncFolder: () => ref.folder,
}));
const disk: { notSynced: Set<string> } = { notSynced: new Set() };
vi.mock('../../src/core/live-folder', () => ({
  getDiskNotice: () => ({ worldId: 'w1', notSynced: disk.notSynced }),
}));

import { ServerDeleteReviewModal } from '../../src/ui/server-delete-modal';

if (typeof (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape !== 'function') {
  (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = { escape: (s: string) => s };
}

const toasts = new Proxy({}, { get: () => () => undefined }) as never;

/** Three synced characters, all deleted on the server and recorded for review. */
async function world(): Promise<{ engine: SyncEngine; folder: MockFolderStore }> {
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  const folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  const client = new FakeOwApiClient();
  client.setClock(clock.next);
  const engine = new SyncEngine({ folder, client });
  for (const [id, name] of [['c1', 'Alice'], ['c2', 'Bob'], ['c3', 'Cora']]) {
    await client.createElement('character', { id, name, type: 'character' });
  }
  await engine.syncNow();
  for (const id of ['c1', 'c2', 'c3']) await client.deleteElement('character', id);
  await engine.pullNow();
  ref.engine = engine;
  ref.folder = folder;
  return { engine, folder };
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };

beforeEach(() => {
  document.body.innerHTML = '';
  disk.notSynced = new Set();
  patchSlice('active', { worldId: 'w1' } as never);
});
afterEach(() => { ref.engine = null; ref.folder = null; });

describe('server-delete review: Delete all locally', () => {
  it('an outside edit the live folder marks not synced is listed as edited and kept (gate F2)', async () => {
    const { folder } = await world();
    disk.notSynced = new Set(['c3']); // its stamps read clean; the sidebar says "not synced"
    await new ServerDeleteReviewModal(toasts).open();
    const first = $('[data-server-delete-id]')!;
    expect(first.dataset.serverDeleteId).toBe('c3');
    expect(first.hasAttribute('data-unsynced')).toBe(true);
    $('[data-action="bulk-delete"]')!.click();
    $('[data-action="bulk-confirm"]')!.click();
    await flush();
    expect(await folder.getElement('c3')).not.toBeNull();
    expect(await folder.getElement('c1')).toBeNull();
  });

  it('a run owns the dialog: boxes and buttons wait, and a tick cannot start a second run (gate F3)', async () => {
    const { engine, folder } = await world();
    await folder.updateElement('c2', { description: 'mine' });
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    const orig = engine.deleteServerDeletesLocally.bind(engine);
    let calls = 0;
    engine.deleteServerDeletesLocally = async (rows) => { calls++; await held; return orig(rows); };
    await new ServerDeleteReviewModal(toasts).open();
    $('[data-action="bulk-delete"]')!.click();
    $('[data-action="bulk-confirm"]')!.click();
    await flush();

    const box = $<HTMLInputElement>('input[data-role="include"]')!;
    expect(box.disabled).toBe(true);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect($<HTMLButtonElement>('[data-action="bulk-delete"]')).toBeNull(); // the footer was not redrawn
    expect($<HTMLButtonElement>('[data-action="bulk-confirm"]')!.disabled).toBe(true);

    release();
    await flush();
    expect(calls).toBe(1);
    expect((await folder.getElement('c2'))!.description).toBe('mine');
  });
});
