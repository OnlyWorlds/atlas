/**
 * A pasted OnlyWorlds address (the address profile): the site's link to a
 * world or an element (`https://www.onlyworlds.com/w/<world>/<type>/<id>`),
 * or the `ow://` text form with its world. It goes to the `#/open` door
 * (`open-capture.ts`, `setup/open-door.ts`), the same door as Open in Atlas
 * on onlyworlds.com, so it opens nothing the door would not: a world already
 * here, or an account world after the person says Open. The SDK's
 * `parseOwLink` reads it; a lens or a moment is set aside and the element
 * opens. Two ways in: a row in the search palette, and a paste anywhere
 * outside a text field.
 */

import { OwAddressError, parseOwLink } from '@onlyworlds/sdk';
import { UUID_RE } from './open-capture';

// Found by its prefix, in any case, so a link in capitals is refused for its
// case rather than missed.
const ADDRESS_RE = /(?:https:\/\/www\.onlyworlds\.com\/w\/|ow:\/\/)\S*/i;

export const ADDRESS_SLUG_LINE = 'This link names the world by its page name, which Atlas does not read. On OnlyWorlds, use Copy link: that link names the world by its id.';
export const ADDRESS_NO_WORLD_LINE = 'This address names an element but not its world. Copy the link from OnlyWorlds, which names both.';
export const ADDRESS_BROKEN_LINE = 'Atlas cannot read this link: part of it is missing or changed. Copy it again from OnlyWorlds.';

/** The first address in a piece of text, without the punctuation a sentence puts after it. */
export function addressIn(text: string): string | null {
  const found = text.match(ADDRESS_RE)?.[0];
  return found ? found.replace(/[.,;:!?)\]}>'"]+$/, '') : null;
}

/**
 * The door's hash for a pasted address (`#/open/<world>[/element/<id>]`),
 * or the refusal in words. Null when the text holds no address.
 */
export function openHashOfAddress(text: string): { hash: string } | { refused: string } | null {
  const address = addressIn(text);
  if (!address) return null;
  let r;
  try {
    r = parseOwLink(address);
  } catch (e) {
    if (e instanceof OwAddressError) return { refused: ADDRESS_BROKEN_LINE };
    throw e;
  }
  // The SDK reads any world that is not an id as a page name; one that starts
  // like an id is a paste cut short.
  if (r.worldIsSlug) return { refused: /^[0-9a-f]{8}-/i.test(r.world ?? '') ? ADDRESS_BROKEN_LINE : ADDRESS_SLUG_LINE };
  if (!r.world) return { refused: ADDRESS_NO_WORLD_LINE };
  if (!UUID_RE.test(r.world) || (r.id && !UUID_RE.test(r.id))) return { refused: ADDRESS_BROKEN_LINE };
  return { hash: r.id ? `#/open/${r.world}/element/${r.id}` : `#/open/${r.world}` };
}

/** A paste lands in a field the person is typing in: the field takes it, never the door. */
export function pasteIsForAField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}
