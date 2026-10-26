// Promoted from a gate probe `b-knowledge-norm.probe.test.ts`: it asserts the fixed behaviour.
/** Lens B probe: the knowledge room's baseline is the RAW story too. */
import { describe, it, expect } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { mountKnowledgeRoom } from '../../src/middle/knowledge-room';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice } from '../../src/core/state';
import { flushBeforeLeavingWorld } from '../../src/core/leave-flush';
import { defaultRegistry } from '../../src/core/types';
import { ToastManager } from '../../src/ui/toast-manager';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

const WID = 'w-kn';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('knowledge room flush-first', () => {
  it('an entry whose story ends in a newline: an untouched editor overwrites the next outside edit', async () => {
    const store = new MockFolderStore();
    await store.open(null as never);
    setActiveStore(store as unknown as FsFolderStore);
    const entry = { id: WID, name: 'P', state: 'local', folder: { handle_key: 'k', folder_name: 'p' }, created_at: '2026-01-01T00:00:00Z' } as unknown as WorldRegistryEntry;
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
    patchSlice('active', { worldId: WID, meta: await store.readWorldMeta(), opened: true } as never);
    const k = await store.createElement('narrative', { name: 'ledger', subtype: 'knowledge', story: 'The tithe is due.\n' } as Partial<Element>);
    patchSlice('data', { elements: await store.listElements(), loading: false } as never);
    window.location.hash = `#/w/${WID}/knowledge/${k.id}`;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = mountKnowledgeRoom(host, new ToastManager());
    await wait(200);
    const open = !!host.querySelector('.ProseMirror');
    await store.updateElement(k.id, { story: 'AGENT SECOND EDIT' } as Partial<Element>);
    await flushBeforeLeavingWorld();
    await wait(50);
    const after = (await store.getElement(k.id)) as Record<string, unknown>;
    console.log(`[probe K1] editor open=${open} disk after flush=${JSON.stringify(after.story)}`);
    unmount();
    host.remove();
    expect(after.story).toBe('AGENT SECOND EDIT');
  });
});
