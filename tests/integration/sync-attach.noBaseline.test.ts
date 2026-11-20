/**
 * conv. 192 at the attach: a round's rows for a copy with no record of what
 * OnlyWorlds held are never a local-wins overwrite. Under local-wins the
 * pull's row sets off no convergence push (R5) and the push's is never said
 * as "Your version replaced the online one"; the line says the row waits.
 * A `/bulk` slot that replaced an element is said (S5).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ToastAction } from '../../src/ui/toast-manager';
import { attachSyncEngine, detachSyncEngine, getCurrentSyncEngine, getCurrentSyncWorldId, __test_emitConflictToasts, heldCopyLine, bulkReplacedLine } from '../../src/sync/sync-attach';
import { toastManager } from '../../src/ui/toast-manager';
import { ConflictReviewModal } from '../../src/ui/conflict-review-modal';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setPin } from '../../src/registry/registry';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { WorldRegistryEntry, SyncResult, Conflict } from '../../src/core/types';

const entry: WorldRegistryEntry = {
  id: 'w1', name: 'A', state: 'api-linked',
  api: { world_id: 'srv-w1', api_key: 'key-w1' },
  folder: { handle_key: 'vault-w1', folder_name: 'A' },
  created_at: '2026-01-01T00:00:00Z',
};
const row = (noBaseline: boolean): Conflict => ({
  element_id: 'c1', type: 'character', detected_at: 't', local_updated_at: 'l', server_updated_at: 's', fields: ['description'],
  ...(noBaseline ? { no_baseline: true as const } : {}),
});
const result = (conflicts: Conflict[], extra: Partial<SyncResult> = {}): SyncResult => ({
  pushed: { creates: 0, updates: 0, deletes: 0 }, pulled: { creates: 0, updates: 0, deletes: 0 }, conflicts, failures: [], ...extra,
});
const localWins = () => ({ worldId: getCurrentSyncWorldId(), current: true, policy: 'local-wins' as const });

const SRC = join(__dirname, '..', '..', 'src');
/** Every `.ts` file under `src`. */
function srcFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? srcFiles(p) : /\.ts$/.test(name) ? [p] : [];
  });
}

let said: string[];
beforeEach(async () => {
  vi.useFakeTimers();
  detachSyncEngine();
  patchSlice('registry', setPin(defaultRegistry(), '1234'));
  const folder = new MockFolderStore();
  await folder.open(null);
  attachSyncEngine(entry, folder);
  said = [];
  for (const k of ['show', 'info', 'success', 'error'] as const) {
    vi.spyOn(toastManager, k).mockImplementation(((text: string) => { said.push(text); }) as never);
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  detachSyncEngine();
});

describe('a row with no record under local-wins', () => {
  it('a pull\'s row sets off no convergence push, and the line says it waits', async () => {
    const push = vi.spyOn(getCurrentSyncEngine()!, 'pushOnce').mockResolvedValue(result([]));
    __test_emitConflictToasts('pull', result([row(true)]), localWins());
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    expect(push).not.toHaveBeenCalled();
    expect(said).toEqual([heldCopyLine(1)]);
  });

  it('a push\'s row is never said as replaced; a plain conflict still is', () => {
    __test_emitConflictToasts('push', result([row(true)]), localWins());
    expect(said).toEqual([heldCopyLine(1)]);
    said = [];
    __test_emitConflictToasts('push', result([row(false)]), localWins());
    expect(said).toEqual(['Your version replaced the online one for 1 element']);
  });

  it('S5: a /bulk slot that replaced an element is said, naming the element from the open copy', () => {
    patchSlice('data', { elements: [{ id: 'c1', type: 'character', name: ' Ada ' }, { id: 'c2', type: 'character', name: '' }, { id: 'l1', type: 'location', name: 'Reef' }] } as never);
    try {
      __test_emitConflictToasts('push', result([], { bulk_replaced_ids: ['c1'] }), localWins());
      expect(said).toEqual(['OnlyWorlds already held character "Ada" and took this one in its place. Another place may have sent it first.']);
      said = [];
      // Two of one type: a count in its word; two types, or one not in the copy: elements.
      __test_emitConflictToasts('push', result([], { bulk_replaced_ids: ['c1', 'c2'] }), localWins());
      __test_emitConflictToasts('push', result([], { bulk_replaced_ids: ['c1', 'l1'] }), localWins());
      __test_emitConflictToasts('push', result([], { bulk_replaced_ids: ['c1', 'gone'] }), localWins());
      expect(said).toEqual([
        'OnlyWorlds already held 2 characters and took these in their place. Another place may have sent them first.',
        'OnlyWorlds already held 2 elements and took these in their place. Another place may have sent them first.',
        'OnlyWorlds already held 2 elements and took these in their place. Another place may have sent them first.',
      ]);
    } finally {
      patchSlice('data', { elements: [] } as never);
    }
  });

  it('S5: one replaced element with no name is said in its unnamed form, one the copy no longer holds without a name', () => {
    expect(bulkReplacedLine([{ type: 'location', name: '  ' }])).toBe('OnlyWorlds already held the unnamed location and took this one in its place. Another place may have sent it first.');
    expect(bulkReplacedLine([null])).toBe('OnlyWorlds already held an element and took this one in its place. Another place may have sent it first.');
  });
});

describe('the review list says one pair', () => {
  const plain: Conflict = { ...row(false), element_id: 'c2', fields: ['description'] };
  const proposal: Conflict = { ...row(false), element_id: 'c3', proposal: { outcome: 'declined', reason: 'Not yet' } };
  // OnlyWorlds holds a background this copy lacks: the row says what Keep this copy leaves.
  const held: Conflict = { ...row(true), element_id: 'c4', fields: ['description', 'background'], theirs: { description: 'theirs', background: 'bg' } };

  /** The review opened on these rows and one contested world setting, in the world given its registry entry. */
  async function review(viewOnly: boolean): Promise<HTMLElement> {
    vi.useRealTimers();
    const worlds = [viewOnly ? { ...entry, api: { ...entry.api!, read_only: true } } : entry];
    patchSlice('registry', { ...setPin(defaultRegistry(), '1234'), worlds } as never);
    patchSlice('active', { worldId: 'w1', meta: { name: 'A' } } as never);
    patchSlice('data', { elements: [
      { id: 'c2', type: 'character', name: 'Bo' }, { id: 'c3', type: 'character', name: 'Cy' }, { id: 'c4', type: 'character', name: 'Di', description: 'mine' },
    ] } as never);
    const engine = getCurrentSyncEngine()!;
    vi.spyOn(engine, 'listConflicts').mockResolvedValue([plain, proposal, held]);
    vi.spyOn(engine, 'listMetaConflicts').mockResolvedValue(['x_names']);
    await new ConflictReviewModal(toastManager).open();
    return document.querySelector<HTMLElement>('[data-modal="conflict-review"]')!;
  }

  afterEach(() => {
    document.body.innerHTML = '';
    patchSlice('active', null);
    patchSlice('data', { elements: [] } as never);
  });

  it('every row offers Keep this copy and Keep the OnlyWorlds copy, titled with what each does, and no word says server', async () => {
    const modal = await review(false);
    const rows = [...modal.querySelectorAll<HTMLElement>('.atlas-conflict-row')];
    expect(rows.length).toBe(4);
    for (const r of rows) {
      expect([...r.querySelectorAll('button')].map(b => b.textContent!.trim())).toEqual(['Keep this copy', 'Keep the OnlyWorlds copy']);
    }
    const titles = (sel: string) => [...modal.querySelectorAll<HTMLElement>(sel)].map(r => [...r.querySelectorAll('button')].map(b => b.title));
    expect(titles('[data-meta-conflict]')).toEqual([["Send this copy's setting to OnlyWorlds", "Replace this copy's setting with the one on OnlyWorlds"]]);
    expect(titles('[data-conflict-id="c2"], [data-conflict-id="c4"]')).toEqual([
      ['Send this copy to OnlyWorlds', 'Replace this copy with the one on OnlyWorlds'],
      ['Send this copy to OnlyWorlds', 'Replace this copy with the one on OnlyWorlds'],
    ]);
    expect(titles('[data-conflict-id="c3"]')).toEqual([['Send this copy to OnlyWorlds for review again', 'Drop your edit and replace this copy with the one on OnlyWorlds']]);
    // The meta row and the proposal's line say the same names.
    expect(modal.querySelector('[data-meta-conflict] .atlas-conflict-fields')!.textContent).toBe('changed here and on OnlyWorlds');
    expect(modal.querySelector('[data-role="proposal-line"]')!.textContent).toBe('The keeper declined your change: "Not yet". Keep this copy sends it for review again; Keep the OnlyWorlds copy drops it.');
    const read = modal.textContent! + [...modal.querySelectorAll<HTMLElement>('[title]')].map(e => e.title).join(' ');
    expect(read).not.toMatch(/server|mine wins|theirs wins|Overwrite|Pull \(/i);
  });

  it("a view-only world's rows, every one, offer only Keep the OnlyWorlds copy, with nothing in the other's place", async () => {
    const modal = await review(true);
    const rows = [...modal.querySelectorAll<HTMLElement>('.atlas-conflict-row')];
    expect(rows.length).toBe(4);
    for (const r of rows) {
      expect([...r.querySelectorAll('button')].map(b => b.textContent!.trim())).toEqual(['Keep the OnlyWorlds copy']);
      expect(r.querySelector('[data-action="overwrite-mine"]')).toBeNull();
    }
    // Nothing says what the missing button would have done: the held row's notes and the proposal's choice sentence go.
    expect(modal.textContent).not.toContain('Keep this copy');
    expect(modal.querySelector('[data-role="keeps-online"]')).toBeNull();
    expect(modal.querySelector('[data-role="proposal-line"]')!.textContent).toBe('The keeper declined your change: "Not yet".');
    expect(modal.querySelector('[data-meta-conflict] .atlas-conflict-fields')!.textContent).toBe('changed here and on OnlyWorlds');
    // An ordinary row's own line is unchanged: it says which fields differ, nothing of the missing button.
    expect(modal.querySelector('[data-conflict-id="c2"] .atlas-conflict-fields')!.textContent).toBe('1 field differ: description');
    // A writable world's rows offer both (the control).
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    const writable = await review(false);
    for (const r of writable.querySelectorAll<HTMLElement>('.atlas-conflict-row')) {
      expect([...r.querySelectorAll('button')].map(b => b.textContent!.trim())).toEqual(['Keep this copy', 'Keep the OnlyWorlds copy']);
    }
    expect(writable.querySelector('[data-conflict-id="c4"] [data-role="keeps-online"]')!.textContent).toBe('This copy lacks background, so Keep this copy leaves it as OnlyWorlds has it.');
  });
});

describe("the note that a copy waits carries its own press into the review", () => {
  const held: Conflict = { ...row(true), element_id: 'c4', theirs: { description: 'theirs' } };

  function heldToast(): { message: string; actions: ToastAction[] } {
    vi.useRealTimers();
    patchSlice('registry', { ...setPin(defaultRegistry(), '1234'), worlds: [entry] } as never);
    patchSlice('active', { worldId: 'w1', meta: { name: 'A' } } as never);
    patchSlice('data', { elements: [{ id: 'c4', type: 'character', name: 'Di' }] } as never);
    const engine = getCurrentSyncEngine()!;
    vi.spyOn(engine, 'listConflicts').mockResolvedValue([held]);
    vi.spyOn(engine, 'listMetaConflicts').mockResolvedValue([]);
    __test_emitConflictToasts('push', result([held]), localWins());
    const call = vi.mocked(toastManager.show).mock.calls.find(c => c[0] === heldCopyLine(1))!;
    return { message: call[0], actions: (call[3] as { actions?: ToastAction[] } | undefined)?.actions ?? [] };
  }
  const reviews = () => document.querySelectorAll('[data-modal="conflict-review"]').length;

  afterEach(() => {
    document.body.innerHTML = '';
    patchSlice('active', null);
    patchSlice('data', { elements: [] } as never);
  });

  it('the sentence names no button; the toast offers Review conflicts, which opens the review', async () => {
    const { message, actions } = heldToast();
    expect(message).toBe('One element waits for you to choose: this copy has no record of what OnlyWorlds held, so Atlas cannot tell which is newer. Nothing was sent.');
    expect(heldCopyLine(3)).toBe('3 elements wait for you to choose: these copies have no record of what OnlyWorlds held, so Atlas cannot tell which is newer. Nothing was sent.');
    expect(actions.map(a => a.label)).toEqual(['Review conflicts']);
    await actions[0].run();
    expect(reviews()).toBe(1);
    expect(document.querySelector('[data-conflict-id="c4"]')).not.toBeNull();
  });

  it('pressed while the review is open or opening, it opens no second one', async () => {
    const { actions } = heldToast();
    const opens = vi.spyOn(ConflictReviewModal.prototype, 'open');
    // Two presses at once: one review opened.
    await Promise.all([actions[0].run(), actions[0].run()]);
    expect(reviews()).toBe(1);
    expect(opens).toHaveBeenCalledTimes(1);
    // A press with the review on screen: it stays as it is.
    await actions[0].run();
    expect(reviews()).toBe(1);
    expect(opens).toHaveBeenCalledTimes(1);
  });

  it('pressed after another world was opened, it opens nothing and says so', async () => {
    const { actions } = heldToast();
    patchSlice('active', { worldId: 'w-other', meta: { name: 'B' } } as never);
    await actions[0].run();
    expect(reviews()).toBe(0);
    expect(said).toContain('Another world is open now. Switch back to review its conflicts.');
  });

  it('the pill\'s badge and the toast share one opener: no other place makes the review', () => {
    const hits: string[] = [];
    for (const file of srcFiles()) {
      readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/new ConflictReviewModal\(/.test(line)) hits.push(`${relative(SRC, file).split(sep).join('/')}:${i + 1}`);
      });
    }
    expect(hits.map(h => h.replace(/:\d+$/, ''))).toEqual(['ui/conflict-review-modal.ts']);
    expect(readFileSync(join(SRC, 'tabs/right/right-pane.ts'), 'utf8')).toContain('openConflictReview(toasts)');
  });

  it('the census: no sentence sends a person to Review conflicts as a place; the words are only the press\'s label', () => {
    const hits: string[] = [];
    for (const file of srcFiles()) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (rel === 'changelog/changelog.data.ts') continue;
      readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
        if (/['"`][^'"`]*Review conflicts/.test(line)) hits.push(`${rel}:${i + 1} ${line.trim()}`);
      });
    }
    expect(hits.map(h => h.replace(/:\d+ /, ' '))).toEqual(["sync/sync-attach.ts label: 'Review conflicts',"]);
    // The instrument sees the old sentence.
    expect(/['"`][^'"`]*Review conflicts/.test("? 'One element waits in Review conflicts: this copy has no record'")).toBe(true);
  });
});
