// The address walk is linear (1.124.2): a 2 MB story of any shape is read in well under a
// second and a half. The walk keeps each prefix's next index, and a prefix is held against
// the address's core shape before the SDK is asked (a failed read costs it about a millisecond).
// The bound is generous on purpose; the quadratic walk took 4 to 57 s on these shapes.
import { describe, expect, it } from 'vitest';
import { findLooseAddressRuns, findOwLinks, pastedAddressIn, proseNamesId, rewriteOwLinks } from '../../src/core/ow-links';
import { scrubMarkdownForPayload } from '../../src/core/share-payload';

const SIZE = 2_000_000;
const BOUND_MS = 1500;
const ID = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a71';
const idOf = (n: number): string => `0193a1c2-7d3e-7f00-8a11-${n.toString(16).padStart(12, '0')}`;

function story(unit: (k: number) => string): string {
  const parts: string[] = [];
  let len = 0;
  for (let k = 0; len < SIZE; k++) { const p = unit(k); parts.push(p); len += p.length; }
  return parts.join('');
}

function timed(f: () => unknown): number {
  const t = performance.now();
  f();
  return performance.now() - t;
}

const SHAPES: Array<[string, () => string]> = [
  ['ordinary prose with links', () => story(k => `Some prose words here and there, then [Name ${k}](ow://character/${idOf(k % 3000)}) more. `)],
  ['ow:// repeated', () => 'ow://'.repeat(SIZE / 5)],
  ['ow://character/ and 70 letters, repeated', () => story(() => 'ow://character/' + 'a'.repeat(70) + ' ')],
  ['a world, an unknown type word and an id, repeated', () => story(() => `ow://${ID}/characterx/${ID} `)],
  ["the site's prefix, an id and an unknown type word, repeated", () => story(() => `https://www.onlyworlds.com/w/${ID}/characterx/${ID} `)],
  ['an address and 64 letters glued after it, repeated', () => story(k => `ow://character/${idOf(k)}` + 'a'.repeat(64) + ' ')],
  ['an address and 64 letters glued after it, no space', () => story(k => `ow://character/${idOf(k)}` + 'a'.repeat(64))],
  ['an address and a moment of 60 digits, repeated', () => story(k => `ow://character/${idOf(k)}@` + '9'.repeat(60))],
];

describe('a 2 MB story is read in linear time', () => {
  for (const [label, make] of SHAPES) {
    it(label, () => {
      const text = make();
      expect(timed(() => findOwLinks(text)), 'findOwLinks').toBeLessThan(BOUND_MS);
      expect(timed(() => rewriteOwLinks(text, l => ({ id: 'ffff' + l.id.slice(4) }))), 'rewriteOwLinks').toBeLessThan(BOUND_MS);
      expect(timed(() => scrubMarkdownForPayload(text, new Set(), new Map())), 'the share scrub').toBeLessThan(BOUND_MS);
      expect(timed(() => proseNamesId(text, idOf(999999))), 'proseNamesId').toBeLessThan(BOUND_MS);
    }, 120_000);
  }
});

// One run of sentence punctuation that does not end the run: a trailing-punctuation trim must walk back
// from the end, never try a pattern anchored at the end from each start.
describe('a 2 MB run of punctuation is trimmed in linear time', () => {
  const dots = 'ow://' + '.'.repeat(SIZE) + 'x';
  const dotsX = 'ow://' + '.x'.repeat(SIZE / 2);
  it('the share scrub\'s loose runs', () => {
    expect(timed(() => findLooseAddressRuns(dots)), 'dots then x').toBeLessThan(BOUND_MS);
    expect(timed(() => findLooseAddressRuns(dotsX)), '.x repeated').toBeLessThan(BOUND_MS);
    expect(timed(() => scrubMarkdownForPayload(dots, new Set(), new Map())), 'the scrub').toBeLessThan(BOUND_MS);
  }, 120_000);
  it('a pasted address', () => {
    expect(timed(() => pastedAddressIn(dots)), 'dots then x').toBeLessThan(BOUND_MS);
    expect(timed(() => pastedAddressIn('ow://' + '.'.repeat(SIZE))), 'dots to the end').toBeLessThan(BOUND_MS);
  }, 120_000);
});
