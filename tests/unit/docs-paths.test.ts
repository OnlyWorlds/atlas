/**
 * The docs name real files (S366 docs split).
 *
 * The pre-split DESIGN.md carried paths to modules that had been renamed or
 * deleted (`ow-client-adapter`, `settings-account` as a leftover, a smoke log
 * that never existed), and every orient session read them as truth. This guard
 * reads every live `*.md` at the tool root (never `docs-archive/`, which is
 * history on purpose), collects each backticked path that starts with `src/` or
 * `tests/`, and fails naming every one that is not on disk.
 *
 * Rules: fenced code blocks are skipped (trees and snippets are drawings, not
 * citations); a trailing `:line`, `:line-line` or `:a,b` and any `#anchor` are
 * stripped; a path containing `*`, `{`, `<` or an ellipsis is a pattern, not a
 * citation, and is skipped. A path meant as an example belongs in prose, not
 * in backticks.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

function liveDocs(): string[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.md'))
    .map((d) => d.name)
    .sort();
}

function citedPaths(markdown: string): string[] {
  const withoutFences = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
  const out: string[] = [];
  for (const m of withoutFences.matchAll(/`([^`\n]+)`/g)) {
    const span = m[1].trim();
    if (!/^(src|tests)\//.test(span)) continue;
    let path = span.split(/\s/)[0];
    if (/[*{<]/.test(path) || path.includes('...') || path.includes('…')) continue;
    path = path.replace(/#.*$/, '').replace(/:\d+(?:[-,]\d+)*$/, '');
    out.push(path);
  }
  return out;
}

describe('live docs cite paths that exist', () => {
  it('finds the live docs', () => {
    expect(liveDocs()).toContain('DESIGN.md');
  });

  it('every backticked src/ or tests/ path in a live doc is on disk', () => {
    const missing: string[] = [];
    for (const doc of liveDocs()) {
      const text = readFileSync(resolve(ROOT, doc), 'utf8');
      for (const p of new Set(citedPaths(text))) {
        if (!existsSync(resolve(ROOT, p))) missing.push(`${doc}: ${p}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
