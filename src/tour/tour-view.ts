/**
 * The tour's view of the world, and phase resolution over it.
 *
 * DELIBERATELY STORE-FREE AND DOM-FREE: everything here is a pure function of
 * a plain snapshot, so the predicates that decide what the narrator says can
 * be unit-tested without a browser, a store, or a tour. Lifts verbatim.
 *
 * WHY DERIVED, NOT STORED (the load-bearing decision): a phase like
 * "the Hegemony now exists" is a FACT ABOUT THE WORLD. Storing a phase index
 * beside the step index would create a second source of truth that can
 * disagree with the world after a reload, a back-navigation, or the user
 * deleting the element — and the tour already heals the world on every
 * step-enter, so a derived phase composes with that for free and a stored one
 * would have to be reconciled against it.
 *
 * PREFIX SEMANTICS (gate R10): the winning phase is the last one whose `when`
 * holds AND all earlier phases' `when` also hold. "Last match wins" alone
 * picks a contradictory phase when the user deletes something mid-step: with
 * phases a/b(ship exists)/c(steinway exists), deleting the ship after minting
 * all three would keep showing c's "all three are here" copy. Prefix reading
 * is also how an author writes phases: top to bottom, each one further along.
 *
 * SUSPENSION (gate R4): when the tour's world is not the ACTIVE world, every
 * predicate would read someone else's world — collapsing the narration to
 * phase A ("create the Hegemony") while the user looks at their own novel, or
 * worse, resolving TRUE against foreign data and claiming a deed they never
 * did. `tourIsLive` false suspends resolution entirely.
 */

import type { ElementType } from '../core/types';
import { pointInPolygon } from '../visualization/leaflet-2d/ZoneGeometry';

/** The snapshot phase predicates read. Built by the caller from app state. */
export interface TourWorldView {
  /** The tour's own world exists in the registry. */
  worldExists: boolean;
  /**
   * The tour's world is the ACTIVE one. False after a mid-tour world switch
   * and during teardown: predicates must not speak about a foreign world.
   */
  tourIsLive: boolean;
  /** A bundle ref ("institution:The Hegemony") is present on disk. */
  hasRef(ref: string): boolean;
  /** How many elements of a type the tour world holds. */
  countOfType(type: ElementType): number;
  /** The world's clock has a `time_current` (the charts act's now-line beat). */
  nowIsSet: boolean;
  /**
   * The pin `pinRef` sits INSIDE the polygon of zone `zoneRef` — the pin
   * beat's soft correction (Titus's ruling: allow any placement, show Next
   * only once the pin is over the swamps, and let a wrong drop be dragged onto
   * them rather than refused). False if either ref is absent, the pin has no
   * coordinates, or the zone has fewer than three markers. Pure over the
   * snapshot's geometry (the point-in-polygon math is ZoneGeometry's, unit
   * tested there); this only assembles the polygon and reads the pin.
   */
  pinInZone(pinRef: string, zoneRef: string): boolean;
  /**
   * How many `ow://` chips the narrative `ref` currently holds in its `story`
   * markdown — the writing beat's gate.
   *
   * Reads `story` and NOT the `atlas_richtext_json` sidecar because the
   * workspace autosave writes BOTH halves together (writing-workspace.ts:344),
   * and `story` is the half the bundle bakes. 0 when the ref is absent or its
   * story is empty.
   */
  chipCount(ref: string): number;
}

export interface TourPhase {
  /** 'a' | 'b' | 'c' — stamped as data-tour-phase; the "4b" shorthand. */
  id: string;
  body: string;
  meta?: string;
  deeper?: string;
  /** On a touch screen, in place of `body` / `deeper` where those name a mouse or key gesture (#279). */
  touchBody?: string;
  touchDeeper?: string;
  /** This phase applies when true. Absent = always (the opening phase). */
  when?: (w: TourWorldView) => boolean;
  /** Next renders only when true. Absent = always advanceable. */
  advanceWhen?: (w: TourWorldView) => boolean;
}

/** A phase's body and deeper text for this pointer: the touch lines on a touch screen, when the phase has them. */
export function phaseCopy(phase: TourPhase, touch: boolean): { body: string; deeper?: string } {
  if (!touch) return { body: phase.body, deeper: phase.deeper };
  return { body: phase.touchBody ?? phase.body, deeper: phase.touchDeeper ?? phase.deeper };
}

/**
 * The phase a step is in, given the world. Prefix semantics: walk the phases
 * in order and stop at the first one whose `when` fails.
 *
 * Suspended (`tourIsLive` false) → always the opening phase, because the
 * predicates cannot see the tour's world to say anything truer.
 */
export function resolvePhase(phases: readonly TourPhase[], w: TourWorldView): TourPhase {
  if (phases.length === 0) {
    throw new Error('[tour] a step must declare at least one phase');
  }
  if (!w.tourIsLive) return phases[0];
  let winner = phases[0];
  for (let i = 1; i < phases.length; i++) {
    const phase = phases[i];
    if (phase.when && !phase.when(w)) break;
    winner = phase;
  }
  return winner;
}

/**
 * Whether the forward control should render for this step.
 *
 * Suspended → never: a user looking at their own world must not be able to
 * advance the tour past a beat they have not performed (and the narrator is
 * showing the opening phase's copy, which would be advancing on a lie).
 */
export function canAdvance(phase: TourPhase, w: TourWorldView): boolean {
  if (!w.tourIsLive) return false;
  return phase.advanceWhen ? phase.advanceWhen(w) : true;
}

/**
 * Build the view from a plain snapshot. `refToId` resolves bundle refs and
 * returns undefined before the bundle chunk has loaded — every `hasRef` then
 * reads false, which is why the opening phase must never claim a deed (the
 * bundle-load window, upheld by the gate as a real but benign flash).
 */
export function buildTourWorldView(input: {
  // Widened from {id, type} to carry the pin/marker geometry `pinInZone`
  // needs. Element[] is assignable via its index signature; every geometry
  // read below is typeof-guarded because those fields arrive as `unknown`.
  elements: ReadonlyArray<{ id: string; type: string;[k: string]: unknown }>;
  worldExists: boolean;
  tourIsLive: boolean;
  timeCurrent?: number | null;
  refToId: (ref: string) => string | undefined;
}): TourWorldView {
  const ids = new Set(input.elements.map(e => e.id));
  const byType = new Map<string, number>();
  for (const el of input.elements) {
    byType.set(el.type, (byType.get(el.type) ?? 0) + 1);
  }
  return {
    worldExists: input.worldExists,
    tourIsLive: input.tourIsLive,
    hasRef(ref) {
      const id = input.refToId(ref);
      return id !== undefined && ids.has(id);
    },
    countOfType(type) {
      return byType.get(type) ?? 0;
    },
    nowIsSet: input.timeCurrent != null,
    pinInZone(pinRef, zoneRef) {
      const pinId = input.refToId(pinRef);
      const zoneId = input.refToId(zoneRef);
      if (!pinId || !zoneId) return false;
      const pin = input.elements.find(e => e.id === pinId && e.type === 'pin');
      if (!pin || typeof pin.x !== 'number' || typeof pin.y !== 'number') return false;
      // A zone's geometry is its markers (zone_id → the zone), ordered by
      // `order`. Scope to the pin's OWN map (map_id) — the same filter the
      // renderer uses (markersForZoneOnMap): a zone whose markers span two maps
      // would otherwise mix coordinate spaces into a polygon that matches no
      // drawn shape. Fewer than three markers cannot enclose anything.
      const markers = input.elements
        .filter(e => e.type === 'marker' && e.zone_id === zoneId
          && e.map_id === pin.map_id
          && typeof e.x === 'number' && typeof e.y === 'number')
        .sort((a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0));
      if (markers.length < 3) return false;
      return pointInPolygon(
        { x: pin.x, y: pin.y },
        markers.map(m => ({ x: m.x as number, y: m.y as number })),
      );
    },
    chipCount(ref) {
      const id = input.refToId(ref);
      if (!id) return 0;
      const el = input.elements.find(e => e.id === id);
      const story = el?.story;
      if (typeof story !== 'string' || story.length === 0) return 0;
      return (story.match(/\]\(ow:\/\//g) ?? []).length;
    },
  };
}

/** Every ref in `refs` is present. The `creates` gate, and a handy predicate. */
export function hasAll(refs: readonly string[]): (w: TourWorldView) => boolean {
  return (w) => refs.every(r => w.hasRef(r));
}

/** How many of `refs` are present — the signature term for partial progress. */
export function countPresent(refs: readonly string[], w: TourWorldView): number {
  return refs.reduce((n, r) => n + (w.hasRef(r) ? 1 : 0), 0);
}
