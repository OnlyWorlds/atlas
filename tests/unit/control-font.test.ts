/**
 * A control's words are in the page's face (S446). A browser draws a button,
 * input, select and textarea in its own default face, so any class that never
 * named a family drew its words in Arial (the Settings tabs, the chart chips,
 * the filter counts). One zero-specificity rule at the top of atlas.css hands
 * every control the page's face; a class that sets its own (the icon font)
 * still wins. The live check is `Notes/ui-snapshots/2026-10-20-s446/button-fonts.mjs`.
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
