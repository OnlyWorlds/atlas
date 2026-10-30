/**
 * Is a read key's world shown on onlyworlds.com to someone signed out? keel's
 * whole switch is `public_read` and `public_page.on` on GET /world (any key).
 * Read once per world per session, when a mark first wants it, kept in
 * memory only; until the answer, and after a failed read, the answer is
 * "not known" and no mark shows (the Waymark contract's R1).
 */

import type { WorldRegistryEntry } from '../core/types';
import { isPublicReader } from '../core/waymark-for';
import { buildV2Adapter } from './make-online';

const known = new Map<string, boolean>();
const asking = new Map<string, Promise<boolean | null>>();

/** The switch as known now: true, false, or null (not read yet, or the read failed). */
export function publicPageOnNow(entry: WorldRegistryEntry): boolean | null {
  const id = entry.api?.world_id;
  return id ? known.get(id) ?? null : null;
}

/** Read the switch for a read key's world, once per session; answers what is known after. */
export function readPublicPageOn(entry: WorldRegistryEntry): Promise<boolean | null> {
  const id = entry.api?.world_id;
  const key = entry.api?.api_key;
  if (!id || !key || !isPublicReader(entry)) return Promise.resolve(null);
  if (known.has(id)) return Promise.resolve(known.get(id)!);
  const inFlight = asking.get(id);
  if (inFlight) return inFlight;
  // A read goes bare: a read key carries no PIN.
  const ask = buildV2Adapter(key, '').getWorldMeta().then(
    meta => { known.set(id, meta.public_page_on === true); return known.get(id)!; },
    err => { console.warn('[atlas:waymark] the public page switch was not read; no mark this session', err); return null; },
  );
  asking.set(id, ask);
  return ask;
}

/** Tests only: forget what was read. */
export function resetPublicPageForTests(): void {
  known.clear();
  asking.clear();
}
