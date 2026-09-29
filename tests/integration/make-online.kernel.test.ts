/**
 * Route 2 on the re-key kernel (S366/S367 rebuild), on the REAL FsFolderStore
 * over `fixtures/fake-fs.ts` and the production v2 adapter over the stateful
 * keel-v2 MSW. Tests first: each row asserts the FIXED behaviour of the lane A
 * hazard it names (`Forge/Notes/2026-09-29-s365-orient/lane-a-route2.md` §2,
 * invariants §5; amendments in `Forge/Notes/2026-09-29-s366-orient/
 * lane-b-route2-recheck.md` §4 step 1). The probes that reproduce each hazard
 * at HEAD live beside those notes (`probes/lane-a/a-route2-losses.probe.test.ts`).
 *
 * The contract driven here: `mergeLocalIntoApi(folder, adapter, policy, { worldId })`
 * refuses beside a re-key journal before any server write; plans with a
 * two-pass matcher (ids first, then unique trimmed NFC lowercase names per
 * type); moves every local reference through the journaled kernel; only then
 * talks to the server, every op same-id. `MergeResult.ambiguous` reports the
 * names it would not match.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { mergeLocalIntoApi, type MergeResult } from '../../src/sync/make-online';
import { SyncEngine } from '../../src/sync/sync-engine';
import { recoverRekey } from '../../src/store/rekey';
import { elementFilename } from '../../src/store/fs-utils';
import type { RekeyJournal } from '../../src/store/folder-store';

const V2 = 'https://test-ow.local/api/v2';
const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 1, 1, 0, 0, t++)).toISOString();
const LOCAL_T = '2026-01-01T00:00:00.000Z';
const JOURNAL = '.atlas/rekey-journal.json';

const O = '00000000-0000-4000-8000-0000000000a1';     // local Alice
const N = '00000000-0000-4000-8000-0000000000b1';     // server Alice
const O2 = '00000000-0000-4000-8000-0000000000a2';    // local Bree
const N2 = '00000000-0000-4000-8000-0000000000b2';    // server Bree
const R = '00000000-0000-4000-8000-0000000000c1';     // local referrer narrative
const P = '00000000-0000-4000-8000-0000000000c2';     // local page
const S = '00000000-0000-4000-8000-0000000000e1';     // server-only location
const OLATE = '00000000-0000-4000-8000-0000000000f1'; // local Alice whose id tail sorts AFTER N's

let server: ReturnType<typeof statefulV2Handlers>;
let adapter: OwV2ClientAdapter;

/** A new keel world and a client for it (the crash matrix needs one per attempt). */
function freshServer(): void {
  server = statefulV2Handlers({ baseUrl: V2, clock });
  mswServer.use(...server.handlers);
  adapter = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: V2 });
}
beforeEach(freshServer);

function world(): FakeDirHandle {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  return root;
}
function putEl(root: FakeDirHandle, el: Record<string, unknown>): void {
  root.put(`elements/${el.type}/${elementFilename(el.id as string, el.name as string)}`, j({ local_updated_at: LOCAL_T, ...el }));
}
function putMedia(root: FakeDirHandle, elementId: string, mediaId: string): void {
  root.put(`media/${elementId}/default/pic.png`, 'PNG');
  root.put(`media/${elementId}/default/${mediaId}.meta.json`, j({ id: mediaId, element_id: elementId, folder: 'default', filename: 'pic.png', mime: 'image/png', size_bytes: 3, added_at: 'x' }));
}
async function open(root: FakeDirHandle): Promise<FsFolderStore> {
  const s = new FsFolderStore({ clock, tabId: 't', disableHeartbeat: true, forceTakeLock: true });
  await s.open(root as unknown as FileSystemDirectoryHandle);
  return s;
}
function srv(type: string): Map<string, Record<string, unknown>> {
  return (server.state.get(type) ?? new Map()) as Map<string, Record<string, unknown>>;
}
function allServerRecords(): Array<Record<string, unknown>> {
  return [...server.state.values()].flatMap(m => [...m.values()] as Array<Record<string, unknown>>);
}
const named = (type: string, name: string) => [...srv(type).values()].filter(e => e.name === name);

// The rebuilt MergeOpts carries the local world id for the kernel journal.
const OPTS = { worldId: 'w1' } as unknown as Parameters<typeof mergeLocalIntoApi>[3];
const merge = (s: FsFolderStore, policy: 'b' | 'c') => mergeLocalIntoApi(s, adapter, policy, OPTS);
const ambiguousOf = (m: MergeResult) => (m as unknown as { ambiguous?: unknown }).ambiguous;

/** A sidecar naming `id` all three ways the serializer turns into ow:// links. */
const richOf = (id: string) => ({
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'elementChip', attrs: { id, type: 'character', label: 'Alice' } },
      { type: 'text', text: ' met ' },
      { type: 'mention', attrs: { id, label: 'Alice' } },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'Alice', marks: [{ type: 'link', attrs: { href: `ow://character/${id}` } }] },
    ],
  }],
});

describe('Route 2 on the kernel: every reference follows a name-match swap', () => {
  it('a name-match swap moves prose links, chips, link marks and page prose to the server id (H1, H2, H3; inv 4)', async () => {
    await adapter.createElement('character', { id: N, name: 'Alice' });
    const root = world();
    putEl(root, { id: O, type: 'character', name: 'Alice' });
    putEl(root, {
      id: R, type: 'narrative', name: 'Tale', characters: [O],
      story: `[Alice](ow://character/${O}) waits.`,
      atlas_richtext_json: richOf(O),
    });
    putEl(root, {
      id: P, type: 'narrative', name: 'Page', subtype: 'page',
      atlas_page_blocks: [
        { id: 'b1', kind: 'element-card', elementId: O, variant: 'compact', fields: [] },
        { id: 'b2', kind: 'prose', markdown: `See [Alice](ow://character/${O}).`, richtextJson: richOf(O) },
      ],
      atlas_page_refs: [O],
    });
    const s = await open(root);
    const m = await merge(s, 'b');
    expect(m.failures).toEqual([]);
    expect(await s.getElement(O)).toBeNull();

    const tale = (await s.getElement(R))!;
    expect(JSON.stringify(tale)).not.toContain(O);
    expect(tale.characters).toEqual([N]);
    expect(String(tale.story)).toContain(`ow://character/${N}`);
    expect(JSON.stringify(tale.atlas_richtext_json).split(N).length - 1).toBe(3); // chip, mention, link mark

    const page = (await s.getElement(P))!;
    expect(JSON.stringify(page)).not.toContain(O);
    const raw = page.atlas_page_blocks as Array<Record<string, unknown>>;
    expect(raw[0].elementId).toBe(N); // raw, not only healed at read through the refs mirror
    expect(String(raw[1].markdown)).toContain(`ow://character/${N}`);

    // The server copy of the referrer was sent after the kernel: it names N too.
    expect(String(srv('narrative').get(R)?.story)).toContain(`ow://character/${N}`);
    expect(JSON.stringify(srv('narrative').get(R))).not.toContain(O);
  });

  it('the swapped element\'s own rich text follows the other swaps (H4)', async () => {
    await adapter.createElement('character', { id: N, name: 'Alice' });
    await adapter.createElement('character', { id: N2, name: 'Bree' });
    const root = world();
    putEl(root, { id: O, type: 'character', name: 'Alice', story: `Friend of [Bree](ow://character/${O2}).`, atlas_richtext_json: richOf(O2) });
    putEl(root, { id: O2, type: 'character', name: 'Bree', story: `Friend of [Alice](ow://character/${O}).`, atlas_richtext_json: richOf(O) });
    const s = await open(root);
    const m = await merge(s, 'b');
    expect(m.failures).toEqual([]);

    const alice = (await s.getElement(N))!;
    const bree = (await s.getElement(N2))!;
    expect(JSON.stringify(alice)).not.toContain(O2);
    expect(JSON.stringify(bree)).not.toContain(O);
    expect(String(alice.story)).toContain(`ow://character/${N2}`);
    expect(JSON.stringify(alice.atlas_richtext_json)).toContain(N2);
    expect(String(bree.story)).toContain(`ow://character/${N}`);
    expect(JSON.stringify(bree.atlas_richtext_json)).toContain(N);
    // The PATCHed server stories name the server ids, never a dead local one.
    expect(String(srv('character').get(N)?.story)).toContain(`ow://character/${N2}`);
    expect(String(srv('character').get(N2)?.story)).toContain(`ow://character/${N}`);
    expect(JSON.stringify(allServerRecords())).not.toMatch(new RegExp(`${O}|${O2}`));
  });

  it('a bare uuid typed as a whole prose value is left alone (H5; inv 5)', async () => {
    await adapter.createElement('character', { id: N, name: 'Alice' });
    const root = world();
    putEl(root, { id: O, type: 'character', name: 'Alice' });
    putEl(root, { id: R, type: 'narrative', name: 'Tale', description: O, characters: [O] });
    const s = await open(root);
    await merge(s, 'b');
    const tale = (await s.getElement(R))!;
    expect(tale.description).toBe(O); // text a writer typed, not a link
    expect(tale.characters).toEqual([N]); // the relation beside it still follows
  });

  it('the swapped element\'s media moves with it (H6; inv 6)', async () => {
    await adapter.createElement('map', { id: N, name: 'Atlas Map' });
    const root = world();
    putEl(root, { id: O, type: 'map', name: 'Atlas Map', image_media_id: 'm1' });
    putMedia(root, O, 'm1');
    const s = await open(root);
    await merge(s, 'b');
    await s.awaitTidies();
    const map = (await s.getElement(N))!;
    expect(map.image_media_id).toBe('m1');
    expect((await s.listMedia(N)).map(x => x.id)).toEqual(['m1']); // the map image row finds its file
    expect(root.get(`media/${N}/default/pic.png`)).toBe('PNG');
    expect(root.list().filter(p => p.startsWith(`media/${O}/`))).toEqual([]); // no orphan
  });
});

/**
 * H9 (the crash window) and invariants 1-2. A crash at the k-th call of each
 * kernel store method, counted only while the journal file is on disk (the
 * kernel window), for both id-tail orders (H9a converged by luck, H9b
 * duplicated Alice on the server). The first, clean run of each case counts
 * how many calls the kernel makes, so the matrix follows the kernel's shape.
 */
describe('Route 2 on the kernel: a crash inside the swap, then recovery and a rerun', () => {
  const KERNEL_METHODS = ['createElementVerbatim', 'copyMediaDir', 'updateElementWith', 'deleteElement', 'removeMediaDir'] as const;
  type KernelMethod = typeof KERNEL_METHODS[number];
  type Fn = (...a: unknown[]) => unknown;

  async function crashWorld(oId: string): Promise<{ root: FakeDirHandle; s: FsFolderStore; seeded: number }> {
    freshServer();
    await adapter.createElement('character', { id: N, name: 'Alice', description: 'server' });
    const root = world();
    putEl(root, { id: oId, type: 'character', name: 'Alice', description: 'local', image_media_id: 'm1' });
    putMedia(root, oId, 'm1');
    putEl(root, { id: R, type: 'narrative', name: 'Tale', characters: [oId], story: `[Alice](ow://character/${oId})` });
    const s = await open(root);
    return { root, s, seeded: server.opLog.length };
  }

  /** Wrap the kernel's store methods; count (and maybe fail) only calls made inside the journal window. */
  function instrument(s: FsFolderStore, root: FakeDirHandle, crash?: { method: KernelMethod; nth: number }) {
    const counts = Object.fromEntries(KERNEL_METHODS.map(m => [m, 0])) as Record<KernelMethod, number>;
    const rec = s as unknown as Record<KernelMethod, Fn>;
    const spies = KERNEL_METHODS.map(m => {
      const orig = rec[m].bind(s);
      return vi.spyOn(rec, m).mockImplementation((...a: unknown[]) => {
        if (root.get(JOURNAL) !== null) {
          counts[m]++;
          if (crash && crash.method === m && counts[m] === crash.nth) return Promise.reject(new Error('crash'));
        }
        return orig(...a);
      });
    });
    return { counts, restore: () => spies.forEach(sp => sp.mockRestore()) };
  }

  const cases: Array<{ policy: 'b' | 'c'; order: string; oId: string; method: KernelMethod }> = [];
  for (const policy of ['b', 'c'] as const) {
    for (const [order, oId] of [['old id tail sorts first (H9a)', O], ['old id tail sorts last (H9b)', OLATE]] as const) {
      for (const method of KERNEL_METHODS) cases.push({ policy, order, oId, method });
    }
  }

  it.each(cases)('policy $policy, $order, crash in $method: one Alice on the server, O gone, no write before the journal cleared', async ({ policy, oId, method }) => {
    const clean = await crashWorld(oId);
    const probe = instrument(clean.s, clean.root);
    await merge(clean.s, policy);
    probe.restore();
    const total = probe.counts[method];
    expect(total, `the merge never called ${method} inside a re-key journal`).toBeGreaterThan(0);
    expect(named('character', 'Alice').map(a => a.id)).toEqual([N]);

    for (let k = 1; k <= total; k++) {
      const { root, s, seeded } = await crashWorld(oId);
      const crash = instrument(s, root, { method, nth: k });
      await expect(merge(s, policy), `k=${k}: the crash propagates`).rejects.toThrow();
      crash.restore();
      expect(server.opLog.length, `k=${k}: a server write happened before the journal cleared`).toBe(seeded);
      expect(await s.hasRekeyJournal(), `k=${k}: the journal is left for recovery`).toBe(true);

      await recoverRekey(s);
      const r = await merge(s, policy);
      expect(r.failures, `k=${k}`).toEqual([]);
      expect(named('character', 'Alice').map(a => a.id), `k=${k}: one Alice on the server`).toEqual([N]);
      expect(await s.getElement(oId), `k=${k}: O gone locally`).toBeNull();
      expect(await s.getElement(N), `k=${k}: N local`).not.toBeNull();
      expect(await s.hasRekeyJournal(), `k=${k}`).toBe(false);
      expect(JSON.stringify(allServerRecords()), `k=${k}: no server element names O`).not.toContain(oId);
    }
  });
});

describe('Route 2 on the kernel: the two-pass matcher', () => {
  it('an id-matched local keeps its content when a same-named twin exists (H10; inv 3)', async () => {
    await adapter.createElement('character', { id: N, name: 'Alice', description: 'server' });
    const root = world();
    putEl(root, { id: O, type: 'character', name: 'Alice', description: 'imported twin' }); // lists first (…a1 < …b1)
    putEl(root, { id: N, type: 'character', name: 'Alice', description: 'my edits' });
    const s = await open(root);
    const m = await merge(s, 'b');
    expect(m.failures).toEqual([]);
    expect((await s.getElement(N))!.description).toBe('my edits');
    expect((await s.getElement(O))?.description).toBe('imported twin'); // the twin is its own element
    expect(srv('character').get(N)?.description).toBe('my edits');
    expect(srv('character').get(O)?.description).toBe('imported twin');
    expect(ambiguousOf(m)).toEqual([]); // N left the name pool in pass 1: nothing ambiguous
  });

  it('a whitespace-only name does not match a blank server name (H11; inv 3)', async () => {
    await adapter.createElement('character', { id: N2, name: '' });
    const root = world();
    putEl(root, { id: O2, type: 'character', name: '   ' });
    const s = await open(root);
    const m = await merge(s, 'b');
    expect(m.failures).toEqual([]);
    expect(await s.getElement(O2)).not.toBeNull(); // uploaded as its own
    expect(srv('character').has(O2)).toBe(true);
    expect(await s.getElement(N2)).not.toBeNull(); // the blank server one is downloaded beside it
  });

  it('ambiguous names are not matched: two local Alices and one server Alice (inv 3)', async () => {
    await adapter.createElement('character', { id: N, name: 'Alice' });
    const root = world();
    putEl(root, { id: O, type: 'character', name: 'Alice', description: 'one' });
    putEl(root, { id: O2, type: 'character', name: 'Alice', description: 'two' });
    const s = await open(root);
    const m = await merge(s, 'b');
    expect(m.failures).toEqual([]);
    expect(await s.getElement(O)).not.toBeNull(); // no swap: first-in-list no longer wins
    expect(await s.getElement(O2)).not.toBeNull();
    expect(await s.getElement(N)).not.toBeNull(); // downloaded as its own
    expect(named('character', 'Alice').map(a => a.id).sort()).toEqual([O, O2, N].sort());
    expect(m.creates).toBe(2);
    expect(ambiguousOf(m)).toEqual([{ type: 'character', name: 'Alice' }]);
  });

  it('ambiguous names are not matched: one local Alice and two server Alices (inv 3)', async () => {
    const N3 = '00000000-0000-4000-8000-0000000000b3';
    await adapter.createElement('character', { id: N, name: 'Alice' });
    await adapter.createElement('character', { id: N3, name: 'alice ' });
    const root = world();
    putEl(root, { id: O, type: 'character', name: 'Alice' });
    const s = await open(root);
    const m = await merge(s, 'b');
    expect(m.failures).toEqual([]);
    expect(await s.getElement(O)).not.toBeNull();
    expect(srv('character').has(O)).toBe(true); // created, not swapped onto either
    expect(await s.getElement(N)).not.toBeNull();
    expect(await s.getElement(N3)).not.toBeNull();
    expect(m.downloaded).toBe(2);
    expect(ambiguousOf(m)).toEqual([{ type: 'character', name: 'Alice' }]);
  });

  it('names compare NFC-normalised: a local "Café" in NFD bytes matches the server\'s NFC "Café" (Captain Q5)', async () => {
    const nfc = 'Café';
    const nfd = 'Café';
    expect(nfc).not.toBe(nfd);
    await adapter.createElement('location', { id: N, name: nfc });
    const root = world();
    putEl(root, { id: O, type: 'location', name: nfd });
    const s = await open(root);
    const m = await merge(s, 'b');
    expect(m.failures).toEqual([]);
    expect(await s.getElement(O)).toBeNull(); // swapped
    expect(await s.getElement(N)).not.toBeNull();
    expect(srv('location').has(O)).toBe(false); // no create
    expect(srv('location').size).toBe(1);
    expect(m.creates).toBe(0);
  });
});

describe('Route 2 on the kernel: refusal beside an unfinished id update', () => {
  it('Route 2 refuses while an id update is unfinished, before any server write (R2; inv 10)', async () => {
    await adapter.createElement('character', { id: N, name: 'Alice' });
    const root = world();
    putEl(root, { id: O, type: 'character', name: 'Alice' });
    putEl(root, { id: '00000000-0000-4000-8000-0000000000d1', type: 'object', name: 'Cup' }); // local-only: today's merge uploads it
    const s = await open(root);
    const journal: RekeyJournal = {
      version: 1, world_id: 'w1', map: {}, types: {}, stamps: {}, unrewritten: [], started_at: LOCAL_T,
    };
    await s.writeRekeyJournal(journal);
    const seeded = server.opLog.length;
    await expect(merge(s, 'b')).rejects.toThrow();
    expect(server.opLog.length).toBe(seeded);
    expect(await s.getElement(O)).not.toBeNull();
    expect(await s.hasRekeyJournal()).toBe(true);
  });
});

describe('Route 2 on the kernel: what each policy keeps', () => {
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const T2 = '00000000-0000-4000-8000-0000000000d2'; // a narrative that id-matches (same id both sides)

  it('policy c drops the local sidecar on the real store, keeps atlas bindings (inv 7; real-store twin of make-online.test.ts:635)', async () => {
    await adapter.createElement('narrative', { id: N, name: 'Chapter One', story: 'server one' });
    await adapter.createElement('narrative', { id: T2, name: 'Chapter Two', story: 'server two' });
    const root = world();
    putEl(root, { id: O, type: 'narrative', name: 'Chapter One', story: 'local one', atlas_richtext_json: doc('local one'), image_media_id: 'm1', atlas_aliases: ['One'] });
    putEl(root, { id: T2, type: 'narrative', name: 'Chapter Two', story: 'local two', atlas_richtext_json: doc('local two'), image_media_id: 'm2', atlas_aliases: ['Two'] });
    const s = await open(root);
    const m = await merge(s, 'c');
    expect(m.failures).toEqual([]);
    expect(await s.getElement(O)).toBeNull();
    for (const [id, story, media, alias] of [[N, 'server one', 'm1', 'One'], [T2, 'server two', 'm2', 'Two']] as const) {
      const el = (await s.getElement(id)) as unknown as Record<string, unknown>;
      expect(el.story, id).toBe(story);
      expect(el.atlas_richtext_json, `${id}: the local prose copy goes with the local prose`).toBeUndefined();
      expect(el.image_media_id, id).toBe(media);
      expect(el.atlas_aliases, id).toEqual([alias]);
    }
  });

  it('policy b keeps every local field on a swap, and the server-only fields the PATCH returns (inv 7)', async () => {
    await adapter.createElement('character', { id: N, name: 'Alice', background: 'server background' });
    const root = world();
    putEl(root, {
      id: O, type: 'character', name: 'Alice', description: 'local description',
      story: 'local story', atlas_richtext_json: doc('local story'), atlas_aliases: ['Al'],
    });
    const s = await open(root);
    const m = await merge(s, 'b');
    expect(m.failures).toEqual([]);
    const el = (await s.getElement(N)) as unknown as Record<string, unknown>;
    expect(el.description).toBe('local description');
    expect(el.story).toBe('local story');
    expect(el.atlas_richtext_json).toEqual(doc('local story'));
    expect(el.atlas_aliases).toEqual(['Al']);
    expect(el.background).toBe('server background');
    expect(srv('character').get(N)?.description).toBe('local description');
  });
});

describe('Route 2 on the kernel, then the first /changes round (inv 11, inv 4)', () => {
  for (const policy of ['b', 'c'] as const) {
    it(`policy ${policy}: converges, no conflicts, no server-delete review, no second create, and no body names O`, async () => {
      await adapter.createElement('character', { id: N, name: 'Alice', description: 'server' });
      await adapter.createElement('location', { id: S, name: 'Server Only' });
      const root = world();
      putEl(root, { id: O, type: 'character', name: 'Alice', description: 'local' });
      putEl(root, { id: R, type: 'narrative', name: 'Tale', characters: [O], story: `[Alice](ow://character/${O})` });
      const s = await open(root);
      const m = await merge(s, policy);
      expect(m.failures).toEqual([]);
      const engine = new SyncEngine({ folder: s, client: adapter });
      const r = await engine.syncNow();
      expect(r.conflicts).toEqual([]);
      expect(await engine.listServerDeletes()).toEqual([]);
      expect(r.pushed.creates).toBe(0);
      expect(named('character', 'Alice').length).toBe(1);
      const r2 = await engine.syncNow();
      expect(r2.pushed).toEqual({ creates: 0, updates: 0, deletes: 0 });

      // Element files only: sync-state keeps O on purpose (the `rekeyed` map).
      const files = root.list().filter(p => p.startsWith('elements/'));
      expect(files.filter(p => (root.get(p) ?? '').includes(O))).toEqual([]);
      expect(JSON.stringify(allServerRecords())).not.toContain(O);
    });
  }
});
