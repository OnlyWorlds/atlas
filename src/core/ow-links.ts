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

import { ELEMENT_TYPES, readOwLinkAt, type OwAddressReading } from '@onlyworlds/sdk';

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

/*
 * The SDK reads an address; Atlas only decides when to ask, and how much
 * text to hand it, so a walk over any text stays linear. A read that fails
 * costs the SDK about a millisecond, so a prefix is first held against the
 * address's core shape (a cheap sticky match: the prefix, then a world or a
 * type word from the SDK's own list, and ids), and a prefix with no core is
 * no address without asking. A core is never shorter than what the SDK reads
 * from it, so nothing it would read is missed (the profile's 57 prose cases
 * and a fuzz pass hold it). The SDK is then handed the core and the stretch
 * after it that a moment, a lens and the next character can take, or the
 * core alone when a path character follows it (a path or a word that goes on
 * past the core is one the SDK does not take: its reading ends at the core
 * either way; the site's form, whose world run is read whole, never ends its
 * core before such a character).
 */
const ID_SRC = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const TYPES_SRC = [...ELEMENT_TYPES].sort((a, b) => b.length - a.length).join('|');
const TEXT_CORE = new RegExp(`ow://(?:(?:${TYPES_SRC})/${ID_SRC}|${ID_SRC}(?:/(?:${TYPES_SRC})/${ID_SRC})?)`, 'y');
const SITE_CORE = new RegExp(`https://www\\.onlyworlds\\.com/w/[0-9A-Za-z-]{1,64}(?:/(?:${TYPES_SRC})/${ID_SRC})?`, 'y');
/** What may follow a core inside an address, and the character after it: `@` and a moment, `?lens=` and an id. */
const TAIL = 64;
const PATH_CHAR = /[0-9A-Za-z/-]/;
/** A moment's run after the core, read up to one digit past the 32-bit range's ten. */
const MOMENT_RUN = /@-?(\d{0,11})/y;

/** A moment whose digits run past ten is out of range: the SDK takes no moment, and the address ends at the core. */
function momentOutOfRange(text: string, at: number): boolean {
  if (text[at] !== '@') return false;
  MOMENT_RUN.lastIndex = at;
  const m = MOMENT_RUN.exec(text);
  return m !== null && m[1].length > 10;
}

/** The SDK's reading of the address that starts at `i`, or null. */
function readAt(text: string, i: number): { reading: OwAddressReading; end: number } | null {
  const core = text.startsWith(OW_TEXT_PREFIX, i) ? TEXT_CORE : text.startsWith(OW_SITE_PREFIX, i) ? SITE_CORE : null;
  if (!core) return null;
  core.lastIndex = i;
  const m = core.exec(text);
  if (!m) return null;
  const coreEnd = i + m[0].length;
  // A path character after the core (a letter, a digit, `-` or `/`) is no
  // moment and no lens: the reading ends at the core either way, and handing
  // the SDK a run of them costs it some forty failing longer readings.
  const stop = coreEnd < text.length && (PATH_CHAR.test(text[coreEnd]) || momentOutOfRange(text, coreEnd))
    ? coreEnd
    : Math.min(text.length, coreEnd + TAIL);
  const at = readOwLinkAt(i === 0 && stop === text.length ? text : text.slice(i, stop), 0);
  return at ? { reading: at.reading, end: i + at.end } : null;
}

/**
 * Each start of a prefix in a text, in order, found in one pass: each
 * prefix's next index is kept and searched again only once the walk has
 * passed it, so no stretch of the text is searched twice for one prefix.
 */
class PrefixWalk {
  private nextText: number;
  private nextSite: number;
  constructor(private readonly text: string) {
    this.nextText = text.indexOf(OW_TEXT_PREFIX);
    this.nextSite = text.indexOf(OW_SITE_PREFIX);
  }
  /** The first prefix at or after `from`, or -1. */
  next(from: number): number {
    if (this.nextText !== -1 && this.nextText < from) this.nextText = this.text.indexOf(OW_TEXT_PREFIX, from);
    if (this.nextSite !== -1 && this.nextSite < from) this.nextSite = this.text.indexOf(OW_SITE_PREFIX, from);
    if (this.nextText === -1) return this.nextSite;
    if (this.nextSite === -1) return this.nextText;
    return Math.min(this.nextText, this.nextSite);
  }
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
 * Every prefix is read where it stands, the SDK's way: an address may start
 * inside another one (an `ow://` glued after a site address's slug).
 */
export function findAddresses(text: string): OwAddressFound[] {
  const out: OwAddressFound[] = [];
  if (typeof text !== 'string') return out;
  const walk = new PrefixWalk(text);
  let i = walk.next(0);
  while (i !== -1) {
    const at = readAt(text, i);
    if (at) {
      const found = locate(text, i, at.end, at.reading);
      if (found) out.push(found);
    }
    i = walk.next(i + 1);
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
  const at = readAt(href, 0);
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

/** A run the share scrub reads loosely, with the id-forms in it (lowercase). */
export interface LooseAddressRun {
  start: number;
  end: number;
  ids: string[];
}

/**
 * The share scrub's wide pass: wider than the address rules on purpose,
 * because it guards what a public page discloses. Every `ow://` or
 * `(http(s)://)(www.)onlyworlds.com/w/` prefix in any case, with its run of
 * characters that are not a space or `)`, and every id-form in that run
 * (8-4-4-4-12 hex in either case, given lowercase). A link in capitals, an
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
    const ids = [...run.matchAll(idRe)].map(x => x[0].toLowerCase());
    out.push({ start: m.index, end: m.index + run.length, ids });
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
 */
export function pastedAddressIn(text: string): string | null {
  if (typeof text !== 'string') return null;
  const i = indexOfPrefixAnyCase(text);
  if (i === -1) return null;
  const at = readAt(text, i);
  if (at && text[at.end] !== '/') return text.slice(i, at.end);
  let runEnd = i;
  while (runEnd < text.length && !/\s/.test(text[runEnd])) runEnd++;
  const run = text.slice(i, runEnd);
  return run.slice(0, trimmedEnd(run, PASTE_CLOSERS));
}
