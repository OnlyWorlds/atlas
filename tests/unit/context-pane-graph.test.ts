/**
 * Context-graph neighbour collection (context-pane-graph.ts) — the pure read
 * that turns one element into its direct graph neighbours. Locks the audit's
 * B-armor edges: multi-link + single-link id scanning, the id-shape heuristic,
 * the skip set (identity/sync/parent), and self-link removal.
 */

import { describe, it, expect } from 'vitest';
import { collectDirectNeighbors, looksLikeId } from '../../src/tabs/right/context-pane-graph';
import type { Element } from '../../src/core/types';

const ID = {
  self: '068e5012-d77c-799d-8000-000000000001',
  a: '068e5012-d77c-799d-8000-000000000002',
  b: '068e5012-d77c-799d-8000-000000000003',
  loc: '068e5012-d77c-799d-8000-000000000004',
  parent: '068e5012-d77c-799d-8000-000000000005',
};

function el(extra: Record<string, unknown>): Element {
  return { id: ID.self, type: 'character', name: 'Subject', local_updated_at: '2026-01-01', ...extra } as Element;
}

describe('looksLikeId', () => {
  it('accepts a 36-char hyphenated uuid', () => {
    expect(looksLikeId(ID.a)).toBe(true);
  });
  it('rejects short strings and strings without a hyphen', () => {
    expect(looksLikeId('short')).toBe(false);
    expect(looksLikeId('x'.repeat(36))).toBe(false); // right length, no hyphen
    expect(looksLikeId('')).toBe(false);
  });
});

describe('collectDirectNeighbors', () => {
  it('collects multi-link array members', () => {
    const n = collectDirectNeighbors(el({ characters: [ID.a, ID.b] }));
    expect(n.sort()).toEqual([ID.a, ID.b].sort());
  });

  it('collects id-shaped single-link fields', () => {
    const n = collectDirectNeighbors(el({ birthplace: ID.loc }));
    expect(n).toContain(ID.loc);
  });

  it('skips identity/sync/parent keys even when id-shaped', () => {
    const n = collectDirectNeighbors(el({ parent_narrative: ID.parent }));
    expect(n).not.toContain(ID.parent);
  });

  it('never includes the element itself', () => {
    const n = collectDirectNeighbors(el({ characters: [ID.self, ID.a] }));
    expect(n).not.toContain(ID.self);
    expect(n).toContain(ID.a);
  });

  it('ignores non-id string field values', () => {
    const n = collectDirectNeighbors(el({ description: 'a plain sentence, not an id' }));
    expect(n).toEqual([]);
  });

  it('reads the { id } object form of a single link', () => {
    const n = collectDirectNeighbors(el({ location: { id: ID.loc } }));
    expect(n).toContain(ID.loc);
  });

  it('dedupes an id reached through both a multi-link and a single-link field', () => {
    const n = collectDirectNeighbors(el({ characters: [ID.a], birthplace: ID.a }));
    expect(n.filter(x => x === ID.a)).toHaveLength(1);
  });
});

// The reverse read behind the web's backlinks — who links TO an element.
import { buildReverseIndex, collectIncomingNeighbors } from '../../src/tabs/right/context-pane-graph';

describe('buildReverseIndex / collectIncomingNeighbors', () => {
  const linker = { id: ID.a, type: 'title', name: 'Presiding Gamoros', local_updated_at: '2026-01-01', institutions: [ID.self] } as unknown as Element;
  const other = { id: ID.b, type: 'family', name: 'House', local_updated_at: '2026-01-01', location: ID.loc } as unknown as Element;
  const subject = el({});

  it('lists elements whose fields name the target, and nothing else', () => {
    const inc = collectIncomingNeighbors(ID.self, [subject, linker, other]);
    expect(inc).toEqual([ID.a]);
    expect(collectIncomingNeighbors(ID.loc, [subject, linker, other])).toEqual([ID.b]);
  });

  it('is the exact mirror of collectDirectNeighbors (one read, two directions)', () => {
    const world = [subject, linker, other];
    const reverse = buildReverseIndex(world);
    for (const e of world) {
      for (const target of collectDirectNeighbors(e)) {
        expect(reverse.get(target)?.has(e.id)).toBe(true);
      }
    }
  });

  it('never lists the target as its own backlink', () => {
    const selfRef = el({ characters: [ID.self] });
    expect(collectIncomingNeighbors(ID.self, [selfRef])).toEqual([]);
  });

  it('returns an empty list for an element nothing points at', () => {
    expect(collectIncomingNeighbors(ID.parent, [subject, linker, other])).toEqual([]);
  });
});

describe('collectDirectNeighbors — multi-links outside the named list', () => {
  it('reads an unlisted array-of-ids field like `governs`', () => {
    const n = collectDirectNeighbors(el({ governs: [ID.a, ID.b] }));
    expect(n).toEqual(expect.arrayContaining([ID.a, ID.b]));
  });
  it('ignores arrays of non-id strings', () => {
    const n = collectDirectNeighbors(el({ tags: ['alpha', 'beta'] }));
    expect(n).toEqual([]);
  });
});
