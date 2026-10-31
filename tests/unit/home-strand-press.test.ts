/**
 * One write per press (the code gate's C1): a box's Make one, Same place and Change, and the page's
 * Make this the world's strand, each pressed twice before the first write lands, make one write and
 * never say "The strand changed meanwhile" about the person's own first press.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getState, patchSlice } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { defaultRegistry, type Element, type WorldMeta, type WorldRegistryEntry } from '../../src/core/types';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { buildStrandPanel, resetStrandTabForTests } from '../../src/middle/home-strand';
import { buildBarStrandOffer, buildPageStrandOffer, makeThisTheStrand, resetStrandOfferForTests } from '../../src/middle/strand-offer';
import { toastManager } from '../../src/ui/toast-manager';

const W = 'w-strand-press';
const N = '0192a000-0000-7000-8000-000000000a01';
const N2 = '0192a000-0000-7000-8000-000000000a02';
const E = '0192a000-0000-7000-8000-000000000b01';
const L = '0192a000-0000-7000-8000-000000000c01';
const C = '0192a000-0000-7000-8000-000000000d01';
const GONE_E = '0192a000-0000-7000-8000-00000000ee01';
const GONE_L = '0192a000-0000-7000-8000-00000000ee02';

let store: MockFolderStore;
let host: HTMLElement;
let metaWrites: number;

async function put(type: string, id: string, extra: Record<string, unknown> = {}): Promise<void> {
  await store.createElementVerbatim(type as never, { id, type, name: `${type} ${id.slice(-2)}`, ...extra } as unknown as Element);
}

async function open(mark: unknown): Promise<void> {
  await store.writeWorldMeta({ x_strand: mark } as unknown as Partial<WorldMeta>);
  patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: W, name: 'W', state: 'local-only' } as WorldRegistryEntry] });
  patchSlice('active', { worldId: W, meta: await store.readWorldMeta() } as never);
  patchSlice('data', { elements: await store.listElements(), loading: false } as never);
  draw();
}

/** Home's draw, as a press asks it again. */
function draw(): void {
  host.innerHTML = '';
  host.appendChild(buildStrandPanel(W, { alone: false, redraw: draw }));
}

const box = (slot: string) => host.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 0)); };
const said = () => host.querySelector('[data-role="strand-say"]')?.textContent ?? '';

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

describe('a box pressed twice writes once (C1)', () => {
  it('Make one, Enter twice: one Event made, listed once, and nothing said', async () => {
    await put('narrative', N, { events: [] });
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    box('event').querySelector<HTMLButtonElement>('[data-act="make"]')!.click();
    const form = box('event').querySelector('form')!;
    form.querySelector('input')!.value = 'The Flood';
    form.requestSubmit();
    form.requestSubmit();
    await settle();
    const events = (await store.listElements()).filter(e => e.type === 'event');
    expect(events.map(e => e.name)).toEqual(['The Flood']);
    expect((await store.listElements()).find(e => e.id === N)!.events).toEqual([events[0].id]);
    expect(metaWrites).toBe(1);
    expect(said()).toBe('');
  });

  it('Same place pressed twice before the first lands: one write', async () => {
    await put('narrative', N, { events: [E], protagonist: C });
    await put('event', E, { locations: [L] });
    await put('location', L);
    await put('character', C);
    await open({ narrative: N, event: E, location: L });
    const same = box('now').querySelector<HTMLButtonElement>('[data-act="same"]')!;
    let writes = 0;
    const update = store.updateElementWith.bind(store);
    store.updateElementWith = async (id, mutate) => update(id, ex => { const p = mutate(ex); if (p) writes++; return p; });
    same.click();
    same.click();
    await settle();
    expect(writes).toBe(1);
    expect((await store.listElements()).find(e => e.id === C)!.location).toBe(L);
    expect(said()).toBe('');
  });

  it('a promise\'s Change pressed twice: one write, and never "changed meanwhile"', async () => {
    await put('narrative', N, { protagonist: C });
    await put('character', C, { name: 'Mira' });
    await put('character', '0192a000-0000-7000-8000-000000000d02', { name: 'Ilse' });
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    box('character').querySelector<HTMLButtonElement>('[data-act="change"]')!.click();
    box('character').querySelector<HTMLButtonElement>('[data-act="pick"]')!.click();
    const option = [...box('character').querySelectorAll<HTMLElement>('[role="option"]')].find(o => o.textContent === 'Ilse')!;
    option.click();
    const confirm = box('character').querySelector<HTMLButtonElement>('[data-act="confirm"]')!;
    expect(box('character').querySelector('[data-role="strand-promise"]')!.textContent).toBe('Ilse will be the hero in place of Mira.');
    expect(confirm.textContent).toContain('Replace Mira');
    confirm.click();
    confirm.click();
    await settle();
    expect((await store.listElements()).find(e => e.id === N)!.protagonist).toBe('0192a000-0000-7000-8000-000000000d02');
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
  it('every act disabled and an open name box closed before the first await; nothing dropped unsaid, nothing "changed meanwhile"', async () => {
    await put('narrative', N, { events: [] });
    await put('character', C, { name: 'Mira' });
    await open({ narrative: N, event: GONE_E, location: GONE_L });
    // A name typed in the Happening box, not yet given.
    box('event').querySelector<HTMLButtonElement>('[data-act="make"]')!.click();
    box('event').querySelector<HTMLInputElement>('input')!.value = 'The Flood';
    // The hero's link waits until let go.
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const update = store.updateElementWith.bind(store);
    store.updateElementWith = async (id, mutate) => { await gate; return update(id, mutate); };
    box('character').querySelector<HTMLButtonElement>('[data-act="pick"]')!.click();
    [...box('character').querySelectorAll<HTMLElement>('[role="option"]')].find(o => o.textContent === 'Mira')!.click();
    // At once, before any await: the panel is still for this press alone.
    const acts = [...host.querySelectorAll<HTMLButtonElement>('[data-act]')];
    expect(acts.length).toBeGreaterThan(0);
    expect(acts.every(b => b.disabled)).toBe(true);
    expect(host.querySelector('form')).toBeNull();
    box('character').querySelector<HTMLButtonElement>('[data-act="make"]')?.click();
    expect(host.querySelector('form')).toBeNull();
    // Home redraws while the write runs (a store tick): the fresh panel holds every act too.
    draw();
    expect([...host.querySelectorAll<HTMLButtonElement>('[data-act]')].every(b => b.disabled)).toBe(true);
    release();
    await settle();
    expect((await store.listElements()).find(e => e.id === N)!.protagonist).toBe(C);
    expect((await store.listElements()).filter(e => e.type === 'event')).toEqual([]);
    expect(said()).toBe('');
    expect([...host.querySelectorAll<HTMLButtonElement>('[data-act]')].some(b => b.disabled)).toBe(false);
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
