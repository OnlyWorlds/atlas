/**
 * Gate lens B probe B-5: "Retry now" on a failed now-time save must
 * never write into a world opened since. Asserts the FIXED behaviour.
 */
import { describe, it, expect, vi } from 'vitest';

const captured: Array<{ doing: string; retry?: () => unknown }> = [];
vi.mock('../../../src/ui/problem-fixes', () => ({
  showProblem: (_err: unknown, opts: { doing: string; retry?: () => unknown }) => { captured.push(opts); return {}; },
  detailsContext: () => ({}),
}));

import { MockFolderStore } from '../../fixtures/mock-folder-store';
import { mountTimeline } from '../../../src/middle/timeline';
import { setActiveStore } from '../../../src/core/active-store';
import { patchSlice } from '../../../src/core/state';
import { defaultRegistry } from '../../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../../src/core/types';
import type { FsFolderStore } from '../../../src/store/folder-store-fs';
import type { ToastManager } from '../../../src/ui/toast-manager';

const entry = (id: string) => ({ id, name: id, state: 'local', folder: { handle_key: id, folder_name: id }, created_at: '2026-01-01T00:00:00Z' }) as unknown as WorldRegistryEntry;
const toasts = { success: () => {}, error: () => {}, info: () => {}, warning: () => {}, show: () => {} } as unknown as ToastManager;
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}) })) as never;
const tick = () => new Promise(r => setTimeout(r, 50));

describe('B-5 setNow retry is scoped to the world that failed', () => {
  it('a Retry clicked after switching worlds does not write the now into the new world', async () => {
    const A = new MockFolderStore(); await A.open(null as never);
    const B = new MockFolderStore(); await B.open(null as never);
    await A.createElement('event', { name: 'Siege', start_date: 10 } as Partial<Element>);
    await B.createElement('event', { name: 'Flood', start_date: 5 } as Partial<Element>);
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry('wa'), entry('wb')] });

    const realWrite = A.writeWorldMeta.bind(A);
    let failNext = true;
    A.writeWorldMeta = (async (...args: Parameters<typeof realWrite>) => {
      if (failNext) { failNext = false; throw new DOMException('held', 'NoModificationAllowedError'); }
      return realWrite(...args);
    }) as typeof A.writeWorldMeta;

    setActiveStore(A as unknown as FsFolderStore);
    patchSlice('active', { worldId: 'wa', meta: await A.readWorldMeta(), opened: true } as never);
    patchSlice('data', { elements: await A.listElements() });
    window.location.hash = '#/w/wa/timeline';
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = mountTimeline(host, toasts);
    await tick();

    host.querySelector<HTMLButtonElement>('[data-action="set-now"]')!.click();
    await tick();
    const failed = captured.find(c => c.doing.includes('now time'));
    expect(failed?.retry).toBeTypeOf('function');

    // The user opens world B; the sticky toast from world A is still there.
    unmount();
    host.remove();
    setActiveStore(B as unknown as FsFolderStore);
    patchSlice('active', { worldId: 'wb', meta: await B.readWorldMeta(), opened: true } as never);
    patchSlice('data', { elements: await B.listElements(), loading: false } as never);

    await failed!.retry!();
    await tick();
    expect((await B.readWorldMeta()).time_current).toBeUndefined();
  });
});
