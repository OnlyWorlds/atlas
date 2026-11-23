/**
 * What a page shares, read before Publish (1.125.13): `pageShares` turns the
 * payload `buildPagePayload` returns, beside the page's own blocks, into one row
 * per element that sends a field or a picture, each split into the parts that
 * send it (a card, a pin on a map, a collection), with the block each part's
 * press opens. Field names, never labels: the room words them.
 *
 * The rule each case holds: a part lists only what its own block sends and the
 * payload holds; a field sent by two blocks is listed under both, so turning it
 * off in one visibly leaves it under the other; nothing the payload sends goes
 * unlisted.
 */
import { describe, it, expect } from 'vitest';
import { buildPagePayload, pageShares, pageSharesOf, type PageShares } from '../../src/core/share-payload';
import { blocksOf, pageRefsFor, type PageBlock } from '../../src/core/sharing';
import type { Element } from '../../src/core/types';
import type { ChartConfig } from '../../src/visualization/timeline/types';

const ASH = 'a1000000-0000-0000-0000-000000000001';
const BRAM = 'a2000000-0000-0000-0000-000000000002';
const CORA = 'a3000000-0000-0000-0000-000000000003';
const TOWN = 'b1000000-0000-0000-0000-000000000001';
const HID = 'h1000000-0000-0000-0000-000000000001';
const MAP = 'm1000000-0000-0000-0000-000000000001';
const MAP2 = 'm2000000-0000-0000-0000-000000000002';
const PIN_ASH = 'p1000000-0000-0000-0000-000000000001';
const PIN_ASH2 = 'p1000000-0000-0000-0000-000000000002';
const PIN_BRAM = 'p2000000-0000-0000-0000-000000000001';
const CIRCLE = 'c1000000-0000-0000-0000-000000000001';
const EMPTY_CIRCLE = 'c2000000-0000-0000-0000-000000000002';
const ENTRY = 'e1000000-0000-0000-0000-000000000001';
const GONE = 'dead0000-0000-0000-0000-000000000000';

function world(): Element[] {
  return [
    { id: ASH, type: 'character', name: 'Ash', description: 'A quiet smith.', x_mood: 'SECRET',
      physicality: '', image_url: 'https://img.example/ash.png', birthplace: TOWN, friends: [BRAM, GONE] },
    { id: BRAM, type: 'character', name: 'Bram', description: 'The miller.' },
    { id: CORA, type: 'character', name: 'Cora' },
    { id: TOWN, type: 'location', name: 'Dampworth', description: 'A wet town.' },
    { id: HID, type: 'character', name: 'Hidden one', description: 'Not for anyone.', hidden: true },
    { id: MAP, type: 'map', name: 'Realm', image_url: 'https://img.example/realm.png', width: 100, height: 100 },
    { id: MAP2, type: 'map', name: 'Coast', image_url: 'https://img.example/coast.png', width: 100, height: 100 },
    { id: PIN_ASH, type: 'pin', name: 'p', map_id: MAP, element_id: ASH, x: 10, y: 10 },
    { id: PIN_ASH2, type: 'pin', name: 'p', map_id: MAP2, element_id: ASH, x: 20, y: 20 },
    { id: PIN_BRAM, type: 'pin', name: 'p', map_id: MAP, element_id: BRAM, x: 30, y: 30 },
    { id: CIRCLE, type: 'collective', name: 'The party', subtype: 'circle' },
    { id: EMPTY_CIRCLE, type: 'collective', name: 'Nobody', subtype: 'circle' },
    { id: ENTRY, type: 'narrative', name: 'The mists', subtype: 'knowledge', story: 'They never lift.', collectives: [CIRCLE] },
  ] as unknown as Element[];
}

function pageOf(blocks: PageBlock[]): Element {
  return {
    id: 'pg000000-0000-0000-0000-000000000001', type: 'narrative', name: 'Primer', subtype: 'page',
    atlas_page_blocks: blocks, atlas_page_refs: pageRefsFor(blocks),
  } as unknown as Element;
}

function sharesOf(blocks: PageBlock[], elements: Element[] = world(), charts: ChartConfig[] = []): PageShares {
  return pageSharesOf(pageOf(blocks), elements, charts);
}

const card = (id: string, elementId: string, fields: string[], extra: Partial<PageBlock> = {}): PageBlock =>
  ({ id, kind: 'element-card', elementId, variant: 'full', fields, ...extra }) as PageBlock;
const compact = (id: string, elementId: string, extra: Partial<PageBlock> = {}): PageBlock =>
  ({ id, kind: 'element-card', elementId, variant: 'compact', fields: [], ...extra }) as PageBlock;

/** Every field and picture the payload sends is listed in some part, and no part lists what is not sent. */
function expectNothingUnlisted(blocks: PageBlock[], elements: Element[] = world()): void {
  const page = pageOf(blocks);
  const payload = buildPagePayload(page, elements);
  const shares = pageShares(payload, blocksOf(page), elements);
  for (const [id, entry] of Object.entries(payload.elements)) {
    const row = shares.rows.find(r => r.elementId === id);
    const sendsSomething = Object.keys(entry.fields).length > 0 || entry.image_url !== undefined;
    if (!sendsSomething) {
      expect(row).toBeUndefined();
      continue;
    }
    expect(row, `a row for ${entry.name}`).toBeDefined();
    const listed = new Set(row!.parts.flatMap(p => p.fields));
    for (const f of Object.keys(entry.fields)) expect(listed.has(f), `${entry.name}.${f} is listed`).toBe(true);
    for (const p of row!.parts) {
      for (const f of p.fields) expect(f in entry.fields, `${entry.name}.${f} is sent`).toBe(true);
      expect(p.fields.length > 0 || p.picture, 'a part lists something').toBe(true);
      if (p.picture) expect(entry.image_url).toBeDefined();
    }
    if (entry.image_url !== undefined) expect(row!.parts.some(p => p.picture)).toBe(true);
    expect(row!.also).toEqual([]);
  }
}

describe('pageShares: one row per element that sends a field or a picture', () => {
  it('a full card with the default description: a card part with Description and its picture', () => {
    const s = sharesOf([card('k1', ASH, ['description'])]);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ elementId: ASH, name: 'Ash', type: 'character' });
    expect(s.rows[0].parts).toEqual([{ kind: 'card', blockId: 'k1', fields: ['description'], picture: true }]);
    expect(s.nameOnly).toEqual([]);
  });

  it('a full card with two fields, one empty: only the filled one is listed', () => {
    const s = sharesOf([card('k1', ASH, ['physicality', 'description'], { showImage: false } as Partial<PageBlock>)]);
    expect(s.rows[0].parts).toEqual([{ kind: 'card', blockId: 'k1', fields: ['description'], picture: false }]);
  });

  it('a compact card is a part only for its picture; without one, the element is name and kind only', () => {
    const withPic = sharesOf([compact('k1', ASH)]);
    expect(withPic.rows[0].parts).toEqual([{ kind: 'card', blockId: 'k1', fields: [], picture: true }]);
    const noPic = sharesOf([compact('k1', BRAM)]);
    expect(noPic.rows).toEqual([]);
    expect(noPic.nameOnly).toEqual(['Bram']);
    const pictureOff = sharesOf([compact('k1', ASH, { showImage: false } as Partial<PageBlock>)]);
    expect(pictureOff.rows).toEqual([]);
    expect(pictureOff.nameOnly).toEqual(['Ash']);
  });

  it("a hidden element's card has no row and is not counted", () => {
    const s = sharesOf([card('k1', HID, ['description']), card('k2', GONE, ['description'])]);
    expect(s.rows).toEqual([]);
    expect(s.nameOnly).toEqual([]);
  });

  it('description unticked on the card and pinned on a map: Description is under the pin part, not the card part', () => {
    const blocks: PageBlock[] = [
      card('k1', ASH, ['birthplace']),
      { id: 'mb', kind: 'map', mapId: MAP, pinIds: [PIN_ASH] },
    ];
    const s = sharesOf(blocks);
    const ash = s.rows.find(r => r.elementId === ASH)!;
    expect(ash.parts).toEqual([
      { kind: 'card', blockId: 'k1', fields: ['birthplace'], picture: true },
      { kind: 'map', blockId: 'mb', fields: ['description'], picture: true, mapTitle: 'Realm', pinIds: [PIN_ASH] },
    ]);
    expectNothingUnlisted(blocks);
  });

  it('description ticked on the card and pinned: listed under both, so unticking it on the card still shows it sent', () => {
    const blocks: PageBlock[] = [
      card('k1', ASH, ['description']),
      { id: 'mb', kind: 'map', mapId: MAP, pinIds: [PIN_ASH] },
    ];
    const ash = sharesOf(blocks).rows.find(r => r.elementId === ASH)!;
    expect(ash.parts.map(p => [p.kind, p.fields])).toEqual([['card', ['description']], ['map', ['description']]]);
  });

  it("a full pin's element: a field no card ticks is listed under that pin's map part", () => {
    const blocks: PageBlock[] = [
      card('k1', ASH, ['description']),
      { id: 'mb', kind: 'map', mapId: MAP, pinIds: [PIN_ASH], fullPinIds: [PIN_ASH] },
    ];
    const ash = sharesOf(blocks).rows.find(r => r.elementId === ASH)!;
    const pin = ash.parts.find(p => p.kind === 'map')!;
    expect(pin.fields).toEqual(['description', 'x_mood', 'birthplace', 'friends']);
    expect(ash.parts.find(p => p.kind === 'card')!.fields).toEqual(['description']);
    expectNothingUnlisted(blocks);
  });

  it('pinned on two maps, one pin full: each map part lists what its own pin sends', () => {
    const blocks: PageBlock[] = [
      { id: 'm1', kind: 'map', mapId: MAP, pinIds: [PIN_ASH] },
      { id: 'm2', kind: 'map', mapId: MAP2, pinIds: [PIN_ASH2], fullPinIds: [PIN_ASH2] },
    ];
    const ash = sharesOf(blocks).rows.find(r => r.elementId === ASH)!;
    expect(ash.parts.map(p => [p.blockId, p.mapTitle, p.fields])).toEqual([
      ['m1', 'Realm', ['description']],
      ['m2', 'Coast', ['description', 'x_mood', 'birthplace', 'friends']],
    ]);
    expectNothingUnlisted(blocks);
  });

  it('a second card of one element is its own part, with its own fields', () => {
    const blocks = [card('k1', ASH, ['description']), card('k2', ASH, ['x_mood'], { showImage: false } as Partial<PageBlock>)];
    const ash = sharesOf(blocks).rows[0];
    expect(ash.parts).toEqual([
      { kind: 'card', blockId: 'k1', fields: ['description'], picture: true },
      { kind: 'card', blockId: 'k2', fields: ['x_mood'], picture: false },
    ]);
    expectNothingUnlisted(blocks);
  });

  it('a collection member with a picture is a row, with a collection part; one without is name and kind only', () => {
    const blocks: PageBlock[] = [{ id: 'col', kind: 'collection', elementIds: [CORA, ASH, GONE] }];
    const s = sharesOf(blocks);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].elementId).toBe(ASH);
    expect(s.rows[0].parts).toEqual([{ kind: 'collection', blockId: 'col', fields: [], picture: true }]);
    expect(s.nameOnly).toEqual(['Cora']);
    expectNothingUnlisted(blocks);
  });

  it('a card with its picture off and the same element in a collection: the collection part names the picture', () => {
    const blocks: PageBlock[] = [
      card('k1', ASH, ['description'], { showImage: false } as Partial<PageBlock>),
      { id: 'col', kind: 'collection', elementIds: [ASH] },
    ];
    const ash = sharesOf(blocks).rows[0];
    expect(ash.parts).toEqual([
      { kind: 'card', blockId: 'k1', fields: ['description'], picture: false },
      { kind: 'collection', blockId: 'col', fields: [], picture: true },
    ]);
  });

  it('rows come in the order each element first appears on the page', () => {
    const blocks: PageBlock[] = [
      { id: 'mb', kind: 'map', mapId: MAP, pinIds: [PIN_BRAM, PIN_ASH] },
      card('k1', ASH, ['description']),
    ];
    expect(sharesOf(blocks).rows.map(r => r.name)).toEqual(['Bram', 'Ash']);
  });

  it('a pin on a map that does not show sends nothing, so it has no part', () => {
    const noImage = world().map(e => e.id === MAP ? ({ ...e, image_url: undefined } as unknown as Element) : e);
    const s = sharesOf([{ id: 'mb', kind: 'map', mapId: MAP, pinIds: [PIN_ASH] }], noImage);
    expect(s.rows).toEqual([]);
    expect(s.nameOnly).toEqual([]);
    expect(s.clauses.maps).toBe(false);
  });

  it('a page of 40 cards that share only a name: no rows, the 40 names in one summary', () => {
    const many: Element[] = Array.from({ length: 40 }, (_, i) => ({
      id: `n${String(i).padStart(7, '0')}-0000-0000-0000-000000000000`, type: 'character', name: `Person ${i + 1}`,
    }) as unknown as Element);
    const blocks = many.map((e, i) => compact(`k${i}`, e.id));
    const s = sharesOf(blocks, many);
    expect(s.rows).toEqual([]);
    expect(s.nameOnly).toHaveLength(40);
    expect(s.nameOnly.slice(0, 3)).toEqual(['Person 1', 'Person 2', 'Person 3']);
  });
});

describe('pageShares: what else goes out, each clause only with its carrier', () => {
  const none = { maps: false, links: false, linksOffPage: false, charts: false, circles: [] };

  it('a page of cards with no link field says nothing else', () => {
    expect(sharesOf([card('k1', ASH, ['description'])]).clauses).toEqual(none);
  });

  it('a map block that shows', () => {
    expect(sharesOf([{ id: 'mb', kind: 'map', mapId: MAP, pinIds: [] }]).clauses.maps).toBe(true);
  });

  it('a link token with a ref only: links, not off the page', () => {
    const c = sharesOf([card('k1', ASH, ['friends']), compact('k2', BRAM)]).clauses;
    expect(c.links).toBe(true);
    expect(c.linksOffPage).toBe(false);
  });

  it('a link token with no ref: links, also elements not on the page', () => {
    const c = sharesOf([card('k1', ASH, ['birthplace'])]).clauses;
    expect(c).toMatchObject({ links: true, linksOffPage: true });
  });

  it('a link sent by a full pin with nothing ticked counts too', () => {
    const c = sharesOf([{ id: 'mb', kind: 'map', mapId: MAP, pinIds: [PIN_ASH], fullPinIds: [PIN_ASH] }]).clauses;
    expect(c).toMatchObject({ maps: true, links: true, linksOffPage: true });
  });

  it('a chart block', () => {
    const chart = { schema_version: 1, id: 'ch1', name: 'Years', axis: { kind: 'time', direction: 'both' },
      scope: { kind: 'all' }, render: '2d' } as ChartConfig;
    expect(sharesOf([{ id: 'cb', kind: 'chart', chartId: 'ch1' }], world(), [chart]).clauses.charts).toBe(true);
    expect(sharesOf([{ id: 'cb', kind: 'chart', chartId: 'ch1' }], world(), []).clauses.charts).toBe(false);
  });

  it('a circle with entries names its knower and the count; an empty circle and a missing knower add nothing', () => {
    const c = sharesOf([
      { id: 'c1', kind: 'circle', knowerId: CIRCLE },
      { id: 'c2', kind: 'circle', knowerId: EMPTY_CIRCLE },
      { id: 'c3', kind: 'circle', knowerId: GONE },
    ]).clauses;
    expect(c.circles).toEqual([{ knower: 'The party', entries: 1 }]);
  });
});
