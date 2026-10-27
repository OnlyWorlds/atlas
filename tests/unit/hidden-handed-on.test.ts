/**
 * Folder spec §4.8 (conv. 170): the hidden mark is a folder key. An import keeps
 * it as the file wrote it; a published page hands the world on, so it leaves a
 * hidden element out as a missing one, counts it in the builder's line, and
 * does not publish a hidden page; a push sends the mark on a create only, as
 * the boolean keel takes, never on an update.
 */
import { describe, it, expect } from 'vitest';
import type { Element } from '../../src/core/types';
import { buildPagePayload, hiddenLeftOut, leftOutPageLine, pageNotPublishedLine, type PayloadCircleBlock, type RelationToken } from '../../src/core/share-payload';
import { toV2WireShape } from '../../src/sync/ow-v2-client-adapter';
import { normalizeRecord } from '../../src/import/normalize';
import { isAuthError, isHiddenRefusal } from '../../src/sync/sync-engine';

const el = (id: string, name: string, extra: Record<string, unknown> = {}, type = 'character'): Element =>
  ({ id, type, name, local_updated_at: 't', ...extra }) as unknown as Element;

const ADA = 'a1000000-0000-0000-0000-000000000001';
const WREN = 'a2000000-0000-0000-0000-000000000002';
const HOME = 'b1000000-0000-0000-0000-000000000001';
const ENTRY = 'e1000000-0000-0000-0000-000000000001';
const SECRET = 'e2000000-0000-0000-0000-000000000002';
const QUILL = 'a3000000-0000-0000-0000-000000000003';
const MARK = { by: '19e1c2e5-5e8e-4d46-8382-e5ad445d13a0', evidence: 'seat', expires: '2026-11-22' };

const world = (): Element[] => [
  el(ADA, 'Ada', { friends: [WREN], description: 'Shown.' }),
  el(WREN, 'Wren', { hidden: true, description: 'The traitor, hidden by the keeper.' }),
  el(HOME, 'Harbour', {}, 'location'),
  el(ENTRY, 'the tides', { subtype: 'knowledge', story: 'Shown.', narrator: ADA }, 'narrative'),
  el(SECRET, 'the plot', { subtype: 'knowledge', story: 'Wren opens the gate at dawn.', narrator: ADA, hidden: true }, 'narrative'),
];
const page = (blocks: unknown[], extra: Record<string, unknown> = {}): Element => ({
  id: 'p1', type: 'narrative', name: 'primer', subtype: 'page', atlas_page_intent: 'reference',
  atlas_page_blocks: blocks, local_updated_at: 't', ...extra,
}) as unknown as Element;
const blocks = [
  { id: 'b1', kind: 'element-card', elementId: ADA, variant: 'full', fields: ['friends'] },
  { id: 'b2', kind: 'element-card', elementId: WREN, variant: 'full', fields: ['description'] },
  { id: 'b3', kind: 'collection', elementIds: [WREN, HOME] },
  { id: 'b4', kind: 'circle', knowerId: ADA },
];

describe('a published page leaves the hidden out', () => {
  it('from every block, as a missing element', () => {
    const p = buildPagePayload(page(blocks), world());
    expect(Object.keys(p.elements).sort()).toEqual([ADA, HOME].sort());
    expect(p.elements[ADA].fields.friends as RelationToken[] | undefined).toBeUndefined();
    expect((p.blocks.find(b => b.kind === 'collection') as { elementIds: string[] }).elementIds).toEqual([HOME]);
    expect((p.blocks.find(b => b.kind === 'circle') as PayloadCircleBlock).entries.map(e => e.title)).toEqual(['the tides']);
    const json = JSON.stringify(p);
    expect(json).not.toContain('opens the gate');
    expect(json).not.toContain('The traitor');
  });

  it('a doubtful mark leaves it out; false and null publish it', () => {
    for (const v of ['true', 1]) {
      const w = world().map(e => e.id === WREN ? { ...e, hidden: v } as Element : e);
      expect(Object.keys(buildPagePayload(page(blocks), w).elements)).not.toContain(WREN);
    }
    for (const v of [false, null]) {
      const w = world().map(e => (e as Record<string, unknown>).hidden ? { ...e, hidden: v } as Element : e);
      const p = buildPagePayload(page(blocks), w);
      expect(Object.keys(p.elements)).toContain(WREN);
      expect((p.blocks.find(b => b.kind === 'circle') as PayloadCircleBlock).entries).toHaveLength(2);
      expect(hiddenLeftOut(page(blocks), w)).toEqual([]);
    }
  });

  it('the builder is told how many and which', () => {
    expect(hiddenLeftOut(page(blocks), world()).sort()).toEqual(['Wren', 'the plot']);
    expect(leftOutPageLine(page(blocks), world())).toBe('2 hidden (Wren, the plot) are left out of the published page.');
    expect(leftOutPageLine(page([blocks[2]]), world())).toBe('Wren is hidden, so the published page leaves it out.');
    expect(leftOutPageLine(page([blocks[0]]), world().filter(e => e.id !== SECRET))).toBe(null);
  });

  it('hidden and proposed are each said, hidden first', () => {
    const w = [...world(), el(QUILL, 'Quill', { x_review_proposed: MARK })];
    const p = page([...blocks, { id: 'b5', kind: 'element-card', elementId: QUILL, variant: 'full', fields: [] }]);
    expect(Object.keys(buildPagePayload(p, w).elements)).not.toContain(QUILL);
    expect(leftOutPageLine(p, w)).toBe('2 hidden (Wren, the plot) are left out of the published page. Quill is proposed and not yet reviewed, so the published page leaves it out until a keeper accepts it.');
  });

  it('a hidden pin names the pin, never its shown element', () => {
    const MAP = 'm1000000-0000-0000-0000-000000000001';
    const PIN = 'f1000000-0000-0000-0000-000000000001';
    const w = [
      ...world(),
      el(MAP, 'Chart', { image_url: 'https://img.example/c.png', width: 100, height: 100 }, 'map'),
      el(PIN, 'pin', { map_id: MAP, element_id: HOME, element_type: 'location', x: 10, y: 10, hidden: true }, 'pin'),
    ];
    const p = page([{ id: 'm', kind: 'map', mapId: MAP, pinIds: [PIN] }]);
    expect(hiddenLeftOut(p, w)).toEqual(['a pin on Harbour']);
  });

  it('a hidden page is not published at all, and says so', () => {
    const p = page([blocks[0]], { hidden: true });
    expect(pageNotPublishedLine(p)).toBe('This page is hidden, so it is not published: a published page is read by anyone with its link.');
    expect(leftOutPageLine(p, world())).toBe(pageNotPublishedLine(p));
    expect(pageNotPublishedLine(page([blocks[0]]))).toBeNull();
  });
});

describe('the wire', () => {
  it('a create carries the mark as true; an update never', () => {
    expect(toV2WireShape({ id: ADA, name: 'Ana', hidden: true }, 'character', 'create').hidden).toBe(true);
    expect(toV2WireShape({ id: ADA, name: 'Ana', hidden: 'true' }, 'character', 'create').hidden).toBe(true);
    expect('hidden' in toV2WireShape({ id: ADA, name: 'Ana', hidden: true }, 'character', 'update')).toBe(false);
    for (const v of [false, null, undefined]) {
      expect('hidden' in toV2WireShape({ id: ADA, name: 'Ana', hidden: v }, 'character', 'create')).toBe(false);
    }
    expect('hidden' in toV2WireShape({ id: ADA, name: 'Ana' }, 'character', 'create')).toBe(false);
  });
});

describe('keel\'s refusal to hide (403 hidden_not_allowed)', () => {
  const refusal = Object.assign(new Error("API Error 403: Only the world's owner and its co-builders can create an element hidden."), { status: 403, code: 'hidden_not_allowed', param: null });
  it('is about the element, never a dead key, wherever it is thrown', () => {
    expect(isHiddenRefusal(refusal)).toBe(true);
    expect(isAuthError(refusal)).toBe(false);
    // The control: another 403 is still the key's.
    expect(isAuthError(Object.assign(new Error('API Error 403'), { status: 403, code: 'permission_error', param: null }))).toBe(true);
    expect(isHiddenRefusal(Object.assign(new Error('API Error 403'), { status: 403, code: 'not_author', param: null }))).toBe(false);
  });
});

describe('an import', () => {
  it('keeps the mark as the file wrote it, with or without the unknown-field keep', () => {
    for (const keepUnknown of [false, true]) {
      expect(normalizeRecord({ id: ADA, name: 'Ana', hidden: true }, 'character', { keepUnknown }).record.hidden).toBe(true);
      expect(normalizeRecord({ id: ADA, name: 'Ana', hidden: 'true' }, 'character', { keepUnknown }).record.hidden).toBe('true');
      expect('hidden' in normalizeRecord({ id: ADA, name: 'Ana' }, 'character', { keepUnknown }).record).toBe(false);
    }
  });
});
