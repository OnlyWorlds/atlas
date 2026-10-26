/**
 * The proposed page's sentence and header word (conv. 168), after Seethe's read
 * of 1.84.1 (2026-10-23): a change is "sent" only in a linked world and "saved"
 * in a folder world; the counts are said once; a lapsed proposal's header word
 * is one word, so a phone keeps the name its room.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../../src/sync/world-roster', () => ({ rosterNow: () => null, rosterFor: () => Promise.resolve(null) }));

import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import { buildProposedMark, proposedNoteFor } from '../../src/middle/element-agent-mark';

const proposed = (expires: string) =>
  ({ id: 'e1', type: 'character', name: 'Old ford', x_review_proposed: { by: null, evidence: 'seat', expires } }) as unknown as Element;

function world(state: 'api-linked' | 'local-only') {
  const entry = { id: 'w', name: 'Abbey', state, ...(state === 'api-linked' ? { api: { world_id: 's', api_key: 'k' } } : {}) } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: 'w', meta: { name: 'Abbey' } } as never);
  patchSlice('data', { elements: [] } as never);
}
afterEach(() => patchSlice('active', null));

describe("the proposed page's sentence", () => {
  beforeEach(() => world('local-only'));

  it('a folder world saves a change; the counts are said once', () => {
    const line = proposedNoteFor(proposed('2099-11-22'))!;
    expect(line).toMatch(/it is not part of the world, or its counts, until a keeper accepts it\./);
    expect(line).toMatch(/a change made here is saved as any other\.$/);
    expect(line).not.toMatch(/counted with the world's own/);
  });

  it('a linked world sends it', () => {
    world('api-linked');
    expect(proposedNoteFor(proposed('2099-11-22'))).toMatch(/a change made here is sent as any other\.$/);
  });

  it("the header's word: Proposed, and one word once lapsed; the label keeps the whole line", () => {
    expect(buildProposedMark(proposed('2099-11-22'))!.textContent).toBe('Proposed');
    const lapsed = buildProposedMark(proposed('2000-01-01'))!;
    expect(lapsed.textContent).toBe('Lapsed');
    expect(lapsed.getAttribute('aria-label')).toMatch(/^Proposed by a member .* The proposal lapsed on /);
  });
});
