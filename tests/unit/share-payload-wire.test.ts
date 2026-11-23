/**
 * What a published page's payload carries beyond what the page draws (1.125.14).
 *
 * Two rules, each read off the payload as JSON, since the payload is served
 * publicly whole:
 *  - what the server says about an element (its stamps, who wrote it and by
 *    which door, its marks) is never a card field: not offered in the
 *    builder's checklist, not sent by a ticked card, not sent by a Full pin;
 *  - a card whose element the payload leaves out (hidden, proposed, or no
 *    longer in the world) leaves the payload with it, and a card that stays
 *    names only the fields its entry holds.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  buildPagePayload, isCardSkipField, pageSharesOf, populatedFieldNames,
} from '../../src/core/share-payload';
import { populatedCardFields } from '../../src/middle/share-page-render';
import { SERVER_AUTHOR_FIELDS, SERVER_MARK_FIELDS, SERVER_STAMP_FIELDS } from '../../src/core/constants';
import type { Element } from '../../src/core/types';

const WORLD_ID = '5e000000-0000-4000-8000-00000000000e';
const MEMBER = 'dd7abc1d-74b8-45fe-bac4-4f2340bdafb3';
const ADA = 'a1000000-0000-0000-0000-000000000001';
const WREN = 'a2000000-0000-0000-0000-000000000002';
const QUILL = 'a3000000-0000-0000-0000-000000000003';
const HOME = 'b1000000-0000-0000-0000-000000000001';
const ENTRY = 'e1000000-0000-0000-0000-000000000001';
const MAP = 'c1000000-0000-0000-0000-000000000001';
const PIN_ADA = 'd1000000-0000-0000-0000-000000000001';
const PIN_WREN = 'd2000000-0000-0000-0000-000000000002';
const GONE = 'dead0000-0000-0000-0000-000000000000'; // never in the world

/** What keel serves beside an element's own fields, as a pulled file keeps it. */
const served = {
  world: WORLD_ID,
  created_at: '2026-07-14T22:01:10.667Z',
  updated_at: '2026-07-15T08:00:00.000Z',
  change_seq: 7,
  created_by: MEMBER,
  changed_by: MEMBER,
  changed_via: 'api',
  changed_client: 'some-tool/1.0',
  doors: { api: '2026-07-15T08:00:00.000Z' },
  hidden: false,
  x_served_trimmed: ['recipients'],
  local_updated_at: '2026-07-15T08:00:01.000Z',
  server_updated_at: '2026-07-15T08:00:00.000Z',
};

const el = (id: string, name: string, extra: Record<string, unknown> = {}, type = 'character'): Element =>
  ({ id, type, name, ...served, ...extra }) as unknown as Element;

const world = (): Element[] => [
  el(ADA, 'Ada', { description: 'Shown.', friends: [WREN], birthplace: HOME, x_mood: 'grim' }),
  el(WREN, 'Wren', { hidden: true, description: 'Hidden by the keeper.' }),
  el(QUILL, 'Quill', { description: 'Not yet reviewed.', x_review_proposed: { by: '19e1c2e5-5e8e-4d46-8382-e5ad445d13a0', evidence: 'seat', expires: '2999-12-31' } }),
  el(HOME, 'Harbour', { description: 'A port.' }, 'location'),
  el(ENTRY, 'the tides', { subtype: 'knowledge', story: 'Shown.', narrator: ADA }, 'narrative'),
  el(MAP, 'the coast', { image_url: 'https://img.example/coast.png', width: 1000, height: 500 }, 'map'),
  el(PIN_ADA, '', { map_id: MAP, element_id: ADA, x: 100, y: 100 }, 'pin'),
  el(PIN_WREN, '', { map_id: MAP, element_id: WREN, x: 200, y: 200 }, 'pin'),
];

const page = (blocks: unknown[]): Element => ({
  id: 'f1000000-0000-0000-0000-000000000001', type: 'narrative', name: 'primer', subtype: 'page',
  atlas_page_intent: 'reference', atlas_page_blocks: blocks, ...served,
}) as unknown as Element;

const SERVER_SAID = [...SERVER_STAMP_FIELDS, ...SERVER_AUTHOR_FIELDS, ...SERVER_MARK_FIELDS, 'known_of'];

/**
 * The fields the SDK's own element type calls the server's: every property of
 * `OwElementBase` whose doc says "server-managed" or "Served only". Read from
 * the installed declarations, so a field the server starts to serve reds here
 * on the SDK bump that brings it, before a Full pin can publish it.
 */
function sdkServerFields(): string[] {
  const dts = readFileSync(resolve(__dirname, '../../node_modules/@onlyworlds/sdk/dist/index.d.ts'), 'utf8');
  const start = dts.indexOf('interface OwElementBase {');
  const body = dts.slice(start, dts.indexOf('\n}', start));
  const out: string[] = [];
  const member = /\/\*\*([\s\S]*?)\*\/\s*\n\s*([a-z_]+)\??:/g;
  for (let m = member.exec(body); m; m = member.exec(body)) {
    if (/server-managed|Served only/.test(m[1])) out.push(m[2]);
  }
  return out;
}

describe('what the server says about an element is never a card field', () => {
  it('the lists name every field a pulled file keeps beside its own', () => {
    for (const f of ['world', 'created_at', 'updated_at', 'change_seq', 'created_by', 'changed_by',
      'changed_via', 'changed_client', 'doors', 'hidden', 'known_of', 'x_served_trimmed']) {
      expect(SERVER_SAID, f).toContain(f);
    }
  });

  it("every field the SDK's element type calls the server's is skipped", () => {
    const fields = sdkServerFields();
    // The reader finds what it looks for: these are in the declarations today.
    for (const f of ['type', 'created_at', 'created_by', 'changed_via', 'doors', 'hidden', 'known_of', 'x_served_trimmed']) {
      expect(fields, f).toContain(f);
    }
    for (const f of fields) expect(isCardSkipField(f), f).toBe(true);
  });

  it('a stub, as a guest or player holds it, sends no known_of through a Full pin', () => {
    const elements = [...world(), el('a9000000-0000-0000-0000-000000000009', 'Seen once', { description: 'seen once', known_of: true })];
    const pin = el('d9000000-0000-0000-0000-000000000009', '', { map_id: MAP, element_id: 'a9000000-0000-0000-0000-000000000009', x: 300, y: 300 }, 'pin');
    const p = buildPagePayload(page([
      { id: 'b1', kind: 'map', mapId: MAP, pinIds: [pin.id], fullPinIds: [pin.id] },
    ]), [...elements, pin]);
    expect(p.elements['a9000000-0000-0000-0000-000000000009'].fields).toEqual({ description: 'seen once' });
    expect(JSON.stringify(p)).not.toContain('known_of');
  });

  it("a published profile's key is no card field; a person's own x_ field is", () => {
    const keys = ['x_room_of', 'x_report_answers', 'x_spine_depends_on', 'x_lens_leads_to', 'x_identity_key', 'x_charter_of', 'x_review_proposed', 'x_lens', 'x_record'];
    for (const k of keys) expect(isCardSkipField(k), k).toBe(true);
    const marked = el('a8000000-0000-0000-0000-000000000008', 'Marked', {
      description: 'A room.', x_mood: 'calm', x_room_of: WORLD_ID, x_report_answers: [WREN], x_identity_key: 'being-7',
    });
    const pin = el('d8000000-0000-0000-0000-000000000008', '', { map_id: MAP, element_id: marked.id, x: 300, y: 300 }, 'pin');
    expect(populatedCardFields(marked).sort()).toEqual(['description', 'x_mood']);
    const p = buildPagePayload(page([
      { id: 'b1', kind: 'map', mapId: MAP, pinIds: [pin.id], fullPinIds: [pin.id] },
      { id: 'b2', kind: 'element-card', elementId: marked.id, variant: 'full', fields: ['x_room_of', 'x_identity_key', 'x_mood'] },
    ]), [...world(), marked, pin]);
    expect(Object.keys(p.elements[marked.id].fields).sort()).toEqual(['description', 'x_mood']);
    const json = JSON.stringify(p);
    expect(json).not.toContain(WORLD_ID);
    expect(json).not.toContain(WREN);
    expect(json).not.toContain('being-7');
  });

  it('none is a card field; a field of the world still is', () => {
    for (const f of SERVER_SAID) expect(isCardSkipField(f), f).toBe(true);
    for (const f of ['description', 'birthplace', 'x_mood', 'shadow_note', 'supertype']) {
      expect(isCardSkipField(f), f).toBe(false);
    }
  });

  it("the builder's checklist offers none of them", () => {
    const ada = world()[0];
    expect(populatedFieldNames(ada).sort()).toEqual(['birthplace', 'description', 'friends', 'x_mood']);
    expect(populatedCardFields(ada).sort()).toEqual(['birthplace', 'description', 'friends', 'x_mood']);
  });

  it('a Full pin sends the filled fields of the world, and nothing the server said', () => {
    const p = buildPagePayload(page([
      { id: 'b1', kind: 'map', mapId: MAP, pinIds: [PIN_ADA], fullPinIds: [PIN_ADA] },
    ]), world());
    // friends names only the hidden Wren, so no friends field is sent.
    expect(Object.keys(p.elements[ADA].fields).sort()).toEqual(['birthplace', 'description', 'x_mood']);
    const json = JSON.stringify(p);
    expect(json).not.toContain(MEMBER);
    expect(json).not.toContain(WORLD_ID);
    for (const f of SERVER_SAID) expect(json, f).not.toContain(`"${f}"`);
    expect(json).not.toContain('some-tool/1.0');
    expect(json).not.toContain('2026-07-14T22:01:10.667Z');
  });

  it('a card ticked for one before this rule sends none, and the block no longer names it', () => {
    const p = buildPagePayload(page([
      { id: 'b1', kind: 'element-card', elementId: ADA, variant: 'full',
        fields: ['description', 'created_at', 'created_by', 'changed_via', 'world', 'hidden'] },
    ]), world());
    expect(Object.keys(p.elements[ADA].fields)).toEqual(['description']);
    const json = JSON.stringify(p);
    expect(json).not.toContain(MEMBER);
    for (const f of SERVER_SAID) expect(json, f).not.toContain(`"${f}"`);
  });

  it('the list of what a page shares names none', () => {
    const shares = pageSharesOf(page([
      { id: 'b1', kind: 'map', mapId: MAP, pinIds: [PIN_ADA], fullPinIds: [PIN_ADA] },
      { id: 'b2', kind: 'element-card', elementId: ADA, variant: 'full', fields: ['description', 'created_at'] },
    ]), world());
    const listed = shares.rows.flatMap(r => [...r.parts.flatMap(part => part.fields), ...r.also]);
    for (const f of SERVER_SAID) expect(listed, f).not.toContain(f);
    expect(listed).toContain('x_mood');
  });
});

describe('a card leaves the payload with its element', () => {
  it("a card of an element no longer in the world: no block, and its id nowhere", () => {
    const p = buildPagePayload(page([
      { id: 'b1', kind: 'element-card', elementId: GONE, variant: 'full', fields: ['description'] },
      { id: 'b2', kind: 'element-card', elementId: ADA, variant: 'compact', fields: [] },
    ]), world());
    expect(p.blocks.map(b => b.id)).toEqual(['b2']);
    expect(JSON.stringify(p)).not.toContain(GONE);
  });

  it("a hidden element's card, and a proposed one's: no block, and the id nowhere", () => {
    const p = buildPagePayload(page([
      { id: 'b1', kind: 'element-card', elementId: WREN, variant: 'full', fields: ['description', 'x_secret_field'] },
      { id: 'b2', kind: 'element-card', elementId: QUILL, variant: 'full', fields: ['description'] },
      { id: 'b3', kind: 'element-card', elementId: ADA, variant: 'full', fields: ['description', 'friends'] },
    ]), world());
    expect(p.blocks.map(b => b.id)).toEqual(['b3']);
    const json = JSON.stringify(p);
    expect(json).not.toContain(WREN);
    expect(json).not.toContain(QUILL);
    expect(json).not.toContain('x_secret_field');
  });

  it('a card that stays names only the fields its entry holds; a compact card names none', () => {
    const p = buildPagePayload(page([
      { id: 'b1', kind: 'element-card', elementId: ADA, variant: 'full',
        fields: ['description', 'x_never_filled', 'friends'] },
      { id: 'b2', kind: 'element-card', elementId: HOME, variant: 'compact', fields: ['description', 'x_once_ticked'] },
    ]), world());
    const fieldsOf = (id: string): string[] => (p.blocks.find(b => b.id === id) as { fields: string[] }).fields;
    // friends holds only the hidden Wren, so the entry has no friends and the block names none.
    expect(fieldsOf('b1')).toEqual(['description']);
    expect(fieldsOf('b2')).toEqual([]);
    expect(JSON.stringify(p)).not.toContain('x_never_filled');
    expect(JSON.stringify(p)).not.toContain('x_once_ticked');
  });

  it('a name every object answers to is no field: a card ticked for constructor or __proto__ names neither, and a field ticked twice is named once', () => {
    const blocks = [
      { id: 'b1', kind: 'element-card', elementId: ADA, variant: 'full',
        fields: ['description', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'description'] },
    ];
    const p = buildPagePayload(page(blocks), world());
    expect((p.blocks[0] as { fields: string[] }).fields).toEqual(['description']);
    expect(Object.keys(p.elements[ADA].fields)).toEqual(['description']);
    const shares = pageSharesOf(page(blocks), world());
    expect(shares.rows.flatMap(r => r.parts.flatMap(part => part.fields))).toEqual(['description']);
  });

  it('a card of an element named by such a name leaves the payload, and the list of what is shared still reads', () => {
    const blocks = [
      { id: 'b1', kind: 'element-card', elementId: 'constructor', variant: 'full', fields: ['description'] },
      { id: 'b2', kind: 'element-card', elementId: '__proto__', variant: 'full', fields: ['description'] },
      { id: 'b3', kind: 'collection', elementIds: ['toString', ADA] },
      { id: 'b4', kind: 'element-card', elementId: ADA, variant: 'compact', fields: [] },
    ];
    const p = buildPagePayload(page(blocks), world());
    expect(p.blocks.map(b => b.id)).toEqual(['b3', 'b4']);
    expect(Object.keys(p.elements)).toEqual([ADA]);
    expect(() => pageSharesOf(page(blocks), world())).not.toThrow();
  });

  it('a file that holds __proto__ as a key sends nothing of it, and the entry stays a plain object', () => {
    const odd = JSON.parse(`{"id":"a7000000-0000-0000-0000-000000000007","type":"character","name":"Odd","description":"d","__proto__":["leak-me"]}`) as Element;
    const pin = el('d7000000-0000-0000-0000-000000000007', '', { map_id: MAP, element_id: odd.id, x: 300, y: 300 }, 'pin');
    expect(populatedFieldNames(odd)).toEqual(['description']);
    const p = buildPagePayload(page([
      { id: 'b1', kind: 'map', mapId: MAP, pinIds: [pin.id], fullPinIds: [pin.id] },
      { id: 'b2', kind: 'element-card', elementId: odd.id, variant: 'full', fields: ['description', '__proto__', 'length', 'join'] },
    ]), [...world(), odd, pin]);
    expect(Object.getPrototypeOf(p.elements[odd.id].fields)).toBe(Object.prototype);
    expect((p.blocks.find(b => b.id === 'b2') as { fields: string[] }).fields).toEqual(['description']);
    expect(JSON.stringify(p)).not.toContain('leak-me');
  });

  it("a card of a Pin or a Marker names its map and zone, never their ids, and nothing of a hidden one", () => {
    const ZONE = 'c2000000-0000-0000-0000-000000000002';
    const HIDDEN_MAP = 'c3000000-0000-0000-0000-000000000003';
    const PIN_HID = 'd3000000-0000-0000-0000-000000000003';
    const MARKER = 'd4000000-0000-0000-0000-000000000004';
    const elements = [
      ...world(),
      el(ZONE, 'the shallows', {}, 'zone'),
      el(HIDDEN_MAP, 'the vault', { hidden: true, image_url: 'https://img.example/vault.png', width: 10, height: 10 }, 'map'),
      el(PIN_HID, 'vault pin', { map_id: HIDDEN_MAP, element_id: ADA, x: 1, y: 1 }, 'pin'),
      el(MARKER, 'a marker', { map_id: MAP, zone_id: ZONE, x: 5, y: 5 }, 'marker'),
    ];
    const p = buildPagePayload(page([
      { id: 'b1', kind: 'element-card', elementId: PIN_ADA, variant: 'full', fields: ['map_id', 'element_id', 'x'] },
      { id: 'b2', kind: 'element-card', elementId: PIN_HID, variant: 'full', fields: ['map_id', 'element_id'] },
      { id: 'b3', kind: 'element-card', elementId: MARKER, variant: 'full', fields: ['map_id', 'zone_id'] },
    ]), elements);
    // A link names its target; `ref` only when the target is itself on the page.
    expect(p.elements[PIN_ADA].fields.map_id).toEqual([{ text: 'the coast' }]);
    expect(p.elements[PIN_ADA].fields.x).toBe(100);
    expect(p.elements[PIN_HID].fields.map_id).toBeUndefined();
    expect(p.elements[MARKER].fields.zone_id).toEqual([{ text: 'the shallows' }]);
    const json = JSON.stringify(p);
    for (const id of [MAP, HIDDEN_MAP, ZONE, ADA]) expect(json, id).not.toContain(id);
    expect(json).not.toContain('the vault');
  });

  it("a pin from another tool's file, holding its links under the schema's bare names, names them the same way", () => {
    const BARE = 'd5000000-0000-0000-0000-000000000005';
    const p = buildPagePayload(page([
      { id: 'b1', kind: 'element-card', elementId: BARE, variant: 'full', fields: ['map', 'element_id'] },
    ]), [...world(), el(BARE, 'bare pin', { map: MAP, element_id: ADA, x: 1, y: 1 }, 'pin')]);
    expect(p.elements[BARE].fields.map).toEqual([{ text: 'the coast' }]);
    expect(p.elements[BARE].fields.element_id).toEqual([{ text: 'Ada' }]);
    expect(JSON.stringify(p)).not.toContain(MAP);
  });

  it('a page with every kind of block: no id of the world is on the wire but an included element', () => {
    const elements = world();
    const p = buildPagePayload(page([
      { id: 'b1', kind: 'heading', text: 'The coast', level: 1 },
      { id: 'b2', kind: 'prose', markdown: `[Ada](ow://character/${ADA}) met [Wren](ow://character/${WREN}) and [someone](ow://character/${GONE}).` },
      { id: 'b3', kind: 'element-card', elementId: ADA, variant: 'full', fields: ['description', 'friends', 'birthplace'] },
      { id: 'b4', kind: 'element-card', elementId: WREN, variant: 'full', fields: ['description'] },
      { id: 'b5', kind: 'element-card', elementId: GONE, variant: 'compact', fields: [] },
      { id: 'b6', kind: 'collection', elementIds: [WREN, QUILL, GONE, ADA] },
      { id: 'b7', kind: 'circle', knowerId: WREN },
      { id: 'b8', kind: 'circle', knowerId: ADA },
      { id: 'b9', kind: 'map', mapId: MAP, pinIds: [PIN_ADA, PIN_WREN], fullPinIds: [PIN_ADA, PIN_WREN] },
    ]), elements);
    const json = JSON.stringify(p);
    const included = new Set(Object.keys(p.elements));
    expect([...included].sort()).toEqual([ADA]);
    for (const e of [...elements, { id: GONE }, { id: WORLD_ID }, { id: MEMBER }]) {
      if (included.has(e.id)) continue;
      expect(json, `the id of ${(e as { name?: string }).name || e.id}`).not.toContain(e.id);
    }
  });
});
