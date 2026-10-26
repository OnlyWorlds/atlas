// Promoted from a gate probe `b-normalize-clobber.probe.test.ts`: it asserts the fixed behaviour.
/**
 * Lens B probe: the writing room's dirty check compares the editor's
 * re-serialised markdown against the RAW story. For a story another tool
 * wrote (not in Atlas's own serialisation) the editor reads "dirty" at once,
 * so the live folder's flush-first writes Atlas's version over the disk.
 */
import { describe, it, expect } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { mountWritingWorkspace } from '../../src/middle/writing-workspace';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice } from '../../src/core/state';
import { flushBeforeLeavingWorld } from '../../src/core/leave-flush';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

const WID = 'w-norm';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function world(): Promise<MockFolderStore> {
  const store = new MockFolderStore();
  await store.open(null as never);
  setActiveStore(store as unknown as FsFolderStore);
  const entry = { id: WID, name: 'P', state: 'local', folder: { handle_key: 'k', folder_name: 'p' }, created_at: '2026-01-01T00:00:00Z' } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: WID, meta: await store.readWorldMeta(), opened: true } as never);
  return store;
}

const STORIES: Record<string, string> = {
  trailingNewline: 'The rain came down.\n',
  softWrap: 'Line one\nline two of the same paragraph.',
  starItalic: 'She was *very* tired.',
  starBullets: '* one\n* two',
  twoParas: 'First.\n\nSecond.',
  plain: 'Plain sentence.',
};

describe('outside-written story vs the flush-first', () => {
  for (const [label, story] of Object.entries(STORIES)) {
    it(`${label}: does a flush with NO typing write the story?`, async () => {
      const store = await world();
      const scene = await store.createElement('narrative', { name: 'S', story } as Partial<Element>);
      patchSlice('data', { elements: await store.listElements(), loading: false } as never);
      window.location.hash = `#/w/${WID}/writing/${scene.id}`;
      const host = document.createElement('div');
      document.body.appendChild(host);
      const unmount = mountWritingWorkspace(host);
      await wait(150);
      // The outside tool edits the scene again; the next focus pass flushes first.
      const agent2 = 'AGENT SECOND EDIT';
      await store.updateElement(scene.id, { story: agent2 } as Partial<Element>);
      await flushBeforeLeavingWorld();
      await wait(50);
      const after = (await store.getElement(scene.id)) as Record<string, unknown>;
      console.log(`[probe] ${label}: raw=${JSON.stringify(story)} disk-after-flush=${JSON.stringify(after.story)}`);
      unmount();
      host.remove();
      // The assertion a fix must make true: an untouched editor never writes.
      expect(after.story).toBe(agent2);
    });
  }
});
