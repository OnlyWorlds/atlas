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
  __test_handleIdSwap,
} from '../../src/sync/sync-attach';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';

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
});
