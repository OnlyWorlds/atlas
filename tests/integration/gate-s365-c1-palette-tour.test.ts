/**
 * PROMOTED from the S365 composition gate (lens C, consumers): Ctrl+K keeps the world doors locked during the tour.
 * Each asserts the fixed behaviour; red on the code before the gate fixes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { searchPalette } from '../../src/ui/command-palette';

beforeEach(() => {
  (window as unknown as Record<string, unknown>).showDirectoryPicker = () => Promise.reject(new Error('probe'));
  localStorage.setItem('atlas_tour_v1', JSON.stringify({ active: true, step: 3, worldId: 'tour-w' }));
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).showDirectoryPicker;
  localStorage.clear();
});

describe('C1: world doors in Ctrl+K while touring', () => {
  it('control: outside the tour, "add" finds the add-a-world door', () => {
    localStorage.clear();
    const ids = searchPalette('add', []).filter(r => r.kind === 'action').map(r => (r as { id: string }).id);
    expect(ids).toContain('add-world');
  });
  it('during the tour, "add" does not offer add-a-world', () => {
    const ids = searchPalette('add', []).filter(r => r.kind === 'action').map(r => (r as { id: string }).id);
    expect(ids).not.toContain('add-world');
  });
  it('during the tour, "open" does not offer open-a-world-folder', () => {
    const ids = searchPalette('open', []).filter(r => r.kind === 'action').map(r => (r as { id: string }).id);
    expect(ids).not.toContain('open-world-folder');
  });
});
