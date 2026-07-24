import { describe, it, expect } from 'vitest';
import { computeLooseThreads } from '../../src/middle/home-loose-threads';
import type { Element } from '../../src/core/types';

/** Minimal element factory — only the fields the compute reads. */
function el(type: string, id: string, extra: Record<string, unknown> = {}): Element {
  return { id, type, name: id, ...extra } as unknown as Element;
}

describe('computeLooseThreads', () => {
  it('flags only the genuine gaps, per class, precisely', () => {
    const elements: Element[] = [
      // Characters: one referenced by a title, one referenced by nothing.
      el('character', 'char-linked'),
      el('character', 'char-lonely'),
      el('title', 'title-1', { characters: ['char-linked'] }),
      // Locations: one placed by a pin, one not.
      el('location', 'loc-mapped'),
      el('location', 'loc-unmapped'),
      el('pin', 'pin-1', { element_id: 'loc-mapped', map: 'map-1' }),
      // Events: one dated, one not.
      el('event', 'ev-dated', { start_date: 12 }),
      el('event', 'ev-undated'),
    ];

    const threads = computeLooseThreads(elements);
    const byKey = Object.fromEntries(threads.map(t => [t.key, t.elements.map(e => e.id)]));

    expect(byKey['unmapped-locations']).toEqual(['loc-unmapped']);
    expect(byKey['undated-events']).toEqual(['ev-undated']);
    expect(byKey['unlinked-characters']).toEqual(['char-lonely']);
    // The mapped location, dated event, and linked character are NOT flagged.
    expect(threads.flatMap(t => t.elements.map(e => e.id))).not.toContain('loc-mapped');
    expect(threads.flatMap(t => t.elements.map(e => e.id))).not.toContain('ev-dated');
    expect(threads.flatMap(t => t.elements.map(e => e.id))).not.toContain('char-linked');
  });

  it('returns no threads for a fully woven world', () => {
    const elements: Element[] = [
      el('character', 'c1'),
      el('title', 't1', { characters: ['c1'] }),
      el('location', 'l1'),
      el('pin', 'p1', { element_id: 'l1' }),
      el('event', 'e1', { start_date: 1 }),
    ];
    expect(computeLooseThreads(elements)).toEqual([]);
  });

  it('does not count a self-reference as being linked', () => {
    // A character whose own field happens to hold its own id is still unlinked.
    const elements: Element[] = [el('character', 'c-self', { rival: 'c-self' })];
    const threads = computeLooseThreads(elements);
    expect(threads.find(t => t.key === 'unlinked-characters')?.elements.map(e => e.id)).toEqual(['c-self']);
  });
});
