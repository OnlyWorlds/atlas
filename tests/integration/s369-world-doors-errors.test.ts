/**
 * The world doors say what went wrong in words.
 *
 * - opening a world that is no longer listed names no id and no "registry";
 * - a lost folder handle offers "Open the folder", and picking the folder
 *   again restores the entry's handle (openWorldFolder);
 * - a refused folder permission is a disk-permission problem with Allow access;
 * - a key check names a refused key, an unknown world and no connection, and
 *   hands every other error back for the caller to word;
 * - the sign-in line keeps its written branches and never reads raw text;
 * - the add-a-world icons carry a title and an aria-label each.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setActiveStore, clearParkedStores } from '../../src/core/active-store';
import { isPlainError } from '../../src/core/plain-error';
import { problemFor } from '../../src/core/problems';
import { OwV2Error } from '../../src/sync/ow-v2-client-adapter';
import { FakeDirHandle } from '../fixtures/fake-fs';

const vault = vi.hoisted(() => ({
  handles: new Map<string, unknown>(),
  writable: true,
}));

vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: async (key: string, h: unknown) => { vault.handles.set(key, h); },
  loadHandle: async (key: string) => vault.handles.get(key),
  ensureWritable: async () => vault.writable,
  queryWritable: async () => vault.writable,
  deleteHandle: async (key: string) => { vault.handles.delete(key); },
  listHandleKeys: async () => [...vault.handles.keys()],
}));

import { activateWorld, mountWorldsBody } from '../../src/sidebar/worlds-sidebar';
import { openWorldFolder } from '../../src/setup/atlas-root-flow';
import { keyCheckError, CANNOT_REACH_LINE } from '../../src/setup/key-check-errors';
import { signInErrorLine } from '../../src/middle/settings-account';

interface Said { kind: string; text: string; actions: string[] }

function fakeToasts(said: Said[]) {
  return {
    error: (m: string) => said.push({ kind: 'error', text: m, actions: [] }),
    info: (m: string) => said.push({ kind: 'info', text: m, actions: [] }),
    success: (m: string) => said.push({ kind: 'success', text: m, actions: [] }),
    show: (m: string, kind: string, _d?: number, opts: { actions?: { label: string }[] } = {}) =>
      said.push({ kind, text: m, actions: (opts.actions ?? []).map(a => a.label) }),
    problem: (p: { sentence: string }, opts: { fixes?: { label: string }[] } = {}) =>
      said.push({ kind: 'problem', text: p.sentence, actions: (opts.fixes ?? []).map(a => a.label) }),
  } as never;
}

const WORLD_ID = '0193a5c2-1111-7aaa-8bbb-cccccccccccc';

function entry() {
  return {
    id: 'entry-1',
    name: 'Hollow Reach',
    state: 'local-only',
    folder: { handle_key: `world-${WORLD_ID}`, folder_name: 'hollow-reach' },
  } as never;
}

beforeEach(() => {
  vault.handles.clear();
  vault.writable = true;
  localStorage.clear();
  setActiveStore(null);
  clearParkedStores();
  patchSlice('active', null);
  patchSlice('data', { elements: [] });
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry()] });
  window.location.hash = '#/';
});

describe('activateWorld failure copy', () => {
  it('a world no longer listed: no id, no "registry"', async () => {
    const said: Said[] = [];
    expect(await activateWorld('0193a5c2-dead-7aaa-8bbb-cccccccccccc', fakeToasts(said))).toBe(false);
    expect(said).toHaveLength(1);
    expect(said[0].text).not.toMatch(/registry|0193a5c2/);
    expect(said[0].text).toMatch(/no longer in your list/);
  });

  it('a lost handle offers "Open the folder" where the browser can pick folders', async () => {
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => Promise.resolve(null);
    try {
      const said: Said[] = [];
      expect(await activateWorld('entry-1', fakeToasts(said))).toBe(false);
      expect(said).toHaveLength(1);
      expect(said[0].kind).toBe('error');
      expect(said[0].actions).toEqual(['Open the folder']);
      expect(said[0].text).toMatch(/Your files are safe/);
    } finally {
      delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    }
  });

  it('without a folder picker the lost-handle toast offers no folder button (1.17, conv. 129)', async () => {
    const said: Said[] = [];
    expect(await activateWorld('entry-1', fakeToasts(said))).toBe(false);
    expect(said).toHaveLength(1);
    expect(said[0].actions ?? []).toEqual([]);
  });

  it('a refused permission is a disk-permission problem with Allow access', async () => {
    vault.handles.set(`world-${WORLD_ID}`, new FakeDirHandle('hollow-reach'));
    vault.writable = false;
    const said: Said[] = [];
    expect(await activateWorld('entry-1', fakeToasts(said))).toBe(false);
    expect(said).toHaveLength(1);
    expect(said[0].kind).toBe('problem');
    expect(said[0].text).toMatch(/permission to change this world's folder/);
    expect(said[0].actions).toEqual(['Allow access']);
  });
});

describe('openWorldFolder', () => {
  it('a folder with no world.json is refused in words', async () => {
    const err = await openWorldFolder(new FakeDirHandle('notes') as never).catch(e => e);
    expect(isPlainError(err)).toBe(true);
    expect(problemFor(err).sentence).toMatch(/not a world/);
  });

  it('picking a listed world whose handle was lost restores the handle', async () => {
    const dir = new FakeDirHandle('hollow-reach');
    dir.put('world.json', JSON.stringify({ id: WORLD_ID, name: 'Hollow Reach' }));
    const res = await openWorldFolder(dir as never);
    expect(res).toEqual({ worldId: 'entry-1', already: true });
    expect(vault.handles.get(`world-${WORLD_ID}`)).toBe(dir);
  });

  it('a live handle is never replaced', async () => {
    const live = new FakeDirHandle('hollow-reach');
    vault.handles.set(`world-${WORLD_ID}`, live);
    const copy = new FakeDirHandle('hollow-reach-copy');
    copy.put('world.json', JSON.stringify({ id: WORLD_ID, name: 'Hollow Reach' }));
    await openWorldFolder(copy as never);
    expect(vault.handles.get(`world-${WORLD_ID}`)).toBe(live);
  });
});

describe('keyCheckError', () => {
  const owErr = (status: number) => new OwV2Error(status, { code: 'x', message: 'raw server words' }, '');

  it('names a refused key, for a write key and a read key', () => {
    const write = keyCheckError(owErr(401));
    expect(isPlainError(write)).toBe(true);
    expect((write as Error).message).toMatch(/that API key\. Check it/);
    expect((keyCheckError(owErr(403), { readOnly: true }) as Error).message).toMatch(/read key/);
  });

  it('names the PIN when keel refused the PIN, the key when it refused the key', () => {
    // keel's own answers, read on live 2026-10-19: param "API-Pin" for a right key with a wrong PIN.
    const pin = keyCheckError(new OwV2Error(401, { code: 'invalid_credentials', message: 'Incorrect PIN.', param: 'API-Pin' }, ''));
    expect(isPlainError(pin)).toBe(true);
    expect((pin as Error).message).toBe('OnlyWorlds did not accept that PIN. Check it, then try again.');
    const key = keyCheckError(new OwV2Error(401, { code: 'invalid_credentials', message: 'No valid API-Key.', param: null }, ''));
    expect((key as Error).message).toMatch(/that API key\. Check it/);
  });

  it('reads the legacy "API Error NNN:" prefix, never a digit run elsewhere', () => {
    expect(isPlainError(keyCheckError(new Error('API Error 404: Not found')))).toBe(true);
    const odd = new Error('element 4011 broke');
    expect(keyCheckError(odd)).toBe(odd);
  });

  it('no connection is said plainly; anything else comes back unchanged', () => {
    expect((keyCheckError(new TypeError('Failed to fetch')) as Error).message).toBe(CANNOT_REACH_LINE);
    const boom = owErr(500);
    expect(keyCheckError(boom)).toBe(boom);
  });
});

describe('signInErrorLine (B6)', () => {
  it('keeps the written branches and words the rest', () => {
    expect(signInErrorLine(new OwV2Error(401, { code: 'invalid_key' }, ''))).toMatch(/not recognized/);
    expect(signInErrorLine(new OwV2Error(400, { code: 'bad', message: 'raw server words' }, ''))).toMatch(/did not accept that account token/);
    expect(signInErrorLine(new TypeError('Failed to fetch'))).toBe(CANNOT_REACH_LINE);
    const html = signInErrorLine(new Error('account response was not JSON (GET /account): <!DOCTYPE html>'));
    expect(html).not.toMatch(/DOCTYPE|not JSON/);
  });
});

describe('add-a-world icons (1g)', () => {
  it('every icon button has a title and an aria-label; the glyphs are hidden', () => {
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => Promise.resolve(null);
    patchSlice('atlasRoot', { folderName: 'onlyworlds-atlas', pathHint: 'Docs/onlyworlds-atlas' });
    const content = document.createElement('div');
    document.body.appendChild(content);
    const unmount = mountWorldsBody({ content, toasts: fakeToasts([]) });
    const icons = [...content.querySelectorAll<HTMLButtonElement>('.atlas-create-icon-btn')];
    expect(icons).toHaveLength(5);
    for (const b of icons) {
      expect(b.getAttribute('title')).toBeTruthy();
      expect(b.getAttribute('aria-label')).toBeTruthy();
      for (const g of b.querySelectorAll('.material-symbols-outlined')) expect(g.getAttribute('aria-hidden')).toBe('true');
    }
    expect(icons.map(b => b.getAttribute('aria-label'))).toEqual([
      'Create a world', 'Open a world folder', 'New world on OnlyWorlds',
      'Download a world from OnlyWorlds', 'View a shared world',
    ]);
    unmount();
    content.remove();
    patchSlice('atlasRoot', null);
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  it('without a folder picker the open-folder icon is not offered (1.17, conv. 129)', () => {
    patchSlice('atlasRoot', { folderName: 'onlyworlds-atlas', pathHint: 'Docs/onlyworlds-atlas' });
    const content = document.createElement('div');
    document.body.appendChild(content);
    const unmount = mountWorldsBody({ content, toasts: fakeToasts([]) });
    const labels = [...content.querySelectorAll<HTMLButtonElement>('.atlas-create-icon-btn')].map(b => b.getAttribute('aria-label'));
    expect(labels).not.toContain('Open a world folder');
    expect(labels).toHaveLength(4);
    unmount();
    content.remove();
    patchSlice('atlasRoot', null);
  });
});
