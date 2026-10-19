/**
 * Maps on a view-only world (conv. 149): the store refuses every UI write
 * there, so the map surfaces offer none. No draw buttons, no pin drag, no
 * flip or drag lock in the visual settings, no New map, reorder or delete in
 * the index, no swatch, tune or delete in the zone panel, and the canvas
 * gestures (place a pin, right-click New pin, drop from the sidebar, z and l,
 * zone edit) do nothing. Every case runs a writable world as its control.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import { setActiveStore } from '../../src/core/active-store';
import { buildCanvasToolbar } from '../../src/tabs/right/map-tab-toolbar';
import { enablePinDrag } from '../../src/tabs/right/map-tab-pin-drag';
import { visualSettingsTemplate } from '../../src/tabs/right/map-visual-settings-popover';
import { FACTORY_DEFAULTS } from '../../src/core/map-view-prefs';
import { mountMapIndexTab } from '../../src/tabs/right/map-index-tab';
import { renderZonePanel } from '../../src/tabs/right/map-zone-panel';
import { startDrawing, getActiveDraft, cancelDrawing } from '../../src/tabs/right/zone-drawing';
import { enterEditMode } from '../../src/tabs/right/zone-edit-mode';
import { wireMapInteractions } from '../../src/tabs/right/map-tab-interactions';
import type { MapTabCacheEntry } from '../../src/tabs/right/map-tab-cache';
import type { ToastManager } from '../../src/ui/toast-manager';

const WORLD = 'w-view';
const MAP = '00000000-0000-4000-8000-0000000000a1';

function openWorld(readOnly: boolean, elements: Element[] = []): void {
  const entry = {
    id: WORLD,
    name: 'Shared',
    state: 'api-linked',
    api: { world_id: 's1', api_key: 'k', read_only: readOnly },
  } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: WORLD, meta: { name: 'Shared' } } as never);
  patchSlice('data', { ...getState().data, elements });
}

function el(id: string, type: string, extra: Record<string, unknown> = {}): Element {
  return { id, type, name: `${type} ${id.slice(-2)}`, local_updated_at: '2026-10-19T10:00:00.000Z', ...extra } as Element;
}

function fakeToasts(): ToastManager {
  return { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() } as unknown as ToastManager;
}

afterEach(() => {
  cancelDrawing();
  setActiveStore(null);
  document.body.innerHTML = '';
  patchSlice('ui', { ...getState().ui, pinPlacement: null });
  patchSlice('data', { ...getState().data, elements: [] });
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
});

describe('the canvas toolbar', () => {
  it('has no draw buttons on a view-only world', () => {
    openWorld(true);
    const refs = buildCanvasToolbar();
    expect(refs.root.querySelector('[data-action="draw-polygon"]')).toBeNull();
    expect(refs.root.querySelector('[data-action="draw-line"]')).toBeNull();
    expect(refs.root.querySelector('[data-action="map-visual-settings"]')).not.toBeNull();
    expect(refs.root.querySelector('[data-action="toggle-pins-visibility"]')).not.toBeNull();
  });

  it('control: a writable world has both', () => {
    openWorld(false);
    const refs = buildCanvasToolbar();
    expect(refs.root.querySelector('[data-action="draw-polygon"]')).not.toBeNull();
    expect(refs.root.querySelector('[data-action="draw-line"]')).not.toBeNull();
  });
});

describe('pin drag', () => {
  const fakeMarker = () => ({ dragging: { enable: vi.fn(), disable: vi.fn() }, on: vi.fn(), options: {} });
  const fakeEntry = () => ({ manager: { getConfig: () => ({ canvasHeight: 100, canvasWidth: 100 }) } }) as unknown as MapTabCacheEntry;

  it('never wakes on a view-only world', () => {
    openWorld(true);
    const marker = fakeMarker();
    enablePinDrag(fakeEntry(), marker, 'p1');
    expect(marker.dragging.enable).not.toHaveBeenCalled();
    expect(marker.on).not.toHaveBeenCalled();
  });

  it('control: a writable world drags, with move and trash wired', () => {
    openWorld(false);
    const marker = fakeMarker();
    enablePinDrag(fakeEntry(), marker, 'p1');
    expect(marker.dragging.enable).toHaveBeenCalled();
    expect(marker.on.mock.calls.map(c => c[0])).toEqual(['dragstart', 'drag', 'dragend']);
  });
});

describe('map visual settings', () => {
  const host = (): HTMLElement => {
    const d = document.createElement('div');
    d.innerHTML = visualSettingsTemplate(FACTORY_DEFAULTS, false);
    return d;
  };

  it('offers no flip and no drag lock on a view-only world, and keeps the view prefs', () => {
    openWorld(true);
    const d = host();
    expect(d.querySelector('[data-action="flip-map"]')).toBeNull();
    expect(d.querySelector('[data-field="lock_pin_drag"]')).toBeNull();
    expect(d.textContent).not.toContain('Upside down?');
    expect(d.querySelector('[data-field="show_grid"]')).not.toBeNull();
    expect(d.querySelector('[data-action="save-as-default"]')).not.toBeNull();
  });

  it('control: a writable world offers both', () => {
    openWorld(false);
    const d = host();
    expect(d.querySelector('[data-action="flip-map"]')).not.toBeNull();
    expect(d.querySelector('[data-field="lock_pin_drag"]')).not.toBeNull();
  });
});

describe('the map index', () => {
  const mount = (): HTMLElement => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    mountMapIndexTab(target, fakeToasts());
    return target;
  };
  const maps = [el(MAP, 'map'), el('00000000-0000-4000-8000-0000000000a2', 'map')];

  it('has no New map, no draggable rows and no delete on a view-only world', () => {
    openWorld(true, maps);
    const t = mount();
    expect(t.querySelectorAll('.atlas-map-tree-row').length).toBe(2);
    expect(t.querySelector('[data-action="new-map"]')).toBeNull();
    expect(t.querySelector('.atlas-map-tree-row[draggable="true"]')).toBeNull();
    expect(t.querySelector('[data-action="delete-map"]')).toBeNull();
  });

  it('control: a writable world has all three', () => {
    openWorld(false, maps);
    const t = mount();
    expect(t.querySelector('[data-action="new-map"]')).not.toBeNull();
    expect(t.querySelectorAll('.atlas-map-tree-row[draggable="true"]').length).toBe(2);
    expect(t.querySelectorAll('[data-action="delete-map"]').length).toBe(2);
  });
});

describe('the zone panel', () => {
  const zone = el('00000000-0000-4000-8000-0000000000c1', 'zone', { supertype: 'Forest' });
  const render = (): HTMLElement => {
    const zoneStrip = document.createElement('div');
    zoneStrip.classList.add('is-open');
    const toolbar = document.createElement('div');
    const entry = {
      mapId: MAP, zoneStrip, toolbar, hiddenZoneKinds: new Set(), zoneDate: { kind: 'all' },
    } as unknown as MapTabCacheEntry;
    renderZonePanel(entry, [zone as never], null);
    return zoneStrip;
  };

  it('lists the zone with no swatch picker, tune or delete on a view-only world', () => {
    openWorld(true, [zone]);
    const strip = render();
    expect(strip.querySelector('.atlas-zone-chip')).not.toBeNull();
    expect(strip.querySelector('[data-action="toggle-kind-visible"]')).not.toBeNull();
    expect(strip.querySelector('[data-action="swatch"]')).toBeNull();
    expect(strip.querySelector('[data-action="tune"]')).toBeNull();
    expect(strip.querySelector('[data-action="delete"]')).toBeNull();
  });

  it('control: a writable world offers all three', () => {
    openWorld(false, [zone]);
    const strip = render();
    expect(strip.querySelector('[data-action="swatch"]')).not.toBeNull();
    expect(strip.querySelector('[data-action="tune"]')).not.toBeNull();
    expect(strip.querySelector('[data-action="delete"]')).not.toBeNull();
  });
});

describe('the zone backstops', () => {
  it('startDrawing starts no draft on a view-only world', () => {
    openWorld(true);
    const getMap = vi.fn(() => null);
    startDrawing({ manager: { getMap } } as unknown as MapTabCacheEntry, 'polygon', fakeToasts());
    expect(getMap).not.toHaveBeenCalled();
    expect(getActiveDraft()).toBeNull();
  });

  it('control: a writable world reaches for the map', () => {
    openWorld(false);
    const getMap = vi.fn(() => null);
    startDrawing({ manager: { getMap } } as unknown as MapTabCacheEntry, 'polygon', fakeToasts());
    expect(getMap).toHaveBeenCalled();
  });

  it('enterEditMode opens nothing on a view-only world', () => {
    openWorld(true);
    const toasts = fakeToasts();
    enterEditMode('z1', MAP, toasts);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('control: a writable world tries (and asks for the map, which is not open here)', () => {
    openWorld(false);
    const toasts = fakeToasts();
    enterEditMode('z1', MAP, toasts);
    expect(toasts.error).toHaveBeenCalled();
  });
});

describe('the canvas gestures', () => {
  function wire() {
    const handlers = new Map<string, (ev: unknown) => unknown>();
    const lMapHandlers = new Map<string, (ev: unknown) => unknown>();
    const lMap = {
      on: (name: string, fn: (ev: unknown) => unknown) => { lMapHandlers.set(name, fn); },
      mouseEventToLatLng: () => ({ lat: 50, lng: 50 }),
    };
    const manager = {
      on: (name: string, fn: (ev: unknown) => unknown) => { handlers.set(name, fn); },
      getMap: () => lMap,
      fitToCanvas: vi.fn(),
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const entry = { mapId: MAP, manager: { getMap: () => null } } as unknown as MapTabCacheEntry;
    wireMapInteractions({
      entry, manager: manager as never, container, tooltip: document.createElement('div'),
      width: 100, height: 100, mapId: MAP, toasts: fakeToasts(),
    });
    return { handlers, lMapHandlers, container };
  }
  const pinned = el('00000000-0000-4000-8000-0000000000b1', 'character');
  const fakeStore = () => ({ createPin: vi.fn(async () => ({})), listElements: vi.fn(async () => []), getElement: vi.fn() });

  it('an armed placement places no pin on a view-only world', async () => {
    openWorld(true, [pinned]);
    const store = fakeStore();
    setActiveStore(store as never);
    patchSlice('ui', { ...getState().ui, pinPlacement: { elementId: pinned.id } });
    const { handlers } = wire();
    await handlers.get('map-click')!({ point: { x: 10, y: 10 } });
    expect(store.createPin).not.toHaveBeenCalled();
  });

  it('control: a writable world places it', async () => {
    openWorld(false, [pinned]);
    const store = fakeStore();
    setActiveStore(store as never);
    patchSlice('ui', { ...getState().ui, pinPlacement: { elementId: pinned.id } });
    const { handlers } = wire();
    await handlers.get('map-click')!({ point: { x: 10, y: 10 } });
    expect(store.createPin).toHaveBeenCalled();
  });

  it('right-click opens no New pin on a view-only world (the browser menu stays)', async () => {
    openWorld(true);
    const { lMapHandlers } = wire();
    const preventDefault = vi.fn();
    await lMapHandlers.get('contextmenu')!({ originalEvent: { preventDefault }, latlng: { lat: 1, lng: 1 } });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(document.querySelector('.atlas-modal, [role="dialog"]')).toBeNull();
  });

  it('control: a writable world takes the right-click', async () => {
    openWorld(false);
    const { lMapHandlers } = wire();
    const preventDefault = vi.fn();
    // No latlng returns before the modal: enough to see the gesture taken.
    await lMapHandlers.get('contextmenu')!({ originalEvent: { preventDefault }, latlng: undefined });
    expect(preventDefault).toHaveBeenCalled();
  });

  const dragover = (): Event => {
    const ev = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['application/x-atlas-element'], dropEffect: '' } });
    return ev;
  };

  it('is no drop target on a view-only world', () => {
    openWorld(true);
    const { container } = wire();
    const ev = dragover();
    container.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(container.classList.contains('atlas-map-drop-target')).toBe(false);
  });

  it('control: a writable world takes the drop', () => {
    openWorld(false);
    const { container } = wire();
    const ev = dragover();
    container.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  const key = (k: string): KeyboardEvent => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });

  it('z and l stay plain keys on a view-only world; f still fits', () => {
    openWorld(true);
    const { container } = wire();
    for (const k of ['z', 'l']) {
      const ev = key(k);
      container.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    const f = key('f');
    container.dispatchEvent(f);
    expect(f.defaultPrevented).toBe(true);
  });

  it('control: a writable world takes z and l', () => {
    openWorld(false);
    const { container } = wire();
    for (const k of ['z', 'l']) {
      const ev = key(k);
      container.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
  });
});
