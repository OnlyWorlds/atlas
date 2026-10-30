/**
 * mayChange / mayAdd: who may change an element, read from the registry
 * entry's role and own membership (kept from `/me`) against the element's
 * `created_by` (a membership id; null for the owner; absent for one made here
 * and not yet read back).
 */
import { describe, it, expect } from 'vitest';
import { mayChange, mayAdd } from '../../src/core/may-change';
import type { Element, WorldRegistryEntry } from '../../src/core/types';

const ME = 'mem-me';
const OTHER = 'mem-other';

const entry = (api?: Partial<NonNullable<WorldRegistryEntry['api']>>, extra: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry =>
  ({ id: 'w', name: 'W', ...(api ? { api: { api_key: 'k', ...api } } : {}), ...extra }) as WorldRegistryEntry;

const el = (created_by?: string | null): Element =>
  ({ id: 'e', type: 'event', name: 'The Founding', local_updated_at: 'x', ...(created_by !== undefined ? { created_by } : {}) }) as Element;

describe('mayChange', () => {
  it('an owned world: a local one, an online one before its first round, the owner key', () => {
    for (const e of [undefined, entry(), entry({}), entry({ member_role: 'owner', membership: null })]) {
      expect(mayChange(e, el(OTHER))).toBe(true);
      expect(mayChange(e, el(null))).toBe(true);
      expect(mayChange(e, el())).toBe(true);
    }
  });

  it('a co-builder changes anything', () => {
    const e = entry({ member_role: 'co_builder', membership: ME });
    expect(mayChange(e, el(OTHER))).toBe(true);
    expect(mayChange(e, el(null))).toBe(true);
  });

  it('a contributor changes what was made here and not yet read back (created_by absent)', () => {
    expect(mayChange(entry({ member_role: 'contributor', membership: ME }), el())).toBe(true);
    expect(mayChange(entry({ member_role: 'contributor' }), el())).toBe(true);
  });

  it('a contributor changes their own after a pull (created_by is their membership)', () => {
    expect(mayChange(entry({ member_role: 'contributor', membership: ME }), el(ME))).toBe(true);
  });

  it('a contributor may not change another member\'s, nor the owner\'s (null)', () => {
    const e = entry({ member_role: 'contributor', membership: ME });
    expect(mayChange(e, el(OTHER))).toBe(false);
    expect(mayChange(e, el(null))).toBe(false);
  });

  it('a guest reads as a contributor does', () => {
    const e = entry({ member_role: 'guest', membership: ME });
    expect(mayChange(e, el())).toBe(true);
    expect(mayChange(e, el(ME))).toBe(true);
    expect(mayChange(e, el(OTHER))).toBe(false);
    expect(mayChange(e, el(null))).toBe(false);
  });

  it('no membership kept yet: only what was made here', () => {
    const e = entry({ member_role: 'contributor' });
    expect(mayChange(e, el(ME))).toBe(false);
    expect(mayChange(e, el(OTHER))).toBe(false);
    expect(mayChange(e, el(null))).toBe(false);
  });

  it('an agent seat before its first round reads its seat role', () => {
    const e = entry({ seat: { role: 'contributor' } });
    expect(mayChange(e, el(OTHER))).toBe(false);
    expect(mayChange(e, el())).toBe(true);
    expect(mayChange(entry({ seat: { role: 'co_builder' } }), el(OTHER))).toBe(true);
  });

  it('a view-only world changes nothing', () => {
    expect(mayChange(entry({ read_only: true, member_role: 'owner' }), el())).toBe(false);
    expect(mayChange(entry(undefined, { copy_of: { world_id: 'x' } } as unknown as Partial<WorldRegistryEntry>), el())).toBe(false);
  });
});

describe('mayAdd', () => {
  it('everywhere but a view-only world', () => {
    expect(mayAdd(undefined)).toBe(true);
    expect(mayAdd(entry({ member_role: 'guest', membership: ME }))).toBe(true);
    expect(mayAdd(entry({ read_only: true }))).toBe(false);
    expect(mayAdd(entry(undefined, { copy_of: { world_id: 'x' } } as unknown as Partial<WorldRegistryEntry>))).toBe(false);
  });
});
