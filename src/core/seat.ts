/**
 * Agent seats (OW Infra #104, S385; contract `Forge/Notes/2026-10-08-s379-handoff-contract.md`).
 *
 * A world opened from onlyworlds.com joins as a SEAT: its own `ow_w_` key and
 * its own `ow_s_` secret, sent as `API-Pin` on writes. keel never accepts the
 * account PIN on a seat (R1), and a seat secret is no PIN for any other world,
 * so the PIN is per world: `worldPin` is the one reader for every call made
 * on a world's behalf. The secret lives on the registry entry only; the store
 * strips it from every world.json write (`withoutSeatSecret`).
 */

import type { WorldMeta, WorldRegistryEntry, WorldsRegistry } from './types';

/** A seat world whose secret this browser no longer has (a cleared registry, a folder opened again). */
export const SEAT_SECRET_MISSING_LINE =
  'This world was opened from onlyworlds.com as a seat, and this browser no longer has its secret. Open it again from onlyworlds.com to sync.';

/** keel's seat secret: `ow_s_` + urlsafe characters (accounts/agents.py). */
const SEAT_SECRET_RE = /^ow_s_[\w-]{16,}$/;

export function isSeatSecret(value: string | null | undefined): boolean {
  return typeof value === 'string' && SEAT_SECRET_RE.test(value.trim());
}

/**
 * What a seat's role lets Atlas do, in plain words; null for a role keel does
 * not name. keel's values (accounts/models.py `MemberRole`): `co_builder`
 * (shown as "co-builder"), `contributor`, `guest`.
 */
export function seatRoleWords(role: string | undefined): string | null {
  switch (role) {
    case 'co_builder': return 'As a co-builder, Atlas can change anything in this world.';
    case 'contributor': return 'As a contributor, Atlas can add to this world and change what it adds.';
    case 'guest': return 'As a guest, Atlas sees only part of this world (what it adds, and what the world shows its guests) and changes only what it adds.';
    default: return null;
  }
}

/** Where a seat is removed on onlyworlds.com: the owner's world page, or the person's own list. */
export const SEAT_REMOVE_WHERE = 'under Members on the world\'s page, or under Your agents in your worlds';

/** True when the world is linked as an agent seat. */
export function isSeatWorld(entry: WorldRegistryEntry | null | undefined): boolean {
  return !!entry?.api?.seat;
}

/**
 * The credential sent as `API-Pin` for this world: a seat world's own secret
 * (undefined when this browser lost it: never the account PIN, R1), else the
 * account PIN.
 */
export function worldPin(entry: WorldRegistryEntry | null | undefined, reg: WorldsRegistry): string | undefined {
  if (entry?.api?.seat) return entry.api.seat_secret || undefined;
  return reg.pin || undefined;
}

/** The seat marker from a world.json `api` block (untrusted input), or undefined. */
export function seatFromFile(api: unknown): { role?: string } | undefined {
  if (!api || typeof api !== 'object') return undefined;
  const seat = (api as { seat?: unknown }).seat;
  if (!seat || typeof seat !== 'object') return undefined;
  const role = (seat as { role?: unknown }).role;
  return typeof role === 'string' && /^[a-z_-]{1,32}$/.test(role) ? { role } : {};
}

/**
 * The `api` block world.json carries for a registry entry: every mirrored
 * flag (view-only, the seat marker), never the secret. A writer that rebuilds
 * the block by hand drops the flags (Test connection dropped `read_only` and
 * would have dropped `seat`), and discovery then restores the wrong world.
 */
export function diskApiBlock(api: NonNullable<WorldRegistryEntry['api']>, over: { world_name?: string; api_key?: string } = {}): NonNullable<WorldMeta['api']> {
  const worldName = over.world_name ?? api.world_name;
  return {
    world_id: api.world_id,
    api_key: over.api_key ?? api.api_key,
    ...(worldName ? { world_name: worldName } : {}),
    ...(api.read_only ? { read_only: true } : {}),
    ...(api.seat ? { seat: { ...api.seat } } : {}),
  };
}

/** A world.json body with no seat secret in it, whatever the caller passed. */
export function withoutSeatSecret<T extends Partial<WorldMeta>>(meta: T): T {
  const api = meta.api as (WorldMeta['api'] & { seat_secret?: unknown }) | undefined;
  if (!api || !('seat_secret' in api)) return meta;
  const { seat_secret: _dropped, ...rest } = api;
  return { ...meta, api: rest };
}
