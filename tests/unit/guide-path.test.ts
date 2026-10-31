/**
 * The guide's path (#964): the pointer's steps (pure), the one predicate
 * the block and the notes read, the pointer's writes and the rooms' visits.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getState, patchSlice } from '../../src/core/state';
import { currentStep, laterStep, nextStep, stepDone, type Dots } from '../../src/core/guide';
import {
  FIRST_STEPS_ON, advancePath, noteRoomVisit, pathShowing, resetGuidePathForTests, setDoor, startPath, worldEmptyForPath,
} from '../../src/core/guide-path';
import type { Element, WorldRegistryEntry } from '../../src/core/types';

const dots = (lit: string): Dots => ({
  someone: lit.includes('s'), placed: lit.includes('p'), happened: lit.includes('h'), story: lit.includes('t'), copy: lit.includes('c'),
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const E = (n: number, type: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id: uuid(n), type, name, ...extra }) as unknown as Element;
const ada = E(1, 'character', 'Ada');

function world(elements: Element[], entry: Partial<WorldRegistryEntry> = {}, id = 'w'): void {
  const e = { id, name: 'W', where: 'folder', state: 'local-only', ...entry } as unknown as WorldRegistryEntry;
  patchSlice('registry', { worlds: [e] } as never);
  patchSlice('active', { worldId: id, meta: { name: 'W' } } as never);
  patchSlice('data', { elements, loading: false } as never);
}
const entry = () => getState().registry.worlds[0];
const tick = () => new Promise<void>(r => queueMicrotask(r));

afterEach(() => {
  resetGuidePathForTests();
  patchSlice('active', null);
  try { localStorage.clear(); } catch { /* */ }
});

describe('the pointer, pure', () => {
  it('unset reads the first unlit dot; all lit reads done', () => {
    expect(currentStep(dots(''), undefined)).toBe('someone');
    expect(currentStep(dots('sp'), undefined)).toBe('happened');
    expect(currentStep(dots('sphtc'), undefined)).toBe('done');
    expect(currentStep(dots('sphtc'), 'placed')).toBe('placed');
  });

  it('Next skips a step already lit, and ends on done', () => {
    expect(nextStep('someone', dots('s'))).toBe('placed');
    expect(nextStep('someone', dots('sph'))).toBe('story');
    expect(nextStep('story', dots('sphtc'))).toBe('done');
    expect(nextStep('done', dots(''))).toBe('done');
  });

  it('the later of two wins: a stale tab never moves it back', () => {
    expect(laterStep('story', 'placed')).toBe('story');
    expect(laterStep('placed', 'story')).toBe('story');
    expect(laterStep(undefined, 'someone')).toBe('someone');
    expect(laterStep('done', 'copy')).toBe('done');
  });

  it('the chart and the writing room are done only once seen', () => {
    expect(stepDone('happened', dots('sph'), [])).toBe(false);
    expect(stepDone('happened', dots('sph'), ['happened'])).toBe(true);
    expect(stepDone('happened', dots('sp'), ['happened'])).toBe(false);
    expect(stepDone('placed', dots('sp'), undefined)).toBe(true);
  });
});

describe('pathShowing, the first steps retired (1.115.0)', () => {
  it('the switch is off', () => {
    expect(FIRST_STEPS_ON).toBe(false);
  });

  it('never shows: an empty world, whatever is folded open', () => {
    world([]);
    expect(pathShowing('w')).toBe(false);
    setDoor('w', 'bring');
    expect(pathShowing('w')).toBe(false);
    setDoor('w', null);
    world([], { guide_step: 'someone' });
    expect(pathShowing('w')).toBe(false);
  });

  it('never shows: a world with a pointer short of done', () => {
    const keep = E(2, 'location', 'Keep');
    const placed = { ...ada, location: keep.id } as Element;
    const ev = E(3, 'event', 'Founding', { start_date: 120 });
    const tale = E(4, 'narrative', 'Tale', { supertype: 'Book' });
    world([placed, keep, ev, tale], { guide_step: 'copy' });
    expect(pathShowing('w')).toBe(false);
    world([ada], { guide_step: 'placed' });
    expect(pathShowing('w')).toBe(false);
  });

  it('never shows: a world with no pointer and unlit dots', () => {
    const keep = E(2, 'location', 'Keep');
    world([{ ...ada, location: keep.id } as Element, keep]);
    expect(pathShowing('w')).toBe(false);
    world([ada]);
    expect(pathShowing('w')).toBe(false);
  });

  it('a room seen with its step lit is never recorded: no path shows', async () => {
    const ev = E(3, 'event', 'Founding', { start_date: 120 });
    world([ada, ev], { guide_step: 'happened' });
    noteRoomVisit('timeline', 'w');
    await tick();
    expect(entry().guide_visited).toBeUndefined();
  });
});

describe('the code gate\'s findings', () => {
  it('a world holding only its reading aids is not empty (C1, the old G9)', () => {
    const charter = E(9, 'law', 'House Rules', { supertype: 'Charter', x_charter_of: 'mark' });
    world([charter]);
    expect(worldEmptyForPath()).toBe(false);
    // Its twin: nothing at all is empty.
    world([]);
    expect(worldEmptyForPath()).toBe(true);
  });

  it('Start from nothing in an emptied world whose path was done starts it again; nothing else moves a done path back (C5)', () => {
    world([], { guide_step: 'done', guide_visited: ['happened'] });
    startPath('w');
    expect(entry().guide_step).toBe('done');
    startPath('w', { restart: true });
    expect(entry().guide_step).toBe('someone');
    expect(entry().guide_visited).toEqual([]);
  });

  it('startPath takes another tab\'s pointer rather than writing someone over it', () => {
    world([ada]);
    localStorage.setItem('atlas_worlds_registry', JSON.stringify({ ...getState().registry, worlds: [{ ...entry(), guide_step: 'story' }] }));
    startPath('w');
    expect(entry().guide_step).toBe('story');
  });
});

describe('the writes', () => {
  it('startPath writes someone only when unset; advancePath only forward', () => {
    world([ada]);
    startPath('w');
    expect(entry().guide_step).toBe('someone');
    advancePath('w', 'story');
    startPath('w');
    expect(entry().guide_step).toBe('story');
    expect(advancePath('w', 'placed')).toBe('story');
    expect(entry().guide_step).toBe('story');
  });

  it('a stale tab: Next takes the later of what another tab stored, this tab and the step computed', () => {
    world([ada], { guide_step: 'someone' });
    localStorage.setItem('atlas_worlds_registry', JSON.stringify({ ...getState().registry, worlds: [{ ...entry(), guide_step: 'story' }] }));
    expect(advancePath('w', 'placed')).toBe('story');
    expect(entry().guide_step).toBe('story');
  });

});
