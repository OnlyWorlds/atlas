/**
 * Import reconcile core (DESIGN_IMPORT.md "Architecture" + conventions #81-85).
 *
 * Pure: feeds parsePayload output + existing elements into reconcile, asserts on
 * the returned ImportPlan. No FolderStore, no network. Deterministic ids via an
 * injected genId.
 *
 * Covers: keep-ids passthrough, name resolution (import + existing), unresolved
 * drops, id/name matching → skip vs overwrite, insert+mint, multi-link handling,
 * spatial bare→disk rename + numeric coercion, world-block mapping, mergeMultiLinks.
 */

import { describe, it, expect } from 'vitest';
import { parsePayload } from '../../src/import/parse';
import { reconcile } from '../../src/import/reconcile';
import type { Element, ElementType } from '../../src/core/types';

const U = {
  kid: '068e5012-d77c-799d-8000-95548fbae78d',
  loc: '068e5110-a410-7cbb-8000-5168e2a14b51',
  map: '068e5012-d77c-799d-8000-0000000000a1',
  pin: '068e5012-d77c-799d-8000-0000000000b2',
  obj1: '068e5012-d77c-799d-8000-0000000000c3',
  obj2: '068e5012-d77c-799d-8000-0000000000d4',
};

function existingEl(o: { id: string; type: ElementType; name: string } & Partial<Element>): Element {
  return { local_updated_at: '2026-01-01T00:00:00.000Z', ...o } as Element;
}

function genIdFactory() {
  let n = 0;
  return () => `gen-${++n}`;
}

describe('reconcile — keep-ids (full-world export shape)', () => {
  it('inserts records verbatim, preserving uuid ids and uuid relations', () => {
    const parsed = parsePayload({
      World: { api_key: 'x', name: 'W' },
      Character: [{ id: U.kid, name: 'The Kid', birthplace: U.loc, objects: [U.obj1, U.obj2] }],
      Location: [{ id: U.loc, name: 'Nacogdoches' }],
      Object: [{ id: U.obj1, name: 'Rifle' }, { id: U.obj2, name: 'Knife' }],
    });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });

    expect(plan.report.created).toBe(4);
    const kid = plan.creates.find(c => c.data.name === 'The Kid')!;
    expect(kid.data.id).toBe(U.kid);
    expect(kid.data.birthplace).toBe(U.loc);
    expect(kid.data.objects).toEqual([U.obj1, U.obj2]);
  });
});

describe('reconcile — resolve-names (AI-parsed loose shape)', () => {
  it('resolves name relations against other imported elements', () => {
    const parsed = parsePayload({
      Character: [{ name: 'Frodo', birthplace: 'The Shire' }],
      Location: [{ name: 'The Shire' }],
    });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });

    const shire = plan.creates.find(c => c.data.name === 'The Shire')!;
    const frodo = plan.creates.find(c => c.data.name === 'Frodo')!;
    expect(frodo.data.birthplace).toBe(shire.data.id);
    expect(plan.report.droppedLinks).toEqual([]);
  });

  it('resolves name relations against existing world elements (case-insensitive)', () => {
    const existing = [existingEl({ id: U.loc, type: 'location', name: 'Rivendell' })];
    const parsed = parsePayload({ Character: [{ name: 'Elrond', birthplace: 'rivendell ' }] });
    const plan = reconcile(parsed, existing, { genId: genIdFactory() });

    expect(plan.creates[0].data.birthplace).toBe(U.loc);
  });

  it('mints a fresh id for a second record sharing a raw uuid in the same batch', () => {
    // Two Objects with the SAME incoming uuid but different names. Without the
    // in-batch guard both resolve to that uuid and the second create silently
    // clobbers the first when the plan is applied (one file, two writes).
    const parsed = parsePayload({
      Object: [
        { id: U.obj1, name: 'Rifle' },
        { id: U.obj1, name: 'Knife' },
      ],
    });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });

    expect(plan.report.created).toBe(2);
    const ids = plan.creates.map(c => c.data.id);
    expect(new Set(ids).size).toBe(2); // distinct — collision broken
    expect(plan.creates.find(c => c.data.name === 'Rifle')!.data.id).toBe(U.obj1); // first keeps it
    expect(plan.creates.find(c => c.data.name === 'Knife')!.data.id).toBe('gen-1'); // second minted
  });

  it('drops unresolvable name relations and reports them', () => {
    const parsed = parsePayload({ Character: [{ name: 'Aragorn', birthplace: 'Nowhere' }] });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });

    expect(plan.creates[0].data.birthplace).toBeUndefined();
    expect(plan.report.droppedLinks).toEqual([
      { type: 'character', element: 'Aragorn', field: 'birthplace', value: 'Nowhere' },
    ]);
  });

  it('resolves self-referential relations (friends → other imported characters)', () => {
    const parsed = parsePayload({
      Character: [
        { name: 'Sam', friends: ['Frodo'] },
        { name: 'Frodo', friends: ['Sam'] },
      ],
    });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    const sam = plan.creates.find(c => c.data.name === 'Sam')!;
    const frodo = plan.creates.find(c => c.data.name === 'Frodo')!;
    expect(sam.data.friends).toEqual([frodo.data.id]);
    expect(frodo.data.friends).toEqual([sam.data.id]);
  });

  it('keeps uuid items and resolves name items within the same multi-link, filtering blanks', () => {
    const existing = [existingEl({ id: U.obj1, type: 'object', name: 'Sting' })];
    const parsed = parsePayload({
      Object: [{ id: U.obj2, name: 'Phial' }],
      Character: [{ name: 'Bilbo', objects: [U.obj2, 'Sting', '', 'Ghost'] }],
    });
    const plan = reconcile(parsed, existing, { genId: genIdFactory() });
    const bilbo = plan.creates.find(c => c.data.name === 'Bilbo')!;
    expect(bilbo.data.objects).toEqual([U.obj2, U.obj1]); // Phial(uuid) + Sting(existing); '' skipped, Ghost dropped
    expect(plan.report.droppedLinks).toEqual([
      { type: 'character', element: 'Bilbo', field: 'objects', value: 'Ghost' },
    ]);
  });
});

describe('reconcile — matching existing (merge into current world)', () => {
  it('skips a record matched by id under default onConflict', () => {
    const existing = [existingEl({ id: U.kid, type: 'character', name: 'The Kid' })];
    const parsed = parsePayload({ Character: [{ id: U.kid, name: 'The Kid', description: 'updated' }] });
    const plan = reconcile(parsed, existing, { genId: genIdFactory() });

    expect(plan.report.skipped).toBe(1);
    expect(plan.report.created).toBe(0);
    expect(plan.skips[0]).toEqual({ type: 'character', id: U.kid, name: 'The Kid' });
  });

  it('updates a record matched by id under overwrite', () => {
    const existing = [existingEl({ id: U.kid, type: 'character', name: 'The Kid', description: 'old' })];
    const parsed = parsePayload({ Character: [{ id: U.kid, name: 'The Kid', description: 'new' }] });
    const plan = reconcile(parsed, existing, { onConflict: 'overwrite', genId: genIdFactory() });

    expect(plan.report.updated).toBe(1);
    expect(plan.updates[0].id).toBe(U.kid);
    expect(plan.updates[0].patch.description).toBe('new');
    expect(plan.updates[0].patch.id).toBeUndefined(); // patch never carries id
  });

  it('matches by normalized name+type when ids differ', () => {
    const existing = [existingEl({ id: U.kid, type: 'character', name: 'The Kid' })];
    const parsed = parsePayload({ Character: [{ id: U.obj1, name: '  the kid ', description: 'x' }] });
    const overwrite = reconcile(parsed, existing, { onConflict: 'overwrite', genId: genIdFactory() });
    expect(overwrite.updates[0].id).toBe(U.kid); // target is the existing element, not the incoming id

    const skip = reconcile(parsed, existing, { genId: genIdFactory() });
    expect(skip.report.skipped).toBe(1);
  });

  it('does not match by name when matchByName is false', () => {
    const existing = [existingEl({ id: U.kid, type: 'character', name: 'The Kid' })];
    const parsed = parsePayload({ Character: [{ name: 'The Kid' }] });
    const plan = reconcile(parsed, existing, { matchByName: false, genId: genIdFactory() });
    expect(plan.report.created).toBe(1); // inserted as a new element
  });

  it('mints a fresh id for inserts without a valid uuid', () => {
    const parsed = parsePayload({ Character: [{ name: 'New Guy' }] });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    expect(plan.creates[0].data.id).toBe('gen-1');
  });

  it('unions multi-link arrays on overwrite when mergeMultiLinks is set', () => {
    const existing = [existingEl({ id: U.kid, type: 'character', name: 'Hero', objects: [U.obj1] })];
    const parsed = parsePayload({ Character: [{ id: U.kid, name: 'Hero', objects: [U.obj2] }] });
    const plan = reconcile(parsed, existing, { onConflict: 'overwrite', mergeMultiLinks: true, genId: genIdFactory() });
    expect((plan.updates[0].patch.objects as string[]).sort()).toEqual([U.obj1, U.obj2].sort());
  });
});

describe('reconcile — invalid records', () => {
  it('skips records with no usable name and counts them', () => {
    const parsed = parsePayload({ Character: [{ name: '' }, { description: 'no name' }, { name: 'Real' }] });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    expect(plan.report.invalidRecords).toBe(2);
    expect(plan.report.created).toBe(1);
  });
});

describe('reconcile — spatial (bare → disk shape + numeric coercion)', () => {
  it('renames bare map → map_id, keeps element_id, coerces stringified coords', () => {
    const parsed = parsePayload({
      Map: [{ id: U.map, name: 'Overworld' }],
      Character: [{ id: U.kid, name: 'The Kid' }],
      Pin: [{ id: U.pin, name: 'kid-pin', map: U.map, element_id: U.kid, element_type: 'character', x: '12', y: '34' }],
    });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    const pin = plan.creates.find(c => c.type === 'pin')!;
    expect(pin.data.map_id).toBe(U.map);
    expect(pin.data.map).toBeUndefined();
    expect(pin.data.element_id).toBe(U.kid);
    expect(pin.data.x).toBe(12);
    expect(pin.data.y).toBe(34);
  });
});

describe('reconcile — world block mapping (full-world)', () => {
  it('maps World fields, coerces time strings to numbers, drops api_key + id', () => {
    const parsed = parsePayload({
      World: {
        api_key: '0000000038',
        name: 'Blood Meridian',
        description: 'd',
        version: '0.30.00',
        image_url: 'http://img/x.png',
        time_basic_unit: 'Year',
        time_current: '5',
        time_range_min: '0',
        time_range_max: '100',
      },
      Character: [{ id: U.kid, name: 'The Kid' }],
    });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    const wm = plan.worldMeta!;
    expect(wm.name).toBe('Blood Meridian');
    expect(wm.image_url).toBe('http://img/x.png');
    expect(wm.time_current).toBe(5);
    expect(wm.time_range_max).toBe(100);
    expect('api_key' in wm).toBe(false);
    expect('id' in wm).toBe(false);
  });

  it('carries the world units, trimmed; blank ones stay absent (#149)', () => {
    const parsed = parsePayload({
      World: { name: 'Units', length_unit: ' cm ', mass_unit: 'stone', distance_unit: '  ' },
      Character: [{ id: U.kid, name: 'The Kid' }],
    });
    const wm = reconcile(parsed, [], { genId: genIdFactory() }).worldMeta!;
    expect(wm.length_unit).toBe('cm');
    expect(wm.mass_unit).toBe('stone');
    expect('distance_unit' in wm).toBe(false);
  });

  it('keeps time equivalents stored as whole numbers (keel ca181a3)', () => {
    const parsed = parsePayload({
      World: { name: 'Clock', time_format_names: ['Day', 'Week'], time_format_equivalents: [1, 7] },
      Character: [{ id: U.kid, name: 'The Kid' }],
    });
    const wm = reconcile(parsed, [], { genId: genIdFactory() }).worldMeta!;
    expect(wm.time_format_equivalents).toEqual([1, 7]);
  });

  it('omits worldMeta for loose payloads', () => {
    const parsed = parsePayload({ Character: [{ name: 'A' }] });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    expect(plan.worldMeta).toBeUndefined();
  });
});

describe('reconcile — adversarial review regressions (session 241)', () => {
  const LOC1 = '068e5012-d77c-799d-8000-000000000111';
  const INC = '068e5012-d77c-799d-8000-000000000222';

  it('remaps uuid refs to a discarded incoming id when matched by name (BLOCKER fix)', () => {
    const existing = [existingEl({ id: LOC1, type: 'location', name: 'Shire' })];
    const parsed = parsePayload({
      Location: [{ id: INC, name: 'Shire' }],
      Character: [{ name: 'Frodo', birthplace: INC }],
    });
    const plan = reconcile(parsed, existing, { genId: genIdFactory() });
    const frodo = plan.creates.find(c => c.data.name === 'Frodo')!;
    expect(frodo.data.birthplace).toBe(LOC1); // remapped, not the discarded INC
    expect(plan.report.droppedLinks).toEqual([]);
  });

  it('dedups multi-link arrays on the resolve path', () => {
    const existing = [existingEl({ id: U.obj1, type: 'object', name: 'Sword' })];
    const parsed = parsePayload({ Character: [{ name: 'Knight', objects: ['Sword', 'Sword', U.obj1] }] });
    const plan = reconcile(parsed, existing, { genId: genIdFactory() });
    expect(plan.creates[0].data.objects).toEqual([U.obj1]);
  });

  it('dedups multi-link arrays on overwrite without mergeMultiLinks', () => {
    const existing = [existingEl({ id: U.kid, type: 'character', name: 'Hero' })];
    const parsed = parsePayload({ Character: [{ id: U.kid, name: 'Hero', objects: [U.obj1, U.obj1] }] });
    const plan = reconcile(parsed, existing, { onConflict: 'overwrite', genId: genIdFactory() });
    expect(plan.updates[0].patch.objects).toEqual([U.obj1]);
  });

  it('drops an empty-string World name (lets the caller default it)', () => {
    const parsed = parsePayload({ World: { name: '', description: 'd' }, Character: [{ name: 'A' }] });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    expect('name' in (plan.worldMeta ?? {})).toBe(false);
    expect(plan.worldMeta!.description).toBe('d');
  });

  it('inserts a fresh element when an incoming uuid collides with a DIFFERENT existing element', () => {
    const existing = [existingEl({ id: U.kid, type: 'character', name: 'Alice' })];
    const parsed = parsePayload({ Character: [{ id: U.kid, name: 'Bob' }] });
    const plan = reconcile(parsed, existing, { genId: genIdFactory() });
    expect(plan.report.created).toBe(1);
    expect(plan.report.skipped).toBe(0);
    expect(plan.creates[0].data.id).toBe('gen-1'); // fresh, not U.kid (Alice untouched)
    expect(plan.creates[0].data.name).toBe('Bob');
  });

  it('remaps refs to a collided incoming id to the freshly minted id', () => {
    const existing = [existingEl({ id: U.kid, type: 'character', name: 'Alice' })];
    const parsed = parsePayload({
      Character: [
        { id: U.kid, name: 'Bob' },
        { name: 'Carl', friends: [U.kid] },
      ],
    });
    const plan = reconcile(parsed, existing, { genId: genIdFactory() });
    const bob = plan.creates.find(c => c.data.name === 'Bob')!;
    const carl = plan.creates.find(c => c.data.name === 'Carl')!;
    expect(carl.data.friends).toEqual([bob.data.id]);
    expect(carl.data.friends).not.toEqual([U.kid]); // not Alice
  });

  it('derives pin element_type from the referenced element (ow.com exports a numeric pk)', () => {
    const parsed = parsePayload({
      Map: [{ id: U.map, name: 'Map1' }],
      Character: [{ id: U.kid, name: 'Hero' }],
      Pin: [{ id: U.pin, name: 'p', map: U.map, element_id: U.kid, element_type: '7', x: '1', y: '2' }],
    });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    const pin = plan.creates.find(c => c.type === 'pin')!;
    expect(pin.data.element_type).toBe('character');
    expect(pin.data.map_id).toBe(U.map);
  });

  it('drops pin element_type when the referenced element is unknown', () => {
    const orphan = '068e5012-d77c-799d-8000-0000000000ff';
    const parsed = parsePayload({
      Pin: [{ id: U.pin, name: 'p', element_id: orphan, element_type: '7' }],
    });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    expect('element_type' in plan.creates[0].data).toBe(false);
  });

  it('renames marker map+zone to map_id+zone_id and coerces numerics', () => {
    const parsed = parsePayload({
      Map: [{ id: U.map, name: 'M' }],
      Zone: [{ id: U.obj1, name: 'Z' }],
      Marker: [{ id: U.obj2, name: 'mk', map: U.map, zone: U.obj1, x: '5', y: '6', order: '3' }],
    });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    const mk = plan.creates.find(c => c.type === 'marker')!;
    expect(mk.data.map_id).toBe(U.map);
    expect(mk.data.zone_id).toBe(U.obj1);
    expect(mk.data.map).toBeUndefined();
    expect(mk.data.zone).toBeUndefined();
    expect(mk.data.x).toBe(5);
    expect(mk.data.order).toBe(3);
  });

  it('drops marker zone_id when zone is empty', () => {
    const parsed = parsePayload({
      Map: [{ id: U.map, name: 'M' }],
      Marker: [{ id: U.obj2, name: 'mk', map: U.map, zone: '', x: '5', y: '6' }],
    });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    const mk = plan.creates.find(c => c.type === 'marker')!;
    expect('zone_id' in mk.data).toBe(false);
    expect(mk.data.map_id).toBe(U.map);
  });

  it('resolves a name ref to a matched-but-skipped existing element', () => {
    const existing = [existingEl({ id: U.loc, type: 'location', name: 'Shire' })];
    const parsed = parsePayload({
      Location: [{ name: 'Shire' }], // matches existing → skipped under default
      Character: [{ name: 'Frodo', birthplace: 'Shire' }],
    });
    const plan = reconcile(parsed, existing, { genId: genIdFactory() });
    expect(plan.report.skipped).toBe(1);
    expect(plan.creates.find(c => c.data.name === 'Frodo')!.data.birthplace).toBe(U.loc);
  });

  it('handles a mix of insert and skip in one import', () => {
    const existing = [existingEl({ id: U.kid, type: 'character', name: 'Existing' })];
    const parsed = parsePayload({ Character: [{ name: 'Existing' }, { name: 'Brand New' }] });
    const plan = reconcile(parsed, existing, { genId: genIdFactory() });
    expect(plan.report.created).toBe(1);
    expect(plan.report.skipped).toBe(1);
  });

  it('reports ambiguous duplicate names within the import', () => {
    const parsed = parsePayload({ Location: [{ name: 'Town' }, { name: 'Town' }] });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    expect(plan.report.created).toBe(2);
    expect(plan.report.ambiguousNames).toEqual([{ type: 'location', name: 'Town' }]);
  });

  it('coerces numeric edge strings (zero, negative, decimal)', () => {
    const parsed = parsePayload({ Map: [{ id: U.map, name: 'M', width: '0', height: '-5', depth: '2.5' }] });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    const m = plan.creates[0];
    expect(m.data.width).toBe(0);
    expect(m.data.height).toBe(-5);
    expect(m.data.depth).toBe(2.5);
  });

  it('matches names differing only by internal whitespace', () => {
    const existing = [existingEl({ id: U.loc, type: 'location', name: 'The Kid Plains' })];
    const parsed = parsePayload({ Character: [{ name: 'A', birthplace: 'The  Kid   Plains' }] });
    const plan = reconcile(parsed, existing, { genId: genIdFactory() });
    expect(plan.creates[0].data.birthplace).toBe(U.loc);
  });
});

// ---- Unnamed spatial artifacts survive import (session 248 round-trip fix) --

describe('unnamed pins/markers round-trip (session 248)', () => {
  it('keeps unnamed pins and markers as creates; empty names never name-match', () => {
    const parsed = parsePayload({
      Location: [{ id: '068e5012-d77c-799d-8000-0000000000e1', name: 'Keep' }],
      Map: [{ id: '068e5012-d77c-799d-8000-0000000000e2', name: 'M', width: 100, height: 100 }],
      Pin: [
        { id: '068e5012-d77c-799d-8000-0000000000e3', name: '', map: '068e5012-d77c-799d-8000-0000000000e2', element: '068e5012-d77c-799d-8000-0000000000e1', x: 1, y: 2 },
        { id: '068e5012-d77c-799d-8000-0000000000e4', name: '', map: '068e5012-d77c-799d-8000-0000000000e2', element: '068e5012-d77c-799d-8000-0000000000e1', x: 3, y: 4 },
      ],
      Marker: [
        { id: '068e5012-d77c-799d-8000-0000000000e5', name: '', map: '068e5012-d77c-799d-8000-0000000000e2', zone: '068e5012-d77c-799d-8000-0000000000e6', x: 5, y: 6 },
      ],
    });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    expect(plan.report.invalidRecords).toBe(0);
    const types = plan.creates.map(c => c.type);
    expect(types.filter(t => t === 'pin')).toHaveLength(2); // both unnamed pins kept, NOT merged
    expect(types.filter(t => t === 'marker')).toHaveLength(1);
  });

  it('still rejects unnamed CONTENT elements', () => {
    const parsed = parsePayload({ Character: [{ name: '' }, { name: 'Ok' }] });
    const plan = reconcile(parsed, [], { genId: genIdFactory() });
    expect(plan.report.invalidRecords).toBe(1);
    expect(plan.creates).toHaveLength(1);
  });
});

describe('reconcile — a renamed element in the world\'s own export (S362)', () => {
  const EVT = '068e5012-d77c-799d-8000-0000000000e5';
  const payload = () => parsePayload({
    World: { name: 'W' },
    Character: [{ id: U.kid, name: 'Strahd von Zarovich' }],
    Event: [{ id: EVT, name: 'The Feast', characters: [U.kid] }],
  });
  const existing = [existingEl({ id: U.kid, type: 'character', name: 'Strahd' })];

  it('same world: the id match wins over the rename, and new links keep the original', () => {
    for (const onConflict of ['skip', 'overwrite'] as const) {
      const plan = reconcile(payload(), existing, { onConflict, sameWorld: true, genId: genIdFactory() });
      expect(plan.creates.map(c => c.type)).toEqual(['event']);
      const feast = plan.creates[0].data as { characters?: string[] };
      expect(feast.characters).toEqual([U.kid]);
    }
  });

  it('a foreign file keeps the collision guard: same id, different name is a different element', () => {
    const plan = reconcile(payload(), existing, { onConflict: 'skip', genId: genIdFactory() });
    expect(plan.creates.map(c => c.type).sort()).toEqual(['character', 'event']);
  });
});

describe('reconcile: the incoming-id remap reaches ow:// prose (S367 critic C8)', () => {
  const X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // Dampworth in the export
  const Y = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // Dampworth already in this world
  const Z = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // a fresh id minted on collision
  const N = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  function exportWith(chars: Array<{ id: string; name: string }>, story: string, cast: string[]) {
    return parsePayload({
      format: 'onlyworlds-world-export',
      world: { name: 'Source' },
      elements: {
        character: chars,
        narrative: [{
          id: N, name: 'Chapter 3', characters: cast, story,
          atlas_richtext_json: { type: 'doc', content: [{ type: 'elementChip', attrs: { id: cast[0], type: 'character' } }] },
        }],
      },
    });
  }
  const chapter = (plan: ReturnType<typeof reconcile>) =>
    plan.creates.find(c => c.type === 'narrative')!.data as Record<string, unknown>;

  it('name-match merge: the story chip and the sidecar follow the existing id', () => {
    const plan = reconcile(
      exportWith([{ id: X, name: 'Dampworth' }], `Rain. [Dampworth](ow://character/${X}) waits. Raw ${X} stays.`, [X]),
      [existingEl({ id: Y, type: 'character', name: 'Dampworth' })], {},
    );
    const ch = chapter(plan);
    expect(ch.characters).toEqual([Y]);
    expect(ch.story).toBe(`Rain. [Dampworth](ow://character/${Y}) waits. Raw ${X} stays.`); // bare uuid is text
    const doc = ch.atlas_richtext_json as { content: Array<{ attrs: { id: string } }> };
    expect(doc.content[0].attrs.id).toBe(Y);
  });

  it('id collision: the chip follows the re-minted id, not the unrelated element holding the old one', () => {
    const plan = reconcile(
      exportWith([{ id: X, name: 'Dampworth' }], `[Dampworth](ow://character/${X})`, [X]),
      [existingEl({ id: X, type: 'character', name: 'Someone Else' })], { genId: () => Z },
    );
    const ch = chapter(plan);
    expect(ch.characters).toEqual([Z]);
    expect(ch.story).toBe(`[Dampworth](ow://character/${Z})`);
  });

  it('no chained rewrite: a relation already resolved to an id that is itself remapped stays put', () => {
    // X merges into existing Y by name; the export's own Y collides with it and is re-minted to Z.
    const plan = reconcile(
      exportWith(
        [{ id: X, name: 'Dampworth' }, { id: Y, name: 'Other' }],
        `[D](ow://character/${X}) and [O](ow://character/${Y})`,
        [X, Y],
      ),
      [existingEl({ id: Y, type: 'character', name: 'Dampworth' })], { genId: () => Z },
    );
    const ch = chapter(plan);
    expect(ch.characters).toEqual([Y, Z]);
    expect(ch.story).toBe(`[D](ow://character/${Y}) and [O](ow://character/${Z})`);
  });
});
