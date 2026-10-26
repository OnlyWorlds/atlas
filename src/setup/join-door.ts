/**
 * The `#/join/` door: a world opened from onlyworlds.com
 * joins Atlas as an agent seat and comes down like any linked world.
 * R1-R9 below cite the rules of the handoff contract (a design note).
 *
 * Order: `core/join-capture.ts` took the code out of the address bar (R2);
 * `runPendingJoin` previews it (the only call before the person agrees), the
 * dialog (`ui/join-world-modal.ts`) asks, and `redeemJoin` + `openJoinedWorld`
 * spend it and bring the world down. This door only DOWNLOADS (R7): nothing
 * here uploads a local world into the one the code names.
 */

import { getState, patchSlice } from '../core/state';
import { PlainError } from '../core/plain-error';
import { isSeatWorld, SEAT_REMOVE_WHERE, seatRoleWords } from '../core/seat';
import { DEFAULT_V2_BASE, OwV2Error } from '../sync/ow-v2-client-adapter';
import { devV2Base } from '../sync/dev-api-base';
import { findLinkedWorld, findWorldByServerId, saveRegistry, updateWorldEntry } from '../registry/registry';
import { linkExistingApiWorldInRoot, type LinkExistingApiWorldResult } from './atlas-root-flow';
import { dropHeldSeat } from '../core/held-seats';
import type { InitialDownloadProgress, DownloadStop } from '../sync/initial-download';
import type { WorldWhere } from './world-parent';
import type { WorldRegistryEntry } from '../core/types';

/** What `/join/preview` says about a code, without spending it. */
export interface JoinPreview {
  /** Who the code is for (keel #212, #353): an agent redeems at /join, a person joins with their account, a player redeems at /join with no account for a read key; any other value is a kind this Atlas does not know. */
  reader: 'agent' | 'person' | 'player' | 'unknown';
  world: { name: string; description: string };
  /** Free text the inviter typed, or null: never shown as a checked name (R8). */
  invitedBy: string | null;
  /** The owner's chosen Character name, or null (keel Q9). */
  ownerCharacter: string | null;
  role: string;
  withCharacter: boolean;
  /** ISO 8601; the tool's own clock tells "spent by someone else" from "expired" (R5). */
  expiresAt: string;
  /** A player link for a whole table (keel #422 PR 2); absent on a link for one. */
  table?: JoinTable;
}

/**
 * A party link's table, from the preview (keel's `table_preview`):
 * how often it works, how many places are
 * left, and the Characters the owner listed, in the owner's order. An empty
 * list means each player names a fresh Character (`nameRequired`).
 */
export interface JoinTable {
  maxUses: number;
  usesLeft: number;
  nameRequired: boolean;
  characters: TablePick[];
}

export interface TablePick { id: string; name: string; taken: boolean }

/** What `/join` hands back once, kept in memory only. */
export interface JoinedSeat {
  world: { id: string; name: string };
  role: string;
  key: string;
  secret: string;
}

/** R5's first sentence: a code that will not open. */
export const JOIN_REFUSED_LINE = 'This link was already used or has expired. Ask for a new link.';
/** R5's second sentence, when the code was alive a moment ago. */
export const JOIN_TAKEN_LINE = `If you did not use this link just now, look on onlyworlds.com, ${SEAT_REMOVE_WHERE}, and remove any seat you do not recognise.`;
/** A seat made and not used (R6 waits on keel Q5, a seat retiring itself). */
export const SPARE_SEAT_LINE = `The seat this link made is unused: remove it on onlyworlds.com, ${SEAT_REMOVE_WHERE}.`;
/**
 * An agent code says what it makes before anything is spent (Titus's case, 2026-10-20: a
 * person opened an AI agent link in Atlas and became a seat in the inviter's name, not a member).
 */
export const AGENT_LINK_LINE = 'This link adds Atlas to the world as an AI agent, a seat that whoever made the link answers for. It does not make you a member: to join as yourself, ask for an invite link for a person.';
export const JOIN_MALFORMED_LINE ='This link to open a world is not complete. Ask for a new link.';

let baseOverride: string | null = null;
/** Tests point the door at MSW; production asks keel. */
export function setJoinBaseForTests(base: string | null): void { baseOverride = base; }
function joinBase(): string {
  return (baseOverride ?? devV2Base() ?? DEFAULT_V2_BASE).replace(/\/$/, '');
}

/** The name Members shows for this seat (R4): which browser, never who. */
export function seatAgentName(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  if (/Firefox\//.test(ua)) return 'Atlas (Firefox)';
  if (/Edg\//.test(ua)) return 'Atlas (Edge)';
  if (/Chrome\//.test(ua)) return 'Atlas (Chrome)';
  if (/Safari\//.test(ua)) return 'Atlas (Safari)';
  return 'Atlas';
}

/** What `/join` hands a player (keel #353), kept in memory only: a read key, never a secret. */
export interface JoinedPlayer {
  world: { id: string; name: string };
  key: string;
  /** The Character the player reads as. */
  character: { id: string; name: string };
}

/** The player seat made and not used: a player has no account, so only the owner can remove it. */
export const SPARE_PLAYER_LINE = 'The link is used up, and the seat it made is unused: the world\'s owner can remove it on onlyworlds.com, under Members.';

/** POST without an API-Key: the code in the body is the credential. */
async function postJoin(path: '/join' | '/join/preview', body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${joinBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // The code never goes into a referrer or a cache (R2).
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    let envelope: { type?: string; code?: string; message?: string; param?: string | null } | null = null;
    try { envelope = (JSON.parse(text) as { error?: typeof envelope }).error ?? null; } catch { /* not JSON */ }
    throw new OwV2Error(res.status, envelope, '', res.headers.get('Retry-After'));
  }
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object') throw new Error('join: the reply was not an object');
  return parsed as Record<string, unknown>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** A refused code: keel answers every bad code with the same 404 (it gives no oracle). */
export function isRefusedCode(err: unknown): boolean {
  return err instanceof OwV2Error && err.status === 404;
}

export async function previewJoin(code: string): Promise<JoinPreview> {
  const r = await postJoin('/join/preview', { code });
  const world = (r.world ?? {}) as Record<string, unknown>;
  return {
    // A keel without the field made agent codes only; a value this Atlas does
    // not know goes to neither route.
    reader: r.reader === undefined || r.reader === 'agent' ? 'agent'
      : r.reader === 'person' || r.reader === 'player' ? r.reader : 'unknown',
    world: { name: str(world.name) || 'Untitled world', description: str(world.description) },
    invitedBy: strOrNull(r.invited_by),
    ownerCharacter: strOrNull(r.owner_character),
    role: str(r.role) || 'contributor',
    withCharacter: r.with_character === true,
    expiresAt: str(r.expires_at),
    ...(r.reader === 'player' && typeof r.max_uses === 'number' ? { table: readTable(r) } : {}),
  };
}

/** keel adds the table's keys only when `max_uses` is 2 or more; a name or flag of the wrong shape reads as absent. */
function readTable(r: Record<string, unknown>): JoinTable {
  const listed = Array.isArray(r.characters) ? r.characters : [];
  const characters: TablePick[] = [];
  for (const c of listed) {
    if (!c || typeof c !== 'object') continue;
    const row = c as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id) continue;
    characters.push({ id: row.id, name: str(row.name).trim() || 'A Character', taken: row.taken === true });
  }
  const maxUses = r.max_uses as number;
  return {
    maxUses,
    usesLeft: typeof r.uses_left === 'number' ? Math.max(0, r.uses_left) : maxUses,
    nameRequired: r.name_required === true,
    characters,
  };
}

/** The owner's list in the owner's order, taken ones last (the sheet §2: "a screen keeps the order and puts taken ones last"). */
export function tablePicks(table: JoinTable): TablePick[] {
  return [...table.characters.filter(c => !c.taken), ...table.characters.filter(c => c.taken)];
}

/** "The link works 5 times, until 26 October. 3 places are left." (Seethe's frame 5). */
export function tableTimesLine(table: JoinTable, expiresAt: string): string {
  const t = Date.parse(expiresAt);
  const until = Number.isFinite(t)
    ? `, until ${new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`
    : '';
  const left = table.usesLeft === 1 ? 'One place is left.' : `${table.usesLeft} places are left.`;
  return `The link works ${table.maxUses} times${until}. ${left}`;
}

/** A pick keel refused, spending nothing: taken since the preview (`character_taken`), or off the list or hidden now. */
export function isPickRefused(err: unknown): boolean {
  return err instanceof OwV2Error && err.status === 422 && err.param === 'character';
}

/** The world has as many players as keel seats (keel PR 110's `world_full`, from a table or a link for one). */
export function isWorldFull(err: unknown): boolean {
  return err instanceof OwV2Error && err.status === 422 && err.code === 'world_full';
}

export const PICK_TAKEN_LINE = 'Someone took that Character a moment ago. Pick another.';
export const PICK_GONE_LINE = 'That Character can no longer be picked. Pick another.';
export const WORLD_FULL_LINE = 'This world is full: it has as many players as it can seat. Ask the game master to make room.';
export const TABLE_GONE_LINE = 'This link has no places left, or it was taken back. Ask the game master for a new one.';
export const NAME_NEEDED_LINE = 'Type your name: your Character takes it, and the game master sees it.';
export const ALL_TAKEN_LINE = 'Every Character on this link is taken. Ask the game master.';

/** The sentence above the fresh list after a refused pick. */
export function pickRefusedLine(err: unknown): string {
  return err instanceof OwV2Error && err.code === 'character_taken' ? PICK_TAKEN_LINE : PICK_GONE_LINE;
}

/** Spends the code. A 404 here after a good preview means someone else may have used it. */
export async function redeemJoin(code: string, agentName = seatAgentName()): Promise<JoinedSeat> {
  const r = await postJoin('/join', { code, agent_name: agentName });
  const world = (r.world ?? {}) as Record<string, unknown>;
  const seat = (r.seat ?? {}) as Record<string, unknown>;
  const out: JoinedSeat = {
    world: { id: str(world.id), name: str(world.name) },
    role: str(seat.role) || 'contributor',
    key: str(r.key),
    secret: str(r.pin),
  };
  if (!out.world.id || !out.key || !out.secret) throw new Error('join: the reply was missing the world, key or secret');
  return out;
}

/**
 * Spends a player's code (keel #353): no account, no credential. `name` is
 * the player's, optional (keel names a fresh Character for it, or keeps a
 * picked Character's). A 404 after a good preview: someone else may have used it.
 * On a table the player's pick goes as `character` (keel #422 PR 2); a refused
 * pick (`isPickRefused`) spends nothing.
 */
export async function redeemPlayerJoin(code: string, name = '', pick?: string): Promise<JoinedPlayer> {
  const trimmed = name.trim();
  const body: Record<string, string> = { code };
  if (pick) body.character = pick;
  if (trimmed) body.name = trimmed;
  const r = await postJoin('/join', body);
  const world = (r.world ?? {}) as Record<string, unknown>;
  const character = (r.character ?? {}) as Record<string, unknown>;
  const out: JoinedPlayer = {
    world: { id: str(world.id), name: str(world.name) },
    key: str(r.key),
    character: { id: str(character.id), name: str(character.name) },
  };
  if (r.kind !== 'player' || !out.world.id || !out.key.startsWith('ow_r_') || !out.character.id) {
    throw new Error('join: the reply was not a player\'s read key, world and Character');
  }
  return out;
}

/**
 * Bring a player's world down to read, or open the copy already here. The
 * read key goes on a view-only link (the view-only flag: no PIN, pull-only, every UI
 * write refused); keel answers it with what the Character knows, so the slice
 * is the server's, never computed here. Runs on the activation chain.
 */
export async function openPlayerWorld(opts: {
  player: JoinedPlayer;
  where: WorldWhere;
  onProgress?: (p: InitialDownloadProgress) => void;
  shouldStop?: () => DownloadStop;
}): Promise<Exclude<OpenJoinedOutcome, { kind: 'reconnected' }>> {
  const { player } = opts;
  const reg = getState().registry;
  // Already linked here (the owner trying their own link, or a second link):
  // the world stays what it is; a player key never replaces another key.
  // The seat held at the redeem goes with every outcome but a download that
  // never lands (the v2 gate's G1); the dialog says the spare line here.
  const linked = findLinkedWorld(reg, player.world.id);
  if (linked) {
    dropHeldSeat(player.world.id);
    // On this very key (another tab brought it down first): nothing is spare.
    return { kind: 'already-here', entry: linked, ...(linked.api?.api_key === player.key ? { sameSeat: true } : {}) };
  }
  const former = findWorldByServerId(reg, player.world.id);
  if (former) { dropHeldSeat(player.world.id); return { kind: 'here-unlinked', entry: former }; }
  const result = await linkExistingApiWorldInRoot({
    where: opts.where,
    apiKey: player.key,
    apiPin: '',
    readOnly: true,
    knownWorld: { id: player.world.id, name: player.world.name },
    onProgress: opts.onProgress,
    shouldStop: opts.shouldStop,
  });
  // Landed: the registry's settle (app.ts) has dropped it already; the door says so too.
  dropHeldSeat(player.world.id);
  return { kind: 'downloaded', result };
}

/** The line after a player's link met a world already here. */
export function playerAlreadyHereLine(outcome: Exclude<OpenJoinedOutcome, { kind: 'downloaded' | 'reconnected' }>): string {
  const name = outcome.entry.name;
  if (outcome.kind === 'already-here' && outcome.sameSeat) return `${name} is already here, so Atlas opened it.`;
  return outcome.kind === 'already-here'
    ? `${name} is already here, so Atlas opened it as it is. ${SPARE_PLAYER_LINE}`
    : `${name} is already here from an earlier link, so Atlas opened it as it is. ${SPARE_PLAYER_LINE}`;
}

/** R5's second sentence for a player, who has no account and so no page to remove a seat from. */
export const PLAYER_TAKEN_LINE = 'If you did not use this link just now, tell the person who sent it: they can remove the seat it made on onlyworlds.com, under Members.';

/** The refusal sentence for a redeem that failed after the preview (R5). */
export function redeemRefusedSentence(preview: JoinPreview, now = Date.now()): string {
  const alive = Date.parse(preview.expiresAt);
  if (!(Number.isFinite(alive) && alive > now)) return JOIN_REFUSED_LINE;
  return `${JOIN_REFUSED_LINE} ${preview.reader === 'player' ? PLAYER_TAKEN_LINE : JOIN_TAKEN_LINE}`;
}

/** The role in plain words, for the dialog (keel's values: `seatRoleWords`). */
export function roleLine(role: string): string {
  return seatRoleWords(role) ?? `Atlas joins with the role ${role.replace(/[^a-z _-]/gi, '').replace(/_/g, '-')}.`;
}

/** A person's role in plain words (keel's member page says the same, portal member_world.html). */
export function personRoleLine(role: string): string {
  switch (role) {
    case 'co_builder': return 'You join as a co-builder: you can see and change everything in this world.';
    case 'contributor': return 'You join as a contributor: you can see everything in this world and change what you create.';
    // Atlas opens a guest's world to read (#199); Lantern is where a guest writes notes.
    case 'guest': return 'You join as a guest: you see only part of this world, and Atlas opens it to read.';
    default: return `You join with the role ${role.replace(/[^a-z _-]/gi, '').replace(/_/g, '-')}.`;
  }
}

/**
 * A person's code waiting for its owner to sign in (in memory, as the captured
 * code is). The sign-in runs the door again. One exception: Sign in with
 * OnlyWorlds unloads the page, so its resume carries the code in this tab's
 * sessionStorage, read once and cleared on `/signin/callback` (the handoff
 * sheet §3, D139; `sync/onlyworlds-sign-in.ts`).
 */
let heldForSignIn: string | null = null;
export function holdJoinForSignIn(code: string): void { heldForSignIn = code; }
export function joinHeldForSignIn(): string | null { return heldForSignIn; }
export function takeJoinHeldForSignIn(): string | null {
  const code = heldForSignIn;
  heldForSignIn = null;
  return code;
}

export type OpenJoinedOutcome =
  | { kind: 'downloaded'; result: LinkExistingApiWorldResult }
  /** Already here and syncing: opened; the new seat is spare, unless the world here is on it (`sameSeat`). */
  | { kind: 'already-here'; entry: WorldRegistryEntry; sameSeat?: boolean }
  /** Already here as a seat that had lost its secret: it takes the new seat. */
  | { kind: 'reconnected'; entry: WorldRegistryEntry }
  /** Here from an earlier link, now local only: opened, nothing uploaded (R7). */
  | { kind: 'here-unlinked'; entry: WorldRegistryEntry };

/**
 * Bring the joined world down, or open the copy already here. Runs on the
 * activation chain (the caller's `enqueueActivationTask`). The id is learned
 * only from the redeem (keel Q10 would move this check before it).
 */
export async function openJoinedWorld(opts: {
  seat: JoinedSeat;
  where: WorldWhere;
  onProgress?: (p: InitialDownloadProgress) => void;
  shouldStop?: () => DownloadStop;
}): Promise<OpenJoinedOutcome> {
  const { seat } = opts;
  const reg = getState().registry;
  const linked = findLinkedWorld(reg, seat.world.id);
  if (linked) {
    // Only a seat world whose secret this browser lost takes the new seat. An
    // account world with no PIN here, or a view-only one, stays what it is:
    // a seat put in its place would turn the owner's own world into a
    // contributor's.
    if (!isSeatWorld(linked) || linked.api?.seat_secret) {
      dropHeldSeat(seat.world.id);
      // On this very seat (another tab, or a Retry past the commit): nothing is
      // spare, and the line must not send anyone to remove a seat in use.
      return { kind: 'already-here', entry: linked, ...(linked.api?.api_key === seat.key ? { sameSeat: true } : {}) };
    }
    const next = updateWorldEntry(reg, linked.id, {
      api: {
        ...linked.api!,
        api_key: seat.key,
        seat: { role: seat.role },
        seat_secret: seat.secret,
      },
    });
    if (!saveRegistry(next)) throw new PlainError('Atlas could not save the new seat in this browser. Try again.');
    // Dropped once the registry holding the secret is saved, never before.
    dropHeldSeat(seat.world.id);
    patchSlice('registry', next);
    return { kind: 'reconnected', entry: next.worlds.find(w => w.id === linked.id)! };
  }
  const former = findWorldByServerId(reg, seat.world.id);
  if (former) { dropHeldSeat(seat.world.id); return { kind: 'here-unlinked', entry: former }; }
  const result = await linkExistingApiWorldInRoot({
    where: opts.where,
    apiKey: seat.key,
    apiPin: seat.secret,
    knownWorld: { id: seat.world.id, name: seat.world.name },
    seat: { role: seat.role },
    onProgress: opts.onProgress,
    shouldStop: opts.shouldStop,
  });
  dropHeldSeat(seat.world.id);
  return { kind: 'downloaded', result };
}

/** The line after an already-here outcome (the seat itself is keel's to remove until Q5). */
export function alreadyHereLine(outcome: Exclude<OpenJoinedOutcome, { kind: 'downloaded' }>): string {
  const name = outcome.entry.name;
  switch (outcome.kind) {
    case 'already-here':
      return outcome.sameSeat ? `${name} is already here, so Atlas opened it.` : `${name} is already here, so Atlas opened it. ${SPARE_SEAT_LINE}`;
    case 'reconnected':
      return `${name} is connected again, on the seat this link made.`;
    case 'here-unlinked':
      return `${name} is already here from an earlier link, so Atlas opened it as it is. ${SPARE_SEAT_LINE}`;
  }
}
