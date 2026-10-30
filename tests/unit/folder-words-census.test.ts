/**
 * The folder-words census (1.17, contract §8, §9 invariant 3; lens C R3):
 * since a world can live in this browser, every user-visible line that says
 * folder, drive, disk, OneDrive or Dropbox is a claim that may be false for
 * the world on screen. This is a TRIPWIRE, not a proof: it counts those words
 * inside string literals, per file, and fails on any change from the baseline,
 * so a new one is a decision (is it true for a browser world? is it behind a
 * `filesWhereOf` or `hasFolderMode` branch?) and the baseline is updated on
 * purpose: `UPDATE_FOLDER_WORDS_BASELINE=1 npx vitest run tests/unit/folder-words-census.test.ts`.
 * Named limits: a word built from pieces, and strings in comments that look
 * like code, are not seen; identifiers (`folder_name`) never count.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// It reads the source tree: on a machine another suite holds, a scan has run past the default 15 s.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
const BASELINE = join(__dirname, 'folder-words-baseline.json');
// Release history: past entries describe what was true then, and each release's own lines are read at release.
const SKIP = new Set(['src/changelog/changelog.data.ts']);
const WORD = /\b(folders?|drive|disk|OneDrive|Dropbox)\b/gi;
// Single-line string literals: '...', "...", `...` (a template's ${} pieces included).
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.ts$/.test(name) && !/\.d\.ts$/.test(name) ? [p] : [];
  });
}

/** Comment text is not copy: drop block comments and line comments first. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function census(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of walk(SRC)) {
    if (SKIP.has(relative(ROOT, file).split(sep).join('/'))) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    let n = 0;
    for (const lit of code.match(LITERAL) ?? []) {
      // Import paths and identifier-like strings are not copy.
      if (/^['"`][\w./@-]*['"`]$/.test(lit) && !/\s/.test(lit)) continue;
      n += (lit.match(WORD) ?? []).length;
    }
    if (n > 0) out[relative(ROOT, file).split(sep).join('/')] = n;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

describe('folder words in user copy', () => {
  it('every folder, drive or disk word is a counted decision', () => {
    const now = census();
    if (process.env.UPDATE_FOLDER_WORDS_BASELINE === '1') {
      writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
      return;
    }
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>;
    const changed = [...new Set([...Object.keys(now), ...Object.keys(base)])]
      .filter(f => (now[f] ?? 0) !== (base[f] ?? 0))
      .map(f => `${f}: ${base[f] ?? 0} -> ${now[f] ?? 0}`);
    expect(changed, 'Folder words changed. Check each new line is true for a world kept in this browser, then update the baseline (see the file header).').toEqual([]);
  });

  it('the instrument sees a known positive and ignores identifiers and comments', () => {
    const sample = stripComments("// the folder\nconst a = 'Saved to folder'; const b = w.folder_name; /* disk */ const c = `on your drive`;");
    const hits = (sample.match(LITERAL) ?? []).flatMap(l => l.match(WORD) ?? []);
    expect(hits).toEqual(['folder', 'drive']);
  });
});
