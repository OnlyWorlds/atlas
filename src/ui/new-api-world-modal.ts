/**
 * + new api world shortcut (Phase 3.5+).
 *
 * One-form path: name + pin (and, signed out, the account's sign-in) → creates
 * a local-only world inside the atlas root, then immediately runs Route 1
 * (create new api world on the account) so the resulting registry entry is
 * api-linked from the start.
 *
 * For users who don't have local content yet but want to start a fresh
 * cloud-synced world. Where the local half lives is the where-question
 * (1.17, `where-choice.ts`).
 */

import { BaseModal } from './modal-base';
import { lockWhereChoice, readyWhere, takeWhereInClick, whereChoiceHtml, wireWhereChoice } from './where-choice';
import { ToastManager } from './toast-manager';
import { getState, patchSlice } from '../core/state';
import { saveRegistry, attachApi, setPin } from '../registry/registry';
import { createWorldInRoot } from '../setup/atlas-root-flow';
import { createApiWorld, buildV2Adapter, worldOriginLines } from '../sync/make-online';
import { attachSyncEngine } from '../sync/sync-attach';
import { getActiveStore } from '../core/active-store';
import { escapeAttr, escapeText } from '../core/dom-utils';
import { problemFor } from '../core/problems';
import { signInFieldsHtml, missingSignIn, signInInputs, signInFromFields, PIN_REASON_HTML } from './sign-in-fields';
import { wireOnlyWorldsSignIn } from './onlyworlds-sign-in-button';
// view-only-ok: writes a new world of its own, never the active one (conv. 149).

export class NewApiWorldModal extends BaseModal {
  constructor(private toasts: ToastManager) {
    super();
  }

  open(): void {
    const reg = getState().registry;
    const { overlay, body } = this.buildModalShell({
      title: 'New world on OnlyWorlds',
      panelClass: 'atlas-create-api-panel',
      dataModal: 'new-api-world',
    });

    body.innerHTML = `
      <p class="atlas-modal-hint">Creates the world here and on onlyworlds.com, synced from the start.</p>
      <label class="atlas-modal-field">
        <span>World name</span>
        <input class="atlas-input" type="text" name="api-name" placeholder="My new world" autocomplete="off" required />
      </label>
      ${reg.account_token ? `
      <p class="atlas-modal-hint atlas-account-create-as">Creating on your OnlyWorlds account${reg.account_username ? ` (${escapeText(reg.account_username)})` : ''}.</p>
      ` : signInFieldsHtml(reg.email ?? '')}
      <label class="atlas-modal-field">
        <span>PIN</span>
        <input class="atlas-input" type="password" name="api-pin" placeholder="OnlyWorlds PIN (4 digits)" value="${escapeAttr(reg.pin ?? '')}" inputmode="numeric" maxlength="4" required />
        ${PIN_REASON_HTML}
      </label>
      ${whereChoiceHtml()}
      <p class="atlas-modal-error" data-role="error" hidden></p>
      <div class="atlas-modal-progress" data-role="progress" hidden></div>
      <div class="atlas-modal-actions">
        <button class="atlas-btn-ghost" data-action="cancel">Cancel</button>
        <button class="atlas-btn-primary" data-action="create-api">Create</button>
      </div>
    `;

    const nameInput = body.querySelector<HTMLInputElement>('input[name="api-name"]')!;
    const pinInput = body.querySelector<HTMLInputElement>('input[name="api-pin"]')!;
    const errorEl = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const progressEl = body.querySelector<HTMLElement>('[data-role="progress"]')!;
    const submitBtn = body.querySelector<HTMLButtonElement>('[data-action="create-api"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;

    cancelBtn.addEventListener('click', () => this.hide());
    wireWhereChoice(body);
    wireOnlyWorldsSignIn(body, this.toasts, 'new-api');

    // The local world a failed attempt already made: Create again
    // retries only the online step, rather than making a second folder.
    let madeLocally: { id: string; name: string } | null = null;
    // Reused only while it is still the open, local-only world.
    const reusableLocal = (): { id: string; name: string } | null => {
      const made = madeLocally;
      if (!made || getState().active?.worldId !== made.id || !getActiveStore()) return null;
      return getState().registry.worlds.find(w => w.id === made.id)?.state === 'local-only' ? made : null;
    };

    submitBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const pin = pinInput.value.trim();
      errorEl.hidden = true;
      if (!name) { errorEl.textContent = 'A world needs a name.'; errorEl.hidden = false; return; }
      const signIn = missingSignIn(body);
      if (signIn) { errorEl.textContent = signIn.line; errorEl.hidden = false; signIn.input.focus(); return; }
      if (!pin) { errorEl.textContent = 'Enter your PIN.'; errorEl.hidden = false; return; }

      // Taken synchronously, inside the click, before the first await. A retry
      // that reuses the world already made skips the question's step.
      const where = takeWhereInClick(body);
      if (!reusableLocal()) {
        const ready = await readyWhere(where, this.toasts, 'A new OnlyWorlds world also gets a folder on your drive.');
        if (ready !== true) {
          errorEl.textContent = ready || '';
          errorEl.hidden = !ready;
          return;
        }
      }

      submitBtn.disabled = true;
      lockWhereChoice(body, true);
      // Hide cancel: this flow does local + remote work in sequence, and
      // bailing mid-way is hard to recover from cleanly. Hidden > disabled —
      // user shouldn't even see the affordance.
      cancelBtn.hidden = true;
      nameInput.disabled = true;
      const signInFields = signInInputs(body);
      if (signInFields) { signInFields.login.disabled = true; signInFields.password.disabled = true; }
      pinInput.disabled = true;
      progressEl.hidden = false;

      try {
        // 0. Signed out: sign in first, so the account makes the world.
        if (signInFields) {
          progressEl.textContent = 'Signing in to OnlyWorlds…';
          await signInFromFields(body, '', this.toasts);
        }
        // 1. Persist the PIN if not already set.
        let regAfter = getState().registry;
        if (!regAfter.pin) regAfter = setPin(regAfter, pin);
        if (regAfter !== getState().registry) {
          saveRegistry(regAfter);
          patchSlice('registry', regAfter);
        }

        const reuse = reusableLocal();
        let entry: { id: string; name: string };
        if (reuse) {
          entry = reuse;
        } else {
          progressEl.textContent = where === 'browser' ? `Creating "${name}" in this browser…` : `Creating "${name}" in your folder…`;
          ({ entry } = await createWorldInRoot(name, { where }));
          madeLocally = { id: entry.id, name: entry.name };
        }

        progressEl.textContent = `Creating the world on onlyworlds.com…`;
        const lines = worldOriginLines(await getActiveStore()?.readWorldMeta().catch(() => null));
        const created = await createApiWorld({ name: entry.name, pin, lines });
        const apiKey = created.apiKey;

        // World id + name come straight from the create response (keel
        // includes them); v2 GET /world is the fallback for older servers.
        let world: { id?: string; name?: string } = { id: created.worldId, name: created.worldName };
        if (!world.id) {
          progressEl.textContent = `Fetching new world ID…`;
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
          attachSyncEngine(updatedEntry, folder, { justLinked: true });
        }

        this.toasts.success(`${entry.name} created online`);
        this.hide();
      } catch (err) {
        progressEl.hidden = true;
        console.warn('[new-api-world] create failed:', err);
        const sentence = problemFor(err, { inline: true, doing: 'creating the world online', where }).sentence;
        // Once the folder exists, say so: Create now retries only the online
        // step, under the same name (the name field stays locked).
        const reusable = !!reusableLocal();
        errorEl.textContent = reusable
          ? `${sentence} The world is already made here, so Create tries only the online step again.`.trim()
          : sentence;
        errorEl.hidden = !errorEl.textContent;
        submitBtn.disabled = false;
        cancelBtn.hidden = false;
        nameInput.disabled = reusable;
        lockWhereChoice(body, reusable);
        if (signInFields) { signInFields.login.disabled = false; signInFields.password.disabled = false; }
        pinInput.disabled = false;
      }
    });

    this.modal = overlay;
    this.show();
    setTimeout(() => nameInput.focus(), 50);
  }
}


