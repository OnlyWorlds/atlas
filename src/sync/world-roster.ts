/**
 * A linked world's roster (GET /members, SDK `members()`), read once per
 * world and session, only when something asks: the quiet agent mark (#347)
 * names an agent seat from it. A world key's read (a guest's too: keel does
 * not redact the roster). A failure is kept for a minute, then asked again,
 * so a page that repaints on every notify never hammers keel.
 */
import { OwV2Client, type OwMember } from '@onlyworlds/sdk';
import type { WorldRegistryEntry } from '../core/types';
import { DEFAULT_V2_BASE } from './ow-v2-client-adapter';
import { devV2Base } from './dev-api-base';

const RETRY_AFTER_FAILURE_MS = 60_000;
const ROSTER_TIMEOUT_MS = 15_000;

interface Slot {
  key: string;
  rows: OwMember[] | null;
  pending: Promise<OwMember[] | null> | null;
  failedAt: number | null;
}

const slots = new Map<string, Slot>();

function slotKey(entry: WorldRegistryEntry): string | null {
  if (entry.state !== 'api-linked' || !entry.api?.api_key) return null;
  return `${entry.api.world_id}:${entry.api.api_key}`;
}

/** What is known now: the rows, or null when not (yet) read. */
export function rosterNow(entry: WorldRegistryEntry): OwMember[] | null {
  const key = slotKey(entry);
  const slot = slots.get(entry.id);
  return key && slot?.key === key ? slot.rows : null;
}

/** The roster, read at most once per world (a failure retries after a minute). */
export function rosterFor(entry: WorldRegistryEntry, now: () => number = Date.now): Promise<OwMember[] | null> {
  const key = slotKey(entry);
  if (!key) return Promise.resolve(null);
  let slot = slots.get(entry.id);
  if (!slot || slot.key !== key) {
    slot = { key, rows: null, pending: null, failedAt: null };
    slots.set(entry.id, slot);
  }
  if (slot.rows) return Promise.resolve(slot.rows);
  if (slot.pending) return slot.pending;
  if (slot.failedAt !== null && now() - slot.failedAt < RETRY_AFTER_FAILURE_MS) return Promise.resolve(null);
  const s = slot;
  const client = new OwV2Client({ apiKey: entry.api!.api_key, baseUrl: devV2Base() ?? DEFAULT_V2_BASE });
  // The SDK's client has no read timeout: a stalled read would hold `pending` for the session.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the roster read timed out')), ROSTER_TIMEOUT_MS);
  });
  s.pending = Promise.race([client.members(), stalled]).finally(() => clearTimeout(timer)).then(
    rows => { s.rows = rows; s.failedAt = null; return rows; },
    (err: unknown) => {
      console.info('[atlas:roster] members could not be read', err);
      s.failedAt = now();
      return null;
    },
  ).finally(() => { s.pending = null; });
  return s.pending;
}

/** Tests only. */
export function resetRosterCache(): void {
  slots.clear();
}
