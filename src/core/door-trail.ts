/**
 * Where an element has been: the tools that wrote it on OnlyWorlds, newest
 * first, for the element page's footer.
 *
 * keel's `doors` (members only) holds one key per tool that wrote the element,
 * its `X-OW-Client` name or, for a write that named no client, its door word,
 * each with that tool's last write time. The SDK's `doorsOf` reads it (and
 * falls back to the last write's `changed_client` or `changed_via` for an
 * element written before the field existed), and its `doorWhere` says each in
 * the Waymark's name-line words (a listed tool "in <its name>", the site "on
 * onlyworlds.com", the agent doors "with an AI", keel's own write "by
 * OnlyWorlds", anything else "in code"; one table for every tool, SDK 4.108).
 * Atlas says no "by you": it does not keep the reader's membership, and the
 * trail claims nothing past the door.
 *
 * Pure. Atlas keeps keel's `updated_at` as `server_updated_at`, so the trail
 * reads it under keel's name.
 */
import { doorsOf, doorWhere } from '@onlyworlds/sdk';
import { hiddenKeptOf, hiddenWordOf } from './hidden-mark';
import type { Element } from './types';

export interface TrailStep {
  /** "in Atlas", "on onlyworlds.com", "with an AI", "by OnlyWorlds", "in code". */
  where: string;
  /** The time as keel served it. */
  at: string;
}

/** keel's answer to a read of the element: its door record and the time it was read at. */
export interface DoorRead {
  doors: Record<string, unknown> | null;
  updated_at: string | null;
  /** The last write's door, for an element keel has no door record on (written before `doors` existed). */
  changed_client?: string | null;
  changed_via?: string | null;
}

/** Is this read at least as new as the copy? (A copy with no time is older than any read.) */
export function readCovers(read: DoorRead | null | undefined, copyUpdated: unknown): boolean {
  if (!read || !read.updated_at) return false;
  const copy = typeof copyUpdated === 'string' ? Date.parse(copyUpdated) : NaN;
  return !Number.isFinite(copy) || Date.parse(read.updated_at) >= copy;
}

/**
 * The element's trail, newest first, one step per phrase; empty when OnlyWorlds has said
 * nothing of it.
 *
 * keel serves `doors` on a read and a write's answer, never in /changes, so a copy a pull
 * wrote holds only its last write's door. `read` is keel's answer to reading the element
 * (`sync/element-doors.ts`): the trail is the newer of the two records, whole, never a
 * merge, since keel moves `updated_at` without a door when it scrubs a link to a deleted
 * element, and the copy's last write read at that time would name a door keel never recorded.
 */
export function doorTrail(el: Element, read?: DoorRead | null): TrailStep[] {
  const rec = el as Record<string, unknown>;
  const updated_at = rec.server_updated_at;
  const source = readCovers(read, updated_at) ? { updated_at: read!.updated_at, doors: read!.doors, changed_client: read!.changed_client, changed_via: read!.changed_via } : { ...rec, updated_at };
  const seen = new Set<string>();
  const out: TrailStep[] = [];
  for (const d of doorsOf(source)) {
    const where = doorWhere(d);
    if (seen.has(where)) continue; // "in code" stands for many doors: its newest says it
    seen.add(where);
    out.push({ where, at: d.at });
  }
  return out;
}

/**
 * keel's `doors` on an answer to a write, for the stamp: the copy keeps the
 * door record of the write it is stamped from, so the trail names this write
 * too and not only the last read's. An answer without an object `doors` (a
 * `/bulk` echo, a public reader's body) leaves the copy's as it was.
 */
export function doorsKeptOf(answer: unknown): Record<string, unknown> | undefined {
  if (!answer || typeof answer !== 'object') return undefined;
  const doors = (answer as Record<string, unknown>).doors;
  if (!doors || typeof doors !== 'object' || Array.isArray(doors)) return undefined;
  return { doors };
}

/** A stamp's `kept` from keel's answer: the hidden word (`hiddenWordOf`) and the door record. */
export function stampWordOf(answer: unknown): Record<string, unknown> | undefined {
  return merged(hiddenWordOf(answer), doorsKeptOf(answer));
}

/** The same with keel's hidden mark when keel hides the element (`hiddenKeptOf`). */
export function stampKeptOf(answer: unknown): Record<string, unknown> | undefined {
  return merged(hiddenKeptOf(answer), doorsKeptOf(answer));
}

function merged(...parts: (Record<string, unknown> | undefined)[]): Record<string, unknown> | undefined {
  const out = Object.assign({}, ...parts) as Record<string, unknown>;
  return Object.keys(out).length > 0 ? out : undefined;
}
