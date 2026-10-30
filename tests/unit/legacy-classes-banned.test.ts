/**
 * Banned legacy classes — `ow-input` and `ow-btn` must NOT appear in src/.
 *
 * Atlas standardized on `atlas-input`, `atlas-btn-primary`, `atlas-btn-ghost`
 * during a modal audit. The legacy `ow-*` classes are stubs from
 * the OnlyWorlds shared library that produced visually inconsistent styling
 * when mixed with atlas-* (Titus caught this in smoke).
 *
 * Reintroducing them is a regression risk — this test catches it at the
 * vitest-run boundary. If a real `ow-*` styling utility appears in the future
 * and we want to use it intentionally, update the allowlist below.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// It reads the source tree: on a machine another suite holds, a scan has run past the default 15 s.
vi.setConfig({ testTimeout: 60_000 });

// Resolve src/ from the project root via process.cwd(). vitest runs from
// tools/atlas, so this points at tools/atlas/src.
const SRC_DIR = resolve(process.cwd(), 'src');

const BANNED_CLASSES = ['ow-input', 'ow-btn', 'ow-btn-primary', 'ow-btn-secondary', 'ow-btn-ghost'];

/** Files allowed to contain legacy class names (e.g. migration code). Empty for now. */
const ALLOWLIST_PATHS: string[] = [];

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walkFiles(full);
    } else if (s.isFile()) {
      yield full;
    }
  }
}

describe('banned legacy classes', () => {
  for (const banned of BANNED_CLASSES) {
    it(`no occurrence of "${banned}" in src/**/*.{ts,css,html}`, () => {
      const offenders: { file: string; line: number; text: string }[] = [];
      for (const file of walkFiles(SRC_DIR)) {
        if (!/\.(ts|tsx|css|html)$/.test(file)) continue;
        if (ALLOWLIST_PATHS.some(p => file.replace(/\\/g, '/').endsWith(p))) continue;
        const content = readFileSync(file, 'utf8');
        if (!content.includes(banned)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (line.includes(banned)) {
            offenders.push({ file, line: i + 1, text: line.trim() });
          }
        });
      }
      if (offenders.length > 0) {
        const msg = offenders
          .map(o => `  ${o.file}:${o.line}\n    ${o.text}`)
          .join('\n');
        throw new Error(`found ${offenders.length} occurrence(s) of "${banned}":\n${msg}\n\nUse atlas-* equivalents (atlas-input, atlas-btn-primary, atlas-btn-ghost).`);
      }
      expect(offenders).toEqual([]);
    });
  }
});
