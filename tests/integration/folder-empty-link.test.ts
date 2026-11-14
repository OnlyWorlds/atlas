/**
 * A single link holding the empty string is no link (serial 126, the layout profile's reading H): the real store
 * reads it as null at load, under either spelling, so no element points at "" and an edit never sends "" back to
 * keel, which refuses it. Controls: a real id stays, a multi-link list and a text field are untouched, and the read
 * writes nothing to disk.
 */
import { describe, it, expect } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 10, 14, 0, 0, t++)).toISOString();
async function open(root: FakeDirHandle): Promise<FsFolderStore> {
  const s = new FsFolderStore({ clock, tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
  await s.open(root as unknown as FileSystemDirectoryHandle);
  return s;
}

const MAP = '11111111-1111-4111-8111-111111111111';
const PIN = '22222222-2222-4222-8222-222222222222';
const PIN2 = '22222222-2222-4222-8222-222222222223';
const CH = '33333333-3333-4333-8333-333333333333';
const LOC = '44444444-4444-4444-8444-444444444444';
const MAP2 = '55555555-5555-4555-8555-555555555555';
const MK = '66666666-6666-4666-8666-666666666666';

function world(): FakeDirHandle {
  const r = new FakeDirHandle('w');
  r.put('world.json', j({ id: 'w1', name: 'W' }));
  r.put(`elements/map/m--${MAP.slice(0, 8)}.json`, j({ id: MAP, type: 'map', name: 'M' }));
  r.put(`elements/map/n--${MAP2.slice(0, 8)}.json`, j({ id: MAP2, type: 'map', name: 'N', parent_map: '', location: '' }));
  r.put(`elements/pin/p--${PIN.slice(0, 8)}.json`, j({ id: PIN, type: 'pin', name: 'P', map: '', element_type: '', element_id: '', x: 1, y: 2 }));
  r.put(`elements/pin/q--${PIN2.slice(0, 8)}.json`, j({ id: PIN2, type: 'pin', name: 'Q', map_id: MAP, x: 1, y: 2 }));
  r.put(`elements/marker/k--${MK.slice(0, 8)}.json`, j({ id: MK, type: 'marker', name: 'K', zone: '', map: '' }));
  r.put(`elements/location/l--${LOC.slice(0, 8)}.json`, j({ id: LOC, type: 'location', name: 'L' }));
  r.put(`elements/character/c--${CH.slice(0, 8)}.json`, j({ id: CH, type: 'character', name: 'C', birthplace: '', location: LOC, friends: [], description: '' }));
  return r;
}

describe('an empty-string link reads as no link at load', () => {
  it('a Pin whose map is "" loads with no map, and its element pair is none', async () => {
    const s = await open(world());
    await s.listElements();
    const pin = (await s.getElement(PIN)) as Record<string, unknown>;
    expect(pin.map_id ?? null).toBeNull();
    expect('map' in pin ? pin.map : null).toBeNull();
  });

  it('a Map whose parent_map and location are "" loads with neither', async () => {
    const s = await open(world());
    await s.listElements();
    const m = (await s.getElement(MAP2)) as Record<string, unknown>;
    expect(m.parent_map).toBeNull();
    expect(m.location).toBeNull();
  });

  it('a Marker with zone "" and map "" loads with no zone and no map', async () => {
    const s = await open(world());
    await s.listElements();
    const mk = (await s.getElement(MK)) as Record<string, unknown>;
    expect(mk.zone_id ?? null).toBeNull();
    expect(mk.map_id ?? null).toBeNull();
  });

  it('a Character with birthplace "" loads with no birthplace', async () => {
    const s = await open(world());
    await s.listElements();
    const c = (await s.getElement(CH)) as Record<string, unknown>;
    expect(c.birthplace).toBeNull();
  });

  it('controls: a real link stays, a list and a text field are untouched, and the read writes nothing', async () => {
    const root = world();
    const before = new Map(root.list().map((p) => [p, root.get(p)]));
    const s = await open(root);
    await s.listElements();
    const q = (await s.getElement(PIN2)) as Record<string, unknown>;
    expect(q.map_id).toBe(MAP);
    const c = (await s.getElement(CH)) as Record<string, unknown>;
    expect(c.location).toBe(LOC);
    expect(c.friends).toEqual([]);
    expect(c.description).toBe('');
    for (const [p, body] of before) if (p.startsWith('elements/')) expect(root.get(p)).toBe(body);
  });

  it('a body with no type read on a cache miss takes the folder\'s type first, so its empty link still reads as none', async () => {
    const TYPELESS = '22222222-2222-4222-8222-222222222299';
    const DECLARED = '22222222-2222-4222-8222-222222222288';
    const root = world();
    root.put(`elements/pin/t--${TYPELESS.slice(-8)}.json`, j({ id: TYPELESS, name: 'T', map: '', x: 1, y: 2 }));
    root.put(`elements/pin/d--${DECLARED.slice(-8)}.json`, j({ id: DECLARED, type: 'location', name: 'D' }));
    const s = await open(root);
    await s.listElements();
    const cache = (s as unknown as { bodyCache: Map<string, unknown> }).bodyCache;
    cache.delete(TYPELESS);
    cache.delete(DECLARED);
    const t1 = (await s.getElement(TYPELESS)) as Record<string, unknown>;
    expect(t1.type).toBe('pin');
    expect(t1.map_id ?? null).toBeNull();
    const d1 = (await s.getElement(DECLARED)) as Record<string, unknown>;
    expect(d1.type).toBe('location'); // a declared type is never overwritten
  });
});
