/**
 * Mark as this world's charter (1.100, the charter profile): offered on an
 * unmarked Charter Law, or the Law world.json names, only where the press can
 * be written; the mark names the account world when linked (the contract
 * gate's M3, M4, M6); keel's 403 `keeper_only` is about the element, never a
 * dead key (M5). Each refusal case has its writable control beside it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildCharterMarkOffer, canMarkCharter, charterMarkValue, offersCharterMark } from '../../src/middle/element-detail-charter-mark';
import { isAuthError } from '../../src/sync/sync-engine';
import { classifyFailure } from '../../src/sync/sync-failure-copy';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';

const WORLD = 'w-local';
const law = (o: Record<string, unknown>): Element => ({ id: 'l1', type: 'law', name: 'House rules', ...o }) as unknown as Element;

function register(entry: Partial<WorldRegistryEntry> & Record<string, unknown>): WorldRegistryEntry {
  const e = { id: WORLD, name: 'W', ...entry } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [e] });
  return e;
}

afterEach(() => {
  patchSlice('registry', defaultRegistry());
  document.body.innerHTML = '';
});

describe('which Law is offered the press', () => {
  it('an unmarked Charter Law, in any case of the word', () => {
    expect(offersCharterMark(law({ supertype: ' charter ' }), {})).toBe(true);
  });
  it('never a marked one, a proposed one, a Construct or another Law', () => {
    expect(offersCharterMark(law({ supertype: 'Charter', x_charter_of: 'w' }), {})).toBe(false);
    expect(offersCharterMark(law({ supertype: 'Charter', x_review_proposed: { by: 'm1' } }), {})).toBe(false);
    expect(offersCharterMark({ id: 'c', type: 'construct', supertype: 'Charter' } as unknown as Element, {})).toBe(false);
    expect(offersCharterMark(law({ supertype: 'Regulation' }), {})).toBe(false);
  });
  it('a Law of another supertype that world.json names (M6)', () => {
    expect(offersCharterMark(law({ supertype: 'Regulation' }), { charter: 'l1' })).toBe(true);
    expect(offersCharterMark(law({ supertype: 'Regulation' }), { charter: 'other' })).toBe(false);
  });
});

describe('who may press it (M3)', () => {
  it('a world on disk that is the whole world: yes', () => {
    const e = register({ state: 'local' });
    expect(canMarkCharter(e, { name: 'W' }, WORLD)).toBe(true);
  });
  it('a read-key world, even when keel answered owner: no', () => {
    const e = register({ state: 'api-linked', api: { world_id: 'acct', api_key: 'k', read_only: true, member_role: 'owner' } });
    expect(canMarkCharter(e, {}, WORLD)).toBe(false);
  });
  it('a view-only copy: no', () => {
    const e = register({ state: 'local', copy_of: { world_id: 'acct' } });
    expect(canMarkCharter(e, {}, WORLD)).toBe(false);
  });
  it('a linked contributor or guest: no; an owner or a co-builder: yes', () => {
    for (const [role, want] of [['contributor', false], ['guest', false], ['owner', true], ['co_builder', true]] as const) {
      const e = register({ state: 'api-linked', api: { world_id: 'acct', api_key: 'k', member_role: role } });
      expect(canMarkCharter(e, {}, WORLD)).toBe(want);
    }
  });
  it("a contributor's, a Character's or the public view on disk: no; the owner's or a co-builder's: yes", () => {
    const e = register({ state: 'local' });
    const as = (exported_as: Record<string, unknown>) => canMarkCharter(e, { exported_as }, WORLD);
    expect(as({ kind: 'member', role: 'contributor' })).toBe(false);
    expect(as({ kind: 'character', character: { name: 'Ana' } })).toBe(false);
    expect(as({ kind: 'public' })).toBe(false);
    expect(as({ kind: 'member', role: 'co_builder' })).toBe(true);
    expect(as({ kind: 'owner' })).toBe(true);
  });
  it('no offer is drawn where it cannot be pressed', () => {
    const e = register({ state: 'api-linked', api: { world_id: 'acct', api_key: 'k', member_role: 'contributor' } });
    expect(buildCharterMarkOffer(law({ supertype: 'Charter' }), e, {}, WORLD)).toBeNull();
    const own = register({ state: 'api-linked', api: { world_id: 'acct', api_key: 'k', member_role: 'owner' } });
    expect(buildCharterMarkOffer(law({ supertype: 'Charter' }), own, {}, WORLD)?.dataset.role).toBe('charter-mark');
  });
});

describe('what the mark names (M4)', () => {
  it("a linked world: the account world's id, not the folder's own", () => {
    const e = register({ state: 'api-linked', api: { world_id: 'acct-1', api_key: 'k', member_role: 'owner' } });
    expect(charterMarkValue(e, { id: 'folder-own' }, WORLD)).toBe('acct-1');
  });
  it("a world on disk: world.json's own id", () => {
    const e = register({ state: 'local' });
    expect(charterMarkValue(e, { id: 'folder-own' }, WORLD)).toBe('folder-own');
  });
});

describe("keel's refusal of the mark (M5)", () => {
  const refusal = Object.assign(new Error('keeper only'), { status: 403, code: 'keeper_only' });
  it('is not a dead key', () => {
    expect(isAuthError(refusal)).toBe(false);
    expect(isAuthError(Object.assign(new Error('x'), { status: 403, code: 'permission_error' }))).toBe(true); // the control
  });
  it('is said as its own kind', () => {
    expect(classifyFailure({ status: 403, code: 'keeper_only', element_id: 'l1' } as never)).toBe('keeper_mark');
  });
});
