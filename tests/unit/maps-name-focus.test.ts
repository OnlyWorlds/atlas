/**
 * Enter or Space on a map's name in the Maps tab opens the map as a tab in
 * the right pane, and the tab's pane replaces the list the name sat in: focus
 * lands on the map's tab, never the page. The tab bar may draw again while it
 * holds focus (its key holds the map's name): focus goes to the tab drawn in
 * its place. A mouse click (a click with a pointer, detail 1) moves no focus,
 * so no ring is drawn after it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import type { ToastManager } from '../../src/ui/toast-manager';
import { focusArrival } from '../../src/ui/focus-arrival';

// The map's own pane draws a Leaflet canvas jsdom cannot hold; this is about the tab and the focus.
vi.mock('../../src/tabs/right/map-tab', () => ({
  mountMapTab: (pane: HTMLElement) => { pane.innerHTML = '<div class="atlas-map-pane"></div>'; },
  disposeMapTab: () => {},
  disposeAllMapTabs: () => {},
  panMapTabTo: () => {},
}));

// jsdom has no CSS.escape; the ids here hold no character it would change.
const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } };
if (!g.CSS?.escape) g.CSS = { ...(g.CSS ?? {}), escape: (s: string) => s };

const WORLD = 'w-maps-focus';
const MAP = '00000000-0000-4000-8000-0000000000b1';

function map(name: string): Element {
  return { id: MAP, type: 'map', name, local_updated_at: '2026-11-21T10:00:00.000Z' } as Element;
}

function fakeToasts(): ToastManager {
  return { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() } as unknown as ToastManager;
}

const frames = async (n = 2): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise<void>(r => requestAnimationFrame(() => r()));
};

let unmount: (() => void) | null = null;

async function mountPane() {
  const { mountRightPane } = await import('../../src/tabs/right/right-pane');
  const entry = { id: WORLD, name: 'Maps', state: 'local-only' } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: WORLD, meta: { name: 'Maps' } } as never);
  patchSlice('data', { ...getState().data, elements: [map('Harbour chart')] });
  patchSlice('ui', { ...getState().ui, rightTabs: [{ kind: 'map-index' }], rightActiveIndex: 0 } as never);
  const tabBar = document.createElement('div');
  const pane = document.createElement('div');
  document.body.append(tabBar, pane);
  unmount = mountRightPane({ tabBar, pane, toasts: fakeToasts() });
  const name = pane.querySelector<HTMLElement>('.atlas-map-tree-name')!;
  const mapTab = (): HTMLElement | null => tabBar.querySelector<HTMLElement>(`.atlas-tab.active[data-tab-map-id="${MAP}"]`);
  return { tabBar, pane, name, mapTab };
}

afterEach(() => {
  // A press's watch outlives its test (it looks for a while): a new watch that finds nothing ends it.
  focusArrival(() => null);
  unmount?.();
  unmount = null;
  document.body.innerHTML = '';
  patchSlice('ui', { ...getState().ui, rightTabs: [], rightActiveIndex: 0 } as never);
  patchSlice('data', { ...getState().data, elements: [] });
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
});

describe("Enter or Space on a map's name", () => {
  it("opens the map and lands focus on its tab, never the page", async () => {
    const { name, pane, mapTab } = await mountPane();
    expect(name.textContent).toBe('Harbour chart');
    name.focus();
    // Enter on a native button, as Space's release: a click with no pointer.
    name.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(pane.querySelector('.atlas-map-pane')).not.toBeNull();
    expect(name.isConnected).toBe(false);
    await frames();
    expect(mapTab()).not.toBeNull();
    expect(document.activeElement).toBe(mapTab());
  });

  it('keeps focus on the tab drawn again in its place while it holds it', async () => {
    const { name, mapTab } = await mountPane();
    name.focus();
    name.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    await frames();
    const first = mapTab();
    expect(document.activeElement).toBe(first);
    // A rename lands (a pull, another tab): the bar's key holds the name, so it draws again.
    patchSlice('data', { ...getState().data, elements: [map('Harbour chart, second survey')] });
    expect(first!.isConnected).toBe(false);
    await frames();
    expect(mapTab()!.textContent).toContain('second survey');
    expect(document.activeElement).toBe(mapTab());
  });

  it('control: a mouse click opens the same tab and moves no focus', async () => {
    const { name, mapTab } = await mountPane();
    name.focus();
    name.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await frames();
    expect(mapTab()).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});
