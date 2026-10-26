/**
 * The keep-safe card (1.17, contract §6.1): a world of
 * the user's own that lives only in this browser asks for a copy before it
 * matters. Pure: the home renders what this answers.
 *
 * Shown past the threshold (25 elements, or a scene with words, or a map with
 * an image), never for a folder world, the tour, a view-only world, a cleared
 * one, or while the world is still loading. A download hides it until the
 * world changed since AND a week has passed; × hides it for a week. A world
 * that is online, or exported as JSON, still gets it, reduced: the account or
 * the file holds the elements but not what Atlas keeps beside them.
 *
 * Named limit: "changed" is the newest `local_updated_at` of the elements the
 * home holds; notes, charts, styles and the world's name do not move it.
 */

import type { Element, WorldRegistryEntry } from '../core/types';
import { isBrowserWorld } from '../core/browser-worlds';
import { entryIsViewOnly } from '../core/view-only';

export const KEEPSAFE_THRESHOLD = 25;
const WEEK_MS = 7 * 86_400_000;

export interface KeepSafeCard {
  /** `online` / `export`: the elements have a copy elsewhere, the rest does not. */
  reduced: 'online' | 'export' | null;
}

function worthKeeping(elements: Element[]): boolean {
  if (elements.length >= KEEPSAFE_THRESHOLD) return true;
  return elements.some(el => {
    const e = el as Element & { story?: unknown; image_url?: unknown; image_media_id?: unknown };
    if (el.type === 'narrative') return typeof e.story === 'string' && e.story.trim() !== '';
    if (el.type === 'map') return !!e.image_url || !!e.image_media_id;
    return false;
  });
}

function newestChangeAt(elements: Element[]): number {
  let max = 0;
  for (const el of elements) {
    const t = Date.parse(String((el as { local_updated_at?: unknown }).local_updated_at ?? ''));
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

export function keepSafeCard(input: {
  entry: WorldRegistryEntry | undefined;
  elements: Element[];
  loading: boolean;
  now: number;
}): KeepSafeCard | null {
  const { entry, elements, loading, now } = input;
  if (!entry || loading || !isBrowserWorld(entry) || entry.demo === true || entry.cleared_at) return null;
  // A view-only copy (conv. 177) is kept safe by the world it copies.
  if (entryIsViewOnly(entry)) return null;
  if (!worthKeeping(elements)) return null;
  const snoozed = Date.parse(entry.keep_nudge_snoozed_until ?? '');
  if (Number.isFinite(snoozed) && now < snoozed) return null;
  const downloaded = Date.parse(entry.kept_download_at ?? '');
  if (Number.isFinite(downloaded)) {
    const changedSince = newestChangeAt(elements) > downloaded;
    if (!changedSince || now < downloaded + WEEK_MS) return null;
  }
  const reduced = entry.state === 'api-linked' && entry.api ? 'online' : entry.kept_export_at ? 'export' : null;
  return { reduced };
}

/** A week from `now`: when × hides the card until. */
export function snoozeUntil(now: number): string {
  return new Date(now + WEEK_MS).toISOString();
}
