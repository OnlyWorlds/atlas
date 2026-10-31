/**
 * Home's Strand tab and Make this the strand, read from state (`src/middle/home-strand.ts`,
 * `src/middle/strand-offer.ts`; the contract's S3, S5, S6, S7): when the tab shows, the default and its
 * memory, what a Hero or Now field holds in words, what Pick offers, and S7's one predicate.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry, type Element, type WorldRegistryEntry } from '../../src/core/types';
import {
  buildStrandPanel, chosenTab, pickRows, rawWords, resetStrandTabForTests, strandContext, strandTabShows, READ_ONLY_LINE,
} from '../../src/middle/home-strand';
import { strandOfferFor } from '../../src/middle/strand-offer';

const W = 'w-home-strand';
const N = '0192a000-0000-7000-8000-000000000a01';
const N2 = '0192a000-0000-7000-8000-000000000a02';
const E = '0192a000-0000-7000-8000-000000000b01';
const C = '0192a000-0000-7000-8000-000000000d01';
const GONE = '0192a000-0000-7000-8000-00000000ee01';
const GONE2 = '0192a000-0000-7000-8000-00000000ee02';

const el = (type: string, id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type, name: `${type}-${id.slice(-2)}`, ...extra }) as unknown as Element;

function world(elements: Element[], mark?: unknown, meta: Record<string, unknown> = {}, entry: Partial<WorldRegistryEntry> = {}): void {
  patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: W, name: 'W', state: 'local-only', ...entry } as WorldRegistryEntry] });
  patchSlice('active', { worldId: W, meta: { id: W, name: 'W', ...(mark !== undefined ? { x_strand: mark } : {}), ...meta } } as never);
  patchSlice('data', { elements, loading: false } as never);
}
const contributor = { exported_as: { kind: 'member', role: 'contributor' } };
const full = { narrative: N, event: GONE, location: GONE2 };

afterEach(() => {
  resetStrandTabForTests();
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
  patchSlice('data', { elements: [] } as never);
  document.body.innerHTML = '';
});

describe('the tab (S3, S5, G16)', () => {
  it('a keeper gets the tab on an empty strand; a contributor does not, until there is a strand', () => {
    world([el('narrative', N)]);
    expect(strandTabShows(W)).toBe(true);
    world([el('narrative', N)], undefined, contributor);
    expect(strandTabShows(W)).toBe(false);
    world([el('narrative', N)], full, contributor);
    expect(strandTabShows(W)).toBe(true);
  });

  it('a view-only world: no tab without a strand, the strand read-only with one', () => {
    world([el('narrative', N)], undefined, {}, { copy_of: { world_id: 'x' } } as never);
    expect(strandTabShows(W)).toBe(false);
    world([el('narrative', N)], full, {}, { copy_of: { world_id: 'x' } } as never);
    expect(strandTabShows(W)).toBe(true);
    const panel = buildStrandPanel(W, { alone: false, redraw: () => {} });
    expect(panel.querySelector('[data-role="strand-read-only"]')?.textContent).toBe(READ_ONLY_LINE);
    expect(panel.querySelectorAll('[data-act]').length).toBe(0);
  });

  it('Strand by default when the story box is filled, else Picture; the first draw is kept as if pressed', () => {
    world([el('narrative', N)], full);
    expect(chosenTab(W)).toBe('strand');
    resetStrandTabForTests();
    world([el('narrative', N)]);
    expect(chosenTab(W)).toBe('picture');
    // A pull fills the story: the tab drawn stays.
    world([el('narrative', N)], full);
    expect(chosenTab(W)).toBe('picture');
  });
});

describe('the boxes (S6)', () => {
  it('five boxes in the story\'s order; an empty parent says what its box waits for', () => {
    world([el('narrative', N)]);
    const panel = buildStrandPanel(W, { alone: true, redraw: () => {} });
    expect([...panel.querySelectorAll('[data-slot]')].map(b => b.getAttribute('data-slot'))).toEqual(['narrative', 'event', 'location', 'character', 'now']);
    expect(panel.querySelector('h2')?.textContent).toBe('Strand');
    expect(panel.querySelector('[data-slot="event"]')?.textContent).toContain('After the story');
    expect(panel.querySelector('[data-slot="now"]')?.textContent).toContain('After the hero');
    expect([...panel.querySelectorAll('[data-slot="narrative"] [data-act]')].map(b => b.textContent)).toEqual(['Make one', 'Pick from the world']);
    expect(panel.querySelectorAll('[data-slot="event"] [data-act]').length).toBe(0);
    // Every icon is decoration.
    for (const icon of panel.querySelectorAll('.material-symbols-outlined')) expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  it('a Hero field holding what the strand does not read says what it holds (G8)', () => {
    const proposed = el('character', C, { x_review_proposed: { by: 'm', evidence: 'seat' }, name: 'Mira' });
    world([el('narrative', N, { protagonist: C }), proposed], full);
    expect(rawWords('character', strandContext(W)!)).toBe('Proposed: Mira');
    world([el('narrative', N, { protagonist: GONE })], full);
    expect(rawWords('character', strandContext(W)!)).toBe('An id that names nothing here');
    world([el('narrative', N, { protagonist: C }), el('character', C, { hidden: true, name: 'Ana' })], full);
    // A hidden hero is still the owner's to read: filled, so nothing held apart.
    expect(rawWords('character', strandContext(W)!)).toBeNull();
    const panel = buildStrandPanel(W, { alone: false, redraw: () => {} });
    expect(panel.querySelector('[data-slot="character"] [data-role="hidden-word"]')).not.toBeNull();
  });

  it('Pick offers that kind only, the parent\'s own first; never a proposed one, a stub or a room element (G12)', () => {
    world([
      el('narrative', N, { events: [E] }),
      el('event', E, { name: 'Zed' }),
      el('event', '0192a000-0000-7000-8000-000000000b02', { name: 'Alpha' }),
      el('event', '0192a000-0000-7000-8000-000000000b03', { known_of: true }),
      el('event', '0192a000-0000-7000-8000-000000000b04', { x_review_proposed: { by: 'm', evidence: 'seat' } }),
      el('event', '0192a000-0000-7000-8000-000000000b05', { supertype: 'Sitting', x_room_of: 'w' }),
    ], full);
    const rows = pickRows('event', strandContext(W)!);
    expect(rows.ownWord).toBe('In this story');
    expect(rows.own.map(e => e.id)).toEqual([E]);
    expect(rows.rest.map(e => e.name)).toEqual(['Alpha']);
  });
});

describe('Make this the world\'s strand (S7)', () => {
  it('a keeper on a story: make; "instead of" another; "is" on the strand\'s own', () => {
    world([el('narrative', N), el('narrative', N2, { name: 'Second' })]);
    expect(strandOfferFor(el('narrative', N), W)).toEqual({ kind: 'make', instead: null });
    world([el('narrative', N, { name: 'First' }), el('narrative', N2)], full);
    expect(strandOfferFor(el('narrative', N2), W)).toEqual({ kind: 'make', instead: 'First' });
    expect(strandOfferFor(el('narrative', N), W)).toEqual({ kind: 'is' });
  });

  it('never on a proposed Narrative, a stub or a room element; a chapter yes; never for a contributor or a view-only world', () => {
    world([]);
    expect(strandOfferFor(el('narrative', N, { x_review_proposed: { by: 'm', evidence: 'seat' } }), W)).toBeNull();
    expect(strandOfferFor(el('narrative', N, { known_of: true }), W)).toBeNull();
    expect(strandOfferFor(el('narrative', N, { supertype: 'Message', x_room_of: 'w' }), W)).toBeNull();
    expect(strandOfferFor(el('event', E), W)).toBeNull();
    expect(strandOfferFor(el('narrative', N, { parent_narrative: N2 }), W)).toEqual({ kind: 'make', instead: null });
    world([], undefined, contributor);
    expect(strandOfferFor(el('narrative', N), W)).toBeNull();
    world([], undefined, {}, { copy_of: { world_id: 'x' } } as never);
    expect(strandOfferFor(el('narrative', N), W)).toBeNull();
  });
});
