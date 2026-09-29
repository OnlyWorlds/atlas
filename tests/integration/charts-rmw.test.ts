/**
 * S364 lane A1 (the read-modify-write half): even when a stale Charts room
 * instance writes into a world (a room carried across a world switch before
 * S364, or a second tab today), a chart save merges into the file on disk
 * instead of replacing it with the room's in-memory list. The remount half is
 * locked by the e2e in saved-charts.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { mountTimeline } from '../../src/middle/timeline';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';
import type { ToastManager } from '../../src/ui/toast-manager';

const chart = (id: string, name: string) => ({
  schema_version: 1, id, name, axis: { kind: 'time', direction: 'both' }, scope: { kind: 'all' }, render: '2d',
}) as never;
const entry = (id: string) => ({ id, name: id, state: 'local', folder: { handle_key: id, folder_name: id }, created_at: '2026-01-01T00:00:00Z' }) as unknown as WorldRegistryEntry;
const toasts = { success: () => {}, error: () => {}, info: () => {}, warning: () => {}, show: () => {} } as unknown as ToastManager;
// jsdom lacks these; the chart canvas is not what this test is about.
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}) })) as never;
const tick = () => new Promise(r => setTimeout(r, 50));

describe('chart writes merge into the file on disk', () => {
  it('a save from a room still holding another world\'s list keeps this world\'s charts', async () => {
    const A = new MockFolderStore(); await A.open(null as never);
    const B = new MockFolderStore(); await B.open(null as never);
    await A.createElement('event', { name: 'Siege', start_date: 10 } as Partial<Element>);
    await B.createElement('event', { name: 'Flood', start_date: 5 } as Partial<Element>);
    await A.writeCharts([chart('ca', 'A: the long war')]);
    await B.writeCharts([chart('cb', 'B: my only chart')]);
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry('wa'), entry('wb')] });

    // World A, charts room.
    setActiveStore(A as unknown as FsFolderStore);
    patchSlice('active', { worldId: 'wa', meta: await A.readWorldMeta(), opened: true } as never);
    patchSlice('data', { elements: await A.listElements() });
    window.location.hash = '#/w/wa/timeline';
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = mountTimeline(host, toasts);
    await tick();

    // Swap to world B under the SAME room instance (what app.ts did before S364).
    patchSlice('data', { elements: [], loading: true, loadingProgress: null } as never);
    window.location.hash = '#/w/wb/timeline';
    setActiveStore(B as unknown as FsFolderStore);
    patchSlice('active', { worldId: 'wb', meta: await B.readWorldMeta(), opened: true } as never);
    patchSlice('data', { elements: await B.listElements(), loading: false } as never);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await tick();

    host.querySelector<HTMLButtonElement>('[data-action="save-chart"]')!.click();
    await tick();
    const bCharts = (await B.readCharts()).map(c => c.name);
    unmount();
    host.remove();
    expect(bCharts).toContain('B: my only chart');
    expect(bCharts).not.toContain('A: the long war');
    expect(bCharts).toHaveLength(2);
  });
});
