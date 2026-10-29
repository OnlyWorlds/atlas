/**
 * An icon keeps its box (conv. 172) and never shrinks out of it. The box is one
 * em with `overflow: hidden`, which also lets a flex item shrink below its
 * content: in a narrow flex button every icon lost its right side (the room
 * nav's 18 px glyphs drawn in 14, the sidebar's type filters in 11 of 15,
 * 1.87.1 to 1.107.0). jsdom lays nothing out, so this reads the rule itself;
 * the measure on a real page is `glyph-census.mjs` in the session's walks.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('the icon box', () => {
  it('the global icon rule holds the box and never shrinks', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/atlas.css'), 'utf8');
    const rule = css.match(/\n\.material-symbols-outlined \{([^}]*)\}/);
    expect(rule, 'the global .material-symbols-outlined rule').not.toBeNull();
    const body = rule![1];
    expect(body).toMatch(/width:\s*1em/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/flex-shrink:\s*0/);
  });
});
