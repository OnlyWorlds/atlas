/**
 * The frame a Map is drawn in, and the one rule for what a map's first open may write about its size.
 *
 * A written `width` and `height` above 0 are the frame. Otherwise the picture's own size (measured this
 * session, else kept in this browser from an earlier one) when the Map has a picture; otherwise each axis's written size when above 0, else the flat square.
 * A written number is never replaced by Atlas on its own: the map-space reading answers a written size as
 * written, whatever the number, 0 included, so a size of 0 or below is drawn by the picture or the square and
 * stays in the file as it is. Only a missing size (absent or null) takes the picture's measure or the square.
 */

import type { WorldMap } from '../../core/types';
import { IMAGELESS_MAP_SIZE } from '../../ui/image-dims';
import { pickMapImageSource } from './map-image-source';

export interface Frame { w: number; h: number }

const above0 = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * The picture each map's measure was taken from, so a new picture is measured again. `session`: decoded in
 * this session; a measure read back from the browser is not, so the picture is still decoded once a session
 * (a picture replaced at the same address heals by the flip).
 */
const measured = new Map<string, { picture: string; w: number; h: number; session: boolean }>();
/** Maps whose browser store held no measure this session: read once, not at every frame. */
const missed = new Set<string>();

/**
 * The measures outlive the session in this browser, so a map drawn in its picture's measure opens in that
 * frame at once, its saved camera kept: drawn first in the square and then in the measure, every load flipped
 * the frame and cleared the camera. A picture changed at the same address is measured again and flips as
 * before. Advisory: a store that cannot be read or written only costs that flip.
 */
const MEASURES_KEY = 'atlas_map_picture_measures';
const MEASURES_CAP = 300;
type Measure = { picture: string; w: number; h: number };

function readMeasures(): Record<string, Measure> {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEASURES_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, Measure> : {};
  } catch {
    return {};
  }
}

function keptMeasure(mapId: string): Measure | null {
  const m = readMeasures()[mapId];
  return m && typeof m.picture === 'string' && above0(m.w) && above0(m.h) ? { picture: m.picture, w: m.w, h: m.h } : null;
}

function keepMeasure(mapId: string, m: Measure): void {
  try {
    const store = readMeasures();
    delete store[mapId]; // re-inserted last, so the cap drops the longest unmeasured first
    store[mapId] = m;
    const ids = Object.keys(store);
    for (const id of ids.slice(0, Math.max(0, ids.length - MEASURES_CAP))) delete store[id];
    localStorage.setItem(MEASURES_KEY, JSON.stringify(store));
  } catch { /* quota or a private window: the next load measures again */ }
}

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

/** Keep the size the map's current picture decoded to, in memory and in this browser. */
export function rememberPictureSize(map: WorldMap, size: Frame): void {
  const picture = pictureOf(map);
  if (!picture || !above0(size.w) || !above0(size.h)) return;
  const prior = measured.get(map.id);
  measured.set(map.id, { picture, w: size.w, h: size.h, session: true });
  missed.delete(map.id);
  if (prior?.picture === picture && prior.w === size.w && prior.h === size.h) return;
  keepMeasure(map.id, { picture, w: size.w, h: size.h });
}

/** The size this session decoded for the map's current picture: the decode is skipped only on this. */
export function sessionPictureSize(map: WorldMap): Frame | null {
  const picture = pictureOf(map);
  const m = measured.get(map.id);
  return picture && m && m.session && m.picture === picture ? { w: m.w, h: m.h } : null;
}

/** A decoded size is a measure only when both sides are above 0 (a picture with no size of its own decodes to 0). */
export function usableMeasure(size: Frame | null): Frame | null {
  return size && above0(size.w) && above0(size.h) ? size : null;
}

/** The measure of the map's current picture: this session's, else the one kept in this browser. */
export function measuredPictureSize(map: WorldMap): Frame | null {
  const picture = pictureOf(map);
  if (!picture) return null;
  let m = measured.get(map.id);
  if (!m && !missed.has(map.id)) {
    const kept = keptMeasure(map.id);
    if (kept) { m = { ...kept, session: false }; measured.set(map.id, m); }
    else missed.add(map.id);
  }
  return m && m.picture === picture ? { w: m.w, h: m.h } : null;
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
  missed.clear();
  try { localStorage.removeItem(MEASURES_KEY); } catch { /* no storage */ }
}

/** Tests only: forget the session's measures, as a reload does, keeping the browser's. */
export function _forgetSessionMeasuresForTests(): void {
  measured.clear();
  missed.clear();
}
