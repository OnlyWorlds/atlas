/**
 * Settings → Account tab (extracted from settings-panel session 233). Global
 * PIN + email, used when creating or linking online worlds. PIN changes
 * re-attach any active api-linked engine immediately (stale creds otherwise).
 */

import { getState, patchSlice } from '../core/state';
import { saveRegistry, setPin, setEmail } from '../registry/registry';
import { getActiveStore } from '../core/active-store';
import { attachSyncEngine } from '../sync/sync-attach';
import { ToastManager } from '../ui/toast-manager';
import type { WorldsRegistry } from '../core/types';
import { escapeAttr } from '../core/dom-utils';

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
    </section>
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
}
