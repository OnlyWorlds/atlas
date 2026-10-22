/**
 * Deleting an element removes its id from every link that named it (S362).
 *
 * keel does this on its side of every delete (`_scrub_cross_type`: a single
 * link becomes null, a multi link drops the id, the referrer's `updated_at`
 * moves). Atlas did not, so a local delete left the dead id in every element
 * that linked to it: the detail pane showed a raw id chip, and once the world
 * went online keel refused those elements with `invalid_link` on every round,
 * so they never uploaded. This is the local mirror of keel's rule.
 *
 * Scope is the schema's link fields (`relationFieldsFor`, both stores' in-memory
 * shape). Pin `element_id` is left alone on purpose: a UI delete cascades the
 * pins that point at the element, and a pin with no element is not a state
 * atlas draws. Prose (`ow://` links, chips) is user text and keel does not
 * touch it either.
 *
 * Pure half (`deadLinkPatch`, `findDanglingLinks`) plus one store walk
 * (`scrubReferrers`) shared by FsFolderStore and the MockFolderStore fixture.
 */
import type { Element, ElementType } from '../core/types';
import { relationFieldsFor } from '../editor/field-schema';

/** A link value as foreign folders write it: an id, an `{id}` object, or a list of either. */
function idOf(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') return (v as { id: string }).id;
  return null;
}

function linkFields(type: ElementType) {
  return relationFieldsFor(type).filter(f => !(type === 'pin' && f.diskField === 'element_id'));
}

/**
 * The patch that removes every id in `dead` from `el`'s link fields, or null
 * when `el` names none of them. Single links clear to `null` and multi links
 * keep their other entries (convention 21: clear with null / [], never undefined).
 */
export function deadLinkPatch(el: Element, dead: ReadonlySet<string>): Partial<Element> | null {
  const rec = el as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const f of linkFields(el.type)) {
    const v = rec[f.diskField];
    if (v == null) continue;
    if (Array.isArray(v)) {
      const kept = v.filter(x => { const id = idOf(x); return id === null || !dead.has(id); });
      if (kept.length !== v.length) patch[f.diskField] = kept;
    } else {
      const id = idOf(v);
      if (id !== null && dead.has(id)) patch[f.diskField] = f.kind === 'multi' ? [] : null;
    }
  }
  return Object.keys(patch).length > 0 ? (patch as Partial<Element>) : null;
}

/**
 * The inverse of `deadLinkPatch` for a delete keel refused (conv. 163, P6;
 * the S454 gate's G3): the links `server` still holds to an id in `back` that
 * `local` dropped, put back. A multi link that differs only by those ids takes
 * keel's list (its order); one edited here too gets them appended. A single
 * link comes back only where it is empty here: a link changed since is a
 * newer edit. Null when there is nothing to put back.
 */
export function restoredLinkPatch(local: Element, server: Element, back: ReadonlySet<string>): Partial<Element> | null {
  const mine = local as unknown as Record<string, unknown>;
  const theirs = server as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const f of linkFields(local.type)) {
    const s = theirs[f.diskField];
    const l = mine[f.diskField];
    if (s == null) continue;
    if (Array.isArray(s)) {
      const lost = s.filter(x => { const id = idOf(x); return id !== null && back.has(id); });
      const here = Array.isArray(l) ? l : [];
      const hereIds = new Set(here.map(idOf));
      const missing = lost.filter(x => !hereIds.has(idOf(x)));
      if (missing.length === 0) continue;
      const rest = (list: unknown[]) => list.map(idOf).filter(id => id === null || !back.has(id)).join('\u0000');
      patch[f.diskField] = rest(s) === rest(here) ? s : [...here, ...missing];
    } else {
      const id = idOf(s);
      if (id !== null && back.has(id) && (l == null || l === '')) patch[f.diskField] = s;
    }
  }
  return Object.keys(patch).length > 0 ? (patch as Partial<Element>) : null;
}

/**
 * Remove the `dead` ids from every other element's links, each referrer through
 * its own write chain (`updateElementWith` reads the file as it is on disk and
 * stamps it, so a synced referrer pushes the cleared link on its next round).
 * Returns the ids of the elements it changed.
 */
export async function scrubReferrers(
  store: {
    listElements(): Promise<Element[]>;
    updateElementWith(id: string, mutate: (existing: Element) => Partial<Element> | null): Promise<Element | null>;
  },
  dead: ReadonlySet<string>,
): Promise<string[]> {
  if (dead.size === 0) return [];
  const changed: string[] = [];
  for (const el of await store.listElements()) {
    if (dead.has(el.id) || deadLinkPatch(el, dead) === null) continue;
    let wrote = false;
    await store.updateElementWith(el.id, onDisk => {
      const patch = deadLinkPatch(onDisk, dead);
      wrote = patch !== null;
      return patch;
    });
    if (wrote) changed.push(el.id);
  }
  return changed;
}

export interface DanglingLink {
  elementId: string;
  field: string;
  missingId: string;
}

/**
 * Every link in `elements` that names an id not among them. For a LOCAL world
 * that is a link to something deleted (or never imported); for a linked world
 * it can also be an element that simply has not been downloaded yet, so
 * callers offer the repair only where absence means gone.
 */
export function findDanglingLinks(elements: readonly Element[]): DanglingLink[] {
  const present = new Set(elements.map(e => e.id));
  const out: DanglingLink[] = [];
  for (const el of elements) {
    const rec = el as unknown as Record<string, unknown>;
    for (const f of linkFields(el.type)) {
      const v = rec[f.diskField];
      if (v == null) continue;
      for (const x of Array.isArray(v) ? v : [v]) {
        const id = idOf(x);
        if (id && !present.has(id)) out.push({ elementId: el.id, field: f.diskField, missingId: id });
      }
    }
  }
  return out;
}
