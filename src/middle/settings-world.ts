/**
 * Settings → World tab (extracted from settings-panel session 233). Per-active-
 * world controls: rename, state/folder/id metadata, stay-offline, refresh/test/
 * unlink (api-linked) or make-online (local-only), and the two delete flows
 * (forget = keep folder; delete = remove folder on disk).
 */

import { getState, patchSlice } from '../core/state';
import { diskApiBlock, isSeatWorld, SEAT_REMOVE_WHERE, SEAT_SECRET_MISSING_LINE, seatRoleWords, worldPin } from '../core/seat';
import {
  saveRegistry,
  deleteWorldEntry,
  detachApi,
  renameWorld,
  setApiWorldName,
  setWorldPaused,
  effectiveSyncPaused,
} from '../registry/registry';
import { deleteHandle, loadHandle } from '../store/handle-vault';
import { getActiveStore, setActiveStore, evictParkedStore } from '../core/active-store';
import { deleteWorldFolderUnderRoot, whyWorldFolderNotDeletable } from '../setup/atlas-root-flow';
import { MakeOnlineModal } from '../ui/make-online-modal';
import { ToastManager } from '../ui/toast-manager';
import { surfaceSyncUnavailable, upToDate } from '../ui/sync-toasts';
import { showProblem } from '../ui/problem-fixes';
import { elementHash, navigate } from '../core/router';
import { issuesFor, clearSyncIssues, type SyncIssue } from '../sync/sync-issues';
import { buildFailureDetails } from '../core/problems';
import { detailsContext } from '../ui/problem-fixes';
import {
  detachSyncEngine,
  getCurrentSyncEngine,
  getCurrentSyncWorldId,
  pullNowAndRefresh,
  refreshElementsAfterWrite,
  requestPushIfLinked,
} from '../sync/sync-attach';
import { buildV2Adapter } from '../sync/make-online';
import { keyRefusalFor, makeNewWorldKey, newKeyCures, offersMakeKey } from '../sync/world-key';
import { keyRefusalHere, keyRefusalOf, seatRefusalLine } from '../sync/world-key-lines';
import type { WorldRegistryEntry } from '../core/types';
import { filesWhereOf, isBrowserWorld } from '../core/browser-worlds';
import { hasFolderMode } from '../core/capabilities';
import { downloadWorldFromClick } from '../ui/download-world';
import { escapeText, escapeAttr } from '../core/dom-utils';
import { canOfferInvite, owAccessUrl } from '../core/ow-site';
import { findDanglingLinks, scrubReferrers } from '../store/scrub-links';
import { WORLD_UNIT_FIELDS, WORLD_UNIT_MAX_LENGTH, type WorldUnitField } from '../core/world-units';

/** World units (Atlas #149): label, placeholder, the fields it labels. */
const UNIT_ROWS: Readonly<Record<WorldUnitField, { label: string; placeholder: string; toast: string }>> = {
  length_unit: { label: 'Length', placeholder: 'cm, ft, hands', toast: 'Length unit' },
  mass_unit: { label: 'Mass', placeholder: 'kg, lb, stone', toast: 'Mass unit' },
  distance_unit: { label: 'Distance', placeholder: 'km, mi, leagues', toast: 'Distance unit' },
};

function renderUnitFields(): string {
  const meta = (getState().active?.meta ?? {}) as Partial<Record<WorldUnitField, string>>;
  const cells = WORLD_UNIT_FIELDS.map((f) => `
          <label class="atlas-settings-unit">
            <span>${UNIT_ROWS[f].label}</span>
            <input class="atlas-input" type="text" name="world-${f.replace('_', '-')}" data-unit-field="${f}"
              maxlength="${WORLD_UNIT_MAX_LENGTH}" autocomplete="off"
              value="${escapeAttr(meta[f] ?? '')}" placeholder="${escapeAttr(UNIT_ROWS[f].placeholder)}" />
          </label>`).join('');
  return `
      <div class="atlas-settings-field" data-role="world-units">
        <span>Units</span>
        <div class="atlas-settings-units-row">${cells}
        </div>
        <p class="atlas-settings-hint">Length for heights, mass for weights, distance for range, speed and elevation. Atlas shows each unit after its number and converts nothing.</p>
      </div>`;
}

/** Each unit saves like the image URL: world.json, the active mirror, then the world-meta sync. */
function wireUnitFields(world: WorldRegistryEntry, toasts: ToastManager): void {
  document.querySelectorAll<HTMLInputElement>('.atlas-settings input[data-unit-field]').forEach((input) => {
    const field = input.dataset.unitField as WorldUnitField;
    input.addEventListener('change', () => {
      void (async () => {
        const v = input.value.trim();
        input.value = v;
        if (v.length > WORLD_UNIT_MAX_LENGTH) { toasts.error(`${UNIT_ROWS[field].toast} is too long (max ${WORLD_UNIT_MAX_LENGTH} characters)`); return; }
        const store = getActiveStore();
        const active = getState().active;
        if (!store || !active) { toasts.error('This world is not open. Open it from the sidebar, then try again.'); return; }
        try {
          await store.writeWorldMeta({ [field]: v });
          patchSlice('active', { ...active, meta: { ...active.meta, [field]: v } });
          requestPushIfLinked();
          toasts.info(v ? `${UNIT_ROWS[field].toast} saved` : `${UNIT_ROWS[field].toast} cleared`);
        } catch (err) {
          console.error('[settings] world unit save failed:', err);
          showProblem(err, { doing: 'saving the world\'s units', worldId: world.id, toasts });
        }
      })();
    });
  });
}

/** A seat world's own line (#104): what the seat may do, and a lost secret said plainly. */
export function seatLine(world: WorldRegistryEntry): string {
  const what = seatRoleWords(world.api?.seat?.role);
  const base = `Connected from onlyworlds.com on its own seat.${what ? ` ${what}` : ''} To remove the seat, go to onlyworlds.com, ${SEAT_REMOVE_WHERE}.`;
  return world.api?.seat_secret ? base : `${base} ${SEAT_SECRET_MISSING_LINE}`;
}

/** A press of Make a new key in flight: the panel rebuilds on every state change, so the button reads this. */
let makingKey = false;

/**
 * The world's key and the two ways a new one goes in place (#198): never
 * Unlink. Make a new key is offered signed in, to a world that reads only or
 * whose sync stopped; Put in a new key always.
 */
export function worldKeyHtml(world: WorldRegistryEntry): string {
  if (!world.api) return '';
  const tail = world.api.api_key.slice(-4);
  const engine = getState().sync.byWorld[world.id];
  const offerMake = offersMakeKey(world) && (!!world.api.read_only || engine?.kind === 'error');
  // The key's kind says what it could do; a refusal sync met says what it
  // does now (S419, #198's live walk: "reads and writes" under "Sync stopped").
  const refusal = engine?.kind === 'error' ? keyRefusalFor(world.id) : undefined;
  const does = refusal === 'key_revoked' || refusal === 'key_unknown' ? ', and OnlyWorlds no longer takes it'
    : world.api.read_only || refusal === 'read_only_key' ? ' and can only read' : ' and reads and writes';
  return `<div class="atlas-settings-key" data-role="world-key">
      <p class="atlas-settings-hint" data-role="key-line">This world's key ends in ${escapeText(tail)}${does}. A new key takes its place here, and everything in the world stays as it is.</p>
      <div class="atlas-settings-actions">
        ${offerMake ? `<button class="atlas-btn-ghost" data-action="make-new-key" ${makingKey ? 'disabled' : ''} title="Atlas makes a key from your OnlyWorlds account">${makingKey ? 'Making a key…' : 'Make a new key'}</button>` : ''}
        <button class="atlas-btn-ghost" data-action="put-new-key" title="Paste a key from the world's page on onlyworlds.com">Put in a new key</button>
      </div>
    </div>`;
}

export function renderWorldTab(world: WorldRegistryEntry): string {
  const stateLabel = world.state === 'api-linked' ? 'linked' : 'local';
  // Where the world lives (1.17, conv. 129): a browser world has no folder to
  // show or keep, so Delete only (contract §3.1, §3.4); its ways out are Move
  // to a folder (Chromium) and Download the whole world (every browser). The
  // tour sandbox offers none of them (its lifecycle is the tour's, gate B12).
  const inBrowser = filesWhereOf(world) === 'browser';
  const dangerActions = world.demo === true
    ? ''
    : isBrowserWorld(world)
      ? `<div class="atlas-settings-actions">
        ${hasFolderMode() ? '<button class="atlas-btn-ghost" data-action="move-to-folder" title="Copy it into a folder on your drive, where other tools can open it, and remove it from this browser">Move to a folder</button>' : ''}
        <button class="atlas-btn-ghost" data-action="download-world">Download the whole world</button>
      </div>
      <p class="atlas-settings-hint" data-role="download-hint">One file holding the whole world: elements, pages, notes, charts and images. Atlas 1.17 or later opens it in any browser.${world.state === 'api-linked' ? ' It leaves out the OnlyWorlds link and its key, so the copy opens as a local world.' : ''}</p>
      <div class="atlas-settings-actions atlas-settings-actions-danger">
        <button class="atlas-btn-ghost" data-action="delete-browser-world" title="Remove it from Atlas and from this browser">Delete world</button>
      </div>`
      : `<div class="atlas-settings-actions atlas-settings-actions-danger">
        <button class="atlas-btn-ghost" data-action="delete-world">Forget world (keep folder)</button>
        <button class="atlas-btn-ghost" data-action="delete-world-permanent" title="Remove from atlas AND delete the world folder on disk">Delete world + folder</button>
      </div>`;
  const paused = !!world.sync_paused;
  const apiActions = world.state === 'api-linked'
    ? `
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="world-paused" ${paused ? 'checked' : ''} />
        <span>Pause sync (this world)</span>
      </label>
      <div class="atlas-settings-dangling" data-role="foreign-ids" ${lastForeignCount[world.id] ? '' : 'hidden'}>
        <p class="atlas-settings-hint" data-role="foreign-text">${escapeText(foreignLine(lastForeignCount[world.id] ?? 0))}</p>
        <button class="atlas-btn-ghost" data-action="give-new-ids">${lastForeignCount[world.id] === 1 ? 'Give it a new id' : 'Give them new ids'}</button>
      </div>
      ${isSeatWorld(world) ? `<p class="atlas-settings-hint" data-role="seat-line">${escapeText(seatLine(world))}</p>` : ''}
      ${renderSyncIssues(world)}
      ${isSeatWorld(world) ? '' : worldKeyHtml(world)}
      ${canOfferInvite(world, getState().accountWorlds.rows, inviteListLoaded()) ? inviteLineHtml(world) : ''}
      <div class="atlas-settings-actions">
        <button class="atlas-btn-ghost" data-action="refresh-from-api" ${paused ? 'disabled' : ''}>Refresh from OnlyWorlds</button>
        <button class="atlas-btn-ghost" data-action="test-connection">Test connection</button>
        <button class="atlas-btn-ghost" data-action="unlink-from-api">Unlink from OnlyWorlds</button>
      </div>`
    : world.demo === true
      ? `<p class="atlas-settings-hint">The tour world is a sandbox until you keep it at the end of the tour. Kept, it can go online.</p>`
      : `<div class="atlas-settings-dangling" data-role="dangling-links" hidden>
        <p class="atlas-settings-hint" data-role="dangling-text"></p>
        <button class="atlas-btn-ghost" data-action="remove-dangling-links">Remove those links</button>
      </div>
      <div class="atlas-settings-actions">
        <button class="atlas-btn-primary" data-action="make-online">Make online</button>
      </div>`;
  return `
    <section class="atlas-settings-section">
      <h3>Active world</h3>
      <label class="atlas-settings-field">
        <span>Name</span>
        <input class="atlas-input" type="text" name="world-name" value="${escapeAttr(world.name)}" />
      </label>
      <label class="atlas-settings-field">
        <span>Image URL</span>
        <input class="atlas-input" type="text" name="world-image-url"
          value="${escapeAttr(((getState().active?.meta ?? {}) as { image_url?: string }).image_url ?? '')}"
          placeholder="https://… (the world's cover image)" />
      </label>
      ${renderUnitFields()}
      <dl class="atlas-settings-meta">
        <dt>State</dt><dd>${stateLabel}</dd>
        ${inBrowser
          ? '<dt>Stored in</dt><dd data-role="stored-in">This browser</dd>'
          : `<dt>Folder</dt><dd><code>${escapeText(world.folder.last_path_hint ?? world.folder.folder_name)}</code>
          <button class="atlas-btn-ghost" data-action="show-folder"
            title="A web page cannot open your file explorer, so this opens the folder picker inside this world's folder. Close it when you have looked.">Show folder</button></dd>`}
        <dt>ID</dt><dd><code>${escapeText(world.id)}</code></dd>
        ${world.state === 'api-linked' && world.api
          ? `<dt>Online ID</dt><dd><code>${escapeText(world.api.world_id)}</code></dd>`
          : ''}
        ${world.state === 'api-linked' && world.api?.world_name
          ? (() => {
              const apiName = world.api.world_name!;
              const differs = apiName !== world.name;
              const hint = differs
                ? ' <span class="atlas-settings-hint-inline" title="The name here and the name on onlyworlds.com differ. Atlas never renames the online world by itself.">(differs from local)</span>'
                : '';
              return `<dt>Online name</dt><dd>${escapeText(apiName)}${hint}</dd>`;
            })()
          : ''}
      </dl>
      ${apiActions}
      <div class="atlas-settings-dangling" data-role="rekey-interrupted" hidden>
        <p class="atlas-settings-hint" data-role="rekey-interrupted-text">An id update in this world did not finish, so it is not syncing.</p>
        <button class="atlas-btn-ghost" data-action="rekey-finish">Finish it</button>
        <button class="atlas-btn-ghost" data-action="rekey-discard"
          title="Undo the update: elements that already have their new ids keep them, the rest go back to their old ids, and every link follows.">Undo it</button>
      </div>
      <div class="atlas-settings-dangling" data-role="rekey-stale" hidden>
        <p class="atlas-settings-hint" data-role="rekey-stale-text"></p>
        <button class="atlas-btn-ghost" data-action="rekey-repair">Update links</button>
      </div>
      ${dangerActions}
    </section>
  `;
}

/**
 * Invite someone (#341). Signed in, Atlas makes the link itself, as Lantern
 * does (`InviteModal`); signed out, the world's Access pane on onlyworlds.com
 * is where a link is made (1.36), and the line says signing in brings it here.
 */
/** The signed-in account's world list has come, for the token signed in now. */
function inviteListLoaded(): boolean {
  const { registry, accountWorlds } = getState();
  return !!registry.account_token && accountWorlds.status === 'ready' && accountWorlds.fetchedWithToken === registry.account_token;
}

/** One dialog per click: the click waits on a lazy import before it opens (gate L3). */
let inviteOpening = false;

function inviteLineHtml(world: WorldRegistryEntry): string {
  if (getState().registry.account_token) {
    return `<p class="atlas-settings-hint" data-role="invite-line"><button type="button" class="atlas-btn-link" data-action="invite-someone">Invite someone</button> · makes a link to send, for a contributor or a player. They need a free account.</p>`;
  }
  return `<p class="atlas-settings-hint" data-role="invite-line"><a class="atlas-settings-link atlas-link-inline" data-link="invite" href="${escapeAttr(owAccessUrl(world.api!.world_id))}" target="_blank" rel="noopener">Invite someone</a> · opens this world on onlyworlds.com at Access, where you make an invite link to send. Your friend needs a free account. Signed in with your account token, Atlas makes the link here.</p>`;
}

export function wireWorldTab(world: WorldRegistryEntry, toasts: ToastManager): void {
  document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="put-new-key"]')
    ?.addEventListener('click', () => {
      void import('../ui/world-key-modal').then(({ NewKeyModal }) => new NewKeyModal(world, toasts).open());
    });
  document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="make-new-key"]')
    ?.addEventListener('click', async () => {
      if (makingKey) return;
      const refusal = keyRefusalFor(world.id);
      // A refused PIN is not the key's: a new key would meet the same answer.
      if (refusal === 'pin') { toasts.error(keyRefusalHere('pin')); return; }
      makingKey = true;
      patchSlice('registry', { ...getState().registry }); // repaint the button as busy
      try {
        const entry = getState().registry.worlds.find(w => w.id === world.id) ?? world;
        const outcome = await makeNewWorldKey(entry, { keyDead: newKeyCures(refusal), cause: refusal });
        if (outcome.kind === 'swapped') toasts.success(outcome.line);
        else if (outcome.kind === 'gone' || outcome.kind === 'not-on-account') toasts.error(outcome.line);
        else if (outcome.kind === 'kept') toasts.info(outcome.line, 12_000);
        else if (outcome.kind === 'failed') {
          if (outcome.error) showProblem(outcome.error, { doing: 'making a new key', worldId: world.id, toasts });
          else toasts.error('Atlas could not reach your OnlyWorlds account to make a key. Try again, or put in a key from the world\'s page on onlyworlds.com.');
        }
      } finally {
        makingKey = false;
        patchSlice('registry', { ...getState().registry });
      }
    });
  document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="invite-someone"]')
    ?.addEventListener('click', async () => {
      const token = getState().registry.account_token;
      const worldId = world.api?.world_id;
      if (!token || !worldId || inviteOpening) return;
      inviteOpening = true;
      try {
        const { InviteModal } = await import('../ui/invite-modal');
        new InviteModal(toasts, token, worldId, world.name).open();
      } finally {
        inviteOpening = false;
      }
    });

  // "Open the folder in Explorer" (Captain, S360): a web page cannot open an
  // OS folder or learn its full path. The nearest real thing is the system
  // folder picker opened INSIDE the world folder; whatever the user picks is
  // ignored (S361).
  document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="show-folder"]')
    ?.addEventListener('click', async () => {
      const handle = await loadHandle(world.folder.handle_key).catch(() => undefined);
      const picker = (window as unknown as { showDirectoryPicker?: (o: unknown) => Promise<unknown> }).showDirectoryPicker;
      if (!handle || !picker) { toasts.info('This browser cannot show the folder. Its name is shown beside the button'); return; }
      try {
        await picker({ startIn: handle, id: 'atlas-show-folder' });
      } catch { /* closed: nothing to do */ }
    });

  wireDanglingLinks(toasts);
  void wireForeignIds(world, toasts);
  wireSyncIssues(world, toasts);

  const nameInput = document.querySelector<HTMLInputElement>('.atlas-settings input[name="world-name"]');
  nameInput?.addEventListener('change', () => {
    const v = nameInput.value.trim();
    if (!v) { nameInput.value = world.name; return; }
    const next = renameWorld(getState().registry, world.id, v);
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info('Renamed');
  });

  // World image URL (Captain, S311): the ONE meta field with no edit surface
  // anywhere in the ecosystem right now. Persists like the home page's
  // description edit — writeWorldMeta + the active.meta mirror — and rides the
  // world-meta sync (image_url is one of the eight synced fields; the ≤1024
  // wire guard is checked here so the failure is a field error, not a sync one).
  const imageInput = document.querySelector<HTMLInputElement>('.atlas-settings input[name="world-image-url"]');
  imageInput?.addEventListener('change', () => {
    void (async () => {
      const v = imageInput.value.trim();
      if (v.length > 1024) { toasts.error('Image URL is too long (max 1024 characters)'); return; }
      const store = getActiveStore();
      const active = getState().active;
      if (!store || !active) { toasts.error('This world is not open. Open it from the sidebar, then try again.'); return; }
      try {
        await store.writeWorldMeta({ image_url: v });
        patchSlice('active', { ...active, meta: { ...active.meta, image_url: v } });
        requestPushIfLinked();
        toasts.info(v ? 'World image saved' : 'World image cleared');
      } catch (err) {
        console.error('[settings] world image save failed:', err);
        showProblem(err, { doing: 'saving the world image', worldId: world.id, toasts });
      }
    })();
  });

  wireUnitFields(world, toasts);

  const pausedInput = document.querySelector<HTMLInputElement>('.atlas-settings input[name="world-paused"]');
  pausedInput?.addEventListener('change', () => {
    const next = setWorldPaused(getState().registry, world.id, pausedInput.checked);
    saveRegistry(next);
    patchSlice('registry', next);
    // The engine follows the EFFECTIVE pause: unticking this must not resume
    // a world "Pause all sync" keeps offline (S367 critic C7, same predicate
    // as the sidebar and Settings, Sync).
    const stillPaused = effectiveSyncPaused(next.worlds.find(w => w.id === world.id), next);
    const engine = getCurrentSyncWorldId() === world.id ? getCurrentSyncEngine() : null;
    if (engine) {
      if (stillPaused) engine.pause('manual');
      else engine.resume();
    }
    toasts.info(pausedInput.checked
      ? 'Sync paused for this world'
      : stillPaused ? 'This world will sync when Pause all sync is turned off' : 'Sync resumed for this world');
  });

  const refreshBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="refresh-from-api"]');
  refreshBtn?.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    try {
      const result = await pullNowAndRefresh();
      if (!result) { surfaceSyncUnavailable(toasts); return; }
      // pullNowAndRefresh says what came down (the counts, or the conflicts'
      // own toasts): only the nothing-came case is said here, or a refresh
      // says it twice (S411, the journey scout's gap C).
      if (upToDate(result)) toasts.success('Already up to date');
    } catch (err) {
      console.warn('[settings-world] refresh failed:', err);
      showProblem(err, {
        doing: 'refreshing from OnlyWorlds', savedLocally: true, worldId: world.id, toasts,
        retry: () => {
          if (world.id !== getCurrentSyncWorldId()) return;
          void pullNowAndRefresh().catch(e2 => showProblem(e2, { doing: 'refreshing from OnlyWorlds', savedLocally: true, worldId: world.id, toasts }));
        },
      });
    } finally {
      refreshBtn.disabled = false;
    }
  });

  const testBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="test-connection"]');
  testBtn?.addEventListener('click', async () => {
    if (!world.api) return;
    const pin = worldPin(world, getState().registry);
    if (!pin) { toasts.error(isSeatWorld(world) ? SEAT_SECRET_MISSING_LINE : 'Set your PIN on the OnlyWorlds tab first.'); return; }
    testBtn.disabled = true;
    try {
      // Test Connection via v2 GET /world (live 2026-07-12); buildV2Adapter
      // applies any dev/staging origin override.
      const client = buildV2Adapter(world.api.api_key, pin);
      const fetched = await client.getWorld();
      const liveName: string | undefined = fetched?.name;
      // If the server name differs from what we cached at link time, refresh
      // both the registry's api.world_name AND world.json so the Settings →
      // World tab reflects the live state immediately. The local entry name
      // is NOT touched — those are intentionally separate identities.
      const cachedName = world.api.world_name;
      if (liveName && liveName !== cachedName) {
        const next = setApiWorldName(getState().registry, world.id, liveName);
        saveRegistry(next);
        patchSlice('registry', next);
        const folder = getActiveStore();
        if (folder) {
          try {
            await folder.writeWorldMeta({
              api: diskApiBlock(world.api, { world_name: liveName }),
            });
          } catch (err) {
            console.warn('[settings] persist api.world_name to world.json failed:', err);
          }
        }
        toasts.success(`The key works. Online name is "${liveName}"${cachedName ? ` (was "${cachedName}")` : ''}`);
      } else {
        toasts.success(`The key works: ${liveName ?? 'world'}`);
      }
    } catch (err) {
      // Branch on the TYPED code, not on the status number. A revoked key and
      // a wrong PIN are both 401, and telling someone to check their PIN when
      // their key was revoked sends them to a control that cannot fix it. The
      // engine has distinguished these for a while (sync-engine noteAuthBail);
      // "test connection" was still giving one answer for three causes (S323).
      const code = (err as { code?: string } | null)?.code;
      const status = (err as { status?: number } | null)?.status;
      const refusal = keyRefusalOf(err);
      if (isSeatWorld(world) && (code === 'invalid_credentials' || status === 401)) {
        toasts.error(seatRefusalLine(refusal, { paused: false }));
      } else if (refusal) {
        // The cause keel named, and the fix in this tab (#198): never Unlink.
        toasts.error(keyRefusalHere(refusal));
      } else if (status === 401 || status === 403) {
        toasts.error(keyRefusalHere(null));
      } else if (status === 404) {
        toasts.error('OnlyWorlds has no world for this key. It may have been deleted there.');
      } else {
        showProblem(err, { doing: 'testing the connection', worldId: world.id, toasts });
      }
    } finally {
      testBtn.disabled = false;
    }
  });

  const unlinkBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="unlink-from-api"]');
  unlinkBtn?.addEventListener('click', async () => {
    // Count local elements so the dialog can be specific about what stays.
    let elementCount = 0;
    try {
      const store = getActiveStore();
      if (store) {
        const all = await store.listElements();
        elementCount = all.length;
      }
    } catch {
      // Best-effort; missing count just means the dialog is less specific.
    }
    const lines = [
      `Unlink "${world.name}" from OnlyWorlds?`,
      '',
      `WHAT HAPPENS:`,
      filesWhereOf(world) === 'browser'
        ? `  • The world${elementCount > 0 ? ` (${elementCount} element${elementCount === 1 ? '' : 's'})` : ''} stays in this browser`
        : `  • Local folder${elementCount > 0 ? ` (${elementCount} element${elementCount === 1 ? '' : 's'})` : ''} stays exactly where it is`,
      `  • Sync stops immediately: no more push or pull`,
      `  • Deletes not yet sent to onlyworlds.com are dropped`,
      `  • The world on onlyworlds.com is NOT deleted`,
      ...(isSeatWorld(world) ? [`  • Its seat stays on onlyworlds.com until it is removed there, ${SEAT_REMOVE_WHERE}`] : []),
      '',
      `REVERSIBLE: you can link it again with Make online.`,
      '',
      `Continue?`,
    ];
    const ok = window.confirm(lines.join('\n'));
    if (!ok) return;
    // Order matters:
    //   1. Detach the engine FIRST so no in-flight sync round mutates files
    //      while we're clearing baselines underneath it.
    //   2. Sever the sync history on disk — strip server_updated_at on every
    //      element, drop tombstones, reset sync-state, strip world.json.api.
    //      Without this, lingering server_updated_at stamps from the old api
    //      world make a future Make-Online Route 1 treat them as UPDATEs
    //      against the new world (all 404 → routed to server_deletes →
    //      "world is online but empty").
    //   3. Update the registry. The world flips to local-only with no api block.
    detachSyncEngine();
    clearSyncIssues(world.id);
    const folder = getActiveStore();
    if (folder) {
      try {
        await folder.resetSyncBaseline();
      } catch (err) {
        // Don't block the unlink on a disk-write hiccup — the registry update
        // still proceeds, but warn loudly so the next Make-Online doesn't
        // silently produce an empty world.
        console.warn('[unlink] resetSyncBaseline failed:', err);
        toasts.error('The world is unlinked, but Atlas could not clear its old sync record in this world. Before taking it online again, reload the page; if Make online then shows an empty world, tell us at onlyworlds.com/feedback.');
      }
    }
    const next = detachApi(getState().registry, world.id);
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.success(`Unlinked ${world.name}`);
  });

  const makeOnlineBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="make-online"]');
  makeOnlineBtn?.addEventListener('click', () => new MakeOnlineModal(toasts).open());

  const deleteBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="delete-world"]');
  deleteBtn?.addEventListener('click', async () => {
    const ok = window.confirm(
      `Remove "${world.name}" from atlas?\n\n` +
      `The folder on disk is NOT deleted; atlas just forgets about it. You can re-open the folder anytime to recover.`
    );
    if (!ok) return;
    const store = getActiveStore();
    if (store) await store.close().catch(() => {});
    setActiveStore(null);
    evictParkedStore(world.id);
    const next = deleteWorldEntry(getState().registry, world.id);
    saveRegistry(next);
    await deleteHandle(world.folder.handle_key).catch(() => {});
    patchSlice('registry', next);
    patchSlice('active', null);
    patchSlice('data', { elements: [] });
    patchSlice('ui', { ...getState().ui, selectedElementId: null });
    toasts.success(`Forgot ${world.name}`);
    navigate('#/');
  });

  const downloadBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="download-world"]');
  downloadBtn?.addEventListener('click', async () => {
    // The save picker opens inside this click (static import: no chunk wait).
    await downloadWorldFromClick(world, toasts, on => {
      downloadBtn.disabled = on;
      downloadBtn.textContent = on ? 'Saving…' : 'Download the whole world';
    });
  });
  document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="move-to-folder"]')
    ?.addEventListener('click', async () => {
      const { MoveBrowserWorldModal } = await import('../ui/move-browser-world-modal');
      new MoveBrowserWorldModal(world, toasts).open();
    });
  document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="delete-browser-world"]')
    ?.addEventListener('click', async () => {
      const { DeleteBrowserWorldModal } = await import('../ui/delete-browser-world-modal');
      new DeleteBrowserWorldModal(world, toasts).open();
    });

  const deletePermBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="delete-world-permanent"]');
  deletePermBtn?.addEventListener('click', async () => {
    const ok = window.confirm(
      `Permanently delete "${world.name}" and its folder on disk?\n\n` +
      `Everything in it (elements, maps, media) is gone for good.` +
      `${world.state === 'api-linked' ? ' The world on onlyworlds.com stays.' : ''}\n\n` +
      `There is no undo.`
    );
    if (!ok) return;
    deletePermBtn.disabled = true;
    // Asked BEFORE anything closes: a refusal must leave the world open and
    // working (S365 gate lens B F1).
    const refusal = await whyWorldFolderNotDeletable(world);
    if (refusal) {
      toasts.error(refusal);
      deletePermBtn.disabled = false;
      return;
    }
    try {
      const store = getActiveStore();
      if (store) await store.close().catch(() => {});
      setActiveStore(null);
      evictParkedStore(world.id);
      // Detach any sync engine for this world before destroying its folder.
      detachSyncEngine();
      // Delete the on-disk folder first (we still have a working handle).
      await deleteWorldFolderUnderRoot(world);
      // Now drop registry + handle.
      const next = deleteWorldEntry(getState().registry, world.id);
      saveRegistry(next);
      await deleteHandle(world.folder.handle_key).catch(() => {});
      patchSlice('registry', next);
      patchSlice('active', null);
      patchSlice('data', { elements: [] });
      patchSlice('ui', { ...getState().ui, selectedElementId: null });
      toasts.success(`Deleted ${world.name} permanently`);
      navigate('#/');
    } catch (err) {
      console.error('[settings] delete world + folder failed:', err);
      showProblem(err, { doing: 'deleting the world folder', worldId: world.id, toasts });
      deletePermBtn.disabled = false;
    }
  });
}

/**
 * Elements OnlyWorlds refused because their ids already live in another
 * world (S363): a copied or imported folder, a world taken online twice. Only
 * new ids fix that, so this is where they are offered; and an id update that
 * did not finish is finished (or discarded) from here too.
 */
/** The last count seen per world: Settings re-renders on every state change,
 *  and a row that starts hidden and appears after two awaits blinks each time
 *  (gate lens C F4). The row renders from this, then refreshes. */
const lastForeignCount: Record<string, number> = {};

function foreignLine(n: number): string {
  return n === 1
    ? '1 element could not upload: its id belongs to another OnlyWorlds world.'
    : `${n} elements could not upload: their ids belong to another OnlyWorlds world.`;
}

async function wireForeignIds(world: WorldRegistryEntry, toasts: ToastManager): Promise<void> {
  const box = document.querySelector<HTMLElement>('.atlas-settings [data-role="foreign-ids"]');
  const text = box?.querySelector<HTMLElement>('[data-role="foreign-text"]');
  const btn = box?.querySelector<HTMLButtonElement>('[data-action="give-new-ids"]');
  const stuck = document.querySelector<HTMLElement>('.atlas-settings [data-role="rekey-interrupted"]');
  const stale = document.querySelector<HTMLElement>('.atlas-settings [data-role="rekey-stale"]');
  const staleText = stale?.querySelector<HTMLElement>('[data-role="rekey-stale-text"]');
  const store = getActiveStore();
  // The interrupted and stale rows live outside the api-linked branch: a crash
  // then an unlink must still leave a way to finish or undo (gate lens C F10).
  if (!stuck || !stale || !staleText || !store) return;
  const rk = await import('../sync/rekey-run');

  let count = lastForeignCount[world.id] ?? 0;
  let stuckIsMerge = false;
  const show = async (): Promise<void> => {
    // A run in progress writes the journal: that is not "did not finish".
    const interrupted = !rk.isRekeyRunning() && await store.hasRekeyJournal().catch(() => false);
    if (interrupted) {
      // A Route 2 link that stopped mid-way (S367): the world is local-only,
      // so "not syncing" is not the news; what to do next is. The words are
      // set BEFORE the row shows, so the re-key copy never flashes (gate B10).
      const { rekeyJournalOrigin } = await import('../store/rekey');
      stuckIsMerge = (await rekeyJournalOrigin(store)) === 'merge';
      const line = stuck.querySelector<HTMLElement>('[data-role="rekey-interrupted-text"]');
      if (line) {
        line.textContent = stuckIsMerge
          ? 'Linking this world to OnlyWorlds did not finish. Finish it, then run Make online again with the same key.'
          : 'An id update in this world did not finish, so it is not syncing.';
      }
    }
    stuck.hidden = !interrupted;
    const staleN = interrupted ? 0 : await rk.staleLinkCount(store).catch(() => 0);
    stale.hidden = staleN === 0;
    staleText.textContent = staleN === 1
      ? '1 element still links to an old id: its file could not be read when the ids changed.'
      : `${staleN} elements still link to old ids: their files could not be read when the ids changed.`;
    if (!box || !text || !btn) return;
    count = interrupted ? 0 : (await rk.foreignIdsFor(store, world).catch(() => [])).length;
    lastForeignCount[world.id] = count;
    box.hidden = count === 0;
    text.textContent = foreignLine(count);
    btn.textContent = count === 1 ? 'Give it a new id' : 'Give them new ids';
  };
  await show();
  // An id move that ends (a Route 2 run behind the Make online modal, a
  // re-key) re-reads the rows: the render that happened DURING the run saw
  // the journal as "running", not "did not finish" (S367 gate B3). The
  // listener retires itself once this tab's markup is gone.
  const onSettled = (): void => {
    if (!document.contains(stuck)) { window.removeEventListener(rk.ID_MOVE_SETTLED_EVENT, onSettled); return; }
    void show();
  };
  window.addEventListener(rk.ID_MOVE_SETTLED_EVENT, onSettled);

  btn?.addEventListener('click', async () => {
    btn.disabled = true; // a second click during the chunk load stacked two modals (lens C F6)
    try {
      const { RekeyModal } = await import('../ui/rekey-modal');
      await new RekeyModal(toasts, world, store, count).open();
    } finally {
      btn.disabled = false;
      await show();
    }
  });
  const refused = (err: unknown): string | null =>
    err instanceof Error && err.name === 'RekeyRefusedError' ? err.message : null;
  stuck.querySelector<HTMLButtonElement>('[data-action="rekey-finish"]')?.addEventListener('click', async () => {
    try {
      const done = await rk.finishInterruptedRekey(store, world.id);
      const n = done?.map.size ?? 0;
      toasts.success(n === 0 ? 'Nothing was left to finish.'
        : done?.origin === 'merge' ? `Finished matching ${n === 1 ? '1 element' : `${n} elements`} to OnlyWorlds. Run Make online again with the same key to link.`
        : n === 1 ? 'Finished giving 1 element a new id.' : `Finished giving ${n} elements new ids.`);
    } catch (err) {
      console.error('[settings] finishing the re-key failed:', err);
      toasts.error(refused(err) ?? (stuckIsMerge
        ? 'Linking still could not finish. Nothing was lost; try Finish it again, or Undo it.'
        : 'The id update still could not finish. Nothing was lost; try Finish it again, or Undo it.'));
    }
    await show();
  });
  stuck.querySelector<HTMLButtonElement>('[data-action="rekey-discard"]')?.addEventListener('click', async () => {
    if (!window.confirm('Undo the unfinished id update? Elements that already have their new ids keep them; the rest go back to their old ids, and every link follows.')) return;
    try {
      const r = await rk.discardInterruptedRekey(store, world.id);
      toasts.info(r && r.restored > 0
        ? `${r.restored === 1 ? '1 element is' : `${r.restored} elements are`} back on ${r.restored === 1 ? 'its old id' : 'their old ids'}.`
        : 'Id update undone.');
    } catch (err) {
      if (refused(err)) { toasts.error(refused(err)!); await show(); return; }
      // The record itself will not parse: there is no map to undo with.
      console.error('[settings] undoing the re-key failed:', err);
      if (window.confirm('The record of this id update is damaged, so it cannot be undone or finished. Forget it and let the world sync again? Any element that exists twice (old and new) stays, and you can delete the one you do not want.')) {
        await rk.discardInterruptedRekey(store, world.id, { forget: true });
        await refreshElementsAfterWrite(store);
        toasts.info('Id update forgotten');
      }
    }
    await show();
  });
  stale.querySelector<HTMLButtonElement>('[data-action="rekey-repair"]')?.addEventListener('click', async () => {
    try {
      const fixed = await rk.repairStaleLinks(store);
      requestPushIfLinked();
      toasts.success(fixed.length === 1 ? 'Updated the links in 1 element.' : `Updated the links in ${fixed.length} elements.`);
    } catch (err) {
      console.error('[settings] updating stale links failed:', err);
      if (refused(err)) toasts.error(refused(err)!);
      else showProblem(err, { doing: 'updating the links', toasts });
    }
    await show();
  });
}

// ---------------------------------------------------------------------------
// Sync issues (S369): the elements still not syncing, why, and what to do.
// The list is `sync/sync-issues.ts`, rebuilt by every round; this tab is the
// place a failure toast, the pill's ⚠ badge and an errored pill all lead to.
// ---------------------------------------------------------------------------

const ISSUE_ROWS_SHOWN = 50;

/**
 * One plain line per issue. Matches only text Atlas itself writes, never
 * server text. Place words follow where the world keeps its files (1.17).
 */
export function syncIssueLine(issue: SyncIssue, where: 'folder' | 'browser' = 'folder'): string {
  const f = issue.failure;
  const inBrowser = where === 'browser';
  switch (issue.kind) {
    case 'foreign_id':
      return 'Its id belongs to another OnlyWorlds world. Give it a new id above.';
    case 'too_large':
      return 'It holds more than 64 KB of custom fields, more than OnlyWorlds accepts. Shorten one to let it sync.';
    case 'not_yours':
      return issue.type === 'world'
        ? `Only the world's owner can change its details on OnlyWorlds. Your change stays ${inBrowser ? 'in this browser' : 'in the folder'}.`
        : `Someone else made it, and this world lets Atlas change only what it made. Your change stays ${inBrowser ? 'in this browser' : 'in the folder'}.`;
    case 'file_busy':
      if (inBrowser) {
        return f.operation === 'read'
          ? 'Its newer copy from OnlyWorlds could not be saved: another Atlas tab was saving to this world. Try again now, or refresh later.'
          : 'Another Atlas tab was saving to this world. Atlas tries again by itself.';
      }
      return f.operation === 'read'
        ? 'Its newer copy from OnlyWorlds could not be saved: another program was using its file in the folder. Try again now, or refresh later.'
        : 'Another program was using its file in the folder. Atlas tries again by itself.';
    case 'other':
    default: {
      const m = f.message ?? '';
      if (/^waits for an element OnlyWorlds refused/.test(m) || /^rolled back by failing peers/.test(m)) {
        return 'It links to an element OnlyWorlds refused, so it waits for that one.';
      }
      if (/^referenced \w+ (was deleted|not found)/.test(m)) {
        return 'It links to something that is no longer on OnlyWorlds.';
      }
      if (f.source === 'disk') return `OnlyWorlds has it, but Atlas could not note that ${inBrowser ? 'in this browser' : 'in the folder'}. Atlas tries again by itself.`;
      if (typeof f.status === 'number' && f.status >= 500) return 'OnlyWorlds had a problem on its side. Atlas tries again with your next save.';
      if (typeof f.status === 'number' && f.status >= 400) {
        const field = f.param && /^[a-z][a-z0-9_]*$/.test(f.param) && !/^(x|shadow)_/.test(f.param)
          ? ` The problem is in its ${f.param.replace(/_/g, ' ')} field.` : '';
        return `OnlyWorlds did not accept it.${field} Open it to check, or copy the details to report it.`;
      }
      return 'It could not sync. Atlas tries again with your next save; copy the details if it keeps happening.';
    }
  }
}

function issueName(issue: SyncIssue): string {
  if (issue.type === 'world') return 'This world\'s details';
  const el = getState().data.elements.find(e => e.id === issue.element_id);
  if (!el) return issue.operation === 'delete' ? `A deleted ${issue.type}` : `A ${issue.type}`;
  return el.name?.trim() || `An unnamed ${issue.type}`;
}

function renderSyncIssues(world: WorldRegistryEntry): string {
  const issues = issuesFor(world.id);
  const engine = getState().sync.byWorld[world.id];
  const stopped = engine?.kind === 'error' ? engine.message : '';
  if (issues.length === 0 && !stopped) return '<div data-role="sync-issues" hidden></div>';
  const rows = issues.slice(0, ISSUE_ROWS_SHOWN).map(i => `
    <li class="atlas-settings-issue" data-issue-id="${escapeAttr(i.element_id)}">
      ${i.type === 'world' || !getState().data.elements.some(e => e.id === i.element_id)
        ? `<span class="atlas-settings-issue-name">${escapeText(issueName(i))}</span>`
        : `<button class="atlas-link-btn atlas-settings-issue-name" data-action="open-issue">${escapeText(issueName(i))}</button>`}
      <span class="atlas-settings-issue-line">${escapeText(syncIssueLine(i, filesWhereOf(world)))}</span>
      ${i.kind === 'other' ? '<button class="atlas-btn-ghost atlas-btn-small" data-action="copy-issue">Copy details</button>' : ''}
    </li>`).join('');
  const more = issues.length > ISSUE_ROWS_SHOWN ? `<p class="atlas-settings-hint">And ${issues.length - ISSUE_ROWS_SHOWN} more.</p>` : '';
  // The engine's own sentence, as written; one full stop at the end (gate B L2).
  const stoppedLine = stopped
    ? `<p class="atlas-settings-hint" data-role="sync-stopped">Sync stopped: ${escapeText(stopped.replace(/\.?\s*$/, '.'))}</p>`
    : '';
  return `
    <div class="atlas-settings-sync-issues" data-role="sync-issues">
      <h4>${issues.length > 0 ? `Not syncing (${issues.length})` : 'Not syncing'}</h4>
      ${stoppedLine}
      ${issues.length > 0 ? `<ul class="atlas-settings-issue-list">${rows}</ul>${more}` : ''}
      ${issues.length > 0 ? '<div class="atlas-settings-actions"><button class="atlas-btn-ghost" data-action="retry-sync-issues">Retry now</button></div>' : ''}
    </div>`;
}

function wireSyncIssues(world: WorldRegistryEntry, toasts: ToastManager): void {
  const box = document.querySelector<HTMLElement>('.atlas-settings [data-role="sync-issues"]');
  if (!box || box.hidden) return;
  box.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('[data-issue-id]');
    const id = row?.dataset.issueId;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'open-issue' && id) {
      navigate(elementHash(world.id, id));
    } else if (action === 'copy-issue' && id) {
      const issue = issuesFor(world.id).find(i => i.element_id === id);
      if (!issue) return;
      void navigator.clipboard?.writeText(buildFailureDetails([issue.failure], detailsContext()))
        .then(() => toasts.info('Details copied'), () => toasts.info('The browser did not allow copying here.'));
    } else if (action === 'retry-sync-issues') {
      const engine = getCurrentSyncWorldId() === world.id ? getCurrentSyncEngine() : null;
      if (!engine) { surfaceSyncUnavailable(toasts); return; }
      void engine.syncNow().catch(err => showProblem(err, { doing: 'syncing with OnlyWorlds', savedLocally: true, worldId: world.id, toasts }));
    }
  });
}

/**
 * Links that point at elements no longer in this LOCAL world (S362): left by
 * deletes from before Atlas removed links on delete, or by importing part of
 * an export. keel refuses an element whose link names nothing, so these
 * elements would never upload. Offered only on a local world, where absent
 * means gone; in a linked world an absent id can simply not be downloaded yet.
 */
function wireDanglingLinks(toasts: ToastManager): void {
  const box = document.querySelector<HTMLElement>('.atlas-settings [data-role="dangling-links"]');
  const text = box?.querySelector<HTMLElement>('[data-role="dangling-text"]');
  const btn = box?.querySelector<HTMLButtonElement>('[data-action="remove-dangling-links"]');
  if (!box || !text || !btn) return;
  const show = (): void => {
    const dangling = findDanglingLinks(getState().data.elements);
    const elements = new Set(dangling.map(d => d.elementId)).size;
    box.hidden = dangling.length === 0;
    text.textContent = `${elements} ${elements === 1 ? 'element links' : 'elements link'} to something no longer in this world. OnlyWorlds refuses those elements when the world goes online.`;
  };
  show();
  btn.addEventListener('click', async () => {
    const store = getActiveStore();
    if (!store) { toasts.error('This world is not open. Open it from the sidebar, then try again.'); return; }
    const missing = new Set(findDanglingLinks(getState().data.elements).map(d => d.missingId));
    btn.disabled = true;
    try {
      const changed = await scrubReferrers(store, missing);
      await refreshElementsAfterWrite(store);
      toasts.success(`Removed the broken links from ${changed.length} ${changed.length === 1 ? 'element' : 'elements'}`);
    } catch (err) {
      console.error('[settings] remove dangling links failed:', err);
      showProblem(err, { doing: 'removing the broken links', toasts });
    } finally {
      btn.disabled = false;
      show();
    }
  });
}
