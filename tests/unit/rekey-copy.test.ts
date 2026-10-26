/**
 * The re-key's user-visible copy (the singular/plural and "N more"
 * cases the modal probe `c-modal` printed). Exact strings, so a drift in voice
 * is a deliberate edit here, never an accident.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { doneMessage, unrewrittenMessage } from '../../src/ui/rekey-modal';
import { describeFailures } from '../../src/sync/sync-failure-copy';
import { getState, setState } from '../../src/core/state';
import type { Element, PerElementFailure } from '../../src/core/types';

describe('re-key modal copy', () => {
  it('doneMessage: one or many, uploading now or on the next sync', () => {
    expect(doneMessage(1, true)).toBe('1 element has a new id. It is uploading.');
    expect(doneMessage(1, false)).toBe('1 element has a new id. It uploads when this world syncs again.');
    expect(doneMessage(2, true)).toBe('2 elements have new ids. They are uploading.');
    expect(doneMessage(2, false)).toBe('2 elements have new ids. They upload when this world syncs again.');
  });

  describe('unrewrittenMessage', () => {
    beforeEach(() => {
      const els = [
        { id: 'a', type: 'character', name: 'Elrond' },
        { id: 'b', type: 'character', name: 'Arwen' },
        { id: 'c', type: 'location', name: '' }, // no name: the id stands in
      ] as unknown as Element[];
      setState({ ...getState(), data: { ...getState().data, elements: els } });
    });

    it('one file', () => {
      expect(unrewrittenMessage(['a'])).toBe(
        '1 element could not be updated because its file would not open (Elrond). Fix it, then use Update links in Settings.',
      );
    });

    it('five files: three named, "and 2 more"', () => {
      expect(unrewrittenMessage(['a', 'b', 'c', 'd', 'e'])).toBe(
        '5 elements could not be updated because their files would not open (Elrond, Arwen, c and 2 more). Fix them, then use Update links in Settings.',
      );
    });
  });
});

describe('sync failure copy, one foreign id', () => {
  it('speaks of it in the singular', () => {
    const one: PerElementFailure = {
      element_id: 'x', type: 'character', operation: 'create',
      message: 'An element with id x already exists in another world. give this element a new id (a copied world folder needs fresh ids).',
    };
    const text = describeFailures([one]);
    expect(text).toBe(
      '1 element could not upload because its id already belongs to another OnlyWorlds world. '
      + 'This happens with a copied or imported folder, or a world taken online a second time. '
      + 'It stays safe on your disk, and Settings can give it a new id.',
    );
    expect(text).toContain('its id');
    expect(text).toContain('It stays');
    expect(text).toContain('give it a new id');
  });
});
