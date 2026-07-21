/**
 * `roomOf` — the one answer three surfaces ask (the palette, the elements
 * sidebar, the home desk). It exists because those three had drifted: two of
 * them navigated with a bare element hash and dropped every room-owning
 * element into the generic field editor (S306).
 *
 * Pure, so it is cheap to pin — which is exactly why the divergence it
 * replaced was able to survive as long as it did.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Element } from '../../src/core/types';

vi.mock('../../src/middle/writing-helpers', () => ({
  // Writing membership is a per-world label question owned by writing-helpers;
  // stubbed so this file tests the ROUTING RULE, not the tier model.
  isWritingNarrative: (el: Element) =>
    (el as Element & { supertype?: string }).supertype === 'Chapter',
}));
vi.mock('../../src/tabs/right/map-index-tab', () => ({ openMapTab: vi.fn() }));

const { roomOf } = await import('../../src/core/element-room');

const W = 'world-1';
const el = (over: Partial<Element> & { type: string }): Element =>
  ({ id: 'e1', name: 'thing', ...over } as unknown as Element);

describe('roomOf', () => {
  it('sends a knowledge narrative to the knowledge room', () => {
    const r = roomOf(el({ type: 'narrative', subtype: 'knowledge' }), W);
    expect(r.label).toBe('knowledge');
    expect(r.hash).toContain('/knowledge/');
  });

  it('sends a page narrative to the share room', () => {
    const r = roomOf(el({ type: 'narrative', subtype: 'page' }), W);
    expect(r.label).toBe('share');
    expect(r.hash).toContain('/share/');
  });

  it('sends a writing narrative to the writing room', () => {
    const r = roomOf(el({ type: 'narrative', supertype: 'Chapter' }), W);
    expect(r.label).toBe('writing');
    expect(r.hash).toContain('/writing/');
  });

  it('sends a map to its map route', () => {
    const r = roomOf(el({ type: 'map' }), W);
    expect(r.label).toBe('map');
    expect(r.hash).toContain('/map/');
  });

  it('subtype WINS over writing supertype (knowledge/page take precedence)', () => {
    // Not academic: `isWritingNarrative` tests SUPERTYPE while the knowledge and
    // page predicates test SUBTYPE, and subtype is free user text — so one
    // narrative can satisfy both. The precedence has to be pinned, because a
    // caller that labels the row from its own finder (the home desk's pinned
    // "Write" row did) will otherwise promise a room the click does not open.
    const r = roomOf(el({ type: 'narrative', supertype: 'Chapter', subtype: 'knowledge' }), W);
    expect(r.label).toBe('knowledge');
  });

  it('everything else falls to the generic element view', () => {
    const types: Array<Element['type']> = ['character', 'location', 'zone', 'event', 'relation'];
    for (const type of types) {
      const r = roomOf(el({ type }), W);
      expect(r.label, `${type} should be generic`).toBe('');
      expect(r.hash).toContain('/element/');
    }
  });

  it('a supertype-less story narrative stays generic (it is not in the writing tree)', () => {
    // Routing it to the writing room would land on the "pick a Book" empty
    // state, because the tree index filters on the same predicate.
    const r = roomOf(el({ type: 'narrative' }), W);
    expect(r.label).toBe('');
  });
});
