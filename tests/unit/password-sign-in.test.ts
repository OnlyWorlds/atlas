import { describe, it, expect } from 'vitest';
import { OwSignInError } from '@onlyworlds/sdk';
import { passwordSignInLine, tokenNameForThisBrowser } from '../../src/sync/password-sign-in';

describe('password sign-in (#387)', () => {
  it('names the token for the browser that holds it', () => {
    expect(tokenNameForThisBrowser('Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Atlas in Firefox');
    expect(tokenNameForThisBrowser('Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Atlas in Edge');
    expect(tokenNameForThisBrowser('Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0 Safari/537.36')).toBe('Atlas in Chrome');
    expect(tokenNameForThisBrowser('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')).toBe('Atlas in Safari');
    expect(tokenNameForThisBrowser('curl/8')).toBe('Atlas in a browser');
  });
  it('says each refusal in its own words, never the server\'s', () => {
    const line = (reason: ConstructorParameters<typeof OwSignInError>[0]) => passwordSignInLine(new OwSignInError(reason, 'keel text'));
    expect(line('invalid_credentials')).toMatch(/did not match an OnlyWorlds account/);
    expect(line('email_unverified')).toMatch(/Confirm your email first/);
    expect(line('rate_limited')).toMatch(/Too many attempts/);
    expect(line('offline')).toMatch(/could not reach OnlyWorlds/);
    for (const r of ['mint_failed', 'failed'] as const) expect(line(r)).not.toContain('keel text');
  });
});
