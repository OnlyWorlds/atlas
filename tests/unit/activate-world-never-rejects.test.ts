/**
 * An open never rejects (conv. 142, the S405 census, S406). A toast's Open it,
 * a retry and a world row's click call `activateWorld` and forget it, so a
 * failure that escaped the open's own catches reached the unhandled-rejection
 * reporter as background work. The open says it as itself and resolves false;
 * a silent open (boot's auto-activate) only logs.
 */
import { describe, it, expect, vi } from 'vitest';

// The registry read at the open's first line throws, once: something the open's
// own catches never wrap. Once only, since the problem reporter reads the
// registry too (to name the world), and it must be able to.
let failNext = false;
vi.mock('../../src/core/state', async (orig) => {
  const real = await orig<typeof import('../../src/core/state')>();
  return {
    ...real,
    getState: () => {
      const s = real.getState();
      if (!failNext) return s;
      failNext = false;
      return { ...s, registry: { ...s.registry, get worlds(): never { throw new Error('the registry would not read'); } } };
    },
  };
});

const problems: Array<{ sentence: string }> = [];
const toasts = () => ({
  info: vi.fn(), success: vi.fn(), error: vi.fn(), show: vi.fn(),
  problem: vi.fn((p: { sentence: string }) => { problems.push(p); }),
});

describe('activateWorld: a failure the open did not catch', () => {
  it('resolves false and says it as opening this world', async () => {
    const { activateWorld } = await import('../../src/sidebar/worlds-sidebar');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    problems.length = 0;
    failNext = true;
    await expect(activateWorld('w-1', toasts() as never)).resolves.toBe(false);
    expect(problems).toHaveLength(1);
    expect(problems[0].sentence).toMatch(/opening this world/);
    expect(problems[0].sentence).not.toMatch(/in the background/);
  });

  it('a silent open resolves false and says nothing', async () => {
    const { activateWorld } = await import('../../src/sidebar/worlds-sidebar');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    problems.length = 0;
    failNext = true;
    const t = toasts();
    await expect(activateWorld('w-1', t as never, { silent: true })).resolves.toBe(false);
    expect(problems).toHaveLength(0);
    expect(t.error).not.toHaveBeenCalled();
  });
});
