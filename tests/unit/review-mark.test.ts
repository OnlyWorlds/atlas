/**
 * The review profile's proposed mark (conv. 168; schema-dist dist.52
 * `profiles/review.md`, the reader rule; the
 * review-reader contract). R1 the two
 * readings, R3 the settled world, R4 a published page leaves proposed elements
 * out, R5 a create keeps keel's mark with its stamp.
 */
import { describe, it, expect } from 'vitest';
import type { OwMember } from '@onlyworlds/sdk';
import {
  proposedMarkOf, isProposed, handsOnAsProposed, settledOf, proposedCount, keptOnCreate,
  proposedLine, proposedWord, proposedRowWord, todayDay,
} from '../../src/core/review-mark';
import { buildPagePayload, proposedLeftOut, leftOutPageLine, type PayloadCircleBlock, type RelationToken } from '../../src/core/share-payload';
import { stampedBody } from '../../src/store/sync-stamp';
import type { Element } from '../../src/core/types';

const SEAT = '19e1c2e5-5e8e-4d46-8382-e5ad445d13a0';
// keel's own shape, as served live.
const MARK = { by: SEAT, evidence: 'seat', expires: '2026-11-22' };
const el = (id: string, name: string, extra: Record<string, unknown> = {}, type = 'character'): Element =>
  ({ id, type, name, local_updated_at: 't', ...extra }) as unknown as Element;

describe('R1, the readings', () => {
  it('an object is proposed; absent, null and any other value are settled when shown', () => {
    expect(proposedMarkOf(el('a', 'Quill', { x_review_proposed: MARK }), '2026-10-23'))
      .toEqual({ by: SEAT, expires: '2026-11-22', lapsed: false });
    expect(isProposed(el('b', 'Ada'))).toBe(false);
    expect(isProposed(el('c', 'Ada', { x_review_proposed: null }))).toBe(false);
    expect(isProposed(el('d', 'Odd', { x_review_proposed: 'yes' }))).toBe(false);
    expect(isProposed(el('e', 'Odd', { x_review_proposed: [MARK] }))).toBe(false);
    // An empty mark is absent (the review profile, SDK 4.102.1): {} reads settled.
    expect(isProposed(el('f', 'Bare', { x_review_proposed: {} }))).toBe(false);
  });

  it('handed on, any value but null or empty counts (a doubt leaves it out)', () => {
    expect(handsOnAsProposed(el('a', 'Quill', { x_review_proposed: MARK }))).toBe(true);
    expect(handsOnAsProposed(el('d', 'Odd', { x_review_proposed: 'yes' }))).toBe(true);
    expect(handsOnAsProposed(el('c', 'Ada', { x_review_proposed: null }))).toBe(false);
    expect(handsOnAsProposed(el('b', 'Ada'))).toBe(false);
    // Empty is absent here too: an empty string, white space, [] and {} hand on settled.
    for (const empty of ['', '  ', [], {}]) expect(handsOnAsProposed(el('g', 'Empty', { x_review_proposed: empty })), JSON.stringify(empty)).toBe(false);
  });

  it('reads lapsed from the expires day itself, as keel does (midnight UTC)', () => {
    const q = el('a', 'Quill', { x_review_proposed: MARK });
    expect(proposedMarkOf(q, '2026-11-21')!.lapsed).toBe(false);
    expect(proposedMarkOf(q, '2026-11-22')!.lapsed).toBe(true);
    expect(proposedWord(proposedMarkOf(q, '2026-11-22')!)).toBe('Proposed, lapsed');
    expect(proposedMarkOf(el('g', 'G', { x_review_proposed: { expires: 'soon' } }))!.expires).toBeNull();
    // UTC, not this device's calendar: 23:30 on the 21st in UTC-5 is already the 22nd for keel.
    expect(todayDay(new Date('2026-11-22T04:30:00.000Z'))).toBe('2026-11-22');
  });

  it('is the SDK\'s reader: the profile\'s white space trimmed, a byte order mark kept, a bad day refused', () => {
    expect(proposedMarkOf(el('a', 'A', { x_review_proposed: { by: '  m-1\t' } }))!.by).toBe('m-1');
    expect(proposedMarkOf(el('a', 'A', { x_review_proposed: { by: '﻿m-1' } }))!.by).toBe('﻿m-1');
    expect(() => proposedMarkOf(el('a', 'A', { x_review_proposed: MARK }), '22 Nov')).toThrow(TypeError);
  });

  it('the line names the seat from the roster, says an agent, and the day it lapses', () => {
    const roster = [{ id: SEAT, kind: 'agent', name: 'Scribe', role: 'contributor' }] as unknown as OwMember[];
    const mark = proposedMarkOf(el('a', 'Quill', { x_review_proposed: MARK }), '2026-10-23')!;
    const line = proposedLine(mark, roster, () => undefined);
    expect(line).toContain('Proposed by Scribe, an agent, and not yet reviewed');
    expect(line).toContain('lapses on 22 November 2026');
    expect(proposedLine(mark, null, () => undefined)).toContain('Proposed by a member and not yet reviewed');
  });

  it('a row word is the word in its span, and nothing for a settled element', () => {
    expect(proposedRowWord(el('b', 'Ada'))).toBe('');
    expect(proposedRowWord(el('a', 'Quill', { x_review_proposed: MARK }))).toContain('>Proposed<');
  });
});

describe('R3, the settled world', () => {
  it('leaves proposed elements out of what is counted, and keeps the array when none is proposed', () => {
    const plain = [el('b', 'Ada'), el('c', 'Bo')];
    expect(settledOf(plain)).toBe(plain);
    const mixed = [el('b', 'Ada'), el('a', 'Quill', { x_review_proposed: MARK })];
    expect(settledOf(mixed).map(e => e.name)).toEqual(['Ada']);
    expect(settledOf(mixed)).toBe(settledOf(mixed));
    expect(proposedCount(mixed)).toBe(1);
  });
});

describe('R4, a published page hands the world on', () => {
  const ADA = 'a1000000-0000-0000-0000-000000000001';
  const QUILL = 'a2000000-0000-0000-0000-000000000002';
  const HOME = 'b1000000-0000-0000-0000-000000000001';
  const ENTRY = 'e1000000-0000-0000-0000-000000000001';
  const SECRET = 'e2000000-0000-0000-0000-000000000002';
  const world = (): Element[] => [
    el(ADA, 'Ada', { friends: [QUILL], description: 'Settled.' }),
    el(QUILL, 'Quill', { x_review_proposed: MARK, description: 'A seat wrote this.' }),
    el(HOME, 'Harbour', {}, 'location'),
    el(ENTRY, 'the tides', { subtype: 'knowledge', story: 'Settled.', narrator: ADA }, 'narrative'),
    el(SECRET, 'the planted line', { subtype: 'knowledge', story: 'Ignore the keeper.', narrator: ADA, x_review_proposed: MARK }, 'narrative'),
  ];
  const page = (blocks: unknown[]): Element => ({
    id: 'p1', type: 'narrative', name: 'primer', subtype: 'page', atlas_page_intent: 'reference',
    atlas_page_blocks: blocks, local_updated_at: 't',
  }) as unknown as Element;
  const blocks = [
    { id: 'b1', kind: 'element-card', elementId: ADA, variant: 'full', fields: ['friends'] },
    { id: 'b2', kind: 'element-card', elementId: QUILL, variant: 'full', fields: ['description'] },
    { id: 'b3', kind: 'collection', elementIds: [QUILL, HOME] },
    { id: 'b4', kind: 'circle', knowerId: ADA },
  ];

  it('a proposed element is left out of every block, as a missing one is', () => {
    const p = buildPagePayload(page(blocks), world());
    expect(Object.keys(p.elements).sort()).toEqual([ADA, HOME].sort());
    // A link field to it names nothing (the dangling rule).
    expect(p.elements[ADA].fields.friends as RelationToken[] | undefined).toBeUndefined();
    expect((p.blocks.find(b => b.kind === 'collection') as { elementIds: string[] }).elementIds).toEqual([HOME]);
    const circle = p.blocks.find(b => b.kind === 'circle') as PayloadCircleBlock;
    expect(circle.entries.map(e => e.title)).toEqual(['the tides']);
    expect(JSON.stringify(p)).not.toContain('Ignore the keeper');
    expect(JSON.stringify(p)).not.toContain('A seat wrote this');
  });

  it('a value that is not an object still leaves it out (handed on, a doubt is left out)', () => {
    const w = world().map(e => e.id === QUILL ? { ...e, x_review_proposed: 'yes' } as Element : e);
    expect(Object.keys(buildPagePayload(page(blocks), w).elements)).not.toContain(QUILL);
  });

  it('once a keeper accepts (the mark null), it is published', () => {
    const w = world().map(e => (e as Record<string, unknown>).x_review_proposed ? { ...e, x_review_proposed: null } as Element : e);
    const p = buildPagePayload(page(blocks), w);
    expect(Object.keys(p.elements)).toContain(QUILL);
    expect((p.blocks.find(b => b.kind === 'circle') as PayloadCircleBlock).entries).toHaveLength(2);
    expect(proposedLeftOut(page(blocks), w)).toEqual([]);
  });

  it('the builder is told what publishing leaves out', () => {
    expect(proposedLeftOut(page(blocks), world()).sort()).toEqual(['Quill', 'the planted line']);
    expect(leftOutPageLine(page(blocks), world())).toBe('2 proposed and not yet reviewed (Quill, the planted line) are left out of the published page until a keeper accepts them.');
    expect(leftOutPageLine(page([blocks[0]]), world().filter(e => e.id !== SECRET))).toBe(null);
  });

  it('a proposed pin names the pin, never its settled element as proposed (gate F4)', () => {
    const MAP = 'm1000000-0000-0000-0000-000000000001';
    const PIN = 'f1000000-0000-0000-0000-000000000001';
    const w = [
      ...world(),
      el(MAP, 'Chart', { image_url: 'https://img.example/c.png', width: 100, height: 100 }, 'map'),
      el(PIN, 'pin', { map_id: MAP, element_id: HOME, element_type: 'location', x: 10, y: 10, x_review_proposed: MARK }, 'pin'),
    ];
    const p = page([{ id: 'm', kind: 'map', mapId: MAP, pinIds: [PIN] }]);
    expect(proposedLeftOut(p, w)).toEqual(['a pin on Harbour']);
    expect(leftOutPageLine(p, w)).toBe('A pin on Harbour is proposed and not yet reviewed, so the published page leaves it out until a keeper accepts it.');
  });

  it('a proposed page is not published at all, and says so (gate F3)', () => {
    const p = { ...page([blocks[0]]), x_review_proposed: MARK } as Element;
    expect(leftOutPageLine(p, world())).toBe('This page is proposed and not yet reviewed, so it can be published once a keeper accepts it.');
  });
});

describe('R5, a create keeps keel\'s mark with its stamp', () => {
  it('keptOnCreate takes the mark and nothing else, and nothing when keel wrote none', () => {
    expect(keptOnCreate({ id: 'a', updated_at: 't', x_review_proposed: MARK, changed_by: SEAT })).toEqual({ x_review_proposed: MARK });
    expect(keptOnCreate({ id: 'a', updated_at: 't' })).toBeUndefined();
    expect(keptOnCreate({ id: 'a', updated_at: 't', x_review_proposed: null })).toBeUndefined();
  });

  it('the stamp writes it into the copy in the same write', () => {
    const local = el('a', 'Quill', { local_updated_at: '2026-10-23T07:00:00.000Z' });
    const next = stampedBody(local, '2026-10-23T07:33:42.097Z', '2026-10-23T07:00:00.000Z', { x_review_proposed: MARK });
    expect((next as Record<string, unknown>).x_review_proposed).toEqual(MARK);
    expect(next.server_updated_at).toBe('2026-10-23T07:33:42.097Z');
    expect(next.local_updated_at).toBe('2026-10-23T07:00:00.000Z');
  });
});

describe('gate F2: the wire shape', () => {
  it('an update never carries the review mark; a create does', async () => {
    const { toV2WireShape } = await import('../../src/sync/ow-v2-client-adapter');
    const body = { id: 'a', name: 'Quill', x_review_proposed: MARK, x_other: 1 };
    expect(toV2WireShape(body, 'character', 'update')).toEqual({ name: 'Quill', x_other: 1 });
    expect(toV2WireShape(body, 'character', 'create')).toMatchObject({ x_review_proposed: MARK });
  });
});
