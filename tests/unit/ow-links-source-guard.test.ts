/**
 * The address ratchet: an element address in prose (`ow://<type>/<id>`) is
 * found, read, written and rewritten only in `src/core/ow-links.ts`, on the
 * SDK's reader (the address profile; DESIGN_LAWS conv. 189). Anywhere else in
 * `src/`, a line of code may not hold:
 *
 *   - `ow:` followed by two slashes in any spelling: `//`, `\/\/`, `\\/\\/`,
 *     `[/][/]`, `\/{2}`, `\x2f\x2f`, `[:]` for the colon, in a string, a
 *     regex or a `new RegExp('…')` (a writer asks `owLinkHref`);
 *   - a test of a link's tail, an id followed by `)`: `'/' + id + ')'`,
 *     `` `/${id})` ``, `id + ')'`, or `'/' + id` inside a string test. It
 *     misses an address with a moment, a lens or an id in capitals, and finds
 *     text that is no address.
 *
 * Comments are not code: a line that starts as one is skipped, and a leading
 * block comment is cut before the line is read. Counted exceptions: a file
 * that reads no address (it counts markdown links, say) keeps a count that
 * may never rise. The changelog's data is user copy, never code, and is not
 * read. Lower a count here in the change that removes a site.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// It reads the source tree: on a busy machine a scan has run past the default 15 s.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(process.cwd());
const SRC = join(ROOT, 'src');
const HOME = 'src/core/ow-links.ts';
/** User copy, never code: it may say "ow:// text" to a person. */
const COPY = new Set(['src/changelog/changelog.data.ts']);

/** Counted exceptions: files that match a rule but read no address. */
const ALLOWED: Record<string, number> = {
  // Counts the markdown links in a story (`](ow://`), the tree's chip count.
  'src/sidebar/writing-sidebar.ts': 1,
  // The same count for the tour's sample story.
  'src/tour/tour-view.ts': 1,
};

/** One line with every spelling of a slash and a colon folded to the plain one. */
function fold(line: string): string {
  return line
    .replace(/\\x2f|\\u002f|\\u\{2f\}/gi, '/')
    .replace(/\\x3a|\\u003a/gi, ':')
    .replace(/\\\\\//g, '/')
    .replace(/\\\//g, '/')
    .replace(/\[\/\]/g, '/')
    .replace(/\[:\]/g, ':')
    .replace(/\/\{2\}/g, '//');
}

const PREFIX = /ow:\/\//i;
const TAILS: RegExp[] = [
  /['"`]\/['"`]\s*\+[^;]*\+\s*['"`]\)['"`]/, // '/' + id + ')'
  /\/\$\{[^}]*(?:id|Id|ID)\}\)/, // `/${id})`
  /\b\w*(?:id|Id|ID)\s*\+\s*['"`]\)['"`]/, // id + ')'
  /\b(?:includes|indexOf|lastIndexOf|startsWith|endsWith|search|match|test)\(\s*['"`]\/['"`]\s*\+/, // includes('/' + id)
];

/** Lines of one source that read an address by a pattern or a substring of their own. */
export function countAddressReaders(source: string): number {
  let n = 0;
  for (const raw of source.split('\n')) {
    let line = raw.trim();
    if (line.startsWith('//') || line.startsWith('*')) continue;
    while (line.startsWith('/*')) {
      const close = line.indexOf('*/');
      if (close === -1) { line = ''; break; }
      line = line.slice(close + 2).trim();
    }
    if (!line) continue;
    if (PREFIX.test(fold(line)) || TAILS.some(r => r.test(line))) n++;
  }
  return n;
}

// The sixteen ways the first guard was walked around (the code gate's list), each one a line it must flag.
const BYPASSES: Record<string, string> = {
  regexLiteral: String.raw`const re = /ow:\/\/([a-z_]+)\/([\w-]+)/gi;`,
  stringConcat: `const href = "ow://" + type + "/" + id;`,
  startsWith: `if (href.startsWith('ow://')) {`,
  split: `const parts = md.split('ow://');`,
  indexOf: `let i = md.indexOf('ow://');`,
  newRegExpPlainSlashes: String.raw`const re = new RegExp('ow://([a-z]+)/(\\S+)');`,
  newRegExpSingleEsc: String.raw`const re = new RegExp('ow:\/\/' + t);`,
  regexBracketSlash: String.raw`const re = /ow:[/][/]([a-z]+)/;`,
  regexHexEscape: String.raw`const re = /ow:\x2f\x2f/;`,
  regexColonClass: String.raw`const re = /\]\(ow[:]\/\//;`,
  regexSlashQuant: String.raw`const re = /ow:\/{2}([a-z]+)/;`,
  tailTemplate: 'if (md.includes(`/${chip.id})`)) return;',
  tailIdParen: `if (md.includes(id + ')')) return;`,
  tailTwoParts: `md.includes('/' + chip.id)`,
  tailCall: `md.includes('/' + getId(chip) + ')')`,
  commentLead: String.raw`/* ok */ const re = /ow:\/\//;`,
};

describe('the address ratchet', () => {
  for (const [name, line] of Object.entries(BYPASSES)) {
    it(`flags ${name}`, () => {
      expect(countAddressReaders(line)).toBe(1);
    });
  }

  it('lets comments and the writer through', () => {
    expect(countAddressReaders('// the old /ow:\\/\\// pattern')).toBe(0);
    expect(countAddressReaders(' * an `ow://character/<id>` link')).toBe(0);
    expect(countAddressReaders('/* a note about ow://x */')).toBe(0);
    expect(countAddressReaders('out.push(`[${label}](${owLinkHref(type, id)})`);')).toBe(0);
    expect(countAddressReaders("const label = '(' + count + ')';")).toBe(0);
  });

  it('no file in src/ but ow-links.ts reads or writes an address its own way', () => {
    const found: Record<string, number> = {};
    for (const file of walk(SRC)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (rel === HOME || COPY.has(rel)) continue;
      const n = countAddressReaders(readFileSync(file, 'utf8'));
      if (n > 0) found[rel] = n;
    }
    const over = Object.entries(found).filter(([f, n]) => n > (ALLOWED[f] ?? 0));
    expect(over, 'read or write the address through core/ow-links.ts instead').toEqual([]);
    const stale = Object.entries(ALLOWED).filter(([f, n]) => (found[f] ?? 0) < n);
    expect(stale, 'a counted exception fell: lower it here').toEqual([]);
  });
});

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (s.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) yield full;
  }
}
