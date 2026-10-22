/**
 * #350: who made an element, from keel's created_by and the roster's kind (the seat, never
 * the door), and the parlor's room pairs the list can hide.
 */
import { describe, it, expect } from 'vitest';
import type { OwMember } from '@onlyworlds/sdk';
import { madeByOf, rosterHasAgent, rosterKinds } from '../../src/core/made-by';
import { isRoomElement, loreElements, roomCount } from '../../src/core/parlor-room';
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
    expect(isRoomElement(el({ supertype: 'Message', x_room_of: 'w' }, 'narrative'))).toBe(true);
    expect(isRoomElement(el({ supertype: ' board ', x_room_of: 'w' }, 'narrative'))).toBe(true);
    expect(isRoomElement(el({ supertype: 'Work item', x_room_of: 'w' }, 'relation'))).toBe(true);
    expect(isRoomElement(el({ supertype: 'Spec', x_room_of: 'w' }, 'construct'))).toBe(true);
    expect(isRoomElement(el({ supertype: 'Heart', x_room_of: 'w' }, 'relation'))).toBe(true);
    expect(isRoomElement(el({ supertype: 'VOTE', x_room_of: 'w' }, 'relation'))).toBe(true);
    expect(isRoomElement(el({ supertype: 'Sitting', x_room_of: 'w' }, 'event'))).toBe(true);
    expect(isRoomElement(el({ supertype: 'Member', x_room_of: 'w' }, 'character'))).toBe(true);
  });

  it('a pair, never the word alone; the charter stays; no supertype is no room', () => {
    expect(isRoomElement(el({ supertype: 'Board' }, 'location'))).toBe(false);
    expect(isRoomElement(el({ supertype: 'Message' }, 'object'))).toBe(false);
    expect(isRoomElement(el({ supertype: 'Charter' }, 'law'))).toBe(false);
    expect(isRoomElement(el({}, 'narrative'))).toBe(false);
    expect(isRoomElement(el({ supertype: 'Messages' }, 'narrative'))).toBe(false);
  });
});

describe('the lore (1.76, OW Parlor #543)', () => {
  const lore = [el({ supertype: 'Story' }, 'narrative'), el({}, 'character')];
  const room = [el({ supertype: 'Message', x_room_of: 'w' }, 'narrative'), el({ supertype: 'Sitting', x_room_of: 'w' }, 'event')];
  // A lore world's own letter: a Message with no parlor's mark stays in the lore (dist.45).
  const letter = el({ supertype: 'Message' }, 'narrative');

  it('leaves the room out while it is hidden, and keeps it while shown', () => {
    const all = [...lore, letter, ...room];
    expect(loreElements(all, true)).toEqual([...lore, letter]);
    expect(loreElements(all, false)).toBe(all);
    expect(roomCount(all)).toBe(2);
  });

  it('is the same array while neither the elements nor the switch moved, so a render gate holds still', () => {
    const all = [...lore, ...room];
    const first = loreElements(all, true);
    expect(loreElements(all, true)).toBe(first);
    expect(loreElements(all, false)).not.toBe(first);
    expect(loreElements([...all], true)).not.toBe(first);
  });

  it('is the world itself when it holds no room', () => {
    expect(loreElements(lore, true)).toBe(lore);
  });
});

// schema-dist's room profile (v0.33.0-dist.45, profiles/room.fixture.json, copied whole): the cases
// every reader of the room answers, until the SDK's export replaces core/parlor-room.ts's copy.
import roomFixture from '../fixtures/room.fixture.json';
import { ROOM_SUPERTYPES } from '../../src/core/parlor-room';

describe("the room profile's cases (dist.45)", () => {
  it('holds the profile pairs, no more, no less', () => {
    const want = roomFixture.pairs.map(p => `${p.type}/${p.supertype.toLowerCase()}`).sort();
    expect(ROOM_SUPERTYPES.map(([t, w]) => `${t}/${w}`).sort()).toEqual(want);
  });
  for (const c of roomFixture.cases) {
    it(`${c.name}: ${c.in_room ? 'in the room' : 'lore'}`, () => {
      expect(isRoomElement(c.element as unknown as Element)).toBe(c.in_room);
    });
  }
});
