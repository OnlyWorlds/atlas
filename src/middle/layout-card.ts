/**
 * The layout recipe card: Map.x_layout, written by a layout method (OW Mapping's
 * staged layouts: `{ method, settings }`, the settings the method's own). It
 * says how the map's pins were placed. Atlas reads it and never writes it.
 *
 * Read-only, in the element page's custom-fields section, in place of the
 * generic structured-JSON row (the same seam as the Tangle cards). Defensive by
 * rule: another tool's value, re-checked here; any shape surprise returns null
 * and the caller falls back to the generic row. The whole recipe stays one
 * press away, as it was written.
 */

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

export interface LayoutRecipe {
  method: string;
  /** The pictured map the layout stands on, by its name, when the recipe names one. */
  groundName: string | null;
}

export function parseLayoutRecipe(value: unknown): LayoutRecipe | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const method = str(v.method);
  if (!method) return null;
  const settings = v.settings && typeof v.settings === 'object' && !Array.isArray(v.settings)
    ? v.settings as Record<string, unknown> : null;
  const ground = settings?.ground_map;
  const groundName = ground && typeof ground === 'object' && !Array.isArray(ground)
    ? str((ground as Record<string, unknown>).name) : null;
  return { method, groundName };
}

/** The card's sentence (plain text): how the pins were placed. */
export function layoutRecipeLine(r: LayoutRecipe): string {
  return r.groundName
    ? `The pins on this map were placed by a layout method, ${r.method}, on the ground of the map ${r.groundName}.`
    : `The pins on this map were placed by a layout method, ${r.method}.`;
}

/** Card for Map.x_layout, or null when the shape surprises. */
export function renderLayoutCard(value: unknown): HTMLElement | null {
  const r = parseLayoutRecipe(value);
  if (!r) return null;
  let raw: string;
  try { raw = JSON.stringify(value, null, 2); } catch { return null; }

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
  source.textContent = r.method;
  head.append(icon, title, source);

  const line = document.createElement('div');
  line.className = 'atlas-tangle-outcome';
  // The sentence of layoutRecipeLine, with its two names in weight so a name with commas reads as one.
  const strong = (s: string): HTMLElement => { const b = document.createElement('span'); b.className = 'atlas-tangle-side-name'; b.textContent = s; return b; };
  line.append('The pins on this map were placed by a layout method, ', strong(r.method));
  if (r.groundName) line.append(', on the ground of the map ', strong(r.groundName));
  line.append('.');

  const flat = document.createElement('div');
  flat.className = 'atlas-tangle-outcome';
  flat.textContent = 'Atlas draws this map flat, seen from above, and never rewrites the recipe.';

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
