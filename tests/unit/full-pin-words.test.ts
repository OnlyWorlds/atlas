/**
 * The Full pin's words say what a Full pin sends (1.125.18): every filled-in field but what `isCardSkipField` keeps
 * back. Each clause of the words is held to the predicate here, so a change to one shows in the other.
 */
import { describe, it, expect } from 'vitest';
import { FULL_PIN_HINT, FULL_PIN_ON, FULL_PIN_OFF } from '../../src/middle/share-room';
import { isCardSkipField } from '../../src/core/share-payload';

describe('the Full pin says what it sends', () => {
  it('no longer promises every populated field', () => {
    for (const t of [FULL_PIN_HINT, FULL_PIN_ON, FULL_PIN_OFF]) {
      expect(t).not.toMatch(/populated/);
      expect(t).toContain('every filled-in field');
      expect(t).toContain('except when and by whom it was written, who knows of it, and the marks OnlyWorlds tools keep on it');
    }
    expect(FULL_PIN_HINT).toContain('Before you publish, the page lists every field it sends.');
  });

  it('"when and by whom it was written" is kept back', () => {
    for (const f of ['created_at', 'updated_at', 'created_by', 'changed_by', 'world', 'change_seq']) expect(isCardSkipField(f), f).toBe(true);
  });

  it('"who knows of it" is kept back', () => {
    expect(isCardSkipField('known_of')).toBe(true);
  });

  it('"the marks OnlyWorlds tools keep, such as reviews and reports" are kept back, and only those', () => {
    for (const f of ['x_review_by', 'x_report_answers', 'x_room_of', 'x_lens', 'x_record', 'hidden']) expect(isCardSkipField(f), f).toBe(true);
    // A key of another tool's own is no OnlyWorlds mark, and a Full pin sends it: the words do not claim otherwise.
    expect(isCardSkipField('x_mytool_note')).toBe(false);
  });

  it('an ordinary filled-in field is sent', () => {
    for (const f of ['birthplace', 'supertype', 'traits', 'story']) expect(isCardSkipField(f), f).toBe(false);
  });
});
