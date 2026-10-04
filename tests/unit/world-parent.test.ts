/**
 * Where a new world goes (1.17 bout 2, ruling 2, contract §1.4, §2.3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { defaultWorldWhere, requestPersistOnFirstBrowserWorld } from '../../src/setup/world-parent';
import { setNewWorldWherePref } from '../../src/core/ui-prefs';
import type { WorldRegistryEntry } from '../../src/core/types';

const w = (over: Partial<WorldRegistryEntry>): WorldRegistryEntry => ({
  id: 'r', name: 'x', state: 'local-only', folder: { handle_key: 'world-x', folder_name: 'x' }, created_at: '2026-10-04T00:00:00.000Z', ...over,
});
const pickerOn = () => { (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => Promise.resolve(null); };

beforeEach(() => {
  localStorage.clear();
  patchSlice('atlasRoot', null);
  patchSlice('registry', { ...defaultRegistry(), worlds: [] });
});
afterEach(() => {
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  delete (navigator as unknown as { storage?: unknown }).storage;
});

describe('defaultWorldWhere', () => {
  it('without the folder picker, always this browser', () => {
    patchSlice('atlasRoot', { folderName: 'onlyworlds-atlas', pathHint: 'Docs/onlyworlds-atlas' });
    expect(defaultWorldWhere()).toBe('browser');
  });
  it('with the picker and a home folder, the folder', () => {
    pickerOn();
    patchSlice('atlasRoot', { folderName: 'onlyworlds-atlas', pathHint: 'Docs/onlyworlds-atlas' });
    expect(defaultWorldWhere()).toBe('folder');
  });
  it('with the picker and no home folder, the last pick, else this browser', () => {
    pickerOn();
    expect(defaultWorldWhere()).toBe('browser');
    setNewWorldWherePref('folder');
    expect(defaultWorldWhere()).toBe('folder');
  });
  it('a registry root whose handle is gone is not a home folder (gate B18)', () => {
    pickerOn();
    patchSlice('registry', { ...defaultRegistry(), atlas_root: { handle_key: 'atlas-root', folder_name: 'onlyworlds-atlas' }, worlds: [] } as never);
    expect(defaultWorldWhere()).toBe('browser');
  });
});

describe('requestPersistOnFirstBrowserWorld', () => {
  it('asks once, for the first browser world of the user own, and never waits', () => {
    const persist = vi.fn(() => new Promise<boolean>(() => {})); // Firefox may never answer
    (navigator as unknown as { storage: unknown }).storage = { persist };
    requestPersistOnFirstBrowserWorld();
    expect(persist).toHaveBeenCalledTimes(1);
    patchSlice('registry', { ...defaultRegistry(), worlds: [w({ where: 'browser', demo: true })] });
    requestPersistOnFirstBrowserWorld();
    expect(persist).toHaveBeenCalledTimes(2); // the tour's sandbox does not count
    patchSlice('registry', { ...defaultRegistry(), worlds: [w({ where: 'browser' })] });
    requestPersistOnFirstBrowserWorld();
    expect(persist).toHaveBeenCalledTimes(2);
  });
});
