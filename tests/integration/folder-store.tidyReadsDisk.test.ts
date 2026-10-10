/**
 * The background tidy reads the disk before it writes (#89, conv. 92). The
 * tidy renames a file to its canonical name by writing the body under the new
 * name and removing the old file. It used to write the body Atlas had cached
 * at the scan, so an outside edit landing between the scan and the tidy (an
 * agent, an editor, git) was written over and its file removed. Every other
 * Atlas write reads through `readForWrite`; the tidy now does too.
 */
import { describe, it, expect } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 1, 1, 0, 0, t++)).toISOString();
const ID = '0192a000-0000-7000-8000-00000000a1d1';

describe('the background tidy', () => {
  it('keeps an outside edit that lands between the scan and the rename', async () => {
    const root = new FakeDirHandle('w');
    root.put('world.json', j({ id: 'w1', name: 'W' }));
    // A hand-named file: the tidy will rename it to the canonical form.
    root.put('elements/character/aldric.json', j({ id: ID, type: 'character', name: 'Aldric', description: 'before' }));
    const s = new FsFolderStore({ clock, tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
    await s.open(root as unknown as FileSystemDirectoryHandle);

    expect((await s.listElements('character'))[0].description).toBe('before'); // scanned, cached, tidy scheduled
    // The tidy yields a macrotask before it runs; the outside edit lands first.
    root.put('elements/character/aldric.json', j({ id: ID, type: 'character', name: 'Aldric', description: 'agent' }));
    await s.awaitTidies();

    const files = root.list().filter(p => p.startsWith('elements/character/'));
    expect(files).toHaveLength(1);
    expect(files[0]).not.toBe('elements/character/aldric.json'); // the tidy did run
    expect(JSON.parse(root.get(files[0])!).description).toBe('agent');
    expect((await s.getElement(ID))!.description).toBe('agent');
  });

  it('leaves a file that will not parse where it is, unrenamed and unwritten', async () => {
    const root = new FakeDirHandle('w');
    root.put('world.json', j({ id: 'w1', name: 'W' }));
    root.put('elements/character/aldric.json', j({ id: ID, type: 'character', name: 'Aldric' }));
    const s = new FsFolderStore({ clock, tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
    await s.open(root as unknown as FileSystemDirectoryHandle);
    await s.listElements('character');
    const broken = '<<<<<<< HEAD\n{"id": "' + ID + '"}\n=======\n';
    root.put('elements/character/aldric.json', broken);
    await s.awaitTidies();

    expect(root.list().filter(p => p.startsWith('elements/character/'))).toEqual(['elements/character/aldric.json']);
    expect(root.get('elements/character/aldric.json')).toBe(broken);
  });
});
