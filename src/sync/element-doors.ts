/**
 * keel's door record on one element, read from the element itself, for the
 * trail on its page (`core/door-trail.ts`).
 *
 * keel serves `doors` on an element read and on a write's answer, to every
 * member, and never in /changes (the feed is the trail already): a pulled copy
 * is written from the feed's body, so it holds no door record and the trail
 * would name only its last write. So, as the Files card does, the page asks
 * keel for the element when it shows, keeps the answer for the session and
 * asks again once it is a minute old, or once the copy has moved past the read
 * (asked once per copy); the trail line repaints itself through
 * `onDoorsChanged`, and only when the answer moved. A refusal or no answer
 * leaves what was there.
 */
import { OwV2Client } from '@onlyworlds/sdk';
import { readCovers, type DoorRead } from '../core/door-trail';
import type { WorldRegistryEntry } from '../core/types';
import { ATLAS_CLIENT_NAME, DEFAULT_V2_BASE } from './ow-v2-client-adapter';
import { devV2Base } from './dev-api-base';

const STALE_AFTER_MS = 60_000;
const READ_TIMEOUT_MS = 15_000;

/** The client the module talks through; tests swap in their own. */
export type DoorsClient = Pick<OwV2Client, 'get'>;
type ClientFactory = (apiKey: string) => DoorsClient;
const defaultFactory: ClientFactory = (apiKey) =>
  new OwV2Client({ apiKey, baseUrl: devV2Base() ?? DEFAULT_V2_BASE, client: ATLAS_CLIENT_NAME });
let factory: ClientFactory = defaultFactory;
export function setDoorsClientFactoryForTests(f: ClientFactory | null): void { factory = f ?? defaultFactory; }

interface Slot {
  read: DoorRead | null;
  readAt: number;
  pending: Promise<void> | null;
  askedFor: unknown;
}

const slots = new Map<string, Slot>();
const listeners = new Map<() => void, () => boolean>();

const slotKey = (entry: WorldRegistryEntry, type: string, id: string): string | null =>
  entry.state === 'api-linked' && entry.api?.api_key ? `${entry.api.world_id}:${entry.api.api_key}:${type}:${id}` : null;

/**
 * A trail line listens while `alive()` says it is on the page. The page rebuilds on every save
 * and an answer that moved is rare, so each new listener first lets go of the ones whose line
 * has left the page (the S523 gate's S1: 200 rebuilds had left 200 listeners).
 */
export function onDoorsChanged(fn: () => void, alive: () => boolean = () => true): () => void {
  for (const [other, on] of [...listeners]) if (!on()) listeners.delete(other);
  listeners.set(fn, alive);
  return () => { listeners.delete(fn); };
}

function notify(): void {
  for (const [fn, alive] of [...listeners]) {
    if (!alive()) { listeners.delete(fn); continue; }
    try { fn(); } catch (err) { console.info('[atlas:doors] a trail line could not repaint', err); }
  }
}

/** keel's last answer for this element, or null. */
export function doorsNow(entry: WorldRegistryEntry, type: string, id: string): DoorRead | null {
  const k = slotKey(entry, type, id);
  return (k && slots.get(k)?.read) || null;
}

/**
 * Ask keel for the element when its record is not known, a minute old, or older
 * than the copy (`copyUpdated`, the copy's `server_updated_at`; asked once per
 * copy). Never rejects; listeners hear it only when the answer moved.
 */
export function refreshDoors(
  entry: WorldRegistryEntry, type: string, id: string, copyUpdated?: unknown, now: () => number = Date.now,
): Promise<void> {
  const k = slotKey(entry, type, id);
  if (!k) return Promise.resolve();
  let s = slots.get(k);
  if (!s) {
    s = { read: null, readAt: 0, pending: null, askedFor: undefined };
    slots.set(k, s);
  }
  const slot = s;
  if (slot.pending) return slot.pending;
  const stale = slot.readAt === 0 || now() - slot.readAt > STALE_AFTER_MS;
  const passed = slot.read !== null && !readCovers(slot.read, copyUpdated) && slot.askedFor !== copyUpdated;
  if (!stale && !passed) return Promise.resolve();
  slot.askedFor = copyUpdated;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the element read timed out')), READ_TIMEOUT_MS);
  });
  // Through a promise: a client that throws as it is called is a failed read, never a broken page.
  const asked = Promise.resolve().then(() => factory(entry.api!.api_key).get(type, id));
  slot.pending = Promise.race([asked, stalled]).then(
    (answer) => {
      const body = (answer ?? {}) as unknown as Record<string, unknown>;
      const d = body.doors;
      const read: DoorRead = {
        doors: d && typeof d === 'object' && !Array.isArray(d) ? d as Record<string, unknown> : null,
        updated_at: typeof body.updated_at === 'string' ? body.updated_at : null,
        changed_client: typeof body.changed_client === 'string' ? body.changed_client : null,
        changed_via: typeof body.changed_via === 'string' ? body.changed_via : null,
      };
      if (JSON.stringify(read) === JSON.stringify(slot.read)) return;
      slot.read = read;
      notify();
    },
    () => { /* the trail keeps what it had */ },
  ).finally(() => {
    clearTimeout(timer);
    slot.readAt = now();
    slot.pending = null;
  });
  return slot.pending;
}
