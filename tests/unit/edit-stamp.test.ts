/**
 * An edit made while this device's clock is behind the server's must
 * still read as unsynced. Found live: keel answers about 1.5 s ahead of the
 * crew's laptop, and an image URL cleared a second after a push sorted below
 * its own baseline, read clean, and never reached keel.
 */
import { describe, it, expect } from 'vitest';
import { editStamp } from '../../src/store/sync-stamp';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { memoryDirectory } from '../../src/store/memory-dir';

describe('editStamp', () => {
  it('now, when now is past the baseline or there is none', () => {
    expect(editStamp('2026-10-10T11:15:30.000Z', '2026-10-10T11:15:26.099544+00:00')).toBe('2026-10-10T11:15:30.000Z');
    expect(editStamp('2026-10-10T11:15:30.000Z', undefined)).toBe('2026-10-10T11:15:30.000Z');
  });
  it('just past the baseline when this clock is behind it, in keel\'s own format', () => {
    const s = editStamp('2026-10-10T11:15:25.000Z', '2026-10-10T11:15:26.099544+00:00');
    expect(s).toBe('2026-10-10T11:15:26.100Z');
    expect(s > '2026-10-10T11:15:26.099544+00:00').toBe(true);
  });
});

// A clock 1.5 s behind the server: the push stamps the server's time, the
// next edit comes from this clock a second later.
const SERVER_STAMP = '2026-10-10T11:15:26.099544+00:00';
const BEHIND = () => '2026-10-10T11:15:25.600Z';

describe.each([
  ['the real store', async () => {
    const s = new FsFolderStore({ tabId: 't', disableHeartbeat: true, clock: BEHIND });
    await s.open(memoryDirectory());
    return s;
  }],
  ['the mock store', async () => { const s = new MockFolderStore(); s.setClock(BEHIND); return s; }],
])('%s', (_label, make) => {
  it('an edit after a sync, made by a clock behind the server, stays unsynced', async () => {
    const store = await make();
    const el = await store.createElement('location', { name: 'The Smithy', image_url: 'https://media.onlyworlds.com/u/w/x.png' });
    await store.stampServerUpdatedAt(el.id, 'location', SERVER_STAMP);
    expect(await store.listLocallyChangedSince(null)).toHaveLength(0);
    await store.updateElement(el.id, { image_url: null } as never);
    const dirty = await store.listLocallyChangedSince(null);
    expect(dirty.map(e => e.id)).toEqual([el.id]);
  });
});
