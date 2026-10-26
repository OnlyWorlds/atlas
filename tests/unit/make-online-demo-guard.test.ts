/**
 * The tour world cannot go online. Exiting the
 * tour deletes it, folder and all, and its ids are the live demo world's, so
 * keel would refuse every element. Make Online's one funnel refuses it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MakeOnlineModal } from '../../src/ui/make-online-modal';
import { patchSlice, getState } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { ToastManager } from '../../src/ui/toast-manager';

beforeEach(async () => {
  document.body.innerHTML = '';
  const store = new MockFolderStore();
  await store.open(null);
  setActiveStore(store as never);
});

function activate(demo: boolean): void {
  const entry = {
    id: 'w-tour', name: 'Hyperion', state: 'local-only', demo,
    folder: { handle_key: 'world-w-tour', folder_name: 'hyperion-tour-1' },
  };
  patchSlice('registry', { ...getState().registry, worlds: [entry as never] });
  patchSlice('active', { worldId: 'w-tour', meta: { id: 'w-tour', name: 'Hyperion' }, opened: true });
}

describe('Make Online on the tour world', () => {
  it('refuses a demo world with a plain reason and opens nothing', () => {
    activate(true);
    const toasts = new ToastManager();
    const info = vi.spyOn(toasts, 'info');
    new MakeOnlineModal(toasts).open();
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/tour world is a sandbox/));
    expect(document.querySelector('.atlas-modal-overlay')).toBeNull();
  });

  it('still opens for an ordinary local world', () => {
    activate(false);
    new MakeOnlineModal(new ToastManager()).open();
    expect(document.querySelector('.atlas-modal-overlay')).not.toBeNull();
  });
});
