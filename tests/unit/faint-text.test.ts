/**
 * The faint-text floor (F-39, Seethe 2026-10-20): every text a
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

  // F-43 (Seethe 2026-10-20): light mode's own faint tier. Ink that flips with
  // the theme reads 4.5:1 on paper only from about 0.62 alpha, though it
  // passes on black from 0.48, so a quiet text below that takes muted (an
  // opaque #6a675f in light). White literals live on dark floors and keep 0.48.
  it('a quiet text in ink that flips is muted or at least 0.62 (F-43)', () => {
    const FLIPPING = /(?:^|[;\s])color:\s*rgba\((?:var\(--atlas-ink-rgb\)|28,\s*27,\s*24),\s*(0?\.\d+)\)/g;
    const offenders: string[] = [];
    for (const r of RULES) {
      for (const m of r.body.matchAll(FLIPPING)) {
        if (Number(m[1]) < 0.62 && !/disabled/.test(r.selector)) offenders.push(`${r.selector} (${m[1]})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // F-43: the light accent #0e7490 is a fill and an edge; as a word on its own
  // wash it reads 4.1 to 4.4, so a word takes --atlas-accent-text (#155e75 in
  // light, the style ladder's lightText). A dark floor keeps the
  // bright cyan: the islands restate the token, and chrome over a canvas floor
  // (conv. 90) or a Leaflet handle is left to its own pair.
  it('an accent word takes the accent text token (F-43)', () => {
    // A quieter accent word (an alpha below 1) takes --atlas-accent-text-soft:
    // cyan at 0.65 in dark, the same #155e75 in light, where no alpha passes.
    const ACCENT_WORD = /(?:^|[;\s])color:\s*(?:var\(--atlas-(?:cyan|accent)\)|rgba\((?:var\(--atlas-accent-rgb\)|14,\s*116,\s*144|34,\s*211,\s*238),)/;
    const words = RULES.filter(r => ACCENT_WORD.test(r.body)
      && !/canvas-scrim|canvas-ink/.test(r.body) && !/leaflet/.test(r.selector)).map(r => r.selector);
    expect(words).toEqual([]);
    const decl = (sel: string, name: string) => RULES.find(r => r.selector === sel)?.body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
    expect(decl(':root', '--atlas-accent-text')).toBe('var(--atlas-cyan)');
    expect(decl(':root', '--atlas-accent-text-soft')).toBe('rgba(var(--atlas-accent-rgb), 0.65)');
    expect(decl(":root[data-theme='light']", '--atlas-accent-text')).toBe('#155e75');
    expect(decl(":root[data-theme='light']", '--atlas-accent-text-soft')).toBe('#155e75');
    const island = RULES.find(r => r.selector.startsWith(":root[data-theme='light'] .atlas-tour-root"));
    expect(island?.body).toMatch(/--atlas-accent-text:\s*#22d3ee;/);
    expect(island?.body).toMatch(/--atlas-accent-text-soft:\s*rgba\(34, 211, 238, 0\.65\);/);
  });

  // F-43: the light theme's opaque word colours each clear 4.5:1 on its three
  // grounds (paper, a raised white, the deep writing surface). The loose-threads
  // count in --atlas-warn-soft read 3.57 (Seethe 2026-10-20).
  it("light mode's word colours clear AA on every light ground (F-43)", () => {
    const light = RULES.find(r => r.selector === ":root[data-theme='light']")!.body;
    const hex = (name: string) => light.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`))?.[1];
    const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = (h: string) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
    const ratio = (a: string, b: string) => { const [lo, hi] = [lum(a), lum(b)].sort((x, y) => x - y); return (hi + 0.05) / (lo + 0.05); };
    const grounds = ['--atlas-bg', '--atlas-bg-raised', '--atlas-bg-deep'].map(g => hex(g) ?? light.match(new RegExp(`${g}:\\s*(#[0-9a-fA-F]{3,6});`))?.[1]);
    expect(grounds).toEqual(['#fbfbfa', '#ffffff', '#f4f4f2']);
    const low: string[] = [];
    for (const word of ['--atlas-text', '--atlas-text-muted', '--atlas-accent-text', '--atlas-accent-text-soft', '--atlas-warn-soft']) {
      const c = hex(word);
      expect(c, word).toBeDefined();
      for (const g of grounds) if (ratio(c!, g!) < 4.5) low.push(`${word} ${c} on ${g}: ${ratio(c!, g!).toFixed(2)}`);
    }
    expect(low).toEqual([]);
  });

  // F-43: an empty field's label was dimmed by an opacity (3.11:1 in light,
  // 4.47 in dark); its step below a filled field is now a colour, muted.
  it('an empty field row says so by colour, never by opacity (F-43)', () => {
    const dimmed = RULES.filter(r => /atlas-field-(empty-row|link-none)/.test(r.selector) && !/:hover/.test(r.selector)
      && /(?:^|[;\s])opacity:\s*0?\.\d+/.test(r.body)).map(r => r.selector);
    expect(dimmed).toEqual([]);
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
