import { describe, expect, it } from 'vitest';
import { sameElements } from '../../src/sync/same-elements';
import type { Element } from '../../src/core/types';

const el = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, type: 'character', name, ...extra }) as unknown as Element;

describe('sameElements: a pull that changed nothing keeps the store array', () => {
  it('a fresh read with the same elements, as new objects, is the same', () => {
    const held = [el('a', 'Ada', { friends: ['b'] }), el('b', 'Bo')];
    const fresh = [el('a', 'Ada', { friends: ['b'] }), el('b', 'Bo')];
    expect(sameElements(held, fresh)).toBe(true);
  });
  it('a changed field, a new element, a removed one or a new order is not', () => {
    const held = [el('a', 'Ada'), el('b', 'Bo')];
    expect(sameElements(held, [el('a', 'Ada'), el('b', 'Bo Holt')])).toBe(false);
    expect(sameElements(held, [el('a', 'Ada'), el('b', 'Bo'), el('c', 'Cy')])).toBe(false);
    expect(sameElements(held, [el('a', 'Ada')])).toBe(false);
    expect(sameElements(held, [el('b', 'Bo'), el('a', 'Ada')])).toBe(false);
    expect(sameElements(held, [el('a', 'Ada'), el('b', 'Bo', { updated_at: '2026-11-08T02:00:00Z' })])).toBe(false);
  });
});
