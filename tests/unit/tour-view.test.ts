/**
 * The tour's world view + phase resolution — the pure kernel.
 *
 * These lock the decisions the S301 gate reshaped: prefix semantics over
 * last-match (R10), and full suspension when the tour's world is not the
 * active one (R4).
 */

import { describe, it, expect } from 'vitest';
import {
  buildTourWorldView,
  resolvePhase,
  canAdvance,
  hasAll,
  countPresent,
  type TourPhase,
  type TourWorldView,
} from '../../src/tour/tour-view';

const REFS: Record<string, string> = {
  'character:The Consul': 'id-consul',
  'institution:The Hegemony': 'id-hegemony',
  'object:Ebony Spaceship': 'id-ship',
  'object:Spaceship Balcony': 'id-balcony',
  "object:The Consul's Steinway": 'id-steinway',
};

function view(opts: {
  present?: string[];
  tourIsLive?: boolean;
  worldExists?: boolean;
  timeCurrent?: number | null;
  bundleLoaded?: boolean;
} = {}): TourWorldView {
  const present = opts.present ?? [];
  const elements = present.map(ref => ({
    id: REFS[ref], type: ref.slice(0, ref.indexOf(':')),
  }));
  return buildTourWorldView({
    elements,
    worldExists: opts.worldExists ?? true,
    tourIsLive: opts.tourIsLive ?? true,
    timeCurrent: opts.timeCurrent ?? null,
    refToId: (ref) => (opts.bundleLoaded === false ? undefined : REFS[ref]),
  });
}

const PHASES: TourPhase[] = [
  { id: 'a', body: 'click + to add the Hegemony' },
  { id: 'b', body: 'there it is', when: (w) => w.hasRef('institution:The Hegemony') },
  { id: 'c', body: 'and it links back to him', when: (w) => w.hasRef('character:The Consul') },
];

describe('buildTourWorldView', () => {
  it('reads presence by bundle ref', () => {
    const w = view({ present: ['institution:The Hegemony'] });
    expect(w.hasRef('institution:The Hegemony')).toBe(true);
    expect(w.hasRef('character:The Consul')).toBe(false);
  });

  it('counts by type', () => {
    const w = view({ present: ['object:Ebony Spaceship', 'object:Spaceship Balcony'] });
    expect(w.countOfType('object')).toBe(2);
    expect(w.countOfType('character')).toBe(0);
  });

  it('reads every ref as absent before the bundle chunk has loaded', () => {
    // The known bundle-load window: refToId returns undefined, so the opening
    // phase shows. That is why an opening phase must never claim a deed.
    const w = view({ present: ['institution:The Hegemony'], bundleLoaded: false });
    expect(w.hasRef('institution:The Hegemony')).toBe(false);
  });

  it('nowIsSet distinguishes an unset clock from year zero', () => {
    expect(view({ timeCurrent: null }).nowIsSet).toBe(false);
    expect(view({ timeCurrent: 0 }).nowIsSet).toBe(true);
  });
});

describe('resolvePhase — prefix semantics (gate R10)', () => {
  it('opens on the first phase when nothing is done', () => {
    expect(resolvePhase(PHASES, view()).id).toBe('a');
  });

  it('advances one phase per satisfied predicate, in order', () => {
    expect(resolvePhase(PHASES, view({ present: ['institution:The Hegemony'] })).id).toBe('b');
    expect(resolvePhase(PHASES, view({
      present: ['institution:The Hegemony', 'character:The Consul'],
    })).id).toBe('c');
  });

  it('STOPS at the first failed predicate rather than taking the last match', () => {
    // The bug prefix semantics exists to prevent: phase c's predicate holds,
    // but b's does not (the user deleted the Hegemony). Last-match would show
    // "and it links back to him" about a link that no longer exists.
    const w = view({ present: ['character:The Consul'] });
    expect(resolvePhase(PHASES, w).id).toBe('a');
  });

  it('a phase with no `when` after a gated one still requires the prefix', () => {
    const phases: TourPhase[] = [
      { id: 'a', body: 'a' },
      { id: 'b', body: 'b', when: (w) => w.hasRef('object:Ebony Spaceship') },
      { id: 'c', body: 'c' },
    ];
    expect(resolvePhase(phases, view()).id).toBe('a');
    expect(resolvePhase(phases, view({ present: ['object:Ebony Spaceship'] })).id).toBe('c');
  });

  it('throws on a step with no phases (an authoring error, not a runtime state)', () => {
    expect(() => resolvePhase([], view())).toThrow();
  });
});

describe('suspension when the tour world is not active (gate R4)', () => {
  it('holds the opening phase even when later predicates would pass', () => {
    // The user switched to their OWN world mid-tour. Their elements must not
    // be read as tour progress.
    const w = view({
      present: ['institution:The Hegemony', 'character:The Consul'],
      tourIsLive: false,
    });
    expect(resolvePhase(PHASES, w).id).toBe('a');
  });

  it('never allows advancing while suspended, even on an ungated phase', () => {
    const ungated: TourPhase = { id: 'a', body: 'a' };
    expect(canAdvance(ungated, view({ tourIsLive: true }))).toBe(true);
    expect(canAdvance(ungated, view({ tourIsLive: false }))).toBe(false);
  });
});

describe('canAdvance', () => {
  it('is open by default and closed until the gate passes', () => {
    const gated: TourPhase = {
      id: 'a', body: 'a',
      advanceWhen: hasAll(['object:Ebony Spaceship', 'object:Spaceship Balcony']),
    };
    expect(canAdvance(gated, view())).toBe(false);
    expect(canAdvance(gated, view({ present: ['object:Ebony Spaceship'] }))).toBe(false);
    expect(canAdvance(gated, view({
      present: ['object:Ebony Spaceship', 'object:Spaceship Balcony'],
    }))).toBe(true);
  });
});

describe('countPresent — the partial-progress signature term (gate R5)', () => {
  it('counts each minted ref so middle mints are visible to the renderer', () => {
    const refs = ['object:Ebony Spaceship', 'object:Spaceship Balcony', "object:The Consul's Steinway"];
    expect(countPresent(refs, view())).toBe(0);
    expect(countPresent(refs, view({ present: [refs[0]] }))).toBe(1);
    expect(countPresent(refs, view({ present: [refs[0], refs[1]] }))).toBe(2);
    expect(countPresent(refs, view({ present: refs }))).toBe(3);
  });
});

describe('pinInZone — the pin beat soft correction (S303 rework)', () => {
  // A unit-square zone [0,0]-[10,10] as four ordered markers, plus a pin. The
  // point-in-polygon math is ZoneGeometry's (tested there); this locks that the
  // view assembles the polygon from the right markers and reads the pin.
  const SQUARE = [
    { x: 0, y: 0, order: 0 }, { x: 10, y: 0, order: 1 },
    { x: 10, y: 10, order: 2 }, { x: 0, y: 10, order: 3 },
  ];
  function geoView(
    pin: { x?: number; y?: number } | null,
    markers: Array<{ x: number; y: number; order: number; zone_id?: string }>,
  ): TourWorldView {
    const elements: Array<{ id: string; type: string;[k: string]: unknown }> = [];
    if (pin) elements.push({ id: 'id-pin', type: 'pin', ...pin });
    markers.forEach((m, i) => elements.push({
      id: `m${i}`, type: 'marker', zone_id: m.zone_id ?? 'id-zone', x: m.x, y: m.y, order: m.order,
    }));
    return buildTourWorldView({
      elements, worldExists: true, tourIsLive: true, timeCurrent: null,
      refToId: (ref) => (ref === 'pin:seat' ? 'id-pin' : ref === 'zone:swamp' ? 'id-zone' : undefined),
    });
  }

  it('true when the pin sits inside the polygon', () => {
    expect(geoView({ x: 5, y: 5 }, SQUARE).pinInZone('pin:seat', 'zone:swamp')).toBe(true);
  });
  it('false when the pin sits outside the polygon', () => {
    expect(geoView({ x: 50, y: 50 }, SQUARE).pinInZone('pin:seat', 'zone:swamp')).toBe(false);
  });
  it('false when the pin is absent (nothing placed yet)', () => {
    expect(geoView(null, SQUARE).pinInZone('pin:seat', 'zone:swamp')).toBe(false);
  });
  it('false when the pin carries no coordinates', () => {
    expect(geoView({}, SQUARE).pinInZone('pin:seat', 'zone:swamp')).toBe(false);
  });
  it('false with fewer than three markers (no polygon)', () => {
    expect(geoView({ x: 5, y: 5 }, SQUARE.slice(0, 2)).pinInZone('pin:seat', 'zone:swamp')).toBe(false);
  });
  it('builds the polygon only from markers of THIS zone', () => {
    const foreign = SQUARE.map(m => ({ ...m, zone_id: 'some-other-zone' }));
    expect(geoView({ x: 5, y: 5 }, foreign).pinInZone('pin:seat', 'zone:swamp')).toBe(false);
  });
  it('false when either ref is unknown to the bundle', () => {
    expect(geoView({ x: 5, y: 5 }, SQUARE).pinInZone('pin:missing', 'zone:swamp')).toBe(false);
    expect(geoView({ x: 5, y: 5 }, SQUARE).pinInZone('pin:seat', 'zone:missing')).toBe(false);
  });
  it('scopes the polygon to the pin\'s own map (a zone spanning two maps stays honest)', () => {
    // Markers on a DIFFERENT map must not join the polygon — the renderer
    // filters by zone_id AND map_id, so pinInZone must too, or a multi-map zone
    // would test the pin against a shape drawn on no single map.
    const elements: Array<{ id: string; type: string;[k: string]: unknown }> = [
      { id: 'id-pin', type: 'pin', x: 5, y: 5, map_id: 'map-A' },
      // the real square, but on map-B (a different map than the pin)
      ...SQUARE.map((m, i) => ({ id: `mb${i}`, type: 'marker', zone_id: 'id-zone', map_id: 'map-B', x: m.x, y: m.y, order: m.order })),
    ];
    const w = buildTourWorldView({
      elements, worldExists: true, tourIsLive: true, timeCurrent: null,
      refToId: (ref) => (ref === 'pin:seat' ? 'id-pin' : ref === 'zone:swamp' ? 'id-zone' : undefined),
    });
    // The pin is geometrically inside the square, but the square is on another
    // map, so no markers match the pin's map → no polygon → false.
    expect(w.pinInZone('pin:seat', 'zone:swamp')).toBe(false);
  });

  it('respects marker order (a self-crossing order changes the polygon)', () => {
    // Swapping two vertices turns the square into a bow-tie; (5,5) — the square's
    // center — is no longer inside the crossed shape's filled lobes.
    const bowtie = [
      { x: 0, y: 0, order: 0 }, { x: 10, y: 10, order: 1 },
      { x: 10, y: 0, order: 2 }, { x: 0, y: 10, order: 3 },
    ];
    expect(geoView({ x: 5, y: 4 }, bowtie).pinInZone('pin:seat', 'zone:swamp')).toBe(false);
  });
});
