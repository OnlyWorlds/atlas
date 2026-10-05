/**
 * Settings, Storage, "In this browser" (1.17, contract §3.4, invariants 3
 * and 9; S376 gate B4): a cleared row is not a world kept in this browser,
 * and a window whose browser storage refuses (a private window) or is full
 * says only that, never "0 worlds kept" with an Ask button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/sync/sync-attach', () => ({
  getCurrentSyncEngine: () => null,
  getCurrentSyncFolder: () => null,
  getCurrentSyncWorldId: () => null,
  refreshConflictsCount: () => Promise.resolve(),
  attachSyncEngine: vi.fn(),
  pullNowAndRefresh: vi.fn(),
}));

import { renderStorageTab, wireStorageTab } from '../../src/middle/settings-storage';
import { __resetOpfsStatusForTests, NO_BROWSER_STORAGE_LINE, opfsStatus } from '../../src/core/capabilities';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry, type WorldsRegistry } from '../../src/core/types';
import type { ToastManager } from '../../src/ui/toast-manager';

let refuse = false;
const realStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');

const browserWorld = (id: string, over: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry => ({
  id, name: id, state: 'local-only', where: 'browser', created_at: '2026-10-05T00:00:00.000Z',
  folder: { handle_key: `world-${id}`, folder_name: `${id}-0192a000-1a2b` }, ...over,
} as WorldRegistryEntry);

function mount(reg: WorldsRegistry): HTMLElement {
  patchSlice('registry', reg);
  const host = document.createElement('div');
  host.className = 'atlas-settings';
  host.innerHTML = renderStorageTab(reg);
  document.body.appendChild(host);
  wireStorageTab({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } as unknown as ToastManager);
  return host;
}

beforeEach(() => {
  refuse = false;
  __resetOpfsStatusForTests();
  (globalThis as unknown as { FileSystemFileHandle: unknown }).FileSystemFileHandle = { prototype: { createWritable() {} } };
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      async getDirectory() {
        if (refuse) throw Object.assign(new Error('nope'), { name: 'SecurityError' });
        return {
          async getFileHandle() { return { async createWritable() { return { async write() {}, async close() {} }; } }; },
          async removeEntry() {},
        };
      },
      async estimate() { return { usage: 1024 }; },
      async persisted() { return false; },
    },
  });
});
afterEach(() => {
  document.body.innerHTML = '';
  __resetOpfsStatusForTests();
  delete (globalThis as unknown as { FileSystemFileHandle?: unknown }).FileSystemFileHandle;
  if (realStorage) Object.defineProperty(navigator, 'storage', realStorage);
  else delete (navigator as unknown as { storage?: unknown }).storage;
});

describe('Settings, Storage, in this browser', () => {
  it('counts only the worlds still here, and names the cleared ones apart', async () => {
    await opfsStatus();
    const host = mount({ ...defaultRegistry(), worlds: [browserWorld('a'), browserWorld('b', { cleared_at: '2026-10-05T09:00:00.000Z' })] });
    const count = host.querySelector('[data-role="browser-count"]')!.textContent!;
    expect(count).toMatch(/^1 world kept in this browser\. 1 cleared by this browser\./);
  });

  it('a window that refuses browser storage says only its line', async () => {
    refuse = true;
    await opfsStatus();
    const host = mount({ ...defaultRegistry(), worlds: [] });
    const section = host.querySelector('[data-role="browser-storage"]')!;
    expect(section.textContent).toContain(NO_BROWSER_STORAGE_LINE);
    expect(section.querySelector('[data-role="browser-count"]')).toBeNull();
    expect(section.querySelector('[data-action="ask-persist"]')).toBeNull();
  });

  it('a refusal that settles after the render replaces the section with its line', async () => {
    refuse = true;
    const host = mount({ ...defaultRegistry(), worlds: [] });
    await opfsStatus();
    await new Promise(r => setTimeout(r, 0));
    const section = host.querySelector('[data-role="browser-storage"]')!;
    expect(section.textContent).toContain(NO_BROWSER_STORAGE_LINE);
    expect(section.querySelector('[data-action="ask-persist"]')).toBeNull();
  });
});
