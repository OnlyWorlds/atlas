// The charter profile (schema-dist profiles/charter.fixture.json, copied whole at v0.33.0-dist.83, 22 cases):
// Atlas's own pick of a world's Charter is the SDK's `charterOf` at the owner rung, by the pair and the mark
// `x_charter_of`. Every fixture world is read both ways, so a repin that moves the SDK's rule goes red here.
import { describe, expect, it } from 'vitest';
import { charterOf, isCharterElement } from '@onlyworlds/sdk';
import charterFixture from '../fixtures/charter.fixture.json';
import { findCharter } from '../../src/core/charter';
import type { Element } from '../../src/core/types';

type FixtureWorld = { id: string; name: string; open?: boolean; elements: Record<string, unknown>[] };
const worlds = charterFixture.worlds as unknown as Record<string, FixtureWorld>;

describe("the charter profile's element cases (dist.83)", () => {
  for (const c of charterFixture.cases.filter(c => c.kind === 'element')) {
    it(`${c.name}: ${c.is_charter_element ? 'an aid' : 'lore'}`, () => {
      expect(isCharterElement(c.element as never)).toBe(c.is_charter_element);
    });
  }
});

describe("Atlas's Charter is the SDK's, for every fixture world (owner rung)", () => {
  for (const [key, world] of Object.entries(worlds)) {
    it(`${key}: the same Charter`, () => {
      const sdk = charterOf(world as never, { rung: 'owner' }).charter?.id ?? null;
      const atlas = findCharter(world.elements as unknown as Element[])?.id ?? null;
      expect(atlas).toBe(sdk);
    });
  }
  for (const c of charterFixture.cases.filter(c => c.kind === 'charter' && c.reader === 'owner')) {
    it(`${c.name}: the fixture's own answer`, () => {
      // A case names a shared world or carries its own inline (the skill-form cases).
      const world = typeof c.world === 'string' ? worlds[c.world] : (c.world as unknown as FixtureWorld);
      const want = (c.want as { charter: { id: string } | null }).charter?.id ?? null;
      expect(findCharter(world.elements as unknown as Element[])?.id ?? null).toBe(want);
    });
  }
});

describe('the pick by the mark, beside the fixture', () => {
  const W = 'world-1';
  const law = (id: string, extra: Record<string, unknown> = {}): Element =>
    ({ id, type: 'law', name: id, supertype: 'Charter', ...extra }) as unknown as Element;

  it('an unmarked Charter is lore: no Charter', () => {
    expect(findCharter([law('a', { created_at: '2026-10-01T00:00:00Z' })])).toBeNull();
  });
  it('the newest marked one leads; one with no created_at is the oldest', () => {
    const els = [law('a', { x_charter_of: W }), law('b', { x_charter_of: W, created_at: '2026-01-01T00:00:00Z' })];
    expect(findCharter(els)?.id).toBe('b');
  });
  it('created_at is compared as an instant, not as text', () => {
    const els = [
      law('a', { x_charter_of: W, created_at: '2026-10-01T10:00:00+02:00' }), // 08:00Z
      law('b', { x_charter_of: W, created_at: '2026-10-01T09:00:00Z' }),
    ];
    expect(findCharter(els)?.id).toBe('b');
  });
  it("world.json's charter picks among marked Charters only", () => {
    const els = [law('a', { x_charter_of: W, created_at: '2026-01-01T00:00:00Z' }), law('b', { x_charter_of: W, created_at: '2026-02-01T00:00:00Z' }), law('c')];
    expect(findCharter(els, 'a')?.id).toBe('a');
    expect(findCharter(els, 'c')?.id).toBe('b');
    expect(findCharter(els, 'nope')?.id).toBe('b');
  });
  it('a proposed Charter never leads', () => {
    const els = [law('a', { x_charter_of: W, created_at: '2026-01-01T00:00:00Z' }), law('b', { x_charter_of: W, created_at: '2026-02-01T00:00:00Z', x_review_proposed: true })];
    expect(findCharter(els)?.id).toBe('a');
  });
});
