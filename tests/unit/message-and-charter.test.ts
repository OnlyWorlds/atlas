/**
 * #526: a message says who it is from and to (Narrator, Characters, by the
 * crew's convention), and a world's charter is the Law with supertype Charter.
 */
import { describe, it, expect } from 'vitest';
import { isMessage, messageParties } from '../../src/core/message-parties';
import { charterLead, findCharter, isCharter } from '../../src/core/charter';
import type { Element } from '../../src/core/types';

const el = (o: Record<string, unknown>): Element => o as unknown as Element;
const codex = el({ id: 'c1', type: 'character', name: 'Codex' });
const bb = el({ id: 'c2', type: 'character', name: 'BB' });
const kael = el({ id: 'c3', type: 'character', name: ' Kael ' });
const place = el({ id: 'l1', type: 'location', name: 'Harbour' });
const world = [codex, bb, kael, place];

describe('messageParties, by the message profile', () => {
  // As keel served it: a stamp and no edit since, so its created_by counts.
  const msg = (o: Record<string, unknown>) => el({ id: 'n1', type: 'narrative', supertype: 'Message', server_updated_at: '2026-10-26T10:00:00Z', ...o });
  // keel's members list: the owner's row has id null; m2 plays BB, m3 plays Kael.
  const members = [{ id: null, character: 'c1' }, { id: 'm2', character: 'c2' }, { id: 'm3', character: 'c3' }];

  it('reads the claimed sender from the Narrator and the recipients from the Characters, in order', () => {
    const m = msg({ narrator: 'c1', characters: ['c2', 'c3'] });
    expect(messageParties(m, world)).toEqual({
      sender: 'unverifiable', from: { id: 'c1', name: 'Codex' }, fromOutside: false, writtenBy: null, writtenByOutside: false,
      toEveryone: false, to: [{ id: 'c2', name: 'BB' }, { id: 'c3', name: 'Kael' }], toOutside: 0, toUnseen: false, wholeWorld: true,
    });
  });

  it('knows a message by the pair, folded, the whole word', () => {
    expect(isMessage(el({ type: 'narrative', supertype: ' message ' }))).toBe(true);
    expect(isMessage(el({ type: 'narrative', supertype: 'Messages' }))).toBe(false);
    expect(isMessage(el({ type: 'narrative', supertype: 'Saga' }))).toBe(false);
    expect(isMessage(el({ type: 'narrative' }))).toBe(false);
    expect(isMessage(el({ type: 'event', supertype: 'Message' }))).toBe(false);
    expect(messageParties(el({ id: 'n', type: 'narrative', supertype: 'Saga', narrator: 'c1' }), world)).toBeNull();
  });

  it('is verified only when the roster proves the writer plays the Narrator', () => {
    expect(messageParties(msg({ narrator: 'c2', created_by: 'm2' }), world, { members })?.sender).toBe('verified');
    expect(messageParties(msg({ narrator: 'c1', created_by: null }), world, { members })?.sender).toBe('verified');
    // No roster, or no created_by at all (a folder): a claim.
    expect(messageParties(msg({ narrator: 'c2', created_by: 'm2' }), world, { members: null })?.sender).toBe('unverifiable');
    expect(messageParties(msg({ narrator: 'c2' }), world, { members })?.sender).toBe('unverifiable');
  });

  it('created_by proves nothing on a body keel did not serve as it is (the S484 gate G2)', () => {
    // Never stamped (made or hand-written here), or edited since the stamp: a claim.
    const unstamped = el({ id: 'n1', type: 'narrative', supertype: 'Message', narrator: 'c1', created_by: null });
    expect(messageParties(unstamped, world, { members })?.sender).toBe('unverifiable');
    const edited = msg({ narrator: 'c1', created_by: null, local_updated_at: '2026-10-26T11:00:00Z' });
    expect(messageParties(edited, world, { members })?.sender).toBe('unverifiable');
    const clean = msg({ narrator: 'c1', created_by: null, local_updated_at: '2026-10-26T09:00:00Z' });
    expect(messageParties(clean, world, { members })?.sender).toBe('verified');
  });

  it('a mismatch names whose key wrote it', () => {
    const p = messageParties(msg({ narrator: 'c1', created_by: 'm3' }), world, { members });
    expect(p?.sender).toBe('mismatch');
    expect(p?.from?.name).toBe('Codex');
    expect(p?.writtenBy).toEqual({ id: 'c3', name: 'Kael' });
  });

  it('an empty Characters list is addressed to everyone; a list of nothing valid to nobody', () => {
    expect(messageParties(msg({ narrator: 'c1', characters: [] }), world)?.toEveryone).toBe(true);
    expect(messageParties(msg({ narrator: 'c1' }), world)?.toEveryone).toBe(true);
    const none = messageParties(msg({ narrator: 'c1', characters: [''] }), world);
    expect(none?.toEveryone).toBe(false);
    expect(none?.to).toEqual([]);
    expect(none?.toOutside).toBe(0);
  });

  it('counts ids the world does not hold as Characters, and names none of them', () => {
    const p = messageParties(msg({ narrator: 'gone', characters: ['l1', 'c2', 'gone', 'c2'] }), world);
    expect(p?.from).toBeNull();
    expect(p?.fromOutside).toBe(true);
    expect(p?.to).toEqual([{ id: 'c2', name: 'BB' }]);
    expect(p?.toOutside).toBe(2);
  });

  it('a note to self lists its sender as written', () => {
    expect(messageParties(msg({ narrator: 'c1', characters: ['c1'] }), world)?.to).toEqual([{ id: 'c1', name: 'Codex' }]);
  });

  it('from nobody when there is no Narrator, and no line with nothing on it', () => {
    const p = messageParties(msg({ characters: ['c2'] }), world);
    expect(p?.from).toBeNull();
    expect(p?.fromOutside).toBe(false);
    expect(messageParties(msg({}), world)).toBeNull();
    expect(messageParties(msg({ characters: [] }), world)).toBeNull();
  });
});

describe('the charter', () => {
  const law = (o: Record<string, unknown>) => el({ type: 'law', ...o });

  it('is a Law with supertype Charter, in any case; a Construct named Charter is not', () => {
    expect(isCharter(law({ supertype: 'charter' }))).toBe(true);
    expect(isCharter(law({ supertype: 'Regulation', name: 'Charter' }))).toBe(false);
    expect(isCharter(el({ type: 'construct', supertype: 'Charter' }))).toBe(false);
  });

  // The pick is the charter profile's (serial 83), by the pair AND the mark; its fixture runs in charter-mark.test.ts.
  const M = { x_charter_of: 'w1' };

  it('the newest marked one leads (keel stamps created_at); an edit never moves it; a tie goes to the higher id', () => {
    // The older one has the higher id and the later edit, so neither the id nor the edit can pick it.
    const old = law({ id: 'z', name: 'Old', supertype: 'Charter', ...M, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-22T00:00:00Z' });
    const fresh = law({ id: 'b', name: 'New', supertype: 'Charter', ...M, created_at: '2026-10-21T00:00:00Z', updated_at: '2026-10-21T00:00:00Z' });
    expect(findCharter([old, fresh, place])?.id).toBe('b');
    const x = law({ id: 'x', name: 'A', supertype: 'Charter', ...M, created_at: '2026-10-21T00:00:00Z' });
    const y = law({ id: 'y', name: 'B', supertype: 'Charter', ...M, created_at: '2026-10-21T00:00:00Z' });
    expect(findCharter([y, x])?.id).toBe('y');
    const here = law({ id: 'h', name: 'Made here', supertype: 'Charter', ...M });
    expect(findCharter([fresh, here])?.id).toBe('b');                 // no created_at sorts as the oldest
    expect(findCharter([place])).toBeNull();
  });

  it('a Charter without the mark is lore, whoever made it: no Charter leads', () => {
    const owners = law({ id: 'o', name: 'House', supertype: 'Charter', created_by: null, created_at: '2026-10-01T00:00:00Z' });
    expect(findCharter([owners])).toBeNull();
    expect(findCharter([owners], 'o')).toBeNull();                    // world.json never stands in for the mark
  });

  it("world.json's charter picks among marked Charters only (§4.6 (a), v0.3.20); anything else leaves the newest", () => {
    const old = law({ id: 'a', name: 'Old', supertype: 'Charter', ...M, created_at: '2026-10-01T00:00:00Z' });
    const fresh = law({ id: 'b', name: 'New', supertype: 'Charter', ...M, created_at: '2026-10-21T00:00:00Z' });
    const plain = law({ id: 'c', name: 'House rules', supertype: 'Regulation', ...M });
    expect(findCharter([old, fresh, place], 'a')?.id).toBe('a');       // the tie-break, against the newer one
    expect(findCharter([old, fresh, plain], 'c')?.id).toBe('b');       // a marked Law of another supertype is no Charter
    for (const named of [place.id, 'gone', '', 7, null, undefined, ['a']]) {
      expect(findCharter([old, fresh, place], named)?.id).toBe('b');
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
