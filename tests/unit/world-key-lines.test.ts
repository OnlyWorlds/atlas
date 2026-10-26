/**
 * #198: a refused key's lines name the cause keel gave and point at the key's
 * place in Settings, This world, never at Unlink (which drops the deletes not
 * yet sent).
 */
import { describe, it, expect } from 'vitest';
import { OwV2Error } from '../../src/sync/ow-v2-client-adapter';
import { keyRefusalHere, keyRefusalLine, keyRefusalOf, keyRefusalPill, seatRefusalLine } from '../../src/sync/world-key-lines';
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

  it('a seat\'s renewed key reads as renewed, never as removed, and offers no paste (keel #355, 2026-10-16)', () => {
    expect(seatRefusalLine('key_revoked')).toBe('Sync paused: this seat\'s key was renewed or revoked on onlyworlds.com.');
    expect(seatRefusalLine('key_revoked', { paused: false })).toBe('This seat\'s key was renewed or revoked on onlyworlds.com.');
    expect(seatRefusalLine('key_unknown')).toMatch(/may have removed it/);
    for (const r of reasons) expect(seatRefusalLine(r)).not.toMatch(/new key|unlink/i);
  });

  it('the unknown key names what makes keel forget one', () => {
    expect(keyRefusalLine('key_unknown')).toMatch(/deleted there, or you were removed from it/);
  });
});
