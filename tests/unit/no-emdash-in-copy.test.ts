/**
 * The voice law, as a guard: user-visible copy carries ZERO em-dashes.
 *
 * Titus reads the em-dash appositive as machine writing, so the rule is
 * absolute for anything a user can read (the voice
 * profile). It had drifted back into four places before,
 * including the `og:image:alt` on the social card, which is the very first
 * atlas text a stranger sees.
 *
 * Fixing four strings closes four instances; this closes the CLASS. Scoped
 * deliberately narrow so it stays true rather than becoming noise:
 *
 *   - COMMENTS ARE FINE. The em-dash is the house style for prose about the
 *     code, and this file, the design docs and every explanatory block above
 *     a rule use it freely. Only strings a user can read are covered.
 *   - console.* is developer-facing and exempt for the same reason.
 *   - The bare '—' EMPTY-VALUE GLYPH is exempt by allowlist: it is
 *     typography, not prose, and it is the app-wide placeholder for an unset
 *     field. Rewriting it would change the look of every element page.
 *
 * If a genuine new exemption appears, add it to ALLOWED with a reason. An
 * allowlist entry is cheap; a rule the next reader has to re-derive is not.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

// It reads the source tree: on a machine another suite holds, a scan has run past the default 15 s.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(process.cwd());
const SRC_DIR = join(ROOT, 'src');
const EM_DASH = '—';
const BACKSLASH = '\\';

/** Exempt strings, by exact content, with the reason they are exempt. */
const ALLOWED = new Set<string>([
  EM_DASH, // the empty-value placeholder glyph in element rows
]);

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walkFiles(full);
    else if (s.isFile()) yield full;
  }
}

/**
 * Every quoted/backticked run on one line that contains an em-dash.
 *
 * Deliberately a scanner and not a parser: it walks the line tracking the
 * open quote character, so it sees single, double and template strings and
 * stops at a line comment. It cannot see a template literal that spans lines,
 * which is why the e2e copy specs remain the wider net.
 */
function offendingStrings(line: string): string[] {
  const found: string[] = [];
  let quote: string | null = null;
  let buf = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === null) {
      if (c === '"' || c === "'" || c === '`') {
        quote = c;
        buf = '';
      } else if (c === '/' && line[i + 1] === '/') {
        break; // line comment: developer prose, exempt
      }
    } else if (c === quote && line[i - 1] !== BACKSLASH) {
      if (buf.includes(EM_DASH)) found.push(buf);
      quote = null;
    } else {
      buf += c;
    }
  }
  return found;
}

describe('user-visible copy carries no em-dashes', () => {
  it('no em-dash in any string literal under src/', () => {
    const offenders: string[] = [];
    for (const file of walkFiles(SRC_DIR)) {
      if (!file.endsWith('.ts')) continue;
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
        if (line.includes('console.')) return;
        for (const s of offendingStrings(line)) {
          if (ALLOWED.has(s.trim())) continue;
          offenders.push(`${relative(ROOT, file)}:${idx + 1}  ${s.trim().slice(0, 120)}`);
        }
      });
    }
    expect(offenders, `em-dash in user-visible copy:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no em-dash in the index.html meta copy a stranger reads first', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    // Only attribute VALUES — the file's HTML comments are developer prose.
    const values = [...html.matchAll(/content="([^"]*)"/g)].map(m => m[1]);
    const offenders = values.filter(v => v.includes(EM_DASH));
    expect(offenders, `em-dash in meta content:\n${offenders.join('\n')}`).toEqual([]);
  });
});
