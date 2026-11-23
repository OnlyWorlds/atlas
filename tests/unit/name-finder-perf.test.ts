// The name finder's cost (1.125.17, conv. 197). The SDK's `nameFinder` walks a trie of the world's names from each
// place a word can start, so its work for one text is the text's length times the longest name's, whatever the
// number of names. On ordinary prose that is linear: four times the text costs about four times the time (the same
// growth verdict as ow-links-perf, a wall clock alone reds on a loaded machine). On a text that repeats a long
// name's start it is not, which is why a name over 200 code points is not looked for: the two shapes below are the
// worst a 200-code-point name can do, and each stays under a ceiling, so a finder that grows slower reds.
import { describe, expect, it } from 'vitest';
import { autolinkMarkdown, buildAutolinkIndex, MAX_NAME_CODE_POINTS } from '../../src/core/prose-autolink';
import { mountWorkspaceEditor } from '../../src/middle/writing-workspace-editor';
import { AUTOLINK_PLUGIN_KEY } from '../../src/middle/writing-workspace-autolink';
import type { Element } from '../../src/core/types';

const idOf = (n: number): string => `0193a1c2-7d3e-7f00-8a11-${n.toString(16).padStart(12, '0')}`;
const MAX_GROWTH = 10;
const CEILING_MS = 15_000;
// A quarter-size read faster than this is timed as this, so noise cannot fake a growth.
const FLOOR_MS = 50;
/** The accepted worst case of one scan with names of 200 code points (the contract of 1.125.17). */
const WORST_CASE_MS = 600;

/** The best of three runs: load on a shared machine only ever adds time. */
function timed(f: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    f();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

// A made world of 5,000 elements with two aliases each, every name distinct.
const SYL = ['ka', 'ri', 'tho', 'ven', 'mar', 'el', 'dun', 'sa', 'lor', 'qui', 'bre', 'zan', 'ost', 'fel', 'ur', 'gai'];
const nameOf = (n: number): string => {
  let s = '';
  for (let k = n, i = 0; i < 4; i++, k = Math.floor(k / 16)) s += SYL[k % 16];
  return s[0].toUpperCase() + s.slice(1);
};
const WORLD: Element[] = Array.from({ length: 5000 }, (_, i) => ({
  id: idOf(i + 1), type: 'character', name: `${nameOf(i)} Vane`, atlas_aliases: [`the ${nameOf(i)}`, `${nameOf(i)} the Elder`],
} as unknown as Element));
const WORDS = 'the a of and to in that it was he for on are as with his they at be this from have or by one had not'.split(' ');
function prose(size: number): string {
  const parts: string[] = [];
  let len = 0;
  for (let k = 0; len < size; k++) {
    const p = k % 25 === 0 ? (WORLD[(k * 37) % 5000].name as string) : WORDS[(k * 7) % WORDS.length];
    parts.push(p);
    len += p.length + 1;
  }
  return parts.join(' ');
}

describe('find on a large text and a large world is linear', () => {
  it('ordinary prose, 5,000 elements with two aliases each', () => {
    const index = buildAutolinkIndex(WORLD);
    const small = prose(250_000);
    const big = prose(1_000_000);
    expect(index.find(small).length).toBeGreaterThan(1000);
    const a = Math.max(timed(() => index.find(small)), FLOOR_MS);
    const b = timed(() => index.find(big));
    expect(b, `${b.toFixed(0)} ms at 1 MB`).toBeLessThan(CEILING_MS);
    expect(b / a, `grew ${(b / a).toFixed(1)}x for 4x the text (${a.toFixed(0)} ms, ${b.toFixed(0)} ms)`).toBeLessThan(MAX_GROWTH);
  }, 120_000);
});

describe('the worst a name of 200 code points can do, and the cut', () => {
  const cp = (s: string): number => [...s].length;
  /** A name of `n` code points of repeating words ending in "end". */
  const wordsName = (n: number): string => 'the '.repeat(Math.ceil(n / 4)).slice(0, n - 4) + ' end';
  /** A name of `n` code points of one repeated mark ending in a letter. */
  const marksName = (n: number): string => '-'.repeat(n - 1) + 'x';
  // About 107 KB in 200 paragraphs, the live editor's per-keystroke shape.
  const SHAPES: Array<[string, (n: number) => string, string[]]> = [
    ['repeating words', wordsName, Array.from({ length: 200 }, () => Array.from({ length: 134 }, () => 'the').join(' ') + '.')],
    ['a name of marks against a text of dashes', marksName, Array.from({ length: 200 }, () => '-'.repeat(535))],
  ];
  const worldOf = (alias: string): Element[] => [{ id: idOf(1), type: 'character', name: 'Xavier', atlas_aliases: [alias] } as unknown as Element];

  for (const [label, nameOfLength, nodes] of SHAPES) {
    it(`${label}: a name of 200 is looked for, one of 201 is not`, () => {
      expect(cp(nameOfLength(MAX_NAME_CODE_POINTS))).toBe(200);
      const at200 = nameOfLength(200);
      const at201 = nameOfLength(201);
      expect(buildAutolinkIndex(worldOf(at200)).find(`a ${at200} b`)).toHaveLength(1);
      expect(buildAutolinkIndex(worldOf(at201)).find(`a ${at201} b`)).toEqual([]);
    });

    it(`${label}: one keystroke in the live editor, under ${WORST_CASE_MS} ms`, () => {
      const h = mountWorkspaceEditor({
        target: document.createElement('div'),
        initialJson: { type: 'doc', content: nodes.map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })) } as never,
        onUpdate: () => {},
        autolinkSeed: { elements: worldOf(nameOfLength(200)) },
      });
      expect(AUTOLINK_PLUGIN_KEY.getState(h.editor.state)?.index.ids.size).toBe(1);
      const ms = timed(() => h.editor.commands.insertContentAt(3, 'x'));
      h.destroy();
      expect(ms, `${ms.toFixed(0)} ms a keystroke`).toBeLessThan(WORST_CASE_MS);
    }, 60_000);

    it(`${label}: link-all over one whole story, under ${WORST_CASE_MS} ms`, () => {
      const index = buildAutolinkIndex(worldOf(nameOfLength(200)));
      const story = nodes.join('\n\n');
      const ms = timed(() => autolinkMarkdown(story, index));
      expect(ms, `${ms.toFixed(0)} ms a story`).toBeLessThan(WORST_CASE_MS);
    }, 60_000);
  }
});
