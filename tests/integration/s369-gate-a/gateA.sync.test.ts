/**
 * Gate A (atlas 1.16) probes: the held-file family on the pull side and
 * the round ends. Each asserts the CORRECT behaviour: red today = a defect.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mswServer } from '../../setup';
import { statefulV2Handlers } from '../../msw-handlers';
import { FakeDirHandle } from '../../fixtures/fake-fs';
import { FsFolderStore } from '../../../src/store/folder-store-fs';
import { setBusyRetryDelaysForTests } from '../../../src/store/fs-utils';
import { OwV2ClientAdapter } from '../../../src/sync/ow-v2-client-adapter';
import { SyncEngine } from '../../../src/sync/sync-engine';

const V2 = 'https://test-ow.local/api/v2';
const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 9, 4, 2, 0, t++)).toISOString();

let server: ReturnType<typeof statefulV2Handlers>;
let adapter: OwV2ClientAdapter;
const engines: SyncEngine[] = [];
beforeEach(() => {
  server = statefulV2Handlers({ baseUrl: V2, clock });
  mswServer.use(...server.handlers);
  adapter = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: V2 });
  setBusyRetryDelaysForTests([0, 0, 0, 0]);
});
afterEach(() => {
  setBusyRetryDelaysForTests(null);
  for (const e of engines.splice(0)) e.stop?.();
});

async function world(policy?: 'local-wins' | 'pause-and-review') {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  root.put('elements/character/.keep', '');
  const store = new FsFolderStore({ clock, tabId: 't', disableHeartbeat: true, forceTakeLock: true });
  await store.open(root as unknown as FileSystemDirectoryHandle);
  await store.listElements();
  await store.awaitTidies();
  const engine = new SyncEngine({ folder: store, client: adapter, ...(policy ? { policy } : {}) });
  engines.push(engine);
  return { root, store, engine };
}
const fileOf = (root: FakeDirHandle, id: string) =>
  root.list().find(p => p.startsWith('elements/character/') && root.get(p)!.includes(id))!;
const cursorOf = (root: FakeDirHandle) => {
  const raw = root.get('.atlas/sync-state.json');
  return raw ? (JSON.parse(raw) as { changes_cursor?: string | null }).changes_cursor ?? null : null;
};

describe('gate A: the /changes cursor and a held adopt (adoptOwnCreate)', () => {
  it('an adopt the held file refused is replayed next pull: the cursor does not pass it', async () => {
    const { root, store, engine } = await world();
    const el = await store.createElement('character', { name: 'Rhea', description: 'one' });
    const file = fileOf(root, el.id);
    root.hold(file);
    await engine.pushOnce(); // the server has it; the stamp is refused
    expect((await store.getElement(el.id))!.server_updated_at).toBeFalsy();

    const cursorBefore = cursorOf(root);
    const r1 = await engine.pullNow(); // adoptOwnCreate: same content, stamp refused again
    expect(r1.conflicts).toHaveLength(0);
    expect(r1.failures.some(f => f.element_id === el.id)).toBe(true);
    // The op was not applied, so the persisted cursor must not have moved past it.
    expect.soft(cursorOf(root)).toBe(cursorBefore);

    root.release(file);
    await engine.pullNow(); // the replay adopts it now
    expect((await store.getElement(el.id))!.server_updated_at).toBeTruthy();
  });
});

describe('gate A: one held element file does not hold back the rest of the feed', () => {
  it('a server create after a held update still arrives', async () => {
    const { root, store, engine } = await world();
    const a = await store.createElement('character', { name: 'Aldric', description: 'one' });
    await engine.pushOnce();
    await engine.pullNow(); // cursor at head
    await adapter.updateElement('character', a.id, { description: 'two' } as never);
    const bId = crypto.randomUUID();
    await adapter.createElement('character', { id: bId, name: 'Ione' } as never);
    root.hold(fileOf(root, a.id)); // held for good (a read-only file, a stuck client)

    await engine.pullNow();
    await engine.pullNow();
    expect(await store.getElement(bId)).not.toBeNull();
  });

  it('control: the same feed without the hold delivers the create', async () => {
    const { store, engine } = await world();
    const a = await store.createElement('character', { name: 'Aldric', description: 'one' });
    await engine.pushOnce();
    await engine.pullNow();
    await adapter.updateElement('character', a.id, { description: 'two' } as never);
    const bId = crypto.randomUUID();
    await adapter.createElement('character', { id: bId, name: 'Ione' } as never);
    await engine.pullNow();
    expect(await store.getElement(bId)).not.toBeNull();
  });
});

describe('gate A: a pull-side held file is retried by itself, as the copy promises', () => {
  // BANKED: copy now says 'refresh to try again' / schema allow-list not built.
  it.skip('a held pull write arms a retry ("Atlas will try again in a moment")', async () => {
    const { root, store, engine } = await world();
    const a = await store.createElement('character', { name: 'Aldric', description: 'one' });
    await engine.pushOnce();
    await adapter.updateElement('character', a.id, { description: 'two' } as never);
    root.hold(fileOf(root, a.id));
    const r = await engine.pullNow();
    expect(r.failures.some(f => f.element_id === a.id)).toBe(true);
    expect((engine as unknown as { transientRetryTimer: unknown }).transientRetryTimer).not.toBeNull();
  });
});

describe('gate A: a round that throws never leaves the pill on Saving', () => {
  it('syncNow: a damaged file met by the bulk stamp settles the state (runSync has no guard on pushPhase)', async () => {
    const { root, store, engine } = await world();
    const a = await store.createElement('character', { name: 'Aldric' });
    await store.createElement('character', { name: 'Ione' });
    root.put(fileOf(root, a.id), '<<<<<<< HEAD\n{ "broken": \n');
    await engine.syncNow().catch(() => {});
    expect(engine.getState().kind).not.toBe('syncing');
  });

  it('pause-and-review: a held sync-state at persistConflicts (syncNow) neither throws the round nor sticks the pill', async () => {
    const { root, store, engine } = await world('pause-and-review');
    const a = await store.createElement('character', { name: 'Aldric', description: 'one' });
    await engine.pushOnce();
    await adapter.updateElement('character', a.id, { description: 'server' } as never);
    await store.updateElement(a.id, { description: 'local' });
    root.hold('.atlas/sync-state.json');
    let threw = false;
    await engine.syncNow().catch(() => { threw = true; });
    expect(engine.getState().kind).not.toBe('syncing');
    expect(threw).toBe(false);
  });

  it('control: pushOnce on the same damaged file settles to the red damaged-file state', async () => {
    const { root, store, engine } = await world();
    const a = await store.createElement('character', { name: 'Aldric' });
    await store.createElement('character', { name: 'Ione' });
    root.put(fileOf(root, a.id), '<<<<<<< HEAD\n{ "broken": \n');
    await engine.pushOnce().catch(() => {});
    expect(engine.getState().kind).toBe('error');
  });

  it('control: local-wins, same held sync-state, settles', async () => {
    const { root, store, engine } = await world('local-wins');
    const a = await store.createElement('character', { name: 'Aldric', description: 'one' });
    await engine.pushOnce();
    await adapter.updateElement('character', a.id, { description: 'server' } as never);
    await store.updateElement(a.id, { description: 'local' });
    root.hold('.atlas/sync-state.json');
    await engine.syncNow().catch(() => {});
    expect(engine.getState().kind).not.toBe('syncing');
  });

  it('pause-and-review: the same through pushOnce', async () => {
    const { root, store, engine } = await world('pause-and-review');
    const a = await store.createElement('character', { name: 'Aldric', description: 'one' });
    await engine.pushOnce();
    await adapter.updateElement('character', a.id, { description: 'server' } as never);
    await store.updateElement(a.id, { description: 'local' });
    root.hold('.atlas/sync-state.json');
    await engine.pushOnce().catch(() => {});
    expect(engine.getState().kind).not.toBe('syncing');
  });
});
