/**
 * The address ratchet: an element address in prose (`ow://<type>/<id>`, or
 * the site's `onlyworlds.com/w/` form) is found, read, written and rewritten
 * only in `src/core/ow-links.ts`, on the SDK's reader (the address profile;
 * DESIGN_LAWS conv. 189). Anywhere else in `src/`, a line of code may not hold:
 *
 *   - `ow:` followed by two slashes in any spelling: `//`, `\/\/`, `\\/\\/`,
 *     `[/][/]`, `\/{2}`, `(?:\/){2}`, `\/+`, `\x2f\x2f`, `\:` or `[:]` for the
 *     colon, string pieces joined by `+` (`'ow:' + '//'`), in a string, a
 *     regex or a `new RegExp('…')` (a writer asks `owLinkHref`);
 *   - `onlyworlds.com/w/` in the same spellings (the site's form);
 *   - a test of a link's tail, an id followed by `)`: `'/' + id + ')'`,
 *     `` `/${…})` ``, ``includes(`/${…}`)`` and its kin, `'/' + id` inside a
 *     string test, `id + ')'`, or `<name> + ')'` on a line that also joins a
 *     slash. It misses an address with a moment, a lens or an id in capitals,
 *     and finds text that is no address.
 *
 * The guard is against accidents, not adversaries: a prefix spelled by escape
 * tricks (`'\x6fw://'`, `'\u006fw://'`, `'o' + 'w://'`,
 * `String.fromCharCode`) is not caught, and need not be.
 *
 * Comments are not code: a `//` line, and what is inside a block comment
 * (tracked across lines, so a code line that starts with `*` is still read).
 * Counted exceptions: a file that reads no address (it counts markdown links,
 * say) keeps a count that may never rise. The changelog's data is user copy,
 * never code, and is not read. Lower a count here in the change that removes
 * a site.
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

/** One line with every spelling of a slash, a colon and a dot folded to the plain one, and string pieces joined. */
function fold(line: string): string {
  return line
    .replace(/['"`]\s*\+\s*['"`]/g, '')
    .replace(/\\x2f|\\u002f|\\u\{2f\}/gi, '/')
    .replace(/\\x3a|\\u003a/gi, ':')
    .replace(/\\\\\//g, '/')
    .replace(/\\\//g, '/')
    .replace(/\\:/g, ':')
    .replace(/\\\\\./g, '.')
    .replace(/\\\./g, '.')
    .replace(/\[\/\]/g, '/')
    .replace(/\[:\]/g, ':')
    .replace(/\(\?:\/\)\{2\}/g, '//')
    .replace(/\/\{2\}/g, '//')
    .replace(/\/\+/g, '//');
}

const PREFIXES: RegExp[] = [/ow:\/\//i, /onlyworlds\.com\/w\//i];
const SLASH_JOIN = /['"`]\/|\/['"`]/;
const TAILS: Array<(line: string) => boolean> = [
  l => /['"`]\/['"`]\s*\+[^;]*\+\s*['"`]\)['"`]/.test(l), // '/' + id + ')'
  l => /\/\$\{[^}]*\}\)/.test(l), // `/${…})`
  l => /\b(?:includes|indexOf|lastIndexOf|startsWith|endsWith|search|match|test)\(\s*`\/\$\{/.test(l), // includes(`/${…}`)
  l => /\b(?:includes|indexOf|lastIndexOf|startsWith|endsWith|search|match|test)\(\s*['"`]\/['"`]\s*\+/.test(l), // includes('/' + id)
  l => /\b\w*(?:id|Id|ID)\s*\+\s*['"`]\)['"`]/.test(l), // id + ')'
  l => /[\w)\]]\s*\+\s*['"`]\)['"`]/.test(l) && SLASH_JOIN.test(l), // name + ')' with a slash joined
];

/** The code of one source, line by line, comments out (block comments tracked across lines). */
/** Where a block comment opens on a line, skipping a `/*` inside a quoted string ('image/*' opens nothing), or -1. */
export function blockOpenOutsideString(line: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
    if (c === '/' && line[i + 1] === '/') return -1;
    if (c === '/' && line[i + 1] === '*') return i;
  }
  return -1;
}

function codeLines(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = raw;
    let code = '';
    for (;;) {
      if (inBlock) {
        const close = line.indexOf('*/');
        if (close === -1) { line = ''; break; }
        line = line.slice(close + 2);
        inBlock = false;
      }
      const open = blockOpenOutsideString(line);
      if (open === -1) { code += line; break; }
      code += line.slice(0, open);
      line = line.slice(open + 2);
      inBlock = true;
    }
    const t = code.trim();
    if (t && !t.startsWith('//')) out.push(t);
  }
  return out;
}

/** Lines of one source that read an address by a pattern or a substring of their own. */
export function countAddressReaders(source: string): number {
  let n = 0;
  for (const line of codeLines(source)) {
    const folded = fold(line);
    if (PREFIXES.some(r => r.test(folded)) || TAILS.some(t => t(line))) n++;
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

// The second gate's list: more spellings, the site's form and more tail tests.
const BYPASSES_2: Record<string, string> = {
  splitConcat: `const p = 'ow:' + '//';`,
  splitConcat2: `const p = 'ow:/' + '/';`,
  regexEscapedColon: String.raw`const re = /ow\:\/\//;`,
  regexGroupSlash: String.raw`const re = /ow:(?:\/){2}/;`,
  regexSlashPlus: String.raw`const re = /ow:\/+/;`,
  regexClassBoth: String.raw`const re = /ow:[\/][\/]/;`,
  siteHost: `const re = /onlyworlds\\.com\\/w\\/([^/]+)\\/(\\w+)\\/([\\w-]+)/;`,
  siteString: `const base = 'https://www.onlyworlds.com/w/' + world;`,
  tailTemplateLower: 'if (md.includes(`/${id.toLowerCase()})`)) return;',
  tailTemplateUuid: 'if (md.includes(`/${chip.uuid})`)) return;',
  tailTemplateKey: 'if (md.includes(`/${key})`)) return;',
  tailTemplateNoParen: 'if (md.includes(`/${chip.id}`)) return;',
  tailEndsWith: 'href.endsWith(`/${id}`)',
  tailStringId: `if (md.includes('/' + String(id) + ')')) return;`,
  tailNameParenSlash: `const tail = '/' + key; if (md.includes(tail + ')')) return;`,
  tailDouble: `md.includes("/" + chip.id)`,
  starLine: `const n = 1\n  * 2 + md.indexOf('ow://');`,
  blockCommentMid: String.raw`const a = 1; /* x */ const re = /ow:\/\//;`,
};

describe('the address ratchet', () => {
  for (const [name, line] of Object.entries(BYPASSES)) {
    it(`flags ${name}`, () => {
      expect(countAddressReaders(line)).toBe(1);
    });
  }
  for (const [name, line] of Object.entries(BYPASSES_2)) {
    it(`flags ${name}`, () => {
      expect(countAddressReaders(line)).toBeGreaterThanOrEqual(1);
    });
  }

  it('lets comments and the writer through', () => {
    expect(countAddressReaders('// the old /ow:\\/\\// pattern')).toBe(0);
    expect(countAddressReaders('/**\n * an `ow://character/<id>` link\n */')).toBe(0);
    expect(countAddressReaders('/* a note about ow://x */')).toBe(0);
    expect(countAddressReaders('out.push(`[${label}](${owLinkHref(type, id)})`);')).toBe(0);
    expect(countAddressReaders("const label = '(' + count + ')';")).toBe(0);
  });

  it('a /* inside a string opens no comment, so the lines after it are still read', () => {
    // element-detail-map-image.ts holds 'image/*' with no later */: the guard read the rest of that file as a comment.
    expect(countAddressReaders("input.accept = 'image/*';\nlet i = md.indexOf('ow://');")).toBe(1);
    expect(countAddressReaders('const a = "a/*";\nconst b = `x/*`;\nlet i = md.indexOf(\'ow://\');')).toBe(1);
    expect(countAddressReaders("const s = 'it\\'s /*';\nlet i = md.indexOf('ow://');")).toBe(1);
    // control: a real block comment still hides what it holds
    expect(countAddressReaders("x(); /* md.indexOf('ow://') */ y();")).toBe(0);
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
