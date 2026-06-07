/**
 * sync-attach id-swap migration test (Bout 9).
 *
 * When push CREATE produces a server-assigned id, sync-attach's onIdSwap
 * handler migrates:
 *   1. state.ui.selectedElementId — if it pointed at old_id, advance to new_id
 *   2. URL hash /element/<old> — replace with /element/<new>
 *   3. URL hash /map/<mid>/element/<old> — preserve map context, swap element
 *
 * Without these migrations, the middle pane shows "element <old-id> not found
 * in this world" after a sync round that re-keyed the user's selection (e.g.
 * picking "keep + re-push" on a server-deleted element triggers CREATE → new
 * v7 id from server → file moves but UI state stays stale).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detachSyncEngine,
  applyIdSwapToUi,
  __test_handleIdSwap,
} from '../../src/sync/sync-attach';
import { patchSlice, getState, subscribe } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

beforeEach(() => {
  detachSyncEngine();
  patchSlice('registry', defaultRegistry());
  patchSlice('active', { worldId: 'w1', meta: { id: 'srv-1', name: 'TestWorld' }, opened: true });
  patchSlice('ui', {
    sidebarMode: 'elements',
    selectedElementId: null,
    elementFilters: new Set(),
    search: '',
    rightTabs: [{ kind: 'map-index' }],
    rightActiveIndex: 0,
    pinPlacement: null,
    zoneEditing: null,
    sidebarWritingOverride: false,
    knowledgeLens: null,
  });
  window.location.hash = '#/';
});

afterEach(() => {
  detachSyncEngine();
  window.location.hash = '#/';
  patchSlice('active', null);
});

describe('sync-attach: id-swap migrates UI state', () => {
  it('updates selectedElementId when it matches old_id', () => {
    patchSlice('ui', { ...getState().ui, selectedElementId: 'old-id' });

    __test_handleIdSwap({ old_id: 'old-id', new_id: 'new-id', type: 'character' });

    expect(getState().ui.selectedElementId).toBe('new-id');
  });

  it('leaves selectedElementId alone when the swap is for a different element', () => {
    patchSlice('ui', { ...getState().ui, selectedElementId: 'other-id' });

    __test_handleIdSwap({ old_id: 'old-id', new_id: 'new-id', type: 'character' });

    expect(getState().ui.selectedElementId).toBe('other-id');
  });

  it('rewrites URL /element/<old> → /element/<new>', () => {
    window.location.hash = '#/w/w1/element/old-id';
    patchSlice('ui', { ...getState().ui, selectedElementId: 'old-id' });

    __test_handleIdSwap({ old_id: 'old-id', new_id: 'new-id', type: 'character' });

    expect(window.location.hash).toBe('#/w/w1/element/new-id');
  });

  it('rewrites URL /map/<mid>/element/<old> → /map/<mid>/element/<new>', () => {
    window.location.hash = '#/w/w1/map/map-7/element/old-id';
    patchSlice('ui', { ...getState().ui, selectedElementId: 'old-id' });

    __test_handleIdSwap({ old_id: 'old-id', new_id: 'new-id', type: 'character' });

    expect(window.location.hash).toBe('#/w/w1/map/map-7/element/new-id');
  });

  it('leaves URL alone when it names a different element', () => {
    window.location.hash = '#/w/w1/element/another-id';
    patchSlice('ui', { ...getState().ui, selectedElementId: 'old-id' });

    __test_handleIdSwap({ old_id: 'old-id', new_id: 'new-id', type: 'character' });

    expect(window.location.hash).toBe('#/w/w1/element/another-id');
  });

  it('still migrates selectedElementId even when URL is unaffected', () => {
    // User has selectedElementId pointing at old-id but URL is /worlds (no
    // element route). selection still needs to migrate so subsequent
    // navigation lands on the right element.
    window.location.hash = '#/w/w1/worlds';
    patchSlice('ui', { ...getState().ui, selectedElementId: 'old-id' });

    __test_handleIdSwap({ old_id: 'old-id', new_id: 'new-id', type: 'character' });

    expect(getState().ui.selectedElementId).toBe('new-id');
    expect(window.location.hash).toBe('#/w/w1/worlds');
  });

  it('does nothing when there is no active world', () => {
    patchSlice('active', null);
    window.location.hash = '#/w/w1/element/old-id';

    // No-op: handler returns early without an active world.
    __test_handleIdSwap({ old_id: 'old-id', new_id: 'new-id', type: 'character' });

    expect(window.location.hash).toBe('#/w/w1/element/old-id');
  });

  it('substitutes the cached element entry so the new id resolves immediately', () => {
    // Seed data.elements with an entry at old-id — simulates the cache state
    // right before the engine fires onIdSwap (file has been moved on disk but
    // refreshElementsCache hasn't run yet).
    patchSlice('data', {
      elements: [
        { id: 'old-id', type: 'character', name: 'WillSwap', local_updated_at: 't', server_updated_at: 't' } as any,
        { id: 'other', type: 'location', name: 'Untouched', local_updated_at: 't' } as any,
      ],
    });
    patchSlice('ui', { ...getState().ui, selectedElementId: 'old-id' });

    __test_handleIdSwap({ old_id: 'old-id', new_id: 'new-id', type: 'character' });

    const els = getState().data.elements;
    // The previously-old entry now resolves under new-id with content intact.
    expect(els.find((e) => e.id === 'new-id')).toMatchObject({ name: 'WillSwap' });
    expect(els.find((e) => e.id === 'old-id')).toBeUndefined();
    // Untouched entries stay.
    expect(els.find((e) => e.id === 'other')?.name).toBe('Untouched');
    // selectedElementId migrated in the same transition.
    expect(getState().ui.selectedElementId).toBe('new-id');
  });

  it('migrates pinPlacement.elementId when it matches old_id', () => {
    // Reachable when the user has a pin-placement banner active for a
    // freshly-created element that hasn't been pushed yet. First push
    // triggers an id-swap; without migration, subsequent map clicks would
    // silently no-op because pinPlacement.elementId no longer resolves.
    patchSlice('ui', {
      ...getState().ui,
      pinPlacement: { elementId: 'old-id' },
    });

    __test_handleIdSwap({ old_id: 'old-id', new_id: 'new-id', type: 'character' });

    expect(getState().ui.pinPlacement?.elementId).toBe('new-id');
  });

  it('leaves pinPlacement alone when it targets a different element', () => {
    patchSlice('ui', {
      ...getState().ui,
      pinPlacement: { elementId: 'other-id' },
    });

    __test_handleIdSwap({ old_id: 'old-id', new_id: 'new-id', type: 'character' });

    expect(getState().ui.pinPlacement?.elementId).toBe('other-id');
  });

  it('leaves data.elements alone when the swap does not match a cached entry', () => {
    patchSlice('data', {
      elements: [{ id: 'other', type: 'location', name: 'X', local_updated_at: 't' } as any],
    });
    const before = getState().data.elements;

    __test_handleIdSwap({ old_id: 'old-id', new_id: 'new-id', type: 'character' });

    // Identity preserved — no spurious patch.
    expect(getState().data.elements).toBe(before);
  });

  // The public surface (`applyIdSwapToUi`) is used by the transient SyncEngine
  // spun up by Make-Online Route 1 + the merge flow's MergeOpts.onIdSwap. The
  // production wiring is identical to handleIdSwap; this test pins the
  // contract so a future refactor doesn't silently break Route 1/Route 2.
  it('public applyIdSwapToUi migrates state the same way handleIdSwap does', () => {
    patchSlice('ui', { ...getState().ui, selectedElementId: 'pub-old' });
    window.location.hash = '#/w/w1/element/pub-old';

    applyIdSwapToUi({ old_id: 'pub-old', new_id: 'pub-new', type: 'character' });

    expect(getState().ui.selectedElementId).toBe('pub-new');
    expect(window.location.hash).toBe('#/w/w1/element/pub-new');
  });

  // End-to-end wiring test: prove a transient SyncEngine constructed exactly
  // like Make-Online Route 1 builds it (`onIdSwap: applyIdSwapToUi`) actually
  // propagates id-swaps to the UI when a CREATE produces a server-assigned id.
  //
  // Without this test, regressing the Route 1 wiring (e.g. dropping the
  // onIdSwap option from make-online-modal.ts:249) wouldn't surface until
  // someone ran T1.6 smoke and noticed the "element not found" flash. With it,
  // the wiring is locked in mechanically.
  it('transient engine + applyIdSwapToUi migrates UI on server-assigned id', async () => {
    const folder = new MockFolderStore();
    const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
    folder.setClock(clock.next);
    await folder.open(null);
    const client = new FakeOwApiClient();
    client.setClock(clock.next);
    client.assignServerIds = true; // Real OW UUID v7 behavior.

    const local = await folder.createElement('character', { name: 'TransientCarl' });

    // Mirror UI state for the smoke-realistic scenario: user has the local
    // element selected and the URL points at its id.
    patchSlice('ui', { ...getState().ui, selectedElementId: local.id });
    window.location.hash = `#/w/w1/element/${local.id}`;
    patchSlice('data', {
      elements: [
        { id: local.id, type: 'character', name: 'TransientCarl', local_updated_at: 't' } as any,
      ],
    });

    // Build the transient engine EXACTLY like make-online-modal.handleCreate does.
    const transient = new SyncEngine({
      folder,
      client,
      onIdSwap: applyIdSwapToUi,
    });
    await transient.pushOnce();

    // UI state must have followed the swap. If wiring breaks, selectedElementId
    // and URL would still be local.id and the middle pane would render
    // "element <local.id> not found in this world."
    expect(getState().ui.selectedElementId).not.toBe(local.id);
    expect(window.location.hash).not.toBe(`#/w/w1/element/${local.id}`);
    expect(window.location.hash).toMatch(/^#\/w\/w1\/element\//);
    // And data.elements has been updated to the new id atomically.
    const newId = getState().ui.selectedElementId!;
    expect(getState().data.elements.find((e) => e.id === newId)).toBeDefined();
    expect(getState().data.elements.find((e) => e.id === local.id)).toBeUndefined();
  });

  it('atomically migrates data + ui in a single state transition', () => {
    // If the handler did two separate patchSlice calls, subscribers would
    // observe an intermediate state where ui.selectedElementId = new-id but
    // data.elements still had old-id (causing the empty-state flash). Verify
    // subscribers see ONE update, with both slices consistent.
    patchSlice('data', {
      elements: [{ id: 'old-id', type: 'character', name: 'Flashy', local_updated_at: 't' } as any],
    });
    patchSlice('ui', { ...getState().ui, selectedElementId: 'old-id' });

    const observed: Array<{ uiSel: string | null; hasOld: boolean; hasNew: boolean }> = [];
    const unsub = subscribe(() => {
      const s = getState();
      observed.push({
        uiSel: s.ui.selectedElementId,
        hasOld: !!s.data.elements.find((e: any) => e.id === 'old-id'),
        hasNew: !!s.data.elements.find((e: any) => e.id === 'new-id'),
      });
    });

    __test_handleIdSwap({ old_id: 'old-id', new_id: 'new-id', type: 'character' });
    unsub();

    // Exactly one notification fired, and at that snapshot ui+data agree on new-id.
    expect(observed).toHaveLength(1);
    expect(observed[0]).toEqual({ uiSel: 'new-id', hasOld: false, hasNew: true });
  });

  // ---- Map-tab id propagation (DESIGN_MAPS.md §10b N1 fix #2) ----

  it('id-swap of type=map rewrites mapId in any open rightTabs', () => {
    patchSlice('data', {
      elements: [{ id: 'm-old', type: 'map', name: 'My Map', local_updated_at: 't' } as any],
    });
    patchSlice('ui', {
      ...getState().ui,
      rightTabs: [
        { kind: 'map-index' },
        { kind: 'map', mapId: 'm-old', label: 'My Map' },
      ],
      rightActiveIndex: 1,
    });

    __test_handleIdSwap({ old_id: 'm-old', new_id: 'm-new', type: 'map' });

    const tabs = getState().ui.rightTabs;
    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toMatchObject({ kind: 'map', mapId: 'm-new' });
    // rightActiveIndex stays put.
    expect(getState().ui.rightActiveIndex).toBe(1);
  });

  it('id-swap of type=map preserves the worldId stamp on the migrated tab', () => {
    patchSlice('data', {
      elements: [{ id: 'm-old', type: 'map', name: 'M', local_updated_at: 't' } as any],
    });
    patchSlice('ui', {
      ...getState().ui,
      rightTabs: [
        { kind: 'map-index' },
        { kind: 'map', mapId: 'm-old', label: 'M', worldId: 'w1' },
      ],
      rightActiveIndex: 1,
    });

    __test_handleIdSwap({ old_id: 'm-old', new_id: 'm-new', type: 'map' });

    const migrated = getState().ui.rightTabs[1];
    expect(migrated).toMatchObject({ kind: 'map', mapId: 'm-new', worldId: 'w1' });
  });

  it('id-swap of non-map type does NOT touch rightTabs (map-tab refs unaffected)', () => {
    patchSlice('data', {
      elements: [
        { id: 'c-old', type: 'character', name: 'Bob', local_updated_at: 't' } as any,
        { id: 'm-1', type: 'map', name: 'Atlas', local_updated_at: 't' } as any,
      ],
    });
    const beforeTabs = [
      { kind: 'map-index' as const },
      { kind: 'map' as const, mapId: 'm-1', label: 'Atlas' },
    ];
    patchSlice('ui', {
      ...getState().ui,
      rightTabs: beforeTabs,
      rightActiveIndex: 1,
    });

    __test_handleIdSwap({ old_id: 'c-old', new_id: 'c-new', type: 'character' });

    const tabs = getState().ui.rightTabs;
    expect(tabs).toEqual(beforeTabs);
  });

  it('id-swap of type=map with no matching tab does not crash or create a tab', () => {
    patchSlice('data', {
      elements: [{ id: 'm-old', type: 'map', name: 'M', local_updated_at: 't' } as any],
    });
    patchSlice('ui', {
      ...getState().ui,
      rightTabs: [{ kind: 'map-index' }],
      rightActiveIndex: 0,
    });

    __test_handleIdSwap({ old_id: 'm-old', new_id: 'm-new', type: 'map' });

    // Only the map-index tab remains; the elements list got the id migrated.
    expect(getState().ui.rightTabs).toEqual([{ kind: 'map-index' }]);
    expect(getState().data.elements[0].id).toBe('m-new');
  });
});
