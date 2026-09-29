/**
 * buildPagePayload — the §5 publish payload builder (SHARING_CONTRACT.md v0.2).
 *
 * Locks the wire shape the backend stores and the viewer renders:
 * schema_version, the disclosure token encoding (ref ONLY when the target is
 * itself included), chosen-fields-only projection, richtextJson stripping,
 * and the dangling-ref drop rule.
 */

import { describe, it, expect } from 'vitest';
import { buildPagePayload, freezeMapBlock, type RelationToken, type PayloadCircleBlock } from '../../src/core/share-payload';
import type { MapBlock } from '../../src/core/sharing';
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

  it('VALIDATES the stored theme into curated tokens — unknown keys/values drop (S3)', () => {
    const themed = buildPagePayload(
      makePage([], { atlas_page_theme: { accent: '#22d3ee', mode: 'light', density: 'airy' } }), world());
    expect(themed.theme).toEqual({ accent: '#22d3ee', mode: 'light', density: 'airy' });

    // Out-of-set values + unknown keys + non-https cover never reach the wire.
    const hostile = buildPagePayload(
      makePage([], { atlas_page_theme: {
        accent: 'red;background:url(javascript:x)', mode: 'rainbow',
        font: '"; @import evil', custom_css: 'body{}', cover: 'javascript:alert(1)',
      } }), world());
    expect(hostile.theme).toEqual({});

    // Missing theme → {}.
    expect(buildPagePayload(makePage([]), world()).theme).toEqual({});
  });

  it('freezes a circle block: knower title + held entries (incl. circle-member inheritance)', () => {
    const CIRCLE = 'c1000000-0000-0000-0000-000000000001';
    const ENTRY = 'e1000000-0000-0000-0000-000000000001';
    const ENTRY2 = 'e2000000-0000-0000-0000-000000000002';
    const elements: Element[] = [
      ...world(),
      { id: CIRCLE, type: 'collective', name: 'the party', subtype: 'circle',
        characters: [IREENA], local_updated_at: 't' } as unknown as Element,
      { id: ENTRY, type: 'narrative', name: 'the mists', subtype: 'knowledge',
        story: 'The mists never lift.', collectives: [CIRCLE], local_updated_at: 't' } as unknown as Element,
      // Held by Ireena solo — inherited NOTHING by the circle (direct holders only).
      { id: ENTRY2, type: 'narrative', name: 'her secret', subtype: 'knowledge',
        story: 'Hers alone.', narrator: IREENA, local_updated_at: 't' } as unknown as Element,
    ];

    // Circle knower: direct holdings only.
    const p = buildPagePayload(makePage([
      { id: 'b1', kind: 'circle', knowerId: CIRCLE },
    ]), elements);
    const frozen = p.blocks[0] as PayloadCircleBlock;
    expect(frozen.kind).toBe('circle');
    expect(frozen.title).toBe('the party');
    expect(frozen.knowerType).toBe('collective');
    expect(frozen.entries).toEqual([{ title: 'the mists', markdown: 'The mists never lift.' }]);
    // The knower itself is NOT auto-included in elements (cards decide inclusion).
    expect(p.elements).toEqual({});

    // Character knower: direct + inherited via circle membership.
    const pc = buildPagePayload(makePage([
      { id: 'b1', kind: 'circle', knowerId: IREENA },
    ]), elements);
    const frozenChar = pc.blocks[0] as PayloadCircleBlock;
    expect(frozenChar.knowerType).toBe('character');
    expect(frozenChar.entries.map(e => e.title).sort()).toEqual(['her secret', 'the mists']);
  });

  it('a circle block with a missing knower freezes to an honest empty', () => {
    const p = buildPagePayload(makePage([
      { id: 'b1', kind: 'circle', knowerId: GONE },
    ]), world());
    const frozen = p.blocks[0] as PayloadCircleBlock;
    expect(frozen.title).toBe('(missing knower)');
    expect(frozen.entries).toEqual([]);
  });

  it('scrubs ow:// links to NON-included targets out of prose markdown (wire-level disclosure)', () => {
    const p = buildPagePayload(makePage([
      { id: 'b1', kind: 'prose',
        markdown: `[Ireena](ow://character/${IREENA}) hides from [Vallaki](ow://location/${VALLAKI}). See ow://location/${VALLAKI} too.` },
      { id: 'b2', kind: 'element-card', elementId: IREENA, variant: 'compact', fields: [] },
    ]), world());
    const prose = p.blocks[0] as { markdown: string };
    // Included target keeps its link; non-included pre-resolves to the label;
    // a bare hand-typed URI resolves to the element name.
    expect(prose.markdown).toBe(`[Ireena](ow://character/${IREENA}) hides from Vallaki. See Vallaki too.`);
    // The payload JSON itself must not carry the undisclosed uuid anywhere.
    expect(JSON.stringify(p)).not.toContain(VALLAKI);
  });

  it('scrubs circle entry markdown the same way (frozen knowledge is public wire too)', () => {
    const CIRCLE = 'c1000000-0000-0000-0000-000000000001';
    const ENTRY = 'e1000000-0000-0000-0000-000000000001';
    const elements: Element[] = [
      ...world(),
      { id: CIRCLE, type: 'collective', name: 'the party', subtype: 'circle',
        characters: [], local_updated_at: 't' } as unknown as Element,
      { id: ENTRY, type: 'narrative', name: 'the mists', subtype: 'knowledge',
        story: `[Vallaki](ow://location/${VALLAKI}) is sealed.`, collectives: [CIRCLE],
        local_updated_at: 't' } as unknown as Element,
    ];
    const p = buildPagePayload(makePage([{ id: 'b1', kind: 'circle', knowerId: CIRCLE }]), elements);
    const frozen = p.blocks[0] as PayloadCircleBlock;
    expect(frozen.entries[0].markdown).toBe('Vallaki is sealed.');
    expect(JSON.stringify(p)).not.toContain(VALLAKI);
  });

  it('S367 critic C6: card field text ships no ow:// link (full-card story and pinned description)', () => {
    const SCENE = 'd1000000-0000-0000-0000-000000000001';
    const elements: Element[] = [
      ...world(),
      { id: SCENE, type: 'narrative', name: 'Chapter 3',
        story: `The courier met [Ireena](ow://character/${IREENA}) near ow://location/${VALLAKI}.`,
        local_updated_at: 't' } as unknown as Element,
    ];
    // Ireena is carded too: even an included target's link goes (fields never chip).
    const p = buildPagePayload(makePage([
      { id: 'b1', kind: 'element-card', elementId: SCENE, variant: 'full', fields: ['story'] },
      { id: 'b2', kind: 'element-card', elementId: IREENA, variant: 'compact', fields: [] },
    ]), elements);
    expect(p.elements[SCENE].fields.story).toBe('The courier met Ireena near Vallaki.');
    expect(JSON.stringify(p)).not.toContain('ow://');
    expect(JSON.stringify(p)).not.toContain(VALLAKI);

    // A pinned element's default description goes through the same scrub.
    const MAP = 'f1000000-0000-0000-0000-000000000001';
    const PIN = 'f2000000-0000-0000-0000-000000000002';
    const TOWN = 'f3000000-0000-0000-0000-000000000003';
    const mapWorld: Element[] = [
      ...world(),
      { id: MAP, type: 'map', name: 'Realm', image_url: 'https://img.example/m.png', width: 100, height: 100 } as unknown as Element,
      { id: TOWN, type: 'location', name: 'Dampworth', description: `Seat of [Ismark](ow://character/${ISMARK}).` } as unknown as Element,
      { id: PIN, type: 'pin', name: 'p', map_id: MAP, element_id: TOWN, x: 10, y: 10 } as unknown as Element,
    ];
    const pm = buildPagePayload(makePage([{ id: 'b1', kind: 'map', mapId: MAP, pinIds: [PIN] }]), mapWorld);
    expect(pm.elements[TOWN].fields.description).toBe('Seat of Ismark.');
    expect(JSON.stringify(pm)).not.toContain(ISMARK);
  });

  it('S367 critic C12a: a circle block ships the knower id only when the knower is included', () => {
    const CIRCLE = 'c1000000-0000-0000-0000-000000000001';
    const elements: Element[] = [
      ...world(),
      { id: CIRCLE, type: 'collective', name: 'the party', subtype: 'circle',
        characters: [], local_updated_at: 't' } as unknown as Element,
    ];
    const hidden = buildPagePayload(makePage([{ id: 'b1', kind: 'circle', knowerId: CIRCLE }]), elements);
    expect((hidden.blocks[0] as PayloadCircleBlock).knowerId).toBe('');
    expect(JSON.stringify(hidden)).not.toContain(CIRCLE);

    const shown = buildPagePayload(makePage([
      { id: 'b1', kind: 'circle', knowerId: CIRCLE },
      { id: 'b2', kind: 'element-card', elementId: CIRCLE, variant: 'compact', fields: [] },
    ]), elements);
    expect((shown.blocks[0] as PayloadCircleBlock).knowerId).toBe(CIRCLE);
  });

  it('image_url ships per showImage (default ON, compact renders it as avatar); all-cards opt-out drops it from the wire', () => {
    // Default: a lone compact card ships the image (rendered as a head avatar).
    const def = buildPagePayload(makePage([
      { id: 'b1', kind: 'element-card', elementId: IREENA, variant: 'compact', fields: [] },
    ]), world());
    expect(def.elements[IREENA].image_url).toBe('https://img.example/ireena.png');

    // Every card for the element opts out → the url never reaches the payload.
    const optedOut = buildPagePayload(makePage([
      { id: 'b1', kind: 'element-card', elementId: IREENA, variant: 'compact', fields: [], showImage: false },
      { id: 'b2', kind: 'element-card', elementId: IREENA, variant: 'full', fields: [], showImage: false },
    ]), world());
    expect(optedOut.elements[IREENA].image_url).toBeUndefined();

    // Mixed: one card wanting it is enough (the entry is shared across cards).
    const mixed = buildPagePayload(makePage([
      { id: 'b1', kind: 'element-card', elementId: IREENA, variant: 'compact', fields: [], showImage: false },
      { id: 'b2', kind: 'element-card', elementId: IREENA, variant: 'full', fields: [] },
    ]), world());
    expect(mixed.elements[IREENA].image_url).toBe('https://img.example/ireena.png');
  });

  it('collection members join the payload IDENTITY-ONLY (name/type/image, no fields); dangling members drop from the wire', () => {
    const page = makePage([
      { id: 'b1', kind: 'collection', elementIds: [IREENA, ISMARK, GONE] },
    ]);
    (page as unknown as Record<string, unknown>).atlas_page_refs = [IREENA, ISMARK, GONE];
    const p = buildPagePayload(page, world());
    // Members included, identity only — Ireena's populated fields stay out.
    expect(Object.keys(p.elements).sort()).toEqual([IREENA, ISMARK].sort());
    expect(p.elements[IREENA].fields).toEqual({});
    expect(p.elements[IREENA].image_url).toBe('https://img.example/ireena.png'); // grid avatar
    // Dangling member dropped from the wire block.
    const col = p.blocks[0] as { elementIds: string[] };
    expect(col.elementIds).toEqual([IREENA, ISMARK]);
    expect(JSON.stringify(p)).not.toContain(GONE);
  });

  it('refs-mirror healing is COUNT-AWARE across collections (id-swap safety)', () => {
    // A card, then a 2-member collection, then a circle — 4 refs total.
    // All nested ids are stale; the flat mirror carries the fresh ones.
    const CIRCLE = 'c1000000-0000-0000-0000-000000000001';
    const elements: Element[] = [
      ...world(),
      { id: CIRCLE, type: 'collective', name: 'the party', characters: [],
        local_updated_at: 't' } as unknown as Element,
    ];
    const page = makePage([
      { id: 'b1', kind: 'element-card', elementId: 'stale-a', variant: 'compact', fields: [] },
      { id: 'b2', kind: 'collection', elementIds: ['stale-b', 'stale-c'] },
      { id: 'b3', kind: 'circle', knowerId: 'stale-d' },
    ]);
    (page as unknown as Record<string, unknown>).atlas_page_refs = [IREENA, ISMARK, VALLAKI, CIRCLE];
    const p = buildPagePayload(page, elements);
    expect((p.blocks[0] as { elementId: string }).elementId).toBe(IREENA);
    expect((p.blocks[1] as { elementIds: string[] }).elementIds).toEqual([ISMARK, VALLAKI]);
    // The healed knower resolved (its name froze in); its id stays off the
    // wire because the knower is not itself included (S367 critic C12a).
    expect((p.blocks[2] as PayloadCircleBlock).title).toBe('the party');
    expect((p.blocks[2] as PayloadCircleBlock).knowerId).toBe('');
  });

  it('map block freezes: %-coords, pinned elements IDENTITY + description by default (B6); no-image maps drop entirely', () => {
    const MAP = 'm1000000-0000-0000-0000-000000000001';
    const PIN1 = 'pin10000-0000-0000-0000-000000000001';
    const PIN2 = 'pin20000-0000-0000-0000-000000000002';
    const elements: Element[] = [
      ...world(),
      { id: MAP, type: 'map', name: 'barovia', image_url: 'https://img.example/map.png',
        width: 1000, height: 500, local_updated_at: 't' } as unknown as Element,
      { id: PIN1, type: 'pin', map_id: MAP, element_id: IREENA, x: 250, y: 125, local_updated_at: 't' } as unknown as Element,
      { id: PIN2, type: 'pin', map_id: MAP, element_id: VALLAKI, x: 900, y: 450, local_updated_at: 't' } as unknown as Element,
    ];
    const page = makePage([
      { id: 'b1', kind: 'map', mapId: MAP, pinIds: [PIN1, PIN2] },
    ]);
    (page as unknown as Record<string, unknown>).atlas_page_refs = [MAP, PIN1, PIN2];
    const p = buildPagePayload(page, elements);
    const frozen = p.blocks[0] as { kind: string; title: string; image_url: string; showLabels?: boolean;
      pins: Array<{ xPct: number; yPct: number; name: string; ref?: string }> };
    expect(frozen.kind).toBe('map');
    expect(frozen.title).toBe('barovia');
    expect(frozen.image_url).toBe('https://img.example/map.png');
    expect(frozen.showLabels).toBeUndefined(); // absent = labels on
    // x: 250/1000 = 25%. y is stored BOTTOM-left (the schema's, S361) and the
    // payload's yPct is a TOP-left CSS %: (500-125)/500 = 75%, (500-450)/500 =
    // 10%. Pinned elements are included → ref.
    expect(frozen.pins[0]).toEqual({ xPct: 25, yPct: 75, name: 'Ireena', type: 'character', ref: IREENA });
    expect(frozen.pins[1]).toEqual({ xPct: 90, yPct: 10, name: 'Vallaki', type: 'location', ref: VALLAKI });
    // B6 (2026-07-03): pinned elements join `elements` as IDENTITY +
    // description (+ image) ONLY — a DM's other fields never leak from a
    // shared map without the per-pin full-profile opt-in.
    expect(Object.keys(p.elements).sort()).toEqual([IREENA, VALLAKI].sort());
    const ireena = p.elements[IREENA];
    expect(ireena.image_url).toBe('https://img.example/ireena.png');
    expect(ireena.fields.description).toBe('The burgomaster\'s daughter.');
    expect(ireena.fields.birthplace).toBeUndefined();
    expect(ireena.fields.friends).toBeUndefined();
    // Pin ids never reach the wire.
    expect(JSON.stringify(p)).not.toContain(PIN1);

    // fullPinIds opt-in: PIN1 ships Ireena's FULL populated fields; the
    // un-opted PIN2 stays identity + description.
    const pageFull = makePage([
      { id: 'b1', kind: 'map', mapId: MAP, pinIds: [PIN1, PIN2], fullPinIds: [PIN1] },
    ]);
    (pageFull as unknown as Record<string, unknown>).atlas_page_refs = [MAP, PIN1, PIN2];
    const pFull = buildPagePayload(pageFull, elements);
    const ireenaFull = pFull.elements[IREENA];
    expect(ireenaFull.fields.description).toBe('The burgomaster\'s daughter.');
    expect(tokens(ireenaFull.fields.birthplace)).toEqual([{ text: 'Vallaki', ref: VALLAKI }]);
    expect(tokens(ireenaFull.fields.friends)).toEqual([{ text: 'Ismark' }]);
    expect(pFull.elements[VALLAKI].fields.birthplace).toBeUndefined();

    // A separate card's disclosure UNIONS in — the map default never
    // downgrades a deliberate card choice.
    const pageCard = makePage([
      { id: 'b0', kind: 'element-card', elementId: IREENA, variant: 'full', fields: ['birthplace'] },
      { id: 'b1', kind: 'map', mapId: MAP, pinIds: [PIN1] },
    ]);
    (pageCard as unknown as Record<string, unknown>).atlas_page_refs = [IREENA, MAP, PIN1];
    const pCard = buildPagePayload(pageCard, elements);
    // Vallaki isn't included on THIS page → text-only token, no ref.
    expect(tokens(pCard.elements[IREENA].fields.birthplace)).toEqual([{ text: 'Vallaki' }]);
    expect(pCard.elements[IREENA].fields.description).toBe('The burgomaster\'s daughter.');
    expect(pCard.elements[IREENA].fields.friends).toBeUndefined();

    // showLabels: false survives the freeze.
    const pageNoLabels = makePage([
      { id: 'b1', kind: 'map', mapId: MAP, pinIds: [PIN1], showLabels: false },
    ]);
    (pageNoLabels as unknown as Record<string, unknown>).atlas_page_refs = [MAP, PIN1];
    const frozenNoLabels = buildPagePayload(pageNoLabels, elements).blocks[0] as { showLabels?: boolean };
    expect(frozenNoLabels.showLabels).toBe(false);

    // A map without image_url (local media only) drops from the payload.
    const noImg = elements.map(e => e.id === MAP
      ? ({ ...e, image_url: undefined } as unknown as Element) : e);
    const p2 = buildPagePayload(page, noImg);
    expect(p2.blocks.find(b => (b as { kind: string }).kind === 'map')).toBeUndefined();
  });

  it('fullPinIds heals alongside pinIds on id-swap (opt-in follows its pin)', () => {
    const MAP = 'm1000000-0000-0000-0000-000000000001';
    const PIN1 = 'pin10000-0000-0000-0000-000000000001';
    const elements: Element[] = [
      ...world(),
      { id: MAP, type: 'map', name: 'barovia', image_url: 'https://img.example/map.png',
        width: 1000, height: 500, local_updated_at: 't' } as unknown as Element,
      { id: PIN1, type: 'pin', map_id: MAP, element_id: IREENA, x: 250, y: 125, local_updated_at: 't' } as unknown as Element,
    ];
    // Nested block ids are STALE (pre-id-swap); the refs mirror is fresh.
    const page = makePage([
      { id: 'b1', kind: 'map', mapId: 'stale-map', pinIds: ['stale-pin'], fullPinIds: ['stale-pin'] },
    ]);
    (page as unknown as Record<string, unknown>).atlas_page_refs = [MAP, PIN1];
    const p = buildPagePayload(page, elements);
    // Full profile shipped → the fullPinIds entry followed its pin's heal.
    // (Vallaki isn't included on this page → text-only token.)
    expect(tokens(p.elements[IREENA].fields.birthplace)).toEqual([{ text: 'Vallaki' }]);
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

// ---- freezeMapBlock: published-image scheme guard (audit B-armor) -----------

describe('freezeMapBlock — image URL scheme guard', () => {
  const MAP = 'c1000000-0000-0000-0000-000000000001';
  const PIN = 'd1000000-0000-0000-0000-000000000001';

  function mapWorld(imageUrl: string, dims: { width?: number; height?: number } = { width: 1000, height: 800 }): Map<string, Element> {
    const els: Element[] = [
      { id: MAP, type: 'map', name: 'Barovia', image_url: imageUrl, ...dims, local_updated_at: '2026-06-07T00:00:00Z' } as unknown as Element,
      { id: PIN, type: 'pin', name: 'Vallaki pin', x: 500, y: 400, element_id: VALLAKI, local_updated_at: '2026-06-07T00:00:00Z' } as unknown as Element,
      { id: VALLAKI, type: 'location', name: 'Vallaki', local_updated_at: '2026-06-07T00:00:00Z' } as unknown as Element,
    ];
    return new Map(els.map(e => [e.id, e]));
  }

  const block: MapBlock = { id: 'blk1', kind: 'map', mapId: MAP, pinIds: [PIN] };

  it('freezes a map served over https, projecting pins to percentages', () => {
    const frozen = freezeMapBlock(block, mapWorld('https://img.example/barovia.png'), new Set());
    expect(frozen).not.toBeNull();
    expect(frozen!.image_url).toBe('https://img.example/barovia.png');
    expect(frozen!.pins).toHaveLength(1);
    expect(frozen!.pins[0].xPct).toBe(50);
    expect(frozen!.pins[0].yPct).toBe(50);
  });

  it('allows plain http too', () => {
    expect(freezeMapBlock(block, mapWorld('http://img.example/barovia.png'), new Set())).not.toBeNull();
  });

  it('drops a blob: image (local media never leaves the folder)', () => {
    expect(freezeMapBlock(block, mapWorld('blob:https://app/abc-123'), new Set())).toBeNull();
  });

  it('drops a data: URI image', () => {
    expect(freezeMapBlock(block, mapWorld('data:image/png;base64,AAAA'), new Set())).toBeNull();
  });

  it('drops a relative / scheme-less image path', () => {
    expect(freezeMapBlock(block, mapWorld('maps/barovia.png'), new Set())).toBeNull();
  });

  it('drops a map with no usable dimensions', () => {
    expect(freezeMapBlock(block, mapWorld('https://img.example/barovia.png', { width: 0, height: 0 }), new Set())).toBeNull();
  });
});
