/**
 * Smoke test — proves vitest + jsdom + MSW + fake-indexeddb wiring works
 * before any real architecture lands.
 */

import { describe, it, expect } from 'vitest';

describe('vitest foundation', () => {
  it('runs in jsdom', () => {
    expect(typeof window).toBe('object');
    expect(typeof document).toBe('object');
  });

  it('has fake-indexeddb available (used only for FS handle vault)', () => {
    expect(typeof indexedDB).toBe('object');
  });

  it('reports navigator.onLine as pinned true by setup', () => {
    expect(navigator.onLine).toBe(true);
  });
});
