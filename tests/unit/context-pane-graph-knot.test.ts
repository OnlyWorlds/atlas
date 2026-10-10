/**
 * #141 (S387): Admiral Fluffington's web on Moppetopia piled into one knot.
 * Two causes, each guarded here on the real neighbourhood (the fixture is
 * Moppetopia's two hops around him, names and links only):
 *  - the sim had no step limit, so two nodes passing close flung a third far
 *    out (Medal of Damp Valor at x -986 against a median of 174), and the fit
 *    to the pane shrank everything else into the middle;
 *  - nodes were kept 56 apart where the pane draws them about 0.75 to 1, and
 *    nothing kept a place clear for the subject's own label.
 * The label pass itself is `graph-labels.test.ts`; the ink is measured in
 * Chromium and Firefox by the S387 walk.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  mountContextGraph, clearContextGraphLayoutMemo, contextGraphLastLayout, contextGraphLayoutRules,
} from '../../src/tabs/right/context-pane-graph';
import { patchSlice } from '../../src/core/state';
import type { Element } from '../../src/core/types';
import world from '../fixtures/moppetopia-fluffington-web.json';

beforeAll(() => {
  // jsdom has no ResizeObserver, and its canvas is "not implemented".
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
beforeEach(() => clearContextGraphLayoutMemo());
afterEach(() => { document.body.innerHTML = ''; });

const elements = world as unknown as Element[];
const fluffington = elements.find(e => e.name === 'Admiral Fluffington')!;

function layoutAt(hopDepth: 1 | 2) {
  patchSlice('data', { elements });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const h = mountContextGraph({ host, subject: fluffington, onSelect: () => {}, hopDepth });
  const nodes = [...contextGraphLastLayout()];
  h.destroy();
  return nodes;
}

describe.each([1, 2] as const)('Fluffington at depth %i', (hop) => {
  it('lays out the whole neighbourhood', () => {
    expect(layoutAt(hop).length).toBe(hop === 1 ? 31 : 43);
  });

  it('flings no node far out: the farthest is within twice the median distance', () => {
    const radii = layoutAt(hop).filter(n => !n.isCenter).map(n => Math.hypot(n.x, n.y)).sort((a, b) => a - b);
    const median = radii[radii.length >> 1];
    expect(radii[radii.length - 1]).toBeLessThanOrEqual(median * 2);
  });

  it('keeps every pair of nodes the collision distance apart', () => {
    const nodes = layoutAt(hop);
    const { minDist } = contextGraphLayoutRules(fluffington.name);
    let closest = Infinity;
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      closest = Math.min(closest, Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y));
    }
    expect(closest).toBeGreaterThanOrEqual(minDist - 2);
  });

  it('keeps the slot under the subject clear for its label', () => {
    const { minDist, slot } = contextGraphLayoutRules(fluffington.name);
    const r = minDist / 2;
    const inSlot = layoutAt(hop).filter(n => !n.isCenter
      && n.x + r > -slot.halfW + 1 && n.x - r < slot.halfW - 1 && n.y + r > slot.top + 1 && n.y - r < slot.bottom - 1);
    expect(inSlot).toEqual([]);
  });
});
