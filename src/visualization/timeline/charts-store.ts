/**
 * Saved-chart list helpers — pure operations over ChartConfig[] plus a
 * default-name deriver, so the Charts room's save / rename / delete logic stays
 * declarative and unit-tested independently of the DOM.
 *
 * Charts persist to `.atlas/charts.json` (FolderStore.readCharts/writeCharts);
 * a saved chart is a frozen ChartConfig (DESIGN_CHARTS.md "Storage: local in
 * .atlas/, shared via the block"). NOT an OW element, NOT localStorage.
 */

import type { ChartConfig, ChartScope } from './types';
import type { Element, ElementType } from '../../core/types';
import { ELEMENT_LABELS } from '../../core/constants';

/** Insert a chart, or replace the existing one with the same id. */
export function upsertChart(charts: ChartConfig[], chart: ChartConfig): ChartConfig[] {
  const i = charts.findIndex(c => c.id === chart.id);
  if (i === -1) return [...charts, chart];
  const next = charts.slice();
  next[i] = chart;
  return next;
}

/** Drop the chart with this id (no-op if absent). */
export function removeChart(charts: ChartConfig[], id: string): ChartConfig[] {
  return charts.filter(c => c.id !== id);
}

/** Rename the chart with this id (trims; no-op if absent or the name is blank). */
export function renameChart(charts: ChartConfig[], id: string, name: string): ChartConfig[] {
  const trimmed = name.trim();
  if (!trimmed) return charts;
  return charts.map(c => (c.id === id ? { ...c, name: trimmed } : c));
}

/**
 * Do two scopes describe the same view? Used to highlight the saved chart that
 * matches the live view. Type/selection lists compare order-independently (the
 * live filter Set's iteration order need not match the saved order).
 */
export function sameScope(a: ChartScope, b: ChartScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'all') return true;
  if (a.kind === 'focus' && b.kind === 'focus') return a.elementId === b.elementId;
  if (a.kind === 'types' && b.kind === 'types') return sameIdSet(a.types, b.types);
  if (a.kind === 'selection' && b.kind === 'selection') return sameIdSet(a.elementIds, b.elementIds);
  return false;
}

function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/**
 * Rewrite element ids inside saved chart SCOPES after an id-swap. Make-online
 * re-keys local v4 ids to server v7 ids; charts.json is atlas-local so it is
 * NOT covered by the element-file `rewriteIdReferences` pass — a focus/selection
 * chart would silently point at a dead id. (types/all scopes carry no element
 * ids and are untouched.) Returns the (possibly new) list + whether anything
 * changed, so the caller can skip the write when nothing matched.
 */
export function rewriteChartScopeIds(
  charts: ChartConfig[],
  oldId: string,
  newId: string,
): { charts: ChartConfig[]; changed: boolean } {
  let changed = false;
  const next = charts.map(c => {
    const scope = c.scope;
    if (scope.kind === 'focus' && scope.elementId === oldId) {
      changed = true;
      return { ...c, scope: { kind: 'focus' as const, elementId: newId } };
    }
    if (scope.kind === 'selection' && scope.elementIds.includes(oldId)) {
      changed = true;
      return {
        ...c,
        scope: { kind: 'selection' as const, elementIds: scope.elementIds.map(id => (id === oldId ? newId : id)) },
      };
    }
    return c;
  });
  return { charts: changed ? next : charts, changed };
}

/**
 * A sensible default name for a chart from its scope, so Save needs no prompt
 * (rename lives in the gallery). Focus → the element's name; types → the type
 * labels; all → "Everything".
 */
export function defaultChartName(scope: ChartScope, elements: Element[]): string {
  switch (scope.kind) {
    case 'all':
      return 'Everything';
    case 'focus': {
      const el = elements.find(e => e.id === scope.elementId);
      const name = el?.name?.trim();
      return name ? name : 'Focused chart';
    }
    case 'types':
      return typesName(scope.types);
    case 'selection':
      return `Selection (${scope.elementIds.length})`;
    default:
      return 'Chart';
  }
}

function typesName(types: ElementType[]): string {
  if (types.length === 0) return 'Empty chart';
  const labels = types.map(t => ELEMENT_LABELS[t]?.plural ?? t);
  const joined =
    labels.length <= 2
      ? labels.join(' & ')
      : `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}
