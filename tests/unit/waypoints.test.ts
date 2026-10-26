/**
 * Waypoints state machine (Bout OW, src/core/waypoints.ts) — the contract is
 * the waypoint hook map.
 *
 * Locks: once-ever stamping · the demo-gating class rule (world-data waypoints
 * gate on the ACTIVE world's demo flag; portability waypoints don't) · the
 * taxonomy two-half rule · muted-still-records ("the page stays honest") ·
 * mark-all-familiar · the registry side of the demo-flag lifecycle
 * (createLocalWorld sets it, attachApi clears it — make-online un-demos).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getState, patchSlice } from '../../src/core/state';
import {
  WAYPOINTS,
  completeWaypoint,
  completeTaxonomyHalf,
  loadWaypointsState,
  completedCount,
  markAllFamiliar,
  setMuted,
  isMuted,
  isDemoWorldActive,
  addHomeReceipts,
  clearHomeReceipts,
} from '../../src/core/waypoints';
import { createLocalWorld, attachApi } from '../../src/registry/registry';
import { defaultRegistry } from '../../src/core/types';
import type { WorldRegistryEntry } from '../../src/core/types';

function entry(over: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry {
  return {
    id: 'w1',
    name: 'Test World',
    state: 'local-only',
    folder: { handle_key: 'k1', folder_name: 'test-world' },
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function activate(worlds: WorldRegistryEntry[], worldId = 'w1'): void {
  patchSlice('registry', { ...getState().registry, worlds });
  patchSlice('active', { worldId, meta: { id: 'm1', name: 'Test World' }, opened: true });
}

beforeEach(() => {
  localStorage.removeItem('atlas_waypoints_v1');
  activate([entry()]);
});

describe('completeWaypoint', () => {
  it('stamps once and only once', () => {
    completeWaypoint('first-element');
    const first = loadWaypointsState().completed['first-element'];
    expect(first).toBeTruthy();
    completeWaypoint('first-element');
    expect(loadWaypointsState().completed['first-element']).toBe(first);
    expect(completedCount()).toBe(1);
  });

  it('gates world-data waypoints while the demo world is active', () => {
    activate([entry({ demo: true })]);
    expect(isDemoWorldActive()).toBe(true);
    for (const id of ['first-element', 'taxonomy', 'links', 'maps', 'time', 'share'] as const) {
      completeWaypoint(id);
    }
    expect(completedCount()).toBe(0);
  });

  it('portability waypoints complete even in the demo world', () => {
    activate([entry({ demo: true })]);
    completeWaypoint('first-world'); // non-demo by construction — never gated
    completeWaypoint('import');
    completeWaypoint('ecosystem');
    completeWaypoint('council');
    expect(completedCount()).toBe(4);
  });

  it('world-data waypoints complete normally in a non-demo world', () => {
    completeWaypoint('maps');
    expect(loadWaypointsState().completed['maps']).toBeTruthy();
  });

  it('muted still records completions — the page stays honest', () => {
    setMuted(true);
    expect(isMuted()).toBe(true);
    completeWaypoint('time');
    expect(loadWaypointsState().completed['time']).toBeTruthy();
  });
});

describe('taxonomy two-half rule', () => {
  it('one half alone does not complete', () => {
    completeTaxonomyHalf('supertype');
    expect(loadWaypointsState().completed['taxonomy']).toBeUndefined();
    expect(loadWaypointsState().taxonomySuper).toBe(true);
  });

  it('both halves complete it (any order, any element)', () => {
    completeTaxonomyHalf('subtype');
    completeTaxonomyHalf('supertype');
    expect(loadWaypointsState().completed['taxonomy']).toBeTruthy();
  });

  it('halves are demo-gated like the waypoint itself', () => {
    activate([entry({ demo: true })]);
    completeTaxonomyHalf('supertype');
    completeTaxonomyHalf('subtype');
    expect(loadWaypointsState().completed['taxonomy']).toBeUndefined();
    expect(loadWaypointsState().taxonomySuper).toBe(false);
  });
});

describe('markAllFamiliar', () => {
  it('stamps every waypoint', () => {
    markAllFamiliar();
    expect(completedCount()).toBe(WAYPOINTS.length);
    expect(loadWaypointsState().taxonomySuper).toBe(true);
    expect(loadWaypointsState().taxonomySub).toBe(true);
  });
});

describe('demo-flag registry lifecycle', () => {
  it('createLocalWorld sets demo only when asked', () => {
    const reg = defaultRegistry();
    const { entry: plain } = createLocalWorld(reg, { name: 'a', folderName: 'a', handleKey: 'k' });
    expect(plain.demo).toBeUndefined();
    const { entry: demo } = createLocalWorld(reg, { name: 'b', folderName: 'b', handleKey: 'k2', demo: true });
    expect(demo.demo).toBe(true);
  });

  it('attachApi clears demo — make-online un-demos the world', () => {
    const reg = defaultRegistry();
    const { next, entry: demoWorld } = createLocalWorld(reg, { name: 'd', folderName: 'd', handleKey: 'k', demo: true });
    const after = attachApi(next, demoWorld.id, { worldId: 'srv-1', apiKey: 'key' });
    const flipped = after.worlds.find((w) => w.id === demoWorld.id)!;
    expect(flipped.state).toBe('api-linked');
    expect(flipped.demo).toBeUndefined();
    expect('demo' in flipped).toBe(false);
  });
});

describe('the toast, after #127', () => {
  const container = (): HTMLElement => {
    let c = document.getElementById('toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toast-container';
      document.body.appendChild(c);
    }
    return c;
  };
  const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };
  // The stage comes first: a toast with no container is dropped unseen, and
  // a "no toast" assertion would pass for that reason alone.
  beforeEach(() => { container(); });

  it('a step the home showed is its own receipt: recorded, no toast', async () => {
    addHomeReceipts(['links']);
    try {
      completeWaypoint('links');
      await flush();
      expect(loadWaypointsState().completed['links']).toBeTruthy();
      expect(container().querySelector('.atlas-waypoint-toast')).toBeNull();
    } finally {
      clearHomeReceipts();
    }
  });

  it('a step the home did not show still toasts, home or not (the control)', async () => {
    vi.useFakeTimers();
    addHomeReceipts(['links']);
    try {
      completeWaypoint('ecosystem');
      await flush();
      expect(container().querySelector('.atlas-waypoint-toast')).not.toBeNull();
      // Let it leave, so the queue is idle for the files after this one.
      vi.advanceTimersByTime(8000);
      vi.advanceTimersByTime(400);
      expect(container().querySelector('.atlas-waypoint-toast')).toBeNull();
    } finally {
      vi.useRealTimers();
      clearHomeReceipts();
    }
  });

  // A tap fired the emulated mouseenter with no leave, so a finger pinned
  // the toast on a phone. Only a mouse holds it.
  it('a mouse holds the toast and a finger does not', async () => {
    vi.useFakeTimers();
    const hover = (pointerType: string) => {
      const e = new Event('pointerenter');
      Object.defineProperty(e, 'pointerType', { value: pointerType });
      container().querySelector('.atlas-waypoint-toast')!.dispatchEvent(e);
    };
    try {
      completeWaypoint('import');
      await flush();
      hover('touch');
      vi.advanceTimersByTime(7000);
      vi.advanceTimersByTime(400);
      expect(container().querySelector('.atlas-waypoint-toast')).toBeNull();
      vi.advanceTimersByTime(10);
      completeWaypoint('share');
      await flush();
      hover('mouse');
      vi.advanceTimersByTime(30_000);
      expect(container().querySelector('.atlas-waypoint-toast')).not.toBeNull();
      // Let it leave, so the queue is idle for the files after this one.
      const leave = new Event('pointerleave');
      Object.defineProperty(leave, 'pointerType', { value: 'mouse' });
      container().querySelector('.atlas-waypoint-toast')!.dispatchEvent(leave);
      vi.advanceTimersByTime(2500);
      vi.advanceTimersByTime(400);
      expect(container().querySelector('.atlas-waypoint-toast')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('story and knowledge are world-data: gated in the demo world', () => {
    activate([entry({ demo: true })]);
    completeWaypoint('story');
    completeWaypoint('knowledge');
    expect(completedCount()).toBe(0);
  });
});
