/**
 * A make dialog's failure says where the world was going (1.17, conv. 125,
 * 129; S376 lens C C21): the dialogs that ask the where-question pass the
 * answer to `problemFor`, so a browser make never says folder, disk or
 * OneDrive, whatever world happens to be open.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/where-choice', () => ({
  whereChoiceHtml: () => '',
  wireWhereChoice: () => {},
  takeWhereInClick: () => 'browser',
  readyWhere: async () => true,
}));
vi.mock('../../src/setup/atlas-root-flow', () => ({
  createWorldInRoot: async () => { throw Object.assign(new Error('gone'), { name: 'NotFoundError' }); },
}));

import { CreateWorldModal } from '../../src/ui/create-world-modal';
import { patchSlice } from '../../src/core/state';
import type { ToastManager } from '../../src/ui/toast-manager';

afterEach(() => { document.body.innerHTML = ''; patchSlice('active', null); });

describe('the create dialog', () => {
  it('a browser make that fails says this browser, never a folder, with a folder world open', async () => {
    // The open world is a folder world: its sentences must not leak in.
    patchSlice('active', { worldId: 'f1', meta: { id: 'f1', name: 'Folder world' }, opened: true } as never);
    const modal = new CreateWorldModal({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } as unknown as ToastManager);
    modal.open();
    const form = document.querySelector<HTMLFormElement>('.atlas-modal-overlay form')!;
    form.querySelector<HTMLInputElement>('input[name="world-name"]')!.value = 'Hollow Reach';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('[data-role="error"]')!.hidden).toBe(false));
    const said = document.querySelector<HTMLElement>('[data-role="error"]')!.textContent!;
    expect(said).not.toMatch(/folder|disk|OneDrive|drive/i);
  });
});

describe('every dialog that asks where passes the answer on (structural)', () => {
  const src = (p: string) => readFileSync(resolve(process.cwd(), 'src', p), 'utf8');
  for (const file of ['ui/create-world-modal.ts', 'ui/link-world-modal.ts', 'ui/new-api-world-modal.ts', 'ui/view-world-modal.ts']) {
    it(file, () => {
      const code = src(file);
      expect(code).toContain('takeWhereInClick(');
      const calls = [...code.matchAll(/problemFor\(err, \{([^}]*)\}\)/g)].map(m => m[1]);
      expect(calls.length).toBeGreaterThan(0);
      for (const args of calls) expect(args).toMatch(/\bwhere\b/);
    });
  }
});
