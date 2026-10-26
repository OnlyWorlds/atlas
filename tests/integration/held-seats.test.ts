/**
 * Held seats: a join link's seat
 * kept from the redeem until a world of its id lands here, by any door, or the
 * person removes it. The store (`core/held-seats.ts`), the settle every
 * registry change runs (app.ts), and the join door's own drops, against the
 * MSW keel `join-door.test.ts` uses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mswServer } from '../setup';
import { joinV2Handlers, statefulV2Handlers, type FakePass } from '../msw-handlers';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { setActiveStore } from '../../src/core/active-store';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { setOpfsRootForTests } from '../../src/core/browser-worlds';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';

const TEST_BASE = 'https://test-ow.local/api/v2';

vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: vi.fn(async () => {}),
  loadHandle: async () => null,
  ensureWritable: async () => true,
  queryWritable: async () => true,
  deleteHandle: async () => {},
  listHandleKeys: async () => [],
}));
vi.mock('../../src/store/folder-store-fs', async () => {
  const { MockFolderStore } = await import('../fixtures/mock-folder-store');
  return { FsFolderStore: MockFolderStore };
});
vi.mock('../../src/sync/make-online', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/make-online')>()),
  buildV2Adapter: (apiKey: string, apiPin: string) => new OwV2ClientAdapter({ apiKey, apiPin, baseUrl: TEST_BASE }),
}));
vi.mock('../../src/sync/sync-attach', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/sync-attach')>()),
  attachSyncEngine: vi.fn(),
}));

import {
  allHeldSeats, dropHeldSeat, HELD_SEAT_PREFIX, heldSeat, heldSeats, holdSeat, settleHeldSeats, type HeldSeat,
} from '../../src/core/held-seats';
import { isAtlasGrounded } from '../../src/core/grounded';
import { scrubForReport } from '../../src/core/problems';
import { forgetInventory } from '../../src/setup/forget-browser';
import {
  alreadyHereLine, openJoinedWorld, openPlayerWorld, playerAlreadyHereLine, redeemJoin, redeemPlayerJoin, setJoinBaseForTests,
} from '../../src/setup/join-door';
import { DownloadCancelledError } from '../../src/sync/initial-download';

const WORLD_ID = '068e5012-d77c-799d-8000-95548fbae701';
const OTHER_ID = '068e5012-d77c-799d-8000-95548fbae702';
const CODE = 'ow_j_' + 'Q'.repeat(32);
const SECRET = 'ow_s_' + 'S'.repeat(32);
const pass = (over: Partial<FakePass> = {}): FakePass => ({
  code: CODE, world: { id: WORLD_ID, name: 'Moppetopia', description: 'A soft world' },
  ownerCharacter: 'Admiral Fluffington', invitedBy: 'tmo', ...over,
});

function agent(over: Partial<HeldSeat> = {}): HeldSeat {
  return {
    v: 1, world_id: WORLD_ID, world_name: 'Moppetopia', kind: 'agent', key: 'ow_w_held', secret: SECRET,
    role: 'contributor', held_at: '2026-10-25T03:00:00.000Z', code_tail: 'QQQQQQ', ...over,
  };
}
function player(over: Partial<HeldSeat> = {}): HeldSeat {
  return {
    v: 1, world_id: WORLD_ID, world_name: 'Moppetopia', kind: 'player', key: 'ow_r_held',
    character: { id: 'c-1', name: 'Bartlett' }, held_at: '2026-10-25T03:00:00.000Z', code_tail: 'QQQQQQ', ...over,
  };
}
function world(over: Partial<WorldRegistryEntry> & { id: string }): WorldRegistryEntry {
  return {
    name: 'Moppetopia', state: 'local-only',
    folder: { handle_key: `world-${over.id}`, folder_name: 'moppetopia' },
    created_at: '2026-01-01T00:00:00.000Z', last_opened_at: '2026-01-01T00:00:00.000Z',
    ...over,
  } as WorldRegistryEntry;
}
function setWorlds(worlds: WorldRegistryEntry[]): void {
  patchSlice('registry', { ...getState().registry, worlds });
}

beforeEach(() => {
  localStorage.clear();
  setOpfsRootForTests(async () => new FakeDirHandle('opfs') as unknown as FileSystemDirectoryHandle);
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('atlasRoot', null);
  patchSlice('registry', { ...defaultRegistry(), worlds: [], pin: '1234' });
  setJoinBaseForTests(TEST_BASE);
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  mswServer.use(...statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next }).handlers);
});
afterEach(() => {
  localStorage.clear();
  setOpfsRootForTests(null);
  setJoinBaseForTests(null);
  mswServer.resetHandlers();
  vi.restoreAllMocks();
});

describe('the record', () => {
  it('is kept per world under its own key, and read back whole', () => {
    expect(holdSeat(agent())).toEqual({ held: true, replaced: null });
    expect(localStorage.getItem(`${HELD_SEAT_PREFIX}${WORLD_ID}`)).toContain('"kind":"agent"');
    expect(heldSeat(WORLD_ID)).toEqual(agent());
    dropHeldSeat(WORLD_ID);
    expect(heldSeat(WORLD_ID)).toBeNull();
  });

  it('two worlds held at once are two records: neither is lost (P5)', () => {
    holdSeat(agent());
    holdSeat(player({ world_id: OTHER_ID, world_name: 'Aldric' }));
    expect(allHeldSeats().map(h => h.world_id).sort()).toEqual([WORLD_ID, OTHER_ID].sort());
  });

  it('a second link for a held world replaces it and names the older seat; the same key is no replacement (rule 4)', () => {
    holdSeat(agent());
    expect(holdSeat(agent()).replaced).toBeNull();
    const second = holdSeat(agent({ key: 'ow_w_newer', secret: 'ow_s_' + 'N'.repeat(32) }));
    expect(second.replaced?.key).toBe('ow_w_held');
    expect(heldSeat(WORLD_ID)?.key).toBe('ow_w_newer');
  });

  it('a record of the wrong shape is never read, and is dropped (note c)', () => {
    const put = (id: string, v: unknown) => localStorage.setItem(`${HELD_SEAT_PREFIX}${id}`, typeof v === 'string' ? v : JSON.stringify(v));
    put('a', 'not json');
    put('b', { ...agent(), world_id: 'b', secret: 'not-a-secret' });
    put('c', { ...player(), world_id: 'c', secret: SECRET });
    put('d', { ...player(), world_id: 'd', key: 'ow_w_not_read' });
    put('e', { ...agent(), world_id: 'someone-else' });
    put('f', { ...agent(), world_id: 'f', kind: 'person' });
    expect(allHeldSeats()).toEqual([]);
    expect(Object.keys(localStorage).filter(k => k.startsWith(HELD_SEAT_PREFIX))).toEqual([]);
  });

  it('a hold changes no world row (P3)', () => {
    const before = getState().registry;
    holdSeat(agent());
    expect(getState().registry).toBe(before);
    expect(getState().registry.worlds).toEqual([]);
  });

  it('is not shown once its world is here, by the server id or a world file\'s own key (G3, G7)', () => {
    holdSeat(agent());
    expect(heldSeats().map(h => h.world_id)).toEqual([WORLD_ID]);
    setWorlds([world({ id: 'row-1', folder: { handle_key: `world-${WORLD_ID}`, folder_name: 'moppetopia' } })]);
    expect(heldSeats()).toEqual([]);
    setWorlds([world({ id: 'row-2', state: 'api-linked', api: { world_id: WORLD_ID, api_key: 'ow_w_held' } })]);
    expect(heldSeats()).toEqual([]);
  });

  it('a fresh browser with only a held seat is set up: the worlds list is the landing (G4)', () => {
    expect(isAtlasGrounded()).toBe(false);
    holdSeat(agent());
    expect(isAtlasGrounded()).toBe(true);
  });

  it('a seat\'s secret never reaches a report (note a), and Forget everything names the held world (note b)', () => {
    expect(scrubForReport(`failed with ${SECRET} here`)).not.toContain(SECRET);
    holdSeat(agent());
    expect(forgetInventory(getState().registry).heldSeats).toEqual(['Moppetopia']);
  });
});

describe('settleHeldSeats: a world of that id landing here, by any door', () => {
  it('the same seat landed: dropped quietly', () => {
    holdSeat(agent());
    setWorlds([world({ id: 'row-1', state: 'api-linked', api: { world_id: WORLD_ID, api_key: 'ow_w_held', seat: {}, seat_secret: SECRET } })]);
    const out = settleHeldSeats(getState().registry);
    expect(out).toEqual({ next: null, handedOver: [], spare: [] });
    expect(heldSeat(WORLD_ID)).toBeNull();
  });

  it('another key landed (the account list, Make online, a world file): dropped and said spare (G5)', () => {
    holdSeat(agent());
    setWorlds([world({ id: 'row-1', state: 'api-linked', api: { world_id: WORLD_ID, api_key: 'ow_w_owner' } })]);
    expect(settleHeldSeats(getState().registry).spare.map(h => h.key)).toEqual(['ow_w_held']);
    expect(heldSeat(WORLD_ID)).toBeNull();
    holdSeat(player());
    setWorlds([world({ id: 'row-2', folder: { handle_key: `world-${WORLD_ID}`, folder_name: 'moppetopia' } })]);
    expect(settleHeldSeats(getState().registry).spare.map(h => h.kind)).toEqual(['player']);
  });

  it('a seat world that lost its secret takes the record\'s, and the record waits for the save (G2)', () => {
    holdSeat(agent());
    setWorlds([world({ id: 'row-1', state: 'api-linked', api: { world_id: WORLD_ID, api_key: 'ow_w_held', seat: {} } })]);
    const out = settleHeldSeats(getState().registry);
    expect(out.spare).toEqual([]);
    expect(out.next?.worlds[0].api).toMatchObject({ api_key: 'ow_w_held', seat: { role: 'contributor' }, seat_secret: SECRET });
    expect(out.handedOver.map(e => e.id)).toEqual(['row-1']);
    // Dropped by the caller once `next` is saved (app.ts), never before.
    expect(heldSeat(WORLD_ID)).not.toBeNull();
  });

  it('an account world or a view-only one never takes a held seat', () => {
    holdSeat(agent());
    setWorlds([world({ id: 'row-1', state: 'api-linked', api: { world_id: WORLD_ID, api_key: 'ow_w_owner' } })]);
    expect(settleHeldSeats(getState().registry).next).toBeNull();
    holdSeat(agent());
    setWorlds([world({ id: 'row-2', state: 'api-linked', api: { world_id: WORLD_ID, api_key: 'ow_r_read', read_only: true, seat: {} } })]);
    expect(settleHeldSeats(getState().registry).next).toBeNull();
  });

  it('a record whose world is not here stays', () => {
    holdSeat(agent());
    setWorlds([world({ id: 'row-1', state: 'api-linked', api: { world_id: OTHER_ID, api_key: 'ow_w_other' } })]);
    expect(settleHeldSeats(getState().registry)).toEqual({ next: null, handedOver: [], spare: [] });
    expect(heldSeat(WORLD_ID)).not.toBeNull();
  });
});

describe('the join door drops what it held', () => {
  function serve(passes: FakePass[]): void {
    mswServer.use(...joinV2Handlers({ baseUrl: TEST_BASE, passes }).handlers);
  }
  const holdFor = (seat: { world: { id: string; name: string }; key: string; secret: string; role: string }) =>
    holdSeat(agent({ world_id: seat.world.id, world_name: seat.world.name, key: seat.key, secret: seat.secret, role: seat.role }));

  it('a download that lands drops it', async () => {
    serve([pass()]);
    const seat = await redeemJoin(CODE);
    holdFor(seat);
    const out = await openJoinedWorld({ seat, where: 'browser' });
    expect(out.kind).toBe('downloaded');
    expect(heldSeat(WORLD_ID)).toBeNull();
  });

  it('a download cancelled keeps it (P1)', async () => {
    serve([pass()]);
    const seat = await redeemJoin(CODE);
    holdFor(seat);
    await expect(openJoinedWorld({ seat, where: 'browser', shouldStop: () => 'cancel' })).rejects.toBeInstanceOf(DownloadCancelledError);
    expect(heldSeat(WORLD_ID)?.secret).toBe(seat.secret);
    expect(getState().registry.worlds).toEqual([]);
  });

  it('already here, here from an earlier link, or reconnected: dropped (G1)', async () => {
    for (const [here, kind] of [
      [world({ id: 'r1', state: 'api-linked', api: { world_id: WORLD_ID, api_key: 'ow_w_owner' } }), 'already-here'],
      [world({ id: 'r2', former_api_world_id: WORLD_ID }), 'here-unlinked'],
      [world({ id: 'r3', state: 'api-linked', api: { world_id: WORLD_ID, api_key: 'ow_w_old', seat: {} } }), 'reconnected'],
    ] as const) {
      serve([pass()]);
      setWorlds([here]);
      const seat = await redeemJoin(CODE);
      holdFor(seat);
      expect((await openJoinedWorld({ seat, where: 'browser' })).kind).toBe(kind);
      expect(heldSeat(WORLD_ID)).toBeNull();
    }
  });

  it('already here on this very seat (another tab came first) is never said spare', async () => {
    serve([pass()]);
    const seat = await redeemJoin(CODE);
    setWorlds([world({ id: 'r1', state: 'api-linked', api: { world_id: WORLD_ID, api_key: seat.key, seat: {}, seat_secret: seat.secret } })]);
    holdFor(seat);
    const out = await openJoinedWorld({ seat, where: 'browser' });
    expect(out).toMatchObject({ kind: 'already-here', sameSeat: true });
    if (out.kind === 'downloaded') return;
    expect(alreadyHereLine(out)).not.toContain('unused');
    expect(heldSeat(WORLD_ID)).toBeNull();
    // Another seat's world here still makes this one spare.
    setWorlds([world({ id: 'r2', state: 'api-linked', api: { world_id: WORLD_ID, api_key: 'ow_w_other', seat: {}, seat_secret: SECRET } })]);
    const other = await openJoinedWorld({ seat, where: 'browser' });
    if (other.kind === 'downloaded') throw new Error('downloaded');
    expect(alreadyHereLine(other)).toContain('unused');
  });

  it('a player\'s: already here drops it, a download that lands drops it', async () => {
    serve([pass({ reader: 'player' })]);
    const p = await redeemPlayerJoin(CODE, 'Bartlett');
    holdSeat(player({ key: p.key, character: p.character }));
    expect((await openPlayerWorld({ player: p, where: 'browser' })).kind).toBe('downloaded');
    expect(heldSeat(WORLD_ID)).toBeNull();
    holdSeat(player({ key: p.key, character: p.character }));
    const again = await openPlayerWorld({ player: p, where: 'browser' });
    expect(again).toMatchObject({ kind: 'already-here', sameSeat: true });
    if (again.kind === 'downloaded') return;
    expect(playerAlreadyHereLine(again)).not.toContain('unused');
    expect(heldSeat(WORLD_ID)).toBeNull();
  });
});
