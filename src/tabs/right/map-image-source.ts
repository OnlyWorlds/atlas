/**
 * Image source selection for map rendering.
 *
 * Pure helper extracted from map-tab so the precedence rule is
 * unit-testable without a Leaflet DOM mount.
 *
 * Rule (DESIGN_MAPS.md §4): image_url is canonical and wins. image_media_id
 * is the atlas-local fallback used only when no URL is set.
 *
 *   1. image_url present (non-empty string)  → { kind: 'url', url }
 *   2. image_media_id present                → { kind: 'local', mediaId }
 *   3. neither                               → { kind: 'flat' } (the sized
 *      flat canvas — imageless maps are first-class)
 */

import type { WorldMap } from '../../core/types';

export type MapImageSource =
  | { kind: 'url'; url: string }
  | { kind: 'local'; mediaId: string }
  | { kind: 'flat' };

export function pickMapImageSource(map: Pick<WorldMap, 'image_url' | 'image_media_id'>): MapImageSource {
  const url = typeof map.image_url === 'string' ? map.image_url.trim() : '';
  if (url) return { kind: 'url', url };
  if (map.image_media_id) return { kind: 'local', mediaId: map.image_media_id };
  return { kind: 'flat' };
}
