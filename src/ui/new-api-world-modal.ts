/**
 * + new api world shortcut (Phase 3.5+).
 *
 * One-form path: name + email + pin → creates a local-only world inside the
 * atlas root, then immediately runs Route 1 (create new api world) so the
 * resulting registry entry is api-linked from the start.
 *
 * For users who don't have local content yet but want to start a fresh
 * cloud-synced world.
 */

import { BaseModal } from './modal-base';
import { ToastManager } from './toast-manager';
import { getState, patchSlice } from '../core/state';
import { saveRegistry, attachApi, setPin, setEmail } from '../registry/registry';
import { completeWaypoint } from '../core/waypoints';
import { createWorldInRoot } from '../setup/atlas-root-flow';
import { createApiWorld, buildV2Adapter } from '../sync/make-online';
import { attachSyncEngine } from '../sync/sync-attach';
import { getActiveStore } from '../core/active-store';
import { escapeAttr, escapeText } from '../core/dom-utils';

export class NewApiWorldModal extends BaseModal {
  constructor(private toasts: ToastManager) {
    super();
  }

  open(): void {
    if (!getState().registry.atlas_root) {
      this.toasts.error('Set up atlas folder first');
      return;
    }
    const reg = getState().registry;
    const { overlay, body } = this.buildModalShell({
      title: 'New API world',
      panelClass: 'atlas-create-api-panel',
      dataModal: 'new-api-world',
    });

    body.innerHTML = `
      <p class="atlas-modal-hint">Creates a local folder AND a new API world on onlyworlds.com. You can then add elements to both at once.</p>
      <label class="atlas-modal-field">
        <span>World name</span>
        <input class="atlas-input" type="text" name="api-name" placeholder="My new world" autocomplete="off" required />
      </label>
      ${reg.account_token ? `
      <p class="atlas-modal-hint atlas-account-create-as">Creating on your OnlyWorlds account${reg.account_username ? ` (${escapeText(reg.account_username)})` : ''}.</p>
      ` : `
      <label class="atlas-modal-field">
        <span>Email</span>
        <input class="atlas-input" type="email" name="api-email" placeholder="you@example.com" value="${escapeAttr(reg.email ?? '')}" autocomplete="email" required />
      </label>
      `}
      <label class="atlas-modal-field">
        <span>PIN</span>
        <input class="atlas-input" type="text" name="api-pin" placeholder="OnlyWorlds PIN (4 digits)" value="${escapeAttr(reg.pin ?? '')}" inputmode="numeric" maxlength="4" required />
      </label>
      <p class="atlas-modal-error" data-role="error" hidden></p>
      <div class="atlas-modal-progress" data-role="progress" hidden></div>
      <div class="atlas-modal-actions">
        <button class="atlas-btn-ghost" data-action="cancel">Cancel</button>
        <button class="atlas-btn-primary" data-action="create-api">Create</button>
      </div>
    `;

    const nameInput = body.querySelector<HTMLInputElement>('input[name="api-name"]')!;
    // Absent when signed in (the account token replaces the email lane).
    const emailInput = body.querySelector<HTMLInputElement>('input[name="api-email"]');
    const pinInput = body.querySelector<HTMLInputElement>('input[name="api-pin"]')!;
    const errorEl = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const progressEl = body.querySelector<HTMLElement>('[data-role="progress"]')!;
    const submitBtn = body.querySelector<HTMLButtonElement>('[data-action="create-api"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;

    cancelBtn.addEventListener('click', () => this.hide());

    submitBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const email = emailInput?.value.trim() ?? '';
      const pin = pinInput.value.trim();
      const signedIn = !!getState().registry.account_token;
      errorEl.hidden = true;
      if (!name) { errorEl.textContent = 'Name is required'; errorEl.hidden = false; return; }
      if (!signedIn && !email) { errorEl.textContent = 'Email is required'; errorEl.hidden = false; return; }
      if (!pin) { errorEl.textContent = 'PIN is required'; errorEl.hidden = false; return; }

      submitBtn.disabled = true;
      // Hide cancel: this flow does local + remote work in sequence, and
      // bailing mid-way is hard to recover from cleanly. Hidden > disabled —
      // user shouldn't even see the affordance.
      cancelBtn.hidden = true;
      nameInput.disabled = true;
      if (emailInput) emailInput.disabled = true;
      pinInput.disabled = true;
      progressEl.hidden = false;

      try {
        // 1. Persist global identity fields if not already set.
        let regAfter = getState().registry;
        if (!regAfter.email && email) regAfter = setEmail(regAfter, email);
        if (!regAfter.pin) regAfter = setPin(regAfter, pin);
        if (regAfter !== getState().registry) {
          saveRegistry(regAfter);
          patchSlice('registry', regAfter);
        }

        progressEl.textContent = `Creating local folder for "${name}"...`;
        const { entry } = await createWorldInRoot(name);
        // Waypoint: a real folder world exists from here on, even if the
        // later API step fails (hookmap wp1 — ungated by construction).
        completeWaypoint('first-world');

        progressEl.textContent = `Creating API world on onlyworlds.com...`;
        const created = await createApiWorld({ name, email, pin });
        const apiKey = created.apiKey;

        // World id + name come straight from the create response (keel
        // includes them); v2 GET /world is the fallback for older servers.
        let world: { id?: string; name?: string } = { id: created.worldId, name: created.worldName };
        if (!world.id) {
          progressEl.textContent = `Fetching new world ID...`;
          world = await buildV2Adapter(apiKey, pin).getWorld();
        }
        if (!world?.id) throw new Error('Server returned no world ID');

        // Flip registry to api-linked + persist credentials to disk.
        // Cache the server-side world name so settings can flag api-vs-local
        // name divergence without a network fetch.
        regAfter = attachApi(getState().registry, entry.id, {
          worldId: world.id,
          apiKey,
          worldName: world.name,
        });
        saveRegistry(regAfter);
        patchSlice('registry', regAfter);
        const folder = getActiveStore();
        if (folder) {
          await folder.writeWorldMeta({
            api: {
              world_id: world.id,
              api_key: apiKey,
              ...(world.name ? { world_name: world.name } : {}),
            },
          });
          const updatedEntry = regAfter.worlds.find((w) => w.id === entry.id)!;
          attachSyncEngine(updatedEntry, folder);
        }

        this.toasts.success(`${name} created online`);
        completeWaypoint('ecosystem'); // this modal IS Route 1 (new api world)
        this.hide();
      } catch (err) {
        progressEl.hidden = true;
        const msg = err instanceof Error ? err.message : String(err);
        errorEl.textContent = msg;
        errorEl.hidden = false;
        submitBtn.disabled = false;
        cancelBtn.hidden = false;
        nameInput.disabled = false;
        if (emailInput) emailInput.disabled = false;
        pinInput.disabled = false;
      }
    });

    this.modal = overlay;
    this.show();
    setTimeout(() => nameInput.focus(), 50);
  }
}


