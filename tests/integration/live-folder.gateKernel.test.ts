// Promoted from the S364 composition gate probe `a-kernel.probe.test.ts` (Forge/Notes/2026-09-29-s364-gate/): it asserts the fixed behaviour.
/**
 * Gate lens A (store kernel) probes, S364. REAL FsFolderStore over fake-fs.
 * "DEFECT" cases assert the CORRECT behaviour, so a red test = a live defect.
 * "UPHELD" cases assert behaviour the lens tried to break and could not.
 * Run from tools/atlas:
 *   npx vitest run --config ../../Notes/2026-09-29-s364-gate/probes/vitest.lensa.config.mts
 */
import { describe, it, expect } from 'vitest';
import { FakeDirHandle, FakeFileHandle, fakeContentReads } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { CorruptFileError } from '../../src/store/fs-utils';
import { startRekey } from '../../src/store/rekey';
import type { Element } from '../../src/core/types';

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
const pathOf = (root: FakeDirHandle, id: string, layout = 'elements') =>
  root.list().find(p => p.startsWith(layout + '/') && p.includes(id.slice(-8)) && p.endsWith('.json'))!;
function editOutside(root: FakeDirHandle, id: string, patch: Record<string, unknown>): void {
  const p = pathOf(root, id);
  root.put(p, j({ ...JSON.parse(root.get(p)!), ...patch }));
}
async function dirOf(root: FakeDirHandle, a: string, b: string): Promise<FakeDirHandle> {
  return (await (await root.getDirectoryHandle(a)).getDirectoryHandle(b)) as FakeDirHandle;
}
async function rm(root: FakeDirHandle, path: string): Promise<void> {
  const [a, b, f] = path.split('/');
  await (await dirOf(root, a, b)).removeEntry(f);
}
const kinds = (r: { changes: Array<{ kind: string; id: string; filename?: string }> }) =>
  r.changes.map(c => `${c.kind}:${c.id || c.filename}`);
const gate = () => { let open!: () => void; const p = new Promise<void>(r => { open = r; }); return { p, open }; };
const tickAway = (ms = 20) => new Promise(r => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (s: FsFolderStore) => s as any;

describe('DEFECT F1: a stranger read OUTSIDE its chain, rehomed without re-checking (Atlas rename race)', () => {
  it('a pass racing Atlas\'s own rename never serves the pre-edit body from the file Atlas just removed', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Finn', description: 'v1' });
    await s.listElements();
    const charDir = await dirOf(root, 'elements', 'character');
    const oldName = pathOf(root, el.id).split('/')[2];
    const oldHandle = await charDir.getFileHandle(oldName) as FakeFileHandle;

    // Hold the pass on its stat of the old file: the walk is done, the new file does not exist yet.
    const statReached = gate(); const statGate = gate();
    const origGetFile = oldHandle.getFile.bind(oldHandle);
    let armed = true;
    oldHandle.getFile = async () => { if (armed) { armed = false; statReached.open(); await statGate.p; } return origGetFile(); };
    // Hold Atlas's rename between "new file written + indexed" and "old file removed".
    const removeReached = gate(); const removeGate = gate();
    const origRemove = charDir.removeEntry.bind(charDir);
    charDir.removeEntry = async (name: string, o?: { recursive?: boolean }) => {
      if (name === oldName) { removeReached.open(); await removeGate.p; }
      return origRemove(name, o);
    };

    const scan = s.rescanDisk();
    await statReached.p;
    const upd = s.updateElement(el.id, { name: 'Finnegan', description: 'v2' });
    await removeReached.p;
    statGate.open();          // classify: served path (new name) missing from the walk, old file a "stranger"
    await tickAway();         // the stranger is read (old body) and queues behind the rename's slot
    removeGate.open();
    await upd;
    const r = await scan;

    expect((await s.getElement(el.id))!.name).toBe('Finnegan');   // today: 'Finn' (reverted)
    expect(kinds(r)).toEqual([]);                                   // today: changed:<id> with before = the user's save
    expect(kinds(await s.rescanDisk())).toEqual([]);                // today: changed:<id> again (flips back to Finnegan)
  });

  it('...and a user edit landing before the next pass loses the rename: after reopen the renamed body is in quarantine', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Finn', description: 'v1' });
    await s.listElements();
    const charDir = await dirOf(root, 'elements', 'character');
    const oldName = pathOf(root, el.id).split('/')[2];
    const oldHandle = await charDir.getFileHandle(oldName) as FakeFileHandle;
    const statReached = gate(); const statGate = gate();
    const origGetFile = oldHandle.getFile.bind(oldHandle);
    let armed = true;
    oldHandle.getFile = async () => { if (armed) { armed = false; statReached.open(); await statGate.p; } return origGetFile(); };
    const removeReached = gate(); const removeGate = gate();
    const origRemove = charDir.removeEntry.bind(charDir);
    let once = true;
    charDir.removeEntry = async (name: string, o?: { recursive?: boolean }) => {
      if (name === oldName && once) { once = false; removeReached.open(); await removeGate.p; }
      return origRemove(name, o);
    };
    const scan = s.rescanDisk();
    await statReached.p;
    const upd = s.updateElement(el.id, { name: 'Finnegan', description: 'v2' });
    await removeReached.p;
    statGate.open();
    await tickAway();
    removeGate.open();
    await upd;
    await scan;
    await s.updateElement(el.id, { supertype: 'Hero' } as Partial<Element>);  // the user keeps working
    const fresh = await open(root);
    const got = await fresh.getElement(el.id);
    expect(got!.name).toBe('Finnegan');                              // today: 'Finn'
    expect(got!.description).toBe('v2');                             // today: 'v1'
    expect(root.list().filter(p => p.startsWith('.atlas/quarantine/'))).toEqual([]); // today: the Finnegan file
  });
});

describe('DEFECT F2: a known unserved copy is never re-considered when the served file goes', () => {
  it('an agent move (copy, pass, delete) straddling two passes does not report the element deleted', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Gil', description: 'v1' });
    await s.listElements();
    const old = pathOf(root, el.id);
    root.put('elements/character/gil-moved.json', root.get(old)!);  // step 1 of the move
    expect(kinds(await s.rescanDisk())).toEqual([]);                   // a pass lands between the two steps
    await rm(root, old);                                               // step 2 of the move
    const r = await s.rescanDisk();
    expect(kinds(r)).toEqual([]);                                      // today: deleted:<id>
    expect(await s.getElement(el.id)).not.toBeNull();                  // today: null, though its file exists
    const fresh = await open(root);                                    // a reopen serves it: mid-session and reopen disagree
    expect((await fresh.getElement(el.id))!.description).toBe('v1');
  });

  it('a shadowed id (both layouts) whose served copy is deleted outside falls back to the shadow, not to "deleted"', async () => {
    const root = world();
    const id = '55555555-5555-4555-8555-555555555555';
    root.put('elements/map/m--55555555.json', j({ id, type: 'map', name: 'M', description: 'canon', local_updated_at: '2026-02-02T00:00:00.000Z' }));
    root.put('spatial/map/m--55555555.json', j({ id, type: 'map', name: 'M', description: 'legacy', local_updated_at: '2026-01-01T00:00:00.000Z' }));
    const s = await open(root);
    await s.listElements();
    expect(s.hasShadowCopy(id)).toBe(true);
    expect((await s.getElement(id))!.description).toBe('canon');
    await rm(root, 'elements/map/m--55555555.json');
    const r = await s.rescanDisk();
    expect(kinds(r)).not.toContain(`deleted:${id}`);                   // today: deleted
    expect((await s.getElement(id))?.description).toBe('legacy');      // today: undefined (element gone until reopen)
  });
});

describe('DEFECT F3: a second copy found live never joins shadowedIds (the re-key guard)', () => {
  it('a copy of a served map dropped into the other layout mid-session makes hasShadowCopy true', async () => {
    const root = world();
    const s = await open(root);
    const m = await s.createElement('map', { name: 'Atlas map' });
    await s.listElements();
    root.put(`spatial/map/atlas-map--${m.id.slice(-8)}.json`, root.get(pathOf(root, m.id))!);
    await s.rescanDisk();
    expect(s.hasShadowCopy(m.id)).toBe(true);                          // today: false, so the re-key would proceed
  });

  it('...so a re-key goes ahead and leaves the old-id copy behind to come back on reopen', async () => {
    const root = world();
    const s = await open(root);
    const m = await s.createElement('map', { name: 'Atlas map' });
    await s.listElements();
    root.put(`spatial/map/atlas-map--${m.id.slice(-8)}.json`, root.get(pathOf(root, m.id))!);
    await s.rescanDisk();
    let refused = false;
    try { await startRekey(s, { worldId: 'w1', ids: [m.id] }); } catch { refused = true; }
    expect(refused).toBe(true);                                        // today: goes ahead
  });
});

describe('DEFECT F4: a file overwritten by a rename onto another served file', () => {
  it('mv a.json b.json: A is served from b.json, not reported deleted while its body is on disk', async () => {
    const root = world();
    const s = await open(root);
    const a = await s.createElement('character', { name: 'Ann', description: 'a-body' });
    const b = await s.createElement('character', { name: 'Bo', description: 'b-body' });
    await s.listElements();
    const pa = pathOf(root, a.id);
    const pb = pathOf(root, b.id);
    root.put(pb, root.get(pa)!);
    await rm(root, pa);
    const r = await s.rescanDisk();
    expect(kinds(r)).not.toContain(`deleted:${a.id}`);                 // today: deleted:A
    expect((await s.getElement(a.id))?.description).toBe('a-body');    // today: undefined
    expect(await s.getElement(b.id)).toBeNull();                        // today: B still served from a file that holds A
  });
});

describe('DEFECT F5: a disk body adopted OUTSIDE the pass is never reported', () => {
  it('a pull that backs off (the S2 guard) adopts the outside edit into the cache, and no pass ever announces it', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Lu', description: 'v1' });
    await s.stampServerUpdatedAt(el.id, 'character', '2026-03-01T00:00:00.000Z');
    await s.listElements();
    const decidedOn = (await s.getElement(el.id))!.local_updated_at ?? null;
    editOutside(root, el.id, { description: 'agent', local_updated_at: '2026-04-01T00:00:00.000Z' });
    const applied = await s.applyServerRecordIfUnchanged('character',
      { id: el.id, name: 'Lu', description: 'server v2' }, '2026-05-01T00:00:00.000Z', decidedOn);
    expect(applied).toBe(false);
    expect((await s.getElement(el.id))!.description).toBe('agent');   // served now...
    expect(kinds(await s.rescanDisk())).toEqual([`changed:${el.id}`]); // ...but today: [] (state slice, marks, room reload never fire)
  });
});

describe('DEFECT F6: a pass that throws midway has already adopted earlier candidates, unreported', () => {
  it('a NotReadableError on one file (Windows: another process holds it) loses the report for the others', async () => {
    const root = world();
    const s = await open(root);
    const a = await s.createElement('character', { name: 'Ada', description: 'v1' });
    const b = await s.createElement('character', { name: 'Ben', description: 'v1' });
    await s.listElements();
    editOutside(root, a.id, { description: 'agent-a' });
    editOutside(root, b.id, { description: 'agent-b' });
    const bh = await (await dirOf(root, 'elements', 'character')).getFileHandle(pathOf(root, b.id).split('/')[2]) as FakeFileHandle;
    const orig = bh.getFile.bind(bh);
    let n = 0;
    bh.getFile = async () => { if (++n === 2) { const e = new Error('locked'); e.name = 'NotReadableError'; throw e; } return orig(); };
    let threw = false;
    const seen: string[] = [];
    try { seen.push(...kinds(await s.rescanDisk())); } catch { threw = true; }
    seen.push(...kinds(await s.rescanDisk()));
    expect((await s.getElement(a.id))!.description).toBe('agent-a');  // A was adopted by the failed pass...
    expect(seen).toContain(`changed:${a.id}`);                          // ...today: but never reported (only B, on the retry)
    expect(threw).toBe(false);                                          // today: the whole pass rejects
  });
});

describe('DEFECT F7: Atlas\'s own create, caught between its write and its index entry', () => {
  it('a pass during createElement\'s final step reports nothing', async () => {
    const root = world();
    const s = await open(root);
    await s.listElements();
    const charDir = await dirOf(root, 'elements', 'character');
    const reached = gate(); const hold = gate();
    const origRemove = charDir.removeEntry.bind(charDir);
    charDir.removeEntry = async (name: string, o?: { recursive?: boolean }) => {
      if (name.endsWith('.json.tmp')) { reached.open(); await hold.p; }
      return origRemove(name, o);
    };
    const c = s.createElement('character', { name: 'Nova' });
    await reached.p;                       // the final file is on disk; writeJsonAtomic has not returned
    const pass = s.rescanDisk();           // it must wait for the create's chain slot (S364 fix)...
    await new Promise(r => setTimeout(r, 20));
    hold.open();                           // ...so the create is released before the pass is awaited
    await c;
    const r = await pass;
    expect(kinds(r)).toEqual([]);          // before the fix: created:<own id>
  });
});

describe('DEFECT F8: a stranger that vanishes between the walk and the read is reported unreadable', () => {
  it('real FS semantics (a removed file\'s handle throws NotFoundError): nothing to report', async () => {
    const root = world();
    const s = await open(root);
    await s.listElements();
    root.put('elements/character/scratch.json', j({ id: '66666666-6666-4666-8666-666666666666', type: 'character', name: 'Tmp' }));
    const dir = await dirOf(root, 'elements', 'character');
    const h = await dir.getFileHandle('scratch.json') as FakeFileHandle;
    const orig = h.getFile.bind(h);
    let n = 0;
    h.getFile = async () => {
      if (++n === 1) { const f = await orig(); await dir.removeEntry('scratch.json'); return f; } // stat, then the agent removes it
      const e = new Error('gone'); e.name = 'NotFoundError'; throw e;
    };
    const r = await s.rescanDisk();
    expect(kinds(r)).toEqual([]);          // today: unreadable:scratch.json (a file that does not exist)
    expect(priv(s).otherFileStamps.size).toBe(0);
  });
});

describe('DEFECT F9: spurious "changed" when the cache holds what JSON cannot (top-level undefined)', () => {
  it('a touch of a file Atlas wrote from a body with an undefined key reports nothing', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Uma', description: undefined } as Partial<Element>);
    await s.listElements();
    root.touch(pathOf(root, el.id));
    expect(kinds(await s.rescanDisk())).toEqual([]);                  // today: changed:<id>
  });
  it('"Reload from disk" (full) on an untouched world reports nothing', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Uma' });
    await s.updateElement(el.id, { description: undefined } as Partial<Element>);
    expect(kinds(await s.rescanDisk({ full: true }))).toEqual([]);    // today: changed:<id>
  });
});

describe('DEFECT F10 (cost): an unreadable SERVED file is re-read on every pass', () => {
  it('after the one report, later passes read no contents', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Hal' });
    await s.listElements();
    root.put(pathOf(root, el.id), '{ "id": "' + el.id + '", "na');
    await s.rescanDisk();
    const before = fakeContentReads();
    await s.rescanDisk();
    await s.rescanDisk();
    expect(fakeContentReads() - before).toBe(0);                       // today: 1 per pass
  });
});

describe('DEFECT F11 (memory): otherFileStamps keeps paths that no longer exist', () => {
  it('twenty half-written scratch files, each later removed, leave no entries', async () => {
    const root = world();
    const s = await open(root);
    await s.listElements();
    for (let i = 0; i < 20; i++) {
      root.put(`elements/character/scratch-${i}.json`, '{ "id": ');
      await s.rescanDisk();
      await rm(root, `elements/character/scratch-${i}.json`);
      await s.rescanDisk();
    }
    expect(priv(s).otherFileStamps.size).toBe(0);                     // today: 20
  });
});

describe('BEHAVIOUR CHANGE B1: S2 turns a corrupt file into a thrown pull', () => {
  it('applyServerRecordIfUnchanged throws CorruptFileError where it used to apply from the cache', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Cor', description: 'v1' });
    await s.stampServerUpdatedAt(el.id, 'character', '2026-03-01T00:00:00.000Z');
    await s.listElements();
    const decidedOn = (await s.getElement(el.id))!.local_updated_at ?? null;
    const p = pathOf(root, el.id);
    root.put(p, '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> x\n');
    await expect(s.applyServerRecordIfUnchanged('character',
      { id: el.id, name: 'Cor', description: 'server' }, '2026-05-01T00:00:00.000Z', decidedOn))
      .rejects.toBeInstanceOf(CorruptFileError);
    expect(root.get(p)!.startsWith('<<<<<<<')).toBe(true);           // the file is untouched (convention 94 holds)
  });
});

describe('LOW F12: close() during a confirm leaves entries in the closed store\'s maps', () => {
  it('bodyCache and fileStamps stay empty after close', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Zed' });
    await s.listElements();
    editOutside(root, el.id, { description: 'outside' });
    const h = await (await dirOf(root, 'elements', 'character')).getFileHandle(pathOf(root, el.id).split('/')[2]) as FakeFileHandle;
    const orig = h.getFile.bind(h);
    const reached = gate(); const hold = gate();
    let n = 0;
    h.getFile = async () => { if (++n === 2) { reached.open(); await hold.p; } return orig(); };
    const scan = s.rescanDisk();
    await reached.p;
    await s.close();
    hold.open();
    await scan;
    expect(priv(s).bodyCache.size).toBe(0);                           // today: 1
    expect(priv(s).fileStamps.size).toBe(0);                          // today: 1
  });
});

// ---------------------------------------------------------------------------

describe('UPHELD', () => {
  it('U1 a full request during a quick pass makes the queued follow-up full', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Kai', description: 'aaaa' });
    await s.listElements();
    const [d, ty, f] = pathOf(root, el.id).split('/');
    const h = await (await dirOf(root, d, ty)).getFileHandle(f) as FakeFileHandle;
    h.data = h.data.replace('"aaaa"', '"bbbb"'); // same size, same mtime: only a full pass sees it
    const r1p = s.rescanDisk();
    const r2p = s.rescanDisk();
    const r3p = s.rescanDisk({ full: true });
    expect(r2p).toBe(r3p);
    const [r1, r3] = await Promise.all([r1p, r3p]);
    expect(kinds(r1)).toEqual([]);
    expect(kinds(r3)).toEqual([`changed:${el.id}`]);
  });

  it('U2 a pass racing an Atlas update of the same id: both edits survive, nothing reverts', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Rae', description: 'v1' });
    await s.listElements();
    editOutside(root, el.id, { description: 'agent' });
    const [r] = await Promise.all([s.rescanDisk(), s.updateElement(el.id, { supertype: 'Hero' } as Partial<Element>)]);
    const got = await s.getElement(el.id) as Element & { supertype?: string };
    expect(got.description).toBe('agent');
    expect(got.supertype).toBe('Hero');
    const disk = JSON.parse(root.get(pathOf(root, el.id))!);
    expect(disk.description).toBe('agent');
    expect(disk.supertype).toBe('Hero');
    expect(kinds(r).every(k => k === `changed:${el.id}`)).toBe(true);
    expect(kinds(await s.rescanDisk())).toEqual([]);
  });

  it('U3 a pass racing an Atlas delete of the same id never resurrects it', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Del', description: 'v1' });
    await s.listElements();
    editOutside(root, el.id, { description: 'agent' });
    await Promise.all([s.rescanDisk(), s.deleteElement(el.id)]);
    expect(await s.getElement(el.id)).toBeNull();
    expect(root.list().filter(p => p.startsWith('elements/character/'))).toEqual([]);
    expect(kinds(await s.rescanDisk())).toEqual([]);
  });

  it('U4 an id clash across types: the served element stays, the stranger is left alone, reported nowhere', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Ida' });
    await s.listElements();
    root.put('elements/location/ida-place.json', j({ id: el.id, type: 'location', name: 'Ida place' }));
    expect(kinds(await s.rescanDisk())).toEqual([]);
    expect((await s.getElement(el.id))!.type).toBe('character');
    expect(kinds(await s.rescanDisk())).toEqual([]);
  });

  it('U5 an unreadable stranger that becomes readable is created; unreadable again keeps the body', async () => {
    const root = world();
    const s = await open(root);
    await s.listElements();
    const id = '77777777-7777-4777-8777-777777777777';
    root.put('elements/character/late.json', '{ "id": "' + id);
    expect(kinds(await s.rescanDisk())).toEqual(['unreadable:late.json']);
    expect(kinds(await s.rescanDisk())).toEqual([]);
    root.put('elements/character/late.json', j({ id, type: 'character', name: 'Late' }));
    expect(kinds(await s.rescanDisk())).toEqual([`created:${id}`]);
    root.put('elements/character/late.json', '{ broken');
    expect(kinds(await s.rescanDisk())).toEqual([`unreadable:${id}`]);
    expect((await s.getElement(id))!.name).toBe('Late');
  });

  it('U6 a case-only rename on a case-folding folder: no change, one file after the next write', async () => {
    const root = world();
    const s = await open(root);
    const el = await s.createElement('character', { name: 'Finn' });
    await s.listElements();
    const dir = await dirOf(root, 'elements', 'character');
    // Fold case like NTFS/APFS: lookups ignore case.
    const origGet = dir.getFileHandle.bind(dir);
    dir.getFileHandle = async (name: string, o?: { create?: boolean }) => {
      for (const [k] of dir.children) if (k.toLowerCase() === name.toLowerCase()) return origGet(k, o);
      return origGet(name, o);
    };
    const origRm = dir.removeEntry.bind(dir);
    dir.removeEntry = async (name: string, o?: { recursive?: boolean }) => {
      for (const [k] of dir.children) if (k.toLowerCase() === name.toLowerCase()) return origRm(k, o);
      return origRm(name, o);
    };
    const old = pathOf(root, el.id).split('/')[2];
    const text = root.get(`elements/character/${old}`)!;
    await dir.removeEntry(old);
    root.put(`elements/character/${old.toUpperCase().replace('.JSON', '.json')}`, text);
    expect(kinds(await s.rescanDisk())).toEqual([]);
    await s.updateElement(el.id, { description: 'after' });
    expect(root.list().filter(p => p.startsWith('elements/character/'))).toHaveLength(1);
    expect(kinds(await s.rescanDisk())).toEqual([]);
  });

  it('U7 Atlas-side writes the shipped test does not cover are quiet and read nothing: pull-apply (both paths), resetSyncBaseline, cascade delete, re-key', async () => {
    const root = world();
    const s = await open(root);
    const a = await s.createElement('character', { name: 'Pat', description: 'v1' });
    const m = await s.createElement('map', { name: 'Mappa' });
    await s.createElement('pin', { name: 'P1', map_id: m.id } as Partial<Element>);
    const loose = await s.createElement('location', { name: 'Loose' });
    await s.listElements();
    await s.stampServerUpdatedAt(a.id, 'character', '2026-03-01T00:00:00.000Z');
    const decidedOn = (await s.getElement(a.id))!.local_updated_at ?? null;
    expect(await s.applyServerRecordIfUnchanged('character', { id: a.id, name: 'Patricia', description: 'server' }, '2026-05-01T00:00:00.000Z', decidedOn)).toBe(true);
    await s.applyServerRecord('character', { id: '88888888-8888-4888-8888-888888888888', name: 'Pulled' }, '2026-05-01T00:00:00.000Z');
    await s.resetSyncBaseline();
    await s.deleteElement(m.id); // cascades the pin
    await startRekey(s, { worldId: 'w1', ids: [loose.id] });
    await s.awaitTidies();
    await s.rescanDisk();
    const before = fakeContentReads();
    expect(kinds(await s.rescanDisk())).toEqual([]);
    expect(fakeContentReads() - before).toBe(0);
  });

  it('U8 the pull path (no outside edit) behaves as before: applies, cache equals disk, no report', async () => {
    const root = world();
    const s = await open(root);
    const a = await s.createElement('character', { name: 'Nor', description: 'v1' });
    await s.stampServerUpdatedAt(a.id, 'character', '2026-03-01T00:00:00.000Z');
    await s.listElements();
    const decidedOn = (await s.getElement(a.id))!.local_updated_at ?? null;
    expect(await s.applyServerRecordIfUnchanged('character', { id: a.id, name: 'Nor', description: 'v2' }, '2026-05-01T00:00:00.000Z', decidedOn)).toBe(true);
    expect((await s.getElement(a.id))!.description).toBe('v2');
    expect(JSON.parse(root.get(pathOf(root, a.id))!).description).toBe('v2');
    expect(kinds(await s.rescanDisk())).toEqual([]);
  });

  it('U9 a layout move (elements/ to spatial/) of a served map keeps its id and updates the layout', async () => {
    const root = world();
    const s = await open(root);
    const m = await s.createElement('map', { name: 'Mv', description: 'v1' });
    await s.listElements();
    const p = pathOf(root, m.id);
    root.put(`spatial/map/${p.split('/')[2]}`, root.get(p)!);
    await rm(root, p);
    expect(kinds(await s.rescanDisk())).toEqual([]);
    await s.updateElement(m.id, { description: 'v2' });
    expect(root.list().filter(x => x.includes(m.id.slice(-8)))).toEqual([`spatial/map/${p.split('/')[2]}`]);
  });
});
