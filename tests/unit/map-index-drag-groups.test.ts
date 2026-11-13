/**
 * Drag in the map index reorders only inside one of the standard's groups
 * (map-tree.ts siblingGroupOf). Under a region map, a map set there by Parent
 * map and a floor map placed there by its location stand in different groups,
 * whose hierarchy numbers are never compared: a drop from one onto the other
 * says so and writes nothing. Control: a drop inside one group restamps it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import { setActiveStore } from '../../src/core/active-store';
import { mountMapIndexTab } from '../../src/tabs/right/map-index-tab';
import type { ToastManager } from '../../src/ui/toast-manager';

// jsdom has no CSS.escape; the ids and group keys here hold no character it would change.
const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } };
if (!g.CSS?.escape) g.CSS = { ...(g.CSS ?? {}), escape: (s: string) => s };

const WORLD = 'w-drag';
const id = (n: number): string => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const REGION = id(1), EXPLICIT_A = id(2), EXPLICIT_B = id(3), FLOOR = id(4);
const P = id(50), L = id(51);

function el(eid: string, type: string, name: string, extra: Record<string, unknown> = {}): Element {
  return { id: eid, type, name, local_updated_at: '2026-11-14T00:00:00.000Z', ...extra } as Element;
}

function openWorld(): void {
  const entry = { id: WORLD, name: 'Drag', state: 'local-only' } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: WORLD, meta: { name: 'Drag' } } as never);
  patchSlice('data', {
    ...getState().data,
    elements: [
      el(P, 'location', 'Province'),
      el(L, 'location', 'Lowmarsh', { parent_location: P }),
      el(REGION, 'map', 'Region', { location: P }),
      el(EXPLICIT_A, 'map', 'Coast', { parent_map: REGION, hierarchy: 0 }),
      el(EXPLICIT_B, 'map', 'Hills', { parent_map: REGION, hierarchy: 1 }),
      el(FLOOR, 'map', 'Floor', { location: L, hierarchy: 0 }),
    ],
  });
}

function drag(root: HTMLElement, from: string, onto: string): void {
  const row = (mid: string) => root.querySelector<HTMLElement>(`.atlas-map-tree-row[data-map-id="${mid}"]`)!;
  const fire = (target: HTMLElement, type: string) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { setData: () => {}, effectAllowed: '', dropEffect: '' } });
    target.dispatchEvent(ev);
  };
  fire(row(from), 'dragstart');
  fire(row(onto), 'drop');
}

afterEach(() => {
  setActiveStore(null);
  document.body.innerHTML = '';
  patchSlice('data', { ...getState().data, elements: [] });
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
});

describe('map index drag stays inside one group', () => {
  const setup = () => {
    openWorld();
    const updateMap = vi.fn(async () => undefined);
    setActiveStore({ updateMap } as never);
    const toasts = { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn(), problem: vi.fn() } as unknown as ToastManager;
    const target = document.createElement('div');
    document.body.appendChild(target);
    mountMapIndexTab(target, toasts);
    return { target, updateMap, toasts };
  };

  it('a drop from a location-placed map onto a Parent map child writes nothing and says why', async () => {
    const { target, updateMap, toasts } = setup();
    const rows = [...target.querySelectorAll<HTMLElement>('.atlas-map-tree-row')].map((r) => r.dataset.mapId);
    expect(rows).toEqual([REGION, EXPLICIT_A, EXPLICIT_B, FLOOR]);
    drag(target, FLOOR, EXPLICIT_A);
    await Promise.resolve();
    expect(updateMap).not.toHaveBeenCalled();
    expect((toasts.info as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ')).toContain('same group');
  });

  it('control: a drop inside the Parent map group restamps that group only', async () => {
    const { target, updateMap } = setup();
    drag(target, EXPLICIT_A, EXPLICIT_B);
    await Promise.resolve();
    const written = updateMap.mock.calls.map((c) => (c as unknown[])[0]);
    expect(written.length).toBeGreaterThan(0);
    expect(written).not.toContain(FLOOR);
    expect(written.every((w) => w === EXPLICIT_A || w === EXPLICIT_B)).toBe(true);
  });
});
