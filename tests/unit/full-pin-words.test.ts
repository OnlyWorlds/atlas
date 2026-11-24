/**
 * The Full pin's words say what a Full pin sends (1.125.18): every filled-in field but what `isCardSkipField` keeps
 * back. Each clause of the words is held to the predicate here, so a change to one shows in the other.
 */
import { describe, it, expect } from 'vitest';
import { FULL_PIN_HINT, FULL_PIN_ON, FULL_PIN_OFF, FULL_PIN_SHOWN_HINT } from '../../src/middle/share-room';
import { isCardSkipField } from '../../src/core/share-payload';

describe('the Full pin says what it sends', () => {
  it('no longer promises every populated field', () => {
    for (const t of [FULL_PIN_HINT, FULL_PIN_ON, FULL_PIN_OFF]) {
      expect(t).not.toMatch(/populated/);
      expect(t).toContain('every filled-in field');
      expect(t).toContain('leaving out when and by whom it was written, the marks OnlyWorlds tools keep on it (such as reviews and reports), and Atlas\'s own working fields (such as alternate names)');
    }
    expect(FULL_PIN_HINT).toContain('Before you publish, the list of what this page shares names every field it sends.');
    for (const t of [FULL_PIN_HINT, FULL_PIN_ON, FULL_PIN_OFF, FULL_PIN_SHOWN_HINT]) {
      expect(t).not.toContain('Publish list');
      expect(t.endsWith('.'), t).toBe(true);
    }
    expect(FULL_PIN_SHOWN_HINT).not.toMatch(/whole profile|populated/);
    expect(FULL_PIN_SHOWN_HINT).toContain('the list of what this page shares names each field');
  });

  it('"when and by whom it was written" is kept back', () => {
    for (const f of ['created_at', 'updated_at', 'created_by', 'changed_by', 'world', 'change_seq']) expect(isCardSkipField(f), f).toBe(true);
  });

  it('"Atlas\'s own working fields, such as alternate names" are kept back', () => {
    for (const f of ['atlas_aliases', 'atlas_dismissed_suggestions', 'image_media_id']) expect(isCardSkipField(f), f).toBe(true);
  });

  it('"the marks OnlyWorlds tools keep, such as reviews and reports" are kept back, and only those', () => {
    for (const f of ['x_review_by', 'x_report_answers', 'x_room_of', 'x_lens', 'x_record', 'hidden', 'known_of']) expect(isCardSkipField(f), f).toBe(true);
    // A key of another tool's own is no OnlyWorlds mark, and a Full pin sends it: the words do not claim otherwise.
    expect(isCardSkipField('x_mytool_note')).toBe(false);
  });

  it('an ordinary filled-in field is sent', () => {
    for (const f of ['birthplace', 'supertype', 'traits', 'story']) expect(isCardSkipField(f), f).toBe(false);
  });
});
