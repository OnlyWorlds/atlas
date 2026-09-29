/**
 * PROMOTED from the S365 composition gate (lens C, consumers): the tour finale opens a world pick instead of saying "Folder ready".
 * Each asserts the fixed behaviour; red on the code before the gate fixes.
 */
import { describe, it, expect, vi } from 'vitest';

const fakeWorld = { kind: 'directory', name: 'agent-world' } as unknown as FileSystemDirectoryHandle;
vi.mock('../../src/setup/atlas-root-flow', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  setupAtlasRoot: async () => ({ imported: 0, worldFolder: fakeWorld }),
}));
const toasts: string[] = [];
vi.mock('../../src/ui/toast-manager', () => {
  const t = { success: (m: string) => toasts.push(`success:${m}`), info: (m: string) => toasts.push(`info:${m}`), error: (m: string) => toasts.push(`error:${m}`), warning: (m: string) => toasts.push(`warning:${m}`) };
  return { toastManager: t, ToastManager: class {} };
});

describe('C2: tour finale pointed at a world folder', () => {
  it('does not say "Folder ready" when no home folder was made', async () => {
    const { getState } = await import('../../src/core/state');
    const engine = await import('../../src/tour/tour-engine');
    try { await engine.setupFolderFromTour(); } catch { /* downstream open may throw in jsdom; the toast is the claim */ }
    expect(getState().atlasRoot).toBeNull();
    expect(toasts.filter(t => /Folder ready|folder set up/i.test(t))).toEqual([]);
  });
});
