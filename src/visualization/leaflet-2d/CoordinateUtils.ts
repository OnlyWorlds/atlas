/**
 * OnlyWorlds Leaflet 2D - Coordinate Utilities
 *
 * Conversion between Leaflet coordinates and storage coordinates.
 *
 * Leaflet CRS.Simple uses bottom-left origin (Y increases upward)
 * Storage/API uses top-left origin (Y increases downward)
 *
 * Aligned with OnlyWorlds map tool: onlyworlds.com/maptool
 */

import L from 'leaflet';
import type { StoragePoint } from './types';

/**
 * Convert Leaflet LatLng to storage coordinates
 * Used when: user clicks on canvas, saving marker positions
 *
 * @param latlng - Leaflet LatLng position
 * @param canvasHeight - Height of the canvas in pixels
 * @returns Storage coordinates (top-left origin)
 */
export function leafletToStorage(latlng: L.LatLng, canvasHeight: number): StoragePoint {
  return {
    x: Math.round(latlng.lng),
    y: Math.round(canvasHeight - latlng.lat)
  };
}

/**
 * Convert storage coordinates to Leaflet LatLng
 * Used when: loading markers from storage, rendering on canvas
 *
 * @param point - Storage coordinates (top-left origin)
 * @param canvasHeight - Height of the canvas in pixels
 * @returns Leaflet LatLng position
 */
export function storageToLeaflet(point: StoragePoint, canvasHeight: number): L.LatLng {
  return L.latLng(
    canvasHeight - point.y,
    point.x
  );
}

/**
 * Convert array of storage points to Leaflet LatLng array
 * Used for: rendering polygons, polylines, and connection paths
 *
 * @param points - Array of storage coordinates
 * @param canvasHeight - Height of the canvas in pixels
 * @returns Array of Leaflet LatLng positions
 */
export function pointsToLatLngs(points: StoragePoint[], canvasHeight: number): L.LatLng[] {
  return points.map(p => storageToLeaflet(p, canvasHeight));
}

/**
 * Convert array of Leaflet LatLngs to storage points
 * Used for: saving polygon/polyline data
 *
 * @param latlngs - Array of Leaflet LatLng positions
 * @param canvasHeight - Height of the canvas in pixels
 * @returns Array of storage coordinates
 */
export function latLngsToPoints(latlngs: L.LatLng[], canvasHeight: number): StoragePoint[] {
  return latlngs.map(ll => leafletToStorage(ll, canvasHeight));
}

/**
 * Calculate center point of multiple storage points
 *
 * @param points - Array of storage coordinates
 * @returns Center point in storage coordinates
 */
export function getCenterPoint(points: StoragePoint[]): StoragePoint {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 }
  );

  return {
    x: Math.round(sum.x / points.length),
    y: Math.round(sum.y / points.length)
  };
}

/**
 * Calculate bounding box of multiple storage points
 *
 * @param points - Array of storage coordinates
 * @returns Bounding box { minX, minY, maxX, maxY }
 */
export function getBoundingBox(points: StoragePoint[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return {
    minX: Math.min(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)),
    maxX: Math.max(...points.map(p => p.x)),
    maxY: Math.max(...points.map(p => p.y))
  };
}

/**
 * Calculate distance between two storage points
 *
 * @param p1 - First point
 * @param p2 - Second point
 * @returns Euclidean distance
 */
export function getDistance(p1: StoragePoint, p2: StoragePoint): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Generate a UUID for local entities
 */
export function generateId(): string {
  return crypto.randomUUID();
}
