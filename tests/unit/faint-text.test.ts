/**
 * The faint-text floor (F-39, Seethe h63 #8696, #8748, #8760): every text a
 * person reads, and every control drawn only as an icon, sits at
 * `--atlas-text-muted` or brighter, which clears AA on Atlas's grounds.
 *
 *   - The old dim text tier (`--atlas-text-dim`) is gone; nothing may bring it back.
 *   - A `color:` of white or ink below 0.48 alpha belongs to a disabled state
 *     only (WCAG exempts it), and says so in its selector.
 *   - `--atlas-ornament` (0.28) is for what is neither read nor clicked. Its
 *     uses are listed here, so a new one is a choice someone wrote down.
 *   - A toggle whose off state is now one step below its on state says which
 *     it is to assistive tech too (`aria-pressed`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const CSS = readFileSync(join(ROOT, 'src', 'styles', 'atlas.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule { selector: string; body: string }
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  }
  return out;
}
const RULES = rules(CSS);

const ORNAMENTS = new Set([
  '.atlas-tangle-vs', // "vs" between two sides
  '.atlas-cmdk-icon', // a row's glyph beside its words
  '.atlas-welcome .material-symbols-outlined', // the large welcome icon
  '.atlas-import-example-sep', // a "·"
  '.atlas-context-graph-trail-sep', // a breadcrumb separator
  '.atlas-ow-waypoint-glyph', // the icon beside a waypoint's words
  '.atlas-worldclock-range-inputs span', // the "–" between From and To
]);

const FAINT = /(?:^|[;\s])color:\s*rgba\((?:var\(--atlas-ink-rgb\)|255,\s*255,\s*255|28,\s*27,\s*24),\s*(0?\.\d+)\)/g;

describe('the faint-text floor (F-39)', () => {
  it('the dim text tier is gone', () => {
    expect(CSS.includes('--atlas-text-dim')).toBe(false);
  });

  it('a faint colour is a disabled state, never text or a control', () => {
    const offenders: string[] = [];
    for (const r of RULES) {
      for (const m of r.body.matchAll(FAINT)) {
        if (Number(m[1]) < 0.48 && !/disabled/.test(r.selector)) offenders.push(`${r.selector} (${m[1]})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the ornament tone is used only where the list says', () => {
    const uses = RULES.filter(r => r.body.includes('var(--atlas-ornament)')).map(r => r.selector);
    expect(uses.filter(s => !ORNAMENTS.has(s))).toEqual([]);
    expect(new Set(uses)).toEqual(ORNAMENTS);
  });

  it('the toggles that went to muted say pressed or not', () => {
    const cases: Array<[string, RegExp]> = [
      ['src/middle/timeline.ts', /chip\.className = 'atlas-chart-type-chip'[^\n]*\n\s*chip\.setAttribute\('aria-pressed'/],
      ['src/middle/timeline.ts', /b\.className = renderMode === m[^\n]*\n\s*b\.setAttribute\('aria-pressed'/],
      ['src/tabs/right/context-pane-toolbar.ts', /classList\.add\('is-off'\);\n\s*chip\.setAttribute\('aria-pressed'/],
      ['src/middle/share-room.ts', /'atlas-share-pin-full-toggle'[^\n]*\n\s*fullBtn\.setAttribute\('aria-pressed'/],
    ];
    for (const [file, re] of cases) {
      expect(re.test(readFileSync(join(ROOT, file), 'utf8')), file + ' ' + re.source).toBe(true);
    }
  });
});
