/**
 * The link grammar every reader of `[label](target)` takes, and the label's
 * escape (`src/core/markdown-link-label.ts`, 1.125.34).
 */
import { describe, it, expect } from 'vitest';
import {
  escapeLinkLabel, unescapeLinkLabel, labelFromSpan, splitsEscape, markdownLinkSpans, labelOpeners,
} from '../../src/core/markdown-link-label';

/** Each link as [label, destination]. */
const read = (text: string): Array<[string, string]> =>
  markdownLinkSpans(text).map(l => [text.slice(l.labelStart, l.labelEnd), text.slice(l.destStart, l.destEnd)]);

describe('the escape', () => {
  it('escapes a backslash and both brackets, and reads them back', () => {
    for (const label of ['Kira [the elder]', 'Kira\\', 'Ki]ra', 'Kira [the elder', '[x](https://x.test)', 'a\\\\b', '*Star*']) {
      expect(unescapeLinkLabel(escapeLinkLabel(label))).toBe(label);
    }
    expect(escapeLinkLabel('Kira [the elder]')).toBe('Kira \\[the elder\\]');
    expect(escapeLinkLabel('Kira\\')).toBe('Kira\\\\');
  });

  it('unescapes only the three: other escapes keep their backslash', () => {
    expect(unescapeLinkLabel('\\*Star\\* \\_x\\_ \\[a\\] \\\\')).toBe('\\*Star\\* \\_x\\_ [a] \\');
  });

  it('a span made a label keeps its escape pairs and escapes a bare bracket or backslash', () => {
    expect(labelFromSpan('Ki[ra')).toBe('Ki\\[ra');
    expect(labelFromSpan('Ki\\[ra')).toBe('Ki\\[ra');
    expect(labelFromSpan('a\\\\b')).toBe('a\\\\b');
    expect(labelFromSpan('a\\b')).toBe('a\\\\b');
  });

  it('a span splits an escape when it starts on an escaped character or ends on an escaping backslash', () => {
    const text = 'He saw \\_Vex and Kira\\\\ came';
    const at = (s: string): [number, number] => [text.indexOf(s), text.indexOf(s) + s.length];
    expect(splitsEscape(text, ...at('_Vex'))).toBe(true);
    expect(splitsEscape(text, ...at('Vex'))).toBe(false);
    expect(splitsEscape(text, ...at('Kira\\'))).toBe(true);
    expect(splitsEscape(text, ...at('Kira\\\\'))).toBe(false);
    expect(splitsEscape(text, ...at('Kira'))).toBe(false);
  });
});

describe('the grammar', () => {
  it('reads a plain link, an escaped label and a balanced one', () => {
    expect(read('[Kira](ow://x)')).toEqual([['Kira', 'ow://x']]);
    expect(read('[Kira \\[the elder\\]](ow://x)')).toEqual([['Kira \\[the elder\\]', 'ow://x']]);
    expect(read('[Kira\\\\](ow://x)')).toEqual([['Kira\\\\', 'ow://x']]);
    expect(read('[Kira [1]](https://x.test)')).toEqual([['Kira [1]', 'https://x.test']]);
  });

  it('an opener after an odd run of backslashes is escaped; after an even run it opens', () => {
    expect(read('Then \\[Kira](ow://x) came.')).toEqual([]);
    expect(read('x\\\\[Kira](ow://x)')).toEqual([['Kira', 'ow://x']]);
    expect(read('x\\\\\\[Kira](ow://x)')).toEqual([]);
  });

  it('a link holds no link: the inner one is the link, the outer brackets prose', () => {
    expect(read('[[Kira](ow://x)](https://x.test)')).toEqual([['Kira', 'ow://x']]);
    expect(read('A [note: [Kira](ow://x)')).toEqual([['Kira', 'ow://x']]);
    expect(read('[a [b](x) c](y)')).toEqual([['b', 'x']]);
  });

  it('form B is prose "[Kira " and a link, as the editor reads it', () => {
    expect(read('[Kira [the elder\\]](ow://x)')).toEqual([['the elder\\]', 'ow://x']]);
  });

  it('reads a target in angle brackets, with a title, and with balanced parentheses', () => {
    expect(read('[a](<ow://x y>)')).toEqual([['a', 'ow://x y']]);
    expect(read('[a](ow://x "t")')).toEqual([['a', 'ow://x']]);
    expect(read("[a](ow://x 't')")).toEqual([['a', 'ow://x']]);
    expect(read('[a](ow://x (t))')).toEqual([['a', 'ow://x']]);
    expect(read('[a](https://x.test/a_(b))')).toEqual([['a', 'https://x.test/a_(b)']]);
    expect(read('[a]()')).toEqual([['a', '']]);
  });

  it('reads no link whose target does not close, or whose label crosses a blank line', () => {
    expect(read('[a](ow://x y)')).toEqual([]);
    expect(read('[a](ow://x')).toEqual([]);
    expect(read('[a\n\nb](ow://x)')).toEqual([]);
    expect(read('[a\nb](ow://x)')).toEqual([['a\nb', 'ow://x']]);
    expect(read('[a]b](ow://x)')).toEqual([]);
  });

  it('pairs a label with its opener whatever its target', () => {
    const text = 'x [Ada Wren](ow://character/ada wren) [a]b](y) \\[c](z)';
    const openerOf = labelOpeners(text);
    expect(openerOf(text.indexOf('](ow'))).toBe(2);
    expect(openerOf(text.indexOf(']b]'))).toBe(text.indexOf('[a]'));
    expect(openerOf(text.indexOf('](y'))).toBe(-1);
    expect(openerOf(text.indexOf('](z'))).toBe(-1);
  });

  it('reads a long text in one pass', () => {
    const shapes = ['['.repeat(200_000), '[a]('.repeat(100_000), '\\'.repeat(200_001) + '[a](b)', '[a](b) '.repeat(50_000), '](('.repeat(100_000)];
    for (const text of shapes) {
      const t0 = performance.now();
      markdownLinkSpans(text);
      labelOpeners(text)(text.length - 1);
      expect(performance.now() - t0).toBeLessThan(1500);
    }
  });
});
