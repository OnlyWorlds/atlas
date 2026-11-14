// The address walk is linear (1.124.2). Each shape is read at a quarter size and at full size (2 MB), and the
// verdict is the growth: four times the text may cost at most ten times the time (linear reads about 4, the
// quadratic walks this file guards against read about 16 and took 4 to 57 s at 2 MB). A wall-clock bound alone
// went red on a loaded machine (1,583 ms against 1,500 in a full run, green alone), so the clock is only a
// generous ceiling that no defect of this family stays under.
import { describe, expect, it } from 'vitest';
import { findLooseAddressRuns, findOwLinks, pastedAddressIn, proseNamesId, rewriteOwLinks } from '../../src/core/ow-links';
import { scrubMarkdownForPayload } from '../../src/core/share-payload';

const SIZE = 2_000_000;
const MAX_GROWTH = 10;
const CEILING_MS = 15_000;
// A quarter-size read faster than this is timed as this, so noise cannot fake a growth (a 19 ms read under
// load once read as 14x; a quadratic walk at 2 MB still takes far longer than ten times this floor).
const FLOOR_MS = 50;
const ID = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a71';
const idOf = (n: number): string => `0193a1c2-7d3e-7f00-8a11-${n.toString(16).padStart(12, '0')}`;

function story(size: number, unit: (k: number) => string): string {
  const parts: string[] = [];
  let len = 0;
  for (let k = 0; len < size; k++) { const p = unit(k); parts.push(p); len += p.length; }
  return parts.join('');
}

/** The best of three runs: load on a shared machine only ever adds time, so the minimum is the read's own cost. */
function timed(f: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    f();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

/** Times `read` on the shape at a quarter size and at full size; fails on growth past MAX_GROWTH or the ceiling. */
function expectLinear(label: string, make: (size: number) => string, read: (text: string) => unknown): void {
  const small = make(SIZE / 4);
  const big = make(SIZE);
  read(small); // warm the code path
  const a = Math.max(timed(() => read(small)), FLOOR_MS);
  const b = timed(() => read(big));
  expect(b, `${label}: ${b.toFixed(0)} ms at 2 MB`).toBeLessThan(CEILING_MS);
  expect(b / a, `${label}: grew ${(b / a).toFixed(1)}x for 4x the text (${a.toFixed(0)} ms, ${b.toFixed(0)} ms)`).toBeLessThan(MAX_GROWTH);
}

const SHAPES: Array<[string, (size: number) => string]> = [
  ['ordinary prose with links', s => story(s, k => `Some prose words here and there, then [Name ${k}](ow://character/${idOf(k % 3000)}) more. `)],
  ['ow:// repeated', s => 'ow://'.repeat(s / 5)],
  ['ow://character/ and 70 letters, repeated', s => story(s, () => 'ow://character/' + 'a'.repeat(70) + ' ')],
  ['a world, an unknown type word and an id, repeated', s => story(s, () => `ow://${ID}/characterx/${ID} `)],
  ["the site's prefix, an id and an unknown type word, repeated", s => story(s, () => `https://www.onlyworlds.com/w/${ID}/characterx/${ID} `)],
  ['an address and 64 letters glued after it, repeated', s => story(s, k => `ow://character/${idOf(k)}` + 'a'.repeat(64) + ' ')],
  ['an address and 64 letters glued after it, no space', s => story(s, k => `ow://character/${idOf(k)}` + 'a'.repeat(64))],
  ['an address and a moment of 60 digits, repeated', s => story(s, k => `ow://character/${idOf(k)}@` + '9'.repeat(60))],
];

describe('a 2 MB story is read in linear time', () => {
  for (const [label, make] of SHAPES) {
    it(label, () => {
      expectLinear('findOwLinks', make, t => findOwLinks(t));
      expectLinear('rewriteOwLinks', make, t => rewriteOwLinks(t, l => ({ id: 'ffff' + l.id.slice(4) })));
      expectLinear('the share scrub', make, t => scrubMarkdownForPayload(t, new Set(), new Map()));
      expectLinear('proseNamesId', make, t => proseNamesId(t, idOf(999999)));
    }, 180_000);
  }
});

// One run of sentence punctuation that does not end the run: a trailing-punctuation trim must walk back
// from the end, never try a pattern anchored at the end from each start.
describe('a 2 MB run of punctuation is trimmed in linear time', () => {
  const dots = (s: number) => 'ow://' + '.'.repeat(s) + 'x';
  const dotsX = (s: number) => 'ow://' + '.x'.repeat(s / 2);
  const dotsToEnd = (s: number) => 'ow://' + '.'.repeat(s);
  it('the share scrub\'s loose runs', () => {
    expectLinear('dots then x', dots, t => findLooseAddressRuns(t));
    expectLinear('.x repeated', dotsX, t => findLooseAddressRuns(t));
    expectLinear('the scrub', dots, t => scrubMarkdownForPayload(t, new Set(), new Map()));
  }, 180_000);
  it('a pasted address', () => {
    expectLinear('dots then x', dots, t => pastedAddressIn(t));
    expectLinear('dots to the end', dotsToEnd, t => pastedAddressIn(t));
  }, 180_000);
});
