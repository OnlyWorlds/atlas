/**
 * #347: who last wrote an element (keel #299's `changed_by`, `changed_via`)
 * describes the server's last write. A local edit is this person's, so both
 * stores drop the pair on every edit (`dropLastWriter`) and the quiet agent
 * mark never sits on a person's change; `created_by` stays. Atlas's own
 * housekeeping (the filename tidy) is nobody's edit and keeps them.
 */
import { describe, it, expect } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { FolderStore } from '../../src/store/folder-store';
import type { Element } from '../../src/core/types';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 1, 1, 0, 0, t++)).toISOString();
const ID = '0192a000-0000-7000-8000-00000000a347';
const SEAT = 'b1c2d3e4-0000-4000-8000-000000000001';
const MAKER = 'b1c2d3e4-0000-4000-8000-000000000002';
const pulled = { id: ID, type: 'character', name: 'Aldric', created_by: MAKER, changed_by: SEAT, changed_via: 'seat', changed_client: 'lantern' };

async function realStore(): Promise<{ s: FsFolderStore; root: FakeDirHandle }> {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  root.put('elements/character/aldric--00a347.json', j(pulled));
  const s = new FsFolderStore({ clock, tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
  await s.open(root as unknown as FileSystemDirectoryHandle);
  await s.listElements('character');
  return { s, root };
}

async function mockStore(): Promise<MockFolderStore> {
  const s = new MockFolderStore();
  await s.open(null);
  await s.createElementVerbatim('character', { ...pulled } as unknown as Element);
  return s;
}

const stores: Array<[string, () => Promise<FolderStore>]> = [
  ['the real store', async () => (await realStore()).s],
  ['the mock store', mockStore],
];

describe.each(stores)('%s', (_name, make) => {
  it('an edit drops who last wrote it and keeps who made it', async () => {
    const s = await make();
    expect((await s.getElement(ID))!.changed_via).toBe('seat');
    const next = await s.updateElement(ID, { description: 'by hand' });
    for (const el of [next, (await s.getElement(ID))!]) {
      expect(el.description).toBe('by hand');
      expect('changed_via' in el).toBe(false);
      expect('changed_by' in el).toBe(false);
      expect('changed_client' in el).toBe(false); // keel #520: the software of the last write
      expect(el.created_by).toBe(MAKER);
    }
  });

  it('so does an edit made through updateElementWith', async () => {
    const s = await make();
    await s.updateElementWith(ID, () => ({ description: 'by hand' }));
    expect('changed_via' in (await s.getElement(ID))!).toBe(false);
  });

  it('a push that landed is keel\'s last write, Atlas\'s own: the stamp drops them (the S415 gate)', async () => {
    const s = await make();
    await s.stampServerUpdatedAt(ID, 'character', '2026-02-02T00:00:00.000Z');
    const el = (await s.getElement(ID))!;
    expect(el.server_updated_at).toBe('2026-02-02T00:00:00.000Z');
    expect('changed_via' in el).toBe(false);
    expect('changed_client' in el).toBe(false);
    expect(el.created_by).toBe(MAKER);
  });

  it('a mutate that changes nothing writes nothing and keeps them', async () => {
    const s = await make();
    await s.updateElementWith(ID, () => null);
    expect((await s.getElement(ID))!.changed_via).toBe('seat');
    expect((await s.getElement(ID))!.changed_client).toBe('lantern');
  });
});

describe('the real store on disk', () => {
  it('the edit leaves the file without them', async () => {
    const { s, root } = await realStore();
    await s.updateElement(ID, { description: 'by hand' });
    const file = root.list().find(p => p.startsWith('elements/character/'))!;
    const body = JSON.parse(root.get(file)!);
    expect(body.changed_via).toBeUndefined();
    expect(body.created_by).toBe(MAKER);
  });

  it('the filename tidy is nobody\'s edit: it keeps them', async () => {
    const root = new FakeDirHandle('w');
    root.put('world.json', j({ id: 'w1', name: 'W' }));
    root.put('elements/character/aldric.json', j(pulled)); // hand-named: the tidy renames it
    const s = new FsFolderStore({ clock, tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
    await s.open(root as unknown as FileSystemDirectoryHandle);
    await s.listElements('character');
    await s.awaitTidies();
    const files = root.list().filter(p => p.startsWith('elements/character/'));
    expect(files).toHaveLength(1);
    expect(files[0]).not.toBe('elements/character/aldric.json');
    expect(JSON.parse(root.get(files[0])!).changed_via).toBe('seat');
  });
});
