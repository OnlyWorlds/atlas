/**
 * SharingClient ↔ the v0.3 contract — locked against the stateful sharing
 * fakes (tests/msw-sharing-handlers.ts), synced to Anchor's AS-BUILT slice
 * (2026-06-07: slug-addressed mutations, locked error enum, quota 20,
 * envelope-carrying 401, empty payloads are valid pages).
 *
 * What this suite proves: publish → public GET round-trip (the §5.2
 * envelope), slug rules + reserved list, global uniqueness with the
 * own-tombstone revival exception, quota 20/account, slug-addressed
 * PATCH/DELETE with slug immutability, title/intent server validation,
 * tombstone revoke → 410, idempotent DELETE, admin_locked, cross-account
 * forbidden, and the error-code mapping the share room toasts from.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { statefulSharingHandlers, type SharingFakeState } from '../msw-sharing-handlers';
import {
  SharingClient, SharingApiError, isValidSlug, suggestSlug, sharingErrorMessage,
} from '../../src/sync/sharing-client';

const BASE = 'https://sharing.test/api/sharing';

function client(key = 'key-alpha'): SharingClient {
  return new SharingClient({ baseUrl: BASE, apiKey: key, pin: '1234' });
}

function payload(n = 1): unknown {
  return { schema_version: 1, title: `p${n}`, intent: 'show', theme: {}, blocks: [], elements: {} };
}

let state: SharingFakeState;

beforeEach(() => {
  const fake = statefulSharingHandlers(BASE);
  state = fake.state;
  mswServer.use(...fake.handlers);
});

describe('slug helpers', () => {
  it('isValidSlug enforces 4–40 [a-z0-9-] with clean edges', () => {
    expect(isValidSlug('barovia-primer')).toBe(true);
    expect(isValidSlug('abcd')).toBe(true);
    expect(isValidSlug('abc')).toBe(false);          // too short
    expect(isValidSlug('-abcd')).toBe(false);        // leading hyphen
    expect(isValidSlug('abcd-')).toBe(false);        // trailing hyphen
    expect(isValidSlug('Abcd')).toBe(false);         // uppercase
    expect(isValidSlug('a'.repeat(41))).toBe(false); // too long
    // keel's rule (sharing/slug_rules.py): single hyphens, never a UUID's shape.
    expect(isValidSlug('my--page')).toBe(false);     // doubled hyphen
    expect(isValidSlug('my-big-page')).toBe(true);
    expect(isValidSlug('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(false); // UUID-shaped
  });

  it('suggestSlug derives a rule-compliant slug from a page name', () => {
    expect(suggestSlug('Barovia Primer!')).toBe('barovia-primer');
    expect(suggestSlug('  The  Mists  ')).toBe('the-mists');
    expect(isValidSlug(suggestSlug('ab'))).toBe(true); // padded to min length
  });
});

describe('publish → public GET round-trip', () => {
  it('publishes and serves the §5.2 envelope publicly (no auth)', async () => {
    const c = client();
    const res = await c.publish({ slug: 'barovia-primer', title: 'barovia primer', intent: 'reference', payload: payload() });
    expect(res.slug).toBe('barovia-primer');
    expect(res.url).toContain('/barovia-primer');

    const envelope = await c.getPublic('barovia-primer');
    expect(envelope.slug).toBe('barovia-primer');
    expect(envelope.published_at).toBeTruthy();
    expect(envelope.updated_at).toBeTruthy();
    expect((envelope.payload as { title: string }).title).toBe('p1');
    expect(state.bySlug('barovia-primer')?.view_count).toBe(1);
  });

  it('format-invalid slugs → 400 slug_invalid; RESERVED words → 409 slug_taken (as-built)', async () => {
    const c = client();
    await expect(c.publish({ slug: 'ab', title: 't', intent: 'show', payload: payload() }))
      .rejects.toMatchObject({ code: 'slug_invalid', status: 400 });
    await expect(c.publish({ slug: 'admin', title: 't', intent: 'show', payload: payload() }))
      .rejects.toMatchObject({ code: 'slug_taken', status: 409 });
    expect(await c.slugCheck('admin')).toBe(false); // reserved reads as unavailable
  });

  it('enforces global slug uniqueness across accounts (slug_taken)', async () => {
    await client('key-alpha').publish({ slug: 'the-mists', title: 't', intent: 'show', payload: payload() });
    await expect(client('key-beta').publish({ slug: 'the-mists', title: 't', intent: 'show', payload: payload() }))
      .rejects.toMatchObject({ code: 'slug_taken', status: 409 });
  });

  it('unknown slug → not_found; missing auth on POST → unauthorized (enveloped 401)', async () => {
    await expect(client().getPublic('never-was')).rejects.toMatchObject({ code: 'not_found', status: 404 });
    const bare = new SharingClient({ baseUrl: BASE, apiKey: '', pin: '' });
    await expect(bare.publish({ slug: 'abcd', title: 't', intent: 'show', payload: null }))
      .rejects.toMatchObject({ code: 'unauthorized', status: 401 });
  });

  it('server-validates title length and intent (title_too_long / intent_invalid)', async () => {
    const c = client();
    await expect(c.publish({ slug: 'long-title', title: 'x'.repeat(201), intent: 'show', payload: payload() }))
      .rejects.toMatchObject({ code: 'title_too_long', status: 400 });
    await expect(c.publish({ slug: 'bad-intent', title: 't', intent: 'shout', payload: payload() }))
      .rejects.toMatchObject({ code: 'intent_invalid', status: 400 });
  });

  it('an empty payload is a valid active page — serves 200, not 410', async () => {
    const c = client();
    await c.publish({ slug: 'empty-page', title: 't', intent: 'show', payload: {} });
    const envelope = await c.getPublic('empty-page');
    expect(envelope.slug).toBe('empty-page');
    expect(envelope.payload).toEqual({});
  });
});

describe('quota (20 active per account — as-built)', () => {
  it('rejects the 21st active page; revoked pages do not count', async () => {
    const c = client();
    for (let i = 0; i < 20; i++) {
      await c.publish({ slug: `page-${String(i).padStart(4, '0')}`, title: `t${i}`, intent: 'show', payload: payload(i) });
    }
    await expect(c.publish({ slug: 'one-too-many', title: 't', intent: 'show', payload: payload() }))
      .rejects.toMatchObject({ code: 'quota_exceeded', status: 429 });

    // Revoke one → a new publish fits again.
    await c.revoke('page-0000');
    await expect(c.publish({ slug: 'fits-now', title: 't', intent: 'show', payload: payload() }))
      .resolves.toMatchObject({ slug: 'fits-now' });
  });
});

describe('republish (PATCH) — slug-addressed, slug immutable', () => {
  it('updates payload/title via the slug; updated_at moves, published_at stays', async () => {
    const c = client();
    await c.publish({ slug: 'living-doc', title: 'v1', intent: 'show', payload: payload(1) });
    const before = await c.getPublic('living-doc');
    const row = await c.republish('living-doc', { title: 'v2', payload: payload(2) });
    expect(row.title).toBe('v2');
    const after = await c.getPublic('living-doc');
    expect(after.published_at).toBe(before.published_at);
    expect(after.updated_at > before.updated_at).toBe(true);
    expect((after.payload as { title: string }).title).toBe('p2');
  });

  it('rejects a slug change attempt (immutable, contract §2)', async () => {
    const c = client();
    await c.publish({ slug: 'fixed-name', title: 't', intent: 'show', payload: payload() });
    // The client never sends slug — simulate a raw caller to lock the server rule.
    const res = await fetch(`${BASE}/pages/fixed-name/`, {
      method: 'PATCH',
      headers: { 'API-Key': 'key-alpha', 'API-Pin': '1234', 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'new-name' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('slug_invalid');
  });

  it("someone else's slug → 404 not_found (existence-hiding, confirmed live)", async () => {
    await client('key-alpha').publish({ slug: 'alphas-page', title: 't', intent: 'show', payload: payload() });
    await expect(client('key-beta').republish('alphas-page', { title: 'mine now' }))
      .rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(client('key-beta').revoke('alphas-page'))
      .rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('PATCH with a payload on your own REVOKED slug revives it (200 — second revival path)', async () => {
    const c = client();
    await c.publish({ slug: 'patch-revive', title: 't', intent: 'show', payload: payload(1) });
    await c.revoke('patch-revive');
    await expect(c.getPublic('patch-revive')).rejects.toMatchObject({ status: 410 });
    const row = await c.republish('patch-revive', { payload: payload(2) });
    expect(row.revoked).toBe(false);
    const envelope = await c.getPublic('patch-revive');
    expect((envelope.payload as { title: string }).title).toBe('p2');
  });
});

describe('revoke (tombstone)', () => {
  it('revoked page serves 410 revoked; DELETE is idempotent', async () => {
    const c = client();
    await c.publish({ slug: 'short-lived', title: 't', intent: 'show', payload: payload() });
    await c.revoke('short-lived');
    await c.revoke('short-lived'); // idempotent — no throw
    await expect(c.getPublic('short-lived')).rejects.toMatchObject({ code: 'revoked', status: 410 });
  });

  it('owner revives their own tombstoned slug via POST; others still blocked', async () => {
    const alpha = client('key-alpha');
    const pub = await alpha.publish({ slug: 'my-slug-back', title: 't', intent: 'show', payload: payload(1) });
    await alpha.revoke('my-slug-back');

    // Another account can't take it (anti-takeover).
    await expect(client('key-beta').publish({ slug: 'my-slug-back', title: 't', intent: 'show', payload: payload() }))
      .rejects.toMatchObject({ code: 'slug_taken' });

    // Owner republished → revived with fresh content.
    const revived = await alpha.publish({ slug: 'my-slug-back', title: 't2', intent: 'show', payload: payload(2) });
    expect(revived.id).toBe(pub.id);
    const envelope = await alpha.getPublic('my-slug-back');
    expect((envelope.payload as { title: string }).title).toBe('p2');
  });

  it('admin_locked burns the slug — even for the owner', async () => {
    const c = client();
    await c.publish({ slug: 'taken-down', title: 't', intent: 'show', payload: payload() });
    state.adminLock('taken-down');
    await expect(c.getPublic('taken-down')).rejects.toMatchObject({ code: 'revoked', status: 410 });
    await expect(c.publish({ slug: 'taken-down', title: 't', intent: 'show', payload: payload() }))
      .rejects.toMatchObject({ code: 'slug_taken' });
    // PATCH on the locked slug tells the owner the truth: admin_locked, not not_found.
    await expect(c.republish('taken-down', { title: 't2' }))
      .rejects.toMatchObject({ code: 'admin_locked', status: 403 });
  });

  it('reviving a tombstone counts against the quota — 429, both revival paths (confirmed)', async () => {
    const c = client();
    for (let i = 0; i < 20; i++) {
      await c.publish({ slug: `qpage-${String(i).padStart(4, '0')}`, title: 't', intent: 'show', payload: payload(i) });
    }
    await c.revoke('qpage-0000');             // 19 active + own tombstone
    await c.publish({ slug: 'qfill-twenty', title: 't', intent: 'show', payload: payload() }); // back to 20
    await expect(c.publish({ slug: 'qpage-0000', title: 't', intent: 'show', payload: payload() }))
      .rejects.toMatchObject({ code: 'quota_exceeded', status: 429 });
    await expect(c.republish('qpage-0000', { payload: payload() }))   // PATCH-revive checks too
      .rejects.toMatchObject({ code: 'quota_exceeded', status: 429 });
  });
});

describe('list + slug-check', () => {
  it('lists own pages incl. revoked; slug-check reflects availability + own tombstones', async () => {
    const c = client();
    await c.publish({ slug: 'list-one', title: 'one', intent: 'show', payload: payload() });
    await c.publish({ slug: 'list-two', title: 'two', intent: 'reference', payload: payload() });
    await c.revoke('list-one');

    const rows = await c.listForWorld('w1');
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.slug === 'list-one')?.revoked).toBe(true);
    expect(rows.find(r => r.slug === 'list-two')?.revoked).toBe(false);

    expect(await c.slugCheck('list-two')).toBe(false);       // active — taken
    expect(await c.slugCheck('list-one')).toBe(true);        // own tombstone — revivable
    expect(await client('key-beta').slugCheck('list-one')).toBe(false); // not theirs
    expect(await c.slugCheck('fresh-slug')).toBe(true);
  });
});

describe('payload cap', () => {
  it('rejects payloads over 256KB with payload_too_large', async () => {
    const big = { blob: 'x'.repeat(257 * 1024) };
    await expect(client().publish({ slug: 'too-big', title: 't', intent: 'show', payload: big }))
      .rejects.toMatchObject({ code: 'payload_too_large' });
  });
});

describe('error type', () => {
  it('exposes SharingApiError with code + status', async () => {
    try {
      await client().getPublic('never-was');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SharingApiError);
      expect((e as SharingApiError).code).toBe('not_found');
      expect((e as SharingApiError).status).toBe(404);
    }
  });

  // keel refuses a read key's publish with 403 permission_error, a code Atlas
  // has no case for: it reads as "this key can only read", never as an
  // authentication failure.
  it('a 403 without a known code is a read-key refusal, worded as one', async () => {
    mswServer.use(http.post(`${BASE}/pages/`, () => HttpResponse.json(
      { error: { type: 'permission_error', code: 'permission_error', message: 'Read-only key.' } }, { status: 403 },
    )));
    const err = await client().publish({ slug: 'read-key-page', title: 't', intent: 'show', payload: payload() })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(SharingApiError);
    expect((err as SharingApiError).code).toBe('forbidden');
    expect(sharingErrorMessage(err as SharingApiError)).toMatch(/can only read/);
  });

  it('a 401 is still an authentication refusal', async () => {
    mswServer.use(http.post(`${BASE}/pages/`, () => HttpResponse.json({}, { status: 401 })));
    const err = await client().publish({ slug: 'bad-key-page', title: 't', intent: 'show', payload: payload() })
      .then(() => null, (e: unknown) => e);
    expect((err as SharingApiError).code).toBe('auth_failed');
  });
});
