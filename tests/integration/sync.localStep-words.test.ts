/**
 * A disk failure after OnlyWorlds answered carries the step that failed, so
 * Settings and the element's mark say what is true: OnlyWorlds has a create
 * Atlas could not note, and has a delete Atlas could not clear. Before, the
 * words read the operation alone, so a delete OnlyWorlds already had read
 * "Atlas could not write it", and every such failure said "Atlas tries again
 * by itself" though only a busy file arms a timed retry.
 *
 * Same harness as `sync.heldFile.pull.test.ts`: the real FsFolderStore,
 * SyncEngine and v2 adapter against the MSW keel.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { SyncEngine } from '../../src/sync/sync-engine';
import { noteRoundIssues, issuesFor, __resetSyncIssues } from '../../src/sync/sync-issues';
import { syncIssueLine } from '../../src/middle/settings-world';

const V2 = 'https://test-ow.local/api/v2';
const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 10, 18, 1, 0, t++)).toISOString();

let adapter: OwV2ClientAdapter;
const engines: SyncEngine[] = [];
beforeEach(() => {
  const server = statefulV2Handlers({ baseUrl: V2, clock });
  mswServer.use(...server.handlers);
  adapter = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: V2 });
});
afterEach(() => {
  for (const e of engines.splice(0)) e.stop?.();
  __resetSyncIssues();
});

async function world() {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  root.put('elements/character/.keep', '');
  const store = new FsFolderStore({ clock, tabId: 't', disableHeartbeat: true, forceTakeLock: true });
  await store.open(root as unknown as FileSystemDirectoryHandle);
  await store.listElements();
  await store.awaitTidies();
  const engine = new SyncEngine({ folder: store, client: adapter });
  engines.push(engine);
  return { store, engine };
}

/** A refusal that is not a busy file: nothing arms a timed retry for it. */
const denied = () => Object.assign(new Error('denied'), { name: 'NotAllowedError' });

describe('a disk failure after OnlyWorlds answered says which step failed', () => {
  it('a create OnlyWorlds took, not noted here: OnlyWorlds has it, tried again with the next save', async () => {
    const { store, engine } = await world();
    await store.createElement('character', { name: 'Aldric' });
    const real = store.stampServerUpdatedAt.bind(store);
    store.stampServerUpdatedAt = async () => { throw denied(); };
    const r = await engine.pushOnce();
    store.stampServerUpdatedAt = real;
    const f = r.failures.find(x => x.type === 'character')!;
    expect(f).toMatchObject({ operation: 'create', source: 'disk', local_step: 'note' });
    expect(r.pushed.creates).toBe(0);
    expect((await store.listLocallyChangedSince(null)).map(e => e.type)).toContain('character');
    noteRoundIssues('w', 'push', r);
    expect(syncIssueLine(issuesFor('w')[0], 'folder'))
      .toBe('OnlyWorlds has it, but Atlas could not note that in the folder. Atlas tries again with your next save.');
  });

  it('an edit OnlyWorlds took, not noted here: OnlyWorlds has it, and it stays to send again', async () => {
    const { store, engine } = await world();
    const el = await store.createElement('character', { name: 'Cato' });
    await engine.pushOnce();
    await store.updateElement(el.id, { description: 'new' } as never);
    const real = store.stampServerUpdatedAt.bind(store);
    store.stampServerUpdatedAt = async () => { throw denied(); };
    const r = await engine.pushOnce();
    store.stampServerUpdatedAt = real;
    expect(r.failures.find(x => x.element_id === el.id)).toMatchObject({ operation: 'update', source: 'disk', local_step: 'note_edit' });
    expect(r.pushed.updates).toBe(0);
    expect((await store.listLocallyChangedSince(null)).map(e => e.id)).toContain(el.id);
  });

  it('a delete OnlyWorlds already has, its tombstone not cleared: OnlyWorlds has it, never "could not write it"', async () => {
    const { store, engine } = await world();
    const el = await store.createElement('character', { name: 'Bryn' });
    await engine.pushOnce();
    await adapter.deleteElement('character', el.id);
    await store.deleteElement(el.id);
    const real = store.clearTombstone.bind(store);
    store.clearTombstone = async () => { throw denied(); };
    const r = await engine.pushOnce();
    store.clearTombstone = real;
    const f = r.failures.find(x => x.element_id === el.id)!;
    expect(f).toMatchObject({ operation: 'delete', source: 'disk', local_step: 'note' });
    noteRoundIssues('w', 'push', r);
    const line = syncIssueLine(issuesFor('w').find(i => i.element_id === el.id)!, 'browser');
    expect(line).toBe('OnlyWorlds has the delete, but Atlas could not note that in this browser. Atlas tries again with your next save.');
    expect(line).not.toMatch(/by itself|could not write it/);
  });
});
