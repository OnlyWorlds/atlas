/**
 * Mark as this world's charter (1.100, the charter profile): offered on an
 * unmarked Charter Law, or the Law world.json names, only where the press can
 * be written; the mark names the account world when linked (the contract
 * gate's M3, M4, M6); keel's 403 `keeper_only` is about the element, never a
 * dead key (M5). Each refusal case has its writable control beside it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildCharterMarkOffer, canMarkCharter, charterMarkValue, markOfferFor, offersCharterMark } from '../../src/middle/element-detail-charter-mark';
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
  it('while a marked Charter leads, offered with the leading one named (1.101 G7: the retire follows on Home)', () => {
    const leading = law({ id: 'l0', name: 'Old Rules', supertype: 'Charter', x_charter_of: 'w', created_at: '2026-10-01T00:00:00Z' });
    const story = law({ supertype: 'Charter' });
    expect(markOfferFor(story, {}, [leading, story])?.leading?.id).toBe('l0');
    expect(markOfferFor(story, {}, [story])?.leading).toBeNull();                   // the control
    const box = buildCharterMarkOffer(story, register({ state: 'local-only' }), {}, WORLD, [leading, story]);
    expect(box?.textContent).toMatch(/This world's charter is Old Rules\. Marking this one makes it the charter, and Home then offers to retire Old Rules\./);
    expect(box?.textContent).toMatch(/lists then leave it out/);
  });
  it('a Guide and a Domain Construct, unmarked, each with its own words', () => {
    const c = (o: Record<string, unknown>): Element => ({ id: 'c1', type: 'construct', name: 'Start', ...o }) as unknown as Element;
    expect(markOfferFor(c({ supertype: ' guide ' }), {})?.kind).toBe('guide');
    expect(markOfferFor(c({ supertype: 'Domain' }), {})?.kind).toBe('domain');
    expect(markOfferFor(c({ supertype: 'Domain', x_charter_of: 'w' }), {})).toBeNull();
    expect(markOfferFor(c({ supertype: 'Domain', x_review_proposed: { by: 'm1' } }), {})).toBeNull();
    expect(markOfferFor(c({ supertype: 'Region' }), {})).toBeNull();
    const e = register({ state: 'local-only' });
    expect(buildCharterMarkOffer(c({ supertype: 'Guide' }), e, {}, WORLD)?.querySelector('button')?.textContent).toBe("Mark as this world's guide");
    expect(buildCharterMarkOffer(c({ supertype: 'Domain' }), e, {}, WORLD)?.querySelector('button')?.textContent).toBe("Mark as one of this world's domains");
  });
  it('a marked Charter that does not lead offers the retire on its own page; the leading one offers nothing', () => {
    const old = law({ id: 'l0', name: 'Old Rules', supertype: 'Charter', x_charter_of: 'w', created_at: '2026-01-01T00:00:00Z' });
    const now = law({ id: 'l2', name: 'House Rules', supertype: 'Charter', x_charter_of: 'w', created_at: '2026-10-01T00:00:00Z' });
    const e = register({ state: 'local-only' });
    const box = buildCharterMarkOffer(old, e, {}, WORLD, [old, now]);
    expect(box?.dataset.role).toBe('aid-retire-offer');
    expect(box?.textContent).toMatch(/this world's charter is House Rules/);
    expect(buildCharterMarkOffer(now, e, {}, WORLD, [old, now])).toBeNull();
    // world.json's pick leads instead: then the newer one is the other (the gate's G8).
    expect(buildCharterMarkOffer(now, e, { charter: 'l0' }, WORLD, [old, now])?.dataset.role).toBe('aid-retire-offer');
  });
  it('a Law of another supertype that world.json names (M6)', () => {
    expect(offersCharterMark(law({ supertype: 'Regulation' }), { charter: 'l1' })).toBe(true);
    expect(offersCharterMark(law({ supertype: 'Regulation' }), { charter: 'other' })).toBe(false);
  });
});

describe('who may press it (M3)', () => {
  it('a world on disk that is the whole world: yes', () => {
    const e = register({ state: 'local-only' });
    expect(canMarkCharter(e, { name: 'W' }, WORLD)).toBe(true);
  });
  it('a read-key world, even when keel answered owner: no', () => {
    const e = register({ state: 'api-linked', api: { world_id: 'acct', api_key: 'k', read_only: true, member_role: 'owner' } });
    expect(canMarkCharter(e, {}, WORLD)).toBe(false);
  });
  it('a view-only copy: no', () => {
    const e = register({ state: 'local-only', copy_of: { world_id: 'acct' } });
    expect(canMarkCharter(e, {}, WORLD)).toBe(false);
  });
  it('a linked contributor or guest: no; an owner or a co-builder: yes', () => {
    for (const [role, want] of [['contributor', false], ['guest', false], ['owner', true], ['co_builder', true]] as const) {
      const e = register({ state: 'api-linked', api: { world_id: 'acct', api_key: 'k', member_role: role } });
      expect(canMarkCharter(e, {}, WORLD)).toBe(want);
    }
  });
  it("a contributor's, a Character's or the public view on disk: no; the owner's or a co-builder's: yes", () => {
    const e = register({ state: 'local-only' });
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
    const e = register({ state: 'local-only' });
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
