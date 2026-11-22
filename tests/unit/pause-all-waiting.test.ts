/**
 * Pause all turned off in a world that still cannot sync (1.125.0, round 3): through the real sync-attach,
 * where a world waiting on the World PIN has no engine (`getCurrentSyncWorldId()` is null), the line reads
 * the open world: "Sync is no longer paused…" with the World PIN for an owner's world, a seat's own words
 * for a seat that lost its secret, and "Sync resumed" for a world that syncs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderStorageTab, wireStorageTab } from '../../src/middle/settings-storage';
import { getCurrentSyncWorldId } from '../../src/sync/sync-attach';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry, type WorldsRegistry } from '../../src/core/types';
import { PIN_WAITS_RESUME_LINE } from '../../src/core/saves-online';
import { SEAT_SECRET_MISSING_LINE } from '../../src/core/seat';
import type { ToastManager } from '../../src/ui/toast-manager';

function world(over: Partial<NonNullable<WorldRegistryEntry['api']>> = {}): WorldRegistryEntry {
  return {
    id: 'w1', name: 'Tangle ground', state: 'api-linked',
    api: { world_id: 's1', api_key: 'ow_w_k', ...over }, folder: { handle_key: 'h', folder_name: 'f' },
    created_at: '2026-01-01T00:00:00Z',
  } as WorldRegistryEntry;
}

function pauseAllOff(reg: WorldsRegistry): string[] {
  patchSlice('registry', reg);
  patchSlice('active', { worldId: 'w1', meta: { name: 'Tangle ground' } as never, opened: true });
  const said: string[] = [];
  const toasts = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: (m: string) => { said.push(m); } } as unknown as ToastManager;
  const host = document.createElement('div');
  host.className = 'atlas-settings';
  host.innerHTML = renderStorageTab(reg);
  document.body.appendChild(host);
  wireStorageTab(toasts);
  const box = host.querySelector<HTMLInputElement>('input[name="pause-all"]')!;
  box.checked = false;
  box.dispatchEvent(new Event('change'));
  return said;
}

afterEach(() => {
  document.body.innerHTML = '';
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
});

describe('Pause all off, with no engine attached', () => {
  it('an owner\'s world waiting on the World PIN says so, never "Sync resumed"', () => {
    expect(getCurrentSyncWorldId()).toBeNull();
    expect(pauseAllOff({ ...defaultRegistry(), sync_pause_all: true, worlds: [world()] })).toEqual([PIN_WAITS_RESUME_LINE]);
  });

  it('a seat that lost its secret says the seat\'s words, never the World PIN', () => {
    const said = pauseAllOff({ ...defaultRegistry(), pin: '1234', sync_pause_all: true, worlds: [world({ seat: { role: 'narrator' } })] });
    expect(said).toEqual([`Sync is no longer paused. ${SEAT_SECRET_MISSING_LINE}`]);
  });

  it('control: a world with a PIN kept says Sync resumed', () => {
    expect(pauseAllOff({ ...defaultRegistry(), pin: '1234', sync_pause_all: true, worlds: [world()] })).toEqual(['Sync resumed']);
  });
});
