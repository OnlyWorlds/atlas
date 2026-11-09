/**
 * A layout method's recipe on a Map (x_layout; the SDK's shape: settings.ground {map, width, height,
 * name?} and settings.margin). The card says how the pins were placed; the ground's picture is drawn under the
 * pins of a Map with none of its own, where the recipe says the ground lies; the card and the canvas read one rule.
 * Another tool's value: a shape surprise falls back (the generic row, no underlay), and its text is never markup.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { parseLayoutRecipe, layoutGroundOf } from '../../src/core/layout-recipe';
import { layoutRecipeLine, layoutDrawnLine, renderLayoutCard } from '../../src/middle/layout-card';
import { layoutUnderlayFor, layoutUnderlayKey } from '../../src/tabs/right/layout-underlay';
import { buildCustomFieldsSection } from '../../src/middle/element-detail-custom-fields';
import { patchSlice } from '../../src/core/state';
import type { Element, WorldMap } from '../../src/core/types';

const GROUND = 'g-1';
const recipe = {
  method: 'trail-by-place',
  settings: { ground: { map: GROUND, width: 3462, height: 4676 }, margin: 300, depth: 900 },
};
const layoutMap = { id: 'm1', type: 'map', name: 'Layout', width: 4062, height: 5276, x_layout: recipe } as unknown as WorldMap;
const groundMap = { id: GROUND, type: 'map', name: 'The way south, 1847-49', image_url: 'https://media.example/route.webp' } as unknown as WorldMap;

describe('the recipe', () => {
  it('reads the method, the ground and the margin', () => {
    expect(parseLayoutRecipe(recipe)).toEqual({
      method: 'trail-by-place', ground: { mapId: GROUND, name: null, width: 3462, height: 4676 }, margin: 300,
    });
  });

  it('a shape surprise is null, a malformed part is absent', () => {
    for (const v of [null, 'x', [recipe], {}, { method: '' }, { method: 7 }]) expect(parseLayoutRecipe(v)).toBeNull();
    expect(parseLayoutRecipe({ method: 'm', settings: { ground: { map: 3, width: -1, height: 2.5 }, margin: '300' } }))
      .toEqual({ method: 'm', ground: { mapId: null, name: null, width: null, height: null }, margin: null });
  });

  it('the ground lies at the margin, at its own size, on the layout\'s axes', () => {
    const g = layoutGroundOf(layoutMap, [layoutMap, groundMap])!;
    expect(g.ground.id).toBe(GROUND);
    expect(g.sw).toEqual({ x: 300, y: 300 });
    expect(g.ne).toEqual({ x: 3762, y: 4976 });
  });

  it('no ground unless every part holds and the ground is another Map of this world', () => {
    const no = (x_layout: unknown, els: Element[] = [layoutMap, groundMap]) =>
      expect(layoutGroundOf({ id: 'm1', x_layout }, els)).toBeNull();
    no({ ...recipe, settings: { ...recipe.settings, margin: undefined } });
    no({ ...recipe, settings: { ...recipe.settings, ground: { width: 3462, height: 4676 } } });
    no({ ...recipe, settings: { ...recipe.settings, ground: { ...recipe.settings.ground, map: 'm1' } } });
    no(recipe, [layoutMap]);
    no(recipe, [layoutMap, { ...groundMap, type: 'location' } as unknown as Element]);
  });
});

describe('the underlay', () => {
  it('a pictureless layout Map draws its ground\'s picture', () => {
    const u = layoutUnderlayFor(layoutMap, [layoutMap, groundMap])!;
    expect(u.source).toEqual({ kind: 'url', url: 'https://media.example/route.webp' });
    expect(layoutUnderlayKey(u)).toBe('|ground:g-1:url:https://media.example/route.webp:300,300,3762,4976:z0:0');
  });

  it('a Map with its own picture keeps it, and a ground with none draws nothing', () => {
    expect(layoutUnderlayFor({ ...layoutMap, image_url: 'https://own.example/a.png' } as WorldMap, [layoutMap, groundMap])).toBeNull();
    expect(layoutUnderlayFor(layoutMap, [layoutMap, { ...groundMap, image_url: '' } as WorldMap])).toBeNull();
    expect(layoutUnderlayKey(null)).toBe('');
  });

  it('the ground\'s zones move onto the layout by the margin, a line open and an area closed', () => {
    const z = (id: string, shape: string) => ({ id, type: 'zone', name: id, shape } as unknown as Element);
    const mk = (zone: string, order: number, x: number, y: number) =>
      ({ id: `${zone}-${order}`, type: 'marker', map_id: GROUND, zone_id: zone, order, x, y } as unknown as Element);
    const els = [layoutMap, { ...groundMap, image_url: '' } as WorldMap, z('river', 'line'), z('land', 'polygon'),
      mk('river', 1, 10, 20), mk('river', 0, 0, 0), mk('land', 0, 0, 0), mk('land', 1, 5, 0), mk('land', 2, 5, 5),
      z('lonely', 'line'), mk('lonely', 0, 1, 1)];
    const u = layoutUnderlayFor(layoutMap, els)!;
    expect(u.source).toBeNull();
    expect(u.shapes).toEqual([
      { line: true, points: [{ x: 300, y: 300 }, { x: 310, y: 320 }] },
      { line: false, points: [{ x: 300, y: 300 }, { x: 305, y: 300 }, { x: 305, y: 305 }] },
    ]);
    const moved = layoutUnderlayFor(layoutMap, els.map((e) => (e.id === 'river-1' ? { ...e, x: 11 } as Element : e)))!;
    expect(layoutUnderlayKey(moved)).not.toBe(layoutUnderlayKey(u));
  });

  it('a local picture on the ground is drawn too', () => {
    const u = layoutUnderlayFor(layoutMap, [layoutMap, { ...groundMap, image_url: '', image_media_id: 'med-1' } as WorldMap])!;
    expect(u.source).toEqual({ kind: 'local', mediaId: 'med-1' });
  });
});

describe('the card', () => {
  beforeEach(() => { patchSlice('data', { elements: [layoutMap, groundMap] } as never); });

  it('the lines', () => {
    expect(layoutRecipeLine({ method: 'trail-by-place', groundName: 'The way south, 1847-49' }))
      .toBe('The pins on this map were placed by a layout method, trail-by-place, on the ground of the map The way south, 1847-49.');
    expect(layoutRecipeLine({ method: 'island-hero', groundName: null })).toBe('The pins on this map were placed by a layout method, island-hero.');
    expect(layoutDrawnLine(false)).toBe('Atlas draws this map flat, seen from above, and never rewrites the recipe.');
  });

  it('a shape surprise falls back to the generic row', () => {
    for (const v of [null, 'trail-by-place', [recipe], {}, { method: '' }, { method: 7 }, { settings: recipe.settings }]) {
      expect(renderLayoutCard(v)).toBeNull();
    }
  });

  it('on the Map\'s page: the ground named from the world, the picture said, the recipe one press away', () => {
    const section = buildCustomFieldsSection(layoutMap)!;
    const card = section.querySelector<HTMLElement>('[data-role="layout-card"]')!;
    const lines = card.querySelectorAll('.atlas-tangle-outcome');
    expect(lines[0].textContent).toBe(layoutRecipeLine({ method: 'trail-by-place', groundName: 'The way south, 1847-49' }));
    expect(lines[1].textContent).toBe(layoutDrawnLine(true));
    expect(JSON.parse(card.querySelector('details pre')!.textContent!)).toEqual(recipe);
    expect(card.querySelector('details')!.open).toBe(false);
    expect(section.querySelector('.atlas-custom-structured-row:not(.atlas-custom-structured-card)')).toBeNull();
  });

  it('with no ground in the world, the recipe alone speaks', () => {
    patchSlice('data', { elements: [layoutMap] } as never);
    const card = buildCustomFieldsSection(layoutMap)!.querySelector('[data-role="layout-card"]')!;
    expect(card.querySelectorAll('.atlas-tangle-outcome')[0].textContent).toBe(layoutRecipeLine({ method: 'trail-by-place', groundName: null }));
    expect(card.querySelectorAll('.atlas-tangle-outcome')[1].textContent).toBe(layoutDrawnLine(false));
  });

  it('a name with markup in it stays text', () => {
    const card = renderLayoutCard({ method: '<img src=x onerror=alert(1)>', settings: { ground: { name: '<b>bold</b>' } } })!;
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('b')).toBeNull();
    expect(card.textContent).toContain('<b>bold</b>');
  });

  it('on any other type the recipe keeps the generic row (the card speaks of "this map")', () => {
    const ch = { id: 'c1', type: 'character', name: 'Not a map', x_layout: recipe } as unknown as Element;
    const section = buildCustomFieldsSection(ch)!;
    expect(section.querySelector('[data-role="layout-card"]')).toBeNull();
    expect(section.querySelector('.atlas-custom-structured-row:not(.atlas-custom-structured-card)')).not.toBeNull();
  });
});
