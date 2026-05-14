/**
 * MakeOnlineModal — flip an active local-only world to api-linked.
 *
 * Two routes (selectable via tabs at the top):
 *
 *   - Route 1 — "create new":
 *       POST /worldsync/create-world-external/ → new api_key.
 *       Push every local element to the new world as CREATEs (via pushOnce
 *       on a transient engine). Stamps `server_updated_at` on each.
 *
 *   - Route 2 — "link existing":
 *       Validate creds via `client.worlds.get()`, then merge local into the
 *       existing api world per the chosen policy:
 *         (b) overwrite-on-match — local wins on duplicates, new locals push.
 *         (c) push-only-new — duplicates skipped, new locals push.
 *
 * On success either way: registry transitions to api-linked, world.json
 * gets the api block, the long-running SyncEngine attaches.
 *
 * Trigger: settings panel "Make Online" button (only shown for local-only
 * active world).
 */

import { BaseModal } from './modal-base';
import { ToastManager } from './toast-manager';
import { getState, patchSlice } from '../core/state';
import { attachApi, saveRegistry, setPin, setEmail, findLinkedWorld } from '../registry/registry';
import { getActiveStore } from './create-world-modal';
import { attachSyncEngine, detachSyncEngine, applyIdSwapToUi } from '../sync/sync-attach';
import { SyncEngine } from '../sync/sync-engine';
import { OwClientAdapter } from '../sync/ow-client-adapter';
import {
  createApiWorld,
  mergeLocalIntoApi,
  buildOwClient,
  type MergePolicy,
  type MergeProgress,
} from '../sync/make-online';

type Route = 'create' | 'link';

export class MakeOnlineModal extends BaseModal {
  private toasts: ToastManager;
  private route: Route = 'create';

  constructor(toasts: ToastManager) {
    super();
    this.toasts = toasts;
  }

  open(): void {
    const active = getState().active;
    if (!active) {
      this.toasts.error('no active world');
      return;
    }
    const entry = getState().registry.worlds.find(w => w.id === active.worldId);
    if (entry?.state === 'api-linked') {
      this.toasts.info('world is already online');
      return;
    }
    if (!getActiveStore()) {
      this.toasts.error('active store not open');
      return;
    }
    this.modal = this.buildModal();
    this.show();
    queueMicrotask(() => {
      this.focusFirstInput();
    });
  }

  private buildModal(): HTMLElement {
    const { overlay, body } = this.buildModalShell({
      title: 'Make online',
      dataModal: 'make-online',
    });

    const reg = getState().registry;
    const active = getState().active!;
    const defaultName = active.meta.name || 'untitled world';
    const prefilledPin = reg.pin ?? '';
    const prefilledEmail = reg.email ?? '';

    body.innerHTML = `
      <div class="atlas-tab-bar atlas-modal-tab-bar">
        <button type="button" class="atlas-tab active" data-route-tab="create">create new</button>
        <button type="button" class="atlas-tab" data-route-tab="link">link to existing</button>
      </div>

      <div data-route-pane="create">
        <p class="atlas-modal-hint">
          create a new world on onlyworlds.com and upload this folder's contents.
        </p>
        <form data-form="create-route">
          <label class="atlas-modal-field">
            <span>Display name</span>
            <input class="atlas-input" type="text" name="create-name" value="${escapeAttr(defaultName)}" autocomplete="off" />
          </label>
          <label class="atlas-modal-field">
            <span>Email</span>
            <input class="atlas-input" type="email" name="create-email" value="${escapeAttr(prefilledEmail)}" placeholder="your onlyworlds account email" autocomplete="off" />
          </label>
          <label class="atlas-modal-field">
            <span>PIN</span>
            <input class="atlas-input" type="text" name="create-pin" value="${escapeAttr(prefilledPin)}" placeholder="four-digit pin" maxlength="8" autocomplete="off" />
          </label>
          <div class="atlas-modal-error" data-role="create-error" hidden></div>
          <div class="atlas-modal-progress" data-role="create-progress" hidden></div>
          <div class="atlas-modal-actions">
            <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
            <button type="submit" class="atlas-btn-primary" data-action="create-submit">Create + upload</button>
          </div>
        </form>
      </div>

      <div data-route-pane="link" hidden>
        <p class="atlas-modal-hint">
          link this folder to a world you've already created on onlyworlds.com. choose how to handle elements that exist on both sides.
        </p>
        <form data-form="link-route">
          <label class="atlas-modal-field">
            <span>API key</span>
            <input class="atlas-input" type="text" name="link-api-key" placeholder="from onlyworlds.com" autocomplete="off" spellcheck="false" />
          </label>
          <label class="atlas-modal-field">
            <span>PIN</span>
            <input class="atlas-input" type="text" name="link-pin" value="${escapeAttr(prefilledPin)}" placeholder="four-digit pin" maxlength="8" autocomplete="off" />
          </label>
          <fieldset class="atlas-modal-field atlas-policy-fieldset">
            <legend>on duplicate (same name + type)</legend>
            <label class="atlas-policy-option">
              <input type="radio" name="link-policy" value="b" checked />
              <span><strong>overwrite</strong> — local copy wins</span>
            </label>
            <label class="atlas-policy-option">
              <input type="radio" name="link-policy" value="c" />
              <span><strong>skip</strong> — keep server copy</span>
            </label>
          </fieldset>
          <label class="atlas-settings-toggle" style="margin-top: 4px;">
            <input type="checkbox" name="link-match-by-name" checked />
            <span>treat same-name elements as duplicates (uncheck to allow same-name elements as separate items)</span>
          </label>
          <div class="atlas-modal-error" data-role="link-error" hidden></div>
          <div class="atlas-modal-progress" data-role="link-progress" hidden></div>
          <div class="atlas-modal-actions">
            <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
            <button type="submit" class="atlas-btn-primary" data-action="link-submit">Link + sync</button>
          </div>
        </form>
      </div>
    `;

    // Tab switching.
    body.querySelectorAll<HTMLButtonElement>('[data-route-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-route-tab') as Route;
        this.route = target;
        body.querySelectorAll<HTMLButtonElement>('[data-route-tab]').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-route-tab') === target);
        });
        body.querySelectorAll<HTMLElement>('[data-route-pane]').forEach((pane) => {
          pane.hidden = pane.getAttribute('data-route-pane') !== target;
        });
        this.focusFirstInput();
      });
    });

    // Cancel buttons close the modal (both routes).
    body.querySelectorAll<HTMLButtonElement>('[data-action="cancel"]').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.preventDefault(); this.hide(); });
    });

    // Route 1 (create).
    const createForm = body.querySelector<HTMLFormElement>('[data-form="create-route"]')!;
    createForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.handleCreate(createForm);
    });

    // Route 2 (link).
    const linkForm = body.querySelector<HTMLFormElement>('[data-form="link-route"]')!;
    linkForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.handleLink(linkForm);
    });

    return overlay;
  }

  private focusFirstInput(): void {
    const pane = this.modal?.querySelector<HTMLElement>(`[data-route-pane="${this.route}"]`);
    const input = pane?.querySelector<HTMLInputElement>('input:not([type="radio"])');
    input?.focus();
    input?.select();
  }

  // -----------------------------------------------------------------------
  // Route 1 — create new api world from this local world's contents.
  // -----------------------------------------------------------------------

  private async handleCreate(form: HTMLFormElement): Promise<void> {
    const errorBox = form.querySelector<HTMLElement>('[data-role="create-error"]')!;
    const progressBox = form.querySelector<HTMLElement>('[data-role="create-progress"]')!;
    const submitBtn = form.querySelector<HTMLButtonElement>('[data-action="create-submit"]')!;
    const inputs = form.querySelectorAll<HTMLInputElement>('input');
    errorBox.hidden = true;
    progressBox.hidden = true;

    const name = (form.querySelector<HTMLInputElement>('input[name="create-name"]')!).value.trim();
    const email = (form.querySelector<HTMLInputElement>('input[name="create-email"]')!).value.trim();
    const pin = (form.querySelector<HTMLInputElement>('input[name="create-pin"]')!).value.trim();

    inputs.forEach((i) => (i.disabled = true));
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating…';
    // Hide every cancel button in this modal during the in-flight create —
    // both routes' panes have one. Bailing mid-create-and-upload leaves
    // partial server-side state and a confused user.
    form.closest<HTMLElement>('[data-modal]')
      ?.querySelectorAll<HTMLButtonElement>('[data-action="cancel"]')
      .forEach((b) => (b.hidden = true));

    try {
      // 1. Create new api world (server-side).
      progressBox.textContent = 'creating world on onlyworlds.com…';
      progressBox.hidden = false;
      const { apiKey } = await createApiWorld({ name, email, pin });

      // 2. Build a client + adapter for the new api world.
      const client = buildOwClient(apiKey, pin);
      const adapter = new OwClientAdapter(client);

      // 3. Find the new world's server-side id via client.worlds.get().
      progressBox.textContent = 'reading new world id…';
      const world = await client.worlds.get() as { id?: string; name?: string };
      if (!world.id) throw new Error('server did not return a world id');

      // 3b. Block double-link: refuse to link if another local world in this
      // atlas is already linked to this api world.
      const active1 = getState().active!;
      const dupe1 = findLinkedWorld(getState().registry, world.id, active1.worldId);
      if (dupe1) {
        throw new Error(`this api world is already linked to "${dupe1.name}" locally. unlink it first or open it from the sidebar.`);
      }

      // 4. Push all local elements as CREATEs via pushOnce on a transient engine.
      //    Detach any existing engine first; we'll attach a fresh one after the
      //    registry transition.
      detachSyncEngine();
      const folder = getActiveStore()!;
      let pushDone = 0;
      let pushTotal = 0;
      const engine = new SyncEngine({
        folder,
        client: adapter,
        // Wire UI propagation on every server-assigned id. Real OW enforces
        // UUID v7, so every CREATE here can swap. Without this, the user's
        // selectedElementId / URL keeps pointing at the pre-swap local id,
        // and after the modal closes the middle pane renders
        // "element <old-id> not found in this world." (Same machinery the
        // attached engine uses — convention #15 + #124.)
        onIdSwap: applyIdSwapToUi,
        onPushProgress: (done, total) => {
          pushDone = done;
          pushTotal = total;
          progressBox.textContent = total === 0
            ? 'uploading: nothing to send'
            : `uploading ${done} of ${total} elements…`;
        },
      });
      const pushResult = await engine.pushOnce();

      // 5. Registry transition + persist global creds.
      const active = getState().active!;
      let reg = getState().registry;
      if (!reg.pin) reg = setPin(reg, pin);
      if (!reg.email) reg = setEmail(reg, email);
      reg = attachApi(reg, active.worldId, { worldId: world.id, apiKey, worldName: world.name });
      saveRegistry(reg);
      patchSlice('registry', reg);

      // 6. Persist api credentials + cached server-side name to disk. Storing
      //    world_name in world.json means a reload-after-restart picks up the
      //    divergence display without a network fetch — atlas-root-flow's
      //    world rescan already reads world.json on import.
      await folder.writeWorldMeta({
        api: { world_id: world.id, api_key: apiKey, ...(world.name ? { world_name: world.name } : {}) },
      });

      // 7. Attach the long-running SyncEngine for this world.
      const updatedEntry = reg.worlds.find((w) => w.id === active.worldId)!;
      attachSyncEngine(updatedEntry, folder);

      // 8. Toast + close.
      const failures = pushResult.failures.length;
      if (failures > 0) {
        this.toasts.error(`${name} is online — ${failures} element${failures === 1 ? '' : 's'} failed (will retry on next sync)`);
      } else {
        const uploaded = pushResult.pushed.creates + pushResult.pushed.updates;
        this.toasts.success(`${name} is online — ${uploaded} element${uploaded === 1 ? '' : 's'} uploaded`);
      }
      void pushDone; void pushTotal;
      this.hide();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errorBox.textContent = message;
      errorBox.hidden = false;
      progressBox.hidden = true;
      inputs.forEach((i) => (i.disabled = false));
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create + upload';
      form.closest<HTMLElement>('[data-modal]')
        ?.querySelectorAll<HTMLButtonElement>('[data-action="cancel"]')
        .forEach((b) => (b.hidden = false));
    }
  }

  // -----------------------------------------------------------------------
  // Route 2 — link to existing api world with merge policy.
  // -----------------------------------------------------------------------

  private async handleLink(form: HTMLFormElement): Promise<void> {
    const errorBox = form.querySelector<HTMLElement>('[data-role="link-error"]')!;
    const progressBox = form.querySelector<HTMLElement>('[data-role="link-progress"]')!;
    const submitBtn = form.querySelector<HTMLButtonElement>('[data-action="link-submit"]')!;
    const inputs = form.querySelectorAll<HTMLInputElement>('input');
    errorBox.hidden = true;
    progressBox.hidden = true;

    const apiKey = (form.querySelector<HTMLInputElement>('input[name="link-api-key"]')!).value.trim();
    const pin = (form.querySelector<HTMLInputElement>('input[name="link-pin"]')!).value.trim();
    const policyRadio = form.querySelector<HTMLInputElement>('input[name="link-policy"]:checked');
    const policy: MergePolicy = (policyRadio?.value === 'c') ? 'c' : 'b';
    const matchByNameInput = form.querySelector<HTMLInputElement>('input[name="link-match-by-name"]');
    const matchByName = matchByNameInput?.checked ?? true;

    if (!apiKey) {
      errorBox.textContent = 'api key is required';
      errorBox.hidden = false;
      return;
    }
    if (!pin) {
      errorBox.textContent = 'pin is required';
      errorBox.hidden = false;
      return;
    }

    inputs.forEach((i) => (i.disabled = true));
    submitBtn.disabled = true;
    submitBtn.textContent = 'Linking…';
    form.closest<HTMLElement>('[data-modal]')
      ?.querySelectorAll<HTMLButtonElement>('[data-action="cancel"]')
      .forEach((b) => (b.hidden = true));

    try {
      // 1. Validate via client.worlds.get().
      progressBox.textContent = 'validating credentials…';
      progressBox.hidden = false;
      const client = buildOwClient(apiKey, pin);
      let world: { id?: string; name?: string };
      try {
        world = await client.worlds.get();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/401|403/.test(msg)) throw new Error('api key or pin invalid');
        if (/404/.test(msg)) throw new Error('no world found for that api key');
        throw new Error(msg);
      }
      if (!world.id) throw new Error('server returned no world id');

      // 1b. Block double-link: refuse if another local world in this atlas
      // is already linked to this api world.
      const active0 = getState().active!;
      const dupe0 = findLinkedWorld(getState().registry, world.id, active0.worldId);
      if (dupe0) {
        throw new Error(`this api world is already linked to "${dupe0.name}" locally. unlink it first or open it from the sidebar.`);
      }

      // 2. Run the merge.
      const adapter = new OwClientAdapter(client);
      detachSyncEngine();
      const folder = getActiveStore()!;
      const renderProgress = (p: MergeProgress) => {
        progressBox.textContent = p.phase === 'list'
          ? 'reading server elements…'
          : `merging ${p.done} of ${p.total} elements…`;
      };
      const mergeResult = await mergeLocalIntoApi(folder, adapter, policy, {
        matchByName,
        onProgress: renderProgress,
        // Mirror Route 1: fire UI propagation on every id-swap that happens
        // during the merge (match-phase + server-assigned-on-CREATE). Without
        // this, a user viewing a local element whose id gets replaced sees
        // "element <old-id> not found in this world" after the modal closes.
        onIdSwap: applyIdSwapToUi,
      });

      // 3. Registry transition + persist creds.
      const active = getState().active!;
      let reg = getState().registry;
      if (!reg.pin) reg = setPin(reg, pin);
      reg = attachApi(reg, active.worldId, { worldId: world.id, apiKey, worldName: world.name });
      saveRegistry(reg);
      patchSlice('registry', reg);

      // 4. Persist api credentials + cached server-side name to disk.
      await folder.writeWorldMeta({
        api: { world_id: world.id, api_key: apiKey, ...(world.name ? { world_name: world.name } : {}) },
      });

      // 5. Attach SyncEngine for ongoing sync.
      const updatedEntry = reg.worlds.find((w) => w.id === active.worldId)!;
      attachSyncEngine(updatedEntry, folder);

      // 5b. Refresh elements cache — bidirectional merge may have downloaded
      // server-only elements and swapped local ids, so the in-memory cache is
      // stale by now.
      try {
        const elements = await folder.listElements();
        patchSlice('data', { elements });
      } catch (err) {
        console.warn('[make-online] refresh-after-merge failed:', err);
      }

      // 6. Toast.
      const { creates, updates, skipped, downloaded, failures } = mergeResult;
      const failed = failures.length;
      const parts: string[] = [];
      if (creates) parts.push(`${creates} pushed`);
      if (updates) parts.push(`${updates} updated`);
      if (skipped) parts.push(`${skipped} skipped`);
      if (downloaded) parts.push(`${downloaded} downloaded`);
      if (failed) parts.push(`${failed} failed`);
      const summary = parts.length ? parts.join(', ') : 'nothing to merge';
      const verb = failed > 0 ? this.toasts.error.bind(this.toasts) : this.toasts.success.bind(this.toasts);
      verb(`linked to ${world.name ?? 'world'} — ${summary}`);

      this.hide();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errorBox.textContent = message;
      errorBox.hidden = false;
      progressBox.hidden = true;
      inputs.forEach((i) => (i.disabled = false));
      submitBtn.disabled = false;
      submitBtn.textContent = 'Link + sync';
      form.closest<HTMLElement>('[data-modal]')
        ?.querySelectorAll<HTMLButtonElement>('[data-action="cancel"]')
        .forEach((b) => (b.hidden = false));
    }
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
