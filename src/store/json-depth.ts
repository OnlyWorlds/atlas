/**
 * How deep a world's JSON file may nest (the folder format, serial 148): an
 * object or array opened past level 200 makes the file one a reader does not
 * read, by the reason `too_deep`. Objects and arrays both count and the file's
 * top value is level 1, so a plain value inside level 200 is read.
 *
 * The count is made in the text as each object or array opens, before any
 * parse: a parser that must finish to count has already spent what the bound
 * protects (a file 100,000 deep parses in a browser, then overflows the stack
 * of the first thing that walks it). So a file that is deep and also not JSON
 * is too deep, and a key written twice counts its deeper value.
 */
export const FILE_MAX_DEPTH = 200;

/** True when the text opens an object or array deeper than `max`; brackets inside a string do not count. Linear, no recursion. */
export function tooDeep(text: string, max: number = FILE_MAX_DEPTH): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i++; // a backslash: the next unit is escaped, whatever it is
      else if (c === 0x22) inString = false;
      continue;
    }
    if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) {
      if (++depth > max) return true;
    } else if ((c === 0x7d || c === 0x5d) && depth > 0) depth--;
  }
  return false;
}

/** The cause a too-deep file is refused with, so a caller can say it for what it is. */
export class TooDeepError extends Error {
  constructor() {
    super(`nested more than ${FILE_MAX_DEPTH} levels deep`);
    this.name = 'TooDeepError';
  }
}

/** `JSON.parse` that refuses a too-deep text first, with a `TooDeepError`. */
export function parseBounded<T>(text: string): T {
  if (tooDeep(text)) throw new TooDeepError();
  return JSON.parse(text) as T;
}
