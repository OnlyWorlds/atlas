/**
 * What a drop writes, pure: the field decides which element carries it,
 * whichever square was dragged; never overwrite, never repeat; Undo only
 * while the field still holds what was written.
 */

import { describe, it, expect } from 'vitest';
import { ELEMENT_TYPES, dragField } from '@onlyworlds/sdk';
import { pairWrite, patchFor, undoPatchFor } from '../../src/core/home-grid-pair';
import { holdOf } from '../../src/core/home-grid';

const side = (id: string, type: string, record: Record<string, unknown> = {}) => ({ id, type, record });

/** The SDK's whole pairs table, read through its one public door: every unordered pair of the 22 types. */
const ROWS = ELEMENT_TYPES.flatMap((a, i) => ELEMENT_TYPES.slice(i + 1).map(b => ({ a, b, row: dragField(a, b) })))
  .filter((x): x is { a: typeof x.a; b: typeof x.b; row: NonNullable<typeof x.row> } => x.row !== null)
  .map(({ a, b, row }) => ({ ...row, other: row.on === a ? b : a }));

describe('pairWrite', () => {
  it('Mira onto The Harbour and The Harbour onto Mira write the same field on Mira', () => {
    const mira = side('m', 'character'), harbour = side('h', 'location');
    const w = { on: 'm', field: 'location', target: 'h', single: true, holds: true };
    expect(pairWrite(mira, harbour)).toEqual(w);
    expect(pairWrite(harbour, mira)).toEqual(w);
  });
  it('an Event onto its story writes the story\'s events, in either direction', () => {
    const ev = side('e', 'event'), tale = side('t', 'narrative', { events: ['x'] });
    const w = { on: 't', field: 'events', target: 'e', single: false, holds: true };
    expect(pairWrite(ev, tale)).toEqual(w);
    expect(pairWrite(tale, ev)).toEqual(w);
  });
  it('no target when the field already links the two, in both directions (never repeat)', () => {
    const ev = side('e', 'event'), tale = side('t', 'narrative', { events: ['e'] });
    expect(pairWrite(ev, tale)).toBeNull();
    expect(pairWrite(tale, ev)).toBeNull();
    const mira = side('m', 'character', { location: { id: 'h', name: 'The Harbour' } }), harbour = side('h', 'location');
    expect(pairWrite(harbour, mira)).toBeNull();
  });
  it('no target when a single field holds any value, a gone place included (never overwrite)', () => {
    const mira = side('m', 'character', { location: 'gone-id' }), docks = side('d', 'location');
    expect(pairWrite(mira, docks)).toBeNull();
    expect(pairWrite(docks, mira)).toBeNull();
  });
  it('every pair the table offers is a target: Mira onto The Founding is a line the Event lists', () => {
    const w = { on: 'f', field: 'characters', target: 'm', single: false, holds: false };
    expect(pairWrite(side('m', 'character'), side('f', 'event'))).toEqual(w);
    expect(pairWrite(side('f', 'event'), side('m', 'character'))).toEqual(w);
  });
  it('a pair the table leaves out is no target: two Characters, the same element', () => {
    expect(dragField('character', 'character')).toBeNull();
    expect(pairWrite(side('a', 'character'), side('b', 'character'))).toBeNull();
    expect(pairWrite(side('a', 'location'), side('a', 'location'))).toBeNull();
  });
  it('every offered pair the table names answers through pairWrite with its own field and holds', () => {
    expect(ROWS.length).toBe(113);
    for (const row of ROWS) {
      const w = pairWrite(side('a', row.on), side('b', row.other));
      expect(w, `${row.on}.${row.field}`).toMatchObject({ on: 'a', field: row.field, target: 'b', holds: row.holds });
    }
  });
  it('the narrower holds too: a Location into its Zone, a Creature into a Location or a Zone', () => {
    expect(pairWrite(side('l', 'location'), side('z', 'zone'))).toMatchObject({ on: 'l', field: 'zone' });
    expect(pairWrite(side('c', 'creature'), side('z', 'zone'))).toMatchObject({ on: 'c', field: 'zone' });
    expect(pairWrite(side('c', 'creature'), side('l', 'location'))).toMatchObject({ on: 'c', field: 'location' });
  });
});

describe('patchFor and undoPatchFor (read inside the lock)', () => {
  const single = { on: 'm', field: 'location', target: 'h', single: true, holds: true };
  const list = { on: 't', field: 'events', target: 'e', single: false, holds: true };
  it('writes into an empty single, and refuses one filled since the light', () => {
    expect(patchFor(single, {})).toEqual({ location: 'h' });
    expect(patchFor(single, { location: 'd' })).toBeNull();
  });
  it('appends to a list as it is, every other entry kept as written', () => {
    expect(patchFor(list, { events: [{ id: 'x', name: 'X' }, 'y'] })).toEqual({ events: [{ id: 'x', name: 'X' }, 'y', 'e'] });
    expect(patchFor(list, {})).toEqual({ events: ['e'] });
    expect(patchFor(list, { events: ['e'] })).toBeNull();
    expect(patchFor(list, { events: [{ id: 'e' }] })).toBeNull();
  });
  it('Undo clears exactly what was written, and nothing once it changed', () => {
    expect(undoPatchFor(single, { location: 'h' })).toEqual({ location: null });
    expect(undoPatchFor(single, { location: 'd' })).toBeNull();
    expect(undoPatchFor(list, { events: ['x', 'e'] })).toEqual({ events: ['x'] });
    expect(undoPatchFor(list, { events: ['x'] })).toBeNull();
  });
  it('Undo of a list write removes only the entry it wrote', () => {
    expect(undoPatchFor(list, { events: [{ id: 'x', name: 'X' }, 'e', 'y'] })).toEqual({ events: [{ id: 'x', name: 'X' }, 'y'] });
    // The target now named only by another hand's {id} entry: not the entry this write added.
    expect(undoPatchFor(list, { events: [{ id: 'e', name: 'E' }] })).toBeNull();
  });
});

describe("the canary over the SDK's holding rows", () => {
  // Reads the table, copies nothing: a bump that adds or changes a holding row fails here first,
  // so it gets a look before any square moves.
  const holding = ROWS.filter(r => r.holds);
  it('the held ends, by the field\'s kind, are the six reviewed', () => {
    const seen = holding.map(r => {
      const other = r.other;
      const h = holdOf(r.on, r.field, other)!;
      return `${r.on}.${r.field}:${h.held === 'source' ? r.on : other} under ${h.held === 'source' ? other : r.on}`;
    }).sort();
    expect(seen).toEqual([
      'character.location:character under location',
      'creature.location:creature under location',
      'creature.zone:creature under zone',
      'location.zone:location under zone',
      'narrative.events:event under narrative',
      'object.location:object under location',
    ]);
  });
  it('the holding graph is acyclic and at most two deep', () => {
    const under = new Map<string, Set<string>>();
    for (const r of holding) {
      const other = r.other;
      const h = holdOf(r.on, r.field, other)!;
      const [held, holder] = h.held === 'source' ? [r.on, other] : [other, r.on];
      (under.get(held) ?? under.set(held, new Set()).get(held)!).add(holder);
    }
    const depth = (t: string, seen: Set<string> = new Set()): number => {
      expect(seen.has(t), `a loop through ${t}`).toBe(false);
      const up = [...(under.get(t) ?? [])];
      return up.length ? 1 + Math.max(...up.map(u => depth(u, new Set([...seen, t])))) : 0;
    };
    for (const t of under.keys()) expect(depth(t), t).toBeLessThanOrEqual(2);
  });
});
