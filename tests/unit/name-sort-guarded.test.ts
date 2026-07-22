/**
 * Every sort on `.name` must guard against an absent name.
 *
 * WHY THIS IS A SOURCE SCAN AND NOT A BEHAVIOUR TEST (S308):
 *
 * `Element.name` is typed `string`, non-optional — which is exactly why this
 * bug shipped. A TypeScript type is a compile-time claim about data the
 * compiler controls, and element JSON is data it does not: the Folder Format
 * explicitly welcomes files written by other tools, and a file on disk with no
 * `name` key deserializes to `undefined` at runtime.
 *
 * `elements-sidebar.ts` sorted with a bare `a.name.localeCompare(b.name)` and
 * threw inside render, permanently breaking the element list until the offending
 * file was found and fixed by hand. Every SIBLING sort site already guarded
 * (writing-sidebar, worlds-sidebar, context-pane-lists) — it was the lone site
 * that did not, which is the shape of the whole defect class: a rule known and
 * applied everywhere but one place.
 *
 * A behaviour test would lock the one site. This locks the FAMILY, so the next
 * name sort someone writes cannot reintroduce it. Precedent for the shape:
 * `legacy-classes-banned.test.ts`.
 *
 * THE RULE IS ABSOLUTE ON PURPOSE. Its first run flagged two sorts in
 * `command-palette.ts` that were already safe — `PaletteResult.name` is built
 * as `el.name?.trim() || '(unnamed)'`, so it can never be undefined. Those were
 * guarded anyway rather than allowlisted: a text scan cannot tell an `Element`
 * from a `PaletteResult`, `?? ''` on an already-safe value is a runtime no-op,
 * and an invariant with exceptions is one the next reader has to re-derive
 * before they can trust it. Absolute and cheap beats precise and fragile.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC_DIR = resolve(process.cwd(), 'src');

/** Matches `<something>.name.localeCompare(` — the unguarded form. */
const UNGUARDED = /\.name\s*\.localeCompare\s*\(/;

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walkFiles(full);
    else if (s.isFile()) yield full;
  }
}

describe('name sorts tolerate an absent name', () => {
  it('no `.name.localeCompare(` in src — use `(a.name ?? \'\')`', () => {
    const offenders: { file: string; line: number; text: string }[] = [];
    for (const file of walkFiles(SRC_DIR)) {
      if (!/\.ts$/.test(file)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (UNGUARDED.test(line)) {
          offenders.push({ file: file.replace(/\\/g, '/'), line: i + 1, text: line.trim() });
        }
      });
    }
    if (offenders.length > 0) {
      const msg = offenders.map(o => `  ${o.file}:${o.line}\n    ${o.text}`).join('\n');
      throw new Error(
        `${offenders.length} unguarded name sort(s):\n${msg}\n\n` +
        'An element authored outside atlas may have no `name` key at all, and ' +
        '`undefined.localeCompare` throws inside render. Use `(a.name ?? \'\').localeCompare(b.name ?? \'\')`.',
      );
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The scan above is only as good as its pattern, so prove the pattern
   * actually rejects the shape it claims to. Without this, a typo in the regex
   * would leave the guard silently green forever — a vacuous invariant, which
   * is the failure mode this codebase has hit before.
   */
  it('the scan pattern really does match the unguarded form', () => {
    expect(UNGUARDED.test('.sort((a, b) => a.name.localeCompare(b.name));')).toBe(true);
    expect(UNGUARDED.test('.sort((a, b) => (a.name ?? \'\').localeCompare(b.name ?? \'\'));')).toBe(false);
  });
});
