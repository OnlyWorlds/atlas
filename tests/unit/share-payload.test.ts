/**
 * buildPagePayload — the §5 publish payload builder (SHARING_CONTRACT.md v0.2).
 *
 * Locks the wire shape the backend stores and the viewer renders:
 * schema_version, the disclosure token encoding (ref ONLY when the target is
 * itself included), chosen-fields-only projection, richtextJson stripping,
 * and the dangling-ref drop rule.
 */

import { describe, it, expect } from 'vitest';
import { buildPagePayload, freezeMapBlock, scrubMarkdownForPayload, type RelationToken, type PayloadCircleBlock } from '../../src/core/share-payload';
import type { MapBlock } from '../../src/core/sharing';
import type { Element } from '../../src/core/types';
import addressFixture from '../fixtures/address.fixture.json';

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
    // a bare hand-typed URI goes, and never becomes the element's name (1.124.2).
    expect(prose.markdown).toBe(`[Ireena](ow://character/${IREENA}) hides from Vallaki. See  too.`);
    // The payload JSON itself must not carry the undisclosed uuid anywhere.
    expect(JSON.stringify(p)).not.toContain(VALLAKI);
  });

  // The scrub reads wider than the address rules: every address the SDK reads,
  // and every loose run of an address prefix in any case holding an id not on
  // the page (1.124.2). A dropped link becomes its label; a bare one, nothing.
  describe('the scrub leaves out every link it does not show', () => {
    const A = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a71'; // on the page
    const S = '0193a1c2-7d3e-7f00-8a11-3c5e7b9d2f40'; // in the world, not on the page
    const W = '0193aaaa-7d3e-7f00-8a11-3c5e7b9d2f40'; // a world
    const byId = new Map<string, Element>([
      [A, { id: A, name: 'Alice', type: 'character' } as unknown as Element],
      [S, { id: S, name: 'Secret Sam', type: 'character' } as unknown as Element],
    ]);
    const scrub = (md: string): string => scrubMarkdownForPayload(md, new Set([A]), byId);
    const leaks = (out: string): boolean => out.toLowerCase().includes(S) || out.includes('Secret Sam');
    const FORMS: Array<[string, string]> = [
      ['the text form', `x ow://character/${S} y`],
      ['a type word in capitals', `x ow://Character/${S} y`],
      ['the prefix in capitals', `x OW://character/${S} y`],
      ['an unknown type word', `x ow://characters/${S} y`],
      ['an id in capitals', `x ow://character/${S.toUpperCase()} y`],
      ["the site's form", `x https://www.onlyworlds.com/w/${W}/character/${S} y`],
      ["the site's form in capitals", `x HTTPS://www.onlyworlds.com/w/${W}/character/${S} y`],
      ["the site's form without www", `x https://onlyworlds.com/w/${W}/character/${S} y`],
      ['the text form with a world', `x ow://${W}/character/${S} y`],
      ['a moment', `x [m](ow://character/${S}@12) y`],
      ['a lens not on the page', `x [m](ow://character/${A}?lens=${S}) y`],
      ['a lens key in capitals', `x [m](ow://character/${A}?LENS=${S}) y`],
      ['a lens after a moment', `x [m](ow://character/${A}@3?lens=${S}) y`],
      ['a lens as a second key', `x [m](ow://character/${A}?a=b&lens=${S}) y`],
      ['a label with ]', `x [a]b](ow://character/${S}) y`],
      ['a label with nested brackets', `x [a [b] c](ow://character/${S}) y`],
      ['a title', `x [lbl](ow://character/${S} "t") y`],
      ['an href in angle brackets', `x [lbl](<ow://character/${S}>) y`],
      ['two addresses with no space', `x ow://character/${S}ow://character/${S} y`],
      ['one on the page and one not, no space', `x ow://character/${A}ow://character/${S} y`],
      ['a code span', 'x `ow://character/' + S + '` y'],
      ['letters after the id', `x ow://character/${S}x y`],
      ['a reference-style link', `x [lbl][r]\n\n[r]: ow://character/${S}\n`],
      ['an html anchor', `x <a href="ow://character/${S}">l</a> y`],
      ['a percent-encoded slash', `x ow://character%2F${S} y`],
      ['an address in a label', `x [ow://character/${S}](ow://character/${A}) y`],
      ['an address in a label, prose around it', `x [see ow://character/${S} now](ow://character/${A}) y`],
      ['a query after', `[a](ow://character/${S}?x=1)`],
      ['a fragment after', `[a](ow://character/${S}#frag)`],
      ["another world's element", `https://www.onlyworlds.com/w/${W}/character/11111111-2222-7333-8444-555555555555`],
    ];
    for (const [label, md] of FORMS) {
      it(`${label}: no id and no name off the page`, () => {
        const out = scrub(md);
        expect(leaks(out), out).toBe(false);
        expect(out).not.toContain('11111111-2222');
      });
    }
    it('a dropped link becomes its label, never the name; a bare address becomes nothing', () => {
      expect(scrub(`x [her](ow://Character/${S}) y`)).toBe('x her y');
      expect(scrub(`x [m](ow://character/${A}?a=b&lens=${S}) y`)).toBe('x m y');
      expect(scrub(`x ow://character/${S} y`)).toBe('x  y');
      expect(scrub(`x [lbl](ow://character/${S} "t") y`)).toBe('x lbl y');
      expect(scrub(`x [lbl](<ow://character/${S}>) y`)).toBe('x lbl y');
    });
    // The second gate's cases: every form leaks nothing, the known limits aside (DESIGN_WRITING #48:
    // an id spelled with zero-width characters, full-width hyphens or percent-encoding names nothing).
    const W2 = '0193aaaa-7d3e-7f00-8a11-3c5e7b9d2f40';
    const strip = (x: string): string => x.toLowerCase().replace(/[^0-9a-f]/g, '');
    const leaks2 = (out: string): boolean => [S, W2].some(x => strip(out).includes(strip(x).slice(0, 28))) || out.includes('Secret Sam');
    const FORMS_2: Array<[string, string, string?]> = [
      ['the site form over http', `x http://www.onlyworlds.com/w/${W2}/character/${S} y`],
      ['the site form with no scheme', `x www.onlyworlds.com/w/${W2}/character/${S} y`],
      ['the site form with no scheme or www', `x onlyworlds.com/w/${W2}/character/${S} y`],
      ['the site form in an autolink', `x <https://www.onlyworlds.com/w/${W2}/character/${S}> y`],
      ['a fenced code block', 'x\n```\now://character/' + S + '\n```\ny'],
      ['a title in single quotes', `x [lbl](ow://character/${S} 't') y`, 'x lbl y'],
      ['a title in brackets', `x [lbl](ow://character/${S} (t)) y`, 'x lbl y'],
      ['an angle href with a space', `x [lbl](<ow://character/${S} >) y`, 'x lbl y'],
      ['a label with ]', `x [a]b](ow://character/${S}) y`, 'x a]b y'],
      ['a label with nested brackets', `x [a [b] c](ow://character/${S}) y`, 'x a [b] c y'],
      ['an image', `x ![pic](ow://character/${S}) y`],
      ['a run ending in )', `x (see ow://character/${S}) y`],
      ['an html anchor in single quotes', `x <a href='ow://character/${S}'>l</a> y`],
      ['a reference-style link with a title', `x [lbl][r]\n\n[r]: <ow://character/${S}> "T"\n`],
      ['on the page and not, one run, a comma', `x ow://character/${A},ow://character/${S} y`],
      ['on the page and not, one run, a slash', `x [Alice](ow://character/${A}/${S}) y`],
      ['a lens held in capitals', `x [m](ow://character/${A}?lens=${S.toUpperCase()}) y`],
      ["glued after a site address's slug", `x https://www.onlyworlds.com/w/my-worldow://character/${S} y`],
      ["inside a site address's slug run, after a digit", `x https://www.onlyworlds.com/w/abc3ow://character/${S} y`],
      ['an escaped bracket in the label', `x [a\\]b](ow://character/${S}) y`],
      ["the world's own text form", `x [The World](ow://${W2}) y`],
      ["the world's own site link", `x [The World](https://www.onlyworlds.com/w/${W2}) y`],
      ['on the page, a run ending ).', `x [Alice](ow://character/${A}). y`, `x [Alice](ow://character/${A}). y`],
      ['on the page, a run ending ,', `x ow://character/${A}, y`, `x ow://character/${A}, y`],
      ['on the page, a run ending ]', `x [see ow://character/${A}] y`, `x [see ow://character/${A}] y`],
      ['on the page, in quotes', `x "ow://character/${A}" y`, `x "ow://character/${A}" y`],
      ['on the page, in a code span', 'x `ow://character/' + A + '` y', 'x `ow://character/' + A + '` y'],
      ['on the page, an angle href', `x [a](<ow://character/${A}>) y`, `x [a](<ow://character/${A}>) y`],
      ['on the page, a title', `x [a](ow://character/${A} "t") y`, `x [a](ow://character/${A} "t") y`],
    ];
    for (const [label, md, want] of FORMS_2) {
      it(`${label}: nothing off the page ships${want !== undefined ? ', and the text is exact' : ''}`, () => {
        const out = scrub(md);
        expect(leaks2(out), out).toBe(false);
        if (want !== undefined) expect(out).toBe(want);
      });
    }

    // Serial 127: an address glued to a word before it is prose, so the address reader no longer finds
    // it; the wide pass still reads its run from the same index, so the scrub's text is what it was.
    describe('an address glued to a word before it is still scrubbed, the text as before', () => {
      const glued = (addressFixture.cases as unknown as Array<{ name: string; text: string; index: number; index_utf16?: number }>);
      const ROWS: Array<[string, (text: string, at: number) => string]> = [
        ['prose-start-glued-letter', (t, at) => t.slice(0, at) + '.'],
        ['prose-start-glued-underscore', (t, at) => t.slice(0, at) + ' here'],
        ['prose-start-glued-non-ascii-letter', (t, at) => t.slice(0, at)],
        ['prose-start-glued-combining-mark', (t, at) => t.slice(0, at)],
        ['prose-start-glued-astral-letter', (t, at) => t.slice(0, at)],
        ['prose-start-glued-letter-site-form', (t, at) => t.slice(0, at)],
        // One run from the first address on: both ids go, the full stop stays.
        ['prose-back-to-back-after-hex-letter', () => '.'],
      ];
      for (const [name, want] of ROWS) {
        it(name, () => {
          const c = glued.find(x => x.name === name)!;
          const out = scrub(c.text);
          expect(out).toBe(want(c.text, c.index_utf16 ?? c.index));
          expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
        });
      }
    });

    // A world holding two elements whose ids differ only in case, the capitals one off the page: the wide pass
    // reads each id as written by the one rule (`namedId`), so the capitals id is never taken for its twin.
    describe('an id in capitals off the page, its lowercase twin on it', () => {
      const LOW = '01a1d4ef-0000-7000-8000-00000000008a';
      const UP = LOW.toUpperCase();
      const twins = new Map<string, Element>([
        [LOW, { id: LOW, name: 'Gate', type: 'object' } as unknown as Element],
        [UP, { id: UP, name: 'Hidden Gate', type: 'object' } as unknown as Element],
      ]);
      const scrubTwins = (md: string): string => scrubMarkdownForPayload(md, new Set([LOW]), twins);
      const SHAPES: Array<[string, string, string]> = [
        ['glued to a letter before it', `Built xow://object/${UP} today`, 'Built x today'],
        ['a type word in capitals', `Built ow://Object/${UP} today`, 'Built  today'],
        ['the prefix in capitals', `Built OW://object/${UP} today`, 'Built  today'],
      ];
      for (const [label, md, want] of SHAPES) {
        it(`${label}: the capitals id does not ship`, () => {
          expect(scrubTwins(md)).toBe(want);
        });
      }
      it('the twin on the page, as written, is kept', () => {
        const md = `Built ow://object/${LOW} and ow://Object/${LOW} today`;
        expect(scrubTwins(md)).toBe(md);
      });
    });

    it('what is on the page is kept, byte for byte', () => {
      const md = `x [Alice](ow://character/${A}) and ow://character/${A}@4 and [L](ow://character/${A}?lens=${A}) [U](ow://character/${A.toUpperCase()}) y`;
      expect(scrub(md)).toBe(md);
    });
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

  it('card field text ships no ow:// link (full-card story and pinned description)', () => {
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
    expect(p.elements[SCENE].fields.story).toBe('The courier met Ireena near .');
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

  it('a circle block ships the knower id only when the knower is included', () => {
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
    // wire because the knower is not itself included.
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
    // x: 250/1000 = 25%. y is stored BOTTOM-left (the schema's) and the
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
