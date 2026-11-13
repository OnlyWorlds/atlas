/**
 * The OnlyWorlds mark beside a name is the SDK's Waymark (`waymark-slot.ts`).
 * From SDK 4.160.1 it draws the mark in true curves (cubic and quadratic
 * segments) in place of the traced outline of short straight lines, so it
 * scales without faceting. Mounted here with the options Atlas passes.
 */
import { describe, it, expect } from 'vitest';
import { mountWaymark } from '@onlyworlds/sdk/waymark';

describe('the Waymark beside a name', () => {
  it('draws the OnlyWorlds mark in true curves', () => {
    const slot = document.createElement('span');
    document.body.appendChild(slot);
    const unmount = mountWaymark(slot, {
      world: { id: '0192a000-0000-7000-8000-000000000001', name: 'Hollow Reach' },
      element: null,
      reader: 'member',
      tool: 'atlas',
      signedIn: null,
      phone: false,
      ground: 'dark',
      entry: 'mark',
    });
    try {
      const d = slot.querySelector('svg path')?.getAttribute('d') ?? '';
      expect(d.length).toBeGreaterThan(0);
      // Curves, and no run of bare coordinate pairs (the old traced polyline).
      expect(d).toMatch(/C/);
      expect(d).toMatch(/Q/);
      expect(d).not.toMatch(/\d [\d.]+ [\d.]+ [\d.]+ [\d.]+ [\d.]+ [\d.]+/);
    } finally {
      unmount();
      slot.remove();
    }
  });
});
