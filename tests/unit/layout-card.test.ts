/**
 * Map.x_layout (a layout method's recipe) reads as a card, not raw JSON: what
 * placed the pins, on which ground, and that Atlas draws the map flat. Another
 * tool's value: a shape surprise falls back to the generic row (null), and its
 * text is never read as markup.
 */
import { describe, it, expect } from 'vitest';
import { parseLayoutRecipe, layoutRecipeLine, renderLayoutCard } from '../../src/middle/layout-card';
import { buildCustomFieldsSection } from '../../src/middle/element-detail-custom-fields';
import type { Element } from '../../src/core/types';

// The shape of OW Mapping's staged Blood Meridian layout (2026-11-09), trimmed.
const recipe = {
  method: 'trail-by-place',
  settings: {
    ground_map: { element_id: '01a1b2d8-cf2d-7cef-a8c5-ef2da3662ca8', name: 'The way south, 1847-49', width: 3462, height: 4676 },
    scale: 1,
    margin_px: 300,
  },
};

describe('the layout recipe card', () => {
  it('reads the method and the ground', () => {
    expect(parseLayoutRecipe(recipe)).toEqual({ method: 'trail-by-place', groundName: 'The way south, 1847-49' });
    expect(layoutRecipeLine(parseLayoutRecipe(recipe)!))
      .toBe('The pins on this map were placed by a layout method, trail-by-place, on the ground of the map The way south, 1847-49.');
  });

  it('a recipe with no ground says the method alone', () => {
    expect(layoutRecipeLine(parseLayoutRecipe({ method: 'island-hero', settings: {} })!))
      .toBe('The pins on this map were placed by a layout method, island-hero.');
  });

  it('a shape surprise falls back to the generic row', () => {
    for (const v of [null, 'trail-by-place', [recipe], {}, { method: '' }, { method: 7 }, { settings: recipe.settings }]) {
      expect(renderLayoutCard(v)).toBeNull();
    }
  });

  it('the card carries the line, the flat note and the whole recipe one press away', () => {
    const card = renderLayoutCard(recipe)!;
    expect(card.dataset.role).toBe('layout-card');
    expect(card.querySelector('.atlas-tangle-outcome')!.textContent).toBe(layoutRecipeLine(parseLayoutRecipe(recipe)!));
    expect(card.textContent).toContain('Atlas draws this map flat');
    const pre = card.querySelector('details pre')!;
    expect(JSON.parse(pre.textContent!)).toEqual(recipe);
    expect(card.querySelector('details')!.open).toBe(false);
  });

  it('a name with markup in it stays text', () => {
    const card = renderLayoutCard({ method: '<img src=x onerror=alert(1)>', settings: { ground_map: { name: '<b>bold</b>' } } })!;
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('b')).toBeNull();
    expect(card.textContent).toContain('<b>bold</b>');
  });

  it('the element page draws a Map\'s x_layout as the card, not the JSON row', () => {
    const map = { id: 'm1', type: 'map', name: 'Layout', x_layout: recipe } as unknown as Element;
    const section = buildCustomFieldsSection(map)!;
    expect(section.querySelector('[data-role="layout-card"]')).not.toBeNull();
    expect(section.querySelector('.atlas-custom-structured-row:not(.atlas-custom-structured-card)')).toBeNull();
  });

  it('on any other type the recipe keeps the generic row (the card speaks of "this map")', () => {
    const ch = { id: 'c1', type: 'character', name: 'Not a map', x_layout: recipe } as unknown as Element;
    const section = buildCustomFieldsSection(ch)!;
    expect(section.querySelector('[data-role="layout-card"]')).toBeNull();
    expect(section.querySelector('.atlas-custom-structured-row:not(.atlas-custom-structured-card)')).not.toBeNull();
  });
});
