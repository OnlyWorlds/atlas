/**
 * Apply an ImportPlan to a (mock) FolderStore — B2 integration
 * (DESIGN_IMPORT.md "The folder applier"). Drives the full pipeline
 * parse → reconcile → applyImportPlan and asserts on resulting folder state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { parsePayload } from '../../src/import/parse';
import { reconcile } from '../../src/import/reconcile';
import { applyImportPlan } from '../../src/import/apply-import-plan';
import { buildWorldExport } from '../../src/import/export-world';
import type { ElementType } from '../../src/core/types';
import type { ImportPlan } from '../../src/import/types';

const U = {
  kid: '068e5012-d77c-799d-8000-95548fbae78d',
  loc: '068e5110-a410-7cbb-8000-5168e2a14b51',
  map: '068e5012-d77c-799d-8000-0000000000a1',
  pin: '068e5012-d77c-799d-8000-0000000000b2',
  obj1: '068e5012-d77c-799d-8000-0000000000c3',
};

function genIdFactory() {
  let n = 0;
  return () => `gen-${++n}`;
}

let folder: MockFolderStore;

beforeEach(async () => {
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
});

describe('applyImportPlan — Mode A (empty store)', () => {
  it('creates every element with resolved relations + stamped local_updated_at', async () => {
    const plan = reconcile(
      parsePayload({
        World: { api_key: 'x', name: 'W' },
        Character: [{ id: U.kid, name: 'The Kid', birthplace: U.loc, objects: [U.obj1] }],
        Location: [{ id: U.loc, name: 'Nacogdoches' }],
        Object: [{ id: U.obj1, name: 'Rifle' }],
      }),
      [],
      { genId: genIdFactory() },
    );
    const res = await applyImportPlan(folder, plan);

    expect(res.created).toBe(3);
    expect(res.failures).toEqual([]);
    expect(folder.__debug_elementCount()).toBe(3);
    const kid = await folder.getElement(U.kid);
    expect(kid?.birthplace).toBe(U.loc);
    expect(kid?.objects).toEqual([U.obj1]);
    expect(kid?.local_updated_at).toBeTruthy();
    expect(kid?.server_updated_at).toBeUndefined(); // never-synced → engine CREATEs on push
  });

  it('applies spatial elements in disk shape (map_id, derived element_type, coerced coords)', async () => {
    const plan = reconcile(
      parsePayload({
        Map: [{ id: U.map, name: 'M' }],
        Character: [{ id: U.kid, name: 'Hero' }],
        Pin: [{ id: U.pin, name: 'p', map: U.map, element_id: U.kid, element_type: '7', x: '1', y: '2' }],
      }),
      [],
      { genId: genIdFactory() },
    );
    await applyImportPlan(folder, plan);
    const pin = await folder.getElement(U.pin);
    expect(pin?.map_id).toBe(U.map);
    expect((pin as { map?: unknown }).map).toBeUndefined();
    expect(pin?.element_type).toBe('character');
    expect(pin?.x).toBe(1);
  });

  it('fires a progress callback per element', async () => {
    const plan = reconcile(parsePayload({ Character: [{ name: 'A' }, { name: 'B' }] }), [], { genId: genIdFactory() });
    const seen: number[] = [];
    await applyImportPlan(folder, plan, { onProgress: p => seen.push(p.done) });
    expect(seen).toEqual([1, 2]);
  });
});

describe('applyImportPlan — Mode B (populated store)', () => {
  it('updates matched elements under overwrite', async () => {
    await folder.createElement('character', { id: U.kid, name: 'Kid', description: 'old' });
    const existing = await folder.listElements();
    const plan = reconcile(
      parsePayload({ Character: [{ id: U.kid, name: 'Kid', description: 'new' }] }),
      existing,
      { onConflict: 'overwrite', genId: genIdFactory() },
    );
    const res = await applyImportPlan(folder, plan);

    expect(res.updated).toBe(1);
    expect(folder.__debug_elementCount()).toBe(1);
    expect((await folder.getElement(U.kid))?.description).toBe('new');
  });

  it('mixes a create and a skip (skips never touch the store)', async () => {
    await folder.createElement('character', { id: U.kid, name: 'Existing' });
    const existing = await folder.listElements();
    const plan = reconcile(
      parsePayload({ Character: [{ name: 'Existing' }, { name: 'Brand New' }] }),
      existing,
      { genId: genIdFactory() },
    );
    const res = await applyImportPlan(folder, plan);

    expect(res.created).toBe(1);
    expect(res.updated).toBe(0);
    expect(folder.__debug_elementCount()).toBe(2); // existing + 1 new; the skip added nothing
  });
});

describe('applyImportPlan — idempotency + resilience', () => {
  it('re-applying the same plan routes creates to updates (no duplicates)', async () => {
    const plan = reconcile(parsePayload({ Character: [{ id: U.kid, name: 'Kid' }] }), [], { genId: genIdFactory() });
    await applyImportPlan(folder, plan);
    const res2 = await applyImportPlan(folder, plan);

    expect(res2.created).toBe(0);
    expect(res2.updated).toBe(1);
    expect(folder.__debug_elementCount()).toBe(1);
  });

  it('records a per-element failure and continues the batch', async () => {
    const plan: ImportPlan = {
      creates: [{ type: 'character' as ElementType, data: { id: U.kid, name: 'Good' } }],
      updates: [{ type: 'character' as ElementType, id: 'missing-id', patch: { description: 'x' } }],
      skips: [],
      report: {
        created: 0,
        updated: 0,
        skipped: 0,
        invalidRecords: 0,
        unknownFieldsDropped: 0,
        droppedLinks: [],
        ambiguousNames: [],
      },
    };
    const res = await applyImportPlan(folder, plan);

    expect(res.created).toBe(1);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0].operation).toBe('update');
    expect(res.failures[0].element_id).toBe('missing-id');
    expect(await folder.getElement(U.kid)).toBeTruthy(); // good create still landed
  });
});

describe('buildWorldExport — ow.com shape + round-trip', () => {
  async function seedSource(): Promise<MockFolderStore> {
    const clock = new MonotonicClock('2026-02-01T00:00:00.000Z');
    const src = new MockFolderStore();
    src.setClock(clock.next);
    await src.open(null);
    await src.writeWorldMeta({ id: 'w-src', name: 'Barovia', description: 'gothic', version: '0.30.00', time_current: 768 });
    await src.createElement('location', { id: U.loc, name: 'Castle Ravenloft' });
    await src.createElement('character', { id: U.kid, name: 'Strahd', birthplace: U.loc, objects: [] });
    await src.createElement('map', { id: U.map, name: 'Overworld' });
    await src.createElement('pin', { id: U.pin, name: 'pin', map_id: U.map, element_id: U.kid, element_type: 'character', x: 5, y: 6 });
    return src;
  }

  it('emits the keel envelope: format tag, world WITH id, lowercase type buckets, bare spatial relations, atlas-local fields stripped', async () => {
    const src = await seedSource();
    const json = await buildWorldExport(src) as Record<string, unknown>;

    // S354: the envelope keel writes and parse.ts reads. One shape both ways.
    expect(json.format).toBe('onlyworlds-world-export');
    expect(typeof json.schema_version).toBe('string');
    const world = json.world as Record<string, unknown>;
    expect(world.name).toBe('Barovia');
    expect(world.id).toBe('w-src');      // lossless round-trip: id is identity
    expect('api_key' in world).toBe(false); // local-only world → no creds

    // All 22 type buckets present, lowercase, under `elements`.
    const elements = json.elements as Record<string, unknown[]>;
    expect(Array.isArray(elements.character)).toBe(true);
    expect(Array.isArray(elements.pin)).toBe(true);
    expect('Character' in json).toBe(false); // the legacy PascalCase shape is read, never written

    const pin = (elements.pin as Record<string, unknown>[])[0];
    expect(pin.map).toBe(U.map);          // disk map_id → bare map
    expect('map_id' in pin).toBe(false);
    expect('local_updated_at' in pin).toBe(false); // sync fields stripped
  });

  it('round-trips: export → re-import yields an equivalent world', async () => {
    const src = await seedSource();
    const json = await buildWorldExport(src);

    const dst = new MockFolderStore();
    dst.setClock(new MonotonicClock('2026-03-01T00:00:00.000Z').next);
    await dst.open(null);
    const plan = reconcile(parsePayload(json), [], { genId: genIdFactory() });
    await applyImportPlan(dst, plan);

    const els = await dst.listElements();
    expect(els.length).toBe(4);
    expect((await dst.getElement(U.kid))?.birthplace).toBe(U.loc); // relation preserved
    const pin = els.find(e => e.type === 'pin');
    expect(pin?.map_id).toBe(U.map);             // bare map → disk map_id again
    expect(pin?.element_type).toBe('character'); // derived from referenced element
    expect(plan.worldMeta?.name).toBe('Barovia');
    expect(plan.worldMeta?.time_current).toBe(768);
  });

  it('exports only the requested subset of types', async () => {
    const src = await seedSource();
    const json = await buildWorldExport(src, { types: new Set(['character'] as ElementType[]) }) as Record<string, unknown>;
    const elements = json.elements as Record<string, unknown[]>;
    expect(Array.isArray(elements.character)).toBe(true);
    expect(elements.character.length).toBe(1);
    expect('location' in elements).toBe(false);
    expect('pin' in elements).toBe(false);
  });
});
