/**
 * MakeOnlineModal — flip an active local-only world to api-linked.
 *
 * Two routes (selectable via tabs at the top):
 *
 *   - Route 1, "create new": `createApiWorld` (`sync/make-online.ts`),
 *       `POST /api/v2/account/worlds` on the account; signed out, the pane
 *       signs in first (`sign-in-fields.ts`, Keel #134). Then every local
 *       element uploads through `pushOnce` on a transient engine.
 *
 *   - Route 2, "link existing": validate with `getWorld()` on the v2
 *       adapter, then the Route 2 runner (`sync/make-online-run.ts`):
 *       name-matched locals take the server's ids through the re-key
 *       kernel first, then (b) push, local wins; (c) the server's record
 *       lands locally. Server-only elements download.
 *
 * Either way: registry to api-linked, world.json gets the api block, and the
 * long-running SyncEngine attaches with `justLinked` (S366: its own failed
 * uploads are retried, never asked about). DESIGN_SYNC "Make Online".
 *
 * Trigger: settings panel "Make Online" button (only shown for local-only
 * active world).
 */

import { BaseModal } from './modal-base';
import { ToastManager } from './toast-manager';
import { getState, patchSlice } from '../core/state';
import { attachApi, saveRegistry, setPin, findLinkedWorld } from '../registry/registry';
import { completeWaypoint } from '../core/waypoints';
import { isBrowserWorld } from '../core/browser-worlds';
import { isSeatSecret } from '../core/seat';

/** Taking a browser world online gives it a copy outside this browser (contract §6.2); a folder world already had one. */
function completeKeepCopyIfBrowserWorld(): void {
  const s = getState();
  if (isBrowserWorld(s.registry.worlds.find(w => w.id === s.active?.worldId))) completeWaypoint('keep-copy');
}
import { getActiveStore } from '../core/active-store';
import { attachSyncEngine, detachSyncEngine } from '../sync/sync-attach';
import { runRoute2, ambiguousLine, childClashLine } from '../sync/make-online-run';
import { SyncEngine } from '../sync/sync-engine';
import {
  createApiWorld,
  buildV2Adapter,
  worldOriginLines,
  type MergePolicy,
  type MergeProgress,
} from '../sync/make-online';
import { escapeAttr } from '../core/dom-utils';
import { signInFieldsHtml, signedInLineHtml, missingSignIn, signInInputs, signInFromFields, PIN_REASON_HTML } from './sign-in-fields';

import { describeFailures, failureToastOnce } from '../sync/sync-failure-copy';
import { filesWhereOf } from '../core/browser-worlds';
import { PlainError, problemFor } from '../core/problems';
import { keyCheckError } from '../setup/key-check-errors';
import { slicePushRefusal } from '../core/provenance';
// view-only-ok: a view-only world is already online, and Make online is for a local world (conv. 149).

/** Where the world being taken online keeps its files: the open world (1.17). */
function activeFilesWhere(): 'folder' | 'browser' {
  const s = getState();
  return filesWhereOf(s.registry.worlds.find(w => w.id === s.active?.worldId));
}

type Route = 'create' | 'link';

/** Make online refuses a world another local world is already linked to. */
function alreadyLinkedLine(otherName: string): string {
  return `This OnlyWorlds world is already linked here as "${otherName}". Open that world from the sidebar, or unlink it first.`;
}

export class MakeOnlineModal extends BaseModal {
  private toasts: ToastManager;
  private route: Route = 'create';
  /**
   * A route is running (S367 gate B5). The runner makes the app behind the
   * modal inert, but the modal is outside it: without this the other tab's
   * form could start a second route on the same folder mid-run.
   */
  private busy = false;

  private setBusy(on: boolean): void {
    this.busy = on;
    document.querySelectorAll<HTMLButtonElement>('[data-modal="make-online"] [data-route-tab]')
      .forEach((b) => { b.disabled = on; });
  }

  constructor(toasts: ToastManager) {
    super();
    this.toasts = toasts;
  }

  open(): void {
    const active = getState().active;
    if (!active) {
      this.toasts.error('No world is open. Open one from the sidebar, then make it online.');
      return;
    }
    const entry = getState().registry.worlds.find(w => w.id === active.worldId);
    if (entry?.state === 'api-linked') {
      this.toasts.info('World is already online');
      return;
    }
    // The tour world is a sandbox (S361, re-key gate lens 3): until it is kept
    // its ids are the live demo world's, so keel refuses every element, and
    // Start fresh deletes it. Keeping it (1.17) gives it ids of its own and
    // ends the sandbox; then it goes online like any world.
    if (entry?.demo === true) {
      this.toasts.info('The tour world is a sandbox until you keep it at the end of the tour.');
      return;
    }
    // One Character's view, or the public one, is not the whole world, and
    // never goes online as a world of its own (folder spec §4.2, P1).
    const sliceRefusal = slicePushRefusal(active.meta, entry?.name ?? String(active.meta?.name ?? 'this world'));
    if (sliceRefusal) {
      this.toasts.info(sliceRefusal);
      return;
    }
    if (!getActiveStore()) {
      this.toasts.error('This world is not open. Open it from the sidebar, then try again.');
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
    const defaultName = active.meta.name || 'Untitled world';
    const prefilledPin = reg.pin ?? '';
    // The world is made on the account (createApiWorld): signed in, the PIN alone
    // (the journey's A7 frame, S427); signed out, the form signs in first (Keel #134).
    const signedIn = Boolean(reg.account_token);
    const accountLine = signedIn ? signedInLineHtml(reg.account_username) : '';
    const signInFields = signedIn ? '' : signInFieldsHtml(reg.email ?? '');

    body.innerHTML = `
      <div class="atlas-tab-bar atlas-modal-tab-bar">
        <button type="button" class="atlas-tab active" data-route-tab="create">Create new</button>
        <button type="button" class="atlas-tab" data-route-tab="link">Link to existing</button>
      </div>

      <div data-route-pane="create">
        <p class="atlas-modal-hint">
          Create a new world on onlyworlds.com and upload this world's contents.
        </p>
        <form data-form="create-route">
          <label class="atlas-modal-field">
            <span>Display name</span>
            <input class="atlas-input" type="text" name="create-name" value="${escapeAttr(defaultName)}" autocomplete="off" />
          </label>
          ${signInFields}
          <label class="atlas-modal-field">
            <span>PIN</span>
            <input class="atlas-input" type="password" name="create-pin" value="${escapeAttr(prefilledPin)}" placeholder="Four-digit PIN" maxlength="64" autocomplete="off" />
            ${PIN_REASON_HTML}
          </label>
          ${accountLine}
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
          Link this world to a world you already have on onlyworlds.com. Choose how to handle elements that exist on both sides.
        </p>
        <form data-form="link-route">
          <label class="atlas-modal-field">
            <span>API key</span>
            <input class="atlas-input" type="text" name="link-api-key" placeholder="From onlyworlds.com" autocomplete="off" spellcheck="false" />
          </label>
          <label class="atlas-modal-field">
            <span>PIN, or a seat secret</span>
            <input class="atlas-input" type="password" name="link-pin" value="${escapeAttr(prefilledPin)}" placeholder="Four digits, or ow_s_…" maxlength="64" autocomplete="off" />
          </label>
          <fieldset class="atlas-modal-field atlas-policy-fieldset">
            <legend>On duplicate (same name + type)</legend>
            <label class="atlas-policy-option">
              <input type="radio" name="link-policy" value="b" checked />
              <span>
                <strong>Overwrite <span class="atlas-settings-default-tag">default</span></strong>
                <em>Your copy wins: it replaces the one on onlyworlds.com.</em>
              </span>
            </label>
            <label class="atlas-policy-option">
              <input type="radio" name="link-policy" value="c" />
              <span>
                <strong>Skip</strong>
                <em>Keep server copy: local edits to matched elements are lost.</em>
              </span>
            </label>
          </fieldset>
          <label class="atlas-modal-checkbox-row">
            <input type="checkbox" name="link-match-by-name" checked />
            <span>
              <strong>Treat same-name elements as duplicates</strong>
              <em>Uncheck to allow same-name elements to coexist as separate items.</em>
            </span>
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

    // Tab switching. Refused while a route runs (S367 gate B5).
    body.querySelectorAll<HTMLButtonElement>('[data-route-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.busy) return;
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
      if (this.busy) return;
      void this.handleCreate(createForm);
    });

    // Route 2 (link).
    const linkForm = body.querySelector<HTMLFormElement>('[data-form="link-route"]')!;
    linkForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.busy) return;
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
    const pin = (form.querySelector<HTMLInputElement>('input[name="create-pin"]')!).value.trim();

    // Pre-validate every required field BEFORE disabling inputs or calling
    // the server, so an empty one never looks like a partial send. Session
    // 221 W7: validate up front, focus the empty field, leave inputs editable.
    const signIn = missingSignIn(form);
    const missing = !name ? { input: form.querySelector<HTMLInputElement>('input[name="create-name"]'), line: 'Name is required' }
      : signIn ? signIn
      : !pin ? { input: form.querySelector<HTMLInputElement>('input[name="create-pin"]'), line: 'PIN is required' }
      : null;
    if (missing) {
      errorBox.textContent = missing.line;
      errorBox.hidden = false;
      missing.input?.focus();
      return;
    }

    inputs.forEach((i) => (i.disabled = true));
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating…';
    // Hide every cancel button in this modal during the in-flight create —
    // both routes' panes have one. Bailing mid-create-and-upload leaves
    // partial server-side state and a confused user.
    form.closest<HTMLElement>('[data-modal]')
      ?.querySelectorAll<HTMLButtonElement>('[data-action="cancel"]')
      .forEach((b) => (b.hidden = true));
    // No outside-click or Escape close while the upload runs: closing looked
    // like a cancel and was not, the work carried on unseen (S360).
    this.dismissLocked = true;
    this.setBusy(true);

    try {
      // 0. Signed out: sign in first, so the account makes the world (Keel #134).
      if (signInInputs(form)) {
        progressBox.textContent = 'Signing in to OnlyWorlds…';
        progressBox.hidden = false;
        await signInFromFields(form, '', this.toasts);
      }
      // 1. Create new api world (server-side).
      progressBox.textContent = 'Creating world on onlyworlds.com…';
      progressBox.hidden = false;
      const lines = worldOriginLines(await getActiveStore()?.readWorldMeta().catch(() => null));
      const created = await createApiWorld({ name, pin, lines });
      const apiKey = created.apiKey;

      // 2. Build the v2 adapter for element CRUD (gate 10.7: the SDK client
      //    exists only for the worlds.get fallback below).
      const adapter = buildV2Adapter(apiKey, pin);

      // 3. World id + name come straight from the create response (keel
      //    includes them); fall back to v2 GET /world only when absent.
      let world: { id?: string; name?: string } = { id: created.worldId, name: created.worldName };
      if (!world.id) {
        progressBox.textContent = 'Reading new world ID…';
        world = await adapter.getWorld();
      }
      if (!world.id) throw new Error('Server did not return a world ID');

      // 3b. Block double-link: refuse to link if another local world in this
      // atlas is already linked to this api world.
      const active1 = getState().active!;
      const dupe1 = findLinkedWorld(getState().registry, world.id, active1.worldId);
      if (dupe1) {
        throw new PlainError(alreadyLinkedLine(dupe1.name));
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
        apiWorldId: world.id,
        // No onIdSwap: keel preserves client ids on CREATE (create-path
        // id-swap excised 2026-07-12).
        onPushProgress: (done, total) => {
          pushDone = done;
          pushTotal = total;
          progressBox.textContent = total === 0
            ? 'Uploading: nothing to send'
            : `Uploading ${done} of ${total} elements…`;
        },
      });
      const pushResult = await engine.pushOnce();

      // 5. Registry transition + persist global creds.
      const active = getState().active!;
      let reg = getState().registry;
      // A seat's secret is this world's PIN only (#104), never the account's.
      const seatSecret = isSeatSecret(pin) ? pin : undefined;
      if (!reg.pin && !seatSecret) reg = setPin(reg, pin);
      reg = attachApi(reg, active.worldId, { worldId: world.id, apiKey, worldName: world.name, seatSecret });
      saveRegistry(reg);
      patchSlice('registry', reg);

      // 6. Persist api credentials + cached server-side name to disk. Storing
      //    world_name in world.json means a reload-after-restart picks up the
      //    divergence display without a network fetch — atlas-root-flow's
      //    world rescan already reads world.json on import.
      await folder.writeWorldMeta({
        api: { world_id: world.id, api_key: apiKey, ...(world.name ? { world_name: world.name } : {}), ...(seatSecret ? { seat: {} } : {}) },
        // Un-demo on make-online (attachApi drops the registry mirror; the
        // merge + stringify drops an undefined key from world.json).
        demo: undefined,
      });

      // 7. Attach the long-running SyncEngine for this world.
      const updatedEntry = reg.worlds.find((w) => w.id === active.worldId)!;
      attachSyncEngine(updatedEntry, folder, { justLinked: true });

      // 8. Toast + close.
      const failures = pushResult.failures.length;
      if (failures > 0) {
        // Say why (S360): "will retry" was false for the commonest cause, an
        // id another world already holds, which fails every retry.
        // Registered as shown (re-key gate lens 2 F11): the flush-on-attach
        // round re-sends the same failing set a moment later and must not
        // repeat the paragraph.
        this.toasts.error(`${name} is online. ${failureToastOnce(pushResult.failures, activeFilesWhere()) ?? describeFailures(pushResult.failures, activeFilesWhere())}`);
      } else {
        const uploaded = pushResult.pushed.creates + pushResult.pushed.updates;
        this.toasts.success(`${name} is online · ${uploaded} element${uploaded === 1 ? '' : 's'} uploaded`);
      }
      completeWaypoint('ecosystem'); completeKeepCopyIfBrowserWorld();
      void pushDone; void pushTotal;
      this.hide();
    } catch (err) {
      console.warn('[make-online] create route failed:', err);
      const sentence = problemFor(err, { inline: true, doing: 'creating the world online' }).sentence;
      errorBox.textContent = sentence;
      errorBox.hidden = !sentence;
      progressBox.hidden = true;
      inputs.forEach((i) => (i.disabled = false));
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create + upload';
      form.closest<HTMLElement>('[data-modal]')
        ?.querySelectorAll<HTMLButtonElement>('[data-action="cancel"]')
        .forEach((b) => (b.hidden = false));
      this.dismissLocked = false;
      this.setBusy(false);
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
      errorBox.textContent = 'API key is required';
      errorBox.hidden = false;
      return;
    }
    if (!pin) {
      errorBox.textContent = 'PIN is required';
      errorBox.hidden = false;
      return;
    }

    inputs.forEach((i) => (i.disabled = true));
    submitBtn.disabled = true;
    submitBtn.textContent = 'Linking…';
    form.closest<HTMLElement>('[data-modal]')
      ?.querySelectorAll<HTMLButtonElement>('[data-action="cancel"]')
      .forEach((b) => (b.hidden = true));
    // No outside-click or Escape close while the upload runs: closing looked
    // like a cancel and was not, the work carried on unseen (S360).
    this.dismissLocked = true;
    this.setBusy(true);

    try {
      // 1. Validate via v2 GET /world.
      progressBox.textContent = 'Validating credentials…';
      progressBox.hidden = false;
      const client = buildV2Adapter(apiKey, pin);
      let world: { id?: string; name?: string };
      try {
        world = await client.getWorld();
        await client.checkPin();
      } catch (err) {
        // A refused key, an unknown world or no connection, in words (A38,
        // S369: offline used to show "Failed to fetch"); the rest as it came.
        throw keyCheckError(err);
      }
      if (!world.id) throw new Error('Server returned no world ID');

      // 1b. Block double-link: refuse if another local world in this atlas
      // is already linked to this api world.
      const active0 = getState().active!;
      const dupe0 = findLinkedWorld(getState().registry, world.id, active0.worldId);
      if (dupe0) {
        throw new PlainError(alreadyLinkedLine(dupe0.name));
      }

      // 2. The merge, through the Route 2 runner (S367): the id-move lock, the
      //    app inert, rooms flushed, local ids moved onto the server's with
      //    the journaled kernel BEFORE any server call, the screen following
      //    the disk, then the server phase. The link step runs inside the
      //    runner's lock so no live-folder pass sees a half-linked world.
      const adapter = buildV2Adapter(apiKey, pin);
      detachSyncEngine();
      const folder = getActiveStore()!;
      const worldId = active0.worldId;
      const renderProgress = (p: MergeProgress) => {
        progressBox.textContent = p.phase === 'list'
          ? 'Reading server elements…'
          : p.phase === 'ids'
            // The kernel's count is file writes, not elements (S367 gate B4).
            ? `Moving links to the online ids: ${p.done} of ${p.total}…`
            : `Merging ${p.done} of ${p.total} elements…`;
      };
      let failureDetail: string | null = null;
      const mergeResult = await runRoute2({
        store: folder,
        worldId,
        adapter,
        policy,
        matchByName,
        onProgress: renderProgress,
        link: async (result) => {
          // The double-link check again (S367 gate B11): another tab may have
          // linked a different local world to this api world during the merge.
          const dupe = findLinkedWorld(getState().registry, world.id!, worldId);
          if (dupe) {
            throw new PlainError(`While linking, "${dupe.name}" was linked to this OnlyWorlds world in another tab. Unlink one of them, then run Make online again.`);
          }
          // 3. Registry transition + persist creds (read now: the id move
          //    rewrote this world's entry).
          let reg = getState().registry;
          // A seat's secret is this world's PIN only (#104), never the account's.
          const seatSecret = isSeatSecret(pin) ? pin : undefined;
          if (!reg.pin && !seatSecret) reg = setPin(reg, pin);
          reg = attachApi(reg, worldId, { worldId: world.id!, apiKey, worldName: world.name, seatSecret });
          saveRegistry(reg);
          patchSlice('registry', reg);

          // 4. Persist api credentials + cached server-side name to disk.
          await folder.writeWorldMeta({
            api: { world_id: world.id!, api_key: apiKey, ...(world.name ? { world_name: world.name } : {}), ...(seatSecret ? { seat: {} } : {}) },
            // Un-demo on make-online (see Route 1 note).
            demo: undefined,
          });

          // 5. Attach SyncEngine for ongoing sync. The merge's failure set is
          // registered as shown FIRST (S366 gate A3, as Route 1 does): the
          // attach's flush retries the same set a moment later and must not
          // toast the same paragraph a second time.
          failureDetail = result.failures.length > 0
            ? (failureToastOnce(result.failures, activeFilesWhere()) ?? describeFailures(result.failures, activeFilesWhere()))
            : null;
          const updatedEntry = reg.worlds.find((w) => w.id === worldId)!;
          attachSyncEngine(updatedEntry, folder, { justLinked: true });
        },
      });

      // 6. Toast.
      const { creates, updates, skipped, downloaded, proposed, failures } = mergeResult;
      const failed = failures.length;
      const parts: string[] = [];
      if (creates) parts.push(`${creates} pushed`);
      if (updates) parts.push(`${updates} updated`);
      if (proposed) parts.push(`${proposed} sent for the keeper's review`);
      if (skipped) parts.push(`${skipped} skipped`);
      if (downloaded) parts.push(`${downloaded} downloaded`);
      if (failed) parts.push(`${failed} failed`);
      const summary = parts.length ? parts.join(', ') : 'Nothing to merge';
      const verb = failed > 0 ? this.toasts.error.bind(this.toasts) : this.toasts.success.bind(this.toasts);
      const unmatched = ambiguousLine(mergeResult.ambiguous);
      const spatial = childClashLine(mergeResult.childClashes);
      verb(`Linked to ${world.name || 'world'} · ${summary}${unmatched ? `. ${unmatched}` : ''}${spatial ? `. ${spatial}` : ''}${failureDetail ? `. ${failureDetail}` : ''}`);
      // Files the id move could not open keep their old links (S367 gate B2),
      // said as the Settings re-key says it.
      if (mergeResult.unrewritten.length > 0) {
        const { unrewrittenMessage } = await import('./rekey-modal');
        this.toasts.error(unrewrittenMessage(mergeResult.unrewritten), 10_000);
      }
      completeWaypoint('ecosystem'); completeKeepCopyIfBrowserWorld();

      this.hide();
    } catch (err) {
      // A twice-stopped id move arrives already worded (the runner's
      // LINK_STOPPED_LINE, S367 gate B3, a MergeRefusedError): problemFor
      // passes refusals through and words the rest (S369).
      console.warn('[make-online] link route failed:', err);
      const sentence = problemFor(err, { inline: true, doing: 'linking this world' }).sentence;
      errorBox.textContent = sentence;
      errorBox.hidden = !sentence;
      progressBox.hidden = true;
      inputs.forEach((i) => (i.disabled = false));
      submitBtn.disabled = false;
      submitBtn.textContent = 'Link + sync';
      form.closest<HTMLElement>('[data-modal]')
        ?.querySelectorAll<HTMLButtonElement>('[data-action="cancel"]')
        .forEach((b) => (b.hidden = false));
      this.dismissLocked = false;
      this.setBusy(false);
    }
  }
}


