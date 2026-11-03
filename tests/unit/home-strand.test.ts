/**
 * Home's Strand tab and Make this the strand, read from state (`src/middle/home-strand.ts` and its
 * parts, `src/middle/strand-offer.ts`; Atlas 1.120.0, the strand as a journey): the tab head as a Home
 * opening decides it (R1) and its latch, the reveal for each role with Skip for now and Add (R2), the
 * cards and their memory (R3), the boxes, their lines, Edit and the ⋯ (R5, R7), the whole line (R8),
 * what a Character or Now field holds, Pick, and the frame's Pick on Home.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry, type Element, type WorldRegistryEntry } from '../../src/core/types';
import {
  buildStrandPanel, chosenTab, notePictureShown, openStrandTab, pickRows, rawHeld, rawWords, resetStrandTabForTests, strandContext,
  settleStrandFocus, strandHeadShows, strandTabShows, StrandHeadLatch, READ_ONLY_LINE, SLOT_WORD,
} from '../../src/middle/home-strand';
import { strandOfferFor } from '../../src/middle/strand-offer';
import { buildStrandFrame } from '../../src/tabs/right/context-strand-frame';
import { escapeOwned } from '../../src/core/escape-mark';
import { GRID_OPEN_ATTR } from '../../src/middle/home-grid-kinds';

const W = 'w-home-strand';
const W2 = 'w-home-strand-other';
const N = '0192a000-0000-7000-8000-000000000a01';
const N2 = '0192a000-0000-7000-8000-000000000a02';
const E = '0192a000-0000-7000-8000-000000000b01';
const L = '0192a000-0000-7000-8000-000000000c01';
const L2 = '0192a000-0000-7000-8000-000000000c02';
const C = '0192a000-0000-7000-8000-000000000d01';
const X = '0192a000-0000-7000-8000-000000000f01';
const GONE = '0192a000-0000-7000-8000-00000000ee01';
const GONE2 = '0192a000-0000-7000-8000-00000000ee02';

const el = (type: string, id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type, name: `${type}-${id.slice(-2)}`, ...extra }) as unknown as Element;

function world(elements: Element[], mark?: unknown, meta: Record<string, unknown> = {}, entry: Partial<WorldRegistryEntry> = {}, id = W): void {
  patchSlice('registry', { ...defaultRegistry(), worlds: [{ id, name: 'W', state: 'local-only', ...entry } as WorldRegistryEntry] });
  patchSlice('active', { worldId: id, meta: { id, name: 'W', ...(mark !== undefined ? { x_strand: mark } : {}), ...meta } } as never);
  patchSlice('data', { elements, loading: false } as never);
}
const contributor = { exported_as: { kind: 'member', role: 'contributor' } };
const viewOnly = { copy_of: { world_id: 'x' } } as never;
const full = { narrative: N, event: GONE, location: GONE2 };
const whole = (): Element[] => [
  el('narrative', N, { events: [E], protagonist: C }), el('event', E, { locations: [L], characters: [C] }),
  el('location', L, { name: 'The Quay' }), el('location', L2, { name: 'The Library' }), el('character', C, { location: L2, name: 'Odile' }),
];
/** A story and its main character, no event yet: the Event card is the one asked (1.121.0). */
const withHero = (...more: Element[]): Element[] => [el('narrative', N, { protagonist: C }), el('character', C, { name: 'Odile' }), ...more];

let host: HTMLElement;
function draw(): HTMLElement {
  if (!host) { host = document.createElement('div'); document.body.appendChild(host); }
  host.innerHTML = '';
  const panel = buildStrandPanel(W, { alone: false, redraw: draw });
  host.appendChild(panel);
  return panel;
}
const cellOf = (slot: string) => host.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
const cards = () => [...host.querySelectorAll<HTMLElement>('[data-role="strand-card"]')];
/** What a reader hears: the text without the icons (aria-hidden ligatures). */
const spoken = (node: Node): string => {
  const copy = node.cloneNode(true) as HTMLElement;
  for (const icon of copy.querySelectorAll('[aria-hidden="true"]')) icon.remove();
  return copy.textContent ?? '';
};
const typeIn = (input: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

afterEach(() => {
  resetStrandTabForTests();
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
  patchSlice('data', { elements: [] } as never);
  document.body.innerHTML = '';
  host = undefined as unknown as HTMLElement;
});

describe('R1: the tab head, as a Home opening decides it', () => {
  const head = () => strandHeadShows(strandContext(W)!);
  const states: Record<string, () => [Element[], unknown]> = {
    empty: () => [[], undefined],
    'bodies only': () => [[el('narrative', N)], full],
    established: () => [[el('narrative', N), el('character', X)], undefined],
    partial: () => [[el('narrative', N), el('character', X)], full],
    whole: () => [whole(), { narrative: N, event: E, location: L }],
  };
  const roles: Record<string, { meta?: Record<string, unknown>; entry?: Partial<WorldRegistryEntry>; want: Record<string, boolean> }> = {
    owner: { want: { empty: false, 'bodies only': false, established: true, partial: true, whole: true } },
    'co-builder': { meta: { exported_as: { kind: 'member', role: 'co_builder' } }, want: { empty: false, 'bodies only': false, established: true, partial: true, whole: true } },
    'linked co-builder': {
      entry: { state: 'api-linked', api: { world_id: 'a', api_key: 'k', member_role: 'co_builder' } } as never,
      want: { empty: false, 'bodies only': false, established: true, partial: true, whole: true },
    },
    contributor: { meta: contributor, want: { empty: false, 'bodies only': false, established: false, partial: true, whole: true } },
    'view-only': { entry: viewOnly, want: { empty: false, 'bodies only': false, established: false, partial: true, whole: true } },
  };
  for (const [role, r] of Object.entries(roles)) {
    for (const [state, make] of Object.entries(states)) {
      it(`${role}, ${state}: ${r.want[state] ? 'a head' : 'no head'}`, () => {
        const [els, mark] = make();
        world(els, mark, r.meta ?? {}, r.entry ?? {});
        expect(head()).toBe(r.want[state]);
      });
    }
  }

  it('the latch: a make during the visit adds no head; Home opened again, or another world, reads afresh', () => {
    const latch = new StrandHeadLatch();
    world([]);
    expect(latch.read(strandContext(W)!)).toBe('alone');
    // The story made, its mark not yet written: an element outside the strand for a moment.
    world([el('narrative', N)]);
    expect(latch.read(strandContext(W)!)).toBe('alone');
    // Made in the sidebar mid-journey: still none this visit.
    world([el('narrative', N), el('character', X)], full);
    expect(latch.read(strandContext(W)!)).toBe('alone');
    expect(new StrandHeadLatch().read(strandContext(W)!)).toBe('head');
    world([], undefined, {}, {}, W2);
    expect(latch.read(strandContext(W2)!)).toBe('alone');
  });

  it('the latch: an established world keeps its head through a strand made whole or cleared', () => {
    const latch = new StrandHeadLatch();
    world([el('narrative', N), el('character', X)]);
    expect(latch.read(strandContext(W)!)).toBe('head');
    world([el('narrative', N)]);
    expect(latch.read(strandContext(W)!)).toBe('head');
  });

  it('C3: the whole shape holds for the visit: a view-only world\'s pull takes its strand, the head stays; a contributor\'s pull gives one, no head comes', () => {
    const latch = new StrandHeadLatch();
    world([el('narrative', N), el('character', X)], full, {}, viewOnly);
    expect(latch.read(strandContext(W)!)).toBe('head');
    // The pull takes the mark away: nothing here to show or write, and still the head this visit.
    world([el('narrative', N), el('character', X)], undefined, {}, viewOnly);
    expect(strandTabShows(W)).toBe(false);
    expect(latch.read(strandContext(W)!)).toBe('head');
    expect(new StrandHeadLatch().read(strandContext(W)!)).toBe('picture');

    const other = new StrandHeadLatch();
    world([el('narrative', N), el('character', X)], undefined, contributor);
    expect(other.read(strandContext(W)!)).toBe('picture');
    // The owner sets a strand elsewhere and the pull lands: the picture stays the visit's.
    world([el('narrative', N), el('character', X)], full, contributor);
    expect(strandTabShows(W)).toBe(true);
    expect(other.read(strandContext(W)!)).toBe('picture');
    expect(new StrandHeadLatch().read(strandContext(W)!)).toBe('head');
  });

  it('the whole line\'s Picture reveals the head on a press, only for the world read', () => {
    let redraws = 0;
    const latch = new StrandHeadLatch(() => { redraws++; });
    world([]);
    expect(latch.read(strandContext(W)!)).toBe('alone');
    latch.reveal(W2);
    expect(redraws).toBe(0);
    latch.reveal(W);
    expect(latch.read(strandContext(W)!)).toBe('head');
    expect(redraws).toBe(1);
  });
});

describe('the tab (S3, G16)', () => {
  it('a keeper gets the tab on an empty strand; a contributor does not, until there is a strand', () => {
    world([el('narrative', N)]);
    expect(strandTabShows(W)).toBe(true);
    world([el('narrative', N)], undefined, contributor);
    expect(strandTabShows(W)).toBe(false);
    world([el('narrative', N)], full, contributor);
    expect(strandTabShows(W)).toBe(true);
  });

  it('a view-only world: no tab without a strand, the strand read-only with one, no card, Edit or menu', () => {
    world([el('narrative', N)], undefined, {}, viewOnly);
    expect(strandTabShows(W)).toBe(false);
    world(whole(), { narrative: N, event: E, location: L }, {}, viewOnly);
    expect(strandTabShows(W)).toBe(true);
    const panel = draw();
    expect(panel.querySelector('[data-role="strand-read-only"]')?.textContent).toBe(READ_ONLY_LINE);
    // Only each box's doors (1.122.0: Open its page, a room's), which navigate and never write; no line.
    expect(panel.querySelectorAll('[data-act]:not([data-act="room"]):not([data-act="page"])').length).toBe(0);
    expect(panel.querySelectorAll('[data-act="page"]').length).toBe(5);
    expect(panel.querySelectorAll('[data-role="strand-line"]').length).toBe(0);
    expect(cards()).toHaveLength(0);
    expect(panel.querySelectorAll('[data-box]').length).toBe(5);
  });

  it('Strand by default when the story box is filled, else Picture; the first draw is kept as if pressed', () => {
    world([el('narrative', N), el('character', X)], full);
    expect(chosenTab(W)).toBe('strand');
    resetStrandTabForTests();
    world([el('narrative', N), el('character', X)]);
    expect(chosenTab(W)).toBe('picture');
    world([el('narrative', N), el('character', X)], full);
    expect(chosenTab(W)).toBe('picture');
  });
});

describe('R2: the reveal', () => {
  it('an owner\'s empty world: the story\'s card alone; every other cell empty, hidden from the reader, in its place', () => {
    world([]);
    const panel = draw();
    expect([...panel.querySelectorAll('[data-slot]')].map(b => b.getAttribute('data-slot'))).toEqual(['narrative', 'event', 'location', 'character', 'now']);
    expect(cards().map(c => c.getAttribute('data-card-slot'))).toEqual(['narrative']);
    expect(cards()[0].querySelector('.atlas-home-strand-card-title > span:last-child')?.textContent).toBe('Start with a story');
    for (const s of ['event', 'location', 'character', 'now']) {
      expect(cellOf(s).getAttribute('aria-hidden')).toBe('true');
      expect(cellOf(s).childElementCount).toBe(0);
    }
    // The story's card has no Skip, and no Pick where nothing can be picked (S8).
    expect([...cards()[0].querySelectorAll('[data-act]')].map(b => b.getAttribute('data-act'))).toEqual(['make']);
    for (const icon of panel.querySelectorAll('.material-symbols-outlined')) expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  it('with a story: the main character asked next (1.121.0), the Event not yet drawn', () => {
    world([el('narrative', N, { name: 'The Ferry' })], full);
    draw();
    expect(cards().map(c => c.getAttribute('data-card-slot'))).toEqual(['character']);
    expect(cards()[0].querySelector('.atlas-home-strand-card-title > span:last-child')?.textContent).toBe('Who is the story about?');
    expect(cellOf('narrative').querySelector('[data-box="narrative"]')).not.toBeNull();
    expect(cellOf('event').childElementCount).toBe(0);
    expect([...cards()[0].querySelectorAll('[data-act]')].map(b => b.getAttribute('data-act'))).toEqual(['make', 'skip']);
  });

  it('with a story and its main character: the Event asked next, in the story\'s words (W1)', () => {
    world(withHero(), full);
    draw();
    expect(cards().map(c => c.getAttribute('data-card-slot'))).toEqual(['event']);
    expect(cards()[0].querySelector('.atlas-home-strand-card-title > span:last-child')?.textContent).toBe('What happens in narrative-01?');
    expect(cellOf('location').childElementCount).toBe(0);
  });

  it('a contributor on a strand: the main character asked, in words with no event', () => {
    world([el('narrative', N, { name: 'The Ferry' })], full, contributor);
    draw();
    expect(cards().map(c => c.getAttribute('data-card-slot'))).toEqual(['character']);
    expect(cards()[0].querySelector('.atlas-home-strand-card-title > span:last-child')?.textContent).toBe('Who is the story about?');
  });

  it('Skip for now sets a slot aside behind "Add <slot>", and Add asks it again', () => {
    world([el('narrative', N)], full);
    draw();
    expect(cards().map(c => c.getAttribute('data-card-slot'))).toEqual(['character']);
    cards()[0].querySelector<HTMLButtonElement>('[data-act="skip"]')!.click();
    // The main character skipped: the Event is asked, in words with no character.
    expect(cards().map(c => c.getAttribute('data-card-slot'))).toEqual(['event']);
    expect(cards()[0].querySelector('.atlas-home-strand-card-title > span:last-child')?.textContent).toBe('What happens in narrative-01?');
    const add = cellOf('character').querySelector<HTMLButtonElement>('[data-act="add"]')!;
    expect(add.textContent).toBe('Add character');
    expect(cellOf('location').childElementCount).toBe(0);
    cards()[0].querySelector<HTMLButtonElement>('[data-act="skip"]')!.click();
    // The place needs the event, where they are now the character: nothing more to ask.
    expect(cards()).toHaveLength(0);
    expect(cellOf('event').querySelector('[data-act="add"]')!.textContent).toBe('Add event');
    cellOf('event').querySelector<HTMLButtonElement>('[data-act="add"]')!.click();
    expect(cards().map(c => c.getAttribute('data-card-slot'))).toEqual(['event']);
    add.isConnected ? add.click() : cellOf('character').querySelector<HTMLButtonElement>('[data-act="add"]')!.click();
    expect(cards().map(c => c.getAttribute('data-card-slot'))).toEqual(['character']);
  });

  it('C5: Skip for now on the last card it can ask: the focus goes to that slot\'s Add, never the page', () => {
    world([el('narrative', N)], full);
    draw();
    cards()[0].querySelector<HTMLButtonElement>('[data-act="skip"]')!.click();
    settleStrandFocus(host, null);
    expect(document.activeElement).toBe(cards()[0].querySelector('[data-field="name"]'));
    cards()[0].querySelector<HTMLButtonElement>('[data-act="skip"]')!.click();
    expect(cards()).toHaveLength(0);
    settleStrandFocus(host, null);
    // The last card asked is the Event's (1.121.0): the focus goes to Add event.
    expect(document.activeElement).toBe(cellOf('event').querySelector('[data-act="add"]'));
  });

  it('the frame\'s Pick on Home asks its slot out of order, its Name the focus asked for', () => {
    world([el('narrative', N)], full);
    openStrandTab(W, 'character');
    draw();
    expect(cards().map(c => c.getAttribute('data-card-slot'))).toEqual(['character']);
  });

  it('a world switch clears the skips and the asks', () => {
    world([el('narrative', N)], full);
    draw();
    cards()[0].querySelector<HTMLButtonElement>('[data-act="skip"]')!.click();
    expect(cellOf('character').querySelector('[data-act="add"]')).not.toBeNull();
    world([], undefined, {}, {}, W2);
    world([el('narrative', N)], full);
    draw();
    expect(cards().map(c => c.getAttribute('data-card-slot'))).toEqual(['character']);
  });
});

describe('R3: the cards and their memory', () => {
  it('what was typed survives every redraw; Escape empties the card, keeps the focus in Name and is owned', () => {
    world(withHero(), full);
    draw();
    expect(cards()[0].getAttribute('data-card-slot')).toBe('event');
    typeIn(cards()[0].querySelector<HTMLInputElement>('[data-field="name"]')!, 'The night crossing');
    typeIn(cards()[0].querySelector<HTMLTextAreaElement>('[data-field="text"]')!, 'A storm.\nThe ferry went.');
    typeIn(cards()[0].querySelector<HTMLInputElement>('[data-field="when"]')!, '1142');
    // A pull: a new elements array, the panel built again.
    world(withHero(el('character', X)), full);
    draw();
    const card = cards()[0];
    expect(card.querySelector<HTMLInputElement>('[data-field="name"]')!.value).toBe('The night crossing');
    expect(card.querySelector<HTMLTextAreaElement>('[data-field="text"]')!.value).toBe('A storm.\nThe ferry went.');
    expect(card.querySelector<HTMLInputElement>('[data-field="when"]')!.value).toBe('1142');
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    card.querySelector<HTMLTextAreaElement>('[data-field="text"]')!.dispatchEvent(esc);
    expect(escapeOwned(esc)).toBe(true);
    expect(card.querySelector<HTMLInputElement>('[data-field="name"]')!.value).toBe('');
    expect(document.activeElement).toBe(card.querySelector('[data-field="name"]'));
    draw();
    expect(cards()[0].querySelector<HTMLTextAreaElement>('[data-field="text"]')!.value).toBe('');
  });

  it('a world switch clears what was typed', () => {
    world([el('narrative', N)], full);
    draw();
    typeIn(cards()[0].querySelector<HTMLInputElement>('[data-field="name"]')!, 'Typed');
    world([], undefined, {}, {}, W2);
    world([el('narrative', N)], full);
    draw();
    expect(cards()[0].querySelector<HTMLInputElement>('[data-field="name"]')!.value).toBe('');
  });

  it('the card holds Home\'s redraws only while the focus is inside it', () => {
    world([el('narrative', N)], full);
    draw();
    const card = cards()[0];
    expect(card.hasAttribute(GRID_OPEN_ATTR)).toBe(false);
    card.querySelector<HTMLInputElement>('[data-field="name"]')!.focus();
    expect(card.hasAttribute(GRID_OPEN_ATTR)).toBe(true);
    // A press outside lets go.
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(card.hasAttribute(GRID_OPEN_ATTR)).toBe(false);
  });

  it('an empty name is asked for; a When that is not a whole number is said', () => {
    world(withHero(), full);
    draw();
    const card = cards()[0] as HTMLFormElement;
    expect(card.getAttribute('data-card-slot')).toBe('event');
    card.requestSubmit();
    expect(card.querySelector('[data-role="strand-card-note"]')!.textContent).toBe('Type a name first');
    typeIn(card.querySelector<HTMLInputElement>('[data-field="name"]')!, 'X');
    card.querySelector<HTMLInputElement>('[data-field="when"]')!.value = '1.5';
    card.requestSubmit();
    expect(card.querySelector('[data-role="strand-card-note"]')!.textContent).toBe('When is a whole number.');
    // C9: a letter in a number input reads '' in the browser; its validity says it was no number.
    card.querySelector<HTMLElement>('[data-role="strand-card-note"]')!.textContent = '';
    const when = card.querySelector<HTMLInputElement>('[data-field="when"]')!;
    when.value = '';
    Object.defineProperty(when, 'validity', { value: { badInput: true }, configurable: true });
    card.requestSubmit();
    expect(card.querySelector('[data-role="strand-card-note"]')!.textContent).toBe('When is a whole number.');
  });

  it('a held Character field: the card says what it holds, and Make says its promise first', () => {
    const proposed = el('character', C, { x_review_proposed: { by: 'm', evidence: 'seat' }, name: 'Mira' });
    world([el('narrative', N, { protagonist: C }), proposed], full, contributor);
    draw();
    const card = cards()[0];
    expect(card.getAttribute('data-card-slot')).toBe('character');
    expect(card.querySelector('[data-role="strand-held"]')!.textContent).toBe('Proposed: Mira');
    typeIn(card.querySelector<HTMLInputElement>('[data-field="name"]')!, 'Odile');
    (card as HTMLFormElement).requestSubmit();
    expect(host.querySelector('[data-role="strand-promise"]')!.textContent).toBe('Odile will be the main character in place of the proposed Mira.');
    // The typed fields are kept behind the promise.
    expect(cards()[0].querySelector<HTMLInputElement>('[data-field="name"]')!.value).toBe('Odile');
  });

  it('a held field holding another kind is said with its kind, and a pick\'s promise names it in lower case (C5)', () => {
    world([el('narrative', N, { protagonist: L }), el('location', L, { name: 'The Harbour' }), el('character', C, { name: 'Ilse' })], full, contributor);
    expect(rawHeld('character', strandContext(W)!)).toEqual({ label: 'A location: The Harbour', phrase: 'a location, The Harbour' });
    draw();
    expect(cards()[0].querySelector('[data-role="strand-held"]')!.textContent).toBe('A location: The Harbour');
    cards()[0].querySelector<HTMLButtonElement>('[data-act="pick"]')!.click();
    [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(o => o.textContent === 'Ilse')!.click();
    expect(host.querySelector('[data-role="strand-promise"]')!.textContent).toBe('Ilse will be the main character in place of a location, The Harbour.');
  });
});

describe('R5, R7, R8: the boxes', () => {
  it('a whole strand: four boxes, the story\'s two lines with "still", the same place as one line, the whole line', () => {
    world(whole().map(e => (e.id === C ? { ...e, location: L } as Element : e)), { narrative: N, event: E, location: L });
    const panel = draw();
    expect(panel.querySelectorAll('[data-box]').length).toBe(4);
    const lines = [...panel.querySelectorAll('[data-role="strand-lines"] p')].map(spoken);
    expect(lines).toEqual([`It tells of event-01, which happened in or at The Quay.`, 'Its main character is Odile, still in or at The Quay.']);
    expect(cellOf('now').querySelector('[data-role="strand-same"] p')!.textContent).toBe('is still in or at The Quay');
    expect(cellOf('location').querySelector('[data-role="strand-join"]')!.textContent).toBe('happened in or at');
    expect(panel.querySelector('[data-role="strand-whole"]')!.textContent).toBe("narrative-01 is whole. Your world's picture is on the Picture tab, and the Web draws these links among everything else you make.");
    expect(panel.querySelector('[data-role="strand-whole"]')!.getAttribute('tabindex')).toBe('-1');
  });

  it('the story\'s one line keeps the second\'s room only while it can still come (the code gate\'s C7)', () => {
    const room = () => host.querySelectorAll('[data-role="strand-lines"] .atlas-home-strand-lines-room').length;
    // The owner, the event still to ask: kept.
    world(withHero(), full);
    draw();
    expect(host.querySelectorAll('[data-role="strand-lines"] p:not([aria-hidden])').length).toBe(1);
    expect(room()).toBe(1);
    // The same strand, its event skipped: no room kept for a line that will not come.
    cards()[0].querySelector<HTMLButtonElement>('[data-act="skip"]')!.click();
    draw();
    expect(room()).toBe(0);
    resetStrandTabForTests();
    // A view-only reader of the same half strand: none either.
    world(withHero(), full, {}, viewOnly);
    draw();
    expect(room()).toBe(0);
    // A 1.120 half (the event, no character yet), the owner: kept for the character's line.
    world([el('narrative', N, { events: [E] }), el('event', E, { name: 'The Flood' })], { narrative: N, event: E, location: GONE2 });
    draw();
    expect(room()).toBe(1);
  });

  it('two places: "now in or at", the join word in the Now cell, the Now box with its own ⋯', () => {
    world(whole(), { narrative: N, event: E, location: L });
    draw();
    expect(spoken(host.querySelectorAll('[data-role="strand-lines"] p')[1])).toBe('Its main character is Odile, now in or at The Library.');
    expect(cellOf('now').querySelector('[data-role="strand-join"]')!.textContent).toBe('is now in or at');
    expect(cellOf('now').querySelector('[data-act="more"]')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('a chip brings its box into view, the focus on its name; a hidden element\'s chip carries the hidden word', () => {
    const els = whole().map(e => (e.id === E ? { ...e, hidden: true } as Element : e));
    world(els, { narrative: N, event: E, location: L });
    draw();
    const chip = host.querySelector<HTMLButtonElement>('[data-chip="event"]')!;
    expect(chip.querySelector('[data-role="hidden-word"]')).not.toBeNull();
    chip.click();
    expect(document.activeElement).toBe(cellOf('event').querySelector('[data-strand-key="event:open"]'));
  });

  it('a box: its kind\'s words, the first lines of its text, Edit and the ⋯ holding Use another', () => {
    world([el('narrative', N, { name: 'The Ferry', description: 'Only a description.' }), el('character', X)], full);
    draw();
    const story = cellOf('narrative');
    expect(story.querySelector('.atlas-home-strand-word')!.textContent).toBe('Story · Narrative');
    expect(story.querySelector('.atlas-home-strand-box-text')!.textContent).toBe('Only a description.');
    const more = story.querySelector<HTMLButtonElement>('[data-act="more"]')!;
    expect(more.getAttribute('aria-label')).toBe('More for The Ferry');
    more.click();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const item = story.querySelector<HTMLButtonElement>('.atlas-home-strand-menu button')!;
    expect(item.textContent).toBe('Use another story');
    expect(story.querySelector(`[${GRID_OPEN_ATTR}]`)).not.toBeNull();
    // Escape closes it, owned, the focus back on ⋯.
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    item.dispatchEvent(esc);
    expect(escapeOwned(esc)).toBe(true);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(more);
    more.click();
    story.querySelector<HTMLButtonElement>('.atlas-home-strand-menu button')!.click();
    expect([...cellOf('narrative').querySelectorAll('[data-act]')].map(b => b.textContent)).toEqual(['Create one', 'Pick from the world', 'Cancel']);
  });

  it('Edit opens the card in place with the box\'s values; a story for the writing room gets no text field', () => {
    world([el('narrative', N, { name: 'The Ferry', story: 'A\nB\nC\nD\nE\nF\nG' }), el('event', E, { name: 'The Flood', description: 'Water.', start_date: 1142 }), el('character', X)],
      { narrative: N, event: E, location: GONE2 });
    draw();
    cellOf('narrative').querySelector<HTMLButtonElement>('[data-act="edit"]')!.click();
    let edit = host.querySelector<HTMLElement>('[data-mode="edit"]')!;
    expect(edit.querySelector('[data-field="text"]')).toBeNull();
    expect(edit.querySelector('[data-act="writing"]')!.textContent).toBe('Write it in the writing room');
    edit.querySelector<HTMLButtonElement>('[data-act="cancel"]')!.click();
    expect(host.querySelector('[data-mode="edit"]')).toBeNull();
  });

  it('a contributor: Edit only on what they may change, no ⋯ where they may not set the slot', () => {
    world([el('narrative', N, { name: 'The Ferry' }), el('character', X)], full, contributor);
    draw();
    const story = cellOf('narrative');
    // A folder world's member slice changes every element (mayChange); the story slot is a keeper's.
    expect(story.querySelector('[data-act="edit"]')).not.toBeNull();
    expect(story.querySelector('[data-act="more"]')).toBeNull();
  });
});

describe('the words', () => {
  it('the slots\' words, and no "hero" left', () => {
    expect(SLOT_WORD).toEqual({ narrative: 'Story', event: 'Event', location: 'Where it happened', character: 'Character', now: 'Where they are now' });
  });

  it('a Character or Now field holding what the strand does not read says what it holds (G8)', () => {
    const proposed = el('character', C, { x_review_proposed: { by: 'm', evidence: 'seat' }, name: 'Mira' });
    world([el('narrative', N, { protagonist: C }), proposed], full);
    expect(rawWords('character', strandContext(W)!)).toBe('Proposed: Mira');
    world([el('narrative', N, { protagonist: GONE })], full);
    expect(rawWords('character', strandContext(W)!)).toBe('An id that names nothing here');
    world([el('narrative', N, { protagonist: C }), el('character', C, { hidden: true, name: 'Ana' })], full);
    expect(rawWords('character', strandContext(W)!)).toBeNull();
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

  it('C14: Use another never offers what the slot already holds', () => {
    const E2 = '0192a000-0000-7000-8000-000000000b02';
    world([el('narrative', N, { events: [E, E2] }), el('event', E), el('event', E2)], { narrative: N, event: E, location: GONE });
    const rows = pickRows('event', strandContext(W)!);
    expect([...rows.own, ...rows.rest].map(e => e.id)).toEqual([E2]);
  });

  it('S8: "Or pick one from your world" only when the pick list holds one', () => {
    // The main character's card, the first asked on a story (1.121.0).
    world([el('narrative', N)], full);
    draw();
    expect(cards()[0].getAttribute('data-card-slot')).toBe('character');
    expect(cards()[0].querySelector('[data-act="pick"]')).toBeNull();
    world([el('narrative', N), el('character', X)], full);
    draw();
    expect(cards()[0].querySelector('[data-act="pick"]')!.textContent).toBe('Or pick one from your world');
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
    world([], undefined, {}, viewOnly);
    expect(strandOfferFor(el('narrative', N), W)).toBeNull();
  });
});

describe('from the code gate', () => {
  it('C4: a picture drawn with no head is the Picture tab, so a pulled strand never switches it', () => {
    world([el('narrative', N), el('character', X)], undefined, contributor);
    expect(strandTabShows(W)).toBe(false);
    notePictureShown(W);
    world([el('narrative', N), el('character', X)], full, contributor);
    expect(strandTabShows(W)).toBe(true);
    expect(chosenTab(W)).toBe('picture');
  });
});

describe('the frame beside the story', () => {
  it('C10: a hidden main character carries the hidden word in the frame too; an empty slot offers Pick on Home', () => {
    world([el('narrative', N, { protagonist: C }), el('character', C, { hidden: true, name: 'Ana' })], full);
    const frame = buildStrandFrame(el('narrative', N))!;
    expect(frame.querySelector('[data-slot="character"] [data-action="strand-open"]')!.textContent).toContain('Ana');
    expect(frame.querySelector('[data-slot="character"] [data-role="hidden-word"]')).not.toBeNull();
    expect(frame.querySelector('[data-slot="character"]')!.textContent).toContain('Character');
    expect(frame.querySelector('[data-slot="event"] [data-action="strand-pick-on-home"]')!.textContent).toBe('Pick on Home');
    expect(buildStrandFrame(el('narrative', N2))).toBeNull();
  });
});
