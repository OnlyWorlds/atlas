/**
 * The map-space profile's layout keys (schema-dist profiles/map-space.fixture.json, copied whole at
 * v0.34.0-dist.110): rule 8, a layout map is a Map whose `x_layout` has a non-empty string `method`; rule 10,
 * a Pin placed or moved by hand on a layout map carries `x_hand: true`, a plain map's Pins carry nothing, and
 * removing the mark hands the Pin back to the next lay-out. Atlas writes the mark at every hand placement and
 * shows it as a card with its own remove, never as a field to type into (only `true` is the mark).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import fixture from '../fixtures/map-space.fixture.json';
import { handMarkFor, handMarkForPinEdit, layoutMethodOf, parseLayoutRecipe } from '../../src/core/layout-recipe';
import { handLine } from '../../src/middle/layout-card';
import { buildCustomFieldsSection, customFieldMetasFor, structuredFieldEntriesFor } from '../../src/middle/element-detail-custom-fields';
import { patchSlice } from '../../src/core/state';
import type { Element } from '../../src/core/types';

type Row = { type: string; id: string; x_layout?: unknown };
const cases = (fixture as unknown as { layout_cases: { name: string; map: string; elements: Row[]; want: { layout: string | null } }[] }).layout_cases;

describe('rule 8, every layout case of the fixture', () => {
  it('the fixture holds the seventeen cases serial 110 published', () => {
    expect(cases.length).toBe(17);
  });
  for (const c of cases) {
    it(`${c.name}: the method is the fixture's layout`, () => {
      const map = c.elements.find((e) => e.id === c.map && e.type === 'map')!;
      expect(layoutMethodOf(map.x_layout)).toBe(c.want.layout);
      expect(handMarkFor(map)).toEqual(c.want.layout === null ? {} : { x_hand: true });
    });
  }
  it('the card reads the same rule: a method of spaces is a layout map, as the page says', () => {
    expect(layoutMethodOf({ method: '  ' })).toBe('  ');
    expect(parseLayoutRecipe({ method: '  ' })?.method).toBe('  ');
    expect(parseLayoutRecipe({ method: '' })).toBeNull();
  });
});

describe('rule 10, the writer: a hand placement on a layout map carries the mark', () => {
  it('a method, a board, a plain map, no map', () => {
    expect(handMarkFor({ x_layout: { method: 'trail-by-place' } })).toEqual({ x_hand: true });
    expect(handMarkFor({ x_layout: { method: 'hand' } })).toEqual({ x_hand: true });
    expect(handMarkFor({})).toEqual({});
    expect(handMarkFor({ x_layout: { settings: { ground: { map: 'g' } } } })).toEqual({});
    expect(handMarkFor(undefined)).toEqual({});
  });

  // Every place Atlas writes a Pin's point is a hand placement but one: a rescale onto a new picture moves every
  // Pin by arithmetic, which is no hand move. A new writer either carries the mark or joins this list with its reason.
  const MACHINE_MOVES: Record<string, string> = {
    'middle/map-attach-scale.ts': 'a rescale onto a new picture moves every Pin by arithmetic, not by hand',
  };
  // Other machine moves of every Pin, through updateElement: none carries the mark (rule 10, a method never sets it).
  it('the map flip moves every Pin by arithmetic and writes no mark', () => {
    const text = readFileSync(resolve(__dirname, '../../src/core/map-flip.ts'), 'utf8');
    expect(text).toMatch(/updateElement\(/);
    expect(text).not.toMatch(/handMark|x_hand/);
  });
  it('every createPin and updatePin call in the app carries handMarkFor, or is a named machine move', () => {
    const SRC = resolve(__dirname, '../../src');
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
    walk(SRC);
    const found: string[] = [];
    const unmarked: string[] = [];
    for (const f of files) {
      const rel = relative(SRC, f).replace(/\\/g, '/');
      if (rel.startsWith('store/')) continue; // the store's own definitions
      const text = readFileSync(f, 'utf8');
      const re = /store\.(createPin|updatePin)\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        found.push(rel);
        // The call's own argument list: to its closing paren at depth 0.
        let depth = 0, i = m.index + m[0].length - 1, end = i;
        for (; i < text.length; i++) { if (text[i] === '(') depth++; else if (text[i] === ')' && --depth === 0) { end = i; break; } }
        // The mark is the Map on screen, read before the handler's first await (`const hand = handMarkFor(mapOnScreen(entry.mapId))`).
        if (!text.slice(m.index, end).includes('...hand,') && !MACHINE_MOVES[rel]) unmarked.push(rel);
        if (!MACHINE_MOVES[rel] && !text.includes('const hand = handMarkFor(mapOnScreen(entry.mapId));')) unmarked.push(`${rel} (no early read)`);
      }
    }
    expect(found.length).toBe(5); // three placements, the drag, the rescale
    expect(unmarked).toEqual([]);
  });

  it("the Pin page's field save carries the edit's mark (a typed x, y, z or a new Map is a hand move)", () => {
    const text = readFileSync(resolve(__dirname, '../../src/middle/element-detail-fields.ts'), 'utf8');
    expect(text).toMatch(/updateElement\(el\.id, \{ \[fieldName\]: valueToPersist, \.\.\.hand \}/);
    expect(text).toMatch(/const hand = handMarkForPinEdit\(/);
  });
});

describe('rule 10, a Pin edited on its page', () => {
  const maps: Record<string, { x_layout?: unknown }> = { laid: { x_layout: { method: 'trail-by-place' } }, plain: {} };
  const byId = (id: string) => maps[id];
  const pin = { type: 'pin', map_id: 'laid' };
  it('a typed x, y or z on a layout map carries the mark', () => {
    for (const f of ['x', 'y', 'z']) expect(handMarkForPinEdit(pin, f, 10, 20, byId)).toEqual({ x_hand: true });
  });
  it('the same value, a cleared value, another field, another type, or a plain map: nothing', () => {
    expect(handMarkForPinEdit(pin, 'x', 10, 10, byId)).toEqual({});
    expect(handMarkForPinEdit(pin, 'x', 10, null, byId)).toEqual({});
    expect(handMarkForPinEdit(pin, 'x', 10, '', byId)).toEqual({});
    expect(handMarkForPinEdit(pin, 'description', 'a', 'b', byId)).toEqual({});
    expect(handMarkForPinEdit({ type: 'marker', map_id: 'laid' }, 'x', 1, 2, byId)).toEqual({});
    expect(handMarkForPinEdit({ type: 'pin', map_id: 'plain' }, 'x', 1, 2, byId)).toEqual({});
  });
  it("the page's Map row (it writes `map`, which moves no Pin) places nothing", () => {
    expect(handMarkForPinEdit(pin, 'map', 'laid', 'plain', byId)).toEqual({});
    expect(handMarkForPinEdit(pin, 'map_id', 'laid', 'plain', byId)).toEqual({});
  });
});

describe('the mark on the Pin page', () => {
  const pin = (x_hand: unknown, map = 'm1') => ({ id: 'p1', type: 'pin', name: '', map_id: map, element_id: 'e1', x: 1, y: 1, x_hand }) as unknown as Element;
  const map = (x_layout?: unknown) => ({ id: 'm1', type: 'map', name: 'Field', ...(x_layout ? { x_layout } : {}) }) as unknown as Element;

  it('exactly true is a card, never a field to type into; any other value stays a field of its own', () => {
    expect(customFieldMetasFor(pin(true)).map((f) => f.name)).not.toContain('x_hand');
    expect(structuredFieldEntriesFor(pin(true)).map((f) => f.name)).toContain('x_hand');
    expect(customFieldMetasFor(pin('true')).map((f) => f.name)).toContain('x_hand');
    expect(structuredFieldEntriesFor(pin('true')).map((f) => f.name)).not.toContain('x_hand');
  });

  describe('its sentence follows the Pin own Map', () => {
    let el: Element;
    beforeEach(() => { el = pin(true); });
    for (const [kind, x_layout] of [['method', { method: 'trail-by-place' }], ['board', { method: 'hand' }], ['plain', undefined]] as const) {
      it(kind, () => {
        patchSlice('data', { elements: [map(x_layout), el] } as never);
        const card = buildCustomFieldsSection(el)!.querySelector<HTMLElement>('[data-role="hand-card"]')!;
        expect(card.querySelector('.atlas-tangle-outcome')!.textContent).toBe(handLine(kind));
        // Its own remove, as every structured row has (the way back, rule 10).
        expect(card.closest('.atlas-custom-structured-row')!.querySelector('button')).not.toBeNull();
      });
    }
  });

  it('the three sentences are plain: no em dash', () => {
    for (const k of ['method', 'board', 'plain'] as const) expect(handLine(k)).not.toMatch(/—/);
  });
});
