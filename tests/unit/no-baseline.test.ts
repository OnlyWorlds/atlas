/**
 * conv. 192's pure pieces: the folder format's fold (`copyDiff`, S1, M1), the
 * mark's rules in the one stamp (`stampedBody`: written only with a stamp that
 * says so, dropped by every other; R1/M2's `asServed`), the review row's words
 * (S2, S3), and finding 2's words for a file removed outside Atlas.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { copyDiff, theirsOf } from '../../src/sync/same-copy';
import { stampedBody, editedSinceBaseline } from '../../src/store/sync-stamp';
import { BASELINE_UNKNOWN, hasNoBaseline, isBaselineUnknown } from '../../src/core/baseline-unknown';
import { noBaselineRowHtml, NO_BASELINE_LINE, sideWord } from '../../src/ui/conflict-review-modal';
import { removedOnDiskTip } from '../../src/sidebar/elements-sidebar';
import { heldCopyLine } from '../../src/sync/sync-attach';
import { heldAsOtherType, withRows } from '../../src/sync/sync-engine';
import { patchSlice } from '../../src/core/state';
import type { Conflict, Element } from '../../src/core/types';

const L = '0695db83-aa04-78be-8000-6e93f683d435';
const el = (body: Record<string, unknown>) => ({ id: 'a', type: 'character', name: 'Ada', ...body }) as unknown as Element;
/** keel's side: the same name, the case's fields. */
const k = (body: Record<string, unknown>) => ({ name: 'Ada', ...body });

describe('the fold (copyDiff)', () => {
  it('reads a sparse file and keel\'s whole body of the same content as the same', () => {
    const keel = { id: 'a', type: 'character', name: 'Ada', description: '', supertype: '', height: null, birthplace: null, traits: [], created_at: 't', change_seq: 3, created_by: null, x_note: null };
    expect(copyDiff(el({}), keel, 'character')).toEqual([]);
  });

  it('a text: absent, null and "" are one; a number: absent and null; a list: absent and []', () => {
    expect(copyDiff(el({ description: null }), k({ description: '' }), 'character')).toEqual([]);
    expect(copyDiff(el({ height: undefined }), k({ height: null }), 'character')).toEqual([]);
    expect(copyDiff(el({ height: 0 }), k({ height: null }), 'character')).toEqual(['height']);
    expect(copyDiff(el({ traits: [] }), k({}), 'character')).toEqual([]);
  });

  it('an extension key: absent and null only; "" and [] are values there', () => {
    expect(copyDiff(el({ x_note: null }), k({}), 'character')).toEqual([]);
    expect(copyDiff(el({ x_note: '' }), k({}), 'character')).toEqual(['x_note']);
    expect(copyDiff(el({ x_list: [] }), k({}), 'character')).toEqual(['x_list']);
  });

  it('S1: a link in any letter case, a list of links with each id once', () => {
    expect(copyDiff(el({ birthplace: L.toUpperCase(), friends: [L, L.toUpperCase()] }), k({ birthplace: L, friends: [L] }), 'character')).toEqual([]);
    expect(copyDiff(el({ friends: [L, 'b'] }), k({ friends: ['b', L] }), 'character')).toEqual(['friends']); // order is the writer's
  });

  it('S1: keel\'s coercions stay a difference (a row that says so, never a guess)', () => {
    expect(copyDiff(el({ height: '5' }), k({ height: 5 }), 'character')).toEqual(['height']);
    expect(copyDiff(el({ height: 5.7 }), k({ height: 5 }), 'character')).toEqual(['height']);
  });

  it('an object\'s keys in any order are one value', () => {
    expect(copyDiff(el({ x_o: { a: 1, b: [1, { c: 2, d: 3 }] } }), k({ x_o: { b: [1, { d: 3, c: 2 }], a: 1 } }), 'character')).toEqual([]);
  });

  it('a pin\'s links by their disk names', () => {
    expect(copyDiff({ id: 'p', type: 'pin', name: '', map_id: L.toUpperCase() } as unknown as Element, { map_id: L, element_id: null, element_type: '' }, 'pin')).toEqual([]);
  });

  it('M1: keel\'s review mark where the file has none; a narrator keel filled, only when told', () => {
    const mark = { by: 's', evidence: 'seat', expires: '2099-01-01' };
    expect(copyDiff(el({}), k({ x_review_proposed: mark }), 'character')).toEqual([]);
    expect(copyDiff(el({ x_review_proposed: { by: 'other' } }), k({ x_review_proposed: mark }), 'character')).toEqual(['x_review_proposed']);
    const n = { id: 'n', type: 'narrative', name: 'Note' } as unknown as Element;
    expect(copyDiff(n, { name: 'Note', narrator: L }, 'narrative')).toEqual(['narrator']);
    expect(copyDiff(n, { name: 'Note', narrator: L }, 'narrative', { narratorFilled: true })).toEqual([]);
    expect(copyDiff({ ...n, narrator: 'someone' } as Element, { name: 'Note', narrator: L }, 'narrative', { narratorFilled: true })).toEqual(['narrator']);
  });

  it('never compares stamps, keel\'s bookkeeping or Atlas\'s own fields', () => {
    expect(copyDiff(el({ local_updated_at: 'x', server_updated_at: 'y', atlas_aliases: ['A'], [BASELINE_UNKNOWN]: true }),
      k({ updated_at: 'z', created_at: 'c', change_seq: 9, changed_by: 'm', changed_via: 'api', changed_client: 'atlas', doors: {}, hidden: true }), 'character')).toEqual([]);
  });

  it('theirsOf: keel\'s value of each field that differs, unset read as null', () => {
    expect(theirsOf({ description: 'x' }, ['description', 'background'])).toEqual({ description: 'x', background: null });
  });
});

describe('the mark rides one stamp only (stampedBody)', () => {
  const at = '2026-11-20T10:00:00.000000+00:00';
  it('written when the stamp says so, beside keel\'s stamp; read as no baseline', () => {
    const next = stampedBody(el({ local_updated_at: '2026-11-20T09:00:00.000Z' }), at, '2026-11-20T09:00:00.000Z', { [BASELINE_UNKNOWN]: true });
    expect(next.server_updated_at).toBe(at);
    expect(isBaselineUnknown(next)).toBe(true);
    expect(hasNoBaseline(next)).toBe(true);
    expect(editedSinceBaseline(next)).toBe(true);
  });

  it('dropped by any other stamp: a push keel answered, an adopt', () => {
    const marked = el({ server_updated_at: at, [BASELINE_UNKNOWN]: true, local_updated_at: '2026-11-20T11:00:00.000Z' });
    expect(isBaselineUnknown(stampedBody(marked, '2026-11-20T12:00:00.000000+00:00', '2026-11-20T11:00:00.000Z'))).toBe(false);
    expect(isBaselineUnknown(stampedBody(marked, '2026-11-20T12:00:00.000000+00:00', '2026-11-20T11:00:00.000Z', { doors: {} }))).toBe(false);
  });

  it('M2: asServed makes the local stamp keel\'s when no edit is in flight, and keeps an edit made in flight', () => {
    const later = el({ local_updated_at: '2026-11-20T11:00:00.000Z' });
    expect(stampedBody(later, at, '2026-11-20T11:00:00.000Z', undefined, { asServed: true }).local_updated_at).toBe(at);
    expect(stampedBody(later, at, '2026-11-20T11:00:00.000Z').local_updated_at).toBe('2026-11-20T11:00:00.000Z');
    const edited = stampedBody(later, at, '2026-11-20T10:30:00.000Z', undefined, { asServed: true });
    expect(edited.local_updated_at).toBe('2026-11-20T11:00:00.000Z');
  });
});

describe('the review rows', () => {
  const row = (over: Partial<Conflict> = {}): Conflict => ({ element_id: 'a', type: 'character', detected_at: 't', local_updated_at: 'l', server_updated_at: 's', fields: ['description'], ...over });

  it('withRows: a row for a copy with no record refreshes its own and takes a plain row\'s place; any other row stays as it was', () => {
    const plain = row({ fields: ['x'] });
    expect(withRows([plain], [row({ fields: ['y'] })])).toEqual([plain]);
    const fresh = row({ no_baseline: true, detected_at: 'later', theirs: { description: 'z' } });
    expect(withRows([plain], [fresh])).toEqual([{ ...fresh, detected_at: 't' }]);
    expect(withRows([], [fresh])).toEqual([fresh]);
  });

  it('S7: keel\'s words for an id held as another type, read; any other 409 is not', () => {
    expect(heldAsOtherType('API Error 409: An element with id x already exists as a location in this world. Element ids…')).toBe('location');
    expect(heldAsOtherType(new Error('An element with id x already exists. Use PUT to upsert'))).toBeNull();
  });
});

describe('S2, S3: the row\'s words', () => {
  afterEach(() => patchSlice('data', { elements: [] } as never));

  it('says the copy has no record, shows both values of each field that differs, and the two choices by their plain names', () => {
    patchSlice('data', { elements: [{ id: 'a', type: 'character', name: 'Ada', description: 'mine' } as unknown as Element, { id: L, type: 'location', name: 'Dock' } as unknown as Element] } as never);
    const html = noBaselineRowHtml({ element_id: 'a', type: 'character', detected_at: 't', local_updated_at: 'l', server_updated_at: 's', fields: ['description', 'background', 'birthplace'], no_baseline: true, theirs: { description: 'theirs', background: 'member wrote this', birthplace: L } }, 'Ada');
    const box = document.createElement('div');
    box.innerHTML = html;
    expect(box.querySelector('[data-role="no-baseline-line"]')!.textContent).toBe(NO_BASELINE_LINE);
    expect(NO_BASELINE_LINE).toBe('This copy has no record of what OnlyWorlds held, so Atlas cannot tell which is newer.');
    const side = (f: string) => box.querySelector(`[data-field="${f}"]`)!.textContent!.replace(/\s+/g, ' ').trim();
    expect(side('description')).toBe('description Here: mine On OnlyWorlds: theirs');
    expect(side('birthplace')).toBe('birthplace Here: empty On OnlyWorlds: Dock');
    expect([...box.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Keep this copy', 'Keep the OnlyWorlds copy']);
    // S3: a key this copy lacks stays as OnlyWorlds has it, and nothing here is said as emptied.
    expect(box.querySelector('[data-role="keeps-online"]')!.textContent).toBe('This copy lacks background, birthplace, so Keep this copy leaves them as OnlyWorlds has them.');
    expect(box.querySelector('[data-role="empties-online"]')).toBeNull();
    expect(box.querySelector('[data-role="changed-while-open"]')).toBeNull();
    expect(html).not.toMatch(/—/);
  });

  it('gate M1 (Q1m): a field this copy holds as "" or null is said as emptied, never as staying', () => {
    patchSlice('data', { elements: [{ id: 'a', type: 'character', name: 'Ada', description: 'mine', background: '', motivations: null } as unknown as Element] } as never);
    const box = document.createElement('div');
    box.innerHTML = noBaselineRowHtml({ element_id: 'a', type: 'character', detected_at: 't', local_updated_at: 'l', server_updated_at: 's', fields: ['description', 'background', 'motivations', 'reputation'], no_baseline: true, theirs: { description: 'theirs', background: 'member bg', motivations: 'member m', reputation: 'member r' } }, 'Ada');
    expect(box.querySelector('[data-role="empties-online"]')!.textContent).toBe('Keep this copy empties background, motivations on OnlyWorlds.');
    expect(box.querySelector('[data-role="keeps-online"]')!.textContent).toBe('This copy lacks reputation, so Keep this copy leaves it as OnlyWorlds has it.');
  });

  it('M6: a row that changed while open says so', () => {
    const box = document.createElement('div');
    box.innerHTML = noBaselineRowHtml({ element_id: 'a', type: 'character', detected_at: 't', local_updated_at: 'l', server_updated_at: 's', fields: ['description'], no_baseline: true, theirs: { description: 'x' }, changed_while_open: true }, 'Ada');
    expect(box.querySelector('[data-role="changed-while-open"]')!.textContent).toBe('It changed on OnlyWorlds while this was open: the OnlyWorlds side below is as it is now.');
  });

  it('a side in words: empty, text cut short, a list', () => {
    expect(sideWord(null)).toBe('empty');
    expect(sideWord([])).toBe('empty');
    expect(sideWord('x'.repeat(200))).toHaveLength(120);
    expect(sideWord([1, 2])).toBe('1, 2');
  });

  it('under local-wins, a held row is said, plainly', () => {
    expect(heldCopyLine(1)).toBe('One element waits in Review conflicts: this copy has no record of what OnlyWorlds held, so Atlas cannot tell which is newer. Nothing was sent.');
    expect(heldCopyLine(2)).toMatch(/^2 elements wait in Review conflicts/);
  });
});

describe('finding 2: a file removed outside Atlas', () => {
  it('a linked world\'s words promise no Refresh: the account keeps it, an edit there or the file put back brings it', () => {
    const tip = removedOnDiskTip(['Gone Soon'], true);
    expect(tip).toBe('Removed from the world folder by another program: Gone Soon. Only this folder lost them: they stay on your OnlyWorlds account, and Atlas does not delete them there. One comes back here when it changes on OnlyWorlds. To have them back now, put the files back in the folder.');
    expect(tip).not.toMatch(/Refresh/);
    expect(removedOnDiskTip(['Gone Soon'], false)).toBe('Removed from the world folder by another program: Gone Soon.');
  });
});
