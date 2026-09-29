/**
 * The URL after ids change (S363, `sync/rekey-route.ts`; re-key gate lens 3 F6:
 * E18 map id kept, E19 timeline thrown to the element room, E20 writing left
 * on the old id, and a navigate that pushed Back onto a dead id).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { rekeyRouteHash } from '../../src/sync/rekey-route';
import { __test_handleIdSwap } from '../../src/sync/sync-attach';
import { setState, getState } from '../../src/core/state';

const W = 'w1';
const map = new Map([['old', 'new'], ['m-old', 'm-new']]);
const r = (h: string) => rekeyRouteHash(h, W, map);

describe('rekeyRouteHash', () => {
  it('rewrites every room that carries an element id', () => {
    expect(r('#/w/w1/element/old')).toBe('#/w/w1/element/new');
    expect(r('#/w/w1/timeline/old')).toBe('#/w/w1/timeline/new');
    expect(r('#/w/w1/map/m-old')).toBe('#/w/w1/map/m-new');
    expect(r('#/w/w1/map/m-old/element/old')).toBe('#/w/w1/map/m-new/element/new');
    expect(r('#/w/w1/map/keep/element/old')).toBe('#/w/w1/map/keep/element/new');
    expect(r('#/w/w1/writing/old')).toBe('#/w/w1/writing/new');
    expect(r('#/w/w1/writing/book/x/chapter/old')).toBe('#/w/w1/writing/new');
    expect(r('#/w/w1/knowledge/old')).toBe('#/w/w1/knowledge/new');
    expect(r('#/w/w1/knowledge/knower/old')).toBe('#/w/w1/knowledge/knower/new');
    expect(r('#/w/w1/share/old')).toBe('#/w/w1/share/new');
  });

  it('leaves other ids, other rooms and other worlds alone', () => {
    expect(r('#/w/w1/element/other')).toBeNull();
    expect(r('#/w/w1/map/keep/element/other')).toBeNull();
    expect(r('#/w/w1/settings/world')).toBeNull();
    expect(r('#/w/w2/element/old')).toBeNull();
  });
});

describe('Route 2 id swap: the URL follows, and Back never reaches the old id', () => {
  beforeEach(() => {
    setState({ ...getState(), active: { worldId: W } as never });
  });

  it('a timeline route stays in the timeline, replacing history', () => {
    window.location.hash = '#/w/w1/timeline/old';
    const before = window.history.length;
    __test_handleIdSwap({ old_id: 'old', new_id: 'new', type: 'character' });
    expect(window.location.hash).toBe('#/w/w1/timeline/new');
    expect(window.history.length).toBe(before);
  });
});
