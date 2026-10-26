/**
 * Where each Web tab label goes (#141). The map rule from #121, applied
 * to the graph: labels yield, nodes never vanish. Each label takes the first
 * clear side of its node (below, right, left, above) or waits for hover.
 * "Clear" means inside the frame, off every node and off every label already
 * placed. Labels are placed in priority order, so the subject and the
 * selection always speak first, then the most connected.
 *
 * Pure over boxes: the graph measures each label once and hands in sizes and
 * screen positions, so the rule is testable without a layout engine.
 */

export type GraphLabelSide =
  | 'below' | 'right' | 'left' | 'above'
  | 'below-right' | 'below-left' | 'above-right' | 'above-left';

/** In order of preference: the four sides, then the four corners. */
export const GRAPH_LABEL_SIDES: readonly GraphLabelSide[] = [
  'below', 'right', 'left', 'above', 'below-right', 'below-left', 'above-right', 'above-left',
];

export interface GraphLabelItem {
  id: string;
  /** Node centre, in frame pixels. */
  cx: number;
  cy: number;
  /** Node radius in pixels. */
  r: number;
  /** The label's own size in pixels. */
  w: number;
  h: number;
  /** Higher places first; ties keep input order. */
  priority: number;
  /**
   * The subject and the selection always speak: with no clear side the label
   * still prints below, and every later label keeps off it.
   */
  always?: boolean;
}

export interface Box { left: number; top: number; right: number; bottom: number }

/** Gap between a node's edge and its label: matches the CSS margins. */
export const LABEL_GAP = 2;
/** Air kept between two labels and between a label and a node. */
const PAD = 2;
/**
 * A corner label's near corner, in radii from the centre on each axis: 0.75
 * puts it just outside the rim (0.75 x sqrt 2 = 1.06). The CSS says 87.5%
 * (50% + 0.75 x 50%); change both together.
 */
const CORNER = 0.75;

export function labelBoxFor(item: GraphLabelItem, side: GraphLabelSide): Box {
  const { cx, cy, r, w, h } = item;
  switch (side) {
    case 'below': return { left: cx - w / 2, top: cy + r + LABEL_GAP, right: cx + w / 2, bottom: cy + r + LABEL_GAP + h };
    case 'above': return { left: cx - w / 2, top: cy - r - LABEL_GAP - h, right: cx + w / 2, bottom: cy - r - LABEL_GAP };
    case 'right': return { left: cx + r + LABEL_GAP * 2, top: cy - h / 2, right: cx + r + LABEL_GAP * 2 + w, bottom: cy + h / 2 };
    case 'left': return { left: cx - r - LABEL_GAP * 2 - w, top: cy - h / 2, right: cx - r - LABEL_GAP * 2, bottom: cy + h / 2 };
    // Corners: the label's near corner sits just past the circle's 45-degree point.
    case 'below-right': return { left: cx + r * CORNER, top: cy + r * CORNER, right: cx + r * CORNER + w, bottom: cy + r * CORNER + h };
    case 'below-left': return { left: cx - r * CORNER - w, top: cy + r * CORNER, right: cx - r * CORNER, bottom: cy + r * CORNER + h };
    case 'above-right': return { left: cx + r * CORNER, top: cy - r * CORNER - h, right: cx + r * CORNER + w, bottom: cy - r * CORNER };
    case 'above-left': return { left: cx - r * CORNER - w, top: cy - r * CORNER - h, right: cx - r * CORNER, bottom: cy - r * CORNER };
  }
}

function overlaps(a: Box, b: Box, pad: number): boolean {
  return a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
}

/** A box against a circle: the nearest point of the box to the centre. */
function hitsCircle(b: Box, cx: number, cy: number, r: number): boolean {
  const nx = Math.min(Math.max(cx, b.left), b.right);
  const ny = Math.min(Math.max(cy, b.top), b.bottom);
  return (nx - cx) ** 2 + (ny - cy) ** 2 < (r + PAD) ** 2;
}

/**
 * The side each label takes, or null when no side is clear (the label then
 * shows only on hover). A label with no size (not laid out) is placed below.
 */
export function placeGraphLabels(
  items: readonly GraphLabelItem[],
  frame: { w: number; h: number },
): Map<string, GraphLabelSide | null> {
  const out = new Map<string, GraphLabelSide | null>();
  const order = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (b.it.priority - a.it.priority) || (a.i - b.i));
  const placed: Box[] = [];
  for (const { it } of order) {
    if (it.w <= 0 || it.h <= 0) { out.set(it.id, 'below'); continue; }
    // Each side's cost: what it would cover. A clear side costs 0; the
    // first clear one wins. An `always` label with none takes the cheapest.
    let chosen: GraphLabelSide | null = null;
    let cheapest: { side: GraphLabelSide; cost: number } | null = null;
    for (const side of GRAPH_LABEL_SIDES) {
      const b = labelBoxFor(it, side);
      const outside = b.left < 0 || b.top < 0 || b.right > frame.w || b.bottom > frame.h;
      const cost = (outside ? 100 : 0)
        + placed.filter(p => overlaps(b, p, PAD)).length * 10
        + items.filter(n => n.id !== it.id && hitsCircle(b, n.cx, n.cy, n.r)).length;
      if (cost === 0) { chosen = side; break; }
      if (!cheapest || cost < cheapest.cost) cheapest = { side, cost };
    }
    if (!chosen && it.always && cheapest) chosen = cheapest.side;
    if (chosen) placed.push(labelBoxFor(it, chosen));
    out.set(it.id, chosen);
  }
  return out;
}
