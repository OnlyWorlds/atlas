/**
 * ONE ELEMENT, ONE PIN, ONE MAP.
 *
 * Captain's rule (S306, after dragging the Consul onto a zone and then using
 * [+pin] to get a second Consul pin on the same map): an element must never
 * hold two pins on one map.
 *
 * DELIBERATELY STORE-FREE AND DOM-FREE — a pure predicate over element
 * bodies. It lifts verbatim.
 *
 * Why it lives here rather than at a call site: there are five paths that
 * create a pin (arm [+pin] then click the map · right-click "new pin" with a
 * new element · right-click "place existing" · drag-drop from the elements
 * sidebar · the import plan applier), and NONE of them deduped. Four funnel
 * through `createPin`, but the import applier calls `createElement('pin', …)`
 * directly, so a guard installed in the `createPin` convenience wrapper would
 * look right and silently miss import. The guard belongs at `createElement`,
 * and the RULE belongs here, where both FolderStore implementations read it —
 * a fake that accepts what production rejects manufactures confident-wrong
 * tests (convention 20).
 *
 * SEMANTICS, stated precisely because the caller passes its own corpus:
 * a positive match means the duplicate genuinely exists, so this can never
 * reject a legitimate create. If the caller's corpus is incomplete the guard
 * under-fires, which is exactly today's behaviour and therefore safe.
 */
import type { Element, Pin } from './types';
import { PlainError } from './plain-error';

/**
 * The refusal, as a TYPE rather than a message.
 *
 * Call sites need to tell "this element is already pinned here" (an ordinary,
 * explainable outcome) apart from "the write failed" (a bug). Matching on
 * error TEXT would make every copy edit a silent behaviour change — the same
 * rot that made "hover a dotted word" describe a gesture the code does not
 * have. The name check keeps the guard working even if the class identity is
 * duplicated across a chunk boundary.
 */
export class DuplicatePinError extends PlainError {
  readonly existingPinId: string;
  constructor(existingPinId: string) {
    super('That element already has a pin on this map.');
    this.name = 'DuplicatePinError';
    this.existingPinId = existingPinId;
  }
}

export function isDuplicatePinError(err: unknown): err is DuplicatePinError {
  return err instanceof Error && err.name === 'DuplicatePinError';
}

/**
 * Returns the pin that already occupies `(element_id, map_id)`, if any.
 *
 * `ignoreId` exempts the candidate's own record so that re-writing an
 * existing pin (an update expressed as a create, e.g. a PUT-style upsert on
 * import) is never mistaken for a duplicate of itself.
 */
export function findDuplicatePin(
  candidate: Partial<Pin>,
  existing: Iterable<Element>,
  ignoreId?: string,
): Pin | undefined {
  const elementId = candidate.element_id;
  const mapId = candidate.map_id;
  // A pin with no element or no map is not yet a placement — nothing to
  // collide with. (The wire dialect calls these `element`/`map`; this
  // predicate deliberately speaks DISK field names only, because that is the
  // shape every FolderStore write carries.)
  if (!elementId || !mapId) return undefined;

  for (const el of existing) {
    if (el.type !== 'pin') continue;
    const pin = el as Pin;
    if (pin.id === ignoreId) continue;
    if (pin.element_id !== elementId) continue;
    if (pin.map_id !== mapId) continue;
    return pin;
  }
  return undefined;
}
