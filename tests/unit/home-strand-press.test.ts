/**
 * One write per press (the code gate's C1): a card's Make and Still at, a box's Use another, and the
 * page's Make this the world's strand, each pressed twice before the first write lands, make one write
 * and never say "The strand changed meanwhile" about the person's own first press. And the journey's
 * presses through the panel (1.120.0): the Character card's second write on the strand's Event, who it
 * reaches and what it says, a card's memory cleared only by a Make that wrote, Edit's Save.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getState, patchSlice } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { defaultRegistry, type Element, type WorldMeta, type WorldRegistryEntry } from '../../src/core/types';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { buildStrandPanel, resetStrandTabForTests } from '../../src/middle/home-strand';
import { draftOf } from '../../src/middle/home-strand-model';
import { buildBarStrandOffer, buildPageStrandOffer, makeThisTheStrand, resetStrandOfferForTests } from '../../src/middle/strand-offer';
import { toastManager } from '../../src/ui/toast-manager';

const W = 'w-strand-press';
const N = '0192a000-0000-7000-8000-000000000a01';
const N2 = '0192a000-0000-7000-8000-000000000a02';
const E = '0192a000-0000-7000-8000-000000000b01';
const L = '0192a000-0000-7000-8000-000000000c01';
const C = '0192a000-0000-7000-8000-000000000d01';
const D = '0192a000-0000-7000-8000-000000000d02';
const GONE_E = '0192a000-0000-7000-8000-00000000ee01';
const GONE_L = '0192a000-0000-7000-8000-00000000ee02';

let store: MockFolderStore;
let host: HTMLElement;
let metaWrites: number;

async function put(type: string, id: string, extra: Record<string, unknown> = {}): Promise<void> {
  await store.createElementVerbatim(type as never, { id, type, name: `${type} ${id.slice(-2)}`, ...extra } as unknown as Element);
}

async function open(mark: unknown, entry: Partial<WorldRegistryEntry> = {}): Promise<void> {
  await store.writeWorldMeta({ x_strand: mark } as unknown as Partial<WorldMeta>);
  patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: W, name: 'W', state: 'local-only', ...entry } as WorldRegistryEntry] });
  patchSlice('active', { worldId: W, meta: await store.readWorldMeta() } as never);
  patchSlice('data', { elements: await store.listElements(), loading: false } as never);
  draw();
}

/** Home's draw, as a press asks it again. */
function draw(): void {
  host.innerHTML = '';
  host.appendChild(buildStrandPanel(W, { alone: false, redraw: draw }));
}

const cell = (slot: string) => host.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
const card = () => host.querySelector<HTMLFormElement>('[data-role="strand-card"]')!;
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 0)); };
const said = () => host.querySelector('[data-role="strand-say"]')?.textContent ?? '';
const disk = async (id: string) => (await store.listElements()).find(e => e.id === id) as unknown as Record<string, unknown>;
const typeIn = (field: string, value: string): void => {
  const input = card().querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${field}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const pickIn = (root: HTMLElement, name: string): void => {
  [...root.querySelectorAll<HTMLElement>('[role="option"]')].find(o => o.textContent === name)!.click();
};

beforeEach(() => {
  store = new MockFolderStore();
  setActiveStore(store as never);
  host = document.createElement('div');
  document.body.appendChild(host);
  metaWrites = 0;
  const meta = store.writeWorldMetaWith.bind(store);
  store.writeWorldMetaWith = async mutate => meta(cur => {
    const patch = mutate(cur);
    if (patch) metaWrites++;
    return patch;
  });
});

afterEach(() => {
  resetStrandTabForTests();
  resetStrandOfferForTests();
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
  patchSlice('data', { elements: [] } as never);
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('a press twice writes once (C1)', () => {
  it('the Event card\'s Make, Enter twice: one Event made, listed once, and nothing said', async () => {
    await put('narrative', N, { events: [] });
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    expect(card().getAttribute('data-card-slot')).toBe('event');
    typeIn('name', 'The Flood');
    const form = card();
    form.requestSubmit();
    form.requestSubmit();
    await settle();
    const events = (await store.listElements()).filter(e => e.type === 'event');
    expect(events.map(e => e.name)).toEqual(['The Flood']);
    expect((await disk(N)).events).toEqual([events[0].id]);
    expect(metaWrites).toBe(1);
    expect(said()).toBe('');
  });

  it('Still at pressed twice before the first lands: one write', async () => {
    await put('narrative', N, { events: [E], protagonist: C });
    await put('event', E, { locations: [L] });
    await put('location', L, { name: 'The Quay' });
    await put('character', C);
    await open({ narrative: N, event: E, location: L });
    const same = card().querySelector<HTMLButtonElement>('[data-act="same"]')!;
    expect(same.textContent).toBe('Still at The Quay');
    let writes = 0;
    const update = store.updateElementWith.bind(store);
    store.updateElementWith = async (id, mutate) => update(id, ex => { const p = mutate(ex); if (p) writes++; return p; });
    same.click();
    same.click();
    await settle();
    expect(writes).toBe(1);
    expect((await disk(C)).location).toBe(L);
    expect(said()).toBe('');
  });

  it('Use another\'s promise pressed twice: one write, and never "changed meanwhile"', async () => {
    await put('narrative', N, { protagonist: C });
    await put('character', C, { name: 'Mira' });
    await put('character', D, { name: 'Ilse' });
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    cell('character').querySelector<HTMLButtonElement>('[data-act="more"]')!.click();
    cell('character').querySelector<HTMLButtonElement>('[data-act="another"]')!.click();
    expect(cell('character').querySelector('[data-act="another"]')).toBeNull();
    cell('character').querySelector<HTMLButtonElement>('[data-act="pick"]')!.click();
    pickIn(cell('character'), 'Ilse');
    const confirm = cell('character').querySelector<HTMLButtonElement>('[data-act="confirm"]')!;
    expect(cell('character').querySelector('[data-role="strand-promise"]')!.textContent).toBe('Ilse will be the main character in place of Mira.');
    expect(confirm.textContent).toContain('Replace Mira');
    confirm.click();
    confirm.click();
    await settle();
    expect((await disk(N)).protagonist).toBe(D);
    expect(said()).toBe('');
  });
});

describe('the page\'s press twice writes once (C1)', () => {
  it('Make this the world\'s strand pressed twice: one mark write, no "changed meanwhile"', async () => {
    await put('narrative', N);
    await put('narrative', N2);
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    const info = vi.spyOn(toastManager, 'info').mockImplementation(() => {});
    vi.spyOn(toastManager, 'show').mockImplementation(() => {});
    vi.spyOn(toastManager, 'success').mockImplementation(() => {});
    const n2 = getState().data.elements.find(e => e.id === N2)!;
    const drawn = { worldId: W, narrative: N, event: GONE_E, location: GONE_L };
    await Promise.all([makeThisTheStrand(n2, W, drawn), makeThisTheStrand(n2, W, drawn)]);
    expect(metaWrites).toBe(1);
    expect(info).not.toHaveBeenCalled();
    expect(((await store.readWorldMeta()) as unknown as Record<string, { narrative: string }>).x_strand.narrative).toBe(N2);
  });
});

describe('a write starting holds the whole panel (D1)', () => {
  it('every act disabled and every field read-only before the first await; what was typed kept, nothing "changed meanwhile"', async () => {
    await put('narrative', N, { events: [] });
    await put('event', E, { name: 'The Fire' });
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    typeIn('name', 'The Flood');
    // The story's link waits until let go.
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const update = store.updateElementWith.bind(store);
    store.updateElementWith = async (id, mutate) => { await gate; return update(id, mutate); };
    card().querySelector<HTMLButtonElement>('[data-act="pick"]')!.click();
    pickIn(card(), 'The Fire');
    // At once, before any await: the panel is still for this press alone.
    const acts = [...host.querySelectorAll<HTMLButtonElement>('[data-act]')];
    expect(acts.length).toBeGreaterThan(0);
    expect(acts.every(b => b.disabled)).toBe(true);
    expect(card().querySelector<HTMLInputElement>('[data-field="name"]')!.readOnly).toBe(true);
    // Home redraws while the write runs (a store tick): the fresh panel holds every act too.
    draw();
    expect([...host.querySelectorAll<HTMLButtonElement>('[data-act]')].every(b => b.disabled)).toBe(true);
    release();
    await settle();
    expect((await disk(N)).events).toEqual([E]);
    expect((await store.listElements()).filter(e => e.type === 'event').map(e => e.name)).toEqual(['The Fire']);
    expect(said()).toBe('');
    expect([...host.querySelectorAll<HTMLButtonElement>('[data-act]')].some(b => b.disabled)).toBe(false);
  });
});

describe('the Character card adds the main character to the strand\'s Event (R4)', () => {
  async function storyWithEvent(eventExtra: Record<string, unknown> = {}, entry: Partial<WorldRegistryEntry> = {}, storyExtra: Record<string, unknown> = {}): Promise<void> {
    await put('narrative', N, { events: [E], name: 'The Ferry', ...storyExtra });
    await put('event', E, { locations: [L], name: 'The night crossing', ...eventExtra });
    await put('location', L, { name: 'The Quay' });
    await open({ narrative: N, event: E, location: L }, entry);
    if (!storyExtra.protagonist) expect(card().getAttribute('data-card-slot')).toBe('character');
  }

  it('Make: the protagonist, then the Event lists them; the card\'s memory cleared once it wrote', async () => {
    await storyWithEvent({ characters: [{ id: D, name: 'Ana' }] });
    expect(card().querySelector('.atlas-home-strand-card-title > span:last-child')!.textContent).toBe('Who was involved in The night crossing?');
    typeIn('name', 'Odile');
    typeIn('text', 'A cartographer.');
    card().requestSubmit();
    await settle();
    const odile = (await store.listElements()).find(e => e.name === 'Odile')!;
    expect((await disk(N)).protagonist).toBe(odile.id);
    expect((await disk(E)).characters).toEqual([{ id: D, name: 'Ana' }, odile.id]);
    expect((await disk(odile.id)).description).toBe('A cartographer.');
    expect(said()).toBe('');
    // The next card asks; the Character's card, were it asked again, starts empty.
    expect(card().getAttribute('data-card-slot')).toBe('now');
    expect(draftOf(W, 'character')).toEqual({ name: '', text: '', when: '' });
  });

  it('Pick: the same second write', async () => {
    await put('character', C, { name: 'Mira' });
    await storyWithEvent({ characters: [] });
    card().querySelector<HTMLButtonElement>('[data-act="pick"]')!.click();
    pickIn(card(), 'Mira');
    await settle();
    expect((await disk(N)).protagonist).toBe(C);
    expect((await disk(E)).characters).toEqual([C]);
  });

  it('Use another character never touches the Event', async () => {
    await put('character', C, { name: 'Mira' });
    await put('character', D, { name: 'Ilse' });
    await storyWithEvent({ characters: [C] }, {}, { protagonist: C });
    // Mira is the main character already: the Now card is asked; the Character box offers Use another.
    cell('character').querySelector<HTMLButtonElement>('[data-act="more"]')!.click();
    cell('character').querySelector<HTMLButtonElement>('[data-act="another"]')!.click();
    cell('character').querySelector<HTMLButtonElement>('[data-act="pick"]')!.click();
    pickIn(cell('character'), 'Ilse');
    cell('character').querySelector<HTMLButtonElement>('[data-act="confirm"]')!.click();
    await settle();
    expect((await disk(N)).protagonist).toBe(D);
    expect((await disk(E)).characters).toEqual([C]);
  });

  it('a contributor who may not change the Event: the story names them, the Event untouched, nothing said', async () => {
    const entry = { state: 'api-linked', api: { world_id: 'a', api_key: 'k', member_role: 'contributor', membership: 'mine' } } as never;
    await storyWithEvent({ characters: [], created_by: 'someone-else' }, entry, { created_by: 'mine' });
    typeIn('name', 'Odile');
    card().requestSubmit();
    await settle();
    const odile = (await store.listElements()).find(e => e.name === 'Odile')!;
    expect((await disk(N)).protagonist).toBe(odile.id);
    expect((await disk(E)).characters).toEqual([]);
    expect(said()).toBe('');
  });

  it('the Event gone before its write: the main character stays, and the line says the rest did not go through', async () => {
    await storyWithEvent({ characters: [] });
    const update = store.updateElementWith.bind(store);
    store.updateElementWith = async (id, mutate) => {
      if (id === E) await store.deleteElement(E, { silent: true });
      return update(id, mutate);
    };
    typeIn('name', 'Odile');
    card().requestSubmit();
    await settle();
    const odile = (await store.listElements()).find(e => e.name === 'Odile')!;
    expect((await disk(N)).protagonist).toBe(odile.id);
    expect(said()).toBe("Odile is the story's main character; adding them to The night crossing did not go through.");
  });

  it('a refused Make keeps what was typed, and the focus asked for the card\'s Name', async () => {
    await storyWithEvent({ characters: [] });
    typeIn('name', 'Odile');
    typeIn('text', 'Kept.');
    // Another tab names someone else first.
    await store.updateElement(N, { protagonist: D } as Partial<Element>);
    card().requestSubmit();
    await settle();
    expect(said()).toBe('The strand changed meanwhile.');
    expect(card().getAttribute('data-card-slot')).toBe('character');
    expect(card().querySelector<HTMLInputElement>('[data-field="name"]')!.value).toBe('Odile');
    expect(card().querySelector<HTMLTextAreaElement>('[data-field="text"]')!.value).toBe('Kept.');
  });
});

describe('a Make refused after its create (C14)', () => {
  it('the element stays and is said; the card\'s name is spent, so a second Make makes no twin', async () => {
    await put('narrative', N, { events: [E], name: 'The Ferry' });
    await put('event', E, { locations: [L], name: 'The night crossing' });
    await put('location', L, { name: 'The Quay' });
    await open({ narrative: N, event: E, location: L });
    const create = store.createElement.bind(store);
    store.createElement = async (type, data) => {
      const made = await create(type, data);
      await store.updateElement(N, { protagonist: D } as Partial<Element>);
      return made;
    };
    typeIn('name', 'Odile');
    card().requestSubmit();
    await settle();
    expect(said()).toBe('The strand changed meanwhile. Odile was made and stays in the world.');
    expect(card().querySelector<HTMLInputElement>('[data-field="name"]')!.value).toBe('');
  });
});

describe('Edit\'s Save (R7)', () => {
  const edit = () => host.querySelector<HTMLFormElement>('[data-mode="edit"]')!;
  const typeInto = (field: string, value: string): void => {
    const input = edit().querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${field}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  /** Another pane or tab writes the element, and the pull lands in Home's list. */
  const meanwhile = async (id: string, patch: Record<string, unknown>): Promise<void> => {
    await store.updateElement(id, patch as Partial<Element>);
    patchSlice('data', { elements: await store.listElements(), loading: false } as never);
    draw();
  };

  it('writes the changed name alone; a change meanwhile writes nothing, keeps what was typed, and the second Save writes it (C4)', async () => {
    await put('narrative', N, { events: [E], name: 'The Ferry' });
    await put('event', E, { name: 'The Flood', description: 'Water.', start_date: 1142 });
    await open({ narrative: N, event: E, location: GONE_L });
    cell('event').querySelector<HTMLButtonElement>('[data-act="edit"]')!.click();
    expect(edit().querySelector<HTMLInputElement>('[data-field="when"]')!.value).toBe('1142');
    typeInto('name', 'The Great Flood');
    let fields: string[] = [];
    const update = store.updateElementWith.bind(store);
    store.updateElementWith = async (id, mutate) => update(id, ex => { const p = mutate(ex); if (p) fields = Object.keys(p); return p; });
    edit().requestSubmit();
    await settle();
    expect(fields).toEqual(['name']);
    expect((await disk(E)).name).toBe('The Great Flood');
    expect(host.querySelector('[data-mode="edit"]')).toBeNull();

    cell('event').querySelector<HTMLButtonElement>('[data-act="edit"]')!.click();
    typeInto('text', 'Mine.');
    await store.updateElement(E, { description: 'Theirs.' } as Partial<Element>);
    fields = [];
    edit().requestSubmit();
    await settle();
    expect(fields).toEqual([]);
    expect((await disk(E)).description).toBe('Theirs.');
    expect(said()).toBe('The Great Flood changed meanwhile. What you typed is kept: Save again to write it.');
    expect(edit().querySelector<HTMLTextAreaElement>('[data-field="text"]')!.value).toBe('Mine.');
    // The second Save is a knowing choice: it writes.
    edit().requestSubmit();
    await settle();
    expect(fields).toEqual(['description']);
    expect((await disk(E)).description).toBe('Mine.');
    expect(host.querySelector('[data-mode="edit"]')).toBeNull();
  });

  it('C1: a reopened Edit shows the element as it is now for every field not typed, and never writes one back', async () => {
    await put('narrative', N, { events: [E], name: 'The Ferry', protagonist: C });
    await put('event', E, { name: 'The Fire', description: 'Smoke over the hills.', start_date: 40 });
    await put('character', C, { name: 'Mira' });
    await open({ narrative: N, event: E, location: GONE_L });
    cell('event').querySelector<HTMLButtonElement>('[data-act="edit"]')!.click();
    typeInto('name', 'The Great Fire');
    // Another box's Edit, then Cancel: the Event's typed name stays kept, nothing else of it.
    cell('character').querySelector<HTMLButtonElement>('[data-act="edit"]')!.click();
    edit().querySelector<HTMLButtonElement>('[data-act="cancel"]')!.click();
    await meanwhile(E, { description: 'Ash everywhere.' });
    cell('event').querySelector<HTMLButtonElement>('[data-act="edit"]')!.click();
    expect(edit().querySelector<HTMLTextAreaElement>('[data-field="text"]')!.value).toBe('Ash everywhere.');
    expect(edit().querySelector<HTMLInputElement>('[data-field="name"]')!.value).toBe('The Great Fire');
    edit().requestSubmit();
    await settle();
    expect(await disk(E)).toMatchObject({ name: 'The Great Fire', description: 'Ash everywhere.', start_date: 40 });
  });

  it('C2: a typed name never crosses to another element in the slot', async () => {
    await put('narrative', N, { events: [E], name: 'The Ferry', protagonist: C });
    await put('event', E, { name: 'The Fire' });
    await put('character', C, { name: 'Mira' });
    await put('character', D, { name: 'Ilse' });
    await open({ narrative: N, event: E, location: GONE_L });
    cell('character').querySelector<HTMLButtonElement>('[data-act="edit"]')!.click();
    typeInto('name', 'Mira the Bold');
    cell('event').querySelector<HTMLButtonElement>('[data-act="edit"]')!.click();
    edit().querySelector<HTMLButtonElement>('[data-act="cancel"]')!.click();
    // The story's main character becomes Ilse elsewhere; the pull lands.
    await meanwhile(N, { protagonist: D });
    cell('character').querySelector<HTMLButtonElement>('[data-act="edit"]')!.click();
    expect(edit().querySelector<HTMLInputElement>('[data-field="name"]')!.value).toBe('Ilse');
    edit().requestSubmit();
    await settle();
    expect((await disk(D)).name).toBe('Ilse');
    expect((await disk(C)).name).toBe('Mira');
    // Mira back in the slot: her old draft went when she left it.
    await meanwhile(N, { protagonist: C });
    cell('character').querySelector<HTMLButtonElement>('[data-act="edit"]')!.click();
    expect(edit().querySelector<HTMLInputElement>('[data-field="name"]')!.value).toBe('Mira');
  });

  it('C7: "Write it in the writing room" saves a typed name first; refused, the card stays and says why', async () => {
    const long = '1\n2\n3\n4\n5\n6\n7';
    await put('narrative', N, { events: [], name: 'The Ferry', story: long });
    await put('character', C, { name: 'Mira' });
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    cell('narrative').querySelector<HTMLButtonElement>('[data-act="edit"]')!.click();
    expect(edit().querySelector('[data-field="text"]')).toBeNull();
    typeInto('name', 'The Night Ferry');
    // Refused first: the name changed elsewhere.
    await store.updateElement(N, { name: 'The Old Ferry' } as Partial<Element>);
    edit().querySelector<HTMLButtonElement>('[data-act="writing"]')!.click();
    await settle();
    expect(edit()).not.toBeNull();
    expect(said()).toBe('The Ferry changed meanwhile. What you typed is kept: Save again to write it.');
    expect((await disk(N)).name).toBe('The Old Ferry');
    expect(edit().querySelector<HTMLInputElement>('[data-field="name"]')!.value).toBe('The Night Ferry');
    // Pressed again: the name is written, then the writing room opens.
    edit().querySelector<HTMLButtonElement>('[data-act="writing"]')!.click();
    await settle();
    expect((await disk(N)).name).toBe('The Night Ferry');
    expect((await disk(N)).story).toBe(long);
    // The Edit closed behind the door (Home itself goes with the navigation; here it is drawn again).
    draw();
    expect(host.querySelector('[data-mode="edit"]')).toBeNull();
    expect(window.location.hash).toContain(N);
  });
});

describe('the page and the bar after a press that did not land (D2)', () => {
  const page = document.createElement('div');
  beforeEach(() => {
    vi.spyOn(toastManager, 'info').mockImplementation(() => {});
    vi.spyOn(toastManager, 'show').mockImplementation(() => {});
    vi.spyOn(toastManager, 'success').mockImplementation(() => {});
    vi.spyOn(toastManager, 'problem').mockImplementation(() => {});
  });
  const offerOn = (id: string): void => {
    page.innerHTML = '';
    document.body.appendChild(page);
    const block = buildPageStrandOffer(getState().data.elements.find(e => e.id === id)!, W);
    if (block) page.appendChild(block);
  };
  const live = (sel: string) => page.querySelector<HTMLButtonElement>(sel);

  it('Clear the strand failing: the block is drawn again, Clear the strand and Cancel live', async () => {
    await put('narrative', N);
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    offerOn(N);
    live('[data-action="strand-clear"]')!.click();
    store.writeWorldMetaWith = async () => { throw new Error('disk'); };
    live('[data-action="strand-clear-confirm"]')!.click();
    await settle();
    expect(live('[data-action="strand-clear"]')?.disabled).toBe(false);
    expect([...page.querySelectorAll<HTMLButtonElement>('button')].some(b => b.disabled)).toBe(false);
    expect(toastManager.problem).toHaveBeenCalled();
  });

  it('Clear the strand refused: the same, beside the line that says it', async () => {
    await put('narrative', N);
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    offerOn(N);
    live('[data-action="strand-clear"]')!.click();
    await store.writeWorldMeta({ x_strand: { narrative: N2, event: null, location: null } } as unknown as Partial<WorldMeta>);
    live('[data-action="strand-clear-confirm"]')!.click();
    await settle();
    expect([...page.querySelectorAll<HTMLButtonElement>('button')].some(b => b.disabled)).toBe(false);
    expect(live('[data-action="strand-clear"]')).not.toBeNull();
    expect(toastManager.info).toHaveBeenCalledWith('The strand changed meanwhile.');
  });

  it('the bar redrawn mid-press: the button drawn now is live again after a refusal', async () => {
    await put('narrative', N);
    await put('narrative', N2);
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    const bar = document.createElement('div');
    document.body.appendChild(bar);
    const n2 = getState().data.elements.find(e => e.id === N2)!;
    bar.appendChild(buildBarStrandOffer(n2, W)!);
    await store.writeWorldMeta({ x_strand: { narrative: N2, event: GONE_E, location: GONE_L } } as unknown as Partial<WorldMeta>);
    bar.querySelector<HTMLButtonElement>('[data-action="strand-make"]')!.click();
    // The writing room redraws its bar while the press runs.
    bar.innerHTML = '';
    bar.appendChild(buildBarStrandOffer(n2, W)!);
    expect(bar.querySelector<HTMLButtonElement>('[data-action="strand-make"]')!.disabled).toBe(true);
    await settle();
    expect(bar.querySelector<HTMLButtonElement>('[data-action="strand-make"]')!.disabled).toBe(false);
  });
});
