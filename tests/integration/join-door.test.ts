/**
 * The `#/join/` door: `core/join-capture.ts` and
 * `setup/join-door.ts` against keel's /join and /join/preview as the MSW
 * handlers encode them (`joinV2Handlers`), and a real download into browser
 * storage through the link flow (as `link-browser.test.ts` sets it up).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { joinV2Handlers, statefulV2Handlers, type FakePass } from '../msw-handlers';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { setActiveStore, getActiveStore } from '../../src/core/active-store';
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

import { captureJoinCode, hasPendingJoin, takePendingJoin } from '../../src/core/join-capture';
import {
  JOIN_REFUSED_LINE, JOIN_TAKEN_LINE, isPickRefused, isRefusedCode, isWorldFull, openJoinedWorld, openPlayerWorld,
  PICK_GONE_LINE, PICK_TAKEN_LINE, pickRefusedLine, playerAlreadyHereLine, previewJoin, redeemJoin, redeemPlayerJoin,
  redeemRefusedSentence, roleLine, seatAgentName, setJoinBaseForTests, tablePicks, tableTimesLine,
} from '../../src/setup/join-door';

const WORLD_ID = '068e5012-d77c-799d-8000-95548fbae701';
const CODE = 'ow_j_' + 'Q'.repeat(32);
const pass = (over: Partial<FakePass> = {}): FakePass => ({
  code: CODE, world: { id: WORLD_ID, name: 'Moppetopia', description: 'A soft world' },
  ownerCharacter: 'Admiral Fluffington', invitedBy: 'tmo', ...over,
});
let redeemed: ReturnType<typeof joinV2Handlers>['redeemed'];

function serve(passes: FakePass[]): void {
  const j = joinV2Handlers({ baseUrl: TEST_BASE, passes });
  redeemed = j.redeemed;
  mswServer.use(...j.handlers);
}

beforeEach(async () => {
  setOpfsRootForTests(async () => new FakeDirHandle('opfs') as unknown as FileSystemDirectoryHandle);
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('registry', { ...defaultRegistry(), worlds: [], pin: '1234' });
  setJoinBaseForTests(TEST_BASE);
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  mswServer.use(...statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next }).handlers);
  const server = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: TEST_BASE });
  for (const name of ['Fluffington', 'Grimble']) await server.createElement('character', { name });
  takePendingJoin();
});
afterEach(() => {
  setOpfsRootForTests(null);
  setJoinBaseForTests(null);
  mswServer.resetHandlers();
  vi.restoreAllMocks();
});

describe('captureJoinCode (R2: the code leaves the address bar first)', () => {
  const hist = () => ({ state: null, replaceState: vi.fn() });

  it('takes a well-formed code and replaces the entry with #/', () => {
    const h = hist();
    expect(captureJoinCode({ hash: `#/join/${CODE}` }, h)).toBe(true);
    expect(h.replaceState).toHaveBeenCalledWith(null, '', '#/');
    expect(hasPendingJoin()).toBe(true);
    expect(takePendingJoin()).toBe(CODE);
    expect(takePendingJoin()).toBeNull();
  });

  it('strips a malformed code too, and hands over an empty one', () => {
    const h = hist();
    expect(captureJoinCode({ hash: '#/join/ow_j_short' }, h)).toBe(true);
    expect(h.replaceState).toHaveBeenCalled();
    expect(takePendingJoin()).toBe('');
  });

  it('leaves every other hash alone', () => {
    const h = hist();
    expect(captureJoinCode({ hash: '#/w/abc/settings' }, h)).toBe(false);
    expect(captureJoinCode({ hash: '#/joint' }, h)).toBe(false);
    expect(h.replaceState).not.toHaveBeenCalled();
    expect(hasPendingJoin()).toBe(false);
  });
});

describe('preview and redeem', () => {
  it('the preview reads the invitation and spends nothing', async () => {
    serve([pass({ withCharacter: true })]);
    const p = await previewJoin(CODE);
    expect(p).toMatchObject({ world: { name: 'Moppetopia' }, ownerCharacter: 'Admiral Fluffington', invitedBy: 'tmo', role: 'contributor', withCharacter: true });
    await previewJoin(CODE);
    expect(redeemed).toHaveLength(0);
  });

  it('an unknown or used code is one refusal, worded by R5', async () => {
    serve([pass()]);
    await expect(previewJoin('ow_j_' + 'Z'.repeat(32))).rejects.toSatisfy(isRefusedCode);
    const p = await previewJoin(CODE);
    await redeemJoin(CODE, 'Atlas (Chrome)');
    const again = await redeemJoin(CODE, 'Atlas (Chrome)').catch(e => e);
    expect(isRefusedCode(again)).toBe(true);
    expect(redeemRefusedSentence(p)).toBe(`${JOIN_REFUSED_LINE} ${JOIN_TAKEN_LINE}`);
    expect(redeemRefusedSentence({ ...p, expiresAt: '2020-01-01T00:00:00Z' })).toBe(JOIN_REFUSED_LINE);
  });

  it('the redeem names the seat by browser (R4)', async () => {
    serve([pass()]);
    const seat = await redeemJoin(CODE, seatAgentName('Mozilla/5.0 (Windows NT 10.0; rv:150.0) Gecko/20100101 Firefox/150.0'));
    expect(redeemed[0].agent_name).toBe('Atlas (Firefox)');
    expect(seat).toMatchObject({ world: { id: WORLD_ID, name: 'Moppetopia' }, role: 'contributor' });
    expect(seat.secret).toMatch(/^ow_s_/);
    expect(seatAgentName('Mozilla/5.0 AppleWebKit/537.36 Chrome/148.0 Safari/537.36 Edg/148.0')).toBe('Atlas (Edge)');
  });

  it('names each of keel\'s roles by its wire value (co_builder, not co-builder)', async () => {
    serve([pass({ role: 'co_builder' })]);
    const p = await previewJoin(CODE);
    expect(p.role).toBe('co_builder');
    expect(roleLine(p.role)).toContain('can change anything');
    expect(roleLine('contributor')).toContain('change what it adds');
    expect(roleLine('guest')).toContain('sees only part of this world');
    expect(roleLine('ow<b>ner')).toBe('Atlas joins with the role owbner.');
  });
});

describe('openJoinedWorld', () => {
  it('downloads the world as a seat: its own secret, the account PIN untouched, nothing secret in world.json', async () => {
    serve([pass()]);
    const seat = await redeemJoin(CODE);
    const out = await openJoinedWorld({ seat, where: 'browser' });
    expect(out.kind).toBe('downloaded');
    if (out.kind !== 'downloaded') return;
    expect(out.result.downloaded).toBe(2);
    const entry = getState().registry.worlds.find(w => w.id === out.result.entry.id)!;
    expect(entry.api).toMatchObject({ world_id: WORLD_ID, api_key: seat.key, seat: { role: 'contributor' }, seat_secret: seat.secret });
    expect(getState().registry.pin).toBe('1234');
    const meta = await getActiveStore()!.readWorldMeta();
    expect(JSON.stringify(meta)).not.toContain(seat.secret);
  });

  function hereAlready(api: WorldRegistryEntry['api'], state: WorldRegistryEntry['state'] = 'api-linked', former?: string): WorldRegistryEntry {
    const e = {
      id: 'here-1', name: 'Moppetopia', state, ...(api ? { api } : {}),
      ...(former ? { former_api_world_id: former } : {}),
      folder: { handle_key: 'world-here-1', folder_name: 'moppetopia' },
      created_at: '2026-01-01T00:00:00.000Z', last_opened_at: '2026-01-01T00:00:00.000Z',
    } as WorldRegistryEntry;
    patchSlice('registry', { ...getState().registry, worlds: [e] });
    return e;
  }

  it('a world already here and syncing opens; nothing downloads, the seat is spare', async () => {
    serve([pass()]);
    hereAlready({ world_id: WORLD_ID, api_key: 'ow_w_owner' });
    const out = await openJoinedWorld({ seat: await redeemJoin(CODE), where: 'browser' });
    expect(out.kind).toBe('already-here');
    expect(getState().registry.worlds).toHaveLength(1);
    expect(getState().registry.worlds[0].api?.api_key).toBe('ow_w_owner');
  });

  it('a seat world that lost its secret takes the new seat', async () => {
    serve([pass()]);
    hereAlready({ world_id: WORLD_ID, api_key: 'ow_w_old', seat: {} });
    const seat = await redeemJoin(CODE);
    const out = await openJoinedWorld({ seat, where: 'browser' });
    expect(out.kind).toBe('reconnected');
    expect(getState().registry.worlds[0].api).toMatchObject({ api_key: seat.key, seat: { role: 'contributor' }, seat_secret: seat.secret });
  });

  // The reconnect once took over any linked world
  // this browser held no PIN for, turning the owner's own world into a
  // contributor seat for good, and a view-only world into a seat that could
  // never write.
  it('an account world with no PIN in this browser stays the owner\'s: never turned into a seat', async () => {
    serve([pass()]);
    patchSlice('registry', { ...getState().registry, pin: undefined });
    hereAlready({ world_id: WORLD_ID, api_key: 'ow_w_owner' });
    const out = await openJoinedWorld({ seat: await redeemJoin(CODE), where: 'browser' });
    expect(out.kind).toBe('already-here');
    const api = getState().registry.worlds[0].api!;
    expect(api.api_key).toBe('ow_w_owner');
    expect(api.seat).toBeUndefined();
    expect(api.seat_secret).toBeUndefined();
  });

  it('a view-only world stays view-only and takes no seat', async () => {
    serve([pass()]);
    // A view-only world never has a PIN; with none set, the old rule took it over.
    patchSlice('registry', { ...getState().registry, pin: undefined });
    hereAlready({ world_id: WORLD_ID, api_key: 'ow_w_read', read_only: true });
    const out = await openJoinedWorld({ seat: await redeemJoin(CODE), where: 'browser' });
    expect(out.kind).toBe('already-here');
    expect(getState().registry.worlds[0].api).toEqual({ world_id: WORLD_ID, api_key: 'ow_w_read', read_only: true });
  });

  it('a world here from an earlier link opens as it is: nothing uploads (R7)', async () => {
    serve([pass()]);
    hereAlready(undefined, 'local-only', WORLD_ID);
    const out = await openJoinedWorld({ seat: await redeemJoin(CODE), where: 'browser' });
    expect(out.kind).toBe('here-unlinked');
    expect(getState().registry.worlds[0].state).toBe('local-only');
  });
});

// keel #353, the sharing floor's T2 (#416): a player's code opens in Atlas to
// read, as the Character the link gives, with no account and no PIN.
describe('a player link', () => {
  const PLAYER = 'ow_j_' + 'P'.repeat(32);
  const playerPass = (over: Partial<FakePass> = {}): FakePass => pass({ code: PLAYER, reader: 'player', ...over });

  it('the preview says player, and Atlas knows the kind', async () => {
    serve([playerPass()]);
    const p = await previewJoin(PLAYER);
    expect(p.reader).toBe('player');
    expect(p.role).toBe('guest');
    expect(redeemed).toHaveLength(0);
  });

  it('the redeem sends the player\'s name and no agent_name, and keeps the read key and the Character', async () => {
    serve([playerPass()]);
    const joined = await redeemPlayerJoin(PLAYER, '  Bartlett  ');
    expect(redeemed).toEqual([expect.objectContaining({ code: PLAYER, agent_name: 'Bartlett' })]);
    expect(joined.world).toEqual({ id: WORLD_ID, name: 'Moppetopia' });
    expect(joined.key).toMatch(/^ow_r_/);
    expect(joined.character.name).toBe('Bartlett');
  });

  it('no name: keel names the Character, a picked one keeps its own', async () => {
    serve([playerPass(), playerPass({ code: PLAYER + 'x', character: { id: 'c-holden', name: 'Judge Holden' } })]);
    expect((await redeemPlayerJoin(PLAYER)).character.name).toBe('Player');
    expect((await redeemPlayerJoin(PLAYER + 'x', 'Kid')).character).toEqual({ id: 'c-holden', name: 'Judge Holden' });
  });

  it('a spent code is the one refusal, and a player is never sent to an account page (gate M2)', async () => {
    serve([playerPass()]);
    const p = await previewJoin(PLAYER);
    await redeemPlayerJoin(PLAYER);
    const err = await redeemPlayerJoin(PLAYER).catch(e => e);
    expect(isRefusedCode(err)).toBe(true);
    const said = redeemRefusedSentence(p);
    expect(said).toContain('tell the person who sent it');
    expect(said).not.toContain(JOIN_TAKEN_LINE);
  });

  it('an answer that is not a player\'s read key is refused, never linked', async () => {
    // An agent's answer (a write key and a secret) is never taken as a player's.
    mswServer.use(http.post(`${TEST_BASE}/join`, () => HttpResponse.json({
      kind: 'agent', world: { id: WORLD_ID, name: 'Moppetopia' }, key: 'ow_w_' + 'k'.repeat(32), pin: 'ow_s_x', character: null,
    }, { status: 201 })));
    await expect(redeemPlayerJoin(PLAYER)).rejects.toThrow(/player/);
    expect(getState().registry.worlds).toHaveLength(0);
  });

  it('downloads the world view-only on the read key: no PIN, no seat, the account PIN untouched', async () => {
    serve([playerPass()]);
    const player = await redeemPlayerJoin(PLAYER, 'Bartlett');
    const out = await openPlayerWorld({ player, where: 'browser' });
    expect(out.kind).toBe('downloaded');
    if (out.kind !== 'downloaded') return;
    const entry = getState().registry.worlds.find(w => w.id === out.result.entry.id)!;
    expect(entry.api).toMatchObject({ world_id: WORLD_ID, api_key: player.key, read_only: true });
    expect(entry.api?.seat).toBeUndefined();
    expect(entry.api?.seat_secret).toBeUndefined();
    expect(getState().registry.pin).toBe('1234');
    const meta = await getActiveStore()!.readWorldMeta();
    expect(meta.api).toMatchObject({ world_id: WORLD_ID, read_only: true });
  });

  it('a world already linked here keeps its own key: the player key never replaces it', async () => {
    serve([playerPass()]);
    const e = {
      id: 'here-1', name: 'Moppetopia', state: 'api-linked', api: { world_id: WORLD_ID, api_key: 'ow_w_owner' },
      folder: { handle_key: 'world-here-1', folder_name: 'moppetopia' },
      created_at: '2026-01-01T00:00:00.000Z', last_opened_at: '2026-01-01T00:00:00.000Z',
    } as WorldRegistryEntry;
    patchSlice('registry', { ...getState().registry, worlds: [e] });
    const out = await openPlayerWorld({ player: await redeemPlayerJoin(PLAYER), where: 'browser' });
    expect(out.kind).toBe('already-here');
    expect(getState().registry.worlds).toHaveLength(1);
    expect(getState().registry.worlds[0].api).toEqual({ world_id: WORLD_ID, api_key: 'ow_w_owner' });
    if (out.kind === 'already-here') expect(playerAlreadyHereLine(out)).toContain('the world\'s owner can remove it');
  });
});

// keel's party link: one player
// link for a table, each player picking a Character from the owner's list, or
// on a table with no list naming a fresh one. A refused pick spends nothing.
describe('a party link', () => {
  const TABLE = 'ow_j_' + 'T'.repeat(32);
  const WHITE = { id: 'c-white', name: 'Captain White' };
  const DONIPHAN = { id: 'c-doniphan', name: 'Alexander Doniphan' };
  const LINCOLN = { id: 'c-lincoln', name: 'A. L. Lincoln' };
  const tablePass = (over: Partial<FakePass> = {}): FakePass => pass({
    code: TABLE, reader: 'player', maxUses: 5, characters: [WHITE, LINCOLN, DONIPHAN], taken: [LINCOLN.id],
    expiresAt: '2099-10-26T12:00:00.000Z', ...over,
  });

  it('is told apart from a link for one, and lists the owner\'s picks in order, taken ones last', async () => {
    serve([tablePass(), pass({ code: CODE, reader: 'player' })]);
    const p = await previewJoin(TABLE);
    expect(p.table).toMatchObject({ maxUses: 5, usesLeft: 5, nameRequired: false });
    expect(tablePicks(p.table!).map(c => [c.name, c.taken])).toEqual([['Captain White', false], ['Alexander Doniphan', false], ['A. L. Lincoln', true]]);
    expect(tableTimesLine(p.table!, p.expiresAt)).toBe('The link works 5 times, until 26 October. 5 places are left.');
    expect((await previewJoin(CODE)).table).toBeUndefined();
  });

  it('a pick opens as that Character; the next preview has it taken and one place fewer', async () => {
    serve([tablePass()]);
    const joined = await redeemPlayerJoin(TABLE, '  Mara ', DONIPHAN.id);
    expect(joined.character).toEqual(DONIPHAN);
    expect(redeemed[redeemed.length - 1]).toMatchObject({ code: TABLE, agent_name: 'Mara' });
    const p = await previewJoin(TABLE);
    expect(p.table!.usesLeft).toBe(4);
    expect(p.table!.characters.find(c => c.id === DONIPHAN.id)?.taken).toBe(true);
  });

  it('a pick taken since the preview, or off the list now, is refused by name and spends nothing', async () => {
    serve([tablePass({ hidden: [DONIPHAN.id] })]);
    const taken = await redeemPlayerJoin(TABLE, '', LINCOLN.id).catch(e => e);
    expect([isPickRefused(taken), pickRefusedLine(taken)]).toEqual([true, PICK_TAKEN_LINE]);
    const hidden = await redeemPlayerJoin(TABLE, '', DONIPHAN.id).catch(e => e);
    expect([isPickRefused(hidden), pickRefusedLine(hidden)]).toEqual([true, PICK_GONE_LINE]);
    const none = await redeemPlayerJoin(TABLE).catch(e => e);
    expect(isPickRefused(none)).toBe(true);
    expect(isRefusedCode(taken) || isRefusedCode(hidden) || isRefusedCode(none)).toBe(false);
    const p = await previewJoin(TABLE);
    expect(p.table!.usesLeft).toBe(5);
    // A hidden Character leaves the list keel shows.
    expect(p.table!.characters.map(c => c.id)).toEqual([WHITE.id, LINCOLN.id]);
    expect(redeemed).toHaveLength(0);
  });

  it('a table with no list asks each name, and the fresh Character takes it', async () => {
    serve([tablePass({ characters: [], taken: [] })]);
    const p = await previewJoin(TABLE);
    expect(p.table).toMatchObject({ nameRequired: true, characters: [] });
    const unnamed = await redeemPlayerJoin(TABLE).catch(e => e);
    expect(isPickRefused(unnamed)).toBe(false);
    expect(unnamed).toMatchObject({ status: 422, param: 'name' });
    expect((await redeemPlayerJoin(TABLE, 'Briony')).character.name).toBe('Briony');
  });

  it('a full link is the one 404, and a full world is world_full, on a table and on a link for one', async () => {
    serve([tablePass({ maxUses: 2 }), pass({ code: CODE, reader: 'player', worldFull: true })]);
    await redeemPlayerJoin(TABLE, '', WHITE.id);
    await redeemPlayerJoin(TABLE, '', DONIPHAN.id);
    expect(isRefusedCode(await redeemPlayerJoin(TABLE, '', DONIPHAN.id).catch(e => e))).toBe(true);
    const full = await redeemPlayerJoin(CODE).catch(e => e);
    expect([isWorldFull(full), isPickRefused(full), isRefusedCode(full)]).toEqual([true, false, false]);
  });
});
