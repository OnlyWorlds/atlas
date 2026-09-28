/**
 * S361: map coordinates are BOTTOM-left, the schema's (`keel/schema/pin.yaml`:
 * "x/y coordinate, from bottom left of the map"). Leaflet CRS.Simple is
 * bottom-left too, so a stored point IS a Leaflet point and no height enters
 * the conversion. Atlas stored y top-down until S361 and every standard world
 * drew mirrored.
 */
import { describe, it, expect } from 'vitest';
import L from 'leaflet';
import { storageToLeaflet, leafletToStorage } from '../../src/visualization/leaflet-2d/CoordinateUtils';
import { bottomCenter } from '../../src/visualization/leaflet-2d/ZoneOverlay';

describe('storage <-> Leaflet is the identity (bottom-left both sides)', () => {
  it('a stored y is the Leaflet lat, whatever height is passed', () => {
    const ll = storageToLeaflet({ x: 10, y: 30 }, 100);
    expect(ll.lat).toBe(30);
    expect(ll.lng).toBe(10);
    expect(storageToLeaflet({ x: 10, y: 30 }, 5000).lat).toBe(30);
  });

  it('a higher y sits higher on the map (north up)', () => {
    const north = storageToLeaflet({ x: 0, y: 900 }, 1000);
    const south = storageToLeaflet({ x: 0, y: 100 }, 1000);
    expect(north.lat).toBeGreaterThan(south.lat);
  });

  it('round-trips and rounds to whole pixels', () => {
    expect(leafletToStorage(L.latLng(30.4, 10.6), 100)).toEqual({ x: 11, y: 30 });
    expect(leafletToStorage(storageToLeaflet({ x: 250, y: 125 }, 500), 500)).toEqual({ x: 250, y: 125 });
  });
});

describe('a zone label that hangs below its polygon', () => {
  it('anchors at the LOWEST storage y (screen bottom), horizontally centred', () => {
    const anchor = bottomCenter([{ x: 0, y: 100 }, { x: 40, y: 300 }, { x: 20, y: 200 }]);
    expect(anchor).toEqual({ x: 20, y: 100 });
  });
});
