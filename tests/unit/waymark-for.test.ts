/**
 * waymarkFor: the mark shows only where the site has a page for this reader
 * (contract `2026-10-30-s519-atlas-waymark-contract.md`, R1 to R3).
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

describe('the world', () => {
  it('a member on OnlyWorlds gets the mark on the keel world id, with the world\'s own words', () => {
    for (const e of [
      linked(), // the owner by account or by world key, before or after /me
      linked({ member_role: 'owner', membership: null }),
      linked({ member_role: 'co_builder', seat: { role: 'co_builder' } }),
      linked({ member_role: 'contributor', seat: { role: 'contributor' } }),
      linked({ member_role: 'guest', seat: { role: 'guest' } }),
    ]) {
      const plan = waymarkFor(e, null, { meta });
      expect(plan).toEqual({ world: { id: WID, name: 'Harbour world', x_names: meta.x_names }, element: null, reader: 'member' });
    }
  });

  it('no mark on a local world, a browser world never made online, an entry with no world id, or a copy', () => {
    expect(waymarkFor(null, null, { meta })).toBeNull();
    expect(waymarkFor({ id: 'f', name: 'F', state: 'local-only' } as WorldRegistryEntry, null, { meta })).toBeNull();
    expect(waymarkFor({ id: 'f', name: 'F', state: 'local-only', where: 'browser' } as WorldRegistryEntry, null, { meta })).toBeNull();
    expect(waymarkFor({ id: 'f', name: 'F', state: 'api-linked', api: { api_key: 'k' } } as WorldRegistryEntry, null, { meta })).toBeNull();
    expect(waymarkFor(linked({ read_only: true }, { copy_of: 'other-folder' } as Partial<WorldRegistryEntry>), null, { meta, publicPageOn: true })).toBeNull();
    expect(waymarkFor(linked({}, { copy_of: 'other-folder' } as Partial<WorldRegistryEntry>), null, { meta })).toBeNull();
  });

  it('a read key or a player\'s link: the public face only when the public page is on', () => {
    const readKey = linked({ read_only: true });
    expect(waymarkFor(readKey, null, { meta })).toBeNull();
    expect(waymarkFor(readKey, null, { meta, publicPageOn: null })).toBeNull();
    expect(waymarkFor(readKey, null, { meta, publicPageOn: false })).toBeNull();
    expect(waymarkFor(readKey, null, { meta, publicPageOn: true })?.reader).toBe('public');
  });

  it('a raised seat stays a member however its key reads (a seat is never the public face)', () => {
    expect(waymarkFor(linked({ read_only: true, seat: { role: 'guest' }, member_role: 'contributor' }), null, { meta })?.reader).toBe('member');
  });
});

describe('an element', () => {
  it('reached keel and still shown: the body with keel\'s time as updated_at, so "Last shaped" dates right', () => {
    const plan = waymarkFor(linked(), el(), { meta });
    expect(plan?.element).toMatchObject({ id: EID, type: 'event', name: 'The Founding', updated_at: '2026-10-30T10:00:00Z', doors: { created: { via: 'atlas' } } });
  });

  it('made here and not yet pushed, or kept here outside the key\'s view: no mark', () => {
    expect(waymarkFor(linked(), el({ server_updated_at: undefined }), { meta })).toBeNull();
    expect(waymarkFor(linked(), el({ server_updated_at: '' }), { meta })).toBeNull();
    expect(waymarkFor(linked(), el(), { meta, kept: true })).toBeNull();
  });

  it('a known-of stub and the public face pass the name and type only; an empty name reads (unnamed)', () => {
    expect(waymarkFor(linked(), el({ name: '' }), { meta, stub: true })?.element).toEqual({ id: EID, type: 'event', name: '(unnamed)' });
    expect(waymarkFor(linked({ read_only: true }), el(), { meta, publicPageOn: true })?.element).toEqual({ id: EID, type: 'event', name: 'The Founding' });
  });

  it('an element in a world with no mark has none either', () => {
    expect(waymarkFor({ id: 'f', name: 'F', state: 'local-only' } as WorldRegistryEntry, el(), { meta })).toBeNull();
    expect(waymarkFor(linked({ read_only: true }), el(), { meta, publicPageOn: false })).toBeNull();
  });
});
