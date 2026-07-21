/**
 * Structural invariants of the tour script. These are the rules a content
 * edit can break silently: every one of them was a gate finding, and none is
 * visible in a green e2e that happens to walk a compliant script.
 */

import { describe, it, expect } from 'vitest';
import { TOUR_STEPS, capabilitiesUpTo, TOUR_CAPABILITIES } from '../../src/tour/tour-data';
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
});
