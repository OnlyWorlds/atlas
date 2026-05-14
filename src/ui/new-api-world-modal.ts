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
import { createWorldInRoot } from '../setup/atlas-root-flow';
import { createApiWorld, buildOwClient } from '../sync/make-online';
import { attachSyncEngine } from '../sync/sync-attach';
import { getActiveStore } from './create-world-modal';

export class NewApiWorldModal extends BaseModal {
  constructor(private toasts: ToastManager) {
    super();
  }

  open(): void {
    if (!getState().registry.atlas_root) {
      this.toasts.error('set up atlas folder first');
      return;
    }
    const reg = getState().registry;
    const { overlay, body } = this.buildModalShell({
      title: 'new api world',
      panelClass: 'atlas-create-api-panel',
      dataModal: 'new-api-world',
    });

    body.innerHTML = `
      <p class="atlas-modal-hint">creates a local folder AND a new api world on onlyworlds.com. you can then add elements to both at once.</p>
      <label class="atlas-modal-field">
        <span>world name</span>
        <input class="ow-input" type="text" name="api-name" placeholder="my new world" autocomplete="off" required />
      </label>
      <label class="atlas-modal-field">
        <span>email</span>
        <input class="ow-input" type="email" name="api-email" placeholder="you@example.com" value="${escapeAttr(reg.email ?? '')}" autocomplete="email" required />
      </label>
      <label class="atlas-modal-field">
        <span>pin</span>
        <input class="ow-input" type="text" name="api-pin" placeholder="onlyworlds pin (4 digits)" value="${escapeAttr(reg.pin ?? '')}" inputmode="numeric" maxlength="4" required />
      </label>
      <p class="atlas-modal-error" data-role="error" hidden></p>
      <div class="atlas-modal-progress" data-role="progress" hidden></div>
      <div class="atlas-modal-actions">
        <button class="ow-btn atlas-btn-ghost" data-action="cancel">cancel</button>
        <button class="ow-btn atlas-btn-primary" data-action="create-api">create</button>
      </div>
    `;

    const nameInput = body.querySelector<HTMLInputElement>('input[name="api-name"]')!;
    const emailInput = body.querySelector<HTMLInputElement>('input[name="api-email"]')!;
    const pinInput = body.querySelector<HTMLInputElement>('input[name="api-pin"]')!;
    const errorEl = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const progressEl = body.querySelector<HTMLElement>('[data-role="progress"]')!;
    const submitBtn = body.querySelector<HTMLButtonElement>('[data-action="create-api"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;

    cancelBtn.addEventListener('click', () => this.hide());

    submitBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      const pin = pinInput.value.trim();
      errorEl.hidden = true;
      if (!name) { errorEl.textContent = 'name is required'; errorEl.hidden = false; return; }
      if (!email) { errorEl.textContent = 'email is required'; errorEl.hidden = false; return; }
      if (!pin) { errorEl.textContent = 'pin is required'; errorEl.hidden = false; return; }

      submitBtn.disabled = true;
      cancelBtn.disabled = true;
      nameInput.disabled = true;
      emailInput.disabled = true;
      pinInput.disabled = true;
      progressEl.hidden = false;

      try {
        // 1. Persist global identity fields if not already set.
        let regAfter = getState().registry;
        if (!regAfter.email) regAfter = setEmail(regAfter, email);
        if (!regAfter.pin) regAfter = setPin(regAfter, pin);
        if (regAfter !== getState().registry) {
          saveRegistry(regAfter);
          patchSlice('registry', regAfter);
        }

        progressEl.textContent = `creating local folder for "${name}"...`;
        const { entry } = await createWorldInRoot(name);

        progressEl.textContent = `creating api world on onlyworlds.com...`;
        const { apiKey } = await createApiWorld({ name, email, pin });

        progressEl.textContent = `fetching new world id...`;
        const client = buildOwClient(apiKey, pin);
        const world = await client.worlds.get();
        if (!world?.id) throw new Error('server returned no world id');

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
        this.hide();
      } catch (err) {
        progressEl.hidden = true;
        const msg = err instanceof Error ? err.message : String(err);
        errorEl.textContent = msg;
        errorEl.hidden = false;
        submitBtn.disabled = false;
        cancelBtn.disabled = false;
        nameInput.disabled = false;
        emailInput.disabled = false;
        pinInput.disabled = false;
      }
    });

    this.modal = overlay;
    this.show();
    setTimeout(() => nameInput.focus(), 50);
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
