/**
 * The demo door never rejects (Boss 2026-10-14). `#/try-demo` fires
 * `openDemoWorld` and forgets it, and a copy already here opens outside the
 * download's own catch, so a failure there reached the unhandled-rejection
 * reporter: "Atlas ran into a problem it did not expect while working in the
 * background". The door says the failure itself, as what it was doing.
 */
import { describe, it, expect, vi } from 'vitest';
import { DEMO_WORLD_ID } from '../../src/setup/demo-copy';

vi.mock('../../src/core/capabilities', async (orig) => ({
  ...(await orig<typeof import('../../src/core/capabilities')>()),
  opfsStatus: async () => 'ok',
  hasFolderMode: () => false,
}));
vi.mock('../../src/core/browser-home', async (orig) => ({
  ...(await orig<typeof import('../../src/core/browser-home')>()),
  worldAlreadyHere: (_reg: unknown, id: string) => ({ id, name: 'Moppetopia', state: 'local-only' }),
}));
vi.mock('../../src/sidebar/worlds-sidebar', () => ({
  activateWorld: async () => { throw new Error('the open wedged'); },
}));

describe('openDemoWorld: a copy already here that will not open', () => {
  it('resolves, and says it as the demo door, never as background work', async () => {
    const { openDemoWorld } = await import('../../src/ui/open-world-file');
    const problems: Array<{ sentence: string }> = [];
    const toasts = {
      info: vi.fn(), success: vi.fn(), error: vi.fn(), show: vi.fn(),
      problem: vi.fn((p: { sentence: string }) => { problems.push(p); }),
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(openDemoWorld(toasts as never)).resolves.toBeUndefined();
    expect(problems).toHaveLength(1);
    expect(problems[0].sentence).toMatch(/downloading Moppetopia/);
    expect(problems[0].sentence).not.toMatch(/in the background/);
    expect(toasts.success).not.toHaveBeenCalled();
    expect(DEMO_WORLD_ID).toBeTruthy();
  });
});
