// The address profile's prose cases (schema-dist profiles/address.fixture.json, copied whole at
// v0.34.1-dist.127, commit f50c526, 76 prose cases): Atlas finds, reads and rewrites an address in
// prose only through the SDK's finder and reader (`core/ow-links.ts`), so every case below is the
// profile's own answer. A repin that moves the SDK's rule, or a reader of Atlas's own, goes red here.
// A case's `index` counts code points; where a letter above U+FFFF stands before the address the
// fixture also gives `index_utf16`, the index a JavaScript string reads, so every loop reads that.
import { describe, expect, it } from 'vitest';
import addressFixture from '../fixtures/address.fixture.json';
import {
  findAddresses, findOwLinks, readOwHref, rewriteOwLinks, isChipLink, linkNamesId, proseNamesId,
  lookupHeldId, pastedAddressIn,
} from '../../src/core/ow-links';

interface Reading {
  form: string; world: string | null; type: string | null; id: string | null;
  lens: string | null; moment: number | null;
}
interface ProseCase {
  name: string; text: string; index: number; index_utf16?: number;
  expect: { address: string | null; reading: Reading | null };
}

const prose = (addressFixture.cases as unknown as Array<{ kind: string } & ProseCase>).filter(c => c.kind === 'prose');
/** Where the case's address starts, as a JavaScript string counts it. */
const startOf = (c: ProseCase): number => c.index_utf16 ?? c.index;
/** Council 1540 (serial 127): where an address in prose may begin. */
const startRows = prose.filter(c => /^prose-(start|back-to-back)-/.test(c.name));
const inWorld = (r: Reading | null): r is Reading => !!r && r.form === 'text' && r.world === null && r.type !== null && r.id !== null;

const NEW_ID = 'aaaaaaaa-0000-7000-8000-00000000000a';
const NEW_LENS = 'cccccccc-0000-7000-8000-00000000000c';

describe('the address fixture is the one vendored', () => {
  it('holds the 76 prose cases of dist.127', () => {
    expect(prose).toHaveLength(76);
  });
  it('holds the 14 rows of where an address in prose begins', () => {
    expect(startRows).toHaveLength(14);
  });
});

describe("findAddresses reads every prose case as the profile does", () => {
  for (const c of prose) {
    it(c.name, () => {
      const at = findAddresses(c.text).find(f => f.start === startOf(c));
      if (c.expect.address === null) {
        expect(at).toBeUndefined();
        return;
      }
      expect(at).toBeDefined();
      expect(c.text.slice(at!.start, at!.end)).toBe(c.expect.address);
      const r = c.expect.reading!;
      expect(at!.reading).toMatchObject({ form: r.form, world: r.world, type: r.type, id: r.id, lens: r.lens, moment: r.moment });
      if (r.id !== null) expect(at!.idAsWritten!.toLowerCase()).toBe(r.id);
      if (r.lens !== null) expect(at!.lensAsWritten!.toLowerCase()).toBe(r.lens);
    });
  }
});

describe('findOwLinks keeps the element addresses inside this world, and only those', () => {
  for (const c of prose) {
    it(c.name, () => {
      const link = findOwLinks(c.text).find(l => l.start === startOf(c));
      const r = c.expect.reading;
      if (!inWorld(r)) {
        expect(link).toBeUndefined();
        return;
      }
      expect(link).toBeDefined();
      expect(c.text.slice(link!.start, link!.end)).toBe(c.expect.address);
      expect({ type: link!.type, id: link!.id, lens: link!.lens, moment: link!.moment })
        .toEqual({ type: r.type, id: r.id, lens: r.lens, moment: r.moment });
    });
  }
});

describe('readOwHref reads a whole href, in-world only', () => {
  for (const c of prose.filter(c => c.expect.address !== null)) {
    it(c.name, () => {
      const r = c.expect.reading!;
      const link = readOwHref(c.expect.address);
      if (inWorld(r)) expect(link).toMatchObject({ type: r.type, id: r.id, lens: r.lens, moment: r.moment });
      else expect(link).toBeNull();
    });
  }
  it('an href with prose after the address is no element href', () => {
    expect(readOwHref('ow://object/01a1d4ef-0000-7000-8000-000000000084.')).toBeNull();
    expect(readOwHref(' ow://object/01a1d4ef-0000-7000-8000-000000000084')).toBeNull();
    expect(readOwHref(null)).toBeNull();
  });
  it('a chip is an address with no moment and no lens', () => {
    expect(isChipLink(readOwHref('ow://object/01a1d4ef-0000-7000-8000-000000000084')!)).toBe(true);
    expect(isChipLink(readOwHref('ow://object/01a1d4ef-0000-7000-8000-000000000084@3')!)).toBe(false);
    expect(isChipLink(readOwHref(`ow://object/01a1d4ef-0000-7000-8000-000000000084?lens=${NEW_LENS}`)!)).toBe(false);
  });
});

describe('rewriteOwLinks changes the id and the lens bytes, nothing else', () => {
  for (const c of prose.filter(c => inWorld(c.expect.reading))) {
    it(c.name, () => {
      const r = c.expect.reading!;
      const address = c.expect.address!;
      // The expected text, built from the fixture alone: the id (and the lens) swapped inside the address.
      let next = address;
      if (r.lens !== null) {
        const at = next.toLowerCase().lastIndexOf(r.lens);
        next = next.slice(0, at) + NEW_LENS + next.slice(at + 36);
      }
      const idAt = next.toLowerCase().indexOf(r.id!);
      next = next.slice(0, idAt) + NEW_ID + next.slice(idAt + 36);
      const want = c.text.slice(0, startOf(c)) + next + c.text.slice(startOf(c) + address.length);
      // Only the address at the case's index moves (a line may hold others).
      const got = rewriteOwLinks(c.text, l => (l.start === startOf(c) ? { id: NEW_ID, lens: l.lens ? NEW_LENS : null } : null));
      expect(got).toBe(want);
    });
  }
  it('a text where nothing moves is the same string', () => {
    for (const c of prose) {
      expect(rewriteOwLinks(c.text, () => null)).toBe(c.text);
      expect(rewriteOwLinks(c.text, l => ({ id: l.idAsWritten, lens: l.lensAsWritten }))).toBe(c.text);
    }
  });
  it("an address glued after a site address's slug is prose: the slug's last letter glues it", () => {
    const ID = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a71';
    const text = `x https://www.onlyworlds.com/w/my-worldow://character/${ID} y`;
    expect(findOwLinks(text)).toEqual([]);
    expect(rewriteOwLinks(text, () => ({ id: NEW_ID }))).toBe(text);
  });
  it("an address after a slug's digit sits inside the slug's run, so only the site address is read", () => {
    // The slug's alphabet takes `ow`, the site address ends at `:`, and the finder goes on past it: no
    // two addresses overlap. The share scrub's wide pass still reads the id (share-payload.test.ts).
    const ID = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a71';
    const text = `x https://www.onlyworlds.com/w/abc3ow://object/${ID}`;
    expect(findAddresses(text).map(f => [f.start, text.slice(f.start, f.end), f.reading.world])).toEqual([
      [2, 'https://www.onlyworlds.com/w/abc3ow', 'abc3ow'],
    ]);
    expect(findOwLinks(text)).toEqual([]);
  });
  it('two addresses with no space between them read as two', () => {
    const A = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a71';
    const B = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a72';
    const links = findOwLinks(`ow://character/${A}ow://object/${B}`);
    expect(links.map(l => `${l.type}/${l.id}`)).toEqual([`character/${A}`, `object/${B}`]);
  });
});

describe('an address glued to a word before it is prose (Council 1540, serial 127)', () => {
  const E = '01a1d4ef-0000-7000-8000-000000000084';
  it('an underscore before it glues, so markdown emphasis in underscores links nothing', () => {
    for (const text of [`Built _ow://object/${E}_ today`, `Built __ow://object/${E}__ today`]) {
      expect(findAddresses(text), text).toEqual([]);
      expect(findOwLinks(text), text).toEqual([]);
      expect(proseNamesId(text, E), text).toBe(false);
    }
  });
  it('emphasis in asterisks still reads', () => {
    for (const [text, at] of [[`Built *ow://object/${E}* today`, 7], [`Built **ow://object/${E}** today`, 8]] as const) {
      expect(findOwLinks(text).map(l => [l.start, l.id]), text).toEqual([[at, E]]);
      expect(proseNamesId(text, E), text).toBe(true);
    }
  });
  it('a glued address names nothing and is never rewritten', () => {
    const text = `Moved the elbow://object/${E} and caféow://object/${E}.`;
    expect(proseNamesId(text, E)).toBe(false);
    expect(rewriteOwLinks(text, () => ({ id: NEW_ID }))).toBe(text);
  });
  it('a hyphen or a digit before it does not glue', () => {
    expect(findOwLinks(`x-ow://object/${E}`).map(l => l.start)).toEqual([2]);
    expect(findOwLinks(`3ow://object/${E}`).map(l => l.start)).toEqual([1]);
  });
  it('a chip is never glued: its address follows `(`', () => {
    expect(findOwLinks(`word[Gate](ow://object/${E})word`).map(l => l.id)).toEqual([E]);
  });
});

describe('naming a held element: as written, then lowercase', () => {
  const lower = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a71';
  const upper = lower.toUpperCase();
  it('an upper-case id names the element held in lowercase', () => {
    expect(proseNamesId(`[x](ow://character/${upper})`, lower)).toBe(true);
  });
  it('an id held in upper case is named only as written', () => {
    expect(linkNamesId({ id: lower, idAsWritten: upper }, upper)).toBe(true);
    expect(linkNamesId({ id: lower, idAsWritten: lower }, upper)).toBe(false);
  });
  it('a type word in capitals names nothing', () => {
    expect(proseNamesId(`[x](ow://Character/${lower})`, lower)).toBe(false);
  });
  it('the chip resolver looks up as held, then lowercase', () => {
    const held = new Map([[lower, 'Ada']]);
    expect(lookupHeldId(upper, id => held.get(id))).toBe('Ada');
    expect(lookupHeldId(lower, id => held.get(id))).toBe('Ada');
    expect(lookupHeldId('nope', id => held.get(id))).toBeUndefined();
  });
});

describe('a pasted address', () => {
  const W = '0aaa0000-0000-4000-8000-000000000001';
  it('is read as prose reads it, the text after it left out', () => {
    expect(pastedAddressIn(`see ow://${W}/character/${W},then`)).toBe(`ow://${W}/character/${W}`);
  });
  it('a prefix in capitals is kept whole so the reader refuses it for its case', () => {
    expect(pastedAddressIn(`OW://${W}.`)).toBe(`OW://${W}`);
  });
  it('a path that goes on past the address is kept whole', () => {
    expect(pastedAddressIn(`https://www.onlyworlds.com/w/${W}/character`)).toBe(`https://www.onlyworlds.com/w/${W}/character`);
  });
  it('no prefix, no address', () => {
    expect(pastedAddressIn('plain words')).toBeNull();
  });
  it('is read from its prefix whatever stands before it: a paste is one address meant', () => {
    const E = '01a1d4ef-0000-7000-8000-000000000084';
    expect(pastedAddressIn(`elbow://object/${E}`)).toBe(`ow://object/${E}`);
    expect(pastedAddressIn(`seehttps://www.onlyworlds.com/w/${W},then`)).toBe(`https://www.onlyworlds.com/w/${W}`);
    expect(pastedAddressIn(`seehttps://www.onlyworlds.com/w/${W}`)).toBe(`https://www.onlyworlds.com/w/${W}`);
  });
});
