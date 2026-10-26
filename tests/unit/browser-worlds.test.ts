/**
 * Worlds in browser storage, the guards (1.17 bout 0, conv. 129).
 * Design note: browser worlds, §1 and §7.2.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import {
  BROWSER_HOME,
  isAtlasOnlyStorage,
  isBrowserWorld,
  removeBrowserWorldDir,
  setOpfsRootForTests,
  worldHandleFor,
} from '../../src/core/browser-worlds';
import { pickTourEntry } from '../../src/tour/tour-engine';
import type { WorldRegistryEntry } from '../../src/core/types';

const entry = (over: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry => ({
  id: 'reg-1',
  name: 'Mine',
  state: 'local-only',
  folder: { handle_key: 'world-w1', folder_name: 'mine-w1aaaaaa-1a2b' },
  created_at: '2026-10-04T00:00:00.000Z',
  ...over,
});

function opfsWith(...paths: string[]): FakeDirHandle {
  const root = new FakeDirHandle('opfs');
  for (const p of paths) root.put(p, '{}\n');
  setOpfsRootForTests(async () => root as unknown as FileSystemDirectoryHandle);
  return root;
}

afterEach(() => setOpfsRootForTests(null));

describe('isBrowserWorld / isAtlasOnlyStorage', () => {
  it('reads where, and the storage readers also cover the tour sandbox', () => {
    expect(isBrowserWorld(entry({ where: 'browser' }))).toBe(true);
    expect(isBrowserWorld(entry())).toBe(false);
    expect(isBrowserWorld(null)).toBe(false);
    expect(isAtlasOnlyStorage(entry({ where: 'browser' }))).toBe(true);
    expect(isAtlasOnlyStorage(entry({ demo: true }))).toBe(true); // a 1.16 tour entry: no where
    expect(isAtlasOnlyStorage(entry())).toBe(false);
  });
});

describe('worldHandleFor', () => {
  it('derives a browser world from its path under the browser home', async () => {
    const root = opfsWith(`${BROWSER_HOME}/mine-w1aaaaaa-1a2b/world.json`);
    const r = await worldHandleFor(entry({ where: 'browser' }));
    expect(r.kind).toBe('ok');
    const dir = (root.children.get(BROWSER_HOME) as FakeDirHandle).children.get('mine-w1aaaaaa-1a2b');
    expect(r.kind === 'ok' && (r.handle as unknown)).toBe(dir);
  });

  it('says gone when the world directory is missing, and when the browser home is missing', async () => {
    opfsWith(`${BROWSER_HOME}/someone-else-xx/world.json`);
    expect((await worldHandleFor(entry({ where: 'browser' }))).kind).toBe('gone');
    opfsWith('unrelated/world.json');
    expect((await worldHandleFor(entry({ where: 'browser' }))).kind).toBe('gone');
  });

  it('throws an error that is not NotFound rather than calling the world gone', async () => {
    setOpfsRootForTests(async () => {
      throw Object.assign(new Error('Unknown failure'), { name: 'UnknownError' });
    });
    await expect(worldHandleFor(entry({ where: 'browser' }))).rejects.toMatchObject({ name: 'UnknownError' });
  });

  it('a folder world with no vault handle is lost, not gone', async () => {
    opfsWith();
    expect((await worldHandleFor(entry({ folder: { handle_key: 'world-nothing-stored', folder_name: 'x' } }))).kind).toBe('lost');
  });
});

describe('removeBrowserWorldDir', () => {
  it('removes only the directory the entry names, one level under the browser home', async () => {
    const root = opfsWith(
      `${BROWSER_HOME}/mine-w1aaaaaa-1a2b/world.json`,
      `${BROWSER_HOME}/mine-w1aaaaaa-1a2b/elements/character/a.json`,
      `${BROWSER_HOME}/mine-w1aaaaaa-9f9f/world.json`, // same world name, another directory
    );
    await removeBrowserWorldDir(entry({ where: 'browser' }));
    const home = root.children.get(BROWSER_HOME) as FakeDirHandle;
    expect([...home.children.keys()]).toEqual(['mine-w1aaaaaa-9f9f']);
  });

  it('treats an already-gone directory as removed', async () => {
    opfsWith(`${BROWSER_HOME}/other/world.json`);
    await expect(removeBrowserWorldDir(entry({ where: 'browser' }))).resolves.toBeUndefined();
  });

  it('retries a busy refusal, then gives up and reports it', async () => {
    const root = opfsWith(`${BROWSER_HOME}/mine-w1aaaaaa-1a2b/world.json`);
    const home = root.children.get(BROWSER_HOME) as FakeDirHandle;
    let refusals = 2;
    const real = home.removeEntry.bind(home);
    home.removeEntry = async (name, opts) => {
      if (refusals-- > 0) throw Object.assign(new Error('busy'), { name: 'NoModificationAllowedError' });
      return real(name, opts);
    };
    const waits: number[] = [];
    await removeBrowserWorldDir(entry({ where: 'browser' }), async ms => { waits.push(ms); });
    expect(waits).toEqual([100, 250]);
    expect(home.children.size).toBe(0);

    root.put(`${BROWSER_HOME}/mine-w1aaaaaa-1a2b/world.json`, '{}\n');
    home.removeEntry = async () => { throw Object.assign(new Error('busy'), { name: 'NoModificationAllowedError' }); };
    await expect(removeBrowserWorldDir(entry({ where: 'browser' }), async () => {})).rejects.toMatchObject({ name: 'NoModificationAllowedError' });
    expect(home.children.size).toBe(1);
  });

  it('refuses a folder world', async () => {
    opfsWith();
    await expect(removeBrowserWorldDir(entry())).rejects.toThrow();
  });
});

describe('pickTourEntry', () => {
  const tourBrowser = entry({ id: 'tour-b', demo: true, where: 'browser', folder: { handle_key: 'world-t', folder_name: 'hyperion-t1aaaaaa-0001' } });
  const tourLegacy = entry({ id: 'tour-l', demo: true, folder: { handle_key: 'world-l', folder_name: 'hyperion-tour-l1aaaaaa' } });
  const kept = entry({ id: 'kept', where: 'browser' });

  it('takes the world the tour state names only while it is still demo', () => {
    expect(pickTourEntry([kept, tourBrowser], 'kept')?.id).toBe('tour-b');
    expect(pickTourEntry([kept], 'kept')).toBeUndefined();
    expect(pickTourEntry([tourBrowser, tourLegacy], 'tour-l')?.id).toBe('tour-l');
  });

  it('with no tour state (the scaffold-race rollback) finds a demo world in browser storage', () => {
    expect(pickTourEntry([kept, tourBrowser], null)?.id).toBe('tour-b');
  });

  it('finds a 1.16 tour entry by its old prefix, and never a user world named alike', () => {
    expect(pickTourEntry([tourLegacy], undefined)?.id).toBe('tour-l');
    const userNamedAlike = entry({ id: 'u', folder: { handle_key: 'world-u', folder_name: 'hyperion-tour-u1aaaaaa' } });
    expect(pickTourEntry([userNamedAlike], undefined)).toBeUndefined();
  });
});
