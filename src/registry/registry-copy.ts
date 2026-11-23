/**
 * The registry's landed copy.
 *
 * The list of worlds lives in `localStorage` (`saveRegistry`), and a browser
 * killed within a few seconds of a save can lose that write: Chromium batches
 * `localStorage` to disk, while a finished IndexedDB transaction survives the
 * kill. So every save that reached `localStorage` also leaves the same string
 * here, in a database of its own (`REGISTRY_COPY_DB`, never a store in the
 * handle vault, whose version an older tab would then refuse), and the boot
 * puts the copy back when it is newer than what `localStorage` gave back.
 *
 * - The number: every save carries `saved_seq` inside the registry JSON, so a
 *   number and the list it numbers land or are lost together. The copy only
 *   moves forward: a write puts its string only when its number is equal or
 *   higher than the stored copy's.
 * - One write at a time: a save made while one is in flight replaces the
 *   string waiting behind it, so a hung open never piles up opens.
 * - No connection is kept: one per read and per write, closed after, and on
 *   `versionchange`.
 * - The boot (`restoreRegistryAtBoot`, before `startApp`) restores only with
 *   no other Atlas tab live (the shared lock `atlas-live`), under the
 *   exclusive lock `atlas-registry-restore` waited for at most W, and only
 *   when the copy's read finished within R of the grant: a tab that gave up
 *   waiting (W, from after this tab's grant) always finds this one past R.
 *   The registry is restored whole, never entry by entry: an entry the copy
 *   has and `localStorage` lacks is a lost make only when the copy is newer.
 * - Every failure here is one console line: the copy never changes what
 *   `saveRegistry` answers, never shows its toast and never stops boot.
 * - A removal that saves and then deletes a vault handle waits for the copy
 *   between the two (`registryCopyLanded`); Forget this browser and the test
 *   harness stop copy writes, wait out the one in flight, then delete the
 *   copy (`stopRegistryCopyWrites`, `deleteRegistryCopy`).
 *
 * A restore is silent: one console line, nothing on screen. The person saw
 * the world made, and seeing it again is what they expect.
 */

import { LOCK_CLAIM_WAIT_MS, REGISTRY_COPY_DB, REGISTRY_STORAGE_KEY } from '../core/constants';

const STORE = 'copy';
const RECORD = 'registry';
const VERSION = 1;

/** Held exclusively while a booting tab decides its restore. */
export const RESTORE_LOCK = 'atlas-registry-restore';
/** Held shared by every tab past its restore, for the tab's life. */
export const LIVE_LOCK = 'atlas-live';
/** R: a restore decided later than this after its lock's grant is dropped (below W, `LOCK_CLAIM_WAIT_MS`). */
export const RESTORE_WINDOW_MS = 1_500;
/** The copy's read, bounded, when `localStorage` holds a readable registry. */
export const COPY_READ_BOUND_MS = 500;
/** How long a removal waits for the copy, and Forget for the write in flight. */
export const COPY_LANDED_WAIT_MS = 2_000;
/** How long Forget and the test harness wait for the copy's delete. */
export const COPY_DELETE_WAIT_MS = 5_000;

interface CopyRecord { saved_seq: number; registry: string }

export type CopyDeleteOutcome = 'deleted' | 'blocked' | 'failed' | 'timeout';
export type RestoreOutcome =
  | 'restored' | 'kept' | 'no-copy' | 'live-tab' | 'lock-late' | 'no-locks' | 'read-late' | 'dropped-late' | 'failed';

/** The part of the Web Locks API (`navigator.locks`) the restore uses. */
export interface RestoreLocks {
  request(name: string, opts: { mode?: 'exclusive' | 'shared'; signal?: AbortSignal }, cb: (lock: unknown) => unknown): Promise<unknown>;
  query(): Promise<{ held?: Array<{ name?: string }>; pending?: Array<{ name?: string }> }>;
}

export interface RestoreDeps {
  /** Default `navigator.locks`; `null` = none. */
  locks?: RestoreLocks | null;
  /** W (tests). */
  lockWaitMs?: number;
  /** R (tests). */
  windowMs?: number;
  /** The read's bound with a readable registry (tests). */
  readBoundMs?: number;
  /** Tests: stand in for the copy's read. */
  readCopy?: () => Promise<string | null>;
}

const say = (line: string, detail?: unknown): void => {
  if (detail === undefined) console.warn(`[registry-copy] ${line}`);
  else console.warn(`[registry-copy] ${line}`, detail); // raw-error-ok: a console record, never shown
};

let noIdbSaid = false;
function idbHere(): boolean {
  let here = false;
  try { here = typeof indexedDB !== 'undefined' && !!indexedDB; } catch { here = false; }
  if (!here && !noIdbSaid) {
    noIdbSaid = true;
    say('this browser has no IndexedDB, so the list of worlds has no copy');
  }
  return here;
}

/** A registry's number: absent, or not a number, counts as 0. */
export function registrySeq(parsed: unknown): number {
  const n = (parsed as { saved_seq?: unknown } | null)?.saved_seq;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function parseRegistry(raw: string | null): { worlds: unknown[] } | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { worlds?: unknown } | null;
    return p && Array.isArray(p.worlds) ? (p as { worlds: unknown[] }) : null;
  } catch {
    return null;
  }
}

function openCopy(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(REGISTRY_COPY_DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new DOMException('The copy did not open', 'UnknownError'));
  });
}

/** One readwrite transaction: puts the string only over a copy whose number is not higher. Resolves on `complete`. */
function putCopy(registry: string, seq: number): Promise<'put' | 'refused'> {
  return openCopy().then(db => new Promise<'put' | 'refused'>((resolve, reject) => {
    let outcome: 'put' | 'refused' = 'refused';
    let failure: unknown = null;
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, 'readwrite');
    } catch (err) {
      db.close();
      reject(err);
      return;
    }
    tx.oncomplete = () => { db.close(); resolve(outcome); };
    tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? new DOMException('The copy was not written', 'AbortError')); };
    try {
      const store = tx.objectStore(STORE);
      const get = store.get(RECORD);
      get.onsuccess = () => {
        const cur = get.result as Partial<CopyRecord> | undefined;
        if (seq < registrySeq(cur ?? null)) return; // a later number is there: refused
        try {
          store.put({ saved_seq: seq, registry } satisfies CopyRecord, RECORD);
          outcome = 'put';
        } catch (err) {
          failure = err;
          try { tx.abort(); } catch { /* already ending */ }
        }
      };
    } catch (err) {
      failure = err;
      try { tx.abort(); } catch { /* already ending */ }
    }
  }));
}

// ---- Writes: one in flight, the latest string waiting behind it ----

let flight: Promise<void> | null = null;
/** Bumped when a flight is abandoned (a stop that outwaited it) or the module is reset: an old flight's end then moves nothing. */
let flightGen = 0;
let waiting: { registry: string; seq: number } | null = null;
let stopped = false;
/** This tab's latest save handed to the copy, and the highest number whose write has ended (landed, refused or failed). */
let latestSeq = 0;
let endedSeq = 0;
let landedWaiters: Array<{ seq: number; done: () => void }> = [];

function ended(seq: number): void {
  endedSeq = Math.max(endedSeq, seq);
  const still: typeof landedWaiters = [];
  for (const w of landedWaiters) (w.seq <= endedSeq ? w.done() : still.push(w));
  landedWaiters = still;
}

function startWrite(registry: string, seq: number): void {
  const gen = ++flightGen;
  flight = putCopy(registry, seq)
    .then(() => undefined, err => { say('could not write the copy of the list of worlds', err); })
    .then(() => {
      if (gen !== flightGen) return;
      flight = null;
      ended(seq);
      const next = waiting;
      waiting = null;
      if (next && !stopped) startWrite(next.registry, next.seq);
    });
}

/**
 * Hand the string `saveRegistry` just set to the copy. Synchronous: with no
 * write in flight, the write's open is issued before this returns; else the
 * string waits behind it, replacing any string already waiting. Never throws.
 */
export function writeRegistryCopy(registry: string, seq: number): void {
  try {
    if (stopped || !idbHere()) return;
    latestSeq = Math.max(latestSeq, seq);
    if (flight) {
      waiting = { registry, seq };
      return;
    }
    startWrite(registry, seq);
  } catch (err) {
    say('could not write the copy of the list of worlds', err);
  }
}

/**
 * Resolves once the copy holds this tab's latest save or a later one, or the
 * write carrying it failed or was refused, or after `boundMs`; at once with
 * no IndexedDB or with copy writes stopped. Saves that keep arriving do not
 * hold it: it waits for one number, not for the queue to drain.
 */
export function registryCopyLanded(boundMs = COPY_LANDED_WAIT_MS): Promise<void> {
  if (stopped || latestSeq <= endedSeq) return Promise.resolve();
  let here = false;
  try { here = typeof indexedDB !== 'undefined' && !!indexedDB; } catch { here = false; }
  if (!here) return Promise.resolve();
  return new Promise(resolve => {
    const w = { seq: latestSeq, done: () => { clearTimeout(timer); resolve(); } };
    const timer = setTimeout(() => {
      landedWaiters = landedWaiters.filter(x => x !== w);
      resolve();
    }, boundMs);
    landedWaiters.push(w);
  });
}

/**
 * Stop copy writes (the waiting string is dropped) and wait for the one in
 * flight, at most `boundMs`. Answers whether it ended in time; one that did
 * not is abandoned, so writes can start again once resumed.
 */
export async function stopRegistryCopyWrites(boundMs = COPY_LANDED_WAIT_MS): Promise<boolean> {
  stopped = true;
  waiting = null;
  for (const w of landedWaiters) w.done();
  landedWaiters = [];
  const f = flight;
  if (!f) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inTime = await Promise.race([
    f.then(() => true),
    new Promise<boolean>(r => { timer = setTimeout(() => r(false), boundMs); }),
  ]);
  clearTimeout(timer);
  if (!inTime && flight === f) {
    flightGen++;
    flight = null;
  }
  return inTime;
}

export function resumeRegistryCopyWrites(): void {
  stopped = false;
}

/**
 * Delete the copy by name, waiting at most `boundMs` for `success`. A
 * `blocked` answers at once, unless `pastBlocked`, which waits on for the
 * delete to finish (the test harness: nothing in Atlas keeps a connection).
 */
export function deleteRegistryCopy(boundMs = COPY_DELETE_WAIT_MS, opts: { pastBlocked?: boolean } = {}): Promise<CopyDeleteOutcome> {
  let here = false;
  try { here = typeof indexedDB !== 'undefined' && !!indexedDB; } catch { here = false; }
  if (!here) return Promise.resolve('deleted');
  return new Promise(resolve => {
    let done = false;
    const finish = (o: CopyDeleteOutcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(o);
    };
    const timer = setTimeout(() => finish('timeout'), boundMs);
    try {
      const req = indexedDB.deleteDatabase(REGISTRY_COPY_DB);
      req.onsuccess = () => finish('deleted');
      req.onerror = () => finish('failed');
      req.onblocked = () => { if (!opts.pastBlocked) finish('blocked'); };
    } catch {
      finish('failed');
    }
  });
}

/** The copy's string, or null when there is none (a record with no string reads as '' and will not parse). */
export function readRegistryCopy(): Promise<string | null> {
  return openCopy().then(db => new Promise<string | null>((resolve, reject) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      tx.oncomplete = () => db.close();
      tx.onabort = () => { db.close(); reject(tx.error ?? new DOMException('The copy was not read', 'AbortError')); };
      const req = tx.objectStore(STORE).get(RECORD);
      req.onsuccess = () => {
        const rec = req.result as Partial<CopyRecord> | undefined;
        resolve(rec == null ? null : typeof rec.registry === 'string' ? rec.registry : '');
      };
    } catch (err) {
      db.close();
      reject(err);
    }
  }));
}

// ---- The boot ----

const LATE = Symbol('late');

/**
 * Decide, before `startApp`, whether the copy goes back into `localStorage`
 * (rule order: the restore lock within W; no live tab; the copy read within
 * its bound; within R of the grant, `localStorage` read and set in the task
 * the read finished in; then `atlas-live` on every branch with Web Locks).
 * Never rejects: a failure is one console line and boots as today.
 */
export async function restoreRegistryAtBoot(deps: RestoreDeps = {}): Promise<RestoreOutcome> {
  const started = performance.now();
  const W = deps.lockWaitMs ?? LOCK_CLAIM_WAIT_MS;
  let locks: RestoreLocks | null = null;
  try {
    locks = deps.locks !== undefined ? deps.locks : ((navigator as unknown as { locks?: RestoreLocks }).locks ?? null);
  } catch { locks = null; }
  if (!locks) return 'no-locks';
  const l = locks;

  // 1. The restore lock, waited for at most W.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), W);
  let release: (() => void) | null = null;
  let grantAt = 0;
  const claim = await new Promise<'granted' | 'late' | 'no-locks'>(resolve => {
    try {
      const held = l.request(RESTORE_LOCK, { mode: 'exclusive', signal: ac.signal }, () => {
        grantAt = performance.now();
        resolve('granted');
        return new Promise<void>(r => { release = r; });
      });
      held.catch(() => resolve(ac.signal.aborted ? 'late' : 'no-locks'));
    } catch {
      resolve('no-locks');
    }
  });
  clearTimeout(timer);
  if (claim === 'no-locks') return 'no-locks';

  let outcome: RestoreOutcome;
  let readMs: number | null = null;
  try {
    outcome = claim === 'late'
      ? 'lock-late'
      : await decide(l, grantAt, deps, ms => { readMs = ms; });
  } catch (err) {
    say('could not read the copy of the list of worlds', err);
    outcome = 'failed';
  }

  // 4. Live for the tab's life; the restore lock goes once this tab is live.
  const letGo = () => { const r = release; release = null; r?.(); };
  try {
    l.request(LIVE_LOCK, { mode: 'shared' }, () => { letGo(); return new Promise<void>(() => {}); }).catch(letGo);
  } catch {
    letGo();
  }

  if (outcome === 'restored') console.info('[registry-copy] the list of worlds was restored from its copy');
  else if (outcome === 'read-late' || outcome === 'dropped-late' || outcome === 'lock-late') {
    console.info(`[registry-copy] no restore: ${outcome}`, { readMs });
  }
  try {
    performance.measure('atlas-registry-restore', { start: started, detail: { outcome, readMs, sinceGrantMs: grantAt ? performance.now() - grantAt : null } });
  } catch { /* no User Timing here */ }
  return outcome;
}

async function decide(l: RestoreLocks, grantAt: number, deps: RestoreDeps, noteRead: (ms: number) => void): Promise<RestoreOutcome> {
  const R = deps.windowMs ?? RESTORE_WINDOW_MS;
  // A live tab means the browser process kept localStorage.
  let snap: Awaited<ReturnType<RestoreLocks['query']>>;
  try {
    snap = await l.query();
  } catch {
    return 'no-locks';
  }
  if ([...(snap.held ?? []), ...(snap.pending ?? [])].some(x => x?.name === LIVE_LOCK)) return 'live-tab';

  // 2. The read, bounded.
  if (!deps.readCopy && !idbHere()) return 'failed';
  const readable = parseRegistry(localStorage.getItem(REGISTRY_STORAGE_KEY)) !== null;
  const bound = readable ? (deps.readBoundMs ?? COPY_READ_BOUND_MS) : Math.max(0, R - (performance.now() - grantAt));
  const readStart = performance.now();
  let boundTimer: ReturnType<typeof setTimeout> | undefined;
  const got = await Promise.race([
    (deps.readCopy ?? readRegistryCopy)(),
    new Promise<typeof LATE>(r => { boundTimer = setTimeout(() => r(LATE), bound); }),
  ]);
  clearTimeout(boundTimer);

  // 3. This task: within R of the grant, read localStorage, decide and set.
  const now = performance.now();
  noteRead(now - readStart);
  if (got === LATE || now - readStart > bound) return 'read-late';
  if (now - grantAt > R) return 'dropped-late';
  if (got === null) return 'no-copy';
  const copy = parseRegistry(got);
  if (!copy) {
    say('the copy of the list of worlds will not parse, so it was left alone');
    return 'failed';
  }
  const raw = localStorage.getItem(REGISTRY_STORAGE_KEY);
  const stored = parseRegistry(raw);
  if (stored && registrySeq(stored) >= registrySeq(copy)) return 'kept';
  try {
    localStorage.setItem(REGISTRY_STORAGE_KEY, got);
  } catch (err) {
    say('could not put the copy of the list of worlds back', err);
    return 'failed';
  }
  return 'restored';
}

/** Tests: a fresh module, as a new page would have. */
export function __resetRegistryCopyForTests(): void {
  flightGen++;
  flight = null;
  waiting = null;
  stopped = false;
  latestSeq = 0;
  endedSeq = 0;
  for (const w of landedWaiters) w.done();
  landedWaiters = [];
  noIdbSaid = false;
}
