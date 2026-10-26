/**
 * THE RE-KEY KERNEL: give elements new ids, and move every link with
 * them.
 *
 * Why: keel preserves client ids and refuses a create whose id already lives
 * in ANOTHER OnlyWorlds world. A copied or imported folder, or a world taken
 * online a second time, hits that on every round, forever. Only a new id
 * fixes it, and a new id is only safe if every reference follows.
 *
 * STORE-LEVEL AND UI-FREE. The caller (`sync/rekey-run.ts`) owns what needs
 * the app: the engine hold, flushing and closing the rooms, the foreign-id
 * guard, the live UI pass. This module owns the disk, in an order where every
 * surviving reference names an element that exists at every crash point:
 *
 *   1  journal      .atlas/rekey-journal.json (the engine refuses every round while it exists)
 *   2  create N     from O's body AS IT IS ON DISK, the WHOLE map applied; verbatim (no pin guard)
 *   3  media        everything under media/O copied to media/N, blobs before sidecars
 *   4  referrers    every other element, pre-filtered in memory, rewritten in its own chain
 *   5  charts       .atlas/charts.json scopes
 *   5b prefs        .atlas/world-prefs.json cast + calendar lens
 *   6p browser      persisted UI state (a caller hook), BEFORE O disappears
 *   6  remove O     silent (O never reached this server), then media/O; O leaves `foreign`
 *                   and joins `rekeyed` (the finished map, so links in files that could not
 *                   be read can still follow later: `repairRekeyedLinks`)
 *   8  journal      deleted
 *
 * Every step is idempotent, so recovery (`recoverRekey`) is the same function
 * run again from the journal: no phase marker, no shortcut. Inside step 2 a
 * new element may briefly name a new element not yet written, and inside step
 * 6 an old element may name an old one already removed; recovery finishes
 * before anything reads the world (the caller runs it before the element list
 * is primed). `rollbackRekey` is Discard: the same steps with the map inverted.
 *
 * The launcher must be a room that is not holding elements open (Settings):
 * a mounted writing editor saves its whole document and would write old ids
 * back. Adding a "give new ids" button to a
 * room that keeps an editor mounted reopens that.
 */
import type { Element, ElementType } from '../core/types';
import type { FolderStore, RekeyJournal } from './folder-store';
import { newId, nowIso } from './folder-store';
import { rekeyBody, type IdMap } from './rekey-body';
import { CorruptFileError } from './fs-utils';
import { PlainError } from '../core/plain-error';
import { rewriteChartScopeIds } from '../visualization/timeline/charts-store';

export interface RekeyHooks {
  /** Progress over the element writes (creates, referrer rewrites, removals). */
  onProgress?: (done: number, total: number) => void;
  /** Step 6p: migrate persisted browser state for this world (registry, tabs, prefs...). */
  rekeyPersistedState?: (worldId: string, map: IdMap) => void | Promise<void>;
}

export interface RekeyResult {
  /** old id → new id, the pairs that ended re-keyed. */
  map: Map<string, string>;
  /** Referrers that could not be read and still name old ids. */
  unrewritten: string[];
  /** What started the run (from its journal): 'merge' is Route 2, which still has to link afterwards. */
  origin?: 'rekey' | 'merge';
}

export class RekeyRefusedError extends PlainError {
  constructor(message: string) {
    super(message);
    this.name = 'RekeyRefusedError';
  }
}

/**
 * The element as it is ON DISK, read inside its own write chain with no write
 * (the cache misses an outside edit since open, and the old file is
 * about to be deleted). A file that will not parse throws `CorruptFileError`.
 */
async function readFresh(store: FolderStore, id: string): Promise<Element | null> {
  return store.updateElementWith(id, () => null);
}

export interface StartRekeyOpts {
  worldId: string;
  /** Mint a fresh id for each (the Settings re-key of foreign elements). */
  ids?: readonly string[];
  /**
   * Or move each old id onto a GIVEN new id (Route 2: a local element
   * onto the server element it matched by name). A new id must not exist
   * locally; the caller's plan guarantees it and the kernel re-checks.
   */
  pairs?: ReadonlyMap<string, string>;
  /**
   * Route 2 only: accept an element with a server baseline. Route 2 runs on
   * a LOCAL-ONLY world, where any `server_updated_at` is left from an
   * unrelated or unfinished earlier link, and the new element is written
   * without one anyway (`createElementVerbatim`).
   */
  allowStaleBaseline?: boolean;
  origin?: 'rekey' | 'merge';
  /** Test seam. */
  mintId?: () => string;
}

/**
 * Start a re-key of `ids` (each never synced to this world's server) or of
 * `pairs`. Refuses, touching nothing, when a journal already exists (finish
 * that one first), an id is missing, has a server baseline (unless allowed)
 * or has a second copy in the other element layout, or a new id is taken.
 * The journal check comes first even when there is nothing to move, so a
 * caller with an empty plan still learns the world has an unfinished run.
 */
export async function startRekey(
  store: FolderStore,
  opts: StartRekeyOpts,
  hooks: RekeyHooks = {},
): Promise<RekeyResult> {
  if (await store.hasRekeyJournal()) {
    throw new RekeyRefusedError('An earlier id update in this world is unfinished. Finish it first.');
  }
  const mint = opts.mintId ?? newId;
  const wanted: Array<[string, string | null]> = opts.pairs
    ? [...opts.pairs]
    : [...new Set(opts.ids ?? [])].map(id => [id, null]);
  const map: Record<string, string> = {};
  const types: Record<string, ElementType> = {};
  const stamps: Record<string, string> = {};
  const taken = new Set<string>();
  for (const [id, given] of wanted) {
    const el = await readFresh(store, id);
    if (!el) throw new RekeyRefusedError(`Element ${id} is not in this world.`);
    // v1 scope (contract §2, invariant 6): an element that ever reached this
    // server would need a server DELETE for its old id. Not this operation.
    if (el.server_updated_at && !opts.allowStaleBaseline) {
      throw new RekeyRefusedError(`${el.name || id} is already uploaded; it keeps its id.`);
    }
    // Its other copy would stay behind and come back as a twin.
    if (store.hasShadowCopy(id)) {
      throw new RekeyRefusedError(`${el.name || id} has two files, one under elements/ and one under spatial/. Remove the one you do not want, then try again.`);
    }
    const n = given ?? mint();
    if (n === id || taken.has(n) || await store.getElement(n)) {
      throw new RekeyRefusedError(given ? `${el.name || id} cannot take the id ${n}: it is already in use.` : 'A new id was already taken. Try again.');
    }
    taken.add(n);
    map[id] = n;
    types[id] = el.type;
    stamps[id] = el.local_updated_at;
  }
  if (Object.keys(map).length === 0) return { map: new Map(), unrewritten: [] };
  const journal: RekeyJournal = {
    version: 1, world_id: opts.worldId, map, types, stamps, unrewritten: [], started_at: nowIso(),
    ...(opts.origin && opts.origin !== 'rekey' ? { origin: opts.origin } : {}),
  };
  await store.writeRekeyJournal(journal);
  return runRekey(store, journal, hooks);
}

/**
 * The journal on disk, checked. null when there is none, AND when the file is
 * empty: a tab closed inside the journal's FIRST write leaves an empty file,
 * and since step 2 starts only after that write resolves, nothing else ran,
 * so the empty file is cleared here. A journal that is not what
 * v1 writes throws: better a world that says it cannot finish than one
 * re-keyed from a guess.
 */
async function readJournal(store: FolderStore): Promise<RekeyJournal | null> {
  const journal = await store.readRekeyJournal();
  if (!journal) {
    if (await store.hasRekeyJournal()) await store.clearRekeyJournal();
    return null;
  }
  if (journal.version !== 1 || !journal.map || typeof journal.map !== 'object'
    || !journal.types || typeof journal.types !== 'object') {
    throw new Error('The id update record in this world is damaged, so it cannot be finished.');
  }
  return journal;
}

/**
 * `.atlas/world-prefs.json`'s element ids through `map`: `favorites`
 * (protagonist, nexus) and `active_calendar_id`. Idempotent. A file that
 * will not parse is left alone (its own open reports it), never a reason to
 * stop the re-key.
 */
async function remapWorldPrefsFile(store: FolderStore, map: ReadonlyMap<string, string>): Promise<void> {
  if (map.size === 0) return;
  let prefs: Record<string, unknown> | null;
  try {
    prefs = await store.readWorldPrefs();
  } catch (err) {
    if (err instanceof CorruptFileError) return;
    throw err;
  }
  if (!prefs) return;
  const sw = (v: unknown) => (typeof v === 'string' && map.has(v) ? map.get(v)! : v);
  let changed = false;
  const next: Record<string, unknown> = { ...prefs };
  const cal = sw(prefs.active_calendar_id);
  if (cal !== prefs.active_calendar_id) { next.active_calendar_id = cal; changed = true; }
  const fav = prefs.favorites;
  if (fav && typeof fav === 'object' && !Array.isArray(fav)) {
    const f = fav as Record<string, unknown>;
    const nf = { ...f, protagonist_id: sw(f.protagonist_id), nexus_id: sw(f.nexus_id) };
    if (nf.protagonist_id !== f.protagonist_id || nf.nexus_id !== f.nexus_id) {
      // Keep absent keys absent.
      if (!('protagonist_id' in f)) delete nf.protagonist_id;
      if (!('nexus_id' in f)) delete nf.nexus_id;
      next.favorites = nf;
      changed = true;
    }
  }
  if (!changed) return;
  try {
    await store.writeWorldPrefs(next);
  } catch (err) {
    if (err instanceof CorruptFileError) return;
    throw err;
  }
}

/** Finish an interrupted re-key from its journal; null when there is none. */
export async function recoverRekey(store: FolderStore, hooks: RekeyHooks = {}): Promise<RekeyResult | null> {
  const journal = await readJournal(store);
  if (!journal) return null;
  return runRekey(store, journal, hooks);
}

async function runRekey(store: FolderStore, journal: RekeyJournal, hooks: RekeyHooks): Promise<RekeyResult> {
  // Live pairs only: a pair whose old AND new element are both
  // gone (a checkout, a hand delete between crash and reopen) is dropped, so
  // no surviving file gains a link to an element that does not exist.
  const pairs: Array<{ o: string; n: string; type: ElementType; oEl: Element | null }> = [];
  for (const [o, n] of Object.entries(journal.map)) {
    const oEl = await readFresh(store, o);
    const nEl = oEl ? null : await store.getElement(n);
    if (!oEl && !nEl) {
      console.info('[atlas:rekey] dropping a pair whose elements are both gone', { o, n });
      continue;
    }
    // The element's own type, never the journal's word for it.
    pairs.push({ o, n, type: (oEl ?? nEl)!.type, oEl });
  }
  const map = new Map(pairs.map(p => [p.o, p.n]));
  const oldIds = new Set(map.keys());
  const unrewritten = new Set(journal.unrewritten);

  let done = 0;
  const all = await store.listElements();
  const referrers = all.filter(e => !oldIds.has(e.id) && rekeyBody(e, map).changed);
  const total = pairs.length * 2 + referrers.length;
  const tick = () => hooks.onProgress?.(++done, total);

  // 2. New elements, born with every reference already moved.
  for (const p of pairs) {
    if (p.oEl) {
      const { body } = rekeyBody(p.oEl, map);
      await store.createElementVerbatim(p.type, { ...body, id: p.n, type: p.type }, { bindingFrom: p.o });
    }
    tick();
  }

  // 3. Media. Copy, never move; the old copy goes in step 6.
  for (const p of pairs) {
    if (p.oEl) await store.copyMediaDir(p.o, p.n);
  }

  // 4. Referrers. Filtered from the cache above (a whole-world walk through the
  // chain costs a disk read per file); inside each chain the transform runs
  // again on the file as it is on disk, and returns null when nothing changed
  // so an untouched element is never stamped dirty.
  for (const el of referrers) {
    try {
      await store.updateElementWith(el.id, b => {
        const r = rekeyBody(b, map);
        return r.changed ? r.body : null;
      });
      unrewritten.delete(el.id);
    } catch (err) {
      if (!(err instanceof CorruptFileError)) throw err;
      // A file that will not parse (a git conflict) is skipped and named, not
      // a reason to abandon every other referrer. The finished map
      // is kept in sync-state (step 6), so its links can follow once repaired.
      unrewritten.add(el.id);
      await store.writeRekeyJournal({ ...journal, unrewritten: [...unrewritten] });
    }
    tick();
  }

  // 5. Saved chart scopes (atlas-local, not element files).
  let charts = await store.readCharts();
  let chartsChanged = false;
  for (const [o, n] of map) {
    const r = rewriteChartScopeIds(charts, o, n);
    if (r.changed) { charts = r.charts; chartsChanged = true; }
  }
  if (chartsChanged) await store.writeCharts(charts);

  // 5b. The world prefs file (conv. 112) names elements too: the cast and the
  // calendar lens. The registry follows in 6p and its subscriber would write
  // the file in THIS browser, but a folder that travels (git, a shared drive)
  // opens elsewhere with the file's ids winning, so the file moves here.
  await remapWorldPrefsFile(store, map);

  // 6p. Browser state that names old ids moves while both ids still exist.
  await hooks.rekeyPersistedState?.(journal.world_id, map);

  // 6. The old elements go. An old element edited since the journal was
  // written (read from DISK: an outside tool counts too) REPLACES its new
  // element first: a merge could not carry a field the edit cleared.
  for (const p of pairs) {
    const current = await readFresh(store, p.o);
    if (current) {
      if (current.local_updated_at !== journal.stamps[p.o]) {
        const { body } = rekeyBody(current, map);
        await store.deleteElement(p.n, { silent: true, cascade: false });
        await store.createElementVerbatim(p.type, { ...body, id: p.n, type: p.type }, { bindingFrom: p.o });
      }
      await store.deleteElement(p.o, { silent: true, cascade: false });
    }
    // By directory, never by media id: the same media id lives under both.
    await store.removeMediaDir(p.o);
    tick();
  }
  await store.updateSyncState(s => ({
    ...(s.foreign ? { foreign: { ...s.foreign, ids: s.foreign.ids.filter(e => !oldIds.has(e.id)) } } : {}),
    rekeyed: { ...(s.rekeyed ?? {}), ...Object.fromEntries(map) },
  }));

  // 8. Done: the engine may run again.
  await store.clearRekeyJournal();
  return { map, unrewritten: [...unrewritten], origin: journal.origin ?? 'rekey' };
}

/**
 * DISCARD, done safely: an unfinished re-key is undone, not forgotten.
 * Forgetting left new elements naming new elements that were never
 * written, and two copies of each element with nothing to say which to keep.
 *
 * Per pair: an old element still on disk means the pair can go back (its
 * links return to it, the new copy and its media go); an old element already
 * removed means that pair had finished, so it stays finished (and old bodies
 * going back pick up its new id). Returns how many elements went back to
 * their old ids. A journal that will not parse throws; Settings then offers a
 * forget-only discard, the one case where there is no map to act on.
 */
export async function rollbackRekey(store: FolderStore, hooks: RekeyHooks = {}): Promise<{ restored: number; kept: number }> {
  const journal = await readJournal(store);
  if (!journal) return { restored: 0, kept: 0 };
  const back = new Map<string, string>(); // new id → old id, pairs that go back
  const finished = new Map<string, string>(); // old id → new id, pairs already through step 6
  for (const [o, n] of Object.entries(journal.map)) {
    if (await store.getElement(o)) back.set(n, o);
    else if (await store.getElement(n)) finished.set(o, n);
  }
  const restoredIds = new Set(back.values());
  // Referrers of the new copies go back to the old ids; bodies going back
  // (the old elements) take the finished pairs' new ids.
  for (const el of await store.listElements()) {
    if (back.has(el.id)) continue;
    const m = restoredIds.has(el.id) ? finished : back;
    if (!rekeyBody(el, m).changed) continue;
    await store.updateElementWith(el.id, b => {
      const r = rekeyBody(b, m);
      return r.changed ? r.body : null;
    });
  }
  let charts = await store.readCharts();
  let chartsChanged = false;
  for (const [n, o] of back) {
    const r = rewriteChartScopeIds(charts, n, o);
    if (r.changed) { charts = r.charts; chartsChanged = true; }
  }
  if (chartsChanged) await store.writeCharts(charts);
  await remapWorldPrefsFile(store, back);
  await hooks.rekeyPersistedState?.(journal.world_id, back);
  for (const [n] of back) {
    await store.deleteElement(n, { silent: true, cascade: false });
    await store.removeMediaDir(n);
  }
  if (finished.size > 0) {
    await store.updateSyncState(s => ({
      ...(s.foreign ? { foreign: { ...s.foreign, ids: s.foreign.ids.filter(e => !finished.has(e.id)) } } : {}),
      rekeyed: { ...(s.rekeyed ?? {}), ...Object.fromEntries(finished) },
    }));
  }
  await store.clearRekeyJournal();
  return { restored: back.size, kept: finished.size };
}

/** What started the unfinished run on disk, if any ('rekey' for a journal an older Atlas wrote). Never throws. */
export async function rekeyJournalOrigin(store: FolderStore): Promise<'rekey' | 'merge' | null> {
  try {
    const j = await store.readRekeyJournal();
    return j ? (j.origin ?? 'rekey') : null;
  } catch {
    return null;
  }
}

/** Elements whose links still name an id a finished re-key replaced (a file that could not be read at the time). */
export function staleRekeyedLinks(elements: readonly Element[], rekeyed: Record<string, string> | undefined): Element[] {
  if (!rekeyed) return [];
  const map = new Map(Object.entries(rekeyed));
  if (map.size === 0) return [];
  return elements.filter(e => !map.has(e.id) && rekeyBody(e, map).changed);
}

/** Point those links at the new ids. Returns the ids rewritten; a file that still will not parse is skipped. */
export async function repairRekeyedLinks(store: FolderStore): Promise<string[]> {
  const rekeyed = (await store.readSyncState()).rekeyed;
  const map = new Map(Object.entries(rekeyed ?? {}));
  const fixed: string[] = [];
  for (const el of staleRekeyedLinks(await store.listElements(), rekeyed)) {
    try {
      await store.updateElementWith(el.id, b => {
        const r = rekeyBody(b, map);
        return r.changed ? r.body : null;
      });
      fixed.push(el.id);
    } catch (err) {
      if (!(err instanceof CorruptFileError)) throw err;
    }
  }
  return fixed;
}
