/**
 * newElementId: a new element's id is an RFC 9562 UUIDv7 that carries when it
 * was made (the home's grid reads arrival from it), monotonic per tab, and a
 * re-key can mint at an old element's moment. newId stays v4 (worlds, media,
 * tabs name things by the id's first 8 hex).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { newElementId, newId } from '../../src/store/folder-store';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { arrivalOf } from '../../src/core/home-grid';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const msOf = (id: string) => parseInt(id.slice(0, 8) + id.slice(9, 13), 16);

afterEach(() => { vi.restoreAllMocks(); });

describe('newElementId', () => {
  it('is a lowercase RFC 9562 v7: version nibble 7, variant 10, 48 bits of the clock', () => {
    const before = Date.now();
    const id = newElementId();
    expect(id).toMatch(V7);
    expect(id).toBe(id.toLowerCase());
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
    expect(msOf(id)).toBeGreaterThanOrEqual(before);
    expect(msOf(id)).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('never mints at or below the last milliseconds it minted: 1,000 calls in a tight loop strictly rise', () => {
    const ids = Array.from({ length: 1000 }, () => newElementId());
    const ms = ids.map(msOf);
    for (let i = 1; i < ms.length; i++) expect(ms[i]).toBeGreaterThan(ms[i - 1]);
    expect(new Set(ids).size).toBe(1000);
    // Each id sorts after the one before it, as a string too.
    expect([...ids].sort()).toEqual(ids);
  });

  it('keeps rising when the clock steps back', () => {
    const a = newElementId();
    vi.spyOn(Date, 'now').mockReturnValue(msOf(a) - 60_000);
    const b = newElementId();
    expect(msOf(b)).toBeGreaterThan(msOf(a));
  });

  it('with atMs mints at exactly that moment, fresh random bits, and leaves the floor where it is', () => {
    const at = Date.UTC(2024, 4, 5, 6, 7, 8, 9);
    const floor = msOf(newElementId());
    const x = newElementId(at);
    const y = newElementId(at);
    expect(x).toMatch(V7);
    expect(msOf(x)).toBe(at);
    expect(msOf(y)).toBe(at);
    expect(x).not.toBe(y);
    expect(arrivalOf({ id: x, type: 'character' })).toBe(at);
    // The next plain mint follows the floor, not the old moment.
    expect(msOf(newElementId())).toBeGreaterThan(floor);
  });

  it('an atMs past the floor does not move it either', () => {
    const ahead = Date.now() + 3_600_000;
    expect(msOf(newElementId(ahead))).toBe(ahead);
    expect(msOf(newElementId())).toBeLessThan(ahead);
  });

  it('an atMs out of range or not whole mints as new', () => {
    for (const bad of [-1, 2 ** 48, 1.5, Number.NaN, -Infinity]) {
      const id = newElementId(bad);
      expect(id).toMatch(V7);
      expect(Math.abs(msOf(id) - Date.now())).toBeLessThan(5000);
    }
  });

  it('newId stays v4', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('the store mints a v7 for an element born with no id, and keeps a given one', async () => {
    const s = new MockFolderStore();
    const born = await s.createElement('character', { name: 'Mira' });
    expect(born.id).toMatch(V7);
    const given = '00000000-0000-4000-8000-000000000001';
    expect((await s.createElement('character', { id: given, name: 'Kept' })).id).toBe(given);
  });

  it('the real folder store mints a v7 too, and a media id stays v4', async () => {
    const root = new FakeDirHandle('w');
    root.put('world.json', JSON.stringify({ id: 'w1', name: 'W' }) + '\n');
    const s = new FsFolderStore({ tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
    await s.open(root as unknown as FileSystemDirectoryHandle);
    const born = await s.createElement('character', { name: 'Mira' });
    expect(born.id).toMatch(V7);
    const media = await s.addMedia(born.id, new File(['png'], 'map.png', { type: 'image/png' }));
    expect(media.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  });
});
