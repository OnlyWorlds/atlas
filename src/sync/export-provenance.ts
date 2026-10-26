/**
 * What a linked world's world file says about where it came from and which
 * slice it is (folder spec §4.2; contract W2, W3 of a
 * design note, 2026-10-20). `/me` is asked with the
 * world's own key at the moment of the export; when it cannot be asked the
 * file carries `source` alone.
 */

import { OwV2Client } from '@onlyworlds/sdk';
import { ATLAS_CLIENT_NAME, DEFAULT_V2_BASE } from './ow-v2-client-adapter';
import { devV2Base } from './dev-api-base';
import { exportedAsFromMe, type ExportedAs, type WorldSource } from '../core/provenance';
import type { WorldRegistryEntry } from '../core/types';
import { isDemoKey } from '../core/constants';

const ME_TIMEOUT_MS = 8_000;

type MeReader = (apiKey: string) => Promise<{ role: string; character?: string | null; world?: { id?: string } }>;
const defaultMe: MeReader = (apiKey) => new OwV2Client({ apiKey, baseUrl: devV2Base() ?? DEFAULT_V2_BASE, client: ATLAS_CLIENT_NAME }).me();
let readMe: MeReader = defaultMe;
export function setExportMeReaderForTests(f: MeReader | null): void { readMe = f ?? defaultMe; }

/** The server a key talks to, as the spec writes it (`https://www.onlyworlds.com` on live). */
export function serverOrigin(): string {
  return new URL(devV2Base() ?? DEFAULT_V2_BASE).origin;
}

/**
 * Unlink of a world whose key reads as a guest (a person, an agent seat or a
 * player): its folder holds only that Character's view, and once the link is
 * gone nothing else says so. Recorded before the link is stripped, so Make
 * online is never offered to it as the whole world. The
 * kind is known from the recorded role; the Character itself is not, so it
 * stays null (never guessed). Null for any other world.
 */
export function unlinkProvenance(world: WorldRegistryEntry, now: Date): { source: WorldSource; exported_as: ExportedAs } | null {
  const api = world.api;
  if (!api?.world_id) return null;
  const guest = api.member_role === 'guest' || !!api.seat;
  if (!guest) return null;
  return {
    source: { server: serverOrigin(), world: String(api.world_id), at: now.toISOString() },
    exported_as: { kind: 'character', role: 'guest', character: null },
  };
}

export async function exportProvenance(
  world: WorldRegistryEntry,
  nameOf: (id: string) => Promise<string | undefined>,
  now: Date,
): Promise<{ source: WorldSource; exportedAs: ExportedAs | null } | null> {
  const api = world.api;
  if (!api?.world_id) return null;
  const source: WorldSource = { server: serverOrigin(), world: String(api.world_id), at: now.toISOString() };
  let exportedAs: ExportedAs | null = null;
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  // A demo key reads a shared demo world: keel answers its /me as the owner, and
  // its slice is none of the four.
  if (api.api_key && online && !isDemoKey(api.api_key)) {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const me = await Promise.race([
        readMe(api.api_key),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('the key read timed out')), ME_TIMEOUT_MS); }),
      ]).finally(() => clearTimeout(timer));
      // The key must be this world's: a slice read from another world is no slice of this one (G6).
      if (me.world?.id !== undefined && String(me.world.id) === String(api.world_id)) {
        const id = typeof me.character === 'string' ? me.character : null;
        const name = id ? await nameOf(id) : undefined;
        exportedAs = exportedAsFromMe(me, (cid) => (cid === id ? name : undefined));
      }
    } catch (err) {
      console.warn('[atlas:download] the slice could not be read; the file says where it came from only', err); // raw-error-ok: a console record
    }
  }
  return { source, exportedAs };
}
