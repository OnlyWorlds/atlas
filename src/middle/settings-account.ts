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

export function renderAccountTab(reg: WorldsRegistry): string {
  return `
    <section class="atlas-settings-section">
      <h3>Account</h3>
      <p class="atlas-settings-hint">Global, used when creating or linking online worlds. PIN changes take effect immediately; any active sync engine is re-attached.</p>
      <label class="atlas-settings-field">
        <span>Email</span>
        <input class="atlas-input" type="email" name="email"
               value="${escapeAttr(reg.email ?? '')}"
               placeholder="you@example.com"
               autocomplete="email" />
      </label>
      <label class="atlas-settings-field">
        <span>PIN</span>
        <div class="atlas-settings-pin-row">
          <input class="atlas-input" type="password" name="pin"
                 value="${escapeAttr(reg.pin ?? '')}"
                 placeholder="OnlyWorlds PIN (4 digits)"
                 inputmode="numeric"
                 maxlength="4" />
          <button type="button" class="atlas-btn-ghost atlas-settings-pin-toggle" data-shown="false">show</button>
        </div>
      </label>
      ${renderAccountTokenBlock(reg)}
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
          <button type="button" class="atlas-btn-ghost" data-action="account-forget">forget</button>
        </div>
        <p class="atlas-settings-hint">Atlas lists your OnlyWorlds worlds in the sidebar and creates its own access key when you open one. Forgetting the token keeps every opened world working.</p>
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
        <button type="button" class="atlas-btn-primary" data-action="account-sign-in">sign in</button>
      </div>
      <p class="atlas-settings-hint">Connects atlas to your OnlyWorlds account: see all your worlds, open any of them without hunting keys. Mint a token at onlyworlds.com → Settings → Account tokens.</p>
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
    pinToggle.textContent = shown ? 'show' : 'hide';
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
    signInBtn.textContent = 'checking…';
    try {
      const profile = await new AccountClient(token).getProfile();
      const next = setAccountToken(getState().registry, token, profile.username);
      saveRegistry(next);
      patchSlice('registry', next);
      toasts.success(`Signed in as ${profile.username}`);
      // The settings panel re-renders from the registry patch; the block
      // flips to the signed-in state on that pass.
    } catch (err) {
      showError(accountErrorMessage(err));
      signInBtn.disabled = false;
      signInBtn.textContent = 'sign in';
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
