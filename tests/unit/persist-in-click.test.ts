/**
 * The browser is asked to keep worlds inside the click that makes or brings
 * one into this browser, before the click's first await (contract §2.3,
 * invariant 10), and a row the browser cleared is
 * not a world it keeps, so after an eviction the next make asks again.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/where-choice', () => ({ askWhere: async () => null })); // the user cancels

import { requestPersistOnFirstBrowserWorld } from '../../src/setup/world-parent';
import { openAccountWorld } from '../../src/sync/account-worlds';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry, type AccountWorldRow, type WorldRegistryEntry } from '../../src/core/types';
import type { ToastManager } from '../../src/ui/toast-manager';

const persist = vi.fn(() => new Promise<boolean>(() => {})); // Firefox may never answer
let persistedNow = false;
const persisted = vi.fn(async () => persistedNow);
const realUa = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'userAgent');
const asFirefox = () => Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Windows NT 10.0; rv:150.0) Gecko/20100101 Firefox/150.0' });
const realStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } as unknown as ToastManager;
const browserWorld = (over: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry => ({
  id: 'b1', name: 'B', state: 'local-only', where: 'browser', created_at: '2026-10-05T00:00:00.000Z',
  folder: { handle_key: 'world-b1', folder_name: 'b-0192a000-1a2b' }, ...over,
} as WorldRegistryEntry);

beforeEach(() => {
  persist.mockClear();
  persisted.mockClear();
  persistedNow = false;
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist, persisted } });
});
afterEach(() => {
  delete (navigator as unknown as { userAgent?: string }).userAgent; // the prototype's again
  void realUa;
  if (realStorage) Object.defineProperty(navigator, 'storage', realStorage);
  else delete (navigator as unknown as { storage?: unknown }).storage;
});

describe('requestPersistOnFirstBrowserWorld', () => {
  it('asks again once every browser world was cleared by the browser', () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [browserWorld({ cleared_at: '2026-10-05T09:00:00.000Z' })] });
    requestPersistOnFirstBrowserWorld();
    expect(persist).toHaveBeenCalledTimes(1);
  });
  it('control: a world still kept here means the browser was asked already', () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [browserWorld()] });
    requestPersistOnFirstBrowserWorld();
    expect(persist).not.toHaveBeenCalled();
  });
});

describe("the Firefox line at a door with no dialog (K7, built as Temper's lean)", () => {
  it('is said on Firefox while the origin is not persisted', async () => {
    asFirefox();
    patchSlice('registry', { ...defaultRegistry(), worlds: [] });
    const said: string[] = [];
    requestPersistOnFirstBrowserWorld(line => said.push(line));
    await vi.waitFor(() => expect(said).toHaveLength(1));
    expect(said[0]).toMatch(/^Firefox will ask/);
  });
  it('is not said once the origin is persisted, nor in another browser', async () => {
    asFirefox();
    persistedNow = true;
    patchSlice('registry', { ...defaultRegistry(), worlds: [] });
    const said: string[] = [];
    requestPersistOnFirstBrowserWorld(line => said.push(line));
    await new Promise(r => setTimeout(r, 0));
    delete (navigator as unknown as { userAgent?: string }).userAgent;
    persistedNow = false;
    requestPersistOnFirstBrowserWorld(line => said.push(line));
    await new Promise(r => setTimeout(r, 0));
    expect(said).toEqual([]);
  });
});

describe('the doors without a folder picker ask before their first await', () => {
  it("an account world's open", async () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [], account_token: 't' });
    const pending = openAccountWorld({ id: 'srv-1', name: 'Online' } as AccountWorldRow, toasts);
    expect(persist).toHaveBeenCalledTimes(1); // synchronous: before the dynamic import
    await pending;
  });

  // The Data room and the finale are whole rooms to mount; their call sites
  // are read structurally: the ask sits before the await it must precede.
  const src = (p: string) => readFileSync(resolve(process.cwd(), 'src', p), 'utf8');

  it("the Data room's import as new, and a world file dropped or chosen there", () => {
    const room = src('middle/import-room.ts');
    const ask = room.indexOf('requestPersistOnFirstBrowserWorld(', room.indexOf("if (mode === 'new') {"));
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(room.indexOf("await import('../ui/where-choice')"));
    // One file door for the drop and the chooser (`takeFile`, 1.88.3): a world-named file asks
    // and opens at once; a name that says neither asks before the bytes are read (OW-1).
    const opens = [...room.matchAll(/void openWorldFileFrom\(file, toasts\)/g)].map(m => m.index!);
    expect(opens).toHaveLength(2);
    expect(room.slice(opens[0] - 100, opens[0])).toContain('requestPersistOnFirstBrowserWorld(');
    const sniff = room.indexOf('void startsLikeWorldFile(file)');
    expect(sniff).toBeGreaterThan(-1);
    expect(sniff).toBeLessThan(opens[1]);
    const askBeforeSniff = room.lastIndexOf('requestPersistOnFirstBrowserWorld(', sniff);
    // A .json is read as JSON before that ask: an import into this world never asks to keep one.
    const jsonFirst = room.indexOf("if (/\\.json$/i.test(file.name) || file.type === 'application/json') { readJson(); return; }");
    expect(jsonFirst).toBeGreaterThan(-1);
    expect(askBeforeSniff).toBeGreaterThan(jsonFirst);
    expect(room.slice(askBeforeSniff, sniff)).not.toMatch(/await|\.then\(/);
    expect([...room.matchAll(/takeFile\(file, /g)]).toHaveLength(2);
  });

  it("the finale's Save it to a folder, beside Keep", () => {
    const bar = src('tour/tour-bar.ts');
    const at = bar.indexOf("if (control === 'keep' || control === 'save') {");
    expect(at).toBeGreaterThan(-1);
    expect(bar.slice(at, at + 120)).toContain('requestPersistOnFirstBrowserWorld(');
  });
});
