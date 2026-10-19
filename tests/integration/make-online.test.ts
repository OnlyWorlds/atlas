/**
 * make-online — integration test against MSW + MockFolderStore.
 *
 * Covers the two Make-Online routes (Bouts F+G):
 *   - Route 1 (`createApiWorld`): signed out it refuses and sends nothing
 *     (the v1 create-world-external lane is retired, Keel #134, S432); the
 *     signed-in lane is in account-worlds.test.ts.
 *   - Route 2 (`mergeLocalIntoApi`): merges local folder state into an
 *     existing api world per the chosen policy (b = overwrite-on-match,
 *     c = push-only-new).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mswServer } from '../setup';
import { statefulOwHandlers, statefulV2Handlers } from '../msw-handlers';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import {
  createApiWorld,
  mergeLocalIntoApi,
  setMakeOnlineBaseUrl,
} from '../../src/sync/make-online';

// statefulOwHandlers still serves the v1 create-world-external route, so a
// regression that called it would show in serverState.worldCreations.
// Route 2 element CRUD + /bulk goes through the v2 adapter against the keel v2
// MSW at the /api/v2 sibling base.
const TEST_BASE = 'https://test-ow.local/api/worldapi';
const V2_BASE = 'https://test-ow.local/api/v2';

let serverState: ReturnType<typeof statefulOwHandlers>;
let clock: MonotonicClock;
let folder: MockFolderStore;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  // v1 handlers: the retired create-world-external route, as a tripwire.
  // v2 handlers serve all element CRUD + /bulk (Route 2).
  serverState = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
  const v2 = statefulV2Handlers({ baseUrl: V2_BASE, clock: clock.next });
  mswServer.use(...serverState.handlers, ...v2.handlers);
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  setMakeOnlineBaseUrl(TEST_BASE);
});

afterEach(() => {
  mswServer.resetHandlers();
  setMakeOnlineBaseUrl(TEST_BASE); // reset for next test; helper is module-level
});

function makeAdapter(): OwV2ClientAdapter {
  return new OwV2ClientAdapter({ apiKey: 'test-key', apiPin: '1234', baseUrl: V2_BASE });
}

// ---------------------------------------------------------------------------
// Route 1 — createApiWorld
// ---------------------------------------------------------------------------

describe('createApiWorld (Route 1)', () => {
  it('signed out: refuses with a sign-in line and sends nothing (Keel #134)', async () => {
    const sent: string[] = [];
    const onRequest = ({ request }: { request: Request }) => { sent.push(`${request.method} ${request.url}`); };
    mswServer.events.on('request:start', onRequest);
    try {
      await expect(createApiWorld({ name: 'My World', pin: '4242' })).rejects.toThrow(/Sign in to OnlyWorlds first/);
    } finally {
      mswServer.events.removeListener('request:start', onRequest);
    }
    expect(sent).toEqual([]);
    expect(serverState.worldCreations).toHaveLength(0);
  });

  it('throws when the name is missing', async () => {
    await expect(createApiWorld({ name: '', pin: '1' })).rejects.toThrow(/name/i);
    expect(serverState.worldCreations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Route 2 — mergeLocalIntoApi
// ---------------------------------------------------------------------------

describe('mergeLocalIntoApi (Route 2)', () => {
  it('policy b — creates new locals and updates duplicates on the server', async () => {
    // Server has one character "Alice" already.
    const adapter = makeAdapter();
    await adapter.createElement('character', { id: 'srv-alice', name: 'Alice' });

    // Local folder has Alice (name match, different id) + Bob (new).
    await folder.createElement('character', { name: 'Alice' });
    await folder.createElement('character', { name: 'Bob' });

    const result = await mergeLocalIntoApi(folder, adapter, 'b');

    expect(result.creates).toBe(1);
    expect(result.updates).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failures).toEqual([]);

    // Server now has 2 characters (Alice still id=srv-alice, Bob freshly created).
    const list = await adapter.listElements('character');
    expect(list).toHaveLength(2);
    expect(list.find(r => r.id === 'srv-alice')?.name).toBe('Alice');
    expect(list.some(r => r.name === 'Bob')).toBe(true);

    // Both local elements have server_updated_at stamped.
    const localAfter = await folder.listElements();
    expect(localAfter.every(e => e.server_updated_at)).toBe(true);
  });

  it('policy c — skips matched locals (no server change) but creates new locals', async () => {
    const adapter = makeAdapter();
    await adapter.createElement('character', { id: 'srv-alice', name: 'Alice' });

    await folder.createElement('character', { name: 'Alice' }); // duplicate by name
    await folder.createElement('character', { name: 'Bob' });   // new

    const result = await mergeLocalIntoApi(folder, adapter, 'c');

    expect(result.creates).toBe(1);
    expect(result.updates).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failures).toEqual([]);

    // Server-side: Alice untouched (same updated_at as before), Bob added.
    const list = await adapter.listElements('character');
    expect(list).toHaveLength(2);
  });

  it('matches by id first, name+type as fallback', async () => {
    // Server has Alice at id "abc". Local has Alice at id "abc" too → id-match.
    const adapter = makeAdapter();
    await adapter.createElement('character', { id: 'abc', name: 'Alice' });

    await folder.createElement('character', { id: 'abc', name: 'Alice' });

    const result = await mergeLocalIntoApi(folder, adapter, 'b');

    expect(result.updates).toBe(1);
    expect(result.creates).toBe(0);
  });

  it('per-element resilience: one failure does not abort others', async () => {
    const adapter = makeAdapter();
    // Three local-only creates → one atomic /bulk. Bob carries an unknown
    // non-namespaced field the v2 server rejects (422). Under atomic /bulk the
    // whole batch rolls back, but the merge retries the survivors once — so
    // Alice + Carol still land while Bob is surfaced as the lone failure.
    await folder.createElement('character', { name: 'Alice' });
    await folder.createElement('character', { name: 'Bob', mood: 'unknowable' });
    await folder.createElement('character', { name: 'Carol' });

    const result = await mergeLocalIntoApi(folder, adapter, 'b');

    expect(result.creates).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].type).toBe('character');

    // End state: Alice + Carol on the server, Bob absent.
    const list = await adapter.listElements('character');
    expect(list.map(r => r.name).sort()).toEqual(['Alice', 'Carol']);
  });

  it('progress callback fires for each local element', async () => {
    const adapter = makeAdapter();
    await folder.createElement('character', { name: 'A' });
    await folder.createElement('character', { name: 'B' });
    await folder.createElement('character', { name: 'C' });

    const events: Array<{ done: number; total: number; phase: string }> = [];
    await mergeLocalIntoApi(folder, adapter, 'b', (p) => events.push({ ...p }));

    const apply = events.filter(e => e.phase === 'apply');
    expect(apply).toHaveLength(3);
    expect(apply.map(e => e.done)).toEqual([1, 2, 3]);
    expect(apply.every(e => e.total === 3)).toBe(true);
  });

  // ---- Bidirectional merge (3.5+) ----

  it('downloads server-only elements into local folder', async () => {
    const adapter = makeAdapter();
    // Server has two elements local doesn't know about.
    await adapter.createElement('character', { id: 'srv-1', name: 'ServerAlice' });
    await adapter.createElement('location', { id: 'srv-loc-1', name: 'ServerShire' });
    // Local has one element server doesn't have.
    await folder.createElement('character', { name: 'LocalBob' });

    const result = await mergeLocalIntoApi(folder, adapter, 'b');

    expect(result.creates).toBe(1);      // LocalBob pushed
    expect(result.downloaded).toBe(2);   // ServerAlice + ServerShire pulled
    expect(result.updates).toBe(0);
    expect(result.skipped).toBe(0);

    // Local now has 3 elements: LocalBob (original local id), ServerAlice + ServerShire (server ids).
    const localAfter = await folder.listElements();
    expect(localAfter).toHaveLength(3);
    expect(localAfter.find(e => e.id === 'srv-1')?.name).toBe('ServerAlice');
    expect(localAfter.find(e => e.id === 'srv-loc-1')?.name).toBe('ServerShire');
  });

  it('id-swap on policy b name+type match: local file moves to server id, old file silently removed', async () => {
    const adapter = makeAdapter();
    await adapter.createElement('character', { id: 'srv-alice', name: 'Alice' });

    // Local Alice has a different (random) id.
    const localAlice = await folder.createElement('character', { name: 'Alice' });
    expect(localAlice.id).not.toBe('srv-alice');

    const result = await mergeLocalIntoApi(folder, adapter, 'b');
    expect(result.updates).toBe(1);

    // Local now has Alice at srv-alice; the old local id is gone.
    expect(await folder.getElement('srv-alice')).not.toBeNull();
    expect(await folder.getElement(localAlice.id)).toBeNull();

    // No tombstone written for the silent removal (otherwise next sync would
    // try to DELETE srv-alice on the server, undoing the merge).
    const tombs = await folder.listTombstonesSince(null);
    expect(tombs.find(t => t.id === localAlice.id)).toBeUndefined();
  });

  it('id-swap on policy c name+type match: local file adopts server content + id', async () => {
    const adapter = makeAdapter();
    await adapter.createElement('character', { id: 'srv-alice', name: 'Alice', description: 'wizardly' });

    const localAlice = await folder.createElement('character', { name: 'Alice', description: 'sneaky' });

    const result = await mergeLocalIntoApi(folder, adapter, 'c');
    expect(result.skipped).toBe(1);

    // Local Alice has server's content + server's id.
    const adoptedAlice = await folder.getElement('srv-alice');
    expect(adoptedAlice?.description).toBe('wizardly');
    // Old local file gone.
    expect(await folder.getElement(localAlice.id)).toBeNull();
  });

  it('rewrites foreign-key references after id-swap (single-link field)', async () => {
    const adapter = makeAdapter();
    await adapter.createElement('species', { id: 'srv-hobbit', name: 'Hobbit' });

    // Local species + local character referencing it.
    const localHobbit = await folder.createElement('species', { name: 'Hobbit' });
    await folder.createElement('character', { name: 'Frodo', species: localHobbit.id });

    await mergeLocalIntoApi(folder, adapter, 'b');

    const frodo = (await folder.listElements()).find(e => e.name === 'Frodo');
    expect(frodo?.species).toBe('srv-hobbit');
    // Old local species id is no longer referenced anywhere.
    expect(frodo?.species).not.toBe(localHobbit.id);
  });

  it('rewrites foreign-key references in array fields after id-swap', async () => {
    const adapter = makeAdapter();
    await adapter.createElement('species', { id: 'srv-hobbit', name: 'Hobbit' });

    const localHobbit = await folder.createElement('species', { name: 'Hobbit' });
    await folder.createElement('character', {
      name: 'Frodo',
      species_ids: [localHobbit.id, 'other-id-untouched'],
    });

    await mergeLocalIntoApi(folder, adapter, 'b');

    const frodo = (await folder.listElements()).find(e => e.name === 'Frodo');
    expect(frodo?.species_ids).toEqual(['srv-hobbit', 'other-id-untouched']);
  });

  it('new local CREATE that references a name-matched element sends server id, not local id', async () => {
    // Captain's scenario: matched char has different ids local vs server.
    // Two new local chars reference the matched one via FK (friends field).
    // After merge, server should have those new chars with friends pointing
    // at the SERVER's id of the matched char — not the stale local id.
    const adapter = makeAdapter();
    await adapter.createElement('character', { id: 'srv-alice', name: 'Alice' });

    // Local Alice with a different (random) id.
    const localAlice = await folder.createElement('character', { name: 'Alice' });
    // Two new locals that reference Alice via FK.
    const bob = await folder.createElement('character', { name: 'Bob', friends: [localAlice.id] });
    const carol = await folder.createElement('character', { name: 'Carol', friends: [localAlice.id] });

    await mergeLocalIntoApi(folder, adapter, 'b');

    // Server-side: bob and carol's friends_ids should point at 'srv-alice',
    // NOT localAlice.id. (Wire shape uses friends_ids per FIELD_SCHEMA;
    // the test MSW handler doesn't run prepareRelations, so we check whatever
    // form the body was sent in.)
    const charsOnServer = await adapter.listElements('character');
    const serverBob = charsOnServer.find(c => c.name === 'Bob')!;
    const serverCarol = charsOnServer.find(c => c.name === 'Carol')!;
    // Adapter normalizes _ids back to bare on read.
    const bobFriends = (serverBob.friends as string[] | undefined) ?? (serverBob.friends_ids as string[] | undefined);
    const carolFriends = (serverCarol.friends as string[] | undefined) ?? (serverCarol.friends_ids as string[] | undefined);
    expect(bobFriends).toEqual(['srv-alice']);
    expect(carolFriends).toEqual(['srv-alice']);

    // Local files also have the correct refs.
    const localAfter = await folder.listElements();
    const localBob = localAfter.find(e => e.name === 'Bob')!;
    const localCarol = localAfter.find(e => e.name === 'Carol')!;
    expect(localBob.friends).toEqual(['srv-alice']);
    expect(localCarol.friends).toEqual(['srv-alice']);
    void bob; void carol;
  });

  it('lands local-only CREATEs at their client ids under v2 (no id reassignment)', async () => {
    // v2 preserves client ids (no server-side v7 reassignment), so a Route 2
    // merge of never-synced locals lands each at its own id with a stamped
    // baseline — no id-swap, no silent-removal, no tombstones. This is the v2
    // shape of the "vanished from server" regression guard: with ids stable
    // there is no vector for the false positive at all.
    const adapter = makeAdapter();
    // Server starts empty (no matches). Local has 2 unique characters → /bulk.
    const a = await folder.createElement('character', { name: 'NewA' });
    const b = await folder.createElement('character', { name: 'NewB' });

    const result = await mergeLocalIntoApi(folder, adapter, 'b');

    expect(result.creates).toBe(2);
    expect(result.failures).toEqual([]);

    // Files stay at their client ids, both baselined.
    expect(await folder.getElement(a.id)).not.toBeNull();
    expect(await folder.getElement(b.id)).not.toBeNull();
    const allLocal = await folder.listElements();
    expect(allLocal).toHaveLength(2);
    expect(allLocal.find(e => e.name === 'NewA')!.server_updated_at).toBeTruthy();
    expect(allLocal.find(e => e.name === 'NewB')!.server_updated_at).toBeTruthy();

    // Both present on the server at their client ids.
    expect(await adapter.getElement('character', a.id)).not.toBeNull();
    expect(await adapter.getElement('character', b.id)).not.toBeNull();

    // No tombstones — nothing was silently removed.
    const tombs = await folder.listTombstonesSince(null);
    expect(tombs).toHaveLength(0);
  });

  it('matched element references new local elements via FK — both directions push correctly', async () => {
    // Captain's bug: Alice (matched by name) has friends pointing at
    // locally-created Bob and Carol. The merge must CREATE Bob + Carol before
    // UPDATEing Alice, so Alice's friends reference ids the server already has
    // (else the v2 FK validator 400s the dangling link). v2 preserves client
    // ids, so those ids ARE Bob's and Carol's local ids.
    const adapter = makeAdapter();
    // srv-alice on the server (v2 preserves the client-supplied id).
    await adapter.createElement('character', { id: 'srv-alice', name: 'Alice' });

    const bob = await folder.createElement('character', { name: 'Bob' });
    const carol = await folder.createElement('character', { name: 'Carol' });
    await folder.createElement('character', {
      name: 'Alice',
      friends: [bob.id, carol.id],
    });

    await mergeLocalIntoApi(folder, adapter, 'b');

    const charsOnServer = await adapter.listElements('character');
    const serverAlice = charsOnServer.find(c => c.id === 'srv-alice')!;
    const serverBob = charsOnServer.find(c => c.name === 'Bob')!;
    const serverCarol = charsOnServer.find(c => c.name === 'Carol')!;
    // Ids preserved under v2.
    expect(serverBob.id).toBe(bob.id);
    expect(serverCarol.id).toBe(carol.id);
    // Alice's friends resolve to Bob/Carol on the server (created first, so the
    // FK validator accepted the matched UPDATE).
    const aliceFriends = (serverAlice.friends as string[] | undefined) ?? (serverAlice.friends_ids as string[] | undefined) ?? [];
    expect(aliceFriends).toContain(bob.id);
    expect(aliceFriends).toContain(carol.id);
  });

  it('chain-CREATE: new element references another new element — server receives the resolved FK', async () => {
    // A new Carol references a new Bob. Both land in one atomic /bulk whose
    // server-side fixpoint resolves the in-batch reference (Bob's id is present
    // in the same batch), so Carol.friends points at Bob on the server. v2
    // preserves client ids, so that id IS Bob's local id.
    const adapter = makeAdapter();

    // Local Bob (no FK) + local Carol (friends -> Bob's id).
    const bob = await folder.createElement('character', { name: 'Bob' });
    await folder.createElement('character', { name: 'Carol', friends: [bob.id] });

    await mergeLocalIntoApi(folder, adapter, 'b');

    const charsOnServer = await adapter.listElements('character');
    const serverBob = charsOnServer.find(c => c.name === 'Bob')!;
    const serverCarol = charsOnServer.find(c => c.name === 'Carol')!;
    expect(serverBob.id).toBe(bob.id);
    // Carol's friends on the SERVER resolve to Bob.
    const serverCarolFriends =
      (serverCarol.friends as string[] | undefined) ??
      (serverCarol.friends_ids as string[] | undefined) ??
      [];
    expect(serverCarolFriends).toContain(bob.id);
  });

  it('chain-CREATE three deep: A → B → C resolved by one atomic /bulk', async () => {
    // Three new locals in a forward chain. One atomic /bulk resolves the whole
    // chain server-side (fixpoint FK resolution over the in-batch id set), so
    // B.friends → A and C.friends → B on the server. v2 preserves client ids.
    const adapter = makeAdapter();

    const a = await folder.createElement('character', { name: 'A' });
    const b = await folder.createElement('character', { name: 'B', friends: [a.id] });
    const c = await folder.createElement('character', { name: 'C', friends: [b.id] });

    await mergeLocalIntoApi(folder, adapter, 'b');

    const charsOnServer = await adapter.listElements('character');
    const sA = charsOnServer.find(x => x.name === 'A')!;
    const sB = charsOnServer.find(x => x.name === 'B')!;
    const sC = charsOnServer.find(x => x.name === 'C')!;
    expect(sA.id).toBe(a.id);
    expect(sB.id).toBe(b.id);
    expect(sC.id).toBe(c.id);

    const bFriends =
      (sB.friends as string[] | undefined) ??
      (sB.friends_ids as string[] | undefined) ??
      [];
    const cFriends =
      (sC.friends as string[] | undefined) ??
      (sC.friends_ids as string[] | undefined) ??
      [];
    expect(bFriends).toContain(a.id);
    expect(cFriends).toContain(b.id);
  });

  it('matchByName=false: same-name elements are treated as separate items', async () => {
    const adapter = makeAdapter();
    // Server has Alice.
    await adapter.createElement('character', { id: 'srv-alice', name: 'Alice' });
    // Local also has Alice (different id, same name) + a unique Bob.
    await folder.createElement('character', { name: 'Alice' });
    await folder.createElement('character', { name: 'Bob' });

    // With matchByName=false, local Alice should NOT match server Alice;
    // both end up on server as separate elements with different ids.
    const result = await mergeLocalIntoApi(folder, adapter, 'b', { matchByName: false });

    expect(result.updates).toBe(0);  // no name match or same-id match
    expect(result.creates).toBe(2);  // local Alice + Bob both pushed as new
    expect(result.downloaded).toBe(1);  // srv-alice has no local match → pulled

    // Server now has 3 characters: srv-alice + new Alice + Bob.
    const list = await adapter.listElements('character');
    expect(list).toHaveLength(3);
    expect(list.filter(c => c.name === 'Alice')).toHaveLength(2); // both Alices coexist
    expect(list.find(c => c.name === 'Bob')).toBeDefined();
  });

  it('counts all three buckets across multiple types', async () => {
    const adapter = makeAdapter();
    // Server has: 1 char (Alice), 1 location (Shire) — neither matches local.
    await adapter.createElement('character', { id: 's-a', name: 'ServerAlice' });
    await adapter.createElement('location', { id: 's-s', name: 'ServerShire' });
    // Local has: 1 char same name (will swap), 1 char new, 1 location new.
    await folder.createElement('character', { name: 'ServerAlice' }); // name-match → swap
    await folder.createElement('character', { name: 'LocalCarol' });
    await folder.createElement('location', { name: 'LocalForest' });

    const result = await mergeLocalIntoApi(folder, adapter, 'b');

    expect(result.creates).toBe(2);      // LocalCarol, LocalForest
    expect(result.updates).toBe(1);      // name-matched ServerAlice
    expect(result.skipped).toBe(0);
    expect(result.downloaded).toBe(1);   // ServerShire (no local match)
    expect(result.failures).toEqual([]);
  });
});

// (S367) The MergeOpts.onIdSwap tests retired with the callback: Route 2 now
// moves ids with the re-key kernel BEFORE any server call and the app follows
// once, after (`rekeyLiveUi`). Covered by tests/integration/make-online.kernel.test.ts.

// ---------------------------------------------------------------------------
// S361 (the id census): a name-matched swap wrote the SERVER's record at the
// SERVER's id, where no local file existed, so every atlas-only field was
// dropped with the old file: the writing's rich text, page blocks and the
// publish record, aliases, the map image binding.
// ---------------------------------------------------------------------------

describe('mergeLocalIntoApi matched swap keeps atlas-only fields', () => {
  const LOCAL_ONLY = {
    atlas_richtext_json: { type: 'doc', content: [] },
    atlas_aliases: ['the Lady'],
    image_media_id: 'media-1',
  };

  it('policy b: every atlas-only field lands at the server id', async () => {
    const adapter = makeAdapter();
    await adapter.createElement('narrative', { id: 's-n', name: 'Chapter One' });
    await folder.createElement('narrative', { name: 'Chapter One', ...LOCAL_ONLY } as never);

    const result = await mergeLocalIntoApi(folder, adapter, 'b');
    expect(result.failures).toEqual([]);
    const at = await folder.getElement('s-n') as unknown as Record<string, unknown>;
    expect(at.atlas_richtext_json).toEqual(LOCAL_ONLY.atlas_richtext_json);
    expect(at.atlas_aliases).toEqual(LOCAL_ONLY.atlas_aliases);
    expect(at.image_media_id).toBe('media-1');
  });

  it('policy c: the server prose wins, atlas bindings survive', async () => {
    const adapter = makeAdapter();
    await adapter.createElement('narrative', { id: 's-n', name: 'Chapter One' });
    await folder.createElement('narrative', { name: 'Chapter One', ...LOCAL_ONLY } as never);

    await mergeLocalIntoApi(folder, adapter, 'c');
    const at = await folder.getElement('s-n') as unknown as Record<string, unknown>;
    expect(at.atlas_richtext_json).toBeUndefined();
    expect(at.atlas_aliases).toEqual(LOCAL_ONLY.atlas_aliases);
    expect(at.image_media_id).toBe('media-1');
  });
});
