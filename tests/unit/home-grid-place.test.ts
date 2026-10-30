/**
 * The home grid's write, read from state: a known-of stub is never a write's
 * end (the code gate's C2), and the "just now" line holds only while its field
 * still says what it wrote (C5).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { patchSlice } from '../../src/core/state';
import type { Element } from '../../src/core/types';
import { justNowIn, resetJustNowForTests, setJustNowForTests, writeBetween } from '../../src/ui/home-grid-place';

const mira = (extra: Record<string, unknown> = {}) => ({ id: 'm', type: 'character', name: 'Mira', ...extra }) as unknown as Element;
const harbour = (extra: Record<string, unknown> = {}) => ({ id: 'h', type: 'location', name: 'The Harbour', ...extra }) as unknown as Element;
const docks = { id: 'd', type: 'location', name: 'The Docks' } as unknown as Element;
const world = (elements: Element[]) => {
  patchSlice('active', { worldId: 'w', meta: { name: 'W' } } as never);
  patchSlice('data', { elements, loading: false } as never);
};

afterEach(() => { resetJustNowForTests(); patchSlice('active', null); });

describe('writeBetween', () => {
  it('a Location and a Character write the Character\'s place', () => {
    world([mira(), harbour()]);
    expect(writeBetween('m', 'h')).toMatchObject({ on: 'm', field: 'location', target: 'h' });
  });
  it('a known-of stub at either end is no write', () => {
    world([mira(), harbour({ known_of: true })]);
    expect(writeBetween('m', 'h')).toBeNull();
    world([mira({ known_of: true }), harbour()]);
    expect(writeBetween('h', 'm')).toBeNull();
  });
});

describe('justNowIn', () => {
  const write = { on: 'm', field: 'location', target: 'h', single: true, holds: true };
  it('holds while the field still says what it wrote, and goes once it moved', () => {
    world([mira({ location: 'h' }), harbour(), docks]);
    setJustNowForTests({ worldId: 'w', write, sentence: 'Mira is in The Harbour' });
    expect(justNowIn('w')?.sentence).toBe('Mira is in The Harbour');
    world([mira({ location: 'd' }), harbour(), docks]);
    expect(justNowIn('w')).toBeNull();
  });
  it('another world never reads it', () => {
    world([mira({ location: 'h' }), harbour()]);
    setJustNowForTests({ worldId: 'w', write, sentence: 'x' });
    expect(justNowIn('other')).toBeNull();
  });
  it('names the latest act only: an element made or gone since takes it away', () => {
    world([mira({ location: 'h' }), harbour(), docks]);
    setJustNowForTests({ worldId: 'w', write, sentence: 'Mira is in The Harbour' });
    world([mira({ location: 'h' }), harbour(), docks, { ...docks, id: 'n', name: 'New' }]);
    expect(justNowIn('w')).toBeNull();
    world([mira({ location: 'h' }), harbour(), docks]);
    setJustNowForTests({ worldId: 'w', write, sentence: 'Mira is in The Harbour' });
    world([mira({ location: 'h' }), harbour()]);
    expect(justNowIn('w')).toBeNull();
  });
  it('says the names as they are now', () => {
    world([mira({ location: 'h' }), harbour()]);
    setJustNowForTests({ worldId: 'w', write, sentence: 'Mira is in The Harbour' });
    world([mira({ location: 'h', name: 'Mira Vane' }), harbour()]);
    expect(justNowIn('w')?.sentence).toBe('Mira Vane is in The Harbour');
  });
});
