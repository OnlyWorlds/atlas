/**
 * Pins and markers do not vote (#171, Quillon 2026-10-09, measured on the live
 * demo): a map's backlinks are every pin and marker on it, so the Space Map
 * read "Linked from (118): (unnamed), (unnamed)…". 7 of 16 pins and all 131
 * markers have no name, but every pin points at an element and nearly every
 * marker at a zone.
 *
 * So a backlink list splits in three: the story's links (everything else),
 * pins named by their OTHER end (on a map's page a pin reads as its element;
 * on the element's page it reads as the map it sits on), and markers folded
 * to one line per zone. Pure; the context pane's card and the element page's
 * Referenced by both read it.
 */

import type { Element, Marker, Pin } from './types';

export interface PinBacklink {
  pin: Pin;
  /** What the row says: the pin's other end, never "(unnamed)". */
  label: string;
  /** Where a click goes (the other end), or null when it resolves to nothing. */
  navId: string | null;
}

export interface MarkerFold {
  /** The zone these markers draw, or null for markers with no zone here. */
  zoneId: string | null;
  /** The zone's name ("unnamed zone" when it has none), or null with no zone or when the zone is the subject. */
  zoneName: string | null;
  count: number;
  /** Where a click goes (the zone), or null when the zone is the subject or missing. */
  navId: string | null;
}

export interface FoldedBacklinks {
  story: Element[];
  pins: PinBacklink[];
  markers: MarkerFold[];
  markerCount: number;
}

function nameOf(el: Element | undefined): string {
  return typeof el?.name === 'string' ? el.name.trim() : '';
}

/** A pin read from the subject's side: whatever it joins that is not the subject. */
export function pinBacklink(pin: Pin, subjectId: string, byId: ReadonlyMap<string, Element>): PinBacklink {
  const target = byId.get(pin.element_id);
  const map = byId.get(pin.map_id);
  const targetName = nameOf(target) || nameOf(pin);
  const mapName = nameOf(map);
  if (pin.map_id === subjectId) {
    return { pin, label: targetName || 'unnamed pin', navId: target?.id ?? null };
  }
  if (pin.element_id === subjectId) {
    return { pin, label: mapName ? `on ${mapName}` : (nameOf(pin) || 'unnamed pin'), navId: map?.id ?? null };
  }
  const label = targetName && mapName ? `${targetName}, on ${mapName}` : targetName || mapName || 'unnamed pin';
  return { pin, label, navId: target?.id ?? map?.id ?? null };
}

/**
 * Split the elements that link to `subjectId` into the story's links, pins
 * and per-zone marker folds. Pins sort by label; folds by count, then name,
 * with the no-zone fold last.
 */
export function foldBacklinks(
  sources: readonly Element[],
  subjectId: string,
  byId: ReadonlyMap<string, Element>,
): FoldedBacklinks {
  const story: Element[] = [];
  const pins: PinBacklink[] = [];
  const folds = new Map<string | null, MarkerFold>();
  let markerCount = 0;
  for (const src of sources) {
    if (src.type === 'pin') {
      pins.push(pinBacklink(src as Pin, subjectId, byId));
    } else if (src.type === 'marker') {
      markerCount++;
      const raw = (src as Marker).zone_id;
      const zoneId = typeof raw === 'string' && raw.length > 0 ? raw : null;
      let fold = folds.get(zoneId);
      if (!fold) {
        const zone = zoneId ? byId.get(zoneId) : undefined;
        const isSubject = zoneId === subjectId;
        fold = {
          zoneId,
          zoneName: zoneId === null || isSubject ? null : (nameOf(zone) || 'unnamed zone'),
          count: 0,
          navId: zone && !isSubject ? zone.id : null,
        };
        folds.set(zoneId, fold);
      }
      fold.count++;
    } else {
      story.push(src);
    }
  }
  pins.sort((a, b) => a.label.localeCompare(b.label));
  const markers = Array.from(folds.values()).sort((a, b) => {
    const an = a.zoneId === null ? 1 : 0;
    const bn = b.zoneId === null ? 1 : 0;
    return an - bn || b.count - a.count || (a.zoneName ?? '').localeCompare(b.zoneName ?? '');
  });
  return { story, pins, markers, markerCount };
}

/** "Crumblefields: 16 markers"; a fold whose zone is the subject says only the count. */
export function markerFoldLabel(fold: MarkerFold): string {
  const n = `${fold.count} marker${fold.count === 1 ? '' : 's'}`;
  if (fold.zoneId === null) return `${n} with no zone`;
  return fold.zoneName ? `${fold.zoneName}: ${n}` : n;
}
