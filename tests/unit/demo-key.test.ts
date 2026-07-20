/**
 * Demo-key recognition (`0000000000`-`0000000009`).
 *
 * The range is a keel protocol fact: those keys resolve to READ scope, so a
 * write with one earns a 403 on any route, and reads skip PIN enforcement.
 * Atlas's link flow reads this predicate to force the view-only branch —
 * which both admits demo keys (they have no PIN to satisfy the PIN check)
 * and closes the trap where a PREFILLED PIN used to sail one into a writable
 * registration that 403s on its first push.
 */

import { describe, it, expect } from 'vitest';
import { isDemoKey } from '../../src/core/constants';

describe('isDemoKey', () => {
  it('accepts the whole documented demo range', () => {
    for (let i = 0; i <= 9; i++) {
      expect(isDemoKey(`000000000${i}`)).toBe(true);
    }
  });

  it('tolerates surrounding whitespace (pasted keys carry it)', () => {
    expect(isDemoKey('  0000000000  ')).toBe(true);
    expect(isDemoKey('\n0000000007\t')).toBe(true);
  });

  it('rejects other legacy 10-digit keys — the check is the RANGE, not the length', () => {
    // Legacy real keys are also 10 digits. A length-based check would hand
    // every grandfathered world the view-only branch and make it unwritable.
    expect(isDemoKey('1234567890')).toBe(false);
    expect(isDemoKey('0000000010')).toBe(false);
    expect(isDemoKey('9000000000')).toBe(false);
    expect(isDemoKey('0000000100')).toBe(false);
  });

  it('rejects near-misses on length', () => {
    expect(isDemoKey('000000000')).toBe(false);
    expect(isDemoKey('00000000000')).toBe(false);
    expect(isDemoKey('')).toBe(false);
  });

  it('rejects prefixed modern keys', () => {
    expect(isDemoKey('ow_w_0000000000')).toBe(false);
    expect(isDemoKey('ow_r_0000000001')).toBe(false);
    expect(isDemoKey('ow_a_0000000002')).toBe(false);
  });
});
