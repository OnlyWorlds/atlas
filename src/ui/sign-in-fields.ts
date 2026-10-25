/**
 * Sign in inside a create form (Keel #134, S432): signed out, making a world
 * online asks for the OnlyWorlds email or username and password, signs in
 * as Settings does (`password-sign-in.ts`), and then makes the world on the
 * account. The classic API's create-world-external lane, which took an
 * email and a PIN, is gone: keel keeps v1 frozen, and this was its last
 * caller outside keel's tests (Skeld h29 #7492).
 *
 * Used by Make online's Create new pane and New world on OnlyWorlds. The
 * field names are their own (`signin-*`): Settings' sign-in block can sit
 * behind the modal with `account-*` names.
 */

import { getState, patchSlice } from '../core/state';
import { saveRegistry, setAccountToken } from '../registry/registry';
import { AccountClient } from '../sync/account-client';
import { signInWithPassword, passwordSignInLine } from '../sync/password-sign-in';
import { revokeAtlasToken } from '../sync/token-revoke';
import { PlainError } from '../core/plain-error';
import { escapeAttr, escapeText } from '../core/dom-utils';
import { noAccountYetHtml } from '../core/ow-site';
import { WAITS_FOR_SIGN_IN, type ToastManager } from './toast-manager';
import { onlyWorldsSignInButtonHtml } from './onlyworlds-sign-in-button';

/** The signed-out fields: email or username, password, and where to make an account. */
export function signInFieldsHtml(prefillLogin = ''): string {
  return `
    <div data-role="sign-in-fields">
      ${onlyWorldsSignInButtonHtml('Or with your OnlyWorlds email or username and password:')}
      <label class="atlas-modal-field">
        <span>Email or username</span>
        <input class="atlas-input" type="text" name="signin-login" value="${escapeAttr(prefillLogin)}" placeholder="Your OnlyWorlds account" autocomplete="username" autocapitalize="off" spellcheck="false" />
      </label>
      <label class="atlas-modal-field">
        <span>Password</span>
        <input class="atlas-input" type="password" name="signin-password" placeholder="Your OnlyWorlds password" autocomplete="current-password" />
      </label>
      <p class="atlas-modal-hint" data-role="no-account">Atlas signs in to your account and makes the world there. It keeps a token for this browser, never your password. ${noAccountYetHtml()}</p>
    </div>`;
}

/** Why a form that makes a world online asks a PIN, under the field before any sign-in (Seethe h20 #10346). */
export const PIN_REASON_HTML = '<span class="atlas-modal-hint">The PIN lets Atlas upload the world\'s contents.</span>';

/** The line that stands where the fields were, once signed in. */
export function signedInLineHtml(username: string | undefined, rest = ''): string {
  return `<p class="atlas-modal-hint" data-role="signed-in">On your account${username ? `, ${escapeText(username)}` : ''}.${rest ? ` ${rest}` : ''}</p>`;
}

/** The two inputs, or null once signed in (the fields are gone). */
export function signInInputs(root: ParentNode): { login: HTMLInputElement; password: HTMLInputElement } | null {
  const login = root.querySelector<HTMLInputElement>('input[name="signin-login"]');
  const password = root.querySelector<HTMLInputElement>('input[name="signin-password"]');
  return login && password ? { login, password } : null;
}

/** The first empty sign-in input, with its line, or null. */
export function missingSignIn(root: ParentNode): { input: HTMLInputElement; line: string } | null {
  const f = signInInputs(root);
  if (!f) return null;
  if (!f.login.value.trim()) return { input: f.login, line: 'Enter your OnlyWorlds email or username.' };
  if (!f.password.value) return { input: f.password, line: 'Enter your OnlyWorlds password.' };
  return null;
}

/**
 * Sign in with the fields' credentials and keep the token, as Settings does.
 * The fields then give way to the signed-in line. A refusal throws a
 * PlainError worded for the user; nothing is kept.
 */
export async function signInFromFields(root: ParentNode, signedInRest: string, toasts?: ToastManager): Promise<void> {
  const f = signInInputs(root);
  if (!f) return;
  let minted: { token: string; tokenId: string } | null = null;
  let username: string;
  try {
    minted = await signInWithPassword(f.login.value, f.password.value);
    username = (await new AccountClient(minted.token).getProfile()).username;
  } catch (err) {
    console.warn('[sign-in-fields] sign-in refused');
    // Minted and not kept: revoked at once, never left live with no one holding it (the S475 gate's G4).
    if (minted) void revokeAtlasToken(minted.token, minted.tokenId);
    throw new PlainError(passwordSignInLine(err));
  }
  f.password.value = '';
  const next = setAccountToken(getState().registry, minted.token, username, minted.tokenId);
  saveRegistry(next);
  patchSlice('registry', next);
  toasts?.dismiss(WAITS_FOR_SIGN_IN);
  root.querySelector('[data-role="sign-in-fields"]')?.replaceWith(
    document.createRange().createContextualFragment(signedInLineHtml(username, signedInRest)),
  );
}
