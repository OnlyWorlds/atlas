import { describe, it, expect } from 'vitest';
import { renderGate } from '../../src/ui/render-gate';

// conv. 146: a render runs only when one of its parts moved.
describe('renderGate', () => {
  it('opens on the first call and on any moved part, by identity', () => {
    const gate = renderGate();
    const slice = { a: 1 };
    expect(gate.changed(['#/w/x', slice])).toBe(true);
    expect(gate.changed(['#/w/x', slice])).toBe(false);
    expect(gate.changed(['#/w/x', { a: 1 }])).toBe(true); // a replaced slice is a change, however equal
    expect(gate.changed(['#/w/y', { a: 1 }])).toBe(true);
  });

  it('counts a different number of parts as a change, and reset reopens it', () => {
    const gate = renderGate();
    expect(gate.changed(['k'])).toBe(true);
    expect(gate.changed(['k', null])).toBe(true);
    expect(gate.changed(['k', null])).toBe(false);
    gate.reset();
    expect(gate.changed(['k', null])).toBe(true);
  });

  it('keeps its own copy of the parts', () => {
    const gate = renderGate();
    const parts: unknown[] = ['k'];
    gate.changed(parts);
    parts[0] = 'moved';
    expect(gate.changed(['k'])).toBe(false);
  });
});
