/**
 * Timeline types — minimal shapes for the compact + expanded timeline-bar.
 *
 * Adapted from `tools/little-element-viewer/src/timeline/types.ts` (session 223).
 */

/**
 * A resolved link from a timeline node to another element it touches —
 * the wedge data. Surfaced as a clickable chip in the node's card.
 */
export interface LinkedRef {
  id: string;
  type: string;
  name: string;
  /** Humanised relation-field label, e.g. "Birthplace", "Participants". */
  fieldLabel: string;
}

export interface TimelineNode {
  id: string;
  elementType: string;
  name: string;
  startDate: number;
  endDate: number | null;
  color: string;
  /**
   * Elements this node links to (via its relation fields). A pure graph read
   * — never stored. Empty when the element has no resolved relations. This is
   * the wedge: every competitor caps an event at one link; we surface them all.
   */
  links: LinkedRef[];
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
