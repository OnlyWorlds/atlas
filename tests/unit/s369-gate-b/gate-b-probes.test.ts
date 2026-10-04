/**
 * Gate lens B probes (S369, atlas 1.16). Each asserts the FIXED behaviour.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToastManager, toastManager } from '../../../src/ui/toast-manager';
import { showProblem } from '../../../src/ui/problem-fixes';
import { reportUnexpected, __resetUnexpectedErrors } from '../../../src/ui/unexpected-errors';
import { isPlainError } from '../../../src/core/plain-error';
import { problemFor } from '../../../src/core/problems';
import { SyncEngine } from '../../../src/sync/sync-engine';
import { FsFolderStore } from '../../../src/store/folder-store-fs';
import { FakeDirHandle } from '../../fixtures/fake-fs';
import { patchSlice } from '../../../src/core/state';
import { defaultRegistry } from '../../../src/core/types';
import { renderWorldTab } from '../../../src/middle/settings-world';
import { damagedFileSentence } from '../../../src/store/fs-utils';

const busy = () => new DOMException('held', 'NoModificationAllowedError');

describe('B-1 toast dedupe never drops another target\'s retry', () => {
  let toasts: ToastManager;
  let container: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="toast-container"></div>';
    container = document.getElementById('toast-container')!;
    toasts = new ToastManager();
    toasts.init();
  });

  it('two scenes failing with the same sentence keep both Retry buttons', async () => {
    const ran: string[] = [];
    // Same doing, same kind: the sentence is identical, the retries are not.
    showProblem(busy(), { doing: 'saving this scene', retry: () => { ran.push('A'); }, toasts });
    showProblem(busy(), { doing: 'saving this scene', retry: () => { ran.push('B'); }, toasts });
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.ow-toast button'))
      .filter(b => b.textContent === 'Retry now' && (b.closest('.ow-toast') as HTMLElement).style.opacity !== '0');
    for (const b of buttons) b.click();
    await Promise.resolve();
    expect(ran.sort()).toEqual(['A', 'B']);
  });
});

describe('B-2 an uncaught browser refusal is not worded as the world folder', () => {
  beforeEach(() => {
    __resetUnexpectedErrors();
    document.body.innerHTML = '<div id="toast-container"></div>';
    toastManager.init();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('a clipboard NotAllowedError reaching unhandledrejection offers no Allow access', () => {
    const spy = vi.spyOn(toastManager, 'problem');
    reportUnexpected(new DOMException('Document is not focused.', 'NotAllowedError'));
    expect(spy).toHaveBeenCalledTimes(1);
    const [problem, opts] = spy.mock.calls[0] as unknown as [{ sentence: string }, { fixes?: { label: string }[] }];
    expect(problem.sentence).not.toMatch(/this world's folder/);
    expect((opts.fixes ?? []).map(f => f.label)).not.toContain('Allow access');
  });
});

describe('B-3 a refusal written for users is a PlainError', () => {
  it('resolving a conflict during an id update says so as itself, not as a bug', async () => {
    const engine = new SyncEngine({
      folder: { hasRekeyJournal: async () => true } as never,
      client: {} as never,
    });
    let caught: unknown = null;
    try { await engine.resolveConflict('x', 'keep_local' as never); } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(problemFor(caught, { doing: 'resolving the conflict' }).kind).toBe('refused');
    expect(isPlainError(caught)).toBe(true);
  });

  it('an edit in a view-only world is refused in words, not as a bug', async () => {
    const root = new FakeDirHandle('w');
    root.put('world.json', JSON.stringify({ id: 'w1', name: 'W' }));
    root.put('elements/character/.keep', '');
    const store = new FsFolderStore({ tabId: 't', disableHeartbeat: true, forceTakeLock: true });
    await store.open(root as unknown as FileSystemDirectoryHandle);
    store.setViewOnly(true);
    let caught: unknown = null;
    try { await store.createElement('character', { name: 'X' } as never); } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(problemFor(caught, { doing: 'creating the element' }).kind).toBe('refused');
  });
});

describe('B-4 Settings, Not syncing: the stopped line reads as one sentence', () => {
  it('a damaged-file stop has no double full stop and keeps the file name as written', () => {
    const world = {
      id: 'e1', name: 'W', state: 'api-linked',
      folder: { handle_key: 'world-w1', folder_name: 'w' },
      api: { world_id: 'w1', api_key: 'k' },
    } as never;
    patchSlice('registry', { ...defaultRegistry(), worlds: [world] });
    patchSlice('data', { elements: [] });
    patchSlice('sync', {
      byWorld: { e1: { kind: 'error', message: damagedFileSentence('World.json'), recoverable: true } },
    } as never);
    const html = renderWorldTab(world);
    const div = document.createElement('div');
    div.innerHTML = html;
    const line = div.querySelector('[data-role="sync-stopped"]')?.textContent ?? '';
    expect(line).not.toBe('');
    expect(line).not.toMatch(/\.\.$/);
    expect(line).toContain('World.json');
  });
});
