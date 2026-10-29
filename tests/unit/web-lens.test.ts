/**
 * The Web through a lens (#841): the choice, the reading, its line, the
 * lens mode of the graph, and Keep a lens. The reading is checked against
 * the SDK's own `resolveLens`, never a copy of its rules: the Web draws
 * exactly what the lens kept, never one more.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { resolveLens } from '@onlyworlds/sdk';
import { patchSlice } from '../../src/core/state';
import type { Element, WorldsRegistry } from '../../src/core/types';
import {
  LENS_DRAW_MAX, chosenLens, keepLensField, keepLensOn, keepingLens, lensChoices, lensLine,
  lensOnAlone, readLensPicture,
} from '../../src/core/web-lens';
import { mountContextGraph, clearContextGraphLayoutMemo } from '../../src/tabs/right/context-pane-graph';
import { rekeyRegistryEntry } from '../../src/registry/registry';
import { mountContextToolbar } from '../../src/tabs/right/context-pane-toolbar';
import { escapeOwned } from '../../src/core/escape-mark';

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
beforeEach(() => clearContextGraphLayoutMemo());
afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const el = (n: number, type: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id: id(n), type, name, ...extra }) as unknown as Element;

// Ada and Zed are two anchors with nothing between them; a Relation carries Cy in as Ada's party,
// and an Event names Ada and Hollow Keep (two hops from Ada, past the lens's depth).
const ada = el(1, 'character', 'Ada');
const zed = el(2, 'character', 'Zed');
const keep = el(3, 'location', 'Hollow Keep');
const ward = el(4, 'relation', "Ada's ward", { characters: [id(1), id(5)] });
const cy = el(5, 'character', 'Cy');
const ev = el(6, 'event', 'The Siege', { characters: [id(1)], locations: [id(3)] });
const lens = el(10, 'construct', 'Two people', { supertype: 'Lens', characters: [id(1), id(2)] });
const world = [ada, zed, keep, ward, cy, ev, lens];

function setWorld(elements: Element[], entry: Record<string, unknown> = {}): void {
  patchSlice('data', { elements } as never);
  patchSlice('active', { worldId: 'w1', meta: {} } as never);
  patchSlice('registry', { version: 1, worlds: [{ id: 'w1', name: 'W', ...entry }] } as unknown as WorldsRegistry);
}

describe('the reading is the lens kept, read by the SDK', () => {
  it('draws exactly resolveLens\'s kept, two unconnected anchors and a Relation\'s party included', () => {
    setWorld(world);
    const p = readLensPicture(lens);
    const sdk = resolveLens({ elements: world }, lens.id, { rung: 'owner' });
    expect(p.kind).toBe('ok');
    expect(p.drawn).toEqual(sdk.kept);
    expect([...p.drawn].sort()).toEqual([ada.id, zed.id, ward.id, cy.id, ev.id].sort());
    expect(p.drawn).not.toContain(lens.id);
    expect(p.anchors).toEqual([ada.id, zed.id]);
    // Every line joins two drawn elements.
    for (const e of p.edges) expect(p.drawn.includes(e.from) && p.drawn.includes(e.to)).toBe(true);
  });

  it('a template, an unreadable lens and an empty one each have their own line and draw nothing', () => {
    const tpl = el(11, 'construct', 'Blank', { supertype: 'Lens', subtype: 'Template', x_lens: { depth: 0 } });
    const bad = el(12, 'construct', 'Broken', { supertype: 'Lens', characters: [id(1)], x_lens: { depth: 'far' } });
    const none = el(13, 'construct', 'Nobody', { supertype: 'Lens', characters: [id(99)] });
    setWorld([...world, tpl, bad, none]);
    const t = readLensPicture(tpl);
    expect([t.kind, t.drawn.length]).toEqual(['template', 0]);
    expect(lensLine(t)).toBe('A template reads nothing until it points at something.');
    const b = readLensPicture(bad);
    expect([b.kind, b.unreadableKey, b.drawn.length]).toEqual(['unreadable', 'depth', 0]);
    expect(lensLine(b)).toMatch(/^This lens can't be read/);
    const n = readLensPicture(none);
    expect([n.kind, n.drawn.length]).toEqual(['empty', 0]);
    expect(lensLine(n)).toBe('Nobody keeps nothing in this world yet.');
  });

  it('a lens keeping more than the Web draws says how many it draws', () => {
    const many = Array.from({ length: 70 }, (_, i) => el(100 + i, 'character', `C${i}`));
    const filter = el(14, 'construct', 'Everyone', { supertype: 'Lens', x_lens: { types: ['character'], budget: 200 } });
    setWorld([...many, filter]);
    const p = readLensPicture(filter);
    expect(p.kept).toBe(70);
    expect(p.drawn).toHaveLength(LENS_DRAW_MAX);
    expect(p.drawn).toEqual(p.keptIds.slice(0, LENS_DRAW_MAX));
    expect(lensLine(p)).toBe('Everyone keeps 70, and the Web draws the first 60.');
  });

  it('the line counts what was left out, and names a subject the lens does not keep', () => {
    const budgeted = el(15, 'construct', 'Short', { supertype: 'Lens', characters: [id(1)], x_lens: { budget: 2 } });
    setWorld([...world, budgeted]);
    const p = readLensPicture(budgeted);
    expect(p.kept).toBe(2);
    const cut = p.cut.budget ?? 0;
    expect(cut).toBeGreaterThan(0);
    expect(lensLine(p, { name: 'Zed', kept: false })).toBe(`Short keeps 2. ${cut} left out: ${cut} past its limit. Zed is not in this lens.`);
  });

  it('reading a lens writes nothing', () => {
    setWorld(world);
    const before = JSON.stringify(world);
    readLensPicture(lens);
    expect(JSON.stringify(world)).toBe(before);
  });
});

describe('the choice', () => {
  it('lists lenses by name, a template marked, a proposed one left out', () => {
    const tpl = el(11, 'construct', 'Blank', { supertype: 'Lens', subtype: 'Template' });
    const prop = el(16, 'construct', 'Maybe', { supertype: 'Lens', x_review_proposed: { by: 'm2' } });
    const doubt = el(17, 'construct', 'Doubt', { supertype: 'lens', x_review_proposed: 'yes' });
    expect(lensChoices([...world, tpl, prop, doubt])).toEqual([
      { id: tpl.id, name: 'Blank', template: true },
      { id: lens.id, name: 'Two people', template: false },
    ]);
  });

  it('a chosen id that is gone, no lens, or proposed reads as none', () => {
    expect(chosenLens(world, lens.id)?.id).toBe(lens.id);
    expect(chosenLens(world, id(99))).toBeNull();
    expect(chosenLens(world, ada.id)).toBeNull();
    const prop = { ...lens, x_review_proposed: { by: 'm2' } } as unknown as Element;
    expect(chosenLens([prop], lens.id)).toBeNull();
    expect(chosenLens(world, null)).toBeNull();
  });

  it('a re-key carries the choice to the new id', () => {
    const reg = { version: 1, worlds: [{ id: 'w1', name: 'W', context_lens: lens.id }] } as unknown as WorldsRegistry;
    const out = rekeyRegistryEntry(reg, 'w1', new Map([[lens.id, id(500)]]));
    expect(out.worlds[0].context_lens).toBe(id(500));
  });
});

describe('the graph in lens mode', () => {
  function mountLens(onSelect = vi.fn()) {
    setWorld(world);
    const picture = readLensPicture(lens);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountContextGraph({ host, subject: ada, onSelect, hopDepth: 1, lens: { picture, line: lensLine(picture) } });
    const nodeIds = () => [...host.querySelectorAll<HTMLElement>('.atlas-context-graph-node')].map(n => n.dataset.elementId).sort();
    return { host, handle, picture, nodeIds, onSelect };
  }

  it('draws the lens\'s nodes and no ring of the subject, with its line', () => {
    const { host, picture, nodeIds } = mountLens();
    expect(nodeIds()).toEqual([...picture.drawn].sort());
    expect(host.querySelector('.atlas-context-graph-node.is-center')).toBeNull();
    expect(host.querySelector('[data-role="lens-line"]')?.textContent).toBe(lensLine(picture));
  });

  it('a press selects and never recentres; the hop, the filters and back are inert', () => {
    const { host, handle, picture, nodeIds, onSelect } = mountLens();
    host.querySelector<HTMLElement>(`.atlas-context-graph-node[data-element-id="${zed.id}"]`)!.click();
    expect(onSelect).toHaveBeenCalledWith(zed.id);
    expect(nodeIds()).toEqual([...picture.drawn].sort());
    expect(host.querySelector('.atlas-context-graph-trail')).toBeNull();
    handle.setHopDepth(4);
    handle.setHiddenTypes(new Set(['character']));
    expect(nodeIds()).toEqual([...picture.drawn].sort());
    expect(handle.goBack()).toBe(false);
    expect(handle.getPresentTypes().size).toBe(0);
  });

  it('a lens that draws nothing shows its line alone', () => {
    const tpl = el(11, 'construct', 'Blank', { supertype: 'Lens', subtype: 'Template' });
    setWorld([...world, tpl]);
    const picture = readLensPicture(tpl);
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountContextGraph({ host, subject: tpl, onSelect: () => {}, lens: { picture, line: lensLine(picture) } });
    expect(host.querySelectorAll('.atlas-context-graph-node')).toHaveLength(0);
    expect(host.querySelector('[data-role="lens-line"]')?.textContent).toBe('A template reads nothing until it points at something.');
  });
});

describe('Keep a lens on <name>', () => {
  it('is offered on a focused Character in a writable world, in its anchor field', () => {
    setWorld(world);
    expect(keepLensField('w1', ada, true)).toBe('characters');
    expect(keepLensField('w1', keep, true)).toBe('locations');
  });

  it('is never offered on a subject the pane picked, a lens, a room element, a proposed or hidden one, or a Title', () => {
    setWorld(world);
    expect(keepLensField('w1', ada, false)).toBeNull();
    expect(keepLensField('w1', lens, true)).toBeNull();
    expect(keepLensField('w1', el(20, 'narrative', 'Hello', { supertype: 'Message', x_room_of: 'w1' }), true)).toBeNull();
    expect(keepLensField('w1', el(21, 'character', 'P', { x_review_proposed: { by: 'm' } }), true)).toBeNull();
    expect(keepLensField('w1', el(22, 'character', 'Heir', { hidden: true }), true)).toBeNull();
    expect(keepLensField('w1', el(23, 'title', 'Engineer'), true)).toBeNull();
  });

  it('is never offered in a demo, a view-only copy, Moppetopia or the tour', () => {
    setWorld(world, { demo: true });
    expect(keepLensField('w1', ada, true)).toBeNull();
    setWorld(world, { copy_of: 'w0' });
    expect(keepLensField('w1', ada, true)).toBeNull();
    setWorld(world);
    patchSlice('active', { worldId: 'w1', meta: { id: '0695db52-5433-7332-8000-db7fe10da375' } } as never);
    expect(keepLensField('w1', ada, true)).toBeNull();
    setWorld(world);
    localStorage.setItem('atlas_tour_v1', JSON.stringify({ active: true }));
    expect(keepLensField('w1', ada, true)).toBeNull();
  });

  it('writes one Construct with the anchor and nothing else, once for a double press', async () => {
    setWorld(world);
    let resolveCreate: (v: Element) => void = () => {};
    const store = {
      listElements: vi.fn(async () => world),
      createElement: vi.fn(() => new Promise<Element>(r => { resolveCreate = r; })),
    };
    const refresh = vi.fn(async () => {});
    const first = keepLensOn('w1', ada, 'characters', store, refresh);
    expect(keepingLens('w1', ada.id)).toBe(true);
    const second = await keepLensOn('w1', ada, 'characters', store, refresh);
    expect(second).toBeNull();
    await vi.waitFor(() => expect(store.createElement).toHaveBeenCalledTimes(1));
    expect(store.createElement).toHaveBeenCalledWith('construct', { name: "Ada's world", supertype: 'Lens', characters: [ada.id] });
    resolveCreate(el(30, 'construct', "Ada's world", { supertype: 'Lens', characters: [ada.id] }));
    expect(await first).toEqual({ id: id(30), name: "Ada's world", made: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(keepingLens('w1', ada.id)).toBe(false);
  });

  it('chooses a lens that already is exactly this one, and writes nothing', async () => {
    const mine = el(31, 'construct', "Ada's world", { supertype: 'Lens', characters: [ada.id], x_lens: {} });
    const store = { listElements: vi.fn(async () => [...world, mine]), createElement: vi.fn() };
    expect(await keepLensOn('w1', ada, 'characters', store as never, async () => {})).toEqual({ id: mine.id, name: "Ada's world", made: false });
    expect(store.createElement).not.toHaveBeenCalled();
  });

  it('a lens with a recipe, another anchor, a served trim or a template is not the same one', () => {
    const base = { supertype: 'Lens', characters: [ada.id] };
    expect(lensOnAlone([el(32, 'construct', 'a', { ...base, x_lens: null })], ada.id, 'characters')?.id).toBe(id(32));
    expect(lensOnAlone([el(33, 'construct', 'b', { ...base, x_lens: { depth: 0 } })], ada.id, 'characters')).toBeNull();
    expect(lensOnAlone([el(34, 'construct', 'c', { ...base, locations: [keep.id] })], ada.id, 'characters')).toBeNull();
    expect(lensOnAlone([el(35, 'construct', 'd', { ...base, x_served_trimmed: ['characters'] })], ada.id, 'characters')).toBeNull();
    expect(lensOnAlone([el(36, 'construct', 'e', { ...base, subtype: 'Template' })], ada.id, 'characters')).toBeNull();
  });
});

describe('the chip\'s list', () => {
  function mountChip() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onChooseLens = vi.fn();
    const handle = mountContextToolbar({
      host,
      initial: {
        presentTypes: new Set(), hiddenTypes: new Set(), effectiveHop: 2, lockLayout: false,
        lens: { chosen: null, choices: [{ id: lens.id, name: 'Two people', template: false }], keep: { name: 'Ada', busy: false } },
      },
      onToggleType: () => {}, onSetHop: () => {}, onToggleLockLayout: () => {}, onChooseLens,
    });
    host.querySelector<HTMLButtonElement>('[data-role="lens-chip"]')!.click();
    return { host, handle, onChooseLens };
  }

  it('an Escape that closes the list is marked, so the drawer and deselect-to-home step aside', async () => {
    mountChip();
    await Promise.resolve();
    expect(document.querySelector('[data-role="lens-menu"]')).not.toBeNull();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    window.dispatchEvent(esc);
    expect(document.querySelector('[data-role="lens-menu"]')).toBeNull();
    expect(escapeOwned(esc)).toBe(true);
    // With the list closed, the next Escape is nobody's mark.
    const next = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    window.dispatchEvent(next);
    expect(escapeOwned(next)).toBe(false);
  });

  it('the list leaves the page with the toolbar', async () => {
    const { handle } = mountChip();
    await Promise.resolve();
    handle.destroy();
    expect(document.querySelector('[data-role="lens-menu"]')).toBeNull();
  });
});
