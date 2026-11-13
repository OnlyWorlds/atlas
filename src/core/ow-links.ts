/**
 * Element addresses in prose: the one place Atlas finds or rewrites them.
 *
 * `[Display Name](ow://<type>/<id>)` is how element chips round-trip through
 * markdown (convention #48). What counts as an address is the address
 * profile's rule, read by the SDK (`readOwLinkAt`, `parseOwLink`), never by a
 * pattern of Atlas's own: the prefix and the type word lowercase, the id an id
 * in either case of hex (read lowercase), then an optional `@moment` and
 * `?lens=<id>`; what follows is prose, a full stop included. `ow://Character/…`
 * and `ow://character/abc` are plain text.
 *
 * Lives in core/ (not middle/) so TipTap-free consumers (the relation derive,
 * the knowledge room) can import without pulling the editor bundle in.
 *
 * An element address inside this world is the text form with no world
 * (`ow://character/<id>`). The other forms (a world's own address, another
 * world's, the site's link) are no element link in Atlas's prose; only the
 * share scrub reads them ({@link findAddresses}).
 */

import { readOwLinkAt, type OwAddressReading } from '@onlyworlds/sdk';

/** The text form's prefix, as the profile writes it. */
export const OW_TEXT_PREFIX = 'ow://';
/** The site's form's prefix, as the profile writes it. */
export const OW_SITE_PREFIX = 'https://www.onlyworlds.com/w/';

const ID_LENGTH = 36;
const LENS_KEY = '?lens=';

/** One address found in a text, with where its id and lens sit in it. */
export interface OwAddressFound {
  /** Index of the address's first character. */
  start: number;
  /** Index just past the address. */
  end: number;
  /** What the SDK reads for `text.slice(start, end)`. */
  reading: OwAddressReading;
  /** The id as the text spells it; null for a world's own address. */
  idAsWritten: string | null;
  /** Index of the id in the text; -1 without one. */
  idAt: number;
  /** The lens as the text spells it; null without one. */
  lensAsWritten: string | null;
  /** Index of the lens in the text; -1 without one. */
  lensAt: number;
}

/** An element address inside this world (the text form, no world). */
export interface OwLink {
  start: number;
  end: number;
  /** The type word (lowercase: the profile reads no other). */
  type: string;
  /** The id, lowercase (the profile's reading). */
  id: string;
  /** The id as the text spells it. */
  idAsWritten: string;
  /** The lens's id, lowercase; null without one. */
  lens: string | null;
  /** The lens as the text spells it; null without one. */
  lensAsWritten: string | null;
  moment: number | null;
}

function nextPrefix(text: string, from: number): number {
  const a = text.indexOf(OW_TEXT_PREFIX, from);
  const b = text.indexOf(OW_SITE_PREFIX, from);
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

/** Where the id and the lens sit inside an address the SDK read at [start, end). */
function locate(text: string, start: number, end: number, reading: OwAddressReading): OwAddressFound | null {
  let lensAt = -1;
  let lensAsWritten: string | null = null;
  let pathEnd = end;
  if (reading.lens !== null) {
    // The lens is the address's last part, and ends where its 36 characters end.
    lensAt = end - ID_LENGTH;
    lensAsWritten = text.slice(lensAt, end);
    if (text.slice(lensAt - LENS_KEY.length, lensAt) !== LENS_KEY || lensAsWritten.toLowerCase() !== reading.lens) return null;
    pathEnd = lensAt - LENS_KEY.length;
  }
  if (reading.moment !== null) {
    // No other part of an address carries an `@`.
    const at = text.indexOf('@', start);
    if (at === -1 || at >= pathEnd) return null;
    pathEnd = at;
  }
  let idAt = -1;
  let idAsWritten: string | null = null;
  if (reading.id !== null) {
    idAt = pathEnd - ID_LENGTH;
    idAsWritten = text.slice(idAt, pathEnd);
    if (idAt < start || idAsWritten.toLowerCase() !== reading.id) return null;
  }
  return { start, end, reading, idAsWritten, idAt, lensAsWritten, lensAt };
}

/**
 * Every address the SDK reads in a text, in either form and of any world
 * (the share scrub's reader: nothing that names an element may slip past it).
 * A text is walked once; an address is never read inside another.
 */
export function findAddresses(text: string): OwAddressFound[] {
  const out: OwAddressFound[] = [];
  if (typeof text !== 'string') return out;
  let i = nextPrefix(text, 0);
  while (i !== -1) {
    const at = readOwLinkAt(text, i);
    if (at) {
      const found = locate(text, i, at.end, at.reading);
      if (found) out.push(found);
      i = nextPrefix(text, Math.max(at.end, i + 1));
    } else {
      i = nextPrefix(text, i + 1);
    }
  }
  return out;
}

function asLink(f: OwAddressFound): OwLink | null {
  const r = f.reading;
  if (r.form !== 'text' || r.world !== null || r.type === null || r.id === null || f.idAsWritten === null) return null;
  return {
    start: f.start, end: f.end, type: r.type, id: r.id, idAsWritten: f.idAsWritten,
    lens: r.lens, lensAsWritten: f.lensAsWritten, moment: r.moment,
  };
}

/** The element addresses inside this world in a text, in order. */
export function findOwLinks(text: string): OwLink[] {
  if (typeof text !== 'string' || !text.includes(OW_TEXT_PREFIX)) return [];
  const out: OwLink[] = [];
  for (const f of findAddresses(text)) {
    const link = asLink(f);
    if (link) out.push(link);
  }
  return out;
}

/**
 * A link mark's href read whole: an element address inside this world that
 * ends exactly where the href ends, else null.
 */
export function readOwHref(href: unknown): OwLink | null {
  if (typeof href !== 'string' || !href.startsWith(OW_TEXT_PREFIX)) return null;
  const at = readOwLinkAt(href, 0);
  if (!at || at.end !== href.length) return null;
  const found = locate(href, 0, at.end, at.reading);
  return found ? asLink(found) : null;
}

/** An address that is a chip: no moment and no lens (one with either stays a link). */
export function isChipLink(link: OwLink): boolean {
  return link.moment === null && link.lens === null;
}

/**
 * Does this address name the element held under `heldId`? As written first,
 * then the profile's lowercase reading (the re-key's lookup, so the two agree).
 */
export function linkNamesId(link: Pick<OwLink, 'id' | 'idAsWritten'>, heldId: string): boolean {
  return link.idAsWritten === heldId || link.id === heldId;
}

/** Does any element address in a text name the element held under `heldId`? */
export function proseNamesId(text: string, heldId: string): boolean {
  return findOwLinks(text).some(l => linkNamesId(l, heldId));
}

/** An id looked up as held, then lowercase: the chip resolver's rule. */
export function lookupHeldId<T>(id: string, get: (id: string) => T | undefined | null): T | undefined {
  const held = get(id);
  if (held !== undefined && held !== null) return held;
  const lower = id.toLowerCase();
  if (lower === id) return undefined;
  return get(lower) ?? undefined;
}

/** What a rewrite gives back for one address: a new id, a new lens, either or neither. */
export interface OwLinkRewrite {
  id?: string | null;
  lens?: string | null;
}

/**
 * The one rewriter: `fn` sees each element address inside this world and
 * returns a new id and lens (null or absent keeps it). Only the bytes of the
 * id and the lens change; the type word, the moment and every byte outside
 * the address stay as they are. A text where nothing moves comes back as the
 * same string.
 */
export function rewriteOwLinks(text: string, fn: (link: OwLink) => OwLinkRewrite | null | undefined): string {
  if (typeof text !== 'string' || !text.includes(OW_TEXT_PREFIX)) return text;
  const edits: Array<{ at: number; len: number; to: string }> = [];
  for (const f of findAddresses(text)) {
    const link = asLink(f);
    if (!link) continue;
    const r = fn(link);
    if (!r) continue;
    if (r.id && r.id !== link.idAsWritten) edits.push({ at: f.idAt, len: ID_LENGTH, to: r.id });
    if (r.lens && f.lensAt !== -1 && r.lens !== link.lensAsWritten) edits.push({ at: f.lensAt, len: ID_LENGTH, to: r.lens });
  }
  if (edits.length === 0) return text;
  edits.sort((a, b) => a.at - b.at);
  let out = '';
  let last = 0;
  for (const e of edits) {
    out += text.slice(last, e.at) + e.to;
    last = e.at + e.len;
  }
  return out + text.slice(last);
}

/** Index of the first address prefix in any case (a paste in capitals is refused for its case, not missed). */
function indexOfPrefixAnyCase(text: string): number {
  const prefixes = [OW_TEXT_PREFIX, OW_SITE_PREFIX];
  for (let i = 0; i < text.length; i++) {
    for (const p of prefixes) {
      if (text.length - i >= p.length && text.slice(i, i + p.length).toLowerCase() === p) return i;
    }
  }
  return -1;
}

/**
 * The first address in a pasted text, as the string to read whole: the
 * address as prose reads it, or, when that does not read (a prefix in
 * capitals, a link cut short, a path that goes on past the address), the run
 * to the next space without a sentence's closing punctuation, which the
 * whole-string reader then refuses in words. Null when there is no prefix.
 */
export function pastedAddressIn(text: string): string | null {
  if (typeof text !== 'string') return null;
  const i = indexOfPrefixAnyCase(text);
  if (i === -1) return null;
  const at = readOwLinkAt(text, i);
  if (at && text[at.end] !== '/') return text.slice(i, at.end);
  const run = /^\S*/.exec(text.slice(i))?.[0] ?? '';
  return run.replace(/[.,;:!?)\]}>'"]+$/, '');
}

/** @deprecated The old pattern pair, kept only until its last reader moves onto the SDK's reading. */
export const OW_LINK_HREF_RE = /^ow:\/\/([a-z_]+)\/([\w-]+)$/i;

/** @deprecated See {@link OW_LINK_HREF_RE}. */
export function createOwLinkScanner(): RegExp {
  return /ow:\/\/([a-z_]+)\/([\w-]+)/gi;
}
