/**
 * A held file on the PULL side, a busy retry behind a pull, and a held lock
 * under the heartbeat (four items a gate banked).
 *
 *   M4  a pull that meets a held element file or sync-state file records it
 *       per element and goes on; the round no longer throws. The /changes
 *       cursor does not pass an op it could not apply.
 *   L2  a busy retry that fires while a pull is in flight still pushes.
 *   L5  a lock file another program holds for a moment does not stop the
 *       heartbeat for good.
 * (L3, the pull's spurious conflict with our own lost create, is in
 * `sync-engine.adoptLostCreate.test.ts`.)
 *
 * Same harness as `sync.heldFile.test.ts`: the real FsFolderStore, SyncEngine
 * and v2 adapter against the MSW keel, `fake-fs` refusing closes on a held file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { setBusyRetryDelaysForTests } from '../../src/store/fs-utils';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { SyncEngine } from '../../src/sync/sync-engine';

const V2 = 'https://test-ow.local/api/v2';
const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 9, 4, 1, 0, t++)).toISOString();

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
  vi.useRealTimers();
  for (const e of engines.splice(0)) e.stop?.();
});

async function world(opts: { heartbeat?: boolean } = {}) {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  root.put('elements/character/.keep', '');
  const store = new FsFolderStore({ clock, tabId: 't', disableHeartbeat: !opts.heartbeat, forceTakeLock: true });
  await store.open(root as unknown as FileSystemDirectoryHandle);
  await store.listElements();
  await store.awaitTidies();
  const engine = new SyncEngine({ folder: store, client: adapter });
  engines.push(engine);
  return { root, store, engine };
}
const fileOf = (root: FakeDirHandle, id: string) =>
  root.list().find(p => p.startsWith('elements/character/') && root.get(p)!.includes(id))!;

/** A synced character whose server copy then changed: the next pull wants to write it. */
async function changedOnServer() {
  const w = await world();
  const el = await w.store.createElement('character', { name: 'Aldric', description: 'one' });
  await w.engine.pushOnce();
  await adapter.updateElement('character', el.id, { description: 'two' } as never);
  return { ...w, el };
}

describe('a pull that meets a held file (gate A M4)', () => {
  it('records the held element, does not throw, and applies it once released', async () => {
    const { root, store, engine, el } = await changedOnServer();
    const file = fileOf(root, el.id);
    root.hold(file);

    const r1 = await engine.pullNow();
    expect(r1.failures).toEqual([
      expect.objectContaining({ element_id: el.id, error_name: 'InvalidStateError', source: 'disk' }),
    ]);
    expect((await store.getElement(el.id))!.description).toBe('one');

    root.release(file);
    const r2 = await engine.pullNow();
    expect(r2.failures).toEqual([]);
    expect((await store.getElement(el.id))!.description).toBe('two');
  });

  it('a held sync-state file is a world failure, not the end of the round', async () => {
    const { root, store, engine, el } = await changedOnServer();
    root.hold('.atlas/sync-state.json');
    const r = await engine.pullNow();
    // The world-meta step and the round's end both meet it; each is a world failure.
    expect(r.failures.length).toBeGreaterThan(0);
    for (const f of r.failures) expect(f).toMatchObject({ element_id: 'world', error_name: 'InvalidStateError' });
    // The element itself was applied; the cursor stays where it was, and a
    // replay of an applied op is a no-op.
    expect((await store.getElement(el.id))!.description).toBe('two');
    root.release('.atlas/sync-state.json');
    const again = await engine.pullNow();
    expect(again.failures).toEqual([]);
    expect(again.pulled.updates).toBe(0);
  });
});

describe('a busy retry while a pull is in flight (gate A L2)', () => {
  it('waits for the pull, then pushes', async () => {
    const { engine } = await world();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const e = engine as unknown as {
      inFlight: Promise<unknown> | null; inFlightKind: string | null;
      scheduleTransientRetry(ms: number): void;
    };
    const push = vi.spyOn(engine, 'pushOnce').mockResolvedValue({} as never);
    // A pull is in flight when the retry fires.
    let finishPull!: () => void;
    e.inFlight = new Promise<void>(r => { finishPull = r; });
    e.inFlightKind = 'pull';
    e.scheduleTransientRetry(1000);
    await vi.advanceTimersByTimeAsync(1500);
    // Calling pushOnce now would only hand back the pull's promise: it waits.
    expect(push).not.toHaveBeenCalled();
    e.inFlight = null;
    e.inFlightKind = null;
    finishPull();
    await vi.advanceTimersByTimeAsync(0);
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe('the heartbeat and a held lock file (gate A L5)', () => {
  it('skips a beat on a busy read instead of stopping for good', async () => {
    const { root, store } = await world();
    const beat = () => (store as unknown as { refreshHeartbeat(): Promise<void> }).refreshHeartbeat();
    (store as unknown as { heartbeatTimer: unknown }).heartbeatTimer = setInterval(() => {}, 1 << 30);
    const lockBefore = JSON.parse(root.get('.atlas/lock')!);

    // The next read of the lock meets a file another program holds (once).
    const atlasDir = await (root as unknown as FileSystemDirectoryHandle).getDirectoryHandle('.atlas');
    const h = await atlasDir.getFileHandle('lock') as unknown as { getFile: () => Promise<unknown> };
    const realGetFile = h.getFile;
    h.getFile = async () => {
      h.getFile = realGetFile;
      return { text: async () => { const e = new Error('held'); e.name = 'NotReadableError'; throw e; } };
    };
    await beat();
    expect((store as unknown as { heartbeatTimer: unknown }).heartbeatTimer).not.toBeNull();
    expect(JSON.parse(root.get('.atlas/lock')!).last_heartbeat).toBe(lockBefore.last_heartbeat); // the beat was skipped
    await beat();
    const lockAfter = JSON.parse(root.get('.atlas/lock')!);
    expect(lockAfter.tab_id).toBe(lockBefore.tab_id);
    expect(lockAfter.last_heartbeat > lockBefore.last_heartbeat).toBe(true);
    clearInterval((store as unknown as { heartbeatTimer: ReturnType<typeof setInterval> }).heartbeatTimer);
  });
});
