/**
 * The one place Atlas finds a type's printed name (the names profile,
 * schema-dist dist.48 `profiles/names.md`, OW Council #567; contract
 * Forge/Notes/2026-10-22-s455-names-profile-atlas-contract.md).
 *
 * A world may carry `x_names` in its world.json: its own words for the types
 * ("Employee" for character in a work world). The SDK's `typeWord` reads the
 * map by the profile's four steps; null means the standard's name, which
 * keeps Atlas's casing (lower case mid-sentence, capitalised where `start`
 * asks). A world's word is printed as written, never re-cased (Skeld h58
 * #10789 (1)).
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

function capitalise(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}
