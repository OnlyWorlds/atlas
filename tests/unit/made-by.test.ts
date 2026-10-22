/**
 * #350: who made an element, from keel's created_by and the roster's kind (the seat, never
 * the door), and the parlor's room pairs the list can hide.
 */
import { describe, it, expect } from 'vitest';
import type { OwMember } from '@onlyworlds/sdk';
import { madeByOf, rosterHasAgent, rosterKinds } from '../../src/core/made-by';
import { isRoomElement } from '../../src/core/parlor-room';
import type { Element } from '../../src/core/types';

const AGENT = 'a0000000-0000-4000-8000-000000000001';
const PERSON = 'a0000000-0000-4000-8000-000000000002';
const PLAYER = 'a0000000-0000-4000-8000-000000000003';
const GONE_AGENT = 'a0000000-0000-4000-8000-000000000004';

const roster: OwMember[] = [
  { id: null, kind: 'owner', role: 'owner', character: null, status: 'active' },
  { id: AGENT, kind: 'agent', role: 'contributor', character: null, status: 'active', name: 'Codex' },
  { id: PERSON, kind: 'person', role: 'co_builder', character: null, status: 'active' },
  { id: PLAYER, kind: 'player', role: 'guest', character: null, status: 'active' },
  { id: GONE_AGENT, kind: 'agent', role: 'contributor', character: null, status: 'removed' },
] as OwMember[];

const el = (extra: Record<string, unknown>, type = 'character'): Element =>
  ({ id: 'e1', type, name: 'x', ...extra }) as unknown as Element;

describe('madeByOf', () => {
  const kinds = rosterKinds(roster);

  it('an agent seat made it: agents, a removed seat too', () => {
    expect(madeByOf(el({ created_by: AGENT }), kinds)).toBe('agents');
    expect(madeByOf(el({ created_by: GONE_AGENT }), kinds)).toBe('agents');
  });

  it('a person, a player or the owner made it: people', () => {
    expect(madeByOf(el({ created_by: PERSON }), kinds)).toBe('people');
    expect(madeByOf(el({ created_by: PLAYER }), kinds)).toBe('people');
    expect(madeByOf(el({ created_by: null }), kinds)).toBe('people');
  });

  it('the seat decides, not the door: the owner\'s write through MCP is the owner\'s', () => {
    expect(madeByOf(el({ created_by: null, changed_via: 'mcp' }), kinds)).toBe('people');
    // ...and an agent's element a person changed last is still the agent's.
    expect(madeByOf(el({ created_by: AGENT, changed_by: PERSON, changed_via: 'api' }), kinds)).toBe('agents');
  });

  it('made here and not yet read back from keel: this person\'s', () => {
    expect(madeByOf(el({}), kinds)).toBe('people');
    expect(madeByOf(el({}), null)).toBe('people');
  });

  it('cannot be told: a membership the roster lacks, no roster, a known-of stub', () => {
    expect(madeByOf(el({ created_by: 'a0000000-0000-4000-8000-0000000000ff' }), kinds)).toBeNull();
    expect(madeByOf(el({ created_by: AGENT }), null)).toBeNull();
    // keel serves created_by null on every stub, whoever made it.
    expect(madeByOf(el({ created_by: null, known_of: true }), kinds)).toBeNull();
  });

  it('rosterHasAgent: only a roster with an agent seat offers the filter', () => {
    expect(rosterHasAgent(roster)).toBe(true);
    expect(rosterHasAgent(roster.filter(r => r.kind !== 'agent'))).toBe(false);
    expect(rosterHasAgent(null)).toBe(false);
  });
});

describe('isRoomElement', () => {
  it('the parlor\'s pairs, in any case, trimmed', () => {
    expect(isRoomElement(el({ supertype: 'Message' }, 'narrative'))).toBe(true);
    expect(isRoomElement(el({ supertype: ' board ' }, 'narrative'))).toBe(true);
    expect(isRoomElement(el({ supertype: 'Work item' }, 'relation'))).toBe(true);
    expect(isRoomElement(el({ supertype: 'Spec' }, 'construct'))).toBe(true);
    expect(isRoomElement(el({ supertype: 'Heart' }, 'relation'))).toBe(true);
    expect(isRoomElement(el({ supertype: 'VOTE' }, 'relation'))).toBe(true);
    expect(isRoomElement(el({ supertype: 'Sitting' }, 'event'))).toBe(true);
    expect(isRoomElement(el({ supertype: 'Member' }, 'character'))).toBe(true);
  });

  it('a pair, never the word alone; the charter stays; no supertype is no room', () => {
    expect(isRoomElement(el({ supertype: 'Board' }, 'location'))).toBe(false);
    expect(isRoomElement(el({ supertype: 'Message' }, 'object'))).toBe(false);
    expect(isRoomElement(el({ supertype: 'Charter' }, 'law'))).toBe(false);
    expect(isRoomElement(el({}, 'narrative'))).toBe(false);
    expect(isRoomElement(el({ supertype: 'Messages' }, 'narrative'))).toBe(false);
  });
});
