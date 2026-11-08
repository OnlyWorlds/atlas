/**
 * A proposal leaves the element's file as it was (keel did not apply the edit), so no elements patch
 * follows it, and a quiet round no longer replaces the elements array (same-elements.ts). The element
 * page's sync mark must still move to "Sent for review" when only the proposed set changes: the set is
 * a part of the page's render gate (proposedSetOf).
 */
import { describe, it, expect } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { mountElementDetail } from '../../src/middle/element-detail';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { WorldRegistryEntry, ProposedEdit } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';
import { __test_refreshProposedSet } from '../../src/sync/sync-attach';
import { PROPOSAL_PENDING_TITLE } from '../../src/sync/proposal-lines';
import type { FolderStore } from '../../src/store/folder-store';

const WID = 'w-proposal-mark';
const settle = () => new Promise(r => setTimeout(r, 50));
const titles = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[title]')].map(e => e.title);

describe('the element page redraws its sync mark when keel holds the edit as a proposal', () => {
  it('only the proposed set changes: the mark says Sent for review', async () => {
    const store = new MockFolderStore();
    await store.open(null as never);
    setActiveStore(store as unknown as FsFolderStore);
    const entry = { id: WID, name: 'P', state: 'api-linked', folder: { handle_key: 'k', folder_name: 'p' }, created_at: '2026-01-01T00:00:00Z' } as unknown as WorldRegistryEntry;
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
    patchSlice('active', { worldId: WID, meta: await store.readWorldMeta(), opened: true } as never);
    const el = await store.createElement('character', { name: 'Ada' });
    patchSlice('data', { elements: await store.listElements() });
    window.location.hash = `#/w/${WID}/element/${el.id}`;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = mountElementDetail(host);
    await settle();
    expect(titles(host)).not.toContain(PROPOSAL_PENDING_TITLE);

    // What a round does when keel answers the edit with a proposal: the sync state names it, the file stays.
    await store.writeSyncState({ proposed: [{ element_id: el.id } as unknown as ProposedEdit] });
    await __test_refreshProposedSet(WID, store as unknown as FolderStore);
    await settle();
    expect(titles(host)).toContain(PROPOSAL_PENDING_TITLE);
    unmount();
    host.remove();
  });
});
