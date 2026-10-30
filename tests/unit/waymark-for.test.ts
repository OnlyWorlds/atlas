/**
 * waymarkFor: the mark shows only where the site has a page for this reader
 * (contract `2026-10-30-s519-atlas-waymark-contract.md`, R1 to R3, and its
 * code gate's C2 and C3): keel's world address sends on the owner and every member; an
 * element's address also a signed-in member; a read key, a player's link or
 * an agent seat reach the site only through the public page, which shows no
 * hidden, room or proposed element.
 */
import { describe, it, expect } from 'vitest';
import { waymarkFor } from '../../src/core/waymark-for';
import type { Element, WorldRegistryEntry } from '../../src/core/types';

const WID = '0195a3c0-0000-7000-8000-000000000001';
const EID = '0195a3c0-0000-7000-8000-0000000000e1';
const meta = { name: 'Harbour world', x_names: { collective: 'Crew' } };

const linked = (api: Partial<NonNullable<WorldRegistryEntry['api']>> = {}, extra: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry =>
  ({ id: 'folder-id', name: 'Harbour world', state: 'api-linked', api: { world_id: WID, api_key: 'k', ...api }, ...extra }) as WorldRegistryEntry;

const el = (extra: Record<string, unknown> = {}): Element =>
  ({ id: EID, type: 'event', name: 'The Founding', local_updated_at: 'x', server_updated_at: '2026-10-30T10:00:00Z', doors: { created: { via: 'atlas' } }, ...extra }) as unknown as Element;

const owners = [linked(), linked({ member_role: 'owner', membership: null })];
const members = [linked({ member_role: 'co_builder', membership: 'm1' }), linked({ member_role: 'contributor', membership: 'm2' }), linked({ member_role: 'guest', membership: 'm3' })];
const seats = [linked({ seat: { role: 'contributor' }, member_role: 'contributor' }), linked({ seat: { role: 'guest' }, read_only: true })];
const readKey = linked({ read_only: true });

describe('the world\'s own mark', () => {
  it('the owner, by account or by world key, before or after /me: on the keel world id, with the world\'s words', () => {
    for (const e of owners) {
      expect(waymarkFor(e, null, { meta })).toEqual({ world: { id: WID, name: 'Harbour world', x_names: meta.x_names }, element: null, reader: 'member' });
    }
  });

  it('a member who is not the owner: the member\'s mark, whatever the public page (keel\'s world address sends every live member to their page)', () => {
    for (const e of members) {
      for (const publicPageOn of [undefined, false, true]) {
        expect(waymarkFor(e, null, { meta, publicPageOn })?.reader).toBe('member');
      }
    }
  });

  it('a read key, a player\'s link or an agent seat: the public face, only while the public page is on', () => {
    for (const e of [readKey, ...seats]) {
      expect(waymarkFor(e, null, { meta })).toBeNull();
      expect(waymarkFor(e, null, { meta, publicPageOn: null })).toBeNull();
      expect(waymarkFor(e, null, { meta, publicPageOn: false })).toBeNull();
      expect(waymarkFor(e, null, { meta, publicPageOn: true })?.reader).toBe('public');
    }
  });

  it('none on a local world, a browser world never made online, an entry with no world id, or a copy', () => {
    expect(waymarkFor(null, null, { meta })).toBeNull();
    expect(waymarkFor({ id: 'f', name: 'F', state: 'local-only' } as WorldRegistryEntry, null, { meta })).toBeNull();
    expect(waymarkFor({ id: 'f', name: 'F', state: 'local-only', where: 'browser' } as WorldRegistryEntry, null, { meta })).toBeNull();
    expect(waymarkFor({ id: 'f', name: 'F', state: 'api-linked', api: { api_key: 'k' } } as WorldRegistryEntry, null, { meta })).toBeNull();
    expect(waymarkFor(linked({ read_only: true }, { copy_of: 'other-folder' } as Partial<WorldRegistryEntry>), null, { meta, publicPageOn: true })).toBeNull();
    expect(waymarkFor(linked({}, { copy_of: 'other-folder' } as Partial<WorldRegistryEntry>), null, { meta })).toBeNull();
  });
});

describe('an element\'s mark', () => {
  it('the owner or a member, once it reached keel: the body with keel\'s time as updated_at, so "Last shaped" dates right', () => {
    for (const e of [...owners, ...members]) {
      expect(waymarkFor(e, el(), { meta })?.element).toMatchObject({ id: EID, type: 'event', name: 'The Founding', updated_at: '2026-10-30T10:00:00Z', doors: { created: { via: 'atlas' } } });
      expect(waymarkFor(e, el(), { meta })?.reader).toBe('member');
    }
  });

  it('made here and not yet pushed, or kept here outside the key\'s view: none', () => {
    expect(waymarkFor(linked(), el({ server_updated_at: undefined }), { meta })).toBeNull();
    expect(waymarkFor(linked(), el({ server_updated_at: '' }), { meta })).toBeNull();
    expect(waymarkFor(linked(), el(), { meta, kept: true })).toBeNull();
  });

  it('the public face: only while the page is on, and never for a hidden, room or proposed element (the public page shows none)', () => {
    for (const e of [readKey, ...seats]) {
      expect(waymarkFor(e, el(), { meta, publicPageOn: false })).toBeNull();
      expect(waymarkFor(e, el(), { meta, publicPageOn: true })?.element).toEqual({ id: EID, type: 'event', name: 'The Founding' });
      expect(waymarkFor(e, el({ hidden: true }), { meta, publicPageOn: true })).toBeNull();
      expect(waymarkFor(e, el({ hidden: 'true' }), { meta, publicPageOn: true })).toBeNull();
      expect(waymarkFor(e, el({ type: 'narrative', supertype: 'Message', x_room_of: 'room' }), { meta, publicPageOn: true })).toBeNull();
      expect(waymarkFor(e, el({ x_review_proposed: { by: 'm9' } }), { meta, publicPageOn: true })).toBeNull();
    }
    // The owner's hidden element still has its own page for the owner.
    expect(waymarkFor(linked(), el({ hidden: true }), { meta })?.reader).toBe('member');
  });

  it('a known-of stub passes the name and type only; an empty name reads (unnamed)', () => {
    expect(waymarkFor(linked(), el({ name: '' }), { meta, stub: true })?.element).toEqual({ id: EID, type: 'event', name: '(unnamed)' });
  });
});
