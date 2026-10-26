/**
 * FolderStore per-id write serialization (convention #79).
 *
 * The lost-update class: updateElement is a read-merge-write, so two
 * concurrent updates to the same element race the read — the second call's
 * snapshot predates the first call's write and the merge silently reverts
 * its fields. Found live by the share-room e2e (name blur +
 * intent change). It was first fixed per-room (share-room's chain,
 * convention #77); the guarantee later moved to the store boundary so
 * every room (knowledge-room's patchEntry was still exposed) gets it free.
 *
 * The mock's updateElement carries a deliberate microtask yield between read
 * and merge, mirroring the real store's disk-I/O gap — remove the chain and
 * these tests fail, exactly as the real store would lose the update.
 */

import { describe, it, expect } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';

async function openStore(): Promise<MockFolderStore> {
  const store = new MockFolderStore();
  await store.open(null as unknown as FileSystemDirectoryHandle);
  return store;
}

describe('FolderStore per-id write serialization (convention #79)', () => {
  it('concurrent single-field updates to the same element both land', async () => {
    const store = await openStore();
    const el = await store.createElement('narrative', { name: 'a page', subtype: 'page' });

    // The shape the e2e found: name blur + intent change fire together.
    await Promise.all([
      store.updateElement(el.id, { name: 'renamed' }),
      store.updateElement(el.id, { atlas_page_intent: 'reference' } as Record<string, unknown>),
    ]);

    const after = await store.getElement(el.id);
    expect(after?.name).toBe('renamed');
    expect((after as Record<string, unknown> | null)?.atlas_page_intent).toBe('reference');
  });

  it('a burst of concurrent updates loses none of its fields', async () => {
    const store = await openStore();
    const el = await store.createElement('character', { name: 'Ireena' });

    await Promise.all([
      store.updateElement(el.id, { description: 'd' }),
      store.updateElement(el.id, { physicality: 'p' } as Record<string, unknown>),
      store.updateElement(el.id, { mentality: 'm' } as Record<string, unknown>),
      store.updateElement(el.id, { background: 'b' } as Record<string, unknown>),
    ]);

    const after = (await store.getElement(el.id)) as Record<string, unknown> | null;
    expect(after?.description).toBe('d');
    expect(after?.physicality).toBe('p');
    expect(after?.mentality).toBe('m');
    expect(after?.background).toBe('b');
  });

  it('a delete queued behind an update waits for the update (no element-not-found tail error)', async () => {
    const store = await openStore();
    const el = await store.createElement('character', { name: 'doomed' });

    const update = store.updateElement(el.id, { description: 'last words' });
    const del = store.deleteElement(el.id);

    await expect(update).resolves.toMatchObject({ description: 'last words' });
    await del;
    expect(await store.getElement(el.id)).toBeNull();
  });

  it('updates to different elements are independent', async () => {
    const store = await openStore();
    const a = await store.createElement('character', { name: 'a' });
    const b = await store.createElement('character', { name: 'b' });

    await Promise.all([
      store.updateElement(a.id, { description: 'A' }),
      store.updateElement(b.id, { description: 'B' }),
    ]);

    expect((await store.getElement(a.id))?.description).toBe('A');
    expect((await store.getElement(b.id))?.description).toBe('B');
  });
});
