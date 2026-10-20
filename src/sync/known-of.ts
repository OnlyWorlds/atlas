/**
 * keel's "known of" stubs (PR 113, B16; the folder spec §4.4; contract
 * `Forge/Notes/2026-10-20-s443-known-of-stubs.md`, conv. 155). A guest
 * playing a Character reads what its own Character points to, one step out;
 * an element reached only that way comes as a stub, `known_of: true`, with
 * every field but a few served unset. Atlas stores it as a stub, never
 * pushes or edits it, and shows it as known of.
 */
import type { Element } from '../core/types';
import { PlainError } from '../core/plain-error';

/** The keys a stub keeps (keel PR 113; `change_seq` never lands on disk). */
export const KNOWN_OF_KEPT_KEYS: readonly string[] = [
  'id', 'type', 'name', 'description', 'supertype', 'subtype', 'image_url', 'created_at', 'updated_at',
];

/**
 * Atlas's own fields that mirror a wire field the stub leaves unset (the
 * story's rich text, a page's blocks): a stub does not keep them, or the
 * story's text would stay on disk and in the writing room (S443 gate G6).
 */
export const KNOWN_OF_DROPS_LOCAL: readonly string[] = ['atlas_richtext_json', 'atlas_page_blocks', 'atlas_page_refs'];

export function isKnownOf(el: unknown): boolean {
  return !!el && typeof el === 'object' && (el as Record<string, unknown>).known_of === true;
}

/**
 * I1 (rule 1): a stub as it is, `known_of: true` and only the kept keys. The
 * unset fields are left out, never written as `""`, `null` or `[]`.
 */
export function stubShape(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of KNOWN_OF_KEPT_KEYS) if (k in record) out[k] = record[k];
  out.known_of = true;
  return out;
}

/**
 * What a pull does when the copy and the server differ in shape (the stamp
 * does not move with it, so the ordinary stamp test cannot see it):
 * - `apply`: a stub arriving whole (I2), or a stub replacing a whole copy on
 *   the walk a `view` reset started, the copy holding no edit never sent (I3);
 * - `keep`: a whole copy meeting a stub on any other walk, holding an unsent
 *   edit, or kept as last known before (`keptWhole`: a role reset kept it, and
 *   a later view reset is not the reset that brought the stub; S443 gate G1)
 *   (I3, B12: a member keeps what they had);
 * - `same`: no change of shape; the stamp decides as before.
 */
export function knownOfMove(
  local: Element, remote: Record<string, unknown>, viewWalk: boolean, keptWhole = false,
): 'apply' | 'keep' | 'same' {
  const was = isKnownOf(local);
  const now = isKnownOf(remote);
  if (was === now) return 'same';
  if (was) return 'apply';
  const unsent = !local.server_updated_at || (local.local_updated_at ?? '') > local.server_updated_at;
  return viewWalk && !unsent && !keptWhole ? 'apply' : 'keep';
}

/** I5: what the store says when a stub would be changed or deleted here. */
export const KNOWN_OF_REFUSAL = 'This one is only known of here: you know its name and what is said of it, not the rest, so it cannot be changed.';

/** I4: a body carrying `known_of` is refused before it is sent, never stripped (Kael h29 #8569). */
export function refuseKnownOfBody(body: Record<string, unknown>): void {
  if ('known_of' in body) throw new PlainError(KNOWN_OF_REFUSAL);
}
