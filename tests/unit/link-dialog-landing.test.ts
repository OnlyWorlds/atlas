/**
 * The link dialog through a browser world's landing (1.98.1): Stop and keep
 * hides once the saving starts (everything has downloaded), the saving line
 * shows, and Cancel stops offering itself once the last file has landed, when
 * the world is being registered and a cancel could no longer undo it (the
 * 1.98.1 code gate's M1: a live Cancel there said "Cancelling…" and the
 * world opened anyway).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InitialDownloadProgress } from '../../src/sync/initial-download';

vi.mock('../../src/ui/where-choice', () => ({
  whereChoiceHtml: () => '',
  wireWhereChoice: () => {},
  takeWhereInClick: () => 'browser',
  readyWhere: async () => true,
}));

const states: Array<{ at: string; finishHidden: boolean; cancelDisabled: boolean; line: string }> = [];
let release: () => void = () => {};
vi.mock('../../src/setup/atlas-root-flow', () => ({
  linkExistingApiWorldInRoot: async (opts: { onProgress?: (p: InitialDownloadProgress) => void }) => {
    const read = (at: string) => {
      const finish = document.querySelector<HTMLButtonElement>('[data-action="finish-early"]')!;
      const cancel = document.querySelector<HTMLButtonElement>('[data-action="cancel-link"]')!;
      states.push({ at, finishHidden: finish.hidden, cancelDisabled: cancel.disabled, line: document.querySelector('[data-role="progress"]')!.textContent ?? '' });
    };
    opts.onProgress?.({ done: 1, total: 3, phase: 'write' }); read('write');
    opts.onProgress?.({ done: 2, total: 4, phase: 'land' }); read('land mid');
    opts.onProgress?.({ done: 4, total: 4, phase: 'land' }); read('land end');
    opts.onProgress?.({ done: 1, total: 3, phase: 'open' }); read('open');
    await new Promise<void>(r => { release = r; });
    return { entry: { id: 'w', name: 'Hollow Reach' }, downloaded: 3, failures: [] };
  },
}));

import { LinkWorldModal } from '../../src/ui/link-world-modal';
import type { ToastManager } from '../../src/ui/toast-manager';

afterEach(() => { document.body.innerHTML = ''; states.length = 0; });

describe('the link dialog through the landing', () => {
  it('hides Stop and keep at the saving, and stops offering Cancel once the last file landed', async () => {
    const modal = new LinkWorldModal({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } as unknown as ToastManager);
    modal.open();
    const form = document.querySelector<HTMLFormElement>('.atlas-modal-overlay form')!;
    form.querySelector<HTMLInputElement>('input[name="api-key"]')!.value = 'ow_r_k';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(states).toHaveLength(4));
    const [write, mid, end, open] = states;
    expect(write).toMatchObject({ finishHidden: false, cancelDisabled: false, line: 'Downloading 1 of 3 elements…' });
    expect(mid).toMatchObject({ finishHidden: true, cancelDisabled: false, line: 'Saving 2 of 4 files in this browser…' });
    expect(end).toMatchObject({ finishHidden: true, cancelDisabled: true, line: 'Opening the world…' });
    expect(open).toMatchObject({ cancelDisabled: true, line: 'Opening the world… 1 of 3' });
    release();
  });
});
