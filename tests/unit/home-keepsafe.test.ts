/**
 * The keep-safe card (1.17 bout 5, contract §6.1):
 * shown for a world of the user's own kept in this browser once it
 * holds something worth keeping; hidden for a week by × or by a download,
 * and back only when the world changed since; reduced, never hidden, for a
 * world online or exported as JSON.
 */
import { describe, expect, it } from 'vitest';
import { keepSafeCard, KEEPSAFE_THRESHOLD } from '../../src/middle/home-keepsafe';
import type { Element, WorldRegistryEntry } from '../../src/core/types';

const NOW = Date.parse('2026-10-20T12:00:00.000Z');
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();

function entry(over: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry {
  return { id: 'w1', name: 'W', state: 'local-only', where: 'browser', created_at: '2026-10-01T00:00:00.000Z', folder: { handle_key: 'world-x', folder_name: 'w-x-1a2b' }, ...over };
}
function chars(n: number, at = NOW - 3 * DAY): Element[] {
  return Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `C${i}`, type: 'character', local_updated_at: iso(at) }) as unknown as Element);
}
const card = (e: WorldRegistryEntry, els: Element[], over: { loading?: boolean } = {}) =>
  keepSafeCard({ entry: e, elements: els, loading: over.loading ?? false, now: NOW });

describe('keepSafeCard', () => {
  it(`shows past ${KEEPSAFE_THRESHOLD} elements, a scene with words, or a map with an image`, () => {
    expect(card(entry(), chars(KEEPSAFE_THRESHOLD - 1))).toBeNull();
    expect(card(entry(), chars(KEEPSAFE_THRESHOLD))).toEqual({ reduced: null });
    const scene = { id: 'n', name: 'Ch 1', type: 'narrative', story: 'It began.', local_updated_at: iso(NOW) } as unknown as Element;
    expect(card(entry(), [scene])).toEqual({ reduced: null });
    expect(card(entry(), [{ ...scene, story: '   ' } as Element])).toBeNull();
    const map = { id: 'm', name: 'Map', type: 'map', image_url: 'https://x/y.png', local_updated_at: iso(NOW) } as unknown as Element;
    expect(card(entry(), [map])).toEqual({ reduced: null });
    expect(card(entry(), [{ ...map, image_url: undefined, image_media_id: 'media-1' } as unknown as Element])).toEqual({ reduced: null });
  });

  it('never for a folder world, the tour, a view-only world, a cleared one, or while loading', () => {
    const els = chars(30);
    expect(card(entry({ where: undefined }), els)).toBeNull();
    expect(card(entry({ demo: true }), els)).toBeNull();
    expect(card(entry({ state: 'api-linked', api: { world_id: 's', api_key: 'k', read_only: true } }), els)).toBeNull();
    expect(card(entry({ cleared_at: iso(NOW) }), els)).toBeNull();
    expect(card(entry(), els, { loading: true })).toBeNull();
  });

  it('a download hides it until the world changed since AND a week has passed', () => {
    const els = chars(30, NOW - 3 * DAY);
    expect(card(entry({ kept_download_at: iso(NOW - 2 * DAY) }), els)).toBeNull();                        // nothing changed since
    expect(card(entry({ kept_download_at: iso(NOW - 2 * DAY) }), chars(30, NOW - DAY))).toBeNull();          // changed, but under a week
    expect(card(entry({ kept_download_at: iso(NOW - 8 * DAY) }), els)).toEqual({ reduced: null });           // changed after, a week on
    expect(card(entry({ kept_download_at: iso(NOW - 8 * DAY) }), chars(30, NOW - 9 * DAY))).toBeNull();      // a week on, nothing changed
  });

  it('× hides it for a week', () => {
    expect(card(entry({ keep_nudge_snoozed_until: iso(NOW + DAY) }), chars(30))).toBeNull();
    expect(card(entry({ keep_nudge_snoozed_until: iso(NOW - 1) }), chars(30))).toEqual({ reduced: null });
  });

  it('online or exported as JSON: still shown, reduced', () => {
    expect(card(entry({ state: 'api-linked', api: { world_id: 's', api_key: 'k' } }), chars(30))).toEqual({ reduced: 'online' });
    expect(card(entry({ kept_export_at: iso(NOW - DAY) }), chars(30))).toEqual({ reduced: 'export' });
  });
});
