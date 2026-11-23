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
  doors: [{ door: 'api', at: '2026-07-15T08:00:00.000Z' }],
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

const SERVER_SAID = [...SERVER_STAMP_FIELDS, ...SERVER_AUTHOR_FIELDS, ...SERVER_MARK_FIELDS];

describe('what the server says about an element is never a card field', () => {
  it('the lists name every field a pulled file keeps beside its own', () => {
    for (const f of ['world', 'created_at', 'updated_at', 'change_seq', 'created_by', 'changed_by',
      'changed_via', 'changed_client', 'doors', 'hidden', 'x_served_trimmed']) {
      expect(SERVER_SAID, f).toContain(f);
    }
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
