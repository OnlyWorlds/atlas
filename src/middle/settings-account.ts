/**
 * Settings → Account tab (extracted from settings-panel session 233). Global
 * PIN + email, used when creating or linking online worlds. PIN changes
 * re-attach any active api-linked engine immediately (stale creds otherwise).
 *
 * Account-mode (session 260): the OnlyWorlds account token block. Paste an
 * `ow_a_` token (minted at onlyworlds.com → Settings → Account tokens) →
 * validated via GET /account → stored in the registry. Signed in, atlas can
 * list your worlds in the sidebar and mint per-world keys. Forget drops the
 * token; worlds already opened keep their own keys and keep syncing.
 */

import { getState, patchSlice } from '../core/state';
import { saveRegistry, setPin, setEmail, setAccountToken } from '../registry/registry';
import { getActiveStore } from '../core/active-store';
import { attachSyncEngine } from '../sync/sync-attach';
import { ToastManager } from '../ui/toast-manager';
import type { WorldsRegistry } from '../core/types';
import { escapeAttr, escapeText } from '../core/dom-utils';
import { AccountClient, accountErrorMessage } from '../sync/account-client';
import { OwV2Error } from '../sync/ow-v2-client-adapter';
import { classifyError, problemFor } from '../core/problems';
import { CANNOT_REACH_LINE } from '../setup/key-check-errors';
import { OW_SETTINGS_URL } from '../core/ow-site';

/**
 * The sign-in error line (B6, S369). `accountErrorMessage`'s code branches
 * (revoked, not recognised, rate limited) are written copy and stay; its
 * fallback read out the server's or the browser's raw text, so every other
 * error is worded here.
 */
export function signInErrorLine(err: unknown): string {
  if (err instanceof OwV2Error) {
    if (err.code === 'key_revoked' || err.status === 401 || err.code === 'rate_limited') return accountErrorMessage(err);
    if (err.status === 429) return 'Too many attempts. Wait a moment and try again.';
    if (err.status >= 400 && err.status < 500) {
      return 'OnlyWorlds did not accept that account token. Check it on onlyworlds.com, in Account settings under Account tokens.';
    }
  }
  if (classifyError(err) === 'offline') return CANNOT_REACH_LINE;
  return problemFor(err, { inline: true, doing: 'signing in' }).sentence;
}

/**
 * #282 (journey scout gap 3): the tab read as two sign-ins side by side. The
 * account token is the one sign-in, so it comes first; the PIN and email
 * below it are what Atlas keeps for writing, each saying what it is for and
 * where it comes from (keel: one PIN per account, set on Account settings).
 */
export function renderAccountTab(reg: WorldsRegistry): string {
  return `
    <section class="atlas-settings-section">
      <h3>Account</h3>
      <p class="atlas-settings-hint" data-role="account-lead">Sign in with an account token to see your onlyworlds.com worlds here. Your PIN lets Atlas save changes to your online worlds.</p>
      ${renderAccountTokenBlock(reg)}
      <label class="atlas-settings-field">
        <span>PIN</span>
        <div class="atlas-settings-pin-row">
          <input class="atlas-input" type="password" name="pin"
                 value="${escapeAttr(reg.pin ?? '')}"
                 placeholder="4 digits"
                 inputmode="numeric"
                 maxlength="4" />
          <button type="button" class="atlas-btn-ghost atlas-settings-pin-toggle" data-shown="false">Show</button>
        </div>
      </label>
      <p class="atlas-settings-hint" data-role="pin-hint">One PIN for all your worlds. You set it on onlyworlds.com, in <a class="atlas-settings-link atlas-link-inline" data-link="account-settings" href="${OW_SETTINGS_URL}" target="_blank" rel="noopener">Account settings</a> under World PIN. Typing it here does not change it there.</p>
      <label class="atlas-settings-field">
        <span>Email</span>
        <input class="atlas-input" type="email" name="email"
               value="${escapeAttr(reg.email ?? '')}"
               placeholder="you@example.com"
               autocomplete="email" />
      </label>
      <p class="atlas-settings-hint" data-role="email-hint">Your onlyworlds.com email. Make online asks for it when it makes a new online world, and Atlas fills it in from here.</p>
    </section>
  `;
}

function renderAccountTokenBlock(reg: WorldsRegistry): string {
  if (reg.account_token) {
    const last4 = reg.account_token.slice(-4);
    return `
      <div class="atlas-settings-field atlas-account-token-block" data-role="account-token-block">
        <span>Account token</span>
        <div class="atlas-account-signed-in">
          <span class="material-symbols-outlined atlas-account-check">check_circle</span>
          <span class="atlas-account-status">Signed in${reg.account_username ? ` as ${escapeText(reg.account_username)}` : ''} <span class="atlas-account-last4">· token …${escapeText(last4)}</span></span>
          <button type="button" class="atlas-btn-ghost" data-action="account-forget">Forget</button>
        </div>
        <p class="atlas-settings-hint">Atlas lists your OnlyWorlds worlds in the sidebar and makes its own key when you open one. Forgetting the token keeps every opened world working.</p>
      </div>
    `;
  }
  return `
    <div class="atlas-settings-field atlas-account-token-block" data-role="account-token-block">
      <span>Account token</span>
      <div class="atlas-settings-pin-row">
        <input class="atlas-input" type="password" name="account-token"
               placeholder="ow_a_..."
               autocomplete="off" spellcheck="false" />
        <button type="button" class="atlas-btn-primary" data-action="account-sign-in">Sign in</button>
      </div>
      <p class="atlas-settings-hint">Your worlds appear in the sidebar, and each opens without a key to copy. Make a token on onlyworlds.com, in <a class="atlas-settings-link atlas-link-inline" data-link="account-tokens" href="${OW_SETTINGS_URL}" target="_blank" rel="noopener">Account settings</a> under Account tokens.</p>
      <div class="atlas-modal-error" data-role="account-token-error" hidden></div>
    </div>
  `;
}

export function wireAccountTab(toasts: ToastManager): void {
  const emailInput = document.querySelector<HTMLInputElement>('.atlas-settings input[name="email"]');
  const pinInput = document.querySelector<HTMLInputElement>('.atlas-settings input[name="pin"]');
  const pinToggle = document.querySelector<HTMLButtonElement>('.atlas-settings-pin-toggle');
  pinToggle?.addEventListener('click', () => {
    const shown = pinToggle.dataset.shown === 'true';
    if (pinInput) pinInput.type = shown ? 'password' : 'text';
    pinToggle.dataset.shown = String(!shown);
    pinToggle.textContent = shown ? 'Show' : 'Hide';
  });
  emailInput?.addEventListener('change', () => {
    const next = setEmail(getState().registry, emailInput.value);
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info('Email saved');
  });
  pinInput?.addEventListener('change', async () => {
    const prevPin = getState().registry.pin;
    const next = setPin(getState().registry, pinInput.value);
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info('PIN saved');
    // Re-attach engine with new credentials if the active world is api-linked
    // and the PIN actually changed. Otherwise stale creds would persist.
    const newPin = next.pin;
    if (newPin && newPin !== prevPin) {
      const active = getState().active;
      const entry = active ? next.worlds.find((w) => w.id === active.worldId) : undefined;
      const folder = getActiveStore();
      if (entry?.state === 'api-linked' && folder) {
        attachSyncEngine(entry, folder);
      }
    }
  });
  wireAccountTokenBlock(toasts);
}

function wireAccountTokenBlock(toasts: ToastManager): void {
  const block = document.querySelector<HTMLElement>('.atlas-settings [data-role="account-token-block"]');
  if (!block) return;

  const signInBtn = block.querySelector<HTMLButtonElement>('[data-action="account-sign-in"]');
  const tokenInput = block.querySelector<HTMLInputElement>('input[name="account-token"]');
  const errorEl = block.querySelector<HTMLElement>('[data-role="account-token-error"]');

  const showError = (msg: string): void => {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.hidden = false;
  };

  const signIn = async (): Promise<void> => {
    if (!tokenInput || !signInBtn) return;
    const token = tokenInput.value.trim();
    if (!token) return;
    if (!token.startsWith('ow_a_')) {
      showError('Account tokens start with ow_a_: this looks like a different kind of key.');
      return;
    }
    if (errorEl) errorEl.hidden = true;
    signInBtn.disabled = true;
    signInBtn.textContent = 'Checking…';
    try {
      const profile = await new AccountClient(token).getProfile();
      const next = setAccountToken(getState().registry, token, profile.username);
      saveRegistry(next);
      patchSlice('registry', next);
      toasts.success(`Signed in as ${profile.username}`);
      // The settings panel re-renders from the registry patch; the block
      // flips to the signed-in state on that pass.
    } catch (err) {
      console.warn('[settings] sign-in failed:', err);
      showError(signInErrorLine(err));
      signInBtn.disabled = false;
      signInBtn.textContent = 'Sign in';
    }
  };

  signInBtn?.addEventListener('click', () => void signIn());
  tokenInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void signIn();
  });

  block.querySelector<HTMLButtonElement>('[data-action="account-forget"]')?.addEventListener('click', () => {
    const next = setAccountToken(getState().registry, undefined);
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info('Account token forgotten. Opened worlds keep their own keys.');
  });
}
