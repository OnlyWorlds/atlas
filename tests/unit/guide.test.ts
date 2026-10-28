/**
 * The guide's dots (onboarding step 1), pure: each dot is lit by what the
 * world holds, never by what was done or stored, and each rule is tested on
 * the exact shape it is about, an absent or wrong field included.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { guideDots, DOTS, isFilled, noteEarned, loadGuideState, markNoteSeen, setNotesOff, rewardEarned, type Dots } from '../../src/core/guide';
import type { Element, WorldRegistryEntry } from '../../src/core/types';

let n = 0;
const el = (type: string, extra: Record<string, unknown> = {}): Element =>
  ({ id: `id-${type}-${++n}`, type, name: `${type} ${n}`, ...extra }) as unknown as Element;
const folderWorld = { id: 'w', where: 'folder', state: 'local-only' } as unknown as WorldRegistryEntry;
const browserWorld = (extra: Record<string, unknown> = {}): WorldRegistryEntry =>
  ({ id: 'w', where: 'browser', state: 'local-only', ...extra }) as unknown as WorldRegistryEntry;
const lit = (els: Element[], entry: WorldRegistryEntry | undefined = browserWorld()) =>
  DOTS.filter(d => guideDots(els, entry)[d.id]).map(d => d.id);

describe('rewardEarned (#840: the gesture that took the web to two)', () => {
  const three: Dots = { someone: true, placed: true, happened: true, story: false, copy: false };
  it('earned when the gesture\'s element is what took the anchor\'s ring to two; the place named first', () => {
    expect(rewardEarned(three, 'ada', ['keep', 'siege'], 'siege', 'keep')).toEqual({ anchor: 'ada', names: ['keep', 'siege'], more: 0 });
    // An Event first, linked to Ada, then the place: the place is the gesture element.
    expect(rewardEarned(three, 'ada', ['siege', 'keep'], 'keep', 'keep')).toEqual({ anchor: 'ada', names: ['keep', 'siege'], more: 0 });
  });
  it('never from a gesture that linked nothing new: the ring without it already holds two (an arrived world, H2)', () => {
    expect(rewardEarned(three, 'ada', ['keep', 'brin', 'siege'], 'siege', 'keep')).toBeNull();
  });
  it('never when the gesture\'s element is not in the ring, or the ring holds one', () => {
    expect(rewardEarned(three, 'ada', ['keep', 'brin'], 'siege', 'keep')).toBeNull();
    expect(rewardEarned(three, 'ada', ['keep'], 'keep', 'keep')).toBeNull();
  });
  it('never while one of the first three dots is dark', () => {
    for (const dark of ['someone', 'placed', 'happened'] as const) {
      expect(rewardEarned({ ...three, [dark]: false }, 'ada', ['keep', 'siege'], 'siege', 'keep')).toBeNull();
    }
  });
  it('a place the Web does not draw is not named; the anchor is never its own neighbour', () => {
    expect(rewardEarned(three, 'ada', ['ada', 'siege', 'brin'], 'siege', 'keep')?.names).toEqual(['siege', 'brin']);
    expect(rewardEarned(three, 'ada', ['siege', 'brin'], 'brin', 'keep')?.names).toEqual(['brin', 'siege']);
  });
});

describe('guideDots', () => {
  it('an empty browser world: nothing lit', () => {
    expect(lit([])).toEqual([]);
  });

  it('a Character lights someone; a Location alone lights nothing', () => {
    expect(lit([el('character')])).toEqual(['someone']);
    expect(lit([el('location')])).toEqual([]);
  });

  it('placed: a Character whose location names a Location in the world', () => {
    const keep = el('location');
    expect(lit([el('character', { location: keep.id }), keep])).toEqual(['someone', 'placed']);
  });

  it('placed stays dark for a location naming a missing id, or an unplaced pair', () => {
    expect(lit([el('character', { location: 'gone' }), el('location')])).toEqual(['someone']);
    expect(lit([el('character'), el('location')])).toEqual(['someone']);
    expect(lit([el('character', { location: null }), el('location')])).toEqual(['someone']);
  });

  it('happened: an Event with a whole-number start_date, by the SDK\'s one meaning', () => {
    expect(lit([el('event', { start_date: 120 })])).toEqual(['happened']);
    expect(lit([el('event', { start_date: -40 })])).toEqual(['happened']);
    expect(lit([el('event', { start_date: 0 })])).toEqual(['happened']);
  });

  it('happened stays dark for an undated, string or fractional date', () => {
    expect(lit([el('event')])).toEqual([]);
    expect(lit([el('event', { start_date: '120' })])).toEqual([]);
    expect(lit([el('event', { start_date: 1.5 })])).toEqual([]);
    expect(lit([el('event', { end_date: 120 })])).toEqual([]);
  });

  it('story: a story Narrative; a knowledge entry and a page are not stories', () => {
    expect(lit([el('narrative')])).toEqual(['story']);
    expect(lit([el('narrative', { subtype: 'knowledge' })])).toEqual([]);
    expect(lit([el('narrative', { subtype: 'Page' })])).toEqual([]);
  });

  it('copy: a folder world, an online world, a downloaded or exported browser world', () => {
    expect(lit([], folderWorld)).toEqual(['copy']);
    expect(lit([], browserWorld({ state: 'api-linked' }))).toEqual(['copy']);
    expect(lit([], browserWorld({ kept_download_at: '2026-10-27T20:00:00Z' }))).toEqual(['copy']);
    expect(lit([], browserWorld({ kept_export_at: '2026-10-27T20:00:00Z' }))).toEqual(['copy']);
  });

  it('copy stays dark for a browser world kept nowhere else, and with no entry', () => {
    expect(lit([], browserWorld())).toEqual([]);
    expect(lit([], undefined)).toEqual([]);
  });

  it('placed reads a link written as {id, name} or a one-item list', () => {
    const keep = el('location');
    expect(lit([el('character', { location: { id: keep.id, name: 'Keep' } }), keep])).toEqual(['someone', 'placed']);
    expect(lit([el('character', { location: [keep.id] }), keep])).toEqual(['someone', 'placed']);
  });

  it('a Chronicle is a recorded artifact, not a story', () => {
    expect(lit([el('narrative', { supertype: 'Chronicle' })])).toEqual([]);
  });

  it('the parlor room never counts, whatever the home cover shows', () => {
    const room = { x_room_of: 'w' };
    expect(lit([
      el('character', { supertype: 'Member', ...room }),
      el('narrative', { supertype: 'Message', ...room }),
      el('event', { supertype: 'Sitting', start_date: 3, ...room }),
    ])).toEqual([]);
    // The control: the same supertypes without the mark are the world's own.
    expect(lit([el('character', { supertype: 'Member' })])).toEqual(['someone']);
  });

  it('a proposed element is not yet the world\'s own', () => {
    expect(lit([el('character', { x_review_proposed: { by: 'm2' } })])).toEqual([]);
  });

  it('copy is dark while the keep-safe card asks for a copy', () => {
    expect(guideDots([], folderWorld, { keepSafeShowing: true }).copy).toBe(false);
    expect(guideDots([], folderWorld, { keepSafeShowing: false }).copy).toBe(true);
  });

  it('isFilled: a link id, a list, an unread object; never null, empty or blank', () => {
    expect([null, undefined, '', []].map(isFilled)).toEqual([false, false, false, false]);
    expect(['x', ['x'], { id: 'x' }, { name: 'odd' }, 0].map(isFilled)).toEqual([true, true, true, true, true]);
  });

  it('every dot names the chapter steps it covers', () => {
    for (const d of DOTS) expect(d.chapter.length).toBeGreaterThan(0);
  });
});

describe('noteEarned', () => {
  const made = (els: Element[], id: string) => noteEarned({ kind: 'created', id }, els, false);

  it('a Character with no Location anywhere: someone', () => {
    const ada = el('character');
    expect(made([ada], ada.id)).toEqual({ id: 'someone', character: ada.id });
  });

  it('the pair, either order: the offer names the unplaced Character and the newest Location', () => {
    const keep = el('location', { created_at: '2026-10-27T10:00:00Z' });
    const mill = el('location', { created_at: '2026-10-27T11:00:00Z' });
    const ada = el('character');
    expect(made([keep, mill, ada], ada.id)).toEqual({ id: 'place-offer', character: ada.id, location: mill.id });
    expect(made([ada, keep], keep.id)).toEqual({ id: 'place-offer', character: ada.id, location: keep.id });
  });

  it('no offer once anyone is placed, nor for a Character whose place is gone or written in another shape', () => {
    const keep = el('location');
    const placed = el('character', { location: keep.id });
    const bel = el('character');
    expect(made([keep, placed, bel], bel.id)).toBeNull();
    const gone = el('character', { location: 'deleted-id' });
    expect(made([keep, gone], keep.id)).toBeNull();
    const odd = el('character', { location: { name: 'somewhere' } });
    expect(made([keep, odd], keep.id)).toBeNull();
  });

  it('placed: only the commit that lit the dot', () => {
    const keep = el('location');
    const ada = el('character', { location: keep.id });
    expect(noteEarned({ kind: 'location-set', character: ada.id }, [keep, ada], false)).toEqual({ id: 'placed', character: ada.id, location: keep.id });
    const bel = el('character', { location: keep.id });
    expect(noteEarned({ kind: 'location-set', character: bel.id }, [keep, ada, bel], false)).toBeNull();
  });

  it('an Event: the pair when one is placed and unnamed, the year when undated and no calendar speaks', () => {
    const keep = el('location');
    const ada = el('character', { location: keep.id });
    const ev = el('event');
    expect(made([keep, ada, ev], ev.id)).toEqual({ id: 'event', event: ev.id, pair: { character: ada.id, location: keep.id }, askYear: true });
    expect(noteEarned({ kind: 'created', id: ev.id }, [keep, ada, ev], true)).toEqual({ id: 'event', event: ev.id, pair: { character: ada.id, location: keep.id } });
    const named = el('event', { characters: [ada.id], start_date: 3 });
    expect(made([keep, ada, named], named.id)).toEqual({ id: 'event', event: named.id });
  });

  it('dated: only the commit that lit the dot', () => {
    const a = el('event', { start_date: 120 });
    expect(noteEarned({ kind: 'date-set', event: a.id }, [a], false)).toEqual({ id: 'dated', event: a.id });
    const b = el('event', { start_date: 5 });
    expect(noteEarned({ kind: 'date-set', event: b.id }, [a, b], false)).toBeNull();
  });

  it('a story earns story; a knowledge entry, a page and a Chronicle do not', () => {
    for (const [extra, want] of [[{}, 'story'], [{ subtype: 'knowledge' }, null], [{ subtype: 'page' }, null], [{ supertype: 'Chronicle' }, null]] as const) {
      const n = el('narrative', extra);
      expect(made([n], n.id)?.id ?? null).toBe(want);
    }
  });

  it('the parlor room earns nothing, and a proposed element is not there', () => {
    const member = el('character', { supertype: 'Member', x_room_of: 'w' });
    expect(made([member], member.id)).toBeNull();
    const proposed = el('character', { x_review_proposed: { by: 'm2' } });
    expect(made([proposed], proposed.id)).toBeNull();
  });
});

describe('loadGuideState: the first read carries the old switch over', () => {
  beforeEach(() => localStorage.clear());

  it('a fresh browser starts with the notes on, and writes nothing that emits', () => {
    let heard = 0;
    const on = () => { heard++; };
    document.addEventListener('atlas:guide-changed', on);
    expect(loadGuideState()).toEqual({ seen: {}, off: false });
    document.removeEventListener('atlas:guide-changed', on);
    expect(heard).toBe(0);
  });

  it('the old messages switched off: the notes start off', () => {
    localStorage.setItem('atlas_waypoints_v1', JSON.stringify({ completed: {}, muted: true }));
    expect(loadGuideState().off).toBe(true);
  });

  it('all thirteen marked familiar: the notes start off; twelve is not the veteran', () => {
    const all = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`w${i}`, 'x']));
    localStorage.setItem('atlas_waypoints_v1', JSON.stringify({ completed: all, muted: false }));
    expect(loadGuideState().off).toBe(true);
    localStorage.clear();
    const twelve = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`w${i}`, 'x']));
    localStorage.setItem('atlas_waypoints_v1', JSON.stringify({ completed: twelve, muted: false }));
    expect(loadGuideState().off).toBe(false);
  });

  it('once written, the old key no longer decides', () => {
    expect(loadGuideState().off).toBe(false);
    localStorage.setItem('atlas_waypoints_v1', JSON.stringify({ completed: {}, muted: true }));
    expect(loadGuideState().off).toBe(false);
  });

  it('a seen stamp emits once; the same stamp again emits nothing', () => {
    let heard = 0;
    const on = () => { heard++; };
    document.addEventListener('atlas:guide-changed', on);
    markNoteSeen('someone');
    markNoteSeen('someone');
    document.removeEventListener('atlas:guide-changed', on);
    expect(heard).toBe(1);
    expect(Object.keys(loadGuideState().seen)).toEqual(['someone']);
  });

  it('a switch set to what it already is emits nothing (Settings redraws on the event)', () => {
    loadGuideState();
    let heard = 0;
    const on = () => { heard++; };
    document.addEventListener('atlas:guide-changed', on);
    setNotesOff(false);
    setNotesOff(true);
    setNotesOff(true);
    document.removeEventListener('atlas:guide-changed', on);
    expect(heard).toBe(1);
  });
});
