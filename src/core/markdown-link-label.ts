/**
 * A markdown link's label, written and read escaped: one grammar for every
 * reader of `[label](target)` in a story, and the one escape for every writer
 * of a label (1.125.34).
 *
 * THE WRITE. A label Atlas writes escapes `\`, `[`, `]` and a `(` right after
 * a `]` (`escapeLinkLabel`), so a name such as "Kira [the elder]" or "Kira\" comes
 * back whole: before, the editor's chip escaped `]` alone, and "Kira [the
 * elder]" was read back as `[Kira ` and a chip "the elder]".
 *
 * THE READ (`markdownLinkSpans`). A link opens at a `[` that follows an even
 * run of backslashes (none counts as even). Its label is backslash escapes,
 * any other character but a blank line, and balanced `[...]` runs that are
 * not themselves a link: a link holds no link (as CommonMark says), so in
 * `[a [b](x) c](y)` the link is `[b](x)` and the outer brackets are prose.
 * Then `](` and a target up to its `)`: a destination (in angle brackets, or
 * a run with no white space and balanced parentheses) and a title in `"…"`,
 * `'…'` or `(…)` after white space. A reader that draws a link draws its
 * label through `unescapeLinkLabel` (`\[`, `\]`, `\(`, `\)` and `\\` read as the
 * character), as text.
 *
 * The walk is the bracket stack CommonMark describes, one pass over the text:
 * an opener is pushed, a `]` pops the nearest, and a pop followed by a target
 * is a link, which leaves every opener before it inactive (an inactive opener
 * still pairs with a `]`, and that pair is prose). A blank line clears the
 * stack. Code spans are not read here: a story's links are taken before its
 * code, as the readers always have.
 *
 * Reads no address: what a target names is `core/ow-links.ts`'s question.
 */

/** A markdown link as the grammar reads it; every offset is a UTF-16 index into the text it was read from. */
export interface MarkdownLink {
  /** The opening `[`. */
  start: number;
  /** Just past the closing `)`. */
  end: number;
  /** The label's first character (just past `[`). */
  labelStart: number;
  /** The `]` that closes the label. */
  labelEnd: number;
  /** The destination's first character (inside the angle brackets when it has them). */
  destStart: number;
  /** Just past the destination's last character. */
  destEnd: number;
}

/**
 * A label as a link writes it: `\`, `[` and `]` escaped with a backslash, and a `(` right after a `]`
 * (1.125.36): a label holding `[x](https://x.test)` escaped at its brackets alone was read by the editor as
 * a web link inside the chip. Every other parenthesis stays bare, so "John (the younger)" is written as it
 * always was, for every reader of a story.
 */
export function escapeLinkLabel(label: string): string {
  return label.replace(/[\\[\]]|(?<=\])\(/g, '\\$&');
}

/** A label as a reader draws it: `\[`, `\]`, `\(`, `\)` and `\\` read as the character; every other backslash stays. */
export function unescapeLinkLabel(label: string): string {
  return label.replace(/\\([\\[\]()])/g, '$1');
}

/**
 * A span of a story's own text, made into a label: what the span reads as
 * (`unescapeLinkLabel`), escaped again. A span that splits no escape (see
 * {@link splitsEscape}) keeps its escape pairs byte for byte; a bare `[`, `]`
 * or a lone backslash gains its escape, so the label reads as the prose did.
 */
export function labelFromSpan(span: string): string {
  return escapeLinkLabel(unescapeLinkLabel(span));
}

const isBackslash = (text: string, i: number): boolean => text.charCodeAt(i) === 0x5c;

/** Is the character at `i` escaped (after an odd run of backslashes)? */
function escapedAt(text: string, i: number): boolean {
  let n = 0;
  for (let k = i - 1; k >= 0 && isBackslash(text, k); k--) n++;
  return n % 2 === 1;
}

/**
 * Does the span `[from, to)` of a story split a backslash escape: does it
 * start on an escaped character, or end on a backslash that escapes the
 * character after it? Such a span is no text a link can carry (its label
 * would escape its own `]`, or leave a backslash escaping the link's `[`).
 */
export function splitsEscape(text: string, from: number, to: number): boolean {
  if (from > 0 && escapedAt(text, from)) return true;
  return to > from && isBackslash(text, to - 1) && !escapedAt(text, to - 1);
}

/** How deep a destination's parentheses may nest (CommonMark: at least 32). */
const MAX_PAREN_DEPTH = 32;

const isSpaceOrTab = (c: string): boolean => c === ' ' || c === '\t';

/** Is the line ending at `i` followed by a blank line (only spaces, tabs or a carriage return before the next line ending)? */
function blankLineAt(text: string, i: number): boolean {
  let j = i + 1;
  while (j < text.length && (isSpaceOrTab(text[j]) || text[j] === '\r')) j++;
  return text[j] === '\n';
}

/** Past white space with at most one line ending in it, from `i`. */
function skipSpace(text: string, i: number): number {
  let j = i;
  let lineEndings = 0;
  while (j < text.length) {
    const c = text[j];
    if (isSpaceOrTab(c) || c === '\r') { j++; continue; }
    if (c === '\n' && lineEndings === 0) { lineEndings++; j++; continue; }
    break;
  }
  return j;
}

/** A target read from just past `](`: its destination and its end (past the `)`), or null when none closes there. */
function readTarget(text: string, from: number): { destStart: number; destEnd: number; end: number } | null {
  const n = text.length;
  let j = skipSpace(text, from);
  let destStart: number;
  let destEnd: number;
  if (text[j] === '<') {
    j++;
    destStart = j;
    while (j < n) {
      const c = text[j];
      if (c === '\\' && j + 1 < n && text[j + 1] !== '\n') { j += 2; continue; }
      if (c === '\n' || c === '<') return null;
      if (c === '>') break;
      j++;
    }
    if (j >= n) return null;
    destEnd = j;
    j++;
  } else {
    destStart = j;
    let depth = 0;
    while (j < n) {
      const c = text[j];
      const code = text.charCodeAt(j);
      if (c === '\\' && j + 1 < n && text[j + 1] !== '\n') { j += 2; continue; }
      if (code <= 0x20 || code === 0x7f) break;
      if (c === '(') {
        // CommonMark's own bound, which also keeps a text of many `[a](` read in one pass.
        if (++depth > MAX_PAREN_DEPTH) return null;
      }
      else if (c === ')') {
        if (depth === 0) break;
        depth--;
      }
      j++;
    }
    if (depth !== 0) return null;
    destEnd = j;
  }
  let k = skipSpace(text, j);
  if (text[k] === ')') return { destStart, destEnd, end: k + 1 };
  const quote = text[k];
  if (k === j || (quote !== '"' && quote !== "'" && quote !== '(')) return null;
  const close = quote === '(' ? ')' : quote;
  k++;
  while (k < n) {
    const c = text[k];
    if (c === '\\' && k + 1 < n && text[k + 1] !== '\n') { k += 2; continue; }
    if (c === close) break;
    if (quote === '(' && c === '(') return null;
    if (c === '\n' && blankLineAt(text, k)) return null;
    k++;
  }
  if (k >= n) return null;
  k = skipSpace(text, k + 1);
  return text[k] === ')' ? { destStart, destEnd, end: k + 1 } : null;
}

interface Walk {
  links: MarkdownLink[];
  /** For each `]` that closed a label: its active opener, or -1 when the opener it paired with was inactive. */
  openers: Map<number, number>;
}

/** The one pass: every link, and the opener each `]` paired with. */
function walk(text: string): Walk {
  const links: MarkdownLink[] = [];
  const openers = new Map<number, number>();
  const stack: number[] = [];
  /** Every opener below this depth of the stack is inactive (a link closed after it). */
  let inactiveBelow = 0;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '\\') {
      i += i + 1 < n && text[i + 1] !== '\n' ? 2 : 1;
      continue;
    }
    if (c === '\n') {
      if (blankLineAt(text, i)) { stack.length = 0; inactiveBelow = 0; }
      i++;
      continue;
    }
    if (c === '[') { stack.push(i); i++; continue; }
    if (c !== ']' || stack.length === 0) { i++; continue; }
    const open = stack.pop()!;
    const active = stack.length >= inactiveBelow;
    if (!active) inactiveBelow = stack.length;
    openers.set(i, active ? open : -1);
    if (active && text[i + 1] === '(') {
      const target = readTarget(text, i + 2);
      if (target) {
        links.push({ start: open, end: target.end, labelStart: open + 1, labelEnd: i, destStart: target.destStart, destEnd: target.destEnd });
        inactiveBelow = stack.length;
        i = target.end;
        continue;
      }
    }
    i++;
  }
  return { links, openers };
}

/** Every link in a story by the grammar, in order, none overlapping. */
export function markdownLinkSpans(text: string): MarkdownLink[] {
  if (!text || text.indexOf('](') === -1) return [];
  return walk(text).links;
}

/**
 * A reader of the label openers, for a text that is read many times at many
 * `]`s (the share scrub): `openerOf(close)` is the `[` the grammar pairs with
 * the `]` at `close`, or -1 when it pairs with none or with an inactive one
 * (it is prose). The pairing does not ask whether a target follows, so a
 * label is found even before a target the grammar would not read whole.
 */
export function labelOpeners(text: string): (close: number) => number {
  let openers: Map<number, number> | null = null;
  return close => {
    if (openers === null) openers = walk(text).openers;
    return openers.get(close) ?? -1;
  };
}
