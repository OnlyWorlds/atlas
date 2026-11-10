/**
 * The layout recipe card: Map.x_layout, written by a layout method (its shape is read in one
 * place, `core/layout-recipe.ts`). It says how the map's pins were placed. Atlas reads it and never writes it.
 *
 * Read-only, in the element page's custom-fields section, in place of the
 * generic structured-JSON row (the same seam as the Tangle cards). Defensive by
 * rule: another tool's value, re-checked here; any shape surprise returns null
 * and the caller falls back to the generic row. The whole recipe stays one
 * press away, as it was written.
 */
import { parseLayoutRecipe } from '../core/layout-recipe';

export interface LayoutCardInput {
  method: string;
  /** The ground map's name: the recipe's own, else the ground Map's in this world; null when neither. */
  groundName: string | null;
  /** Atlas draws the ground under the pins (the ground found in this world, with a picture or zones). */
  groundDrawn: boolean;
}

/** The card's sentence (plain text): how the pins were placed. */
export function layoutRecipeLine(r: Pick<LayoutCardInput, 'method' | 'groundName'>): string {
  return r.groundName
    ? `The pins on this map were placed by a layout method, ${r.method}, on the ground of the map ${r.groundName}.`
    : `The pins on this map were placed by a layout method, ${r.method}.`;
}

/** The card's second line: how Atlas draws it. */
export function layoutDrawnLine(groundDrawn: boolean): string {
  return groundDrawn
    ? 'Atlas draws this map flat, seen from above, with the ground map drawn under the pins, and never rewrites the recipe.'
    : 'Atlas draws this map flat, seen from above, and never rewrites the recipe.';
}

/**
 * Card for Map.x_layout, or null when the shape surprises. `groundOf` answers the ground's name and whether its
 * picture is drawn, from the world (the caller's); absent, the recipe alone speaks.
 */
export function renderLayoutCard(value: unknown, groundOf?: (mapId: string) => { name: string | null; drawn: boolean } | null): HTMLElement | null {
  const r = parseLayoutRecipe(value);
  if (!r) return null;
  let raw: string;
  try { raw = JSON.stringify(value, null, 2); } catch { return null; }
  const found = r.ground?.mapId && groundOf ? groundOf(r.ground.mapId) : null;
  const input: LayoutCardInput = {
    method: r.method,
    groundName: r.ground?.name ?? found?.name ?? null,
    groundDrawn: found?.drawn === true,
  };

  const card = document.createElement('div');
  card.className = 'atlas-tangle-card atlas-layout-card';
  card.dataset.role = 'layout-card';

  const head = document.createElement('div');
  head.className = 'atlas-tangle-card-head';
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'scatter_plot';
  const title = document.createElement('span');
  title.className = 'atlas-tangle-card-title';
  title.textContent = 'Layout';
  const source = document.createElement('span');
  source.className = 'atlas-tangle-card-source';
  source.textContent = input.method;
  head.append(icon, title, source);

  const line = document.createElement('div');
  line.className = 'atlas-tangle-outcome';
  // The sentence of layoutRecipeLine, with its two names in weight so a name with commas reads as one.
  const strong = (s: string): HTMLElement => { const b = document.createElement('span'); b.className = 'atlas-tangle-side-name'; b.textContent = s; return b; };
  line.append('The pins on this map were placed by a layout method, ', strong(input.method));
  if (input.groundName) line.append(', on the ground of the map ', strong(input.groundName));
  line.append('.');

  const flat = document.createElement('div');
  flat.className = 'atlas-tangle-outcome';
  flat.textContent = layoutDrawnLine(input.groundDrawn);

  const fold = document.createElement('details');
  fold.className = 'atlas-layout-card-recipe';
  const summary = document.createElement('summary');
  summary.textContent = 'The recipe as written';
  const pre = document.createElement('pre');
  pre.className = 'atlas-custom-structured-value';
  pre.textContent = raw;
  fold.append(summary, pre);

  card.append(head, line, flat, fold);
  return card;
}

/** What the Pin's own Map is, for the hand mark (rules 8 and 10): no layout, a board (`"hand"`), or laid out by a method. */
export type HandMapKind = 'plain' | 'board' | 'method';

/** The hand card's sentence (the map-space profile's rule 10): what `x_hand: true` does, read against the Pin's own Map. */
export function handLine(kind: HandMapKind): string {
  if (kind === 'method') return 'When this map is laid out again, this pin stays where it is. Remove this mark to let the layout place it.';
  if (kind === 'board') return 'This map is a board, so every pin on it stays where it is placed, with or without this mark.';
  return 'This map is not laid out, so the mark changes nothing here.';
}

/** Card for a Pin's `x_hand`, or null when the value is not exactly `true` (then it is no mark: the generic row). */
export function renderHandCard(value: unknown, kind: HandMapKind): HTMLElement | null {
  if (value !== true) return null;
  const card = document.createElement('div');
  card.className = 'atlas-tangle-card atlas-layout-card';
  card.dataset.role = 'hand-card';
  const head = document.createElement('div');
  head.className = 'atlas-tangle-card-head';
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'pan_tool';
  const title = document.createElement('span');
  title.className = 'atlas-tangle-card-title';
  title.textContent = 'Placed by hand';
  head.append(icon, title);
  const line = document.createElement('div');
  line.className = 'atlas-tangle-outcome';
  line.textContent = handLine(kind);
  card.append(head, line);
  return card;
}
