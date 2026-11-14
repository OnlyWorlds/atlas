/**
 * Element times ordered as instants (DESIGN_LAWS conv. 190). keel writes
 * `isoformat()` (`…07.089123+00:00`, no fraction on a whole second), Atlas
 * `toISOString()`, another tool any offset; as text they ordered by luck.
 * R1 `stampOrder`; R3 each site's mild reading of a stamp that cannot be read;
 * R4a the lift just past keel's instant.
 */
import { describe, it, expect } from 'vitest';
import { editStamp, editedSince, stampedBody, stampOrder } from '../../src/store/sync-stamp';
import { knownOfMove } from '../../src/sync/known-of';
import { notSyncedNow, type DiskNotice } from '../../src/core/live-folder';
import { authorAsServed } from '../../src/core/message-parties';
import { findExistingNameMatch } from '../../src/ui/element-name-match';
import type { Element } from '../../src/core/types';

const KEEL = '2026-11-14T05:06:07.089123+00:00';

describe('stampOrder (R1)', () => {
  it("orders keel's form against Atlas's at one instant, and any offset by its instant", () => {
    expect(stampOrder('2026-11-14T05:06:07.089123+00:00', '2026-11-14T05:06:07.089123Z')).toBe(0);
    expect(stampOrder('2026-11-14T05:06:07.089+00:00', '2026-11-14T05:06:07.089Z')).toBe(0);
    expect(stampOrder('2026-11-14T00:10:00-05:00', KEEL)).toBe(1); // 05:10 UTC, after keel: as text, before
    expect(stampOrder('2026-11-14T07:00:00+02:00', KEEL)).toBe(-1); // 05:00 UTC, before keel: as text, after
    expect(stampOrder('2026-11-14T05:06:07+00:00', '2026-11-14T05:06:07.000Z')).toBe(0); // no fraction
    expect(stampOrder('2026-11-14T05:06:07.089', '2026-11-14T05:06:07.089Z')).toBe(0); // no offset reads as UTC
    expect(stampOrder('2026-11-14T05:06:07.089Z', '2026-11-14T05:06:07.089500+00:00')).toBe(-1); // inside one millisecond
  });

  it('is null when either side is absent or cannot be read', () => {
    for (const bad of [undefined, null, '', 'garbage', '2026-11-14 05:10:00+00:00', '2026-11-14T05:10:00+0000', 1794632767, {}]) {
      expect(stampOrder(bad, KEEL)).toBeNull();
      expect(stampOrder(KEEL, bad)).toBeNull();
    }
  });

  it('editedSince reads after, or unknown, as edited', () => {
    expect(editedSince('2026-11-14T00:10:00-05:00', KEEL)).toBe(true);
    expect(editedSince(KEEL, KEEL)).toBe(false);
    expect(editedSince('2026-11-14T05:06:07.089Z', KEEL)).toBe(false);
    expect(editedSince('garbage', KEEL)).toBe(true);
    expect(editedSince(undefined, KEEL)).toBe(true);
    expect(editedSince(KEEL, 'garbage')).toBe(true);
  });
});

describe('the lift just past keel (R4a)', () => {
  const base = { id: 'x', type: 'character', name: 'n', server_updated_at: '2026-11-14T05:00:00+00:00' } as Element;
  /** An edit landed while the push was in flight, its stamp at or before keel's answer. */
  const liftedPast = (keel: string, local = '2026-11-14T05:00:00.500Z') =>
    stampedBody({ ...base, local_updated_at: local }, keel, '2026-11-14T05:00:00.100Z').local_updated_at;

  it('lifts to the first millisecond after keel\'s instant, whatever its fraction', () => {
    expect(liftedPast('2026-11-14T05:06:07.089123+00:00')).toBe('2026-11-14T05:06:07.090Z');
    expect(liftedPast('2026-11-14T05:06:07.089000+00:00')).toBe('2026-11-14T05:06:07.090Z');
    expect(liftedPast('2026-11-14T05:06:07+00:00')).toBe('2026-11-14T05:06:07.001Z');
    expect(liftedPast('2026-11-14T05:06:07.999999+00:00')).toBe('2026-11-14T05:06:08.000Z');
    expect(liftedPast('2026-11-14T05:06:07.999500+00:00')).toBe('2026-11-14T05:06:08.000Z');
    expect(liftedPast('2026-11-14T23:59:59.999999+00:00')).toBe('2026-11-15T00:00:00.000Z');
    expect(liftedPast('2026-11-14T07:06:07.089123+02:00')).toBe('2026-11-14T05:06:07.090Z');
  });

  it('every lift sorts after keel', () => {
    for (const keel of ['2026-11-14T05:06:07.089123+00:00', '2026-11-14T05:06:07+00:00', '2026-11-14T05:06:07.999999+00:00']) {
      expect(stampOrder(liftedPast(keel), keel)).toBe(1);
    }
  });

  it('an edit in flight inside keel\'s millisecond is lifted, not read clean', () => {
    // As text `.089Z` sorts after `.089500+00:00` ("Z" after "5"): the edit read clean and was lost.
    expect(liftedPast('2026-11-14T05:06:07.089500+00:00', '2026-11-14T05:06:07.089Z')).toBe('2026-11-14T05:06:07.090Z');
  });

  it('an edit already after keel stays as it is; an unreadable keel stamp lifts nothing', () => {
    expect(liftedPast(KEEL, '2026-11-14T00:10:00-05:00')).toBe('2026-11-14T00:10:00-05:00');
    const now = liftedPast('garbage');
    expect(stampOrder(now, '2026-11-14T05:00:00Z')).toBe(1); // the clock's now
  });

  it('editStamp lifts an edit made inside keel\'s millisecond', () => {
    expect(editStamp('2026-11-14T05:06:07.089Z', '2026-11-14T05:06:07.089500+00:00')).toBe('2026-11-14T05:06:07.090Z');
    expect(editStamp('2026-11-14T05:06:07.089Z', '2026-11-14T05:06:07.089000+00:00')).toBe('2026-11-14T05:06:07.090Z');
    expect(editStamp('2026-11-14T05:06:08.000Z', KEEL)).toBe('2026-11-14T05:06:08.000Z');
    expect(editStamp('2026-11-14T05:06:07.000Z', '2026-11-14T07:06:07.100+02:00')).toBe('2026-11-14T05:06:07.101Z');
    expect(editStamp('2026-11-14T05:06:07.000Z', 'garbage')).toBe('2026-11-14T05:06:07.000Z');
    expect(editStamp('2026-11-14T05:06:07.000Z', undefined)).toBe('2026-11-14T05:06:07.000Z');
  });
});

describe('the heal of a stamp that cannot be read (R4b)', () => {
  const base = { id: 'x', type: 'character', name: 'n', server_updated_at: '2026-11-14T05:00:00+00:00' } as Element;
  it('a landed push with no edit in flight leaves keel\'s stamp where the local one could not be read', () => {
    for (const local of ['garbage', '2026-11-14 05:10:00+00:00', '']) {
      expect(stampedBody({ ...base, local_updated_at: local }, KEEL, local).local_updated_at).toBe(KEEL);
    }
    const absent = { ...base } as Element;
    delete (absent as Record<string, unknown>).local_updated_at;
    expect(stampedBody(absent, KEEL, '').local_updated_at).toBe(KEEL); // sent with no stamp, none since
    expect(stampedBody(absent, KEEL).local_updated_at).toBe(KEEL); // the caller passed nothing
  });

  it('a body sent with no stamp and edited in flight is lifted, never healed into reading clean', () => {
    // The code gate's M1: the edit stamped .003Z inside the PATCH, keel answered .004003.
    const edited = { ...base, local_updated_at: '2026-11-14T05:00:00.003Z' } as Element;
    expect(stampedBody(edited, '2026-11-14T05:00:00.004003+00:00', '').local_updated_at).toBe('2026-11-14T05:00:00.005Z');
  });

  it('a readable local stamp is never touched by the heal', () => {
    expect(stampedBody({ ...base, local_updated_at: '2026-11-14T05:06:07.000Z' }, KEEL, '2026-11-14T05:06:07.000Z').local_updated_at)
      .toBe('2026-11-14T05:06:07.000Z');
  });
});

describe('each site\'s mild reading (R3)', () => {
  const synced = (local: unknown): Element =>
    ({ id: 'x', type: 'character', name: 'n', server_updated_at: KEEL, local_updated_at: local }) as unknown as Element;

  it('a keel stub never replaces a whole copy holding an edit, in any offset or unreadable', () => {
    for (const local of ['2026-11-14T00:10:00-05:00', 'garbage', '2026-11-14 05:10:00+00:00', undefined]) {
      expect(knownOfMove(synced(local), { known_of: true }, true)).toBe('keep');
    }
    expect(knownOfMove(synced(KEEL), { known_of: true }, true)).toBe('apply');
  });

  it('the live folder counts as not synced only a copy readably at or before keel', () => {
    const notice = { notSynced: new Set(['x']) } as unknown as DiskNotice;
    expect(notSyncedNow(notice, [synced('2026-11-14T05:06:07.089Z')])).toBe(1);
    expect(notSyncedNow(notice, [synced('2026-11-14T00:10:00-05:00')])).toBe(0); // will upload
    expect(notSyncedNow(notice, [synced('garbage')])).toBe(0);
    expect(notSyncedNow(notice, [synced(undefined)])).toBe(0);
  });

  it('a message\'s author is as served only when the copy is readably not after keel', () => {
    expect(authorAsServed(synced(KEEL))).toBe(true);
    expect(authorAsServed(synced('2026-11-14T05:06:07.089Z'))).toBe(true);
    expect(authorAsServed(synced('2026-11-14T00:10:00-05:00'))).toBe(false);
    expect(authorAsServed(synced('garbage'))).toBe(false);
    expect(authorAsServed(synced(undefined))).toBe(false);
  });
});

describe('newest first, by instant', () => {
  it('the autocomplete links the newest edit, an offset read as its instant and an unreadable stamp last', () => {
    const el = (id: string, local: unknown) => ({ id, type: 'character', name: `Wren ${id}`, local_updated_at: local }) as unknown as Element;
    // 05:10 UTC written with -05:00 is newer than 05:06 UTC, though it sorts first as text.
    const winner = findExistingNameMatch('Wren', 'character', [
      el('a', '2026-11-14T05:06:07.089Z'), el('b', '2026-11-14T00:10:00-05:00'), el('c', 'zzz'),
    ]);
    expect(winner?.id).toBe('b');
    expect(findExistingNameMatch('Wren', 'character', [el('c', 'zzz'), el('a', '2026-11-14T05:06:07.089Z')])?.id).toBe('a');
  });
});
