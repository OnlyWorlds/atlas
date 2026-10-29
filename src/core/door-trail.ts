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

/** The element's trail, newest first; empty when OnlyWorlds has said nothing of it. */
export function doorTrail(el: Element): TrailStep[] {
  const rec = el as Record<string, unknown>;
  const body = { ...rec, updated_at: rec.server_updated_at };
  return doorsOf(body).map(d => ({ where: doorWhere(d), at: d.at }));
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
