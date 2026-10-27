/**
 * The folder format's rule for a repeated id (§4, clarified 2026-10-27): when two files in one layout
 * carry one id, a reader serves the FIRST in code-point name order, as Python and Unity do, never the
 * copy with Atlas's own newest stamp. Atlas's quarantine of the other copy is a writer's act and stays.
 * And Atlas's own rename never leaves two different bodies, so the rule cannot serve a pre-edit copy.
 * REAL FsFolderStore over fake-fs.
 */
import { describe, it, expect } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { codePointCompare } from '../../src/store/code-point-order';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 1, 1, 0, 0, t++)).toISOString();
async function open(root: FakeDirHandle): Promise<FsFolderStore> {
  const s = new FsFolderStore({ clock, tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
  await s.open(root as unknown as FileSystemDirectoryHandle);
  return s;
}
function world(): FakeDirHandle {
  const r = new FakeDirHandle('w');
  r.put('world.json', j({ id: 'w1', name: 'W' }));
  return r;
}

const ID = '77777777-7777-4777-8777-777777777777';

describe('codePointCompare', () => {
  it('orders by code point, where UTF-16 units disagree above U+FFFF', () => {
    const astral = '\u{1F600}.json'; // a surrogate pair: UTF-16 sorts it below U+FF5E
    const bmp = '～.json';
    expect(astral < bmp).toBe(true); // what `<` says
    expect(codePointCompare(bmp, astral)).toBe(-1); // the format's order
    expect(codePointCompare('a.json', 'B.json')).toBe(1); // never case-folded
    expect(codePointCompare('ab', 'abc')).toBe(-1);
    expect(codePointCompare('x', 'x')).toBe(0);
  });
});

describe('a repeated id in one layout: the first file by code-point name is served', () => {
  it('serves the first by name, not the newer stamp, and sets the other copy aside', async () => {
    const root = world();
    // 'aldric--77777777.json' sorts before 'aldric-variant.json' ('-' before 'v'); the variant is NEWER.
    root.put('elements/character/aldric--77777777.json', j({ id: ID, type: 'character', name: 'Aldric', description: 'first by name', local_updated_at: '2026-01-01T00:00:00.000Z' }));
    root.put('elements/character/aldric-variant.json', j({ id: ID, type: 'character', name: 'Aldric', description: 'newer stamp', local_updated_at: '2099-01-01T00:00:00.000Z' }));
    const s = await open(root);
    await s.listElements();
    expect((await s.getElement(ID))!.description).toBe('first by name');
    // Somebody's work is never deleted: the other copy is in quarantine.
    expect(root.list().some(p => p.startsWith('.atlas/quarantine/') && p.endsWith('aldric-variant.json'))).toBe(true);
    expect(root.list().filter(p => p.startsWith('elements/character/'))).toEqual(['elements/character/aldric--77777777.json']);
  });

  it('a file with no stamp first by name is served over a stamped later one', async () => {
    const root = world();
    root.put('elements/character/a--77777777.json', j({ id: ID, type: 'character', name: 'A', description: 'bare' }));
    root.put('elements/character/b--77777777.json', j({ id: ID, type: 'character', name: 'A', description: 'stamped', local_updated_at: '2026-05-05T00:00:00.000Z' }));
    const s = await open(root);
    await s.listElements();
    expect((await s.getElement(ID))!.description).toBe('bare');
  });

  it('identical twins (a crash between two writes of one body) leave one file, nothing quarantined', async () => {
    const root = world();
    const body = { id: ID, type: 'character', name: 'Finnegan', description: 'v2' };
    root.put('elements/character/finn--77777777.json', j({ ...body, local_updated_at: '2026-01-01T00:00:00.000Z' }));
    root.put('elements/character/finnegan--77777777.json', j({ ...body, local_updated_at: '2026-01-01T00:00:01.000Z' }));
    const s = await open(root);
    await s.listElements();
    expect((await s.getElement(ID))!.description).toBe('v2');
    expect(root.list().filter(p => p.startsWith('.atlas/quarantine/'))).toEqual([]);
  });
});

describe("Atlas's own rename never leaves two different bodies", () => {
  it('a crash after the new name is written: both files hold the edit, so reopening serves it', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Finn', description: 'v1' });
    await s.listElements();
    const dir = await (await root.getDirectoryHandle('elements')).getDirectoryHandle('character') as FakeDirHandle;
    // The crash: the old file's removal never happens.
    dir.removeEntry = async () => { throw new Error('crashed before the remove'); };
    await s.updateElement(el.id, { name: 'Finnegan', description: 'v2' });
    const files = root.list().filter(p => p.startsWith('elements/character/'));
    expect(files.length).toBe(2);
    // 'finn--' sorts before 'finnegan--': under first-by-name the OLD file is the one served.
    for (const f of files) expect(JSON.parse(root.get(f)!).description).toBe('v2');
    const fresh = await open(root);
    const got = await fresh.getElement(el.id);
    expect(got!.name).toBe('Finnegan');
    expect(got!.description).toBe('v2');
    expect(root.list().filter(p => p.startsWith('.atlas/quarantine/'))).toEqual([]);
  });
});
