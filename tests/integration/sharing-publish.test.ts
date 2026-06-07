/**
 * SharingClient ↔ the v0.2 contract — locked against the stateful sharing
 * fakes (tests/msw-sharing-handlers.ts) BEFORE Anchor's backend exists.
 *
 * What this suite proves: publish → public GET round-trip (the §5.2
 * envelope), slug rules + reserved list, global uniqueness with the
 * own-tombstone revival exception, quota 10/account, slug immutability on
 * PATCH, tombstone revoke → 410, idempotent DELETE, admin_locked, and the
 * error-code mapping the share room toasts from.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mswServer } from '../setup';
import { statefulSharingHandlers, type SharingFakeState } from '../msw-sharing-handlers';
import {
  SharingClient, SharingApiError, isValidSlug, suggestSlug,
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

  it('rejects invalid + reserved slugs with slug_invalid', async () => {
    const c = client();
    await expect(c.publish({ slug: 'ab', title: 't', intent: 'show', payload: payload() }))
      .rejects.toMatchObject({ code: 'slug_invalid' });
    await expect(c.publish({ slug: 'admin', title: 't', intent: 'show', payload: payload() }))
      .rejects.toMatchObject({ code: 'slug_invalid' });
  });

  it('enforces global slug uniqueness across accounts (slug_taken)', async () => {
    await client('key-alpha').publish({ slug: 'the-mists', title: 't', intent: 'show', payload: payload() });
    await expect(client('key-beta').publish({ slug: 'the-mists', title: 't', intent: 'show', payload: payload() }))
      .rejects.toMatchObject({ code: 'slug_taken', status: 409 });
  });

  it('unknown slug → not_found; missing auth on POST → auth_failed', async () => {
    await expect(client().getPublic('never-was')).rejects.toMatchObject({ code: 'not_found', status: 404 });
    const bare = new SharingClient({ baseUrl: BASE, apiKey: '', pin: '' });
    await expect(bare.publish({ slug: 'abcd', title: 't', intent: 'show', payload: null }))
      .rejects.toMatchObject({ code: 'auth_failed' });
  });
});

describe('quota (10 active per account)', () => {
  it('rejects the 11th active page; revoked pages do not count', async () => {
    const c = client();
    for (let i = 0; i < 10; i++) {
      await c.publish({ slug: `page-${String(i).padStart(4, '0')}`, title: `t${i}`, intent: 'show', payload: payload(i) });
    }
    await expect(c.publish({ slug: 'one-too-many', title: 't', intent: 'show', payload: payload() }))
      .rejects.toMatchObject({ code: 'quota_exceeded' });

    // Revoke one → a new publish fits again.
    const row = state.bySlug('page-0000')!;
    await c.revoke(row.id);
    await expect(c.publish({ slug: 'fits-now', title: 't', intent: 'show', payload: payload() }))
      .resolves.toMatchObject({ slug: 'fits-now' });
  });
});

describe('republish (PATCH) — slug immutable', () => {
  it('updates payload/title; updated_at moves, published_at stays', async () => {
    const c = client();
    const pub = await c.publish({ slug: 'living-doc', title: 'v1', intent: 'show', payload: payload(1) });
    const before = await c.getPublic('living-doc');
    const row = await c.republish(pub.id, { title: 'v2', payload: payload(2) });
    expect(row.title).toBe('v2');
    const after = await c.getPublic('living-doc');
    expect(after.published_at).toBe(before.published_at);
    expect(after.updated_at > before.updated_at).toBe(true);
    expect((after.payload as { title: string }).title).toBe('p2');
  });

  it('rejects a slug change attempt (immutable, contract §2)', async () => {
    const c = client();
    const pub = await c.publish({ slug: 'fixed-name', title: 't', intent: 'show', payload: payload() });
    // The client never sends slug — simulate a raw caller to lock the server rule.
    const res = await fetch(`${BASE}/pages/${pub.id}/`, {
      method: 'PATCH',
      headers: { 'API-Key': 'key-alpha', 'API-Pin': '1234', 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'new-name' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('slug_invalid');
  });
});

describe('revoke (tombstone)', () => {
  it('revoked page serves 410 revoked; DELETE is idempotent', async () => {
    const c = client();
    const pub = await c.publish({ slug: 'short-lived', title: 't', intent: 'show', payload: payload() });
    await c.revoke(pub.id);
    await c.revoke(pub.id); // idempotent — no throw
    await expect(c.getPublic('short-lived')).rejects.toMatchObject({ code: 'revoked', status: 410 });
  });

  it('owner revives their own tombstoned slug via POST; others still blocked', async () => {
    const alpha = client('key-alpha');
    const pub = await alpha.publish({ slug: 'my-slug-back', title: 't', intent: 'show', payload: payload(1) });
    await alpha.revoke(pub.id);

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
  });
});

describe('list + slug-check', () => {
  it('lists own pages incl. revoked; slug-check reflects availability + own tombstones', async () => {
    const c = client();
    const a = await c.publish({ slug: 'list-one', title: 'one', intent: 'show', payload: payload() });
    await c.publish({ slug: 'list-two', title: 'two', intent: 'reference', payload: payload() });
    await c.revoke(a.id);

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
});
