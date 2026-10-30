/**
 * The strand's pure core (`src/core/strand.ts`): the reading at the owner rung over this copy, checked
 * against the profile's own fixture (schema-dist `profiles/strand.fixture.json`, vendored); who may write
 * which box; each box's write plan.
 */
import { describe, it, expect } from 'vitest';
import { strandOf } from '@onlyworlds/sdk';
import fixture from '../fixtures/strand.fixture.json';
import {
  strandView, strandBodies, isStrandKeeper, maySetSlot, anySlotWritable, offerable, appendId, listed,
  markForStory, markForEvent, markForPlace, markStillDrawn, rawSingle, singleStillDrawn, EMPTY_STRAND,
} from '../../src/core/strand';
import type { Element, WorldMeta, WorldRegistryEntry } from '../../src/core/types';

type FixtureWorld = { id: string; name: string; x_strand?: unknown; elements: Element[] };
const worlds = fixture.worlds as unknown as Record<string, FixtureWorld>;
const ownerCases = fixture.cases.filter(c => c.reader === 'owner');
const metaOf = (w: FixtureWorld) => ({ id: w.id, name: w.name, x_strand: w.x_strand }) as unknown as WorldMeta;

describe('strandView: the fixture, read by the owner of this copy', () => {
  it('has the owner cases to read', () => {
    expect(ownerCases.length).toBeGreaterThanOrEqual(17);
  });

  for (const c of ownerCases) {
    it(c.name, () => {
      const w = worlds[c.world];
      expect(strandView(metaOf(w), w.elements)).toEqual(c.want);
    });
  }

  for (const c of ownerCases) {
    it(`${c.name}: the five bodies answer as the whole world does`, () => {
      const w = worlds[c.world];
      const whole = strandOf({ elements: w.elements, x_strand: w.x_strand } as never, { rung: 'owner' });
      const byId = new Map(w.elements.map(e => [e.id, e]));
      const part = strandOf({ elements: strandBodies(w.x_strand, byId), x_strand: w.x_strand } as never, { rung: 'owner' });
      expect(part).toEqual(whole);
    });
  }

  it('a kept-here copy draws no slot', () => {
    const w = worlds.harbour;
    const hero = strandView(metaOf(w), w.elements).character!;
    const out = strandView(metaOf(w), w.elements, id => id === hero.id);
    expect(out.character).toBeNull();
    expect(out.now).toBeNull();
    expect(out.narrative).not.toBeNull();
  });

  it('no mark, no strand; the same answer twice is the same object', () => {
    expect(strandView({ id: 'w', name: 'W' }, [])).toBe(EMPTY_STRAND);
    const w = worlds.harbour;
    expect(strandView(metaOf(w), w.elements)).toBe(strandView(metaOf(w), [...w.elements]));
  });
});

const linked = (role: string | undefined, extra: Record<string, unknown> = {}) => ({
  id: 'w', name: 'W', state: 'api-linked', api: { world_id: 'a', api_key: 'k', ...(role ? { member_role: role } : {}), ...extra },
}) as unknown as WorldRegistryEntry;
const local = { id: 'w', name: 'W', state: 'local-only' } as unknown as WorldRegistryEntry;

describe('who writes', () => {
  it('a keeper is the owner or a co-builder, by role or by seat, or a folder world\'s own owner', () => {
    expect(isStrandKeeper(linked('owner'), {})).toBe(true);
    expect(isStrandKeeper(linked('co_builder'), {})).toBe(true);
    expect(isStrandKeeper(linked(undefined, { seat: { role: 'co_builder' } }), {})).toBe(true);
    expect(isStrandKeeper(linked('contributor'), {})).toBe(false);
    expect(isStrandKeeper(linked('guest'), {})).toBe(false);
    expect(isStrandKeeper(linked(undefined), {})).toBe(false);
    expect(isStrandKeeper(local, {})).toBe(true);
    expect(isStrandKeeper(linked('owner', { read_only: true }), {})).toBe(false);
    expect(isStrandKeeper({ ...local, copy_of: 'x' } as never, {})).toBe(false);
  });

  it('per box: the mark\'s boxes a keeper; Hero by the story; Now by the hero', () => {
    const w = worlds.harbour;
    const byId = new Map(w.elements.map(e => [e.id, e]));
    const s = strandView(metaOf(w), w.elements);
    const own = (slot: Parameters<typeof maySetSlot>[0], e: WorldRegistryEntry) => maySetSlot(slot, e, {}, s, byId);
    for (const slot of ['narrative', 'event', 'location', 'character', 'now'] as const) {
      expect(own(slot, linked('owner'))).toBe(true);
      expect(own(slot, linked('owner', { read_only: true }))).toBe(false);
    }
    // A contributor who made nothing here: no box.
    const contributor = linked('contributor', { membership: 'm-1' });
    const theirs = new Map([...byId].map(([id, e]) => [id, { ...e, created_by: 'm-other' } as Element]));
    const as = (slot: Parameters<typeof maySetSlot>[0], m: Map<string, Element>) => maySetSlot(slot, contributor, {}, s, m);
    expect(['narrative', 'event', 'location', 'character', 'now'].map(sl => as(sl as never, theirs))).toEqual([false, false, false, false, false]);
    // One who made the story writes the hero, never the mark.
    const story = { ...theirs.get(s.narrative!.id)!, created_by: 'm-1' } as Element;
    const mine = new Map(theirs).set(story.id, story);
    expect(maySetSlot('character', contributor, {}, s, mine)).toBe(true);
    expect(maySetSlot('event', contributor, {}, s, mine)).toBe(false);
    expect(anySlotWritable(contributor, {}, s, mine)).toBe(true);
    expect(anySlotWritable(contributor, {}, s, theirs)).toBe(false);
    expect(anySlotWritable(contributor, {}, EMPTY_STRAND, byId)).toBe(false);
  });

  it('nothing past an empty parent', () => {
    expect(maySetSlot('event', linked('owner'), {}, EMPTY_STRAND, new Map())).toBe(false);
    expect(maySetSlot('character', linked('owner'), {}, EMPTY_STRAND, new Map())).toBe(false);
  });
});

describe('what a box offers', () => {
  const n = (extra: Record<string, unknown> = {}) => ({ id: 'n', type: 'narrative', name: 'N', ...extra }) as unknown as Element;
  it('its own kind only, never a stub, a proposed element, a room element or a reading aid; a chapter yes', () => {
    expect(offerable(n(), 'narrative')).toBe(true);
    expect(offerable(n({ parent_narrative: 'p' }), 'narrative')).toBe(true);
    expect(offerable(n(), 'event')).toBe(false);
    expect(offerable(n({ known_of: true }), 'narrative')).toBe(false);
    expect(offerable(n({ x_review_proposed: { by: 'm', evidence: 'seat' } }), 'narrative')).toBe(false);
    expect(offerable(n({ supertype: 'Message', x_room_of: 'w' }), 'narrative')).toBe(false);  });
});

describe('the writes', () => {
  const byId = (els: Record<string, unknown>[]) => new Map(els.map(e => [e.id as string, e as unknown as Element]));
  const filled = (n: string) => ({ ...EMPTY_STRAND, narrative: { id: n, name: '' } });

  it('an append never repeats an id the SDK reads as listed; an object entry gets the bare id beside it', () => {
    expect(appendId(['a'], 'a')).toBeNull();
    expect(appendId(['a'], 'b')).toEqual(['a', 'b']);
    expect(appendId(undefined, 'b')).toEqual(['b']);
    expect(appendId([{ id: 'b', name: 'B' }], 'b')).toEqual([{ id: 'b', name: 'B' }, 'b']);
    expect(listed([{ id: 'b' }], 'b')).toBe(false);
  });

  it('a story change keeps the happening only when the new story lists it, and the place only with it', () => {
    const els = byId([
      { id: 'n2', type: 'narrative', events: ['e1'] },
      { id: 'n3', type: 'narrative', events: [] },
      { id: 'e1', type: 'event', locations: ['l1'] },
    ]);
    const mark = { narrative: 'n1', event: 'e1', location: 'l1' };
    expect(markForStory(mark, filled('n1'), 'n2', els)).toEqual({ narrative: 'n2', event: 'e1', location: 'l1' });
    expect(markForStory(mark, filled('n1'), 'n3', els)).toEqual({ narrative: 'n3', event: null, location: null });
    // A mark the SDK reads as none starts fresh.
    expect(markForStory(mark, EMPTY_STRAND, 'n2', els)).toEqual({ narrative: 'n2', event: null, location: null });
  });

  it('a happening change keeps the place only when the new happening lists it; a place needs a happening', () => {
    const els = byId([{ id: 'e2', type: 'event', locations: ['l1'] }, { id: 'e3', type: 'event', locations: [] }]);
    const mark = { narrative: 'n1', event: 'e1', location: 'l1' };
    expect(markForEvent(mark, filled('n1'), 'e2', els)).toEqual({ narrative: 'n1', event: 'e2', location: 'l1' });
    expect(markForEvent(mark, filled('n1'), 'e3', els)).toEqual({ narrative: 'n1', event: 'e3', location: null });
    expect(markForEvent(mark, EMPTY_STRAND, 'e3', els)).toBeNull();
    expect(markForPlace({ narrative: 'n1', event: null }, filled('n1'), 'l2')).toBeNull();
    expect(markForPlace(mark, filled('n1'), 'l2')).toEqual({ narrative: 'n1', event: 'e1', location: 'l2' });
  });

  it('a mark write is refused when the story or the happening moved since the box was drawn', () => {
    const disk = { narrative: 'n2', event: 'e1', location: null };
    expect(markStillDrawn(disk, { narrative: 'n2' })).toBe(true);
    expect(markStillDrawn(disk, { narrative: 'n1' })).toBe(false);
    expect(markStillDrawn(disk, { narrative: 'n2', event: 'e1' })).toBe(true);
    expect(markStillDrawn(disk, { narrative: 'n2', event: null })).toBe(false);
    expect(markStillDrawn(undefined, { narrative: null })).toBe(true);
  });

  it('a single link: the raw value decides, and a change is compare-and-set', () => {
    const el = (v: unknown) => ({ id: 'n', type: 'narrative', protagonist: v }) as unknown as Element;
    expect(rawSingle(el(undefined), 'protagonist')).toBeNull();
    expect(rawSingle(el(''), 'protagonist')).toBeNull();
    expect(rawSingle(el('c-proposed'), 'protagonist')).toBe('c-proposed');
    expect(rawSingle(el({ id: 'c' }), 'protagonist')).toEqual({ id: 'c' });
    expect(singleStillDrawn('c1', 'c1')).toBe(true);
    expect(singleStillDrawn(undefined, null)).toBe(true);
    expect(singleStillDrawn('c2', 'c1')).toBe(false);
    expect(singleStillDrawn({ id: 'c' }, { id: 'c' })).toBe(true);
  });
});
