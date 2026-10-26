/**
 * Two world.json saves in quick succession keep both in the active mirror:
 * the units' fields each patched a snapshot of the active world taken
 * before their write's await, so Length then Mass on blur left Mass alone in
 * the mirror while the disk held both. CI's full e2e caught it as a "flaky"
 * units test (run 39944009185, phase35-settings:185, the field read "").
 * Here the writes are held and let go in order, so the race always happens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const held: Array<() => void> = [];
const written: Record<string, unknown> = {};
vi.mock('../../src/core/active-store', () => ({
  getActiveStore: () => ({
    writeWorldMeta: (patch: Record<string, unknown>) =>
      new Promise<void>(res => { held.push(() => { Object.assign(written, patch); res(); }); }),
  }),
  setActiveStore: vi.fn(),
  evictParkedStore: vi.fn(),
}));

import { getState, patchActiveMeta, patchSlice } from '../../src/core/state';
import type { WorldRegistryEntry } from '../../src/core/types';
import { wireUnitFields } from '../../src/middle/settings-world';

const tick = () => new Promise(r => setTimeout(r, 0));
const toasts = { info: vi.fn(), error: vi.fn() } as never;
const world = { id: 'w', name: 'Unit World', state: 'local-only' } as unknown as WorldRegistryEntry;

function field(name: string): HTMLInputElement {
  const input = document.createElement('input');
  input.dataset.unitField = name;
  document.querySelector('.atlas-settings')!.appendChild(input);
  return input;
}

beforeEach(() => {
  held.length = 0;
  for (const k of Object.keys(written)) delete written[k];
  document.body.innerHTML = '<div class="atlas-settings"></div>';
  patchSlice('active', { worldId: 'w', meta: { id: 'w', name: 'Unit World' }, opened: true } as never);
});
afterEach(() => { document.body.innerHTML = ''; patchSlice('active', null); });

describe('the world meta mirror', () => {
  it('Length then Mass, their writes landing in order: the mirror holds both, as the disk does', async () => {
    const length = field('length_unit');
    const mass = field('mass_unit');
    wireUnitFields(world, toasts);
    length.value = ' cm ';
    length.dispatchEvent(new Event('change'));
    mass.value = 'stone';
    mass.dispatchEvent(new Event('change'));
    await tick();
    expect(held).toHaveLength(2);
    held[0]();
    await tick();
    held[1]();
    await tick();
    expect(written).toEqual({ length_unit: 'cm', mass_unit: 'stone' });
    const meta = getState().active!.meta as unknown as Record<string, unknown>;
    expect([meta.length_unit, meta.mass_unit]).toEqual(['cm', 'stone']);
  });

  it('a write that lands after another world opened leaves that world alone', () => {
    patchSlice('active', { worldId: 'other', meta: { id: 'other', name: 'Other' }, opened: true } as never);
    patchActiveMeta('w', { length_unit: 'cm' });
    expect((getState().active!.meta as unknown as Record<string, unknown>).length_unit).toBeUndefined();
  });
});
