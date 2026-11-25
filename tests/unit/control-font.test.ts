/**
 * A control's words are in the page's face. A browser draws a button,
 * input, select and textarea in its own default face, so any class that never
 * named a family drew its words in Arial (the Settings tabs, the chart chips,
 * the filter counts). One zero-specificity rule at the top of atlas.css hands
 * every control the page's face; a class that sets its own (the icon font)
 * still wins. The live check was a local script of 2026-10-20, not in this repository.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CSS = readFileSync(join(resolve(process.cwd()), 'src', 'styles', 'atlas.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe("a control's face", () => {
  it('every button, input, select and textarea inherits the page font, at zero specificity', () => {
    const m = CSS.match(/:where\(\s*button,\s*input,\s*select,\s*textarea\s*\)\s*\{([^}]*)\}/);
    expect(m, 'the :where(button, input, select, textarea) rule').not.toBeNull();
    expect(m![1]).toMatch(/font-family:\s*inherit;/);
  });
});

/**
 * The page's face is Lato, the house face, which has 400, 700 and 900 only.
 * A weight between them is one a browser picks for us (500 draws as 400, 600
 * as 700), so the sheet never asks for one: a label that wants semi-bold is
 * 700 on purpose. A map label's own face (`font:` shorthand) is its style's.
 */
describe('the house face', () => {
  it('is Lato, loaded in 400, 700 and 900 only, and the sheet asks for no other weight', () => {
    const faces = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1]).filter(b => /font-family:\s*'Lato'/.test(b));
    expect(faces.map(b => b.match(/font-weight:\s*(\d+)/)![1]).sort()).toEqual(['400', '400', '700', '700', '900']);
    expect(CSS).not.toMatch(/Open Sans/);
    const off = [...CSS.matchAll(/font-weight:\s*([^;}\s]+)/g)].map(m => m[1]).filter(w => !['400', '700', '900', 'inherit', 'normal', 'bold'].includes(w));
    expect(off).toEqual([]);
  });

  it('is the body face before the bundle loads', () => {
    const html = readFileSync(join(resolve(process.cwd()), 'index.html'), 'utf8');
    expect(html).toMatch(/font-family:\s*'Lato',\s*system-ui/);
  });
});
