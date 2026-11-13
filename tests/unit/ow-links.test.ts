// The address profile's prose cases (schema-dist profiles/address.fixture.json, copied whole at
// v0.34.1-dist.124, commit 094107b, 57 prose cases): Atlas finds, reads and rewrites an address in
// prose only through the SDK's reader (`core/ow-links.ts`), so every case below is the profile's own
// answer. A repin that moves the SDK's rule, or a reader of Atlas's own, goes red here.
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
interface ProseCase { name: string; text: string; index: number; expect: { address: string | null; reading: Reading | null } }

const prose = (addressFixture.cases as unknown as Array<{ kind: string } & ProseCase>).filter(c => c.kind === 'prose');
const inWorld = (r: Reading | null): r is Reading => !!r && r.form === 'text' && r.world === null && r.type !== null && r.id !== null;

const NEW_ID = 'aaaaaaaa-0000-7000-8000-00000000000a';
const NEW_LENS = 'cccccccc-0000-7000-8000-00000000000c';

describe('the address fixture is the one vendored', () => {
  it('holds the 57 prose cases of dist.124', () => {
    expect(prose).toHaveLength(57);
  });
});

describe("findAddresses reads every prose case as the profile does", () => {
  for (const c of prose) {
    it(c.name, () => {
      const at = findAddresses(c.text).find(f => f.start === c.index);
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
      const link = findOwLinks(c.text).find(l => l.start === c.index);
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
      const want = c.text.slice(0, c.index) + next + c.text.slice(c.index + address.length);
      // Only the address at the case's index moves (a line may hold others).
      const got = rewriteOwLinks(c.text, l => (l.start === c.index ? { id: NEW_ID, lens: l.lens ? NEW_LENS : null } : null));
      expect(got).toBe(want);
    });
  }
  it('a text where nothing moves is the same string', () => {
    for (const c of prose) {
      expect(rewriteOwLinks(c.text, () => null)).toBe(c.text);
      expect(rewriteOwLinks(c.text, l => ({ id: l.idAsWritten, lens: l.lensAsWritten }))).toBe(c.text);
    }
  });
  it('two addresses with no space between them read as two', () => {
    const A = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a71';
    const B = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a72';
    const links = findOwLinks(`ow://character/${A}ow://object/${B}`);
    expect(links.map(l => `${l.type}/${l.id}`)).toEqual([`character/${A}`, `object/${B}`]);
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
});
