/**
 * The trail's words (#760): the Waymark's name line, from the SDK's `doorsOf`.
 */
import { describe, it, expect } from 'vitest';
import { doorTrail, doorsKeptOf, readCovers, stampKeptOf, stampWordOf } from '../../src/core/door-trail';
import { HIDDEN_SHOWN_ONLINE } from '../../src/core/hidden-mark';
import type { Element } from '../../src/core/types';

const el = (extra: Record<string, unknown>): Element =>
  ({ id: '00000000-0000-4000-8000-0000000000d1', type: 'character', name: 'Ada', ...extra }) as unknown as Element;

describe('the copy and keel\'s read together', () => {
  it('a pulled copy (no doors: the feed serves none) reads keel\'s answer for the same write', () => {
    const pulled = el({ server_updated_at: '2026-10-31T05:57:00+00:00', changed_client: 'lantern', changed_via: 'api' });
    expect(doorTrail(pulled).map(s => s.where)).toEqual(['in Lantern']);
    const read = { doors: { lantern: '2026-10-31T05:57:00+00:00', atlas: '2026-10-30T06:00:00+00:00' }, updated_at: '2026-10-31T05:57:00+00:00' };
    expect(doorTrail(pulled, read).map(s => s.where)).toEqual(['in Lantern', 'in Atlas']);
    expect(doorTrail(el({}), null)).toEqual([]);
  });

  it('a copy newer than the read is the trail until it is read again, whole', () => {
    const read = { doors: { lantern: '2026-10-31T05:50:00+00:00', atlas: '2026-10-30T06:00:00+00:00' }, updated_at: '2026-10-31T05:50:00+00:00' };
    const pulled = el({ server_updated_at: '2026-10-31T05:58:00+00:00', changed_client: 'atlas', changed_via: 'api' });
    expect(readCovers(read, '2026-10-31T05:58:00+00:00')).toBe(false);
    expect(doorTrail(pulled, read)).toEqual([{ where: 'in Atlas', at: '2026-10-31T05:58:00+00:00' }]);
  });

  it('a scrub moves the time and no door: once read, the door keeps its own time', () => {
    const scrubbed = el({ server_updated_at: '2026-10-31T05:59:00+00:00', changed_client: 'atlas', changed_via: 'api' });
    const read = { doors: { atlas: '2026-10-21T06:00:00+00:00' }, updated_at: '2026-10-31T05:59:00+00:00' };
    expect(doorTrail(scrubbed, read)).toEqual([{ where: 'in Atlas', at: '2026-10-21T06:00:00+00:00' }]);
  });

  it('a read of an element keel has no door record on keeps its last write\'s door', () => {
    // keel added `doors` on 2026-10-29 without filling it: an element not written since reads null.
    const at = '2026-10-20T06:00:00+00:00';
    const pulled = el({ server_updated_at: at, changed_client: 'lantern', changed_via: 'api' });
    const read = { doors: null, updated_at: at, changed_client: 'lantern', changed_via: 'api' };
    expect(doorTrail(pulled, read)).toEqual([{ where: 'in Lantern', at }]);
  });

  it('"in code" stands for many doors: its newest says it, once', () => {
    const at = '2026-10-31T05:57:00+00:00';
    const steps = doorTrail(el({ server_updated_at: at, doors: { api: at, sdk: '2026-10-30T06:00:00+00:00', atlas: '2026-10-29T06:00:00+00:00', sync: '2026-10-28T06:00:00+00:00' } }));
    expect(steps).toEqual([{ where: 'in code', at }, { where: 'in Atlas', at: '2026-10-29T06:00:00+00:00' }]);
  });
});

describe('the words, the SDK\'s doorWhere', () => {
  it('says a listed tool by its name, the site, an AI, OnlyWorlds itself, and code for the rest', () => {
    const at = '2026-10-29T12:00:00Z';
    const where = (door: string) => doorTrail(el({ server_updated_at: at, doors: { [door]: at } }))[0]?.where;
    expect(where('atlas')).toBe('in Atlas');
    expect(where('lantern')).toBe('in Lantern');
    expect(where('site')).toBe('on onlyworlds.com');
    for (const d of ['seat', 'mcp', 'declared']) expect(where(d)).toBe('with an AI');
    expect(where('server')).toBe('by OnlyWorlds');
    for (const d of ['sync', 'api', 'v1', 'sdk', 'python', 'toolkit', 'some-unlisted-tool']) expect(where(d)).toBe('in code');
  });
});

describe('doorTrail', () => {
  it('reads newest first, against the baseline Atlas keeps as server_updated_at', () => {
    const steps = doorTrail(el({
      server_updated_at: '2026-10-29T12:00:00Z',
      doors: { site: '2026-10-20T08:00:00+00:00', atlas: '2026-10-29T12:00:00Z', lantern: '2026-10-25T09:30:00Z', mcp: '2026-10-22T10:00:00Z' },
    }));
    expect(steps).toEqual([
      { where: 'in Atlas', at: '2026-10-29T12:00:00Z' },
      { where: 'in Lantern', at: '2026-10-25T09:30:00Z' },
      { where: 'with an AI', at: '2026-10-22T10:00:00Z' },
      { where: 'on onlyworlds.com', at: '2026-10-20T08:00:00+00:00' },
    ]);
  });

  it('falls back to the last write for an element written before doors existed, and is empty with neither', () => {
    expect(doorTrail(el({ server_updated_at: '2026-10-01T00:00:00Z', changed_via: 'site' })))
      .toEqual([{ where: 'on onlyworlds.com', at: '2026-10-01T00:00:00Z' }]);
    expect(doorTrail(el({ server_updated_at: '2026-10-01T00:00:00Z', doors: null, changed_via: null }))).toEqual([]);
    expect(doorTrail(el({}))).toEqual([]);
  });
});

describe('the stamp keeps the answer\'s doors', () => {
  it('takes an object doors and nothing else', () => {
    const doors = { atlas: '2026-10-29T12:00:00Z' };
    expect(doorsKeptOf({ doors })).toEqual({ doors });
    for (const answer of [undefined, null, 'x', {}, { doors: null }, { doors: [] }, { doors: 'atlas' }]) {
      expect(doorsKeptOf(answer)).toBeUndefined();
    }
  });

  it('beside the hidden word, and the hidden mark where keel hides', () => {
    const doors = { atlas: '2026-10-29T12:00:00Z' };
    expect(stampWordOf({ doors })).toEqual({ [HIDDEN_SHOWN_ONLINE]: true, doors });
    expect(stampKeptOf({ doors, hidden: true })).toEqual({ [HIDDEN_SHOWN_ONLINE]: false, hidden: true, doors });
    expect(stampWordOf(undefined)).toBeUndefined();
  });
});
