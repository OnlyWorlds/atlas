/**
 * The frame a Map is drawn in, and the one rule for what a map's first open may write about its size.
 *
 * A written `width` and `height` above 0 are the frame. Otherwise the picture's own size, measured in this
 * session, when the Map has a picture; otherwise each axis's written size when above 0, else the flat square.
 * A written number is never replaced by Atlas on its own: the map-space reading answers a written size as
 * written, whatever the number, 0 included, so a size of 0 or below is drawn by the picture or the square and
 * stays in the file as it is. Only a missing size (absent or null) takes the picture's measure or the square.
 */

import type { WorldMap } from '../../core/types';
import { IMAGELESS_MAP_SIZE } from '../../ui/image-dims';
import { pickMapImageSource } from './map-image-source';

export interface Frame { w: number; h: number }

const above0 = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** The picture each map's measure was taken from, so a new picture is measured again. */
const measured = new Map<string, { picture: string; w: number; h: number }>();

function pictureOf(map: WorldMap): string | null {
  const s = pickMapImageSource(map);
  if (s.kind === 'url') return `url:${s.url}`;
  if (s.kind === 'local') return `local:${s.mediaId}`;
  return null;
}

/** The written size, when both numbers are above 0. */
export function writtenFrame(map: WorldMap): Frame | null {
  return above0(map.width) && above0(map.height) ? { w: map.width, h: map.height } : null;
}

/** Keep the size the map's current picture decoded to, for this session. */
export function rememberPictureSize(map: WorldMap, size: Frame): void {
  const picture = pictureOf(map);
  if (picture && above0(size.w) && above0(size.h)) measured.set(map.id, { picture, w: size.w, h: size.h });
}

/** A decoded size is a measure only when both sides are above 0 (a picture with no size of its own decodes to 0). */
export function usableMeasure(size: Frame | null): Frame | null {
  return size && above0(size.w) && above0(size.h) ? size : null;
}

/** The size this session measured for the map's current picture, if it did. */
export function measuredPictureSize(map: WorldMap): Frame | null {
  const picture = pictureOf(map);
  const m = measured.get(map.id);
  return picture && m && m.picture === picture ? { w: m.w, h: m.h } : null;
}

/** The frame the map is drawn in (see the head of this file). */
export function drawnFrame(map: WorldMap): Frame {
  return writtenFrame(map) ?? measuredPictureSize(map) ?? {
    w: above0(map.width) ? map.width : IMAGELESS_MAP_SIZE,
    h: above0(map.height) ? map.height : IMAGELESS_MAP_SIZE,
  };
}

/** What a first open may write about the size: only the keys with nothing written (absent or null). */
export function missingSize(map: WorldMap, size: Frame): Partial<Pick<WorldMap, 'width' | 'height'>> {
  const patch: Partial<Pick<WorldMap, 'width' | 'height'>> = {};
  // A foreign file can hold null where the type says number.
  if ((map.width as unknown) == null) patch.width = size.w;
  if ((map.height as unknown) == null) patch.height = size.h;
  return patch;
}

/** Tests only: forget every measure. */
export function _resetMeasuredForTests(): void {
  measured.clear();
}
