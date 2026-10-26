/**
 * The preview stack's rule + the merged foot row's exclusivity.
 *
 * The stack on step N previews what the NEXT click of Next brings into the
 * world — step N+1's `creates` ∪ `reveal`, minus quiet machinery (markers,
 * the calendar construct). Hands-on elements are never previewed: the gesture
 * is its own preview. These tests read the rule off the REAL step script, so
 * a reveal move or a re-bake that changes what arrives where fails loudly.
 */
import { describe, expect, it } from 'vitest';
import {
  isQuietRef,
  previewRefsFor,
  TOUR_MAP_REF,
  TOUR_QUIET_REFS,
  TOUR_QUIET_TYPES,
  TOUR_STEPS,
  TOUR_SWAMPS_ZONE_REF,
} from '../../src/tour/tour-data';

/** Index by step id — never a hand-numbered index (the dead-gate class). */
function idx(id: string): number {
  const i = TOUR_STEPS.findIndex(s => s.id === id);
  expect(i, `step id "${id}" exists`).toBeGreaterThanOrEqual(0);
  return i;
}

describe('previewRefsFor — the next-step rule', () => {
  it('matches next step creates ∪ reveal minus quiet refs, for every step', () => {
    TOUR_STEPS.forEach((_, i) => {
      const next = TOUR_STEPS[i + 1];
      const expected = next
        ? [...(next.creates ?? []), ...(next.reveal ?? [])].filter(r => !isQuietRef(r))
        : [];
      expect(previewRefsFor(i)).toEqual(expected);
    });
  });

  it('the consul step previews the institution and the title (Titus: "it is what you are ABOUT to create")', () => {
    expect(previewRefsFor(idx('the-consul'))).toEqual([
      'institution:The Hegemony',
      'title:Consul of the Hegemony',
    ]);
  });

  it('the planet step previews map + zone only — the six markers are quiet', () => {
    expect(previewRefsFor(idx('the-planet'))).toEqual([TOUR_MAP_REF, TOUR_SWAMPS_ZONE_REF]);
  });

  it('the swamps step previews the objects run (next step creates them via +)', () => {
    expect(previewRefsFor(idx('the-swamps'))).toEqual(TOUR_STEPS[idx('objects')].creates);
  });

  it('the objects step itself previews nothing (linking reveals nothing)', () => {
    expect(previewRefsFor(idx('objects'))).toEqual([]);
  });

  it('the events step previews nothing — the calendar construct is quiet', () => {
    expect(previewRefsFor(idx('the-events'))).toEqual([]);
  });

  it('the final step previews nothing', () => {
    expect(previewRefsFor(TOUR_STEPS.length - 1)).toEqual([]);
  });

  it('no preview ever contains a quiet type or quiet ref', () => {
    TOUR_STEPS.forEach((_, i) => {
      for (const ref of previewRefsFor(i)) {
        const type = ref.slice(0, ref.indexOf(':'));
        expect(TOUR_QUIET_TYPES).not.toContain(type);
        expect(TOUR_QUIET_REFS).not.toContain(ref);
      }
    });
  });

  it('quiet refs actually exist in the script (a renamed ref must not silently disarm the filter)', () => {
    // The string-keyed-lookup class: if the calendar construct is
    // renamed in the bundle/steps, TOUR_QUIET_REFS keeps matching nothing and
    // the filter fails open. Assert every quiet REF is still referenced by
    // some step's reveal/creates.
    const allRefs = TOUR_STEPS.flatMap(s => [...(s.creates ?? []), ...(s.reveal ?? [])]);
    for (const quiet of TOUR_QUIET_REFS) {
      expect(allRefs, `quiet ref "${quiet}" still exists in the step script`).toContain(quiet);
    }
  });
});

// (The meta-XOR-deeper rule was RETIRED: Titus's merged map
// step legitimately carries both, and the foot row renders them side by side
// — bulb first, meta text beside it. No structural exclusivity to lock.)
