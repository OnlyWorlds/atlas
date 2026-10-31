/**
 * Every `atlas-btn…` class the code puts on an element is one a stylesheet defines (conv. 153: a button's
 * class is its rung on the house ladder). A class no rule styles leaves the browser's own button, a different
 * grey in each engine and on no rung: `atlas-btn--secondary` (two hyphens) sat on four buttons from 1.101.0
 * to 1.114.2, the strand's Clear the strand among them, and its focus ring read 2.95:1 in Chromium.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir: string, ext: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext) && !p.includes('.test.')) out.push(p);
  }
  return out;
};

const CLASS = /atlas-btn(?:-{1,2}[a-z0-9]+)*/g;

describe('button classes', () => {
  it('every atlas-btn class in the code is defined in a stylesheet', () => {
    const defined = new Set<string>();
    for (const f of walk('src', '.css')) for (const m of readFileSync(f, 'utf8').matchAll(/\.(atlas-btn(?:-{1,2}[a-z0-9]+)*)/g)) defined.add(m[1]);
    expect(defined.has('atlas-btn-primary')).toBe(true); // the census reads the sheets at all
    const missing: string[] = [];
    for (const f of walk('src', '.ts')) {
      for (const m of readFileSync(f, 'utf8').matchAll(CLASS)) if (!defined.has(m[0])) missing.push(`${m[0]} in ${f}`);
    }
    expect(missing).toEqual([]);
  });
});
