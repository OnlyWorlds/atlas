/**
 * keel's "known of" stubs (PR 113, B16; the folder spec §4.4;
 * conv. 155). A guest
 * playing a Character reads what its own Character points to, one step out;
 * an element reached only that way comes as a stub, `known_of: true`, with
 * every field but a few served unset. Atlas stores it as a stub, never
 * pushes or edits it, and shows it as known of.
 */
import type { Element } from '../core/types';
import { PlainError } from '../core/plain-error';
import { SERVER_AUTHOR_FIELDS } from '../core/constants';

/** The keys a stub keeps (`change_seq` never lands on disk). */
export const KNOWN_OF_KEPT_KEYS: readonly string[] = [
  'id', 'type', 'name', 'description', 'supertype', 'subtype', 'image_url', 'created_at', 'updated_at',
];

/**
 * Atlas's own fields that mirror a wire field the stub leaves unset (the
 * story's rich text, a page's blocks): a stub does not keep them, or the
 * story's text would stay on disk and in the writing room.
 */
export const KNOWN_OF_DROPS_LOCAL: readonly string[] = ['atlas_richtext_json', 'atlas_page_blocks', 'atlas_page_refs'];

export function isKnownOf(el: unknown): boolean {
  return !!el && typeof el === 'object' && (el as Record<string, unknown>).known_of === true;
}

/** Who wrote it: null on every stub keel serves (the SDK's `known_of` doc), never kept on one. */
const KNOWN_OF_AUTHOR_KEYS: readonly string[] = SERVER_AUTHOR_FIELDS;

function unset(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * I1 (rule 1): a stub as it is, `known_of: true`, the kept keys, and the
 * fields keel shares on a stub (PR 117: a Character's physicality,
 * height, weight, species and reputation, from a public tag in keel's
 * schema). keel serves every other field unset, so a field with a value is one
 * keel shares: read from the wire, never from a list here that keel's schema
 * outgrows (this list alone dropped PR 117's fields on live 1.64.0). The
 * unset fields are left out, never written as `""`, `null` or `[]`.
 */
export function stubShape(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (KNOWN_OF_AUTHOR_KEYS.includes(k) || k === 'change_seq') continue;
    if (KNOWN_OF_KEPT_KEYS.includes(k) || !unset(v)) out[k] = v;
  }
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
 *   a later view reset is not the reset that brought the stub)
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

/** I4: a body carrying `known_of` is refused before it is sent, never stripped (Kael 2026-10-20). */
export function refuseKnownOfBody(body: Record<string, unknown>): void {
  if ('known_of' in body) throw new PlainError(KNOWN_OF_REFUSAL);
}
