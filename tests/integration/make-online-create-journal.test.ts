/**
 * Make online, Create new, while an id update in this world stands unfinished
 * (`.atlas/rekey-journal.json`): the engine skips every round while the
 * journal stands, so a world made now would go online empty under "is
 * online". The dialog refuses before anything is sent, as the link route does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { world, putEl, j, JOURNAL } from './route2-gate/harness';
import { mountKeel, openLocalWorld, submitCreateNew, setUp, tearDown, type Keel } from './make-online-create-harness';
import { getState } from '../../src/core/state';

const A = '00000000-0000-4000-8000-0000000000a1';

let keel: Keel;

beforeEach(() => { setUp(); keel = mountKeel(); });
afterEach(tearDown);

describe('Make online, Create new, with an id update unfinished', () => {
  it('refuses with what to do, makes no world, and changes nothing on disk', async () => {
    const root = world();
    putEl(root, { id: A, type: 'character', name: 'Mop' });
    root.put(JOURNAL, j({
      version: 1, world_id: 'w1', map: { [A]: '00000000-0000-4000-8000-0000000000f6' }, types: { [A]: 'character' },
      stamps: {}, unrewritten: [], started_at: '2026-01-01T00:00:00.000Z', origin: 'rekey',
    }));
    await openLocalWorld(root);
    const before = new Map(root.list().map(p => [p, root.get(p)]));

    const modal = submitCreateNew();
    const error = modal.querySelector<HTMLElement>('[data-role="create-error"]')!;
    await vi.waitFor(() => expect(error.hidden).toBe(false), { timeout: 5000 });
    expect(error.textContent).toBe('An id update in this world did not finish. In Settings, under This world, use Finish it or Undo it, then make it online.');

    expect(keel.worldsMade(), 'no POST /account/worlds').toBe(0);
    expect(getState().registry.worlds[0].state).toBe('local-only');
    expect(new Map(root.list().map(p => [p, root.get(p)])), 'the disk as it was').toEqual(before);
    // The dialog gives the form back for another try.
    expect(modal.querySelector<HTMLButtonElement>('[data-action="create-submit"]')!.disabled).toBe(false);
  });
});
