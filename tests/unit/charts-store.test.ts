import { describe, it, expect } from 'vitest';
import {
  defaultChartName,
  upsertChart,
  removeChart,
  renameChart,
  sameScope,
  rewriteChartScopeIds,
} from '../../src/visualization/timeline/charts-store';
import type { ChartConfig, ChartScope } from '../../src/visualization/timeline/types';
import type { Element, ElementType } from '../../src/core/types';
import { MockFolderStore } from '../fixtures/mock-folder-store';

function chart(id: string, name: string, scope: ChartScope): ChartConfig {
  return { schema_version: 1, id, name, axis: { kind: 'time', direction: 'both' }, scope, render: '2d' };
}
function el(id: string, type: string, name: string): Element {
  return { id, type, name } as Element;
}

describe('charts-store helpers', () => {
  it('upsert inserts, then replaces by id', () => {
    let list = upsertChart([], chart('1', 'A', { kind: 'all' }));
    expect(list).toHaveLength(1);
    list = upsertChart(list, chart('1', 'A renamed', { kind: 'all' }));
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('A renamed');
  });

  it('remove drops by id, no-op when absent', () => {
    const a = chart('1', 'A', { kind: 'all' });
    expect(removeChart([a], '1')).toHaveLength(0);
    expect(removeChart([a], 'x')).toHaveLength(1);
  });

  it('rename trims and ignores blanks', () => {
    const a = chart('1', 'A', { kind: 'all' });
    expect(renameChart([a], '1', '  B  ')[0].name).toBe('B');
    expect(renameChart([a], '1', '   ')[0].name).toBe('A');
  });

  it('sameScope compares kind + lists order-independently', () => {
    expect(sameScope({ kind: 'all' }, { kind: 'all' })).toBe(true);
    expect(sameScope({ kind: 'focus', elementId: 'x' }, { kind: 'focus', elementId: 'x' })).toBe(true);
    expect(sameScope({ kind: 'focus', elementId: 'x' }, { kind: 'focus', elementId: 'y' })).toBe(false);
    expect(sameScope(
      { kind: 'types', types: ['event', 'character'] as ElementType[] },
      { kind: 'types', types: ['character', 'event'] as ElementType[] },
    )).toBe(true);
    expect(sameScope({ kind: 'all' }, { kind: 'focus', elementId: 'x' })).toBe(false);
  });

  it('defaultChartName derives a readable name from scope', () => {
    const els = [el('c1', 'character', 'Alice'), el('e1', 'event', 'Battle')];
    expect(defaultChartName({ kind: 'all' }, els)).toBe('Everything');
    expect(defaultChartName({ kind: 'focus', elementId: 'c1' }, els)).toBe('Alice');
    expect(defaultChartName({ kind: 'focus', elementId: 'missing' }, els)).toBe('Focused chart');
    expect(defaultChartName({ kind: 'types', types: ['character'] as ElementType[] }, els)).toBe('Characters');
    expect(defaultChartName({ kind: 'types', types: ['character', 'event'] as ElementType[] }, els)).toBe('Characters & events');
  });
});

describe('FolderStore charts round-trip (mock contract)', () => {
  it('reads empty, writes, reads back defensive copies', async () => {
    const store = new MockFolderStore();
    await store.open(null);
    expect(await store.readCharts()).toEqual([]);
    const a = chart('1', 'A', { kind: 'all' });
    await store.writeCharts([a]);
    const back = await store.readCharts();
    expect(back).toHaveLength(1);
    expect(back[0]).toEqual(a);
    expect(back[0]).not.toBe(a);
  });
});

describe('rewriteChartScopeIds (id-swap migration)', () => {
  it('rewrites focus + selection element ids, leaves types/all untouched', () => {
    const charts = [
      chart('1', 'F', { kind: 'focus', elementId: 'old' }),
      chart('2', 'S', { kind: 'selection', elementIds: ['a', 'old', 'b'] }),
      chart('3', 'T', { kind: 'types', types: ['event'] as ElementType[] }),
    ];
    const { charts: next, changed } = rewriteChartScopeIds(charts, 'old', 'new');
    expect(changed).toBe(true);
    expect((next[0].scope as { elementId: string }).elementId).toBe('new');
    expect((next[1].scope as { elementIds: string[] }).elementIds).toEqual(['a', 'new', 'b']);
    expect(next[2]).toBe(charts[2]); // unchanged refs stay identical
  });

  it('no-op (returns the same array) when nothing matches', () => {
    const charts = [chart('1', 'A', { kind: 'all' })];
    const { charts: next, changed } = rewriteChartScopeIds(charts, 'x', 'y');
    expect(changed).toBe(false);
    expect(next).toBe(charts);
  });
});
