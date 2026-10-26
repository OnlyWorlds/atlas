/**
 * Links to elements this key no longer sees (conv. 151).
 *
 * keel, probed live on 2026-10-20:
 * a guest reads its own element with the links it may
 * not see left out, refuses a write that names one (400 `invalid_link`, "does
 * not exist"), and puts the hidden links back on a PATCH that leaves them out,
 * single and multi alike. So Atlas mirrors keel: a kept id never goes out in a
 * body, and keel's silence about one never erases it from the copy. Pure.
 */
import type { ElementType } from '../core/types';
import { relationFieldsFor } from '../editor/field-schema';

/**
 * The body to send: every kept id left out of its link field. A single link to
 * one leaves the field out of the body, keel's "no change" (null
 * was probed only on a Character's location, and a pin's
 * `element_id` travels with `element_type`).
 */
export function withoutKeptLinks(type: ElementType, body: Record<string, unknown>, kept: ReadonlySet<string>): Record<string, unknown> {
  if (kept.size === 0) return body;
  let out: Record<string, unknown> | null = null;
  for (const f of relationFieldsFor(type)) {
    const v = body[f.diskField];
    if (f.kind === 'multi' && Array.isArray(v) && v.some(id => typeof id === 'string' && kept.has(id))) {
      out ??= { ...body };
      out[f.diskField] = v.filter(id => !(typeof id === 'string' && kept.has(id)));
    } else if (f.kind === 'single' && typeof v === 'string' && kept.has(v)) {
      out ??= { ...body };
      delete out[f.diskField];
      // A pin names its element by the pair; neither half goes alone.
      if (f.diskField === 'element_id') delete out.element_type;
    }
  }
  return out ?? body;
}

/** The server's record with the copy's kept links put back where keel's read left them out. */
export function withKeptLinks(
  type: ElementType,
  remote: Record<string, unknown>,
  local: Record<string, unknown>,
  kept: ReadonlySet<string>,
): Record<string, unknown> {
  if (kept.size === 0) return remote;
  let out: Record<string, unknown> | null = null;
  for (const f of relationFieldsFor(type)) {
    const mine = local[f.diskField];
    if (f.kind === 'multi' && Array.isArray(mine)) {
      const keptMine = mine.filter((id): id is string => typeof id === 'string' && kept.has(id));
      if (keptMine.length === 0) continue;
      const theirs = Array.isArray(remote[f.diskField]) ? remote[f.diskField] as unknown[] : [];
      const back = keptMine.filter(id => !theirs.includes(id));
      if (back.length === 0) continue;
      out ??= { ...remote };
      out[f.diskField] = [...theirs, ...back];
    } else if (f.kind === 'single' && typeof mine === 'string' && kept.has(mine)) {
      const theirs = remote[f.diskField];
      if (theirs !== null && theirs !== undefined && theirs !== '') continue;
      out ??= { ...remote };
      out[f.diskField] = mine;
    }
  }
  return out ?? remote;
}
