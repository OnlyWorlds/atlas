/**
 * Structural invariants of the tour script. These are the rules a content
 * edit can break silently: every one of them was a gate finding, and none is
 * visible in a green e2e that happens to walk a compliant script.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TOUR_STEPS, capabilitiesUpTo, TOUR_CAPABILITIES,
  TOUR_PIN_REF, TOUR_SWAMPS_ZONE_REF,
} from '../../src/tour/tour-data';
import { buildTourWorldView } from '../../src/tour/tour-view';
import bundle from '../../src/demo/hyperion-world.json';

describe('TOUR_STEPS structure', () => {
  it('every step declares at least one phase', () => {
    for (const step of TOUR_STEPS) {
      expect(step.phases.length, `${step.id} phases`).toBeGreaterThan(0);
    }
  });

  it('phase ids are unique within a step', () => {
    for (const step of TOUR_STEPS) {
      const ids = step.phases.map(p => p.id);
      expect(new Set(ids).size, `${step.id} phase ids ${ids.join(',')}`).toBe(ids.length);
    }
  });

  it('the opening phase is unconditional (something must always resolve)', () => {
    for (const step of TOUR_STEPS) {
      expect(step.phases[0].when, `${step.id} opening phase`).toBeUndefined();
    }
  });

  it('no step routes to an element it also creates (gate R7)', () => {
    // Otherwise the step opens on the app's "Element … not found in this
    // world" card while the dock underneath says "click + to add it".
    for (const step of TOUR_STEPS) {
      const creates = step.creates ?? [];
      if (creates.length === 0) continue;
      const route = step.route;
      const target = route && 'ref' in route ? route.ref : undefined;
      const elementTarget = route && 'elementRef' in route ? route.elementRef : undefined;
      expect(creates, `${step.id} route`).not.toContain(target);
      expect(creates, `${step.id} elementRef`).not.toContain(elementTarget);
    }
  });

  it('a created ref is never also revealed by its own step', () => {
    // The whole point of `creates` is that the USER makes it; a reveal on the
    // same step would put it on disk before they clicked anything.
    for (const step of TOUR_STEPS) {
      for (const ref of step.creates ?? []) {
        expect(step.reveal ?? [], `${step.id} reveals its own create ${ref}`).not.toContain(ref);
      }
    }
  });

  it('EVERY ref resolves against the baked bundle', () => {
    // The invariant that makes the `creates` gate safe. A renamed or mistyped
    // ref is silently SKIPPED by `refToIdSync`, so the user clicks + three
    // times, gets two objects, and `hasAll` can never be true: Next never
    // renders and the step dead-ends with only Exit. The bundle is re-baked
    // from OnlyWorlds demo key 0000000000, so a rename is expected eventually.
    const elements = (bundle as { elements: Array<{ type: string; name?: string }> }).elements;
    const known = new Set(elements.map(e => `${e.type}:${e.name ?? ''}`));
    const check = (ref: string | undefined, where: string) => {
      if (!ref) return;
      expect(known, `${where} → ${ref}`).toContain(ref);
    };
    for (const step of TOUR_STEPS) {
      for (const ref of step.reveal ?? []) check(ref, `${step.id}.reveal`);
      for (const ref of step.creates ?? []) check(ref, `${step.id}.creates`);
      for (const span of step.spans ?? []) check(span.ref, `${step.id}.span`);
      const route = step.route;
      if (route && 'ref' in route) check(route.ref, `${step.id}.route`);
      if (route && 'elementRef' in route) check(route.elementRef, `${step.id}.route.elementRef`);
    }
    // The engine's two hands-on refs ride the same contract.
    check('character:The Consul', 'HANDS_ON_REFS.create-consul');
    check("pin:The Consul's balcony seat", 'HANDS_ON_REFS.place-pin');
  });

  it('capabilities only ever GROW across the step order (the reorder-safety invariant)', () => {
    // The whole reason capabilities replaced the ordinal stage number: an act
    // restructure must never flip chrome off. Each step's set must be a
    // superset of the previous step's.
    let prev = new Set<string>();
    for (let i = 0; i < TOUR_STEPS.length; i++) {
      const caps = capabilitiesUpTo(i);
      for (const c of prev) {
        expect(caps.has(c as never), `${TOUR_STEPS[i].id} dropped ${c}`).toBe(true);
      }
      prev = caps as Set<string>;
    }
  });

  it('every declared unlock is a known capability', () => {
    const known = new Set(TOUR_CAPABILITIES);
    for (const step of TOUR_STEPS) {
      for (const c of step.unlocks ?? []) {
        expect(known.has(c), `${step.id} unlocks unknown ${c}`).toBe(true);
      }
    }
  });

  it('the tour reaches every capability by its end', () => {
    // A capability nothing unlocks is dead CSS; the final step must have them all.
    const final = capabilitiesUpTo(TOUR_STEPS.length - 1);
    for (const c of TOUR_CAPABILITIES) {
      expect(final.has(c), `no step unlocks ${c}`).toBe(true);
    }
  });

  it('span refs point at refs the tour actually knows about', () => {
    const known = new Set<string>();
    for (const step of TOUR_STEPS) {
      for (const r of step.reveal ?? []) known.add(r);
      for (const r of step.creates ?? []) known.add(r);
    }
    // The two hands-on refs live in the engine's HANDS_ON_REFS map.
    known.add('character:The Consul');
    known.add("pin:The Consul's balcony seat");
    for (const step of TOUR_STEPS) {
      for (const span of step.spans ?? []) {
        if (!span.ref) continue;
        expect(known, `${step.id} span ref ${span.ref}`).toContain(span.ref);
      }
    }
  });

  it("a place-pin step's zone is revealed no later than the pin step (S303)", () => {
    // The soft correction (pinInZone) needs the zone's markers on disk when the
    // pin beat runs. A reorder that revealed the swamps AFTER the pin would make
    // Next unreachable (no polygon to test the drop against) — a dead-end no e2e
    // that happens to walk a compliant order would catch.
    for (let i = 0; i < TOUR_STEPS.length; i++) {
      const zoneRef = TOUR_STEPS[i].placeInZone?.zoneRef;
      if (!zoneRef) continue;
      const revealedBy = TOUR_STEPS.findIndex(s => (s.reveal ?? []).includes(zoneRef));
      expect(revealedBy, `${TOUR_STEPS[i].id} zone ${zoneRef} reveal`).toBeGreaterThanOrEqual(0);
      expect(revealedBy, `${TOUR_STEPS[i].id} places in a zone revealed later`).toBeLessThanOrEqual(i);
    }
  });
});

describe('the pin beat geometry (S303 soft correction)', () => {
  it('the baked balcony pin sits inside the baked swamps zone', () => {
    // On watch-mode Next or resume the pin is created from the bundle at its
    // baked coordinates (a real placement uses the user's click). Those baked
    // coordinates MUST be in-zone, or those paths dead-end with no Next. This
    // also locks the bundle: a re-bake that moves the pin or the swamps markers
    // out of overlap breaks the beat, and nothing else would notice.
    const elements = (bundle as { elements: Array<{ id: string; type: string; name?: string }> }).elements;
    const byRef = (ref: string) => {
      const i = ref.indexOf(':');
      return elements.find(e => e.type === ref.slice(0, i) && e.name === ref.slice(i + 1));
    };
    const view = buildTourWorldView({
      elements: elements as Array<{ id: string; type: string;[k: string]: unknown }>,
      worldExists: true, tourIsLive: true, timeCurrent: null,
      refToId: (ref) => byRef(ref)?.id,
    });
    expect(view.pinInZone(TOUR_PIN_REF, TOUR_SWAMPS_ZONE_REF)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The charts act (S305). Every invariant here is a way a re-bake or a content
// edit can silently break the beat while the e2e still walks a compliant
// script — the same class as the pin-geometry guard above.
// ---------------------------------------------------------------------------

function bundleElement(name: string): Record<string, unknown> {
  const el = (bundle.elements as Array<Record<string, unknown>>)
    .find(e => e.name === name);
  expect(el, `bundle is missing "${name}"`).toBeDefined();
  return el!;
}

describe('the charts act (S305)', () => {
  it('the world ships with NO now, or the set-now beat has no button to press', () => {
    // The step's forward control is gated on the clock being set by the USER.
    // A baked `time_current` renders the chip instead of the button, so the
    // gesture becomes impossible and the step strands with no Next at all.
    expect((bundle.world as Record<string, unknown>).time_current).toBeUndefined();
  });

  it('the two events share one date (he plays WHILE they surge)', () => {
    const a = bundleElement('The Primal Performance');
    const b = bundleElement('The Raging of the Beasts');
    expect(a.start_date).toBeTypeOf('number');
    expect(a.start_date).toBe(b.start_date);
  });

  it('the Consul title is granted and never revoked (the open-end lesson)', () => {
    // `title` is the only type carrying openEnd semantics, and the whole
    // "soft end means no end recorded" copy depends on the absence of a
    // revoke_date. Adding one would silently turn the span into a closed bar.
    const title = bundleElement('Consul of the Hegemony');
    expect(title.grant_date).toBeTypeOf('number');
    expect(title.revoke_date).toBeUndefined();
  });

  it('the title is granted BEFORE the events, so its span is visible at the suggested now', () => {
    // The room suggests the median dated point, which lands on the events.
    // A grant at or after that would render a zero-length or backwards bar.
    const title = bundleElement('Consul of the Hegemony');
    const event = bundleElement('The Primal Performance');
    expect(title.grant_date as number).toBeLessThan(event.start_date as number);
  });

  it('deep time really is deep: Rachmaninov sits in the down-counting era', () => {
    // Negative absolute years ARE the Old Earth era (it counts down to the
    // pivot at 0). A positive date would put him in PC and the copy would lie.
    expect(bundleElement('Rachmaninov').birth_date as number).toBeLessThan(0);
    expect(bundleElement("Rachmaninov's Prelude").start_date as number).toBeLessThan(0);
  });

  it('the world range covers the Old Earth era', () => {
    const world = bundle.world as unknown as Record<string, number>;
    expect(world.time_range_min).toBeLessThanOrEqual(
      bundleElement('Rachmaninov').birth_date as number,
    );
  });

  it('the calendar element carries two eras sharing the pivot', () => {
    const cal = bundleElement('Hegemony Standard').atlas_calendar as
      { version: number; eras: Array<{ name: string; start: number; direction?: string }> };
    expect(cal.version).toBe(1);
    expect(cal.eras).toHaveLength(2);
    const down = cal.eras.find(e => e.direction === 'down');
    const up = cal.eras.find(e => e.direction !== 'down');
    expect(down, 'a down-counting era').toBeDefined();
    expect(up, 'an up-counting era').toBeDefined();
    expect(down!.start).toBe(up!.start); // the shared pivot
  });

  it('the calendar is revealed no later than the chart step that reads it', () => {
    const calStep = TOUR_STEPS.findIndex(s =>
      (s.reveal ?? []).includes('construct:Hegemony Standard'));
    const chartStep = TOUR_STEPS.findIndex(s => s.id === 'the-chart');
    expect(calStep, 'the calendar is never revealed').toBeGreaterThanOrEqual(0);
    expect(calStep).toBeLessThanOrEqual(chartStep);
  });

  it('deep time is revealed AFTER the chart has taught the axis', () => {
    const chartStep = TOUR_STEPS.findIndex(s => s.id === 'the-chart');
    const deep = TOUR_STEPS.findIndex(s => s.id === 'deep-time');
    expect(deep).toBeGreaterThan(chartStep);
  });

  it('every hands-on kind has a forward gate branch in the BAR ITSELF', () => {
    // The previous version of this test compared `step.handsOn` against a
    // hardcoded list in this file — which is a closed TypeScript union checked
    // against a copy of itself. Deleting the `set-now` branch from tour-bar's
    // gate left it green while the step became permanently un-advanceable
    // (found by the S305 close gate). So read the SOURCE of the gate instead:
    // a kind with no bundle ref that falls through to the default `handsOnDone`
    // is false forever, and the step renders no forward control at all.
    const bar = readFileSync(
      resolve(__dirname, '../../src/tour/tour-bar.ts'), 'utf-8');
    const gate = bar.slice(bar.indexOf('const handsOnGate'),
      bar.indexOf('if (step.handsOn'));
    expect(gate.length, 'could not locate handsOnGate in tour-bar.ts').toBeGreaterThan(0);
    const refless = new Set(['set-now']); // kinds with no bundle element
    for (const step of TOUR_STEPS) {
      if (!step.handsOn || !refless.has(step.handsOn)) continue;
      expect(gate.includes(`'${step.handsOn}'`),
        `handsOn "${step.handsOn}" has no branch in tour-bar's handsOnGate`).toBe(true);
    }
  });

  it('deep-time actually reveals the elements the step exists for', () => {
    // Ordering was locked but CONTENTS were not: deleting the reveal list left
    // the whole suite green while the step showed nothing (S305 close gate).
    const deep = TOUR_STEPS.find(s => s.id === 'deep-time');
    expect(deep, 'the deep-time step').toBeDefined();
    expect(deep!.reveal ?? []).toContain('character:Rachmaninov');
    expect(deep!.reveal ?? []).toContain("construct:Rachmaninov's Prelude");
    // ...and its spans light on the same beat as its elements.
    expect((deep!.spans ?? []).length).toBeGreaterThan(0);
  });
});
