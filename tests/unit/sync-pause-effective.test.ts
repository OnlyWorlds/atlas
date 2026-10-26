/**
 * Two pause switches (per-world "Stay offline", Settings >
 * Sync "Pause all") drive one engine flag. Neither handler may resume the
 * engine while the other switch still says paused; attach reads the same
 * predicate (effectiveSyncPaused).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const engine = { pause: vi.fn(), resume: vi.fn(), setDebounceMs: vi.fn(), setPolicy: vi.fn(), pushOnce: vi.fn() };
vi.mock('../../src/sync/sync-attach', () => ({
  getCurrentSyncEngine: () => engine,
  getCurrentSyncFolder: () => null,
  getCurrentSyncWorldId: () => 'w1',
  refreshConflictsCount: () => Promise.resolve(),
  attachSyncEngine: vi.fn(),
  pullNowAndRefresh: vi.fn(),
}));

import { renderStorageTab, wireStorageTab } from '../../src/middle/settings-storage';
import { mountWorldsBody } from '../../src/sidebar/worlds-sidebar';
import { effectiveSyncPaused } from '../../src/registry/registry';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { WorldRegistryEntry } from '../../src/core/types';
import type { ToastManager } from '../../src/ui/toast-manager';

const toasts = () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } as unknown as ToastManager);

function world(paused: boolean): WorldRegistryEntry {
  return {
    id: 'w1', name: 'Draft world', state: 'api-linked', sync_paused: paused,
    api: { world_id: 's1', api_key: 'k' }, folder: { handle_key: 'h', folder_name: 'f' },
    created_at: '2026-01-01T00:00:00Z',
  } as WorldRegistryEntry;
}

function seed(worldPaused: boolean, pauseAll: boolean) {
  const reg = { ...defaultRegistry(), worlds: [world(worldPaused)], sync_pause_all: pauseAll };
  patchSlice('registry', reg);
  patchSlice('active', { worldId: 'w1', meta: { name: 'Draft world' } as never, opened: true });
  return reg;
}

function togglePauseAllOff(reg: ReturnType<typeof seed>) {
  const host = document.createElement('div');
  host.className = 'atlas-settings';
  host.innerHTML = renderStorageTab(reg);
  document.body.appendChild(host);
  wireStorageTab(toasts());
  const box = host.querySelector<HTMLInputElement>('input[name="pause-all"]')!;
  expect(box.checked).toBe(true);
  box.checked = false;
  box.dispatchEvent(new Event('change'));
}

beforeEach(() => { engine.pause.mockClear(); engine.resume.mockClear(); });
afterEach(() => { document.body.innerHTML = ''; });

describe('effectiveSyncPaused', () => {
  it('is paused when either switch is on', () => {
    expect(effectiveSyncPaused({ sync_paused: false }, { sync_pause_all: false })).toBe(false);
    expect(effectiveSyncPaused({ sync_paused: true }, { sync_pause_all: false })).toBe(true);
    expect(effectiveSyncPaused({ sync_paused: false }, { sync_pause_all: true })).toBe(true);
    expect(effectiveSyncPaused(undefined, { sync_pause_all: false })).toBe(false);
  });
});

describe('Settings > Sync: Pause all off', () => {
  it('keeps a Stay-offline world paused (never resumes, so never pushes)', () => {
    togglePauseAllOff(seed(true, true));
    expect(getState().registry.sync_pause_all).toBe(false);
    expect(engine.resume).not.toHaveBeenCalled();
  });

  it('resumes a world with no Stay offline', () => {
    togglePauseAllOff(seed(false, true));
    expect(engine.resume).toHaveBeenCalledTimes(1);
  });
});

describe('Worlds sidebar: per-world resume', () => {
  it('does not resume the engine while Pause all is on', () => {
    seed(true, true);
    const content = document.createElement('div');
    document.body.appendChild(content);
    mountWorldsBody({ content, toasts: toasts() });
    const btn = content.querySelector<HTMLElement>('[data-role="toggle-paused"][data-world-id="w1"]')!;
    expect(btn).toBeTruthy();
    btn.click();
    expect(getState().registry.worlds[0].sync_paused).toBe(false);
    expect(engine.resume).not.toHaveBeenCalled();
  });
});
