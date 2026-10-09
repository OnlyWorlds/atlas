/**
 * The home's onboarding kernel (S264 core pair; #127 the next steps), pure.
 * Locks the core-pair gate, the world order of the steps, the merge (a step
 * is done by its waypoint OR by what the world holds), and the shown limit.
 */

import { describe, it, expect } from 'vitest';
import { computeNextSteps, coreCards, HOME_STEPS, HOME_STEPS_SHOWN, worldHolds } from '../../src/middle/home-tour';
import type { Element } from '../../src/core/types';
import type { WaypointId } from '../../src/core/waypoints';
import { WAYPOINTS } from '../../src/core/waypoints';

const counts = (obj: Record<string, number>): Map<string, number> => new Map(Object.entries(obj));
const none = new Set<WaypointId>();
const el = (type: string, extra: Record<string, unknown> = {}): Element =>
  ({ id: `${type}-${Math.random()}`, type, name: type, ...extra }) as unknown as Element;

describe('coreCards', () => {
  it('an empty world asks for both, character first', () => {
    expect(coreCards(counts({}))).toEqual(['character', 'location']);
  });
  it('one core down: only the missing one', () => {
    expect(coreCards(counts({ character: 1, event: 3 }))).toEqual(['location']);
  });
  it('both present: none', () => {
    expect(coreCards(counts({ character: 1, location: 2 }))).toEqual([]);
  });
});

describe('computeNextSteps', () => {
  it('a fresh world gets the first three, in world order', () => {
    expect(computeNextSteps(none, none)).toEqual(HOME_STEPS.slice(0, HOME_STEPS_SHOWN));
    expect(HOME_STEPS.slice(0, 3)).toEqual(['links', 'taxonomy', 'time']);
  });
  it('a completed waypoint and a held step both leave the list', () => {
    const steps = computeNextSteps(new Set<WaypointId>(['links']), new Set<WaypointId>(['taxonomy']));
    expect(steps).toEqual(['time', 'story', 'maps']);
  });
  it('everything done: an empty list (the home draws nothing)', () => {
    expect(computeNextSteps(new Set(HOME_STEPS), none)).toEqual([]);
  });
  it('every home step is a real waypoint, and the core pair covers the other two', () => {
    const ids = new Set(WAYPOINTS.map(w => w.id));
    for (const id of HOME_STEPS) expect(ids.has(id)).toBe(true);
    const rest = WAYPOINTS.map(w => w.id).filter(id => !HOME_STEPS.includes(id));
    expect(rest.sort()).toEqual(['first-element', 'first-world']);
  });
});

describe('worldHolds', () => {
  it('reads stories, knowledge, pages and pins from the world', () => {
    const holds = worldHolds([
      el('pin'),
      el('narrative', { supertype: 'Book' }),
    ], { where: 'browser' });
    expect(holds.has('maps')).toBe(true);
    expect(holds.has('story')).toBe(true);
    expect(holds.has('knowledge')).toBe(false);
    expect(holds.has('keep-copy')).toBe(false);
  });
  it('a folder world already has a copy outside the browser; a linked one is online too', () => {
    expect(worldHolds([], {}).has('keep-copy')).toBe(true);
    const linked = worldHolds([], { where: 'browser', api: { world_id: 'w', api_key: 'k' } as never });
    expect(linked.has('keep-copy')).toBe(true);
    expect(linked.has('ecosystem')).toBe(true);
  });
  it('an empty browser world holds nothing', () => {
    expect([...worldHolds([], { where: 'browser' })]).toEqual([]);
  });
});
