/**
 * What a key that cannot hide holds back (folder spec §4.8, conv. 170). keel
 * takes `hidden: true` on a create from the owner or a co-builder only (keel
 * #587; probed live: anyone else gets 403 `hidden_not_allowed` and
 * nothing is made). So for a contributor or a guest a hidden element that was
 * never sent stays in the folder, and so does whatever is anchored on it: a
 * pin, marker or zone whose link would otherwise go up stripped, a loose
 * visible thing named after the hidden one. Links from
 * other elements stay in the copy and never go out (`linkHeld`). Pure.
 */
import type { Element } from '../core/types';
import { relationFieldsFor } from '../editor/field-schema';
import { isHiddenMark } from '../core/hidden-mark';

const ANCHORED = new Set(['pin', 'marker', 'zone']);

/** The never-sent elements held: the hidden ones, then, to a fixpoint, the pins, markers and zones on a held one. */
export function hiddenHeldOf(creates: readonly Element[]): Set<string> {
  const held = new Set(creates.filter(isHiddenMark).map(e => e.id));
  if (held.size === 0) return held;
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of creates) {
      if (held.has(e.id) || !ANCHORED.has(e.type)) continue;
      const rec = e as unknown as Record<string, unknown>;
      const onHeld = relationFieldsFor(e.type).some(f => f.kind === 'single' && typeof rec[f.diskField] === 'string' && held.has(rec[f.diskField] as string));
      if (onHeld) { held.add(e.id); grew = true; }
    }
  }
  return held;
}
