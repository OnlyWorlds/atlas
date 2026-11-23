/**
 * #198: a refused key's lines name the cause keel gave and point at the key's
 * place in Settings, This world, never at Unlink (which drops the deletes not
 * yet sent).
 */
import { describe, it, expect } from 'vitest';
import { OwV2Error } from '../../src/sync/ow-v2-client-adapter';
import { clearedKeyRefusalLine, keyRefusalHere, keyRefusalLine, keyRefusalOf, keyRefusalPill, seatRefusalLine } from '../../src/sync/world-key-lines';
import type { KeyRefusal } from '../../src/core/types';

const err = (status: number, code: string, param: string | null = null) =>
  new OwV2Error(status, { code, message: code, param }, '');

describe('keyRefusalOf', () => {
  it('reads the four causes from keel\'s typed errors', () => {
    expect(keyRefusalOf(err(401, 'key_revoked'))).toBe('key_revoked');
    expect(keyRefusalOf(err(401, 'invalid_credentials'))).toBe('key_unknown');
    expect(keyRefusalOf(err(401, 'invalid_credentials', 'API-Pin'))).toBe('pin');
    expect(keyRefusalOf(err(403, 'permission_error'))).toBe('read_only_key');
  });

  it('is null for anything else', () => {
    expect(keyRefusalOf(err(403, 'not_author'))).toBeNull();
    expect(keyRefusalOf(err(429, 'rate_limited'))).toBeNull();
    expect(keyRefusalOf(new Error('API Error 401: Unauthorized'))).toBeNull();
    expect(keyRefusalOf('401')).toBeNull();
  });
});

describe('the lines', () => {
  const reasons: Array<KeyRefusal | null> = ['key_revoked', 'key_unknown', 'pin', 'read_only_key', null];

  it('never send anyone to Unlink', () => {
    for (const r of reasons) {
      for (const line of [keyRefusalPill(r), keyRefusalLine(r), keyRefusalHere(r)]) {
        expect(line).not.toMatch(/unlink|make online/i);
        expect(line).not.toMatch(/—/); // the voice law: no em-dashes
      }
    }
  });

  it('a key cause never says check your PIN, and a PIN cause never says a new key', () => {
    for (const r of ['key_revoked', 'key_unknown', 'read_only_key'] as const) {
      expect(keyRefusalLine(r)).not.toMatch(/PIN/);
      expect(keyRefusalHere(r)).not.toMatch(/PIN/);
    }
    expect(keyRefusalLine('pin')).not.toMatch(/new key/);
    expect(keyRefusalHere('pin')).not.toMatch(/new key/);
  });

  it('a seat\'s renewed key reads as renewed, never as removed, and offers no paste (2026-10-16)', () => {
    expect(seatRefusalLine('key_revoked')).toBe('Sync paused: this seat\'s key was renewed or revoked on onlyworlds.com.');
    expect(seatRefusalLine('key_revoked', { paused: false })).toBe('This seat\'s key was renewed or revoked on onlyworlds.com.');
    expect(seatRefusalLine('key_unknown')).toMatch(/may have removed it/);
    for (const r of reasons) expect(seatRefusalLine(r)).not.toMatch(/new key|unlink/i);
  });

  it('a cleared world\'s refused key: what happened and the ways back for each kind, never Retry or Unlink', () => {
    const kinds = ['account', 'read', 'seat'] as const;
    for (const code of ['key_revoked', 'invalid_credentials']) {
      for (const k of kinds) {
        const line = clearedKeyRefusalLine(err(401, code), k)!;
        expect(line).toMatch(/so Atlas could not download it again\. Nothing changed\./);
        expect(line).toMatch(/remove it from your list and open it again /);
        expect(line).toMatch(/world file of it/);
        expect(line).not.toMatch(/try again|retry|unlink|feedback|invite|—/i);
      }
    }
    // A key keel no longer knows: the world deleted or the person removed, so a new way in is only an "if".
    expect(clearedKeyRefusalLine(err(401, 'invalid_credentials'), 'account')).toMatch(/If you can still open it on onlyworlds\.com/);
    expect(clearedKeyRefusalLine(err(401, 'invalid_credentials'), 'read')).toMatch(/If it is still shared with you/);
    // A read or seat world's file restores on the refused key, which nothing here can replace.
    for (const k of ['read', 'seat'] as const) expect(clearedKeyRefusalLine(err(401, 'key_revoked'), k)).toMatch(/a copy that no longer syncs\.$/);
    expect(clearedKeyRefusalLine(err(401, 'key_revoked'), 'seat')).toMatch(/^This seat's key was renewed or revoked/);
    expect(clearedKeyRefusalLine(err(401, 'invalid_credentials'), 'read')).toMatch(/deleted there, or you were removed from it/);
    // Not about the key: the caller's general line words it.
    for (const e of [err(401, 'invalid_credentials', 'API-Pin'), err(403, 'permission_error'), err(500, 'server_error'), new Error('x')]) {
      expect(clearedKeyRefusalLine(e, 'account')).toBeNull();
    }
  });

  it('the unknown key names what makes keel forget one', () => {
    expect(keyRefusalLine('key_unknown')).toMatch(/deleted there, or you were removed from it/);
  });
});
