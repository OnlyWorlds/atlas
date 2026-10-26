/**
 * Held seats (keel's join route; the contract is a
 * design note): a join link's seat
 * kept in this browser from the moment its redeem answers until a world of
 * that id lands here, by any door, or the person removes it. A link is spent
 * at the redeem, so a download cancelled, closed or cut off by a reload would
 * otherwise leave a live seat on onlyworlds.com that nothing here can use.
 *
 * One localStorage key per world (`atlas-held-seat:<server world id>`): two
 * tabs holding two worlds at once never lose one, which a list inside the
 * registry would (`mergeRegistry` takes a top-level field whole). A held seat
 * is never a world row: nothing that reads `registry.worlds` sees one (P3).
 * The secret stays in this browser's storage only, like the registry's
 * `seat_secret` (conv. 132): never in a folder, a world file, an export or a
 * report, and nothing here logs a record.
 */

import type { WorldRegistryEntry, WorldsRegistry } from './types';
import { getState, setState } from './state';
import { isSeatSecret, isSeatWorld, SEAT_REMOVE_WHERE } from './seat';
import { worldAlreadyHere } from './browser-home';

export const HELD_SEAT_PREFIX = 'atlas-held-seat:';

export interface HeldSeat {
  v: 1;
  world_id: string;
  world_name: string;
  kind: 'agent' | 'player';
  key: string;
  /** An agent seat's secret (its PIN); a player's read key has none. */
  secret?: string;
  role?: string;
  /** The Character a player reads as. */
  character?: { id: string; name: string };
  held_at: string;
  /** The link's last characters, to say which link (never the whole code). */
  code_tail: string;
}

const keyFor = (worldId: string) => `${HELD_SEAT_PREFIX}${worldId}`;

/** A record of the right shape, or null (an unreadable one is dropped by its reader). */
function parseRecord(raw: string | null, worldId: string): HeldSeat | null {
  if (!raw) return null;
  let r: Record<string, unknown>;
  try { r = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  if (!r || typeof r !== 'object' || r.v !== 1 || r.world_id !== worldId) return null;
  if (typeof r.world_name !== 'string' || typeof r.key !== 'string' || !r.key) return null;
  if (typeof r.held_at !== 'string' || typeof r.code_tail !== 'string') return null;
  if (r.kind === 'agent') {
    if (!isSeatSecret(r.secret as string)) return null;
  } else if (r.kind === 'player') {
    const c = r.character as Record<string, unknown> | undefined;
    if (!r.key.startsWith('ow_r_') || r.secret !== undefined || !c || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string') return null;
  } else {
    return null;
  }
  return r as unknown as HeldSeat;
}

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** Every readable record in this browser, worlds here or not. */
export function allHeldSeats(): HeldSeat[] {
  const ls = storage();
  if (!ls) return [];
  const out: HeldSeat[] = [];
  const unreadable: string[] = [];
  try {
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k?.startsWith(HELD_SEAT_PREFIX)) continue;
      const rec = parseRecord(ls.getItem(k), k.slice(HELD_SEAT_PREFIX.length));
      if (rec) out.push(rec);
      else unreadable.push(k);
    }
    for (const k of unreadable) ls.removeItem(k);
  } catch { /* storage refused: nothing held to show */ }
  return out;
}

export function heldSeat(worldId: string): HeldSeat | null {
  const ls = storage();
  if (!ls) return null;
  try { return parseRecord(ls.getItem(keyFor(worldId)), worldId); } catch { return null; }
}

/**
 * The held seats to show: never one whose world is here already (the G7
 * read). Showing filters; the drop, with what it says, is `settleHeldSeats`.
 */
export function heldSeats(reg: WorldsRegistry = getState().registry): HeldSeat[] {
  return allHeldSeats()
    .filter(h => !worldAlreadyHere(reg, h.world_id))
    .sort((a, b) => a.world_name.localeCompare(b.world_name));
}

export function hasHeldSeats(reg?: WorldsRegistry): boolean {
  return heldSeats(reg).length > 0;
}

/** Every surface that reads held seats draws again (they live outside the state). */
export function heldSeatsChanged(): void {
  setState({ ...getState() });
}

/**
 * Keep a seat the moment its redeem answers (the v2 gate's G1). Answers
 * whether it is held, and the older record a second link for the same world
 * replaced (its seat is now spare, rule 4); a record of the same key is no
 * replacement.
 */
export function holdSeat(rec: HeldSeat): { held: boolean; replaced: HeldSeat | null } {
  const ls = storage();
  if (!ls) return { held: false, replaced: null };
  const before = heldSeat(rec.world_id);
  try {
    ls.setItem(keyFor(rec.world_id), JSON.stringify(rec));
  } catch {
    return { held: false, replaced: null };
  }
  heldSeatsChanged();
  return { held: true, replaced: before && before.key !== rec.key ? before : null };
}

export function dropHeldSeat(worldId: string): void {
  const ls = storage();
  if (!ls) return;
  let had = false;
  try {
    had = ls.getItem(keyFor(worldId)) !== null;
    ls.removeItem(keyFor(worldId));
  } catch { return; }
  if (had) heldSeatsChanged();
}

/** The `code_tail` of a link. */
export function codeTail(code: string): string {
  return code.slice(-6);
}

/** A storage event about held seats (or a whole clear): the lists draw again (G7). */
export function isHeldSeatStorageKey(key: string | null): boolean {
  return key === null || key.startsWith(HELD_SEAT_PREFIX);
}

export interface HeldSeatSettlement {
  /** The registry with handed-over seats, to save; null when nothing changed. */
  next: WorldsRegistry | null;
  /** Entries that took a record's key and secret (the reconnected rule). */
  handedOver: WorldRegistryEntry[];
  /** Records dropped whose seat no world here uses: the spare line (G5). */
  spare: HeldSeat[];
}

/**
 * Settle every record whose world has landed here, by any door (rule 2, G3:
 * `worldAlreadyHere`, so a world file of the held world counts). A landed
 * seat world that lost its secret while an agent record holds one takes the
 * record's key and secret (G2: a reload mid-download into a folder leaves a
 * linked folder with no secret, which discovery adopts later). A record whose
 * key the landed world uses goes quietly; any other is spare (G5).
 */
export function settleHeldSeats(reg: WorldsRegistry): HeldSeatSettlement {
  const out: HeldSeatSettlement = { next: null, handedOver: [], spare: [] };
  const held = allHeldSeats();
  if (held.length === 0) return out;
  let next = reg;
  for (const h of held) {
    const entry = worldAlreadyHere(next, h.world_id);
    if (!entry) continue;
    if (h.kind === 'agent' && h.secret && entry.state === 'api-linked' && entry.api
      && entry.api.world_id === h.world_id && isSeatWorld(entry) && !entry.api.seat_secret && !entry.api.read_only) {
      next = {
        ...next,
        worlds: next.worlds.map(w => w.id !== entry.id ? w : {
          ...w,
          api: { ...w.api!, api_key: h.key, seat: { ...(h.role ? { role: h.role } : w.api!.seat) }, seat_secret: h.secret },
        }),
      };
      // Kept until the caller has saved the registry that holds the secret.
      out.handedOver.push(next.worlds.find(w => w.id === entry.id)!);
      continue;
    }
    if (entry.api?.api_key !== h.key) out.spare.push(h);
    dropHeldSeat(h.world_id);
  }
  if (next !== reg) out.next = next;
  return out;
}

/** The line for a seat that was held and is now unused. */
export function spareHeldLine(h: HeldSeat): string {
  return h.kind === 'player'
    ? `The seat an earlier link made for ${h.world_name} is unused now: the world's owner can remove it on onlyworlds.com, under Members.`
    : `The seat an earlier link made for ${h.world_name} is unused now: remove it on onlyworlds.com, ${SEAT_REMOVE_WHERE}.`;
}

type Locks = { request: (name: string, opts: unknown, cb: (lock: unknown) => Promise<unknown> | unknown) => Promise<unknown> };
function locks(): Locks | null {
  const l = (typeof navigator === 'undefined' ? undefined : (navigator as unknown as { locks?: Locks }).locks);
  return l && typeof l.request === 'function' ? l : null;
}
const lockName = (worldId: string) => `held-${worldId}`;

/** A download of a held world holds this lock in every tab (G6). */
export async function withHeldSeatLock<T>(worldId: string, fn: () => Promise<T>): Promise<T> {
  const l = locks();
  if (!l) return fn();
  return l.request(lockName(worldId), {}, () => fn()) as Promise<T>;
}

/** Is a download of this world running in any tab? Remove refuses while one is (G6). */
export async function heldSeatBusy(worldId: string): Promise<boolean> {
  const l = locks();
  if (!l) return false;
  return (await l.request(lockName(worldId), { ifAvailable: true }, lock => lock === null)) as boolean;
}
