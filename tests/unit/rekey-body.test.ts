/**
 * rekeyBody: the reference transform behind giving elements new ids.
 * Rows follow re-key gate lens 3's field-path table; each names the carrier
 * whose miss would let an old id come back.
 */
import { describe, it, expect } from 'vitest';
import { NESTED_REKEY_DEPTH, rekeyBody } from '../../src/store/rekey-body';
import { layoutGroundOf } from '../../src/core/layout-recipe';
import { characterRecords } from '../../src/core/records';
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
    expect(computeRelationPatch(after, md, () => true)).toEqual({});
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

describe('rekeyBody: ids nested in x_ values, at any depth (folder spec §3.3)', () => {
  const layout = (ground: string) => ({
    method: 'trail-by-place',
    settings: { ground: { map: ground, width: 800, height: 600, name: 'Ground' }, margin: 40, note: `see ${ground}` },
    tiers: [1, 2],
  });

  it('a layout Map\'s ground follows its Map; every other byte of the value kept, key order included', () => {
    const before = el('map', { x_layout: layout(O) });
    const { body, changed } = rekeyBody(before, map);
    expect(changed).toBe(true);
    // The ground moves; the note that only mentions the id inside its text does not.
    expect(body.x_layout).toEqual({ ...layout(N), settings: { ...layout(N).settings, note: `see ${O}` } });
    // Byte for byte: the serialised value differs only where the whole string was the old id.
    const was = JSON.stringify(before.x_layout);
    const now = JSON.stringify(body.x_layout);
    expect(now).toBe(was.replace(`"map":"${O}"`, `"map":"${N}"`));
    // Untouched branches are the same objects.
    expect((body.x_layout as { tiers: unknown }).tiers).toBe((before.x_layout as { tiers: unknown }).tiers);
  });

  it('after a re-key the laid-out Map still stands on its ground', () => {
    const ground = el('map', { id: N, name: 'Ground' }) as Element;
    const laid = rekeyBody(el('map', { id: 'laid', x_layout: layout(O) }), map).body;
    expect(layoutGroundOf(laid as Element & { x_layout?: unknown }, [ground, laid])?.ground.id).toBe(N);
  });

  it('lists of objects and lists of lists; never a substring, an ow:// link, a padded copy or a key', () => {
    const value = {
      cedes: [{ place: O, by: X }, { place: [O2, 'other'] }],
      grid: [[O], [O2, 7, true, null]],
      [O]: 'a key that is an id stays a key',
      near: `${O}-copy`,
      link: `ow://location/${O}`,
      padded: ` ${O}`,
    };
    const { body } = rekeyBody(el('event', { x_war: value }), map);
    expect(body.x_war).toEqual({
      cedes: [{ place: N, by: X }, { place: [N2, 'other'] }],
      grid: [[N], [N2, 7, true, null]],
      [O]: 'a key that is an id stays a key',
      near: `${O}-copy`,
      link: `ow://location/${O}`,
      padded: ` ${O}`,
    });
  });

  it('an id is matched as written: the same id in upper case is another string', () => {
    const lower = '0192abcd-ef01-7abc-8def-0123456789ab';
    const moved = new Map([[lower, N]]);
    const { body } = rekeyBody(el('event', { x_war: { here: lower, there: lower.toUpperCase() } }), moved);
    expect(body.x_war).toEqual({ here: N, there: lower.toUpperCase() });
  });

  it('an x_ list carries its ids at any depth too; a report\'s answers stay a plain list of ids', () => {
    const { body } = rekeyBody(el('narrative', { x_report_answers: [O, X, O2], x_steps: [{ at: O }, 'note'] }), map);
    expect(body.x_report_answers).toEqual([N, X, N2]);
    expect(body.x_steps).toEqual([{ at: N }, 'note']);
  });

  it('an Event\'s record seats follow their Characters: keys renamed in place, order and values kept (record profile, seats)', () => {
    const seats = { [O]: 'General', [X]: 'Bosun', [O2]: 'Cook' };
    const before = el('event', { characters: [O, X, O2], x_record: { tool: 'tangle', played_at: '2026-11-01T00:30:00Z', seats } });
    const { body } = rekeyBody(before, map);
    expect(body.characters).toEqual([N, X, N2]);
    const rec = body.x_record as { tool: string; seats: Record<string, string> };
    expect(Object.entries(rec.seats)).toEqual([[N, 'General'], [X, 'Bosun'], [N2, 'Cook']]);
    expect(rec.tool).toBe('tangle');
    // Atlas's records read the seat under the Character's new id.
    const ann = { id: N, type: 'character', name: 'Ann', local_updated_at: '2026-01-01T00:00:00Z' } as unknown as Element;
    expect(characterRecords(N, [ann, body]).records[0]?.seat).toBe('General');
    // The source is not mutated.
    expect(Object.keys(seats)).toEqual([O, X, O2]);
  });

  it('seats are renamed on an Event only, and a key whose new id is already a key stays as it is', () => {
    const onCharacter = rekeyBody(el('character', { x_record: { tool: 't', played_at: '2026-11-01T00:30:00Z', seats: { [O]: 'General' } } }), map).body;
    expect(Object.keys((onCharacter.x_record as { seats: object }).seats)).toEqual([O]);
    const clash = rekeyBody(el('event', { x_record: { tool: 't', played_at: '2026-11-01T00:30:00Z', seats: { [O]: 'Old', [N]: 'New' } } }), map).body;
    expect(Object.entries((clash.x_record as { seats: object }).seats)).toEqual([[O, 'Old'], [N, 'New']]);
  });

  it('an exempt profile key stays whole, nested ids included; a value that names no old id is the same object', () => {
    const review = { by: O, checked: { by: O2, at: '2026-11-01T00:00:00Z' } };
    const packet = { elements: [{ id: O }] };
    const plain = { ground: { map: X } };
    const before = el('character', { x_review_proposed: review, x_packet_source: packet, x_identity_key: O, x_plain: plain });
    const { body, changed } = rekeyBody(before, map);
    expect(changed).toBe(false);
    expect(body).toBe(before);
    expect(body.x_review_proposed).toBe(review);
    expect(body.x_packet_source).toBe(packet);
    expect(body.x_plain).toBe(plain);
  });

  it('only x_ values are walked: another object field is left as it is', () => {
    const before = el('construct', { atlas_calendar: { eras: [{ start: O }] }, foreign_obj: { id: O } });
    const { body } = rekeyBody(before, map);
    expect(body.atlas_calendar).toEqual({ eras: [{ start: O }] });
    expect((body as Record<string, unknown>).foreign_obj).toEqual({ id: O });
  });

  it('a value 10,000 levels deep neither throws nor changes past the depth cap; ids above it move', () => {
    // Built from the inside out: { id, next: { id, next: ... } }, each level carrying O.
    const LEVELS = 10_000;
    let deep: Record<string, unknown> = { id: O };
    for (let i = 1; i < LEVELS; i++) deep = { id: O, next: deep };
    const before = el('event', { x_deep: deep });
    let body: Element | undefined;
    expect(() => { body = rekeyBody(before, map).body; }).not.toThrow();
    // Walk down without recursion: levels up to the cap carry N, the rest are the very objects given, O kept.
    let now = (body as Record<string, unknown>).x_deep as Record<string, unknown>;
    let was = deep;
    for (let level = 0; level < LEVELS; level++) {
      if (level < NESTED_REKEY_DEPTH) {
        expect(now.id).toBe(N);
      } else {
        expect(now).toBe(was);
        expect(now.id).toBe(O);
        break;
      }
      now = now.next as Record<string, unknown>;
      was = was.next as Record<string, unknown>;
    }
  });

  it('an own __proto__ key stays an own key when its value moves', () => {
    const value = JSON.parse(`{"__proto__": "${O}", "a": "${O}"}`) as Record<string, unknown>;
    const { body } = rekeyBody(el('event', { x_odd: value }), map);
    const out = body.x_odd as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toBe(N);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(out.a).toBe(N);
  });

  it('idempotent under the map', () => {
    const once = rekeyBody(el('map', { x_layout: layout(O) }), map).body;
    const twice = rekeyBody(once, map);
    expect(twice.changed).toBe(false);
    expect(twice.body).toBe(once);
  });
});

describe('rekeyBody: a published profile key is never an id (identity profile rule 9)', () => {
  it('x_identity_key equal to a moved id stays, while an x_ link beside it moves', () => {
    const { body } = rekeyBody(el('character', { x_identity_key: O, x_rival: O }), map);
    expect(body.x_identity_key).toBe(O);
    expect(body.x_rival).toBe(N);
  });

  it('the packet and the review marks stay too, each by its own page', () => {
    const { body } = rekeyBody(el('relation', { x_packet_elements: [O], x_review_checked: O }), map);
    expect(body.x_packet_elements).toEqual([O]);
    expect(body.x_review_checked).toBe(O);
  });

  it('a reserved key the pages leave to §3.3 moves with its id: the spine\'s depends_on, the room\'s sitting and take', () => {
    const { body } = rekeyBody(el('relation', { x_spine_depends_on: [O, X], x_room_of: O2, x_room_item: O }), map);
    expect(body.x_spine_depends_on).toEqual([N, X]);
    expect(body.x_room_of).toBe(map.get(O2));
    expect(body.x_room_item).toBe(N);
  });

  it('a report\'s answers move with their work items, as its relations do (dist.112)', () => {
    const { body } = rekeyBody(el('narrative', { relations: [O, X], x_report_answers: [O, X] }), map);
    expect(body.x_report_answers).toEqual([N, X]);
    expect(body.x_report_answers).toEqual(body.relations);
  });
});

// The re-key reads an address as the SDK does (1.124.2): only the id's and the
// lens's bytes move, looked up as written and then lowercase.
describe('rekeyBody: addresses as the SDK reads them', () => {
  const W = '0193a1c2-7d3e-7f00-8a11-3c5e7b9d2f40';
  const story = (s: string): string => rekeyBody(el('narrative', { story: s }), map).body.story as string;

  it('the round trip: a moment, a lens, a full stop, an id in capitals, another world; nothing else moves', () => {
    const before = [
      `[a](ow://character/${O}@12) and`,
      `[b](ow://character/${X}?lens=${O2}).`,
      `see ow://character/${O}.`,
      `[c](ow://character/${O.toUpperCase()})`,
      `ow://${W}/character/${O} and https://www.onlyworlds.com/w/${W}/character/${O}`,
      `ow://Character/${O} and ow://character/${O}x`,
    ].join('\n');
    const after = [
      `[a](ow://character/${N}@12) and`,
      `[b](ow://character/${X}?lens=${N2}).`,
      `see ow://character/${N}.`,
      `[c](ow://character/${N})`,
      `ow://${W}/character/${O} and https://www.onlyworlds.com/w/${W}/character/${O}`,
      `ow://Character/${O} and ow://character/${N}x`,
    ].join('\n');
    expect(story(before)).toBe(after);
  });

  it('an id held in capitals is found as written', () => {
    const U = O.toUpperCase();
    const out = rekeyBody(el('narrative', { story: `[a](ow://character/${U})` }), new Map([[U, N]])).body.story;
    expect(out).toBe(`[a](ow://character/${N})`);
  });

  it('a link mark with a moment, a lens or a query is re-keyed, the rest of the href kept', () => {
    const hrefs = [`ow://character/${O}@12`, `ow://character/${O}?lens=${O2}`, `ow://character/${O}?x=1#f`];
    for (const href of hrefs) {
      const text = { type: 'text', text: 'Ann', marks: [{ type: 'link', attrs: { href } }] };
      const out = rekeyBody(el('narrative', { atlas_richtext_json: doc(text) }), map).body.atlas_richtext_json as ReturnType<typeof doc>;
      const got = (out.content[0].content as Array<{ marks: Array<{ attrs: { href: string } }> }>)[0].marks[0].attrs.href;
      expect(got, href).toBe(href.split(O).join(N).split(O2).join(N2));
    }
  });

  it('a text with no address in the map comes back as the same string', () => {
    const s = `ow://character/abc and [x](ow://character/${X}) ow://Character/${O}`;
    const src = el('narrative', { story: s });
    const { body, changed } = rekeyBody(src, map);
    expect(changed).toBe(false);
    expect(body).toBe(src);
  });
});
