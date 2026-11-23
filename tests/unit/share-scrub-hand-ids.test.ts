/**
 * The share scrub in a world whose ids are not all id-forms (a folder made by
 * hand: `"id": "wren-the-traitor"`). The address rules read only an id-form,
 * so such a link is text to every other reader; the scrub reads it, because a
 * public page's data must not name an element the page leaves out (conv. 196).
 *
 * In such a world a loose run is kept only when it is plain: an address the
 * address rules read inside this world, whole, or `ow://<type>/<id>` whose id
 * is an element on the page, and nothing more. Where a hand id has no end a
 * run can find (it holds white space or a `)`, or ends in a sentence's closing
 * mark), no run is kept at all. The scrub asks the WHOLE world which ids it
 * holds: a hidden or proposed element is left out of the page, not of that.
 */

import { describe, it, expect } from 'vitest';
import { buildPagePayload, scrubMarkdownForPayload } from '../../src/core/share-payload';
import { findLooseAddressRuns } from '../../src/core/ow-links';
import { ALL_ELEMENT_TYPES, type Element } from '../../src/core/types';

const A = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a71'; // a standard id, on the page
const S = '0193a1c2-7d3e-7f00-8a11-3c5e7b9d2f40'; // a standard id, left out

const el = (id: string, name: string, more: Record<string, unknown> = {}): [string, Element] =>
  [id, { id, name, type: 'character', ...more } as unknown as Element];

const HIDDEN = ['hidden-one', 'constructor', '__proto__', 'Wren', '12', 'character'];
const handWorld = (): Map<string, Element> => new Map<string, Element>([
  el(A, 'Alice'), el('ada', 'Ada'), el(S, 'Secret Sam'),
  ...HIDDEN.map(id => el(id, 'Hidden ' + id)),
]);
const ON_PAGE = new Set([A, 'ada']);
const scrub = (md: string, held = handWorld(), on: ReadonlySet<string> = ON_PAGE): string =>
  scrubMarkdownForPayload(md, on, held);

/** A page of one prose block and one card for each id in `cards`. */
const pageOf = (markdown: string, cards: string[]): Element => ({
  id: 'p1000000-0000-0000-0000-000000000001', type: 'narrative', name: 'a page', subtype: 'page',
  atlas_page_intent: 'reference',
  atlas_page_blocks: [
    { id: 'b1', kind: 'prose', markdown },
    ...cards.map((elementId, i) => ({ id: 'c' + i, kind: 'element-card', elementId, variant: 'compact', fields: [] })),
  ],
  atlas_page_refs: cards,
} as unknown as Element);
const proseOf = (page: Element, elements: Element[]): string =>
  (buildPagePayload(page, elements).blocks[0] as { markdown: string }).markdown;

describe('the share scrub, a world holding ids written by hand', () => {
  describe('a link to an element left off the page becomes its label', () => {
    const ROWS: Array<[string, string, string]> = [
      ['a slug id', 'x [s](ow://character/hidden-one) y', 'x s y'],
      ['an id that is an object property', 'x [c](ow://character/constructor) y', 'x c y'],
      ['the id __proto__', 'x [p](ow://character/__proto__) y', 'x p y'],
      ['an id held in capitals', 'x [w](ow://character/Wren) y', 'x w y'],
      ['a bare address', 'x ow://character/hidden-one y', 'x  y'],
      ['a type word in capitals', 'x [s](ow://Character/hidden-one) y', 'x s y'],
      ['the prefix in capitals', 'x [s](OW://character/hidden-one) y', 'x s y'],
      ['an unknown type word', 'x [s](ow://thing/hidden-one) y', 'x s y'],
      ['letters after the id', 'x ow://character/hidden-one\'s y', 'x  y'],
      ['a moment after it', 'x [s](ow://character/hidden-one@4) y', 'x s y'],
      ['a lens that is left out', `x [m](ow://character/${A}?lens=hidden-one) y`, 'x m y'],
      ['after an id on the page, a slash', `x [m](ow://character/${A}/hidden-one) y`, 'x m y'],
      ['after a hand id on the page, a slash', 'x [m](ow://character/ada/hidden-one) y', 'x m y'],
      ['as the site form\'s world', `x [m](https://www.onlyworlds.com/w/hidden-one/character/${A}) y`, 'x m y'],
      ['as a query value', `x [m](ow://character/${A}?x=hidden-one) y`, 'x m y'],
      ['as a fragment', `x [m](ow://character/${A}#hidden-one) y`, 'x m y'],
      ['an id that is a number, as a moment', `x [m](ow://character/hidden-one@12) y`, 'x m y'],
      ['an id that is a type word', 'x [m](ow://character/character) y', 'x m y'],
      ['an element no longer in the world', 'x [g](ow://character/gone-id) y', 'x g y'],
      ['a standard id left out', `x [u](ow://character/${S}) y`, 'x u y'],
      // What such a world gives up: a run with anything glued to it is not plain, on the page or not.
      ['a hand id on the page, in a code span', 'x `ow://character/ada` y', 'x ` y'],
      ['a hand id on the page, a type word in capitals', 'x [Ada](ow://Character/ada) y', 'x Ada y'],
      ['a standard id on the page, letters after it', `x ow://character/${A}'s y`, 'x  y'],
    ];
    for (const [label, md, want] of ROWS) {
      it(label, () => {
        expect(scrub(md)).toBe(want);
      });
    }
  });

  describe('what is on the page is kept, byte for byte', () => {
    const KEPT: Array<[string, string]> = [
      ['a hand id on the page', 'x [Ada](ow://character/ada) y'],
      ['a hand id on the page, bare', 'x ow://character/ada y'],
      ['a hand id on the page, a sentence\'s full stop', 'See ow://character/ada.'],
      ['a hand id on the page, an angle href', 'x [Ada](<ow://character/ada>) y'],
      ['a hand id written in capitals, held lowercase', 'x [Ada](ow://character/ADA) y'],
      ['a standard id on the page', `x [Alice](ow://character/${A}) y`],
      ['a standard id with a moment and a lens', `x [Alice](ow://character/${A}@4?lens=${A}) y`],
      ['a standard id, a sentence\'s comma', `x ow://character/${A}, y`],
      ['the prefix alone', 'An address starts with ow:// and a type.'],
      ['the site\'s prefix alone', 'A world is at https://www.onlyworlds.com/w/ and its name.'],
    ];
    for (const [label, md] of KEPT) {
      it(label, () => {
        expect(scrub(md)).toBe(md);
      });
    }
  });

  it('a hand id on the page, its twin in capitals left out: the capitals one does not ship', () => {
    const held = new Map<string, Element>([el('ada', 'Ada'), el('ADA', 'Hidden Ada')]);
    expect(scrub('x [a](ow://character/ADA) [b](ow://character/ada) y', held, new Set(['ada'])))
      .toBe('x a [b](ow://character/ada) y');
  });
});

// The page leaves a hidden or proposed element out of every block, and the
// scrub still has to know its id as an id: it is handed the whole world.
describe('the share scrub reads the whole world, the hidden and the proposed too', () => {
  const alice = el(A, 'Alice')[1];

  it('a hidden element with a hand id, in a world of standard ids otherwise', () => {
    const elements = [alice, el('wren-the-traitor', 'Wren', { hidden: true })[1]];
    const page = pageOf(`Ask [Wren](ow://character/wren-the-traitor) and [Alice](ow://character/${A}).`, [A]);
    expect(proseOf(page, elements)).toBe(`Ask Wren and [Alice](ow://character/${A}).`);
    expect(JSON.stringify(buildPagePayload(page, elements))).not.toContain('wren-the-traitor');
  });

  it('a proposed element with a hand id, not yet reviewed', () => {
    const proposed = { x_review_proposed: { by: '19e1c2e5-5e8e-4d46-8382-e5ad445d13a0', evidence: 'seat', expires: '2999-12-31' } };
    const elements = [alice, el('quill-the-spy', 'Quill', proposed)[1]];
    const page = pageOf(`Ask [Quill](ow://character/quill-the-spy) and [Alice](ow://character/${A}).`, [A]);
    expect(proseOf(page, elements)).toBe(`Ask Quill and [Alice](ow://character/${A}).`);
  });

  it('the same link in a card\'s field', () => {
    const carded = el(A, 'Alice', { description: 'Knows [Wren](ow://character/wren-the-traitor).' })[1];
    const elements = [carded, el('wren-the-traitor', 'Wren', { hidden: true })[1]];
    const page = {
      ...pageOf('x', []),
      atlas_page_blocks: [{ id: 'c0', kind: 'element-card', elementId: A, variant: 'full', fields: ['description'] }],
      atlas_page_refs: [A],
    } as unknown as Element;
    const json = JSON.stringify(buildPagePayload(page, elements));
    expect(json).not.toContain('wren-the-traitor');
    expect(json).toContain('Knows Wren.');
  });

  it('a hidden twin in capitals of a hand id on the page', () => {
    const elements = [el('ada', 'Ada')[1], el('Ada', 'Hidden Ada', { hidden: true })[1]];
    const page = pageOf('x [H](ow://character/Ada) [a](ow://character/ada) y', ['ada']);
    expect(proseOf(page, elements)).toBe('x H [a](ow://character/ada) y');
  });

  it('a hidden twin in capitals of a standard id on the page', () => {
    const UP = A.toUpperCase();
    const elements = [alice, el(UP, 'Hidden Alice', { hidden: true })[1]];
    const page = pageOf(`x [H](ow://character/${UP}) [a](ow://character/${A}) y`, [A]);
    expect(proseOf(page, elements)).toBe(`x H [a](ow://character/${A}) y`);
  });

  it('a hidden element whose id ends in a full stop', () => {
    const elements = [el('ada', 'Ada')[1], el('ada.', 'Hidden twin', { hidden: true })[1]];
    const page = pageOf('See [x](ow://character/ada.) now. And ow://character/ada.', ['ada']);
    const out = proseOf(page, elements);
    expect(out).toBe('See x now. And .');
  });
});

// An id that holds white space or a `)`, or ends in a mark a run's end leaves
// to its sentence: a run cannot find where such an id ends, so a plain run
// could be the first word of it. The world keeps no run but a bare prefix.
describe('the share scrub, a hand id with no end a run can find', () => {
  const spaced = (): Map<string, Element> => new Map<string, Element>([
    el(A, 'Alice'), el('ada', 'Ada'), el('ada wren', 'Ada Wren'),
  ]);
  const ROWS: Array<[string, string, string]> = [
    ['the editor\'s own chip, its first word an id on the page', 'x [Ada Wren](ow://character/ada wren) y', 'x Ada Wren y'],
    ['an angle href', 'x [Ada Wren](<ow://character/ada wren>) y', 'x Ada Wren y'],
    ['a title after it', 'x [Ada Wren](ow://character/ada wren "t") y', 'x Ada Wren y'],
    ['a lens after an id on the page', `x [m](ow://character/${A}?lens=ada wren) y`, 'x m y'],
    // A bare address has no link to close: the run goes, the words after its space are text.
    ['a bare address', 'x ow://character/ada wren y', 'x  wren y'],
    ['a link to an element on the page goes too', 'x [Ada](ow://character/ada) y', 'x Ada y'],
    ['and one with a standard id', `x [Alice](ow://character/${A}) y`, 'x Alice y'],
    ['a link that never closes on its line keeps its text', 'x [W](ow://character/ada wren\nnext) y', 'x [W]( wren\nnext) y'],
  ];
  for (const [label, md, want] of ROWS) {
    it(label, () => {
      expect(scrub(md, spaced())).toBe(want);
    });
  }
  it('the prefix alone is kept', () => {
    const md = 'An address starts with ow:// and a type.';
    expect(scrub(md, spaced())).toBe(md);
  });
  for (const id of ['ada.', 'ada!', 'o\'', 'x]', 'y>', 'a)b', 'a\tb']) {
    it(`an id like ${JSON.stringify(id)} in the world: no run is kept`, () => {
      const held = new Map<string, Element>([el('ada', 'Ada'), el(id, 'Odd')]);
      expect(scrub('x [Ada](ow://character/ada) y', held, new Set(['ada']))).toBe('x Ada y');
    });
  }
});

// Whatever the ids look like: a run the scrub keeps is plain, and no link the
// text was given to a left-out element is still in it.
describe('a fuzz of hand ids', () => {
  let seed = 20261123;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const ALPHABET = [
    'a', 'b', 'A', '1', '-', '_', '/', '@', '?', '=', '&', '#', '%', '(', '<', '`',
    ' ', ')', '.', ',', ';', ':', '!', '\'', '"', ']', '>',
  ];
  const TYPES = ['character', 'location', 'Character', 'thing'];
  const typeWords: readonly string[] = ALL_ELEMENT_TYPES;
  const NO_END = /[\s)]|[.,;:!?'"\]>]$/;

  it('every run kept is plain, names only what is on the page, and no left-out link survives', () => {
    let noEndWorlds = 0;
    for (let round = 0; round < 1500; round++) {
      // Two rounds in three draw from letters only, so both kinds of world are well fed.
      const letters = round % 3 !== 0 ? 16 : ALPHABET.length;
      const word = (): string => Array.from({ length: 1 + rnd(4) }, () => ALPHABET[rnd(letters)]).join('');
      const ids = Array.from(new Set(Array.from({ length: 6 }, word)));
      const hiddenAt = rnd(ids.length);
      const held = new Map<string, Element>([el(A, 'Alice'), el(S, 'Sam'), ...ids.map(id => el(id, 'n'))]);
      const on = new Set<string>([A, ...ids.filter((_, i) => i !== hiddenAt && rnd(2) === 0)]);
      const noEnd = ids.some(id => NO_END.test(id));
      if (noEnd) noEndWorlds++;
      const links: Array<{ address: string; id: string }> = [];
      const piece = (): string => {
        const id = rnd(4) === 0 ? (rnd(2) ? A : S) : (rnd(5) === 0 ? word() : ids[rnd(ids.length)]);
        const tail = ['', '', '', '.', '/' + ids[rnd(ids.length)], '?lens=' + ids[rnd(ids.length)], '@' + ids[rnd(ids.length)]][rnd(7)];
        const prefix = ['ow://', 'ow://', 'OW://', 'https://www.onlyworlds.com/w/'][rnd(4)];
        const address = prefix + TYPES[rnd(TYPES.length)] + '/' + id + tail;
        const linked = rnd(2) === 0;
        if (linked && tail === '') links.push({ address, id });
        return linked ? `[l](${address})` : address;
      };
      const md = Array.from({ length: 5 }, piece).join(' x ');
      const out = scrubMarkdownForPayload(md, on, held);
      const say = `${JSON.stringify([...held.keys()])} on ${JSON.stringify([...on])}: ${JSON.stringify(md)} -> ${JSON.stringify(out)}`;

      for (const run of findLooseAddressRuns(out)) {
        const text = out.slice(run.start, run.end);
        expect(noEnd, say).toBe(false);
        const m = /^ow:\/\/([a-z]+)\/(.*)$/s.exec(text);
        expect(m, say).not.toBeNull();
        expect(typeWords.includes(m![1]), say).toBe(true);
        const id = m![2];
        const plainHand = on.has(id) || (!held.has(id) && on.has(id.toLowerCase()));
        const plainStandard = id === A || id.startsWith(A + '@') || id.startsWith(A + '?lens=' + A);
        expect(plainHand || plainStandard, say).toBe(true);
      }
      // A whole link `[l](address)` to an element held and left out never survives as written.
      for (const { address, id } of links) {
        if (held.has(id) && !on.has(id)) expect(out.includes(`[l](${address})`), say).toBe(false);
      }
    }
    expect(noEndWorlds).toBeGreaterThan(200);
  });
});

describe('the share scrub, a world of standard ids only: as it was', () => {
  const held = new Map<string, Element>([el(A, 'Alice'), el(S, 'Secret Sam')]);
  const KEPT = [
    'x ow://character/abc y',
    'x [d](ow://character/some-slug) y',
    `x ow://Character/${A} y`,
    `x [a](ow://character/${A}?x=1) y`,
    `x ow://character/${A}'s y`,
    `x https://www.onlyworlds.com/w/my-world/character/${A} y`,
  ];
  for (const md of KEPT) {
    it(md, () => {
      expect(scrubMarkdownForPayload(md, new Set([A]), held)).toBe(md);
    });
  }
});
