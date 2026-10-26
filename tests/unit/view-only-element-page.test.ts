/**
 * A view-only world reads (conv. 149): the element page's rows are not
 * doors there, and no create door opens. Each case runs on a writable world
 * too, the control: the same render offers what the view-only one withholds.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderSection } from '../../src/middle/element-detail-fields';
import { paletteRows } from '../../src/ui/command-palette';
import { openCreateDoor } from '../../src/ui/create-element-door';
import { worldIsViewOnly } from '../../src/core/view-only';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import type { ToastManager } from '../../src/ui/toast-manager';

const WORLD = 'w-view';
const FRIEND = '00000000-0000-4000-8000-0000000000c2';

function openWorld(readOnly: boolean): void {
  const entry = {
    id: WORLD, name: 'Shared', state: 'api-linked',
    api: { world_id: 's1', api_key: 'k', read_only: readOnly },
  } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: WORLD, meta: { name: 'Shared' } } as never);
}

const ana = {
  id: '00000000-0000-4000-8000-0000000000c1', type: 'character', name: 'Ana',
  description: 'A scout', atlas_aliases: [], friends: [FRIEND], birthplace: null,
  local_updated_at: '2026-10-19T10:00:00.000Z',
} as unknown as Element;
const bo = { id: FRIEND, type: 'character', name: 'Bo', local_updated_at: '2026-10-19T10:00:00.000Z' } as unknown as Element;

function section(): HTMLElement {
  patchSlice('data', { elements: [ana, bo] } as never);
  const s = renderSection({
    name: 'S', order: 1, fields: [
      { name: 'description', widget: 'text-long' },
      { name: 'atlas_aliases', widget: 'text-short' },
      { name: 'friends', widget: 'multi-link', target: 'character' },
      { name: 'birthplace', widget: 'single-link', target: 'location' },
    ] as never,
  }, ana, true)!;
  document.body.appendChild(s);
  return s;
}

afterEach(() => {
  document.body.innerHTML = '';
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
  patchSlice('data', { elements: [] } as never);
});

describe('worldIsViewOnly', () => {
  it('reads the active world\'s read_only flag', () => {
    openWorld(true);
    expect(worldIsViewOnly()).toBe(true);
    openWorld(false);
    expect(worldIsViewOnly()).toBe(false);
    patchSlice('active', null);
    expect(worldIsViewOnly()).toBe(false);
  });
});

describe('the element page\'s rows on a view-only world', () => {
  it('offer no picker, no ×, no aliases invitation and open no editor', () => {
    openWorld(true);
    const s = section();
    expect(s.querySelectorAll('.atlas-link-pick')).toHaveLength(0);
    expect(s.querySelectorAll('.atlas-link-chip-remove')).toHaveLength(0);
    expect(s.querySelector('.atlas-link-chip')?.textContent).toContain('Bo');
    expect(s.querySelector('.atlas-aliases-display-empty')).toBeNull();
    expect(s.querySelector('.atlas-field-label-clickable')).toBeNull();
    s.querySelector<HTMLElement>('[data-field="description"] .atlas-field-value')!.click();
    expect(document.querySelector('.atlas-edit-popover')).toBeNull();
  });

  it('control: a writable world offers all of them', () => {
    openWorld(false);
    const s = section();
    expect(s.querySelectorAll('.atlas-link-pick')).toHaveLength(2);
    expect(s.querySelectorAll('.atlas-link-chip-remove')).toHaveLength(1);
    expect(s.querySelector('.atlas-aliases-display-empty')).not.toBeNull();
    s.querySelector<HTMLElement>('[data-field="description"] .atlas-field-value')!.click();
    expect(document.querySelector('.atlas-edit-popover')).not.toBeNull();
  });
});

describe('the create doors on a view-only world', () => {
  it('the palette offers no Create row; a writable world does', () => {
    openWorld(true);
    expect(paletteRows('Nobody here', []).some(r => r.kind === 'create')).toBe(false);
    openWorld(false);
    expect(paletteRows('Nobody here', []).some(r => r.kind === 'create')).toBe(true);
  });

  it('the shared door opens no modal and says why once', () => {
    openWorld(true);
    const toasts = { info: vi.fn(), error: vi.fn(), success: vi.fn() } as unknown as ToastManager;
    openCreateDoor(toasts);
    expect(document.querySelector('.atlas-modal-overlay, [data-modal]')).toBeNull();
    expect(toasts.info).toHaveBeenCalledWith('This world is view-only, so nothing can be added here.');
  });
});
