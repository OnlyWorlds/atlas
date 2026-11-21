/**
 * The one place Atlas finds a type's printed name (the names profile,
 * schema-dist dist.48 `profiles/names.md`; its Atlas contract is a
 * design note).
 *
 * A world may carry `x_names` in its world.json: its own words for the types
 * ("Employee" for character in a work world). The SDK's `typeWord` reads the
 * map by the profile's four steps; null means the standard's name, which
 * keeps Atlas's casing (lower case mid-sentence, capitalised where `start`
 * asks). A world's word is printed as written, never re-cased (Skeld,
 * 2026-10-22).
 *
 * Only words: folders, ids, routes and the wire keep the slug.
 */
import { typeWord } from '@onlyworlds/sdk';
import { ELEMENT_LABELS } from './constants';
import { getState } from './state';

export interface TypeNameOptions {
  /** A plural: a list's heading, a count, "Show … in the sidebar". */
  many?: boolean;
  /** The element's supertype, for a finer word inside one type (anything but a string is none). */
  supertype?: unknown;
  /** The standard's word capitalised, for the start of a line or a heading. A world's word is never re-cased. */
  start?: boolean;
  /** The world whose words to use (a world.json); the open world's when absent. */
  world?: object | null;
}

/** The open world's meta, where its `x_names` lives. */
function openWorld(): object | null {
  return getState().active?.meta ?? null;
}

/**
 * The open world's word for a type, or the standard's name. An unknown type
 * prints its slug, as every site did before.
 */
export function typeName(type: string, opts: TypeNameOptions = {}): string {
  const many = opts.many === true;
  const world = opts.world === undefined ? openWorld() : opts.world;
  const own = typeWord(world, type, { supertype: supertypeOf(opts.supertype), many });
  if (own !== null) return own;
  const labels = ELEMENT_LABELS[type as keyof typeof ELEMENT_LABELS];
  const standard = labels ? (many ? labels.plural : labels.singular) : type;
  return opts.start ? capitalise(standard) : standard;
}

/**
 * The open world's own word for a supertype of a type ("AI agent" for a
 * Character's Agent), or null when the world names only the type, or nothing.
 * A line that prints it has said the supertype, so the data's value is not
 * printed beside it (Seethe 2026-10-23); a filter keeps the value as its key.
 */
export function supertypeWord(type: string, supertype: unknown, opts: Pick<TypeNameOptions, 'many' | 'world'> = {}): string | null {
  const sup = supertypeOf(supertype);
  if (!sup) return null;
  const world = opts.world === undefined ? openWorld() : opts.world;
  const many = opts.many === true;
  const own = typeWord(world, type, { supertype: sup, many });
  return own !== null && own !== typeWord(world, type, { many }) ? own : null;
}

/** `typeName` at the start of a line or as a heading. */
export function typeNameStart(type: string, opts: Omit<TypeNameOptions, 'start'> = {}): string {
  return typeName(type, { ...opts, start: true });
}

/**
 * The singular with its article, for "Pick a location" or "Create an employee":
 * "an" before a vowel letter, the rule Atlas's standard words follow (a
 * world's word that sounds otherwise, "an hour", is rare enough to accept).
 * `start` capitalises the article only.
 */
export function aTypeName(type: string, opts: Omit<TypeNameOptions, 'many'> = {}): string {
  const word = typeName(type, { ...opts, start: false });
  const article = /^[aeiou]/i.test(word) ? 'an' : 'a';
  return `${opts.start ? capitalise(article) : article} ${word}`;
}

/**
 * A name for an element that has none, the one form every control says it
 * in: "the unnamed map", "the unnamed event", in the world's own word for the
 * type. Mid-sentence, so never capitalised: "Delete the unnamed zone",
 * "Show the 3 maps under the unnamed map". Where it starts a name or a line,
 * `capitalise` it (or `nameOrUnnamed(el, { start: true })`): only "the" takes
 * the capital, so a world's own word stays as the world wrote it.
 *
 * `word`: a room that names the type with its own word passes it, and the
 * unnamed form keeps it as given: the writing tree's tier ("the unnamed
 * chapter"), the calendar lens ("the unnamed calendar").
 */
export function theUnnamed(type: string, opts: Omit<TypeNameOptions, 'many' | 'start'> & { word?: string } = {}): string {
  const word = opts.word?.trim();
  return `the unnamed ${word || typeName(type, opts)}`;
}

/** Anything that carries an element's name and type: an element, or a row built from one. */
export interface Nameable {
  name?: unknown;
  type: string;
  supertype?: unknown;
  /** Set on a row whose `name` already holds the unnamed form, so a reader mid-sentence can say it in lower case. */
  unnamed?: boolean;
}

/**
 * The one test for a usable name: an element's own name, trimmed, or '' when
 * it has none (missing, not a string, only spaces, or a row flagged unnamed).
 * The `unnamed` flags and the sort keys read it, so a row is unnamed exactly
 * when `nameOrUnnamed` says the unnamed form.
 */
export function ownName(el: Pick<Nameable, 'name' | 'unnamed'>): string {
  return el.unnamed === true || typeof el.name !== 'string' ? '' : el.name.trim();
}

/**
 * An element's own name, trimmed, or the unnamed form when it has none (a
 * missing name or one of spaces). `start` is for a name that stands alone or
 * starts a line (a heading, a row, a chip, a button's whole name, a tab, a menu
 * item): "The unnamed event". Without it the form is lower case, for a name
 * inside a longer line: "Open the unnamed event", "Held by the unnamed character".
 * An element's own name is never re-cased. `word` is the room's own word for
 * the type, as `theUnnamed` takes it.
 */
export function nameOrUnnamed(el: Nameable, opts: { start?: boolean; word?: string } = {}): string {
  const own = ownName(el);
  if (own) return own;
  const words = theUnnamed(el.type, { supertype: el.supertype, word: opts.word });
  return opts.start ? capitalise(words) : words;
}

/**
 * An element as a question before a delete names it: its own name, trimmed,
 * in quotes (`Delete "Harbour"?`), after the type's word when `typed` asks
 * (`Delete map "Harbour"?`); a missing name is the unnamed form, never quoted
 * and never empty quotes (`Delete the unnamed map?`). The note after the act
 * says the name plainly through `nameOrUnnamed` ("Deleted Harbour").
 */
export function quotedName(el: Nameable, opts: { word?: string; typed?: boolean } = {}): string {
  const own = ownName(el);
  if (!own) return nameOrUnnamed(el, { word: opts.word });
  if (!opts.typed) return `"${own}"`;
  return `${opts.word?.trim() || typeName(el.type, { supertype: el.supertype })} "${own}"`;
}

/**
 * Words for an element that is not in the world at all (an id that names
 * nothing): they say it is missing, never the unnamed form, which would claim
 * an element that is there. "a missing location"; `start` for a line's start.
 */
export function missingWords(type: string, opts: { start?: boolean; word?: string } = {}): string {
  const words = `a missing ${opts.word?.trim() || typeName(type)}`;
  return opts.start ? capitalise(words) : words;
}

/**
 * The same missing element as a chip, a list row or a label says it, where no
 * sentence holds it: "(missing location)". One form beside `missingWords`;
 * where nothing names the type, the type is `element`: "(missing element)".
 */
export function missingLabel(type: string, opts: { word?: string } = {}): string {
  return `(missing ${opts.word?.trim() || typeName(type)})`;
}

/**
 * A world as its delete question names it: the word and its own name in
 * quotes (`Delete world "Harbour"?`); a world with no name, or one of spaces,
 * is "this world", the one asked about on screen. A world is not an element,
 * so it has no unnamed form.
 */
export function quotedWorld(name: unknown): string {
  const own = typeof name === 'string' ? name.trim() : '';
  return own ? `world "${own}"` : 'this world';
}

/**
 * What a press on a control that opens an element does, said one way: "Open
 * Ada", "Open the unnamed entry". The one builder for such a control's
 * tooltip, and for its name where the two are one string.
 */
export function openWords(el: Nameable, opts: { word?: string } = {}): string {
  return `Open ${nameOrUnnamed(el, { word: opts.word })}`;
}

/**
 * The open world's words as one stable string, for a surface that redraws
 * only when its inputs move: a surface that prints a type joins this to its
 * key, or a world whose words change keeps the old ones on screen.
 */
export function typeWordsKey(): string {
  const map = (openWorld() as { x_names?: unknown } | null)?.x_names;
  return map === undefined ? '' : JSON.stringify(map);
}

/** True when the open world (or the one given) has its own word for this type. */
export function hasOwnWord(type: string, opts: Pick<TypeNameOptions, 'supertype' | 'world'> = {}): boolean {
  const world = opts.world === undefined ? openWorld() : opts.world;
  return typeWord(world, type, { supertype: supertypeOf(opts.supertype) }) !== null;
}

function supertypeOf(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** The first letter in capitals, the rest as written: a phrase at the start of a name or line. */
export function capitalise(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}
