/**
 * The `#/join/` door (OW Infra #104, S385): a world opened from onlyworlds.com
 * joins Atlas as an agent seat and comes down like any linked world.
 * Contract: `Forge/Notes/2026-10-08-s379-handoff-contract.md` (R1-R9);
 * design: `Forge/Notes/2026-10-10-s385-join-door-design.md`.
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
import type { InitialDownloadProgress, DownloadStop } from '../sync/initial-download';
import type { WorldWhere } from './world-parent';
import type { WorldRegistryEntry } from '../core/types';

/** What `/join/preview` says about a code, without spending it. */
export interface JoinPreview {
  world: { name: string; description: string };
  /** Free text the inviter typed, or null: never shown as a checked name (R8). */
  invitedBy: string | null;
  /** The owner's chosen Character name, or null (keel Q9). */
  ownerCharacter: string | null;
  role: string;
  withCharacter: boolean;
  /** ISO 8601; the tool's own clock tells "spent by someone else" from "expired" (R5). */
  expiresAt: string;
}

/** What `/join` hands back once, kept in memory only. */
export interface JoinedSeat {
  world: { id: string; name: string };
  role: string;
  key: string;
  secret: string;
}

/** R5's first sentence: a code that will not open. */
export const JOIN_REFUSED_LINE = 'This link was already used or has expired. Open the world again from onlyworlds.com.';
/** R5's second sentence, when the code was alive a moment ago. */
export const JOIN_TAKEN_LINE = `If you did not use this link just now, look on onlyworlds.com, ${SEAT_REMOVE_WHERE}, and remove any seat you do not recognise.`;
/** A seat made and not used (R6 waits on keel Q5, a seat retiring itself). */
export const SPARE_SEAT_LINE = `The seat this link made is spare: remove it on onlyworlds.com, ${SEAT_REMOVE_WHERE}.`;
export const JOIN_MALFORMED_LINE = 'This link to open a world is not complete. Open the world again from onlyworlds.com.';

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
    world: { name: str(world.name) || 'Untitled world', description: str(world.description) },
    invitedBy: strOrNull(r.invited_by),
    ownerCharacter: strOrNull(r.owner_character),
    role: str(r.role) || 'contributor',
    withCharacter: r.with_character === true,
    expiresAt: str(r.expires_at),
  };
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

/** The refusal sentence for a redeem that failed after the preview (R5). */
export function redeemRefusedSentence(preview: JoinPreview, now = Date.now()): string {
  const alive = Date.parse(preview.expiresAt);
  return Number.isFinite(alive) && alive > now ? `${JOIN_REFUSED_LINE} ${JOIN_TAKEN_LINE}` : JOIN_REFUSED_LINE;
}

/** The role in plain words, for the dialog (keel's values: `seatRoleWords`). */
export function roleLine(role: string): string {
  return seatRoleWords(role) ?? `Atlas joins with the role ${role.replace(/[^a-z _-]/gi, '').replace(/_/g, '-')}.`;
}

export type OpenJoinedOutcome =
  | { kind: 'downloaded'; result: LinkExistingApiWorldResult }
  /** Already here and syncing: opened; the new seat is spare. */
  | { kind: 'already-here'; entry: WorldRegistryEntry }
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
    // contributor's (S386 gate, both lenses).
    if (!isSeatWorld(linked) || linked.api?.seat_secret) return { kind: 'already-here', entry: linked };
    const next = updateWorldEntry(reg, linked.id, {
      api: {
        ...linked.api!,
        api_key: seat.key,
        seat: { role: seat.role },
        seat_secret: seat.secret,
      },
    });
    if (!saveRegistry(next)) throw new PlainError('Atlas could not save the new seat in this browser. Try again.');
    patchSlice('registry', next);
    return { kind: 'reconnected', entry: next.worlds.find(w => w.id === linked.id)! };
  }
  const former = findWorldByServerId(reg, seat.world.id);
  if (former) return { kind: 'here-unlinked', entry: former };
  const result = await linkExistingApiWorldInRoot({
    where: opts.where,
    apiKey: seat.key,
    apiPin: seat.secret,
    knownWorld: { id: seat.world.id, name: seat.world.name },
    seat: { role: seat.role },
    onProgress: opts.onProgress,
    shouldStop: opts.shouldStop,
  });
  return { kind: 'downloaded', result };
}

/** The line after an already-here outcome (the seat itself is keel's to remove until Q5). */
export function alreadyHereLine(outcome: Exclude<OpenJoinedOutcome, { kind: 'downloaded' }>): string {
  const name = outcome.entry.name;
  switch (outcome.kind) {
    case 'already-here':
      return `${name} is already here, so Atlas opened it. ${SPARE_SEAT_LINE}`;
    case 'reconnected':
      return `${name} is connected again, on the seat this link made.`;
    case 'here-unlinked':
      return `${name} is already here from an earlier link, so Atlas opened it as it is. ${SPARE_SEAT_LINE}`;
  }
}
