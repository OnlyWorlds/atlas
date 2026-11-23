/**
 * The share scrub in a world whose ids are not all id-forms (a folder made by
 * hand: `"id": "wren-the-traitor"`). The address rules read only an id-form,
 * so such a link is text to every other reader; the scrub reads it, because a
 * public page's data must not name an element the page leaves out (conv. 196).
 *
 * In such a world a loose run is kept only when it is plain: an address the
 * address rules read inside this world, whole, or `ow://<type>/<id>` whose id
 * is an element on the page, and nothing more.
 */

import { describe, it, expect } from 'vitest';
import { buildPagePayload, scrubMarkdownForPayload } from '../../src/core/share-payload';
import { findLooseAddressRuns } from '../../src/core/ow-links';
import { ALL_ELEMENT_TYPES, type Element } from '../../src/core/types';

const A = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a71'; // a standard id, on the page
const S = '0193a1c2-7d3e-7f00-8a11-3c5e7b9d2f40'; // a standard id, left out

const el = (id: string, name: string, type = 'character'): [string, Element] =>
  [id, { id, name, type } as unknown as Element];

const HIDDEN = ['hidden-one', 'constructor', '__proto__', 'Wren', 'wren the traitor', '12', 'character'];
const handWorld = (): Map<string, Element> => new Map<string, Element>([
  el(A, 'Alice'), el('ada', 'Ada'), el(S, 'Secret Sam'),
  ...HIDDEN.map(id => el(id, 'Hidden ' + id)),
]);
const ON_PAGE = new Set([A, 'ada']);
const scrub = (md: string, byId = handWorld(), on: ReadonlySet<string> = ON_PAGE): string =>
  scrubMarkdownForPayload(md, on, byId);

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
      ['an id with a space, in a link', 'x [Wren](ow://character/wren the traitor) y', 'x Wren y'],
      ['an id with a space, an angle href', 'x [Wren](<ow://character/wren the traitor>) y', 'x Wren y'],
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

  it('a hand id that ends in a full stop, left out: no run with a trimmed end is kept', () => {
    const byId = handWorld();
    byId.set('ada.', { id: 'ada.', name: 'Hidden twin', type: 'character' } as unknown as Element);
    expect(scrub('See ow://character/ada.', byId)).toBe('See .');
    expect(scrub('See [Ada](ow://character/ada) now', byId)).toBe('See [Ada](ow://character/ada) now');
  });

  it('a hand id on the page, its twin in capitals left out: the capitals one does not ship', () => {
    const byId = new Map<string, Element>([el('ada', 'Ada'), el('ADA', 'Hidden Ada')]);
    expect(scrub('x [a](ow://character/ADA) [b](ow://character/ada) y', byId, new Set(['ada'])))
      .toBe('x a [b](ow://character/ada) y');
  });

  it('the whole payload names no element left out by its hand id', () => {
    const elements = [...handWorld().values()];
    const page = {
      id: 'p1000000-0000-0000-0000-000000000001', type: 'narrative', name: 'a page', subtype: 'page',
      atlas_page_intent: 'reference',
      atlas_page_blocks: [
        { id: 'b1', kind: 'prose', markdown: HIDDEN.map(id => `[x](ow://character/${id})`).join(' ') + ' [Ada](ow://character/ada)' },
        { id: 'b2', kind: 'element-card', elementId: 'ada', variant: 'compact', fields: [] },
      ],
      atlas_page_refs: ['ada'],
    } as unknown as Element;
    const json = JSON.stringify(buildPagePayload(page, elements));
    for (const id of ['hidden-one', 'constructor', '__proto__', 'Wren', 'wren the traitor']) {
      expect(json.includes('/' + id), id).toBe(false);
    }
    expect(json).toContain('ow://character/ada');
  });

  // Whatever the ids look like, a run the scrub keeps is plain: `ow://`, a type
  // word, a slash and an id on the page, with at most a moment and a lens on
  // the page after a standard id. Random ids from an alphabet that holds every
  // mark an address is cut at.
  it('a fuzz of hand ids: every run kept is plain and names only what is on the page', () => {
    let seed = 20261123;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const ALPHABET = ['a', 'b', 'A', '1', '-', '_', '/', '@', '?', '=', '&', '#', '.', ',', '\'', ':', '>', '%'];
    const word = (): string => Array.from({ length: 1 + rnd(4) }, () => ALPHABET[rnd(ALPHABET.length)]).join('');
    const TYPES = ['character', 'location', 'Character', 'thing'];
    const typeWords: readonly string[] = ALL_ELEMENT_TYPES;
    for (let round = 0; round < 400; round++) {
      const ids = Array.from(new Set(Array.from({ length: 6 }, word)));
      const byId = new Map<string, Element>([el(A, 'Alice'), el(S, 'Sam'), ...ids.map(id => el(id, 'n'))]);
      const on = new Set<string>([A, ...ids.filter(() => rnd(2) === 0)]);
      const piece = (): string => {
        const id = rnd(4) === 0 ? (rnd(2) ? A : S) : (rnd(5) === 0 ? word() : ids[rnd(ids.length)]);
        const tail = ['', '', '', '.', '/' + ids[rnd(ids.length)], '?lens=' + ids[rnd(ids.length)], '@' + ids[rnd(ids.length)]][rnd(7)];
        const prefix = ['ow://', 'ow://', 'OW://', 'https://www.onlyworlds.com/w/'][rnd(4)];
        const address = prefix + TYPES[rnd(TYPES.length)] + '/' + id + tail;
        return rnd(2) ? `[l](${address})` : address;
      };
      const md = Array.from({ length: 5 }, piece).join(' x ');
      const out = scrubMarkdownForPayload(md, on, byId);
      for (const run of findLooseAddressRuns(out)) {
        const text = out.slice(run.start, run.end);
        const m = /^ow:\/\/([a-z]+)\/(.*)$/s.exec(text);
        expect(m, `${JSON.stringify(md)} -> ${JSON.stringify(out)}`).not.toBeNull();
        expect(typeWords.includes(m![1]), text).toBe(true);
        const id = m![2];
        const plainHand = on.has(id) || (!byId.has(id) && on.has(id.toLowerCase()));
        const plainStandard = id === A || id.startsWith(A + '@') || id.startsWith(A + '?lens=' + A);
        expect(plainHand || plainStandard, `${JSON.stringify(md)} -> ${JSON.stringify(out)}`).toBe(true);
      }
    }
  });
});

describe('the share scrub, a world of standard ids only: as it was', () => {
  const byId = new Map<string, Element>([el(A, 'Alice'), el(S, 'Secret Sam')]);
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
      expect(scrubMarkdownForPayload(md, new Set([A]), byId)).toBe(md);
    });
  }
});
