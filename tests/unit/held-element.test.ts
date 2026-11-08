import { describe, expect, it } from 'vitest';
import { sameButStamps } from '../../src/middle/held-element';
import type { Element } from '../../src/core/types';

const el = (extra: Record<string, unknown> = {}) =>
  ({ id: 'a', type: 'character', name: 'Ada', friends: ['b'], ...extra }) as unknown as Element;

describe('sameButStamps: the element page may hold its redraw for a press', () => {
  it('a round that only stamped the element is the same element', () => {
    const drawn = el({ local_updated_at: '2026-11-08T10:00:00.000Z' });
    const now = el({
      local_updated_at: '2026-11-08T10:00:01.000Z',
      server_updated_at: '2026-11-08T10:00:01.000Z',
      doors: [{ via: 'atlas' }],
    });
    expect(sameButStamps(drawn, now)).toBe(true);
    // A push that landed drops the last writer's words.
    expect(sameButStamps(el({ changed_by: 'x', changed_via: 'api', changed_client: 'lantern' }), el())).toBe(true);
  });

  it('any value a person reads or edits is a different element', () => {
    expect(sameButStamps(el(), el({ name: 'Ada Lovelace' }))).toBe(false);
    expect(sameButStamps(el(), el({ friends: ['b', 'c'] }))).toBe(false);
    expect(sameButStamps(el(), el({ description: 'new' }))).toBe(false);
    expect(sameButStamps(el({ description: 'old' }), el())).toBe(false);
    // A mark the server settles is not a stamp: the page's offers read it.
    expect(sameButStamps(el(), el({ x_review_proposed: true }))).toBe(false);
  });

  it('another element is never the same', () => {
    expect(sameButStamps(el(), el({ id: 'b' }))).toBe(false);
  });
});
