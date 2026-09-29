/**
 * The re-key kernel (S363, `store/rekey.ts`). Rows follow re-key gate lens 1's
 * runway: each names the failure it catches.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import {
  startRekey, recoverRekey, RekeyRefusedError, rollbackRekey, staleRekeyedLinks, repairRekeyedLinks,
} from '../../src/store/rekey';
import { RekeyPendingError } from '../../src/store/folder-store';
import type { FolderStore } from '../../src/store/folder-store';
import type { Element } from '../../src/core/types';
import type { ChartConfig } from '../../src/visualization/timeline/types';

const W = 'world-1';
const SYNCED = '2026-01-01T00:00:00.000Z';

// Deterministic ids so an interrupted run and a clean one can be compared.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const minter = () => { let i = 900; return () => id(i++); };

let store: MockFolderStore;

function freshStore(): MockFolderStore {
  const s = new MockFolderStore();
  s.setClock(new MonotonicClock('2026-02-01T00:00:00.000Z').next);
  return s;
}

/** A small world: two foreign elements (a location and a character living there),
 *  their pins, a synced narrative that chips the character, a page, a chart, media. */
async function seed(s: MockFolderStore): Promise<void> {
  await s.createElement('map', { id: id(1), name: 'Map', server_updated_at: SYNCED } as Partial<Element>);
  await s.createElement('location', { id: id(10), name: 'Rivendell', atlas_aliases: ['Imladris'] } as Partial<Element>);
  await s.createElement('character', {
    id: id(11), name: 'Elrond', location: id(10), created_at: '2025-05-05T00:00:00.000Z',
    atlas_richtext_json: { type: 'doc', content: [] },
  } as Partial<Element>);
  await s.createElement('pin', { id: id(12), name: '', map_id: id(1), element_id: id(10), element_type: 'location', x: 1, y: 2 } as Partial<Element>);
  await s.createElement('narrative', {
    id: id(20), name: 'Council', server_updated_at: SYNCED, characters: [id(11)],
    story: `[Elrond](ow://character/${id(11)}) spoke.`,
    atlas_richtext_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'elementChip', attrs: { id: id(11), type: 'character', label: 'Elrond' } }] }] },
  } as Partial<Element>);
  await s.createElement('narrative', {
    id: id(21), name: 'Page', subtype: 'page', server_updated_at: SYNCED,
    atlas_page_blocks: [{ id: 'b1', kind: 'element-card', elementId: id(11), variant: 'compact', fields: [] }],
    atlas_page_refs: [id(11)],
  } as Partial<Element>);
  await s.createElement('object', { id: id(30), name: 'Untouched', server_updated_at: SYNCED } as Partial<Element>);
  // Every "synced" element reads clean: its baseline IS its last local write.
  for (const e of await s.listElements()) {
    if (e.server_updated_at) await s.stampServerUpdatedAt(e.id, e.type, e.local_updated_at, e.local_updated_at);
  }
  await s.addMedia(id(10), new File(['png-bytes'], 'rivendell.png', { type: 'image/png' }));
  await s.writeCharts([{ id: 'c1', name: 'c', scope: { kind: 'focus', elementId: id(11) } } as unknown as ChartConfig]);
  await s.updateSyncState(() => ({
    foreign: { api_world_id: 'api', ids: [{ id: id(10), type: 'location', first_seen: SYNCED }, { id: id(11), type: 'character', first_seen: SYNCED }] },
  }));
}

const FOREIGN = [id(10), id(11), id(12)];

beforeEach(async () => {
  store = freshStore();
  await store.open(null);
  await seed(store);
});

describe('the re-key kernel', () => {
  it('gives new ids and every link follows; nothing else changes', async () => {
    const r = await startRekey(store, { worldId: W, ids: FOREIGN, mintId: minter() });
    const [nLoc, nChar, nPin] = FOREIGN.map(o => r.map.get(o)!);
    for (const o of FOREIGN) expect(await store.getElement(o)).toBeNull();

    const loc = (await store.getElement(nLoc))!;
    expect(loc.name).toBe('Rivendell');
    expect(loc.atlas_aliases).toEqual(['Imladris']); // local-only fields carried
    const char = (await store.getElement(nChar))!;
    expect(char.location).toBe(nLoc); // new element names the new id (whole map, lens 2 F4)
    expect(char.created_at).toBe('2025-05-05T00:00:00.000Z');
    expect(char.server_updated_at).toBeUndefined();
    const pin = (await store.getElement(nPin))!;
    expect(pin.element_id).toBe(nLoc);

    const council = (await store.getElement(id(20)))!;
    expect(council.characters).toEqual([nChar]);
    expect(council.story).toBe(`[Elrond](ow://character/${nChar}) spoke.`);
    expect(JSON.stringify(council.atlas_richtext_json)).toContain(nChar);
    expect(council.local_updated_at > council.server_updated_at!).toBe(true); // goes out as an update

    const page = (await store.getElement(id(21)))!;
    expect(page.atlas_page_refs).toEqual([nChar]);

    // An element with no reference to an old id is not stamped (lens 1 F4).
    const untouched = (await store.getElement(id(30)))!;
    expect(untouched.local_updated_at <= untouched.server_updated_at!).toBe(true);

    expect(await store.listMedia(id(10))).toEqual([]);
    const media = await store.listMedia(nLoc);
    expect(media.map(m => m.element_id)).toEqual([nLoc]);
    expect(await store.getMediaBlob(media[0].id)).not.toBeNull();

    expect((await store.readCharts())[0].scope).toEqual({ kind: 'focus', elementId: nChar });
    expect((await store.readSyncState()).foreign?.ids).toEqual([]);
    expect(await store.hasRekeyJournal()).toBe(false);
  });

  it('a pin re-keyed without its element: no duplicate-pin refusal (lens 1 F2)', async () => {
    const r = await startRekey(store, { worldId: W, ids: [id(12)], mintId: minter() });
    const pin = (await store.getElement(r.map.get(id(12))!))!;
    expect(pin.element_id).toBe(id(10));
    expect(await store.getElement(id(12))).toBeNull();
  });

  it('a world that already holds two pins for one element on one map re-keys whole', async () => {
    // Written before the S307 guard existed: seeded around it.
    await store.createElementVerbatim('pin', { id: id(13), name: '', map_id: id(1), element_id: id(10), element_type: 'location', x: 5, y: 5 } as unknown as Element);
    const r = await startRekey(store, { worldId: W, ids: [id(10), id(12), id(13)], mintId: minter() });
    const pins = (await store.listElements('pin')).filter(p => p.element_id === r.map.get(id(10)));
    expect(pins.map(p => p.x).sort()).toEqual([1, 5]);
  });

  it('refuses, touching nothing: an uploaded element, a missing one, an unfinished journal', async () => {
    await expect(startRekey(store, { worldId: W, ids: [id(20)] })).rejects.toBeInstanceOf(RekeyRefusedError);
    await expect(startRekey(store, { worldId: W, ids: [id(99)] })).rejects.toBeInstanceOf(RekeyRefusedError);
    await store.writeRekeyJournal({ version: 1, world_id: W, map: {}, types: {}, stamps: {}, unrewritten: [], started_at: SYNCED });
    await expect(startRekey(store, { worldId: W, ids: [id(10)] })).rejects.toThrow(/unfinished/);
    expect(await store.getElement(id(10))).not.toBeNull();
  });

  it('a referrer that will not parse is skipped and named; the rest completes (lens 1 F7)', async () => {
    store.corruptIds.add(id(20));
    const r = await startRekey(store, { worldId: W, ids: FOREIGN, mintId: minter() });
    expect(r.unrewritten).toEqual([id(20)]);
    expect((await store.getElement(id(21)))!.atlas_page_refs).toEqual([r.map.get(id(11))]);
    expect(await store.hasRekeyJournal()).toBe(false);
  });

  it('an old element edited after the journal was written carries the edit (lens 1 F1 defence)', async () => {
    const mint = minter();
    const real = store.removeMediaDir.bind(store);
    let edited = false;
    // Step 6 begins after persisted state migrates; edit O at that seam.
    const r = await startRekey(store, { worldId: W, ids: [id(11)], mintId: mint }, {
      rekeyPersistedState: async () => {
        if (!edited) { edited = true; await store.updateElement(id(11), { description: 'late edit' }); }
      },
    });
    void real;
    expect((await store.getElement(r.map.get(id(11))!))!.description).toBe('late edit');
  });

  it('a journal pair whose old and new elements are both gone is dropped (lens 1 F6)', async () => {
    await store.writeRekeyJournal({
      version: 1, world_id: W, map: { [id(50)]: id(51) }, types: { [id(50)]: 'character' },
      stamps: {}, unrewritten: [], started_at: SYNCED,
    });
    await store.updateElement(id(30), { x_ref: id(50) } as Partial<Element>);
    await recoverRekey(store);
    expect((await store.getElement(id(30)))!.x_ref).toBe(id(50));
    expect(await store.hasRekeyJournal()).toBe(false);
  });
});

// ---- The crash matrix (lens 1 runway): every crash point converges. ----

const MUTATING = new Set([
  'createElementVerbatim', 'copyMediaDir', 'updateElementWith', 'writeCharts', 'deleteElement',
  'removeMediaDir', 'updateSyncState', 'writeRekeyJournal', 'clearRekeyJournal',
]);

function crashAfter(target: MockFolderStore, k: number): { store: FolderStore; calls: () => number } {
  let n = 0;
  const proxy = new Proxy(target, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv);
      if (typeof v !== 'function') return v;
      if (!MUTATING.has(prop as string)) return v.bind(t);
      return (...args: unknown[]) => {
        if (++n > k) throw new Error(`crash after ${k}`);
        return v.apply(t, args);
      };
    },
  });
  return { store: proxy as unknown as FolderStore, calls: () => n };
}

async function snapshot(s: MockFolderStore) {
  const els = (await s.listElements())
    .map(e => { const { local_updated_at: _l, created_at: _c, ...rest } = e; return rest; })
    .sort((a, b) => a.id.localeCompare(b.id));
  const media: Record<string, string[]> = {};
  for (const e of await s.listElements()) {
    const items = await s.listMedia(e.id);
    if (items.length) media[e.id] = items.map(m => `${m.filename}:${m.element_id}`);
  }
  for (const o of FOREIGN) {
    const items = await s.listMedia(o);
    if (items.length) media[`gone:${o}`] = items.map(m => m.filename);
  }
  return { els, media, charts: await s.readCharts(), foreign: (await s.readSyncState()).foreign, journal: await s.hasRekeyJournal() };
}

/**
 * Every link to a re-keyed id (old or new) resolves, in every element that
 * SURVIVES the re-key. New bodies are exempt inside step 2 (a new element can
 * name one not yet written), and old bodies inside step 6 (an old pin can name
 * an old location already removed; both are leaving, and recovery finishes
 * before anything reads the world).
 */
async function danglingOutsideNew(s: MockFolderStore, newIds: Set<string>): Promise<string[]> {
  const all = await s.listElements();
  const present = new Set(all.map(e => e.id));
  const watched = new Set([...FOREIGN, ...newIds]);
  const bad: string[] = [];
  for (const e of all) {
    if (newIds.has(e.id) || FOREIGN.includes(e.id)) continue;
    const text = JSON.stringify({ ...e, id: undefined });
    for (const w of watched) if (text.includes(w) && !present.has(w)) bad.push(`${e.id}→${w}`);
  }
  return bad;
}

describe('the crash matrix', () => {
  it('a crash after any write, then recovery, ends exactly where a clean run ends', async () => {
    const clean = freshStore();
    await clean.open(null);
    await seed(clean);
    const counter = crashAfter(clean, Infinity);
    await startRekey(counter.store, { worldId: W, ids: FOREIGN, mintId: minter() });
    const expected = await snapshot(clean);
    const total = counter.calls();
    expect(total).toBeGreaterThan(8);
    const newIds = new Set(Array.from({ length: 3 }, (_, i) => id(900 + i)));

    for (let k = 0; k < total; k++) {
      const s = freshStore();
      await s.open(null);
      await seed(s);
      const crashing = crashAfter(s, k);
      await expect(startRekey(crashing.store, { worldId: W, ids: FOREIGN, mintId: minter() })).rejects.toThrow(/crash/);
      // Between crash and recovery, nothing outside a new element dangles.
      expect(await danglingOutsideNew(s, newIds), `crash point ${k}`).toEqual([]);
      // A journal means recovery; none means nothing started, and the user runs it again.
      if (await s.hasRekeyJournal()) await recoverRekey(s);
      else await startRekey(s, { worldId: W, ids: FOREIGN, mintId: minter() });
      const got = await snapshot(s);
      for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
        if (JSON.stringify(got[key]) !== JSON.stringify(expected[key])) {
          console.log('DIFF', k, key, JSON.stringify(got[key]).slice(0, 600), 'EXPECTED', JSON.stringify(expected[key]).slice(0, 600));
        }
      }
      expect(got, `crash point ${k}`).toEqual(expected);
    }
  });
});

// ---- S363 gate lens A (Forge/Notes/2026-09-29-s363-gate/lens-a-kernel.md, RUNWAY rows 7-12) ----

/** A store whose nth call of `method` throws: a tab closed at that point. */
function crashOn(target: MockFolderStore, method: string, nth: number): FolderStore {
  let n = 0;
  return new Proxy(target, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv);
      if (typeof v !== 'function') return v;
      if (prop !== method) return v.bind(t);
      return (...args: unknown[]) => { if (++n === nth) throw new Error('crash'); return v.apply(t, args); };
    },
  }) as unknown as FolderStore;
}

/** The mutating calls a clean run of FOREIGN makes, in order (to aim `crashAfter`). */
async function cleanRunCalls(): Promise<string[]> {
  const s = freshStore();
  await s.open(null);
  await seed(s);
  const log: string[] = [];
  const rec = new Proxy(s, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv);
      if (typeof v !== 'function') return v;
      if (!MUTATING.has(prop as string)) return v.bind(t);
      return (...args: unknown[]) => { log.push(prop as string); return v.apply(t, args); };
    },
  });
  await startRekey(rec as unknown as FolderStore, { worldId: W, ids: FOREIGN, mintId: minter() });
  return log;
}

/** Links (anywhere in any body) to an id that is not in the world. */
async function danglingAnywhere(s: MockFolderStore): Promise<string[]> {
  const all = await s.listElements();
  const present = new Set(all.map(e => e.id));
  const watched = [...FOREIGN, id(900), id(901), id(902)];
  const bad: string[] = [];
  for (const e of all) {
    const text = JSON.stringify({ ...e, id: undefined });
    for (const w of watched) if (text.includes(w) && !present.has(w)) bad.push(`${e.id}→${w}`);
  }
  return bad;
}

describe('Discard is an undo (lens A F6)', () => {
  it('row 7 (probe D1): rollback after a crash on the 2nd create in step 2 returns the world to its pre-run state', async () => {
    const before = structuredClone(await store.listElements()).sort((a, b) => a.id.localeCompare(b.id));
    const foreignBefore = (await store.readSyncState()).foreign;
    // Elrond first, so the one new element written names a new Rivendell never written.
    await expect(startRekey(crashOn(store, 'createElementVerbatim', 2), { worldId: W, ids: [id(11), id(10)], mintId: minter() }))
      .rejects.toThrow('crash');
    expect(await store.getElement(id(900))).not.toBeNull();

    const r = await rollbackRekey(store);

    expect(await danglingAnywhere(store)).toEqual([]);
    expect(await store.getElement(id(10))).not.toBeNull();
    expect(await store.getElement(id(11))).not.toBeNull();
    expect(await store.getElement(id(900))).toBeNull();
    expect(await store.getElement(id(901))).toBeNull();
    expect(await store.hasRekeyJournal()).toBe(false);
    const st = await store.readSyncState();
    expect(st.foreign).toEqual(foreignBefore);
    expect(st.rekeyed).toBeUndefined();
    const after = (await store.listElements()).sort((a, b) => a.id.localeCompare(b.id));
    expect(after).toEqual(before);
    expect(r).toEqual({ restored: 2, kept: 0 });
  });

  it('row 8 (probe D2/D3): rollback after step 4 (crash on the first step-6 delete) points every referrer at the old ids again', async () => {
    const calls = await cleanRunCalls();
    const firstDelete = calls.indexOf('deleteElement');
    const foreignBefore = (await store.readSyncState()).foreign;
    await expect(startRekey(crashAfter(store, firstDelete).store, { worldId: W, ids: FOREIGN, mintId: minter() }))
      .rejects.toThrow(/crash/);
    // The precondition: step 4 ran, referrers name the new ids.
    expect((await store.getElement(id(20)))!.characters).toEqual([id(901)]);

    const r = await rollbackRekey(store);

    const council = (await store.getElement(id(20)))!;
    expect(council.characters).toEqual([id(11)]);
    expect(council.story).toBe(`[Elrond](ow://character/${id(11)}) spoke.`);
    expect(JSON.stringify(council.atlas_richtext_json)).toContain(id(11));
    expect(JSON.stringify(council.atlas_richtext_json)).not.toContain(id(901));
    expect((await store.getElement(id(21)))!.atlas_page_refs).toEqual([id(11)]);
    expect((await store.readCharts())[0].scope).toEqual({ kind: 'focus', elementId: id(11) });
    expect((await store.getElement(id(11)))!.location).toBe(id(10));
    expect((await store.getElement(id(12)))!.element_id).toBe(id(10));
    for (const n of [900, 901, 902]) expect(await store.getElement(id(n))).toBeNull();
    expect(await store.listMedia(id(900))).toEqual([]);
    expect(await store.listMedia(id(10))).toHaveLength(1);
    expect(await danglingAnywhere(store)).toEqual([]);
    const st = await store.readSyncState();
    expect(st.foreign).toEqual(foreignBefore);
    expect(st.rekeyed).toBeUndefined();
    expect(await store.hasRekeyJournal()).toBe(false);
    expect(r).toEqual({ restored: 3, kept: 0 });
  });

  it('row 8b: a pair that had already finished (its old element removed) stays finished and joins sync-state rekeyed', async () => {
    const calls = await cleanRunCalls();
    const secondDelete = calls.indexOf('deleteElement', calls.indexOf('deleteElement') + 1);
    await expect(startRekey(crashAfter(store, secondDelete).store, { worldId: W, ids: FOREIGN, mintId: minter() }))
      .rejects.toThrow(/crash/);
    // Rivendell (the first pair) finished: old gone, new here.
    expect(await store.getElement(id(10))).toBeNull();

    const r = await rollbackRekey(store);

    expect(await store.getElement(id(10))).toBeNull();
    expect((await store.getElement(id(900)))!.name).toBe('Rivendell');
    // Old bodies going back pick up the finished pair's new id.
    expect((await store.getElement(id(11)))!.location).toBe(id(900));
    expect((await store.getElement(id(12)))!.element_id).toBe(id(900));
    expect((await store.getElement(id(20)))!.characters).toEqual([id(11)]);
    expect(await store.getElement(id(901))).toBeNull();
    expect(await store.getElement(id(902))).toBeNull();
    expect(await store.listMedia(id(900))).toHaveLength(1);
    expect(await danglingAnywhere(store)).toEqual([]);
    const st = await store.readSyncState();
    expect(st.rekeyed).toEqual({ [id(10)]: id(900) });
    expect(st.foreign?.ids.map(e => e.id)).toEqual([id(11)]);
    expect(await store.hasRekeyJournal()).toBe(false);
    expect(r).toEqual({ restored: 2, kept: 1 });
  });
});

describe('lens A kernel rows on the mock', () => {
  it('row 9 (probe D2): with a journal pending, a UI delete of O or N is refused and no referrer loses a link; a silent delete passes', async () => {
    const calls = await cleanRunCalls();
    await expect(startRekey(crashAfter(store, calls.indexOf('deleteElement')).store, { worldId: W, ids: FOREIGN, mintId: minter() }))
      .rejects.toThrow(/crash/);

    await expect(store.deleteElement(id(900))).rejects.toBeInstanceOf(RekeyPendingError);
    await expect(store.deleteElement(id(10))).rejects.toBeInstanceOf(RekeyPendingError);
    await expect(store.deleteElement(id(901))).rejects.toBeInstanceOf(RekeyPendingError);
    expect((await store.getElement(id(901)))!.location).toBe(id(900));
    expect((await store.getElement(id(902)))!.element_id).toBe(id(900));
    expect((await store.getElement(id(20)))!.characters).toEqual([id(901)]);
    expect(await store.getElement(id(900))).not.toBeNull();
    expect(await store.getElement(id(10))).not.toBeNull();

    await store.deleteElement(id(12), { silent: true, cascade: false });
    expect(await store.getElement(id(12))).toBeNull();
  });

  it('row 10 (lens A F8): N takes O\'s own type, never the journal\'s word for it (wrong or missing)', async () => {
    const o = (await store.getElement(id(10)))!;
    await store.writeRekeyJournal({
      version: 1, world_id: W, map: { [id(10)]: id(900) }, types: { [id(10)]: 'character' },
      stamps: { [id(10)]: o.local_updated_at }, unrewritten: [], started_at: SYNCED,
    });
    await recoverRekey(store);
    expect((await store.getElement(id(900)))!.type).toBe('location');

    const o2 = (await store.getElement(id(11)))!;
    await store.writeRekeyJournal({
      version: 1, world_id: W, map: { [id(11)]: id(901) }, types: {},
      stamps: { [id(11)]: o2.local_updated_at }, unrewritten: [], started_at: SYNCED,
    });
    await recoverRekey(store);
    expect((await store.getElement(id(901)))!.type).toBe('character');
  });

  it('row 11 (lens A F9): a field O loses after the journal is written is gone from N too (the re-copy replaces)', async () => {
    await store.updateElement(id(11), { description: 'first' });
    // The mock's map is its disk: rewrite O's "file" with description removed,
    // as another tool would, between the journal and step 6.
    const disk = (store as unknown as { elements: Map<string, Element> }).elements;
    let edited = false;
    const r = await startRekey(store, { worldId: W, ids: [id(11)], mintId: minter() }, {
      rekeyPersistedState: () => {
        if (edited) return;
        edited = true;
        const { description: _d, ...rest } = disk.get(id(11))!;
        disk.set(id(11), { ...rest, name: 'Elrond Half-elven', local_updated_at: '2026-06-01T00:00:00.000Z' });
      },
    });
    const n = (await store.getElement(r.map.get(id(11))!))!;
    expect(n.name).toBe('Elrond Half-elven');
    expect('description' in n).toBe(false);
    expect(n.created_at).toBe('2025-05-05T00:00:00.000Z');
    expect(await store.getElement(id(11))).toBeNull();
  });

  it('row 12 (lens A F5): a referrer corrupt during the run keeps O; once readable, staleRekeyedLinks finds it and repairRekeyedLinks moves it to N', async () => {
    store.corruptIds.add(id(20));
    const r = await startRekey(store, { worldId: W, ids: FOREIGN, mintId: minter() });
    const nChar = r.map.get(id(11))!;
    expect(r.unrewritten).toEqual([id(20)]);
    expect(await store.hasRekeyJournal()).toBe(false);
    expect((await store.getElement(id(20)))!.characters).toEqual([id(11)]);

    store.corruptIds.clear();
    const rekeyed = (await store.readSyncState()).rekeyed;
    expect(rekeyed).toEqual(Object.fromEntries(r.map));
    expect(staleRekeyedLinks(await store.listElements(), rekeyed).map(e => e.id)).toEqual([id(20)]);

    expect(await repairRekeyedLinks(store)).toEqual([id(20)]);
    const council = (await store.getElement(id(20)))!;
    expect(council.characters).toEqual([nChar]);
    expect(council.story).toBe(`[Elrond](ow://character/${nChar}) spoke.`);
    expect(staleRekeyedLinks(await store.listElements(), (await store.readSyncState()).rekeyed)).toEqual([]);
  });
});
