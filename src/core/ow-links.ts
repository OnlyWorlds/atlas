/**
 * Element addresses in prose: the one place Atlas finds or rewrites them.
 *
 * `[Display Name](ow://<type>/<id>)` is how element chips round-trip through
 * markdown (convention #48). What counts as an address is the address
 * profile's rule, read by the SDK (`readOwLinkAt`, `parseOwLink`), never by a
 * pattern of Atlas's own: the prefix and the type word lowercase, the id an id
 * in either case of hex (read lowercase), then an optional `@moment` and
 * `?lens=<id>`; what follows is prose, a full stop included. `ow://Character/…`
 * and `ow://character/abc` are plain text. Where an address may begin is the
 * profile's too: one glued to a word before it (a letter of any script, a
 * combining mark, an underscore) is prose, so `elbow://…` and `_ow://…_` are
 * no address; a hyphen, a digit or any other mark before it does not glue.
 * The SDK's `findOwLinks` reads the whole text, so it sees that character;
 * Atlas keeps no finder, prefilter or start test of its own.
 *
 * Lives in core/ (not middle/) so TipTap-free consumers (the relation derive,
 * the knowledge room) can import without pulling the editor bundle in.
 *
 * An element address inside this world is the text form with no world
 * (`ow://character/<id>`). The other forms (a world's own address, another
 * world's, the site's link) are no element link in Atlas's prose; only the
 * share scrub reads them ({@link findAddresses}).
 */

// The SDK's finder and its found type share names with Atlas's own exports, so they come in aliased.
import { findOwLinks as findAllAddresses, readOwLinkAt, type OwAddressReading } from '@onlyworlds/sdk';

/** The text form's prefix, as the profile writes it. */
const OW_TEXT_PREFIX = 'ow://';
/** The site's form's prefix, as the profile writes it. */
const OW_SITE_PREFIX = 'https://www.onlyworlds.com/w/';

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
 * (the share scrub's reader: nothing that names an element may slip past it),
 * as the SDK's `findOwLinks` finds them: in order, none overlapping, none
 * glued to a word before it. What it leaves (a glued address, an address
 * inside a slug's run) the scrub's wide pass still reads
 * ({@link findLooseAddressRuns}).
 */
export function findAddresses(text: string): OwAddressFound[] {
  const out: OwAddressFound[] = [];
  if (typeof text !== 'string') return out;
  for (const f of findAllAddresses(text)) {
    const found = locate(text, f.start, f.end, f.reading);
    if (found) out.push(found);
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

/** Is an id held in the world (an element has exactly this id)? */
export type HeldId = (id: string) => boolean;

/**
 * THE RULE for an id in capitals, the one every reader asks: an address names
 * the element whose id equals its id as written; failing that, the element
 * whose id equals its lowercase reading; failing both, none. Atlas never
 * re-spells an id in prose. A chip's id is read the same way (as written,
 * then lowercase).
 */
export function namedId(link: Pick<OwLink, 'id' | 'idAsWritten'>, has: HeldId): string | null {
  if (has(link.idAsWritten)) return link.idAsWritten;
  if (link.id !== link.idAsWritten && has(link.id)) return link.id;
  return null;
}

/**
 * Does this address name the element held under `heldId`, by {@link namedId}?
 * `has` says which other ids the world holds (an id in capitals names the
 * element held that way before the lowercase one); without it, no other is.
 */
export function linkNamesId(link: Pick<OwLink, 'id' | 'idAsWritten'>, heldId: string, has?: HeldId): boolean {
  return namedId(link, id => id === heldId || (has ? has(id) : false)) === heldId;
}

/**
 * Does any element address in a text name the element held under `heldId`?
 * A case-blind look for the id comes first; the text is read only on a hit.
 */
export function proseNamesId(text: string, heldId: string, has?: HeldId): boolean {
  if (typeof text !== 'string' || !heldId || !text.toLowerCase().includes(heldId.toLowerCase())) return false;
  return findOwLinks(text).some(l => linkNamesId(l, heldId, has));
}

/** A chip's id (or any id as written) resolved by {@link namedId}: as written, then lowercase. */
export function lookupHeldId<T>(id: string, get: (id: string) => T | undefined | null): T | undefined {
  const found = (x: string): boolean => { const v = get(x); return v !== undefined && v !== null; };
  const named = namedId({ idAsWritten: id, id: id.toLowerCase() }, found);
  return named === null ? undefined : get(named) ?? undefined;
}

/** The text form's href for an element, as Atlas's chip writer writes it (the id as held). */
export function owLinkHref(type: string, id: string): string {
  return OW_TEXT_PREFIX + type + '/' + id;
}

/** A sentence's closing punctuation after a loose run, and after a pasted one. */
const RUN_CLOSERS = '.,;:!?\'"]>';
const PASTE_CLOSERS = '.,;:!?)]}>\'"';

/** The end of `s` with its trailing `closers` left out, found by walking back (linear). */
function trimmedEnd(s: string, closers: string): number {
  let end = s.length;
  while (end > 0 && closers.includes(s[end - 1])) end--;
  return end;
}

/** A run the share scrub reads loosely, with the id-forms in it. */
export interface LooseAddressRun {
  start: number;
  end: number;
  /** The id-forms, lowercase. */
  ids: string[];
  /** The same id-forms as the text spells them, so a reader can ask {@link namedId}. */
  idsAsWritten: string[];
}

/**
 * The share scrub's wide pass: wider than the address rules on purpose,
 * because it guards what a public page discloses. Every `ow://` or
 * `(http(s)://)(www.)onlyworlds.com/w/` prefix in any case, with its run of
 * characters that are not a space or `)`, and every id-form in that run
 * (8-4-4-4-12 hex in either case, given lowercase and as written). A link in capitals, an
 * unknown type word, another query key: whatever the address rules leave as
 * text is still seen here.
 */
export function findLooseAddressRuns(text: string): LooseAddressRun[] {
  const out: LooseAddressRun[] = [];
  if (typeof text !== 'string') return out;
  const runRe = /(?:ow:\/\/|(?:https?:\/\/)?(?:www\.)?onlyworlds\.com\/w\/)[^\s)]*/gi;
  const idRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  for (const m of text.matchAll(runRe)) {
    // A sentence's closing punctuation is the sentence's: it holds no id.
    const run = m[0].slice(0, trimmedEnd(m[0], RUN_CLOSERS));
    const idsAsWritten = [...run.matchAll(idRe)].map(x => x[0]);
    out.push({ start: m.index, end: m.index + run.length, ids: idsAsWritten.map(x => x.toLowerCase()), idsAsWritten });
  }
  return out;
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
  const m = /ow:\/\/|https:\/\/www\.onlyworlds\.com\/w\//i.exec(text);
  return m ? m.index : -1;
}

/**
 * The first address in a pasted text, as the string to read whole: the
 * address as prose reads it, or, when that does not read (a prefix in
 * capitals, a link cut short, a path that goes on past the address), the run
 * to the next space without a sentence's closing punctuation, which the
 * whole-string reader then refuses in words. Null when there is no prefix.
 * A paste is one address the person meant, so it is read from its first
 * prefix on, whatever stands before it: prose's start rule does not apply.
 */
export function pastedAddressIn(text: string): string | null {
  if (typeof text !== 'string') return null;
  const i = indexOfPrefixAnyCase(text);
  if (i === -1) return null;
  const at = readOwLinkAt(text.slice(i), 0);
  if (at && text[i + at.end] !== '/') return text.slice(i, i + at.end);
  let runEnd = i;
  while (runEnd < text.length && !/\s/.test(text[runEnd])) runEnd++;
  const run = text.slice(i, runEnd);
  return run.slice(0, trimmedEnd(run, PASTE_CLOSERS));
}
