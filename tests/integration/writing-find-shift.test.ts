/**
 * S367 critic C10: Ctrl+Shift+F in the Writing room is focus mode only. The
 * workspace's own Find handler (Ctrl+F / Ctrl+H) must ignore Shift combos,
 * or Find opens too and the caret leaves the prose.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { installHotkeys, setHotkeyCallbacks, uninstallHotkeys } from '../../src/core/hotkeys';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { mountWritingWorkspace } from '../../src/middle/writing-workspace';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

afterEach(() => {
  uninstallHotkeys();
  document.body.innerHTML = '';
  window.location.hash = '';
});

async function mountRoom(): Promise<{ root: HTMLElement; prose: HTMLElement; unmount: () => void }> {
  const store = new MockFolderStore();
  await store.open(null as never);
  setActiveStore(store as unknown as FsFolderStore);
  const WID = 'w-keys';
  const scene = await store.createElement('narrative', { name: 'Scene 1', supertype: 'Scene', story: 'Ann walks in.' } as Partial<Element>);
  const entry = { id: WID, name: 'P', state: 'local', folder: { handle_key: 'k', folder_name: 'p' }, created_at: '2026-01-01T00:00:00Z' } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: WID, meta: await store.readWorldMeta(), opened: true } as never);
  patchSlice('data', { elements: await store.listElements() });
  window.location.hash = `#/w/${WID}/writing/${scene.id}`;
  setHotkeyCallbacks({ getActiveWorldId: () => WID });
  installHotkeys();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmount = mountWritingWorkspace(host);
  await new Promise(r => setTimeout(r, 300));
  const root = host.querySelector<HTMLElement>('.atlas-writing-workspace')!;
  const prose = root.querySelector<HTMLElement>('.ProseMirror') ?? root.querySelector<HTMLElement>('[contenteditable]') ?? root;
  return { root, prose, unmount };
}

function press(target: HTMLElement, key: string, shift: boolean): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true }));
}

describe('C10: writing room find vs focus mode', () => {
  it('Ctrl+Shift+F toggles focus mode and leaves Find closed', async () => {
    const { root, prose, unmount } = await mountRoom();
    press(prose, 'F', true);
    const focusOn = root.classList.contains('is-focus-mode');
    const bar = root.querySelector<HTMLElement>('.atlas-find-bar');
    const barShown = bar?.dataset.state === 'shown';
    unmount();
    expect(focusOn).toBe(true);
    expect(barShown).toBe(false);
  });

  it('Ctrl+Shift+H opens nothing', async () => {
    const { root, prose, unmount } = await mountRoom();
    press(prose, 'H', true);
    const bar = root.querySelector<HTMLElement>('.atlas-find-bar');
    const barShown = bar?.dataset.state === 'shown';
    unmount();
    expect(barShown).toBe(false);
  });

  it('control: plain Ctrl+F still opens Find', async () => {
    const { root, prose, unmount } = await mountRoom();
    press(prose, 'f', false);
    const bar = root.querySelector<HTMLElement>('.atlas-find-bar');
    const barShown = bar?.dataset.state === 'shown';
    unmount();
    expect(barShown).toBe(true);
  });
});
