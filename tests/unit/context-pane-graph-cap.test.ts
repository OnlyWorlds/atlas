/**
 * S367 critic C3: the context graph's ring 1 was uncapped (a Map's backlinks
 * are every pin and marker on it) and the O(iters x n^2) sim reran on every
 * elements swap, because the context tab remounts the graph on each one.
 * Locks: ring 1 caps at RING_CAPS[1] (60) with a "+N more not shown" count
 * in the legend; hiding the flood type lets the rest through; a remount over
 * an unchanged node + edge set reuses the layout instead of rerunning the sim.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach } from 'vitest';
import {
  mountContextGraph, contextGraphSimRuns, clearContextGraphLayoutMemo,
} from '../../src/tabs/right/context-pane-graph';
import { patchSlice } from '../../src/core/state';
import type { Element, ElementType } from '../../src/core/types';

beforeAll(() => {
  // jsdom has no ResizeObserver, and its canvas is "not implemented".
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
beforeEach(() => clearContextGraphLayoutMemo());
afterEach(() => { document.body.innerHTML = ''; });

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function worldWithHub(markers: number, locations = 0): { map: Element; elements: Element[] } {
  const map = { id: uuid(0), type: 'map', name: 'Sikelia' } as unknown as Element;
  const els: Element[] = [map];
  for (let i = 1; i <= markers; i++) {
    els.push({ id: uuid(i), type: 'marker', name: `m${i}`, map: map.id } as unknown as Element);
  }
  for (let i = 1; i <= locations; i++) {
    els.push({ id: uuid(10_000 + i), type: 'location', name: `l${i}`, maps: [map.id] } as unknown as Element);
  }
  return { map, elements: els };
}

function mount(subject: Element, hiddenTypes?: ReadonlySet<ElementType>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const h = mountContextGraph({ host, subject, onSelect: () => {}, hiddenTypes, hopDepth: 1 });
  return { host, h };
}

describe('context graph ring 1 cap (S367 critic C3)', () => {
  it('a Map with 800 markers draws the center plus 60, and says how many were left out', () => {
    const { map, elements } = worldWithHub(800);
    patchSlice('data', { elements });
    const { host, h } = mount(map);
    expect(host.querySelectorAll('.atlas-context-graph-node').length).toBe(61);
    expect(host.querySelector('.atlas-context-graph-legend-more')?.textContent).toBe('+740 more not shown');
    h.destroy();
  });

  it('under the cap nothing is left out and no count shows', () => {
    const { map, elements } = worldWithHub(20);
    patchSlice('data', { elements });
    const { host, h } = mount(map);
    expect(host.querySelectorAll('.atlas-context-graph-node').length).toBe(21);
    expect(host.querySelector('.atlas-context-graph-legend-more')).toBeNull();
    h.destroy();
  });

  it('the cap applies after the type filter: hiding markers lets the locations through', () => {
    const { map, elements } = worldWithHub(800, 5);
    patchSlice('data', { elements });
    const { host, h } = mount(map, new Set<ElementType>(['marker']));
    const ids = Array.from(host.querySelectorAll<HTMLElement>('.atlas-context-graph-node')).map(n => n.dataset.elementId);
    expect(ids.length).toBe(6);
    expect(host.querySelector('.atlas-context-graph-legend-more')).toBeNull();
    h.destroy();
  });
});

describe('context graph layout memo (S367 critic C3)', () => {
  it('a remount over a new elements array with the same node and edge set does not rerun the sim', () => {
    const { map, elements } = worldWithHub(30);
    patchSlice('data', { elements });
    const first = mount(map);
    const before = contextGraphSimRuns();
    const pos = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('.atlas-context-graph-node'))
      .map(n => `${n.dataset.elementId}@${n.style.left},${n.style.top}`);
    const firstPos = pos(first.host);
    first.h.destroy();
    first.host.remove();

    // An autosave-style swap: new array, new objects, an edited description.
    patchSlice('data', { elements: elements.map(e => ({ ...e, description: 'edited' })) });
    const second = mount(map);
    expect(contextGraphSimRuns()).toBe(before);
    expect(pos(second.host)).toEqual(firstPos);
    second.h.destroy();
  });

  it('a changed node set does rerun it', () => {
    const { map, elements } = worldWithHub(30);
    patchSlice('data', { elements });
    mount(map).h.destroy();
    const before = contextGraphSimRuns();
    patchSlice('data', { elements: [...elements, { id: uuid(99), type: 'marker', name: 'new', map: map.id } as unknown as Element] });
    mount(map).h.destroy();
    expect(contextGraphSimRuns()).toBe(before + 1);
  });
});
