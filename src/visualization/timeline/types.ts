/**
 * Timeline types — minimal shapes for the compact + expanded timeline-bar.
 *
 * Adapted from `tools/little-element-viewer/src/timeline/types.ts` (session 223).
 */

export interface TimelineNode {
  id: string;
  elementType: string;
  name: string;
  startDate: number;
  endDate: number | null;
  color: string;
}

export interface PlacedDot {
  node: TimelineNode;
  x: number;
  y: number;
  radius: number;
}

export interface TimeRange {
  min: number;
  max: number;
}
