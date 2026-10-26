/**
 * Esc while drawing or reshaping a zone belongs to the zone
 * mode (cancel the draft, revert the shape). The global deselect-to-home
 * binding must stand down, or the user is also thrown to home.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import L from 'leaflet';
import { installHotkeys, setHotkeyCallbacks, uninstallHotkeys } from '../../src/core/hotkeys';
import { startDrawing, isDrawing, cancelDrawing } from '../../src/tabs/right/zone-drawing';

afterEach(() => {
  uninstallHotkeys();
  cancelDrawing();
  document.body.innerHTML = '';
  window.location.hash = '';
});

function esc(target: HTMLElement): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

function focusable(className = ''): HTMLElement {
  const el = document.createElement('div');
  el.tabIndex = 0;
  el.className = className;
  document.body.appendChild(el);
  el.focus();
  return el;
}

describe('C9: Esc in zone modes does not deselect to home', () => {
  it('drawing: Esc cancels the draft only', () => {
    const deselect = vi.fn();
    setHotkeyCallbacks({ hasSelectedElement: () => true, deselectToHome: deselect, getActiveWorldId: () => 'w1' });
    installHotkeys();
    window.location.hash = '#/w/w1/element/loc-1';

    const wrapper = document.createElement('div');
    const container = document.createElement('div');
    container.tabIndex = 0;
    const toolbar = document.createElement('div');
    wrapper.appendChild(container);
    wrapper.appendChild(toolbar);
    document.body.appendChild(wrapper);
    const lMap = L.map(container, { crs: L.CRS.Simple }).setView([0, 0], 0);
    const entry = { mapId: 'map-1', worldId: 'w1', wrapper, container, toolbar, manager: { getMap: () => lMap } } as never;
    const toasts = { error: vi.fn(), info: vi.fn(), success: vi.fn() } as never;
    startDrawing(entry, 'polygon', toasts);
    expect(isDrawing()).toBe(true);

    container.focus();
    esc(container);

    expect(isDrawing()).toBe(false);
    expect(deselect).not.toHaveBeenCalled();
    lMap.remove();
  });

  it('zone edit: Esc with the edit-mode container present does not deselect', () => {
    const deselect = vi.fn();
    setHotkeyCallbacks({ hasSelectedElement: () => true, deselectToHome: deselect });
    installHotkeys();
    window.location.hash = '#/w/w1/map/map-1/element/zone-1';
    esc(focusable('atlas-zone-editing'));
    expect(deselect).not.toHaveBeenCalled();
  });

  it('control: Esc with a selection and no zone mode still deselects to home', () => {
    const deselect = vi.fn();
    setHotkeyCallbacks({ hasSelectedElement: () => true, deselectToHome: deselect });
    installHotkeys();
    window.location.hash = '#/w/w1/map/map-1/element/zone-1';
    esc(focusable());
    expect(deselect).toHaveBeenCalledTimes(1);
  });
});
