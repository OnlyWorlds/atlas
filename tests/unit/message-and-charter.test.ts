/**
 * #526: a message says who it is from and to (Narrator, Characters, by the
 * crew's convention), and a world's charter is the Law with supertype Charter.
 */
import { describe, it, expect } from 'vitest';
import { isMessage, messageParties } from '../../src/core/message-parties';
import { charterLead, findCharter, isCharter, rosterRoles } from '../../src/core/charter';
import type { Element } from '../../src/core/types';

const el = (o: Record<string, unknown>): Element => o as unknown as Element;
const codex = el({ id: 'c1', type: 'character', name: 'Codex' });
const bb = el({ id: 'c2', type: 'character', name: 'BB' });
const kael = el({ id: 'c3', type: 'character', name: ' Kael ' });
const place = el({ id: 'l1', type: 'location', name: 'Harbour' });
const world = [codex, bb, kael, place];

describe('messageParties', () => {
  it('reads the sender from the Narrator and the recipients from the Characters, in order', () => {
    const m = el({ id: 'n1', type: 'narrative', supertype: 'Message', narrator: 'c1', characters: ['c2', 'c3'] });
    expect(messageParties(m, world)).toEqual({ from: { id: 'c1', name: 'Codex' }, to: [{ id: 'c2', name: 'BB' }, { id: 'c3', name: 'Kael' }] });
  });

  it('knows a message by its supertype in any case, and nothing else', () => {
    expect(isMessage(el({ type: 'narrative', supertype: ' message ' }))).toBe(true);
    expect(isMessage(el({ type: 'narrative', supertype: 'Saga' }))).toBe(false);
    expect(isMessage(el({ type: 'narrative' }))).toBe(false);
    expect(isMessage(el({ type: 'event', supertype: 'Message' }))).toBe(false);
    expect(messageParties(el({ id: 'n', type: 'narrative', supertype: 'Saga', narrator: 'c1' }), world)).toBeNull();
  });

  it('leaves out ids the world does not hold and links that are not Characters', () => {
    const m = el({ id: 'n1', type: 'narrative', supertype: 'Message', narrator: 'gone', characters: ['l1', 'c2', 'gone'] });
    expect(messageParties(m, world)).toEqual({ from: null, to: [{ id: 'c2', name: 'BB' }] });
  });

  it('says the sender once when it is also a recipient, and each recipient once', () => {
    const m = el({ id: 'n1', type: 'narrative', supertype: 'Message', narrator: 'c1', characters: ['c1', 'c2', 'c2'] });
    expect(messageParties(m, world)?.to).toEqual([{ id: 'c2', name: 'BB' }]);
  });

  it('draws no line for a message with nobody in the world on it', () => {
    expect(messageParties(el({ id: 'n1', type: 'narrative', supertype: 'Message' }), world)).toBeNull();
  });
});

describe('the charter', () => {
  const law = (o: Record<string, unknown>) => el({ type: 'law', ...o });

  it('is a Law with supertype Charter, in any case; a Construct named Charter is not', () => {
    expect(isCharter(law({ supertype: 'charter' }))).toBe(true);
    expect(isCharter(law({ supertype: 'Regulation', name: 'Charter' }))).toBe(false);
    expect(isCharter(el({ type: 'construct', supertype: 'Charter' }))).toBe(false);
  });

  it('the newest by created_at leads, as keel orders it (D152); an edit never moves it; a tie goes to the higher id', () => {
    // The older one has the higher id and the later edit, so neither the id nor the edit can pick it.
    const old = law({ id: 'z', name: 'Old', supertype: 'Charter', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-22T00:00:00Z' });
    const fresh = law({ id: 'b', name: 'New', supertype: 'Charter', created_at: '2026-10-21T00:00:00Z', updated_at: '2026-10-21T00:00:00Z' });
    expect(findCharter([old, fresh, place])?.id).toBe('b');
    const x = law({ id: 'x', name: 'A', supertype: 'Charter', created_at: 't' });
    const y = law({ id: 'y', name: 'B', supertype: 'Charter', created_at: 't' });
    expect(findCharter([y, x])?.id).toBe('y');
    const here = law({ id: 'h', name: 'Made here', supertype: 'Charter' });
    expect(findCharter([fresh, here])?.id).toBe('h');                 // not read back yet: the newest
    expect(findCharter([place])).toBeNull();
  });

  it("counts only a Law the owner or a co-builder made (D152): never a guest's or a seat's, and none while the roster is unread", () => {
    const owners = law({ id: 'o', name: 'House', supertype: 'Charter', created_by: null, created_at: '2026-10-01T00:00:00Z' });
    const cobuilt = law({ id: 'k', name: 'Ours', supertype: 'Charter', created_by: 'm-co', created_at: '2026-10-10T00:00:00Z' });
    const seats = law({ id: 's', name: 'Mine', supertype: 'Charter', created_by: 'm-seat', created_at: '2026-10-20T00:00:00Z' });
    const roles = rosterRoles([
      { id: 'm-co', kind: 'person', role: 'co_builder' },
      { id: 'm-seat', kind: 'agent', role: 'contributor' },
    ] as never);
    expect(findCharter([owners, cobuilt, seats], undefined, roles)?.id).toBe('k');
    expect(findCharter([owners, cobuilt, seats])?.id).toBe('o');      // no roster: the owner's only
    expect(findCharter([seats], undefined, roles)).toBeNull();
    expect(findCharter([owners, seats], 's', roles)?.id).toBe('o');  // world.json naming a seat's Law does not make it the charter
  });

  it("world.json's charter names it (§4.6 (a)): a Law it names wins, anything else leaves the rule by supertype", () => {
    const old = law({ id: 'a', name: 'Old', supertype: 'Charter', created_at: '2026-10-01T00:00:00Z' });
    const fresh = law({ id: 'b', name: 'New', supertype: 'Charter', created_at: '2026-10-21T00:00:00Z' });
    const plain = law({ id: 'c', name: 'House rules', supertype: 'Regulation' });
    expect(findCharter([old, fresh, place], 'a')?.id).toBe('a');       // the tie-break, against the newer one
    expect(findCharter([old, fresh, plain], 'c')?.id).toBe('c');       // a Law it names, whatever its supertype
    for (const named of [place.id, 'gone', '', 7, null, undefined, ['a']]) {
      expect(findCharter([old, fresh, place], named)?.id).toBe('b'); // not a Law here, or not an id: the rule
    }
  });

  it('Home reads its first paragraph, cut at a word', () => {
    expect(charterLead(law({ description: 'What this world is.\nIt holds things.\n\nWho is here' }))).toBe('What this world is. It holds things.');
    const long = law({ description: 'word '.repeat(100) });
    const lead = charterLead(long, 40);
    expect(lead.endsWith('…')).toBe(true);
    expect(lead.length).toBeLessThanOrEqual(41);
    expect(charterLead(law({}))).toBe('');
  });
});
