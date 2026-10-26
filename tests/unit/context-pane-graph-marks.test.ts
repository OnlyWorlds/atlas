/**
 * The context graph draws a proposed or a hidden element with its mark, never
 * plain, as every other surface does: a class for the dotted ring, the word in
 * the label, its line in the tooltip. A settled element repaints plain, even
 * when the layout is reused.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach } from 'vitest';
import { mountContextGraph, clearContextGraphLayoutMemo } from '../../src/tabs/right/context-pane-graph';
import { patchSlice } from '../../src/core/state';
import type { Element } from '../../src/core/types';

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
beforeEach(() => clearContextGraphLayoutMemo());
afterEach(() => { document.body.innerHTML = ''; });

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const center = { id: uuid(0), type: 'location', name: 'Harbour', characters: [uuid(1), uuid(2), uuid(3)] } as unknown as Element;
const proposed = { id: uuid(1), type: 'character', name: 'Ada', x_review_proposed: { by: 'm2' } } as unknown as Element;
const hidden = { id: uuid(2), type: 'character', name: 'Bo', hidden: true } as unknown as Element;
const plain = { id: uuid(3), type: 'character', name: 'Cy' } as unknown as Element;

function mount(elements: Element[]): HTMLElement {
  patchSlice('data', { elements } as never);
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountContextGraph({ host, subject: center, onSelect: () => {}, hopDepth: 1 });
  return host;
}
const node = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.atlas-context-graph-node[data-element-id="${id}"]`)!;

describe('the graph marks proposed and hidden elements', () => {
  it('a proposed node says Proposed, a hidden one Hidden, a plain one nothing', () => {
    const host = mount([center, proposed, hidden, plain]);
    const p = node(host, proposed.id);
    expect(p.classList.contains('is-proposed')).toBe(true);
    expect(p.querySelector('.atlas-context-graph-node-mark')?.textContent).toBe('Proposed');
    expect(p.title).toMatch(/not yet reviewed/);
    const h = node(host, hidden.id);
    expect(h.classList.contains('is-hidden')).toBe(true);
    expect(h.querySelector('.atlas-context-graph-node-mark')?.textContent).toBe('Hidden');
    expect(h.title).toMatch(/^Bo\nHidden/);
    const c = node(host, plain.id);
    expect(c.classList.contains('is-proposed') || c.classList.contains('is-hidden')).toBe(false);
    expect(c.querySelector('.atlas-context-graph-node-mark')).toBeNull();
  });

  it('both marks on one element say both words', () => {
    const both = { ...proposed, hidden: true } as unknown as Element;
    const host = mount([center, both, hidden, plain]);
    expect(node(host, both.id).querySelector('.atlas-context-graph-node-mark')?.textContent).toBe('Proposed, Hidden');
  });

  it('a proposal accepted repaints plain on the same layout', () => {
    mount([center, proposed, hidden, plain]);
    document.body.innerHTML = '';
    const settled = { ...proposed, x_review_proposed: null } as unknown as Element;
    const host = mount([center, settled, hidden, plain]);
    expect(node(host, proposed.id).classList.contains('is-proposed')).toBe(false);
    expect(node(host, proposed.id).querySelector('.atlas-context-graph-node-mark')).toBeNull();
  });
});
