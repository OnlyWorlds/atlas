/**
 * buildPagePayload — the §5 publish payload builder (SHARING_CONTRACT.md v0.2).
 *
 * Locks the wire shape the backend stores and the viewer renders:
 * schema_version, the disclosure token encoding (ref ONLY when the target is
 * itself included), chosen-fields-only projection, richtextJson stripping,
 * and the dangling-ref drop rule.
 */

import { describe, it, expect } from 'vitest';
import { buildPagePayload, type RelationToken } from '../../src/core/share-payload';
import type { Element } from '../../src/core/types';

// ---- fixtures ---------------------------------------------------------------

const VALLAKI = 'b1000000-0000-0000-0000-000000000001';
const IREENA = 'a1000000-0000-0000-0000-000000000001';
const ISMARK = 'a2000000-0000-0000-0000-000000000002';
const GONE = 'dead0000-0000-0000-0000-000000000000'; // never in the world

function world(): Element[] {
  return [
    {
      id: IREENA, type: 'character', name: 'Ireena',
      description: 'The burgomaster\'s daughter.',
      image_url: 'https://img.example/ireena.png',
      birthplace: VALLAKI,
      friends: [ISMARK, GONE],
      local_updated_at: '2026-06-07T00:00:00Z',
    } as unknown as Element,
    {
      id: ISMARK, type: 'character', name: 'Ismark',
      local_updated_at: '2026-06-07T00:00:00Z',
    } as unknown as Element,
    {
      id: VALLAKI, type: 'location', name: 'Vallaki',
      local_updated_at: '2026-06-07T00:00:00Z',
    } as unknown as Element,
  ];
}

function makePage(blocks: unknown[], extra: Record<string, unknown> = {}): Element {
  return {
    id: 'p1000000-0000-0000-0000-000000000001',
    type: 'narrative',
    name: 'barovia primer',
    subtype: 'page',
    atlas_page_intent: 'reference',
    atlas_page_blocks: blocks,
    atlas_page_refs: blocks
      .filter((b): b is { kind: string; elementId: string } =>
        Boolean(b && typeof b === 'object' && (b as { kind?: string }).kind === 'element-card'))
      .map(b => b.elementId),
    local_updated_at: '2026-06-07T00:00:00Z',
    ...extra,
  } as unknown as Element;
}

const tokens = (v: unknown): RelationToken[] => v as RelationToken[];

// ---- tests ------------------------------------------------------------------

describe('buildPagePayload', () => {
  it('carries schema_version 1, title, intent, and an empty reserved theme', () => {
    const p = buildPagePayload(makePage([]), world());
    expect(p.schema_version).toBe(1);
    expect(p.title).toBe('barovia primer');
    expect(p.intent).toBe('reference');
    expect(p.theme).toEqual({});
    expect(p.blocks).toEqual([]);
    expect(p.elements).toEqual({});
  });

  it('strips richtextJson from prose blocks (markdown is the payload canonical)', () => {
    const p = buildPagePayload(makePage([
      { id: 'b1', kind: 'prose', markdown: 'The mists never lift.', richtextJson: { type: 'doc' } },
      { id: 'b2', kind: 'heading', text: 'The Domain', level: 1 },
    ]), world());
    expect(p.blocks).toEqual([
      { id: 'b1', kind: 'prose', markdown: 'The mists never lift.' },
      { id: 'b2', kind: 'heading', text: 'The Domain', level: 1 },
    ]);
  });

  it('includes ONLY card-bound elements, with ONLY their chosen, populated fields', () => {
    const p = buildPagePayload(makePage([
      { id: 'b1', kind: 'element-card', elementId: IREENA, variant: 'full', fields: ['description', 'physicality'] },
    ]), world());
    expect(Object.keys(p.elements)).toEqual([IREENA]);
    const entry = p.elements[IREENA];
    expect(entry.name).toBe('Ireena');
    expect(entry.type).toBe('character');
    expect(entry.image_url).toBe('https://img.example/ireena.png');
    // description chosen + populated → present; physicality chosen + empty → absent;
    // birthplace populated but NOT chosen → absent.
    expect(entry.fields).toEqual({ description: 'The burgomaster\'s daughter.' });
  });

  it('disclosure: relation tokens carry ref ONLY when the target is itself included', () => {
    // Ireena carded with relations; Ismark carded too; Vallaki NOT carded.
    const p = buildPagePayload(makePage([
      { id: 'b1', kind: 'element-card', elementId: IREENA, variant: 'full', fields: ['birthplace', 'friends'] },
      { id: 'b2', kind: 'element-card', elementId: ISMARK, variant: 'compact', fields: [] },
    ]), world());

    const ireena = p.elements[IREENA];
    // single_link: Vallaki not included → plain-text token, no ref.
    expect(tokens(ireena.fields.birthplace)).toEqual([{ text: 'Vallaki' }]);
    // multi_link: Ismark included → ref; the dangling id is DROPPED entirely.
    expect(tokens(ireena.fields.friends)).toEqual([{ text: 'Ismark', ref: ISMARK }]);
    // compact card: identity only, no fields.
    expect(p.elements[ISMARK].fields).toEqual({});
  });

  it('unions chosen fields across multiple full cards of the same element', () => {
    const p = buildPagePayload(makePage([
      { id: 'b1', kind: 'element-card', elementId: IREENA, variant: 'full', fields: ['description'] },
      { id: 'b2', kind: 'element-card', elementId: IREENA, variant: 'full', fields: ['birthplace'] },
    ]), world());
    expect(Object.keys(p.elements[IREENA].fields).sort()).toEqual(['birthplace', 'description']);
  });

  it('a card bound to a missing element stays in blocks but adds no entry', () => {
    const p = buildPagePayload(makePage([
      { id: 'b1', kind: 'element-card', elementId: GONE, variant: 'full', fields: ['description'] },
    ]), world());
    expect(p.blocks).toHaveLength(1);
    expect(p.elements).toEqual({});
  });

  it('defensively skips meta/atlas-local fields even if present in a card config', () => {
    const p = buildPagePayload(makePage([
      { id: 'b1', kind: 'element-card', elementId: IREENA, variant: 'full',
        fields: ['id', 'image_url', 'atlas_aliases', 'local_updated_at', 'description'] },
    ]), world());
    expect(Object.keys(p.elements[IREENA].fields)).toEqual(['description']);
  });

  it('passes a stored theme object through; defaults to {}', () => {
    const themed = buildPagePayload(
      makePage([], { atlas_page_theme: { accent: '#22d3ee' } }), world());
    expect(themed.theme).toEqual({ accent: '#22d3ee' });
  });

  it('heals card ids from the refs mirror before building (id-swap safety)', () => {
    // Block carries a STALE nested id; the refs mirror has the fresh one
    // (rewriteIdReferences rewrote the flat array). blocksOf() heals — the
    // payload must follow the mirror.
    const page = makePage([
      { id: 'b1', kind: 'element-card', elementId: 'stale-old-id', variant: 'compact', fields: [] },
    ]);
    (page as unknown as Record<string, unknown>).atlas_page_refs = [IREENA];
    const p = buildPagePayload(page, world());
    expect(Object.keys(p.elements)).toEqual([IREENA]);
    const card = p.blocks.find(b => b.kind === 'element-card');
    expect((card as { elementId: string }).elementId).toBe(IREENA);
  });
});
