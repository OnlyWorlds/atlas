/**
 * rekeyBody: the reference transform behind giving elements new ids (S363).
 * Rows follow re-key gate lens 3's field-path table; each names the carrier
 * whose miss would let an old id come back.
 */
import { describe, it, expect } from 'vitest';
import { rekeyBody } from '../../src/store/rekey-body';
import { blocksOf } from '../../src/core/sharing';
import { computeRelationPatch, extractProseLinks } from '../../src/middle/writing-workspace-derive';
import { serializeDocToMarkdown } from '../../src/middle/writing-workspace-markdown';
import type { Element } from '../../src/core/types';

const O = '11111111-1111-4111-8111-111111111111';
const N = '99999999-9999-4999-8999-999999999999';
const O2 = '22222222-2222-4222-8222-222222222222';
const N2 = '88888888-8888-4888-8888-888888888888';
const X = '33333333-3333-4333-8333-333333333333'; // not in the map
const map = new Map([[O, N], [O2, N2]]);

const el = (type: string, fields: Record<string, unknown>): Element =>
  ({ id: X, type, name: 'E', local_updated_at: '2026-01-01T00:00:00.000Z', ...fields }) as Element;

const chip = (id: string, nodeType = 'elementChip') => ({ type: nodeType, attrs: { id, type: 'character', label: 'Ann' } });
const doc = (...inline: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content: inline }] });

describe('rekeyBody: flat links', () => {
  it('single and multi links, order and length kept', () => {
    const { body, changed } = rekeyBody(el('character', { location: O, friends: [X, O, O2] }), map);
    expect(changed).toBe(true);
    expect(body.location).toBe(N);
    expect(body.friends).toEqual([X, N, N2]);
  });

  it('pin/marker in-memory spelling and extension scalars', () => {
    const pin = rekeyBody(el('pin', { map_id: O, element_id: O2, element_type: 'character' }), map).body;
    expect(pin.map_id).toBe(N);
    expect(pin.element_id).toBe(N2);
    expect(rekeyBody(el('object', { x_owner: O }), map).body.x_owner).toBe(N);
  });

  it('never touches identity, stamps, media ids or the published record', () => {
    const src = el('narrative', {
      id: O, name: O, image_media_id: O, created_by: O,
      atlas_page_pub: { id: O, slug: 's' }, atlas_aliases: [O],
    });
    const { body } = rekeyBody(src, map);
    expect(body.id).toBe(O);
    expect(body.name).toBe(O);
    expect(body.image_media_id).toBe(O);
    expect(body.created_by).toBe(O);
    expect((body.atlas_page_pub as { id: string }).id).toBe(O);
    expect(body.atlas_aliases).toEqual([O]);
  });

  it('a bare uuid in prose is text, not a link; an ow:// link in it is', () => {
    const { body } = rekeyBody(el('character', {
      description: O,
      story: `[${O}](ow://character/${O}) and ow://location/${O2}. keep ${X}`,
    }), map);
    expect(body.description).toBe(O);
    expect(body.story).toBe(`[${O}](ow://character/${N}) and ow://location/${N2}. keep ${X}`);
  });

  it('idempotent, and an untouched body is the same object', () => {
    const once = rekeyBody(el('character', { location: O }), map).body;
    const twice = rekeyBody(once, map);
    expect(twice.changed).toBe(false);
    expect(twice.body).toBe(once);
  });
});

describe('rekeyBody: the TipTap sidecar', () => {
  it('elementChip AND mention nodes, label and type untouched', () => {
    const src = el('narrative', { atlas_richtext_json: doc(chip(O), { type: 'text', text: ' met ' }, chip(O2, 'mention')) });
    const out = rekeyBody(src, map).body.atlas_richtext_json as ReturnType<typeof doc>;
    const inline = out.content[0].content as Array<{ attrs: Record<string, string> }>;
    expect(inline[0].attrs).toEqual({ id: N, type: 'character', label: 'Ann' });
    expect(inline[2].attrs.id).toBe(N2);
  });

  it('link marks with an ow:// href', () => {
    const text = { type: 'text', text: 'Ann', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: `ow://character/${O}` } }] };
    const out = rekeyBody(el('narrative', { atlas_richtext_json: doc(text) }), map).body.atlas_richtext_json as ReturnType<typeof doc>;
    const marks = (out.content[0].content as Array<{ marks: Array<{ attrs?: { href: string } }> }>)[0].marks;
    expect(marks[1].attrs!.href).toBe(`ow://character/${N}`);
  });

  it('a string sidecar stays a string; an unparseable one is left alone', () => {
    const s = JSON.stringify(doc(chip(O)));
    const out = rekeyBody(el('narrative', { atlas_richtext_json: s }), map).body.atlas_richtext_json;
    expect(typeof out).toBe('string');
    expect(out as string).toContain(N);
    expect(out as string).not.toContain(O);
    const bad = '{"type":"doc", nope';
    expect(rekeyBody(el('narrative', { atlas_richtext_json: bad }), map).changed).toBe(false);
  });

  it('no resurrection: the editor re-serialising the sidecar derives no old id', () => {
    const text = { type: 'text', text: 'there', marks: [{ type: 'link', attrs: { href: `ow://location/${O2}` } }] };
    const narrative = el('narrative', {
      characters: [O], locations: [O2],
      story: `[Ann](ow://character/${O}) [there](ow://location/${O2})`,
      atlas_richtext_json: doc(chip(O, 'mention'), text),
    });
    const after = rekeyBody(narrative, map).body;
    const md = serializeDocToMarkdown(after.atlas_richtext_json as never);
    const links = Object.values(extractProseLinks(md)).flat();
    expect(links).not.toContain(O);
    expect(links).not.toContain(O2);
    expect(computeRelationPatch(after, md)).toEqual({});
    expect(Object.values(extractProseLinks(after.story as string)).flat()).toEqual([N, N2]);
  });
});

describe('rekeyBody: page blocks, walked raw', () => {
  const blocks = () => [
    { id: O, kind: 'heading', text: O, level: 1 },
    { id: 'b2', kind: 'element-card', elementId: O, variant: 'full', fields: ['name'] },
    { id: 'b3', kind: 'circle', knowerId: O2 },
    { id: 'b4', kind: 'collection', elementIds: [X, O] },
    { id: 'b5', kind: 'map', mapId: O, pinIds: [O2, X], fullPinIds: [O2] },
    { id: 'b6', kind: 'prose', markdown: `see ow://character/${O}`, richtextJson: doc(chip(O)) },
    { id: 'b7', kind: 'chart', chartId: O },
    { id: 'b8', kind: 'future', elementId: O, extra: { deep: O } },
    { kind: 'element-card' }, // malformed: kept byte-identical
  ];
  const refs = () => [O, O2, X, O, O, O2, X];

  it('rewrites element-bearing fields by kind; block ids, charts, unknown and malformed blocks survive', () => {
    const src = el('narrative', { atlas_page_blocks: blocks(), atlas_page_refs: refs() });
    const out = rekeyBody(src, map).body.atlas_page_blocks as Array<Record<string, unknown>>;
    expect(out[0]).toEqual(blocks()[0]);
    expect(out[1].elementId).toBe(N);
    expect(out[2].knowerId).toBe(N2);
    expect(out[3].elementIds).toEqual([X, N]);
    expect(out[4]).toEqual({ id: 'b5', kind: 'map', mapId: N, pinIds: [N2, X], fullPinIds: [N2] });
    expect('zoneIds' in out[4]).toBe(false); // absent = all zones: stays absent
    expect(out[5].markdown).toBe(`see ow://character/${N}`);
    expect(JSON.stringify(out[5].richtextJson)).toContain(N);
    expect(out[6]).toEqual(blocks()[6]);
    expect(out[7]).toEqual(blocks()[7]);
    expect(out[8]).toEqual(blocks()[8]);
  });

  it('heal invariant: blocksOf(after) == map(blocksOf(before)), refs length kept', () => {
    const before = el('narrative', { atlas_page_blocks: blocks(), atlas_page_refs: refs() });
    const after = rekeyBody(before, map).body;
    const sw = (id: string) => map.get(id) ?? id;
    const ELEMENT_KEYS = new Set(['elementId', 'knowerId', 'elementIds', 'mapId', 'pinIds', 'zoneIds', 'fullPinIds']);
    const bearing = (el: Element) => blocksOf(el)
      .filter(b => ['element-card', 'circle', 'collection', 'map'].includes(b.kind))
      .map(b => Object.fromEntries(Object.entries(b).filter(([k]) => ELEMENT_KEYS.has(k))));
    const expected = bearing(before).map(b => Object.fromEntries(Object.entries(b).map(([k, v]) =>
      [k, Array.isArray(v) ? v.map(sw) : sw(v as string)])));
    expect(bearing(after)).toEqual(expected);
    expect((after.atlas_page_refs as string[]).length).toBe(refs().length);
  });

  it('a page whose blocks already drifted from its refs heals to the new ids, fullPinIds included', () => {
    // An earlier Route 2 swap rewrote refs only: blocks on disk still say O2.
    const stale = [{ id: 'm', kind: 'map', mapId: X, pinIds: [O2], fullPinIds: [O2] }];
    const before = el('narrative', { atlas_page_blocks: stale, atlas_page_refs: [X, O] });
    const healed = blocksOf(rekeyBody(before, map).body)[0] as { pinIds: string[]; fullPinIds: string[] };
    expect(healed.pinIds).toEqual([N]);
    expect(healed.fullPinIds).toEqual([N]);
  });
});
