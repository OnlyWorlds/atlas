/**
 * The reading aids out of the lore (1.101, the charter profile's rule 1): a
 * marked Charter, Guide or Domain is in no whole view while the aids are
 * hidden, which they are unless shown in this very world; an unmarked Charter
 * Law is lore; a proposed aid is lore; the room's switch stays its own; a
 * world with neither keeps its own array.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { CHARTER_PAIRS } from '@onlyworlds/sdk';
import fixture from '../fixtures/charter.fixture.json';
import { aidKind, isReadingAid, readingAids } from '../../src/core/charter';
import { aidsHidden, currentLore, loreElements, loreFor, loreWithAids, pageLore, toggleAids } from '../../src/core/parlor-room';
import { getState, patchSlice } from '../../src/core/state';
import type { Element } from '../../src/core/types';

const el = (id: string, type: string, o: Record<string, unknown> = {}): Element => ({ id, type, name: id, ...o }) as unknown as Element;
const charter = el('ch', 'law', { supertype: 'Charter', x_charter_of: 'w' });
const guide = el('gd', 'construct', { supertype: 'Guide', x_charter_of: 'w' });
const domain = el('dm', 'construct', { supertype: 'Domain', x_charter_of: 'w', locations: ['loc'] });
const lore = el('lore-charter', 'law', { supertype: 'Charter' });
const proposed = el('pr', 'construct', { supertype: 'Domain', x_charter_of: 'w', x_review_proposed: { by: 'm1' } });
const room = el('msg', 'narrative', { supertype: 'Message', x_room_of: 'w' });
const plain = el('loc', 'location');
const WORLD = [charter, guide, domain, lore, proposed, room, plain];

afterEach(() => {
  patchSlice('ui', { ...getState().ui, showAids: null, hideRoom: true });
});

describe('what a reading aid is', () => {
  it("the kind comes from the SDK's pairs, which are the fixture's", () => {
    expect(CHARTER_PAIRS.map(p => [p.type, p.supertype, p.aid])).toEqual(fixture.pairs.map(p => [p.type, p.supertype, p.aid]));
    expect(aidKind(el('a', 'law', { supertype: ' CHARTER ' }))).toBe('charter');
    expect(aidKind(el('a', 'construct', { supertype: 'guide' }))).toBe('guide');
    expect(aidKind(el('a', 'construct', { supertype: 'Charter' }))).toBeNull();
    expect(aidKind(el('a', 'law', { supertype: 'Domain' }))).toBeNull();
  });
  it('the pair and the mark, and not proposed', () => {
    expect([charter, guide, domain].every(isReadingAid)).toBe(true);
    expect(isReadingAid(lore)).toBe(false);
    expect(isReadingAid(proposed)).toBe(false);
    expect(isReadingAid(el('n', 'construct', { supertype: 'Domain', x_charter_of: null }))).toBe(false);
    expect(readingAids(WORLD).count).toBe(3);
  });
});

describe('the lore leaves them out', () => {
  it('hidden: the three go, the unmarked Charter and the proposed one stay', () => {
    const ids = loreElements(WORLD, true, true).map(e => e.id);
    expect(ids).toEqual(['lore-charter', 'pr', 'loc']);
    expect(loreElements(WORLD, true, false).map(e => e.id)).toEqual(['ch', 'gd', 'dm', 'lore-charter', 'pr', 'loc']);
    expect(loreElements(WORLD, false, true).map(e => e.id)).toEqual(['lore-charter', 'pr', 'msg', 'loc']);
  });
  it('a world with neither keeps its own array, and each pair of switches keeps its identity', () => {
    const none = [lore, plain];
    expect(loreElements(none, true, true)).toBe(none);
    const a = loreElements(WORLD, true, true);
    const b = loreElements(WORLD, true, false);
    expect(loreElements(WORLD, true, true)).toBe(a);
    expect(loreElements(WORLD, true, false)).toBe(b);
  });
  it('the switch is per world: shown in one, hidden in every other', () => {
    patchSlice('active', { worldId: 'w1' } as never);
    patchSlice('data', { ...getState().data, elements: WORLD });
    expect(aidsHidden()).toBe(true);
    expect(currentLore().some(isReadingAid)).toBe(false);
    toggleAids();
    expect(getState().ui.showAids).toBe('w1');
    expect(currentLore().filter(isReadingAid).length).toBe(3);
    patchSlice('active', { worldId: 'w2' } as never);
    expect(aidsHidden()).toBe(true);
    patchSlice('active', { worldId: 'w1' } as never);
    toggleAids();
    expect(getState().ui.showAids).toBeNull();
  });
  it("the suggestions' source keeps the aids, never the room", () => {
    patchSlice('data', { ...getState().data, elements: WORLD });
    const ids = loreWithAids().map(e => e.id);
    expect(ids).toContain('dm');
    expect(ids).not.toContain('msg');
  });
  it("an aid's page reads the aids but keeps the room under its switch; a room element's reads the whole world", () => {
    patchSlice('data', { ...getState().data, elements: WORLD });
    const ids = (els: Element[]) => els.map(e => e.id);
    expect(ids(pageLore(guide))).toContain('dm');
    expect(ids(pageLore(guide))).not.toContain('msg');
    expect(ids(pageLore(room))).toContain('msg');
    expect(ids(pageLore(lore))).not.toContain('dm');
  });
  it("the picker: an aid or a would-be aid offers the aids; a room element's picker offers the lore (conv. 161)", () => {
    patchSlice('data', { ...getState().data, elements: WORLD });
    const ids = (els: Element[]) => els.map(e => e.id);
    expect(ids(loreFor(guide))).toContain('dm');
    expect(ids(loreFor(el('ug', 'construct', { supertype: 'Guide' })))).toContain('dm');
    expect(ids(loreFor(room))).not.toContain('msg');
    expect(ids(loreFor(room))).not.toContain('dm');
    expect(ids(loreFor(plain))).not.toContain('dm');
  });
});
