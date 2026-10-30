/**
 * What a drop writes, pure: the field decides which element carries it,
 * whichever square was dragged; never overwrite, never repeat; Undo only
 * while the field still holds what was written.
 */

import { describe, it, expect } from 'vitest';
import { pairWrite, patchFor, undoPatchFor } from '../../src/core/home-grid-pair';

const side = (id: string, type: string, record: Record<string, unknown> = {}) => ({ id, type, record });

describe('pairWrite', () => {
  it('Mira onto The Harbour and The Harbour onto Mira write the same field on Mira', () => {
    const mira = side('m', 'character'), harbour = side('h', 'location');
    const w = { on: 'm', field: 'location', target: 'h', single: true };
    expect(pairWrite(mira, harbour)).toEqual(w);
    expect(pairWrite(harbour, mira)).toEqual(w);
  });
  it('an Event onto its story writes the story\'s events, in either direction', () => {
    const ev = side('e', 'event'), tale = side('t', 'narrative', { events: ['x'] });
    const w = { on: 't', field: 'events', target: 'e', single: false };
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
  it('a pair that does not hold is no target until the SDK offers every pair', () => {
    expect(pairWrite(side('m', 'character'), side('e', 'event'))).toBeNull();
    expect(pairWrite(side('a', 'character'), side('b', 'character'))).toBeNull();
    expect(pairWrite(side('a', 'location'), side('a', 'location'))).toBeNull();
  });
  it('the narrower holds too: a Location into its Zone, a Creature into a Location or a Zone', () => {
    expect(pairWrite(side('l', 'location'), side('z', 'zone'))).toMatchObject({ on: 'l', field: 'zone' });
    expect(pairWrite(side('c', 'creature'), side('z', 'zone'))).toMatchObject({ on: 'c', field: 'zone' });
    expect(pairWrite(side('c', 'creature'), side('l', 'location'))).toMatchObject({ on: 'c', field: 'location' });
  });
});

describe('patchFor and undoPatchFor (read inside the lock)', () => {
  const single = { on: 'm', field: 'location', target: 'h', single: true };
  const list = { on: 't', field: 'events', target: 'e', single: false };
  it('writes into an empty single, and refuses one filled since the light', () => {
    expect(patchFor(single, {})).toEqual({ location: 'h' });
    expect(patchFor(single, { location: 'd' })).toBeNull();
  });
  it('appends to a list read in any shape, written back as ids', () => {
    expect(patchFor(list, { events: [{ id: 'x' }] })).toEqual({ events: ['x', 'e'] });
    expect(patchFor(list, { events: ['e'] })).toBeNull();
  });
  it('Undo clears exactly what was written, and nothing once it changed', () => {
    expect(undoPatchFor(single, { location: 'h' })).toEqual({ location: null });
    expect(undoPatchFor(single, { location: 'd' })).toBeNull();
    expect(undoPatchFor(list, { events: ['x', 'e'] })).toEqual({ events: ['x'] });
    expect(undoPatchFor(list, { events: ['x'] })).toBeNull();
  });
});
