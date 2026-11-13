/**
 * The address ratchet: an element address in prose (`ow://<type>/<id>`) is
 * found, read and rewritten only in `src/core/ow-links.ts`, on the SDK's
 * reader (the address profile). Anywhere else in `src/`:
 *
 *   - no regular expression for `ow://` (a literal `ow:\/\/`, or the same
 *     escaped inside a string handed to `new RegExp`);
 *   - no substring test for a link's tail (`'/' + id + ')'`): it misses an
 *     address with a moment, a lens or an id in capitals, and finds text
 *     that is no address.
 *
 * A file may keep a counted exception only when it reads no address (it
 * counts markdown links, say): its count may never rise, and a new file may
 * not appear. Lower a count here in the change that removes a site.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// It reads the source tree: on a busy machine a scan has run past the default 15 s.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(process.cwd());
const SRC = join(ROOT, 'src');
const HOME = 'src/core/ow-links.ts';

/** Counted exceptions: files that match a rule but read no address. */
const ALLOWED: Record<string, number> = {
  // Counts the markdown links in a story (`](ow://`), the tree's chip count.
  'src/sidebar/writing-sidebar.ts': 1,
  // The same count for the tour's sample story.
  'src/tour/tour-view.ts': 1,
};

const RULES: RegExp[] = [
  /ow:\\\/\\\//, // ow:\/\/ in a regex literal
  /ow:\\\\\/\\\\\//, // ow:\\/\\/ in a string for new RegExp
  /['"`]\/['"`]\s*\+\s*[\w.?]+\s*\+\s*['"`]\)['"`]/, // '/' + id + ')'
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (s.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) yield full;
  }
}

/** Lines of one source that read an address by a pattern or a substring of their own. */
export function countAddressReaders(source: string): number {
  let n = 0;
  for (const line of source.split('\n')) {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    if (RULES.some(r => r.test(line))) n++;
  }
  return n;
}

describe('the address ratchet', () => {
  it('the rules catch the shapes they name', () => {
    expect(countAddressReaders(String.raw`const re = /ow:\/\/([a-z_]+)\/([\w-]+)/gi;`)).toBe(1);
    expect(countAddressReaders(String.raw`new RegExp('ow:\\/\\/' + t)`)).toBe(1);
    expect(countAddressReaders(`if (md.includes('/' + chip.id + ')')) return;`)).toBe(1);
    expect(countAddressReaders(`out.push(\`[\${label}](ow://\${type}/\${id})\`);`)).toBe(0);
    expect(countAddressReaders('// the old /ow:\\/\\// pattern')).toBe(0);
  });

  it('no file in src/ but ow-links.ts reads an address its own way', () => {
    const found: Record<string, number> = {};
    for (const file of walk(SRC)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (rel === HOME) continue;
      const n = countAddressReaders(readFileSync(file, 'utf8'));
      if (n > 0) found[rel] = n;
    }
    const over = Object.entries(found).filter(([f, n]) => n > (ALLOWED[f] ?? 0));
    expect(over, 'read the address through core/ow-links.ts instead').toEqual([]);
    const stale = Object.entries(ALLOWED).filter(([f, n]) => (found[f] ?? 0) < n);
    expect(stale, 'a counted exception fell: lower it here').toEqual([]);
  });
});
