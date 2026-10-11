/**
 * Upload a picture for an element of an online world (Atlas #154, Keel #59's
 * last leg; brief `Forge/Notes/2026-10-10-s386-upload-button-brief.md`).
 *
 * Two requests, and the bytes never pass through keel: a one-use ticket from
 * keel (`POST /media/ticket`, the world's key and its own PIN: `worldPin`,
 * so a seat world sends its seat's secret, conv. 132), then the bytes to the
 * media edge with the ticket as a Bearer token. The edge names the object
 * and answers with its public URL, which the caller sets as `image_url`.
 * The key and PIN never go to the edge.
 *
 * Every picture is public to anyone with its link, even in a private world,
 * and is never overwritten (Skeld's ticket-split letter): the UI says so.
 */

import { PlainError } from '../core/plain-error';
import { isSeatWorld, SEAT_SECRET_MISSING_LINE, worldPin } from '../core/seat';
import type { WorldRegistryEntry, WorldsRegistry } from '../core/types';
import { OwV2Error, type MediaTicket, type MediaRemovalTicket } from './ow-v2-client-adapter';
import { buildV2Adapter } from './make-online';

/** What the edge takes, read from the file's bytes there; the browser's type is a first check. */
export const PICTURE_TYPES = ['image/webp', 'image/png', 'image/jpeg', 'image/avif'] as const;

export const PICTURE_TYPES_LINE = 'OnlyWorlds takes pictures as WebP, PNG, JPEG or AVIF.';

/** Where the edge may live: a ticket is a credential, never sent anywhere else. */
const EDGE_ORIGINS = ['https://upload.onlyworlds.com'];
let edgeOriginsForTests: string[] | null = null;
export function setEdgeOriginsForTests(origins: string[] | null): void { edgeOriginsForTests = origins; }

const mb = (bytes: number): string => `${Math.max(0.1, Math.round(bytes / 104857.6) / 10)} MB`;

/** The edge's own error shape is `{ error: "<code>" }`, not keel's envelope. */
async function edgeError(res: Response): Promise<OwV2Error> {
  const text = await res.text().catch(() => '');
  let code = 'unknown';
  try { const b = JSON.parse(text) as { error?: unknown }; if (typeof b.error === 'string') code = b.error; } catch { /* not JSON */ }
  return new OwV2Error(res.status, { code, message: code }, '', res.headers.get('Retry-After'));
}

async function sendToEdge(ticket: MediaTicket, file: Blob): Promise<{ url: string }> {
  let origin: string;
  try { origin = new URL(ticket.upload_url).origin; } catch { origin = ''; }
  if (!(edgeOriginsForTests ?? EDGE_ORIGINS).includes(origin)) {
    throw new Error('media upload: the ticket named an upload address Atlas does not know');
  }
  const res = await fetch(ticket.upload_url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ticket.ticket}` },
    body: file,
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
  });
  if (!res.ok) throw await edgeError(res);
  const body = await res.json() as { url?: unknown };
  if (typeof body.url !== 'string' || !/^https:\/\//.test(body.url)) {
    throw new Error('media upload: the reply had no picture address');
  }
  return { url: body.url };
}

/** keel's ticket refusals that have their own sentence; anything else is worded by `problems.ts`. */
function ticketSentence(err: unknown): string | null {
  if (!(err instanceof OwV2Error)) return null;
  switch (err.code) {
    case 'storage_full': return 'Your OnlyWorlds account has used all of its picture storage, so this picture was not uploaded. Remove one you no longer need, then try again.';
    case 'quota_exceeded': return 'This world has reached its limit of picture uploads for now. Try again later.';
    case 'media_unavailable': return 'Picture upload is not available on OnlyWorlds right now. Try again later.';
    default: return null;
  }
}

/** The edge's refusals that have their own sentence. */
function edgeSentence(err: unknown, file: Blob, maxBytes: number): string | null {
  if (!(err instanceof OwV2Error)) return null;
  switch (err.code) {
    case 'too_large': return `This picture is ${mb(file.size)}, and OnlyWorlds takes pictures up to ${mb(maxBytes)}.`;
    case 'unsupported_type': return `${PICTURE_TYPES_LINE} This file is none of those.`;
    case 'write_failed': return 'OnlyWorlds could not store the picture just now. Nothing was kept; try again.';
    default: return null;
  }
}

const isTicketSpent = (err: unknown): boolean =>
  err instanceof OwV2Error && err.status === 401 && /^ticket_(expired|used|invalid)$/.test(err.code);

/**
 * Upload one picture for this world. Resolves to the picture's public URL;
 * rejects with a `PlainError` when the reason has its own sentence, else with
 * the raw error for `showProblem` to word.
 */
export async function uploadPicture(
  entry: WorldRegistryEntry,
  reg: WorldsRegistry,
  file: Blob,
): Promise<string> {
  if (!entry.api || entry.state !== 'api-linked') throw new PlainError('Pictures are hosted on OnlyWorlds: use Make online first.');
  if (entry.api.read_only) throw new PlainError('This world is view-only here, so it cannot take a new picture.');
  const pin = worldPin(entry, reg);
  if (!pin) {
    throw new PlainError(isSeatWorld(entry) ? SEAT_SECRET_MISSING_LINE
      : 'Atlas needs your OnlyWorlds PIN to upload a picture. Enter it in Settings, under OnlyWorlds.');
  }
  if (file.type && !(PICTURE_TYPES as readonly string[]).includes(file.type)) {
    throw new PlainError(`${PICTURE_TYPES_LINE} This file is ${file.type.replace(/^image\//, '').toUpperCase() || 'another kind'}.`);
  }
  const adapter = buildV2Adapter(entry.api.api_key, pin);
  // One retry with a fresh ticket when the first was spent or expired
  // between asking and sending (a slow pick, a sleeping laptop).
  for (let attempt = 0; ; attempt++) {
    let ticket: MediaTicket;
    try {
      ticket = await adapter.createMediaTicket();
    } catch (err) {
      const s = ticketSentence(err);
      throw s ? new PlainError(s) : err;
    }
    if (file.size > ticket.max_bytes) {
      throw new PlainError(`This picture is ${mb(file.size)}, and OnlyWorlds takes pictures up to ${mb(ticket.max_bytes)}${ticket.max_bytes < 15 * 1024 * 1024 ? ' (what is left of your account\'s picture storage)' : ''}.`);
    }
    try {
      return (await sendToEdge(ticket, file)).url;
    } catch (err) {
      if (attempt === 0 && isTicketSpent(err)) continue;
      const s = edgeSentence(err, file, ticket.max_bytes);
      throw s ? new PlainError(s) : err;
    }
  }
}

// --- Removing a picture (Boss's removal contract, h37 #2354; Keel #170) ------

/** Where an uploaded picture is served; its object key is the rest of the URL. */
const MEDIA_ORIGIN = 'https://media.onlyworlds.com/';

/**
 * The object key of a picture uploaded into this world through a ticket
 * (`u/<worldId>/<name>`), or null for any other address. Only those can be
 * removed: keel answers not_found for everything else (the crew's batch
 * uploads, other worlds' pictures, other hosts).
 */
export function uploadedPictureKey(url: unknown, serverWorldId: string): string | null {
  if (typeof url !== 'string' || !url.startsWith(MEDIA_ORIGIN) || !serverWorldId) return null;
  const key = url.slice(MEDIA_ORIGIN.length).split(/[?#]/)[0];
  const prefix = `u/${serverWorldId}/`;
  return key.startsWith(prefix) && key.length > prefix.length ? key : null;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** keel's removal-ticket refusals that have their own sentence. */
function removalTicketSentence(err: unknown): string | null {
  if (!(err instanceof OwV2Error)) return null;
  if (err.status === 404) return 'OnlyWorlds has no picture at this address that can be removed: it was not uploaded into this world, or it is already gone.';
  if (err.status === 403 && err.code === 'permission_error') return 'Only the person who uploaded this picture, or the world\'s owner, can remove it.';
  if (err.code === 'removal_in_flight') {
    const min = Math.max(1, Math.ceil((err.retryAfterMs ?? 600_000) / 60_000));
    return `A removal of this picture was started in the last ten minutes and not finished. Try again in ${min} minute${min === 1 ? '' : 's'}.`;
  }
  if (err.code === 'media_unavailable') return 'Removing pictures is not available on OnlyWorlds right now. Try again later.';
  return null;
}

/**
 * Remove one uploaded picture from OnlyWorlds. Resolves once the edge has
 * deleted it; the caller clears the image URLs that showed it (keel leaves
 * them, by contract). A removal asked the instant an upload replied can meet
 * keel before the edge's upload report does (about 600 ms, Skeld h20 #2496):
 * a 404, or the coming 409 upload_pending, gets one retry after a second (or
 * the Retry-After). Rejects with a `PlainError` when the reason has its own
 * sentence, else the raw error for `showProblem`.
 */
export async function removePicture(
  entry: WorldRegistryEntry,
  reg: WorldsRegistry,
  key: string,
): Promise<{ referenced: number; cacheMayLinger: boolean }> {
  if (!entry.api || entry.state !== 'api-linked') throw new PlainError('This world is not online, so Atlas cannot remove its pictures.');
  if (entry.api.read_only) throw new PlainError('This world is view-only here, so it cannot remove a picture.');
  const pin = worldPin(entry, reg);
  if (!pin) {
    throw new PlainError(isSeatWorld(entry) ? SEAT_SECRET_MISSING_LINE
      : 'Atlas needs your OnlyWorlds PIN to remove a picture. Enter it in Settings, under OnlyWorlds.');
  }
  const adapter = buildV2Adapter(entry.api.api_key, pin);
  let ticket: MediaRemovalTicket;
  for (let attempt = 0; ; attempt++) {
    try {
      ticket = await adapter.createMediaRemovalTicket(key);
      break;
    } catch (err) {
      const notYet = err instanceof OwV2Error && (err.status === 404 || err.code === 'upload_pending');
      if (attempt === 0 && notYet) {
        await sleep(Math.min((err as OwV2Error).retryAfterMs ?? 1000, 5000));
        continue;
      }
      const s = removalTicketSentence(err);
      throw s ? new PlainError(s) : err;
    }
  }
  const edge = (edgeOriginsForTests ?? EDGE_ORIGINS)[0];
  const res = await fetch(`${edge}/v1/remove`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ticket.ticket}` },
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await edgeError(res);
    // not_found: nothing is stored under the key any more, the end state asked for.
    if (err.status === 404) return { referenced: ticket.referenced, cacheMayLinger: false };
    if (err.code === 'remove_failed') throw new PlainError('OnlyWorlds could not remove the picture just now. Nothing was removed; try again.');
    if (err.code === 'not_removable') throw new PlainError('This picture was not uploaded into this world through Atlas or the toolkit, so it cannot be removed here.');
    // keel holds a second ticket back for ten minutes, so no quiet retry here.
    if (isTicketSpent(err)) throw new PlainError('OnlyWorlds did not accept the removal in time. Nothing was removed; try again in ten minutes.');
    throw err;
  }
  const body = await res.json().catch(() => ({})) as { cache?: unknown };
  // The edge purges the cached copy when it can; else the link may answer for a while.
  return { referenced: ticket.referenced, cacheMayLinger: body.cache !== 'purging' };
}
