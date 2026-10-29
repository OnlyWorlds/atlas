/**
 * The message line's words, by the message profile: an unproved sender never
 * reads as a proved one, an empty list is everyone, an id the world does not
 * hold is counted and never named. The rule: tests/unit/message-and-charter.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { messageParties } from '../../src/core/message-parties';
import { fillMessageParties, readsWholeWorld } from '../../src/middle/element-detail-message';
import type { Element, WorldRegistryEntry } from '../../src/core/types';

const el = (o: Record<string, unknown>): Element => o as unknown as Element;
const world = [
  el({ id: 'c1', type: 'character', name: 'Codex' }),
  el({ id: 'c2', type: 'character', name: 'BB' }),
  el({ id: 'c3', type: 'character', name: 'Kael' }),
];
const members = [{ id: null, character: 'c1' }, { id: 'm2', character: 'c2' }, { id: 'm3', character: 'c3' }];

function said(o: Record<string, unknown>, roster: typeof members | null = null, wholeWorld = true): string {
  const body = { id: 'n1', type: 'narrative', supertype: 'Message', server_updated_at: '2026-10-26T10:00:00Z', ...o };
  const parties = messageParties(el(body), world, { members: roster, wholeWorld });
  if (!parties) return '(no line)';
  const line = document.createElement('p');
  fillMessageParties(line, parties, 'w1');
  return line.textContent ?? '';
}

describe('the message line says what the profile proves', () => {
  it('a proved sender reads plainly, and only then', () => {
    expect(said({ narrator: 'c2', created_by: 'm2', characters: ['c3'] }, members)).toBe('From BB · To Kael');
    expect(said({ narrator: 'c2', created_by: 'm2', characters: ['c3'] })).toBe('Claims to be from BB · To Kael');
    expect(said({ narrator: 'c2', characters: ['c3'] }, members)).toBe('Claims to be from BB · To Kael');
  });

  it('a mismatch names the key that wrote it', () => {
    expect(said({ narrator: 'c1', created_by: 'm3', characters: ['c2'] }, members))
      .toBe("Claims to be from Codex, written by Kael's key · To BB");
    expect(said({ narrator: 'c1', created_by: 'm9', characters: ['c2'] }, [...members, { id: 'm9', character: 'c9' }]))
      .toBe("Claims to be from Codex, written by another member's key · To BB");
  });

  it('an empty list is everyone, a list of nothing valid is nobody', () => {
    expect(said({ narrator: 'c1', characters: [] })).toBe('Claims to be from Codex · To everyone');
    expect(said({ narrator: 'c1', characters: [''] })).toBe('Claims to be from Codex · To nobody');
  });

  it('ids Atlas holds no Character for are counted, never named', () => {
    expect(said({ narrator: 'gone', characters: ['c2', 'x1', 'x2'] })).toBe('Claims to be from someone not shown here · To BB and 2 others not shown here');
    expect(said({ narrator: 'c1', characters: ['x1'] })).toBe('Claims to be from Codex · To someone not shown here');
  });

  it('no Narrator is from nobody, never to everyone', () => {
    expect(said({ characters: ['c2'] })).toBe('From nobody · To BB');
    expect(said({ characters: [] })).toBe('(no line)');
  });

  it('who reads the whole world: an owner or co-builder key, a world made here, an owner\'s export', () => {
    const linked = (member_role?: string) => ({ state: 'api-linked', api: { member_role } }) as unknown as WorldRegistryEntry;
    const local = { state: 'local-only' } as unknown as WorldRegistryEntry;
    expect(readsWholeWorld(linked('owner'), {})).toBe(true);
    expect(readsWholeWorld(linked('co_builder'), {})).toBe(true);
    expect(readsWholeWorld(linked('contributor'), {})).toBe(false);
    expect(readsWholeWorld(linked('guest'), {})).toBe(false);
    expect(readsWholeWorld(linked(undefined), {})).toBe(false);
    expect(readsWholeWorld(local, {})).toBe(true);
    expect(readsWholeWorld(local, { exported_as: { kind: 'owner' } })).toBe(true);
    expect(readsWholeWorld(local, { exported_as: { kind: 'member', role: 'co_builder' } })).toBe(true);
    expect(readsWholeWorld(local, { exported_as: { kind: 'member', role: 'contributor' } })).toBe(false);
    expect(readsWholeWorld(local, { exported_as: { kind: 'character' } })).toBe(false);
  });

  it('a key that does not read the whole world never says everyone or nobody alone (the S484 gate G1)', () => {
    // keel strips links to what the key cannot see, so an empty list may be a private message.
    expect(said({ narrator: 'c1', characters: [] }, null, false)).toBe('Claims to be from Codex · To everyone, or someone hidden from you');
    expect(said({ characters: ['c2'] }, null, false)).toBe('From nobody, or someone hidden from you · To BB');
  });

  // #888: keel names in `x_served_trimmed` each field it served with ids this key may not see left out.
  it('a list served trimmed says someone you cannot see, never everyone or nobody', () => {
    const trimmed = { x_served_trimmed: ['characters'] };
    expect(said({ narrator: 'c1', characters: [], ...trimmed }, null, false)).toBe('Claims to be from Codex · To someone you cannot see');
    expect(said({ narrator: 'c1', characters: [], ...trimmed })).toBe('Claims to be from Codex · To someone you cannot see');
    expect(said({ narrator: 'c1', ...trimmed }, null, false)).toBe('Claims to be from Codex · To someone you cannot see');
    expect(said({ narrator: 'c1', characters: ['c2'], ...trimmed }, null, false)).toBe('Claims to be from Codex · To BB and someone you cannot see');
    expect(said({ narrator: 'c1', characters: ['c2', 'x1'], ...trimmed }, null, false))
      .toBe('Claims to be from Codex · To BB, someone not shown here and someone you cannot see');
  });

  it('a sender served trimmed is from someone you cannot see, never from nobody, proved or not', () => {
    const trimmed = { narrator: null, x_served_trimmed: ['narrator'] };
    expect(said({ characters: ['c2'], ...trimmed }, null, false)).toBe('From someone you cannot see · To BB');
    expect(said({ characters: ['c2'], created_by: 'm2', ...trimmed }, members, false)).toBe('From someone you cannot see · To BB');
    // An empty list without its own mark keeps its reading, and the line is drawn.
    expect(said({ characters: [], ...trimmed }, null, false)).toBe('From someone you cannot see · To everyone, or someone hidden from you');
    expect(said({ characters: [], narrator: null, x_served_trimmed: ['narrator', 'characters'] }, null, false))
      .toBe('From someone you cannot see · To someone you cannot see');
  });

  it('a mark that names neither field changes nothing', () => {
    expect(said({ narrator: 'c1', characters: [], x_served_trimmed: [] })).toBe('Claims to be from Codex · To everyone');
    expect(said({ characters: ['c2'], x_served_trimmed: ['characters'].slice(1) })).toBe('From nobody · To BB');
  });
});
