/**
 * Settings, OnlyWorlds, signed out (Seethe 2026-10-24): where the Sign in with
 * OnlyWorlds button stands, no label above it says the same thing; where it does
 * not (a preview, a dev server, the tour), the email form keeps its label.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const button = { html: '' };
vi.mock('../../src/ui/onlyworlds-sign-in-button', () => ({
  onlyWorldsSignInButtonHtml: () => button.html,
  wireOnlyWorldsSignIn: () => {},
}));

import { renderAccountTab } from '../../src/middle/settings-account';
import type { WorldsRegistry } from '../../src/core/types';

const signedOut = { worlds: [] } as unknown as WorldsRegistry;
const labelCount = (html: string) => (html.match(/<span>Sign in to OnlyWorlds<\/span>/g) ?? []).length;

describe('the signed-out block\'s label', () => {
  beforeEach(() => { button.html = ''; });

  it('goes where the button stands', () => {
    button.html = '<div data-role="sign-in-onlyworlds"><button data-action="sign-in-onlyworlds">Sign in with OnlyWorlds</button></div>';
    const html = renderAccountTab(signedOut);
    expect(html).toContain('data-action="sign-in-onlyworlds"');
    expect(labelCount(html)).toBe(0);
  });

  it('stays where the button is not drawn', () => {
    const html = renderAccountTab(signedOut);
    expect(html).not.toContain('data-action="sign-in-onlyworlds"');
    expect(labelCount(html)).toBe(1);
    expect(html).toContain('name="account-login"');
  });
});
