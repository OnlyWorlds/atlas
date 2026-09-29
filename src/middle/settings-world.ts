/**
 * Settings → World tab (extracted from settings-panel session 233). Per-active-
 * world controls: rename, state/folder/id metadata, stay-offline, refresh/test/
 * unlink (api-linked) or make-online (local-only), and the two delete flows
 * (forget = keep folder; delete = remove folder on disk).
 */

import { getState, patchSlice } from '../core/state';
import {
  saveRegistry,
  deleteWorldEntry,
  detachApi,
  renameWorld,
  setApiWorldName,
  setWorldPaused,
} from '../registry/registry';
import { deleteHandle, loadHandle } from '../store/handle-vault';
import { getActiveStore, setActiveStore, evictParkedStore } from '../core/active-store';
import { deleteWorldFolderUnderRoot } from '../setup/atlas-root-flow';
import { MakeOnlineModal } from '../ui/make-online-modal';
import { ToastManager } from '../ui/toast-manager';
import { surfaceSyncUnavailable } from '../ui/sync-toasts';
import { navigate } from '../core/router';
import {
  detachSyncEngine,
  getCurrentSyncEngine,
  pullNowAndRefresh,
  refreshElementsAfterWrite,
  requestPushIfLinked,
} from '../sync/sync-attach';
import { buildV2Adapter } from '../sync/make-online';
import type { WorldRegistryEntry } from '../core/types';
import { escapeText, escapeAttr } from '../core/dom-utils';
import { findDanglingLinks, scrubReferrers } from '../store/scrub-links';

export function renderWorldTab(world: WorldRegistryEntry): string {
  const stateLabel = world.state === 'api-linked' ? 'api-linked' : 'local-only';
  const paused = !!world.sync_paused;
  const apiActions = world.state === 'api-linked'
    ? `
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="world-paused" ${paused ? 'checked' : ''} />
        <span>Stay offline (per-world)</span>
      </label>
      <div class="atlas-settings-dangling" data-role="foreign-ids" ${lastForeignCount[world.id] ? '' : 'hidden'}>
        <p class="atlas-settings-hint" data-role="foreign-text">${escapeText(foreignLine(lastForeignCount[world.id] ?? 0))}</p>
        <button class="atlas-btn-ghost" data-action="give-new-ids">${lastForeignCount[world.id] === 1 ? 'Give it a new id' : 'Give them new ids'}</button>
      </div>
      <div class="atlas-settings-actions">
        <button class="atlas-btn-ghost" data-action="refresh-from-api" ${paused ? 'disabled' : ''}>Refresh from API</button>
        <button class="atlas-btn-ghost" data-action="test-connection">Test connection</button>
        <button class="atlas-btn-ghost" data-action="unlink-from-api">Unlink from API</button>
      </div>`
    : world.demo === true
      ? `<p class="atlas-settings-hint">The tour world is a sandbox and is removed when the tour ends, so it cannot go online. Create your own world for that.</p>`
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
      <dl class="atlas-settings-meta">
        <dt>State</dt><dd>${stateLabel}</dd>
        <dt>Folder</dt><dd><code>${escapeText(world.folder.last_path_hint ?? world.folder.folder_name)}</code>
          <button class="atlas-btn-ghost" data-action="show-folder"
            title="A web page cannot open your file explorer, so this opens the folder picker inside this world's folder. Close it when you have looked.">Show folder</button></dd>
        <dt>ID</dt><dd><code>${escapeText(world.id)}</code></dd>
        ${world.state === 'api-linked' && world.api
          ? `<dt>API world ID</dt><dd><code>${escapeText(world.api.world_id)}</code></dd>`
          : ''}
        ${world.state === 'api-linked' && world.api?.world_name
          ? (() => {
              const apiName = world.api.world_name!;
              const differs = apiName !== world.name;
              const hint = differs
                ? ' <span class="atlas-settings-hint-inline" title="Local name and server-side name diverged. Atlas never renames the server world automatically.">(differs from local)</span>'
                : '';
              return `<dt>Name on API</dt><dd>${escapeText(apiName)}${hint}</dd>`;
            })()
          : ''}
      </dl>
      ${apiActions}
      <div class="atlas-settings-dangling" data-role="rekey-interrupted" hidden>
        <p class="atlas-settings-hint">An id update in this world did not finish, so it is not syncing.</p>
        <button class="atlas-btn-ghost" data-action="rekey-finish">Finish it</button>
        <button class="atlas-btn-ghost" data-action="rekey-discard"
          title="Undo the update: elements that already have their new ids keep them, the rest go back to their old ids, and every link follows.">Undo it</button>
      </div>
      <div class="atlas-settings-dangling" data-role="rekey-stale" hidden>
        <p class="atlas-settings-hint" data-role="rekey-stale-text"></p>
        <button class="atlas-btn-ghost" data-action="rekey-repair">Update links</button>
      </div>
      <div class="atlas-settings-actions atlas-settings-actions-danger">
        <button class="atlas-btn-ghost" data-action="delete-world">Forget world (keep folder)</button>
        <button class="atlas-btn-ghost" data-action="delete-world-permanent" title="Remove from atlas AND delete the world folder on disk">Delete world + folder</button>
      </div>
    </section>
  `;
}

export function wireWorldTab(world: WorldRegistryEntry, toasts: ToastManager): void {
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
      if (!store || !active) { toasts.error('No active world'); return; }
      try {
        await store.writeWorldMeta({ image_url: v });
        patchSlice('active', { ...active, meta: { ...active.meta, image_url: v } });
        requestPushIfLinked();
        toasts.info(v ? 'World image saved' : 'World image cleared');
      } catch (err) {
        console.error('[settings] world image save failed:', err);
        toasts.error('Failed to save world image');
      }
    })();
  });

  const pausedInput = document.querySelector<HTMLInputElement>('.atlas-settings input[name="world-paused"]');
  pausedInput?.addEventListener('change', () => {
    const next = setWorldPaused(getState().registry, world.id, pausedInput.checked);
    saveRegistry(next);
    patchSlice('registry', next);
    const engine = getCurrentSyncEngine();
    if (engine) {
      if (pausedInput.checked) engine.pause('manual');
      else engine.resume();
    }
    toasts.info(pausedInput.checked ? 'This world set to offline' : 'Sync resumed for this world');
  });

  const refreshBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="refresh-from-api"]');
  refreshBtn?.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    try {
      const result = await pullNowAndRefresh();
      if (!result) { surfaceSyncUnavailable(toasts); return; }
      const elementTotal = result.pulled.creates + result.pulled.updates;
      const metaTotal = result.meta_pulled?.length ?? 0;
      // Meta-only pulls already toast "Pulled world settings from API" in
      // pullNowAndRefresh — stay quiet here rather than double-toasting.
      if (elementTotal + metaTotal === 0) toasts.success('Already up to date');
      else if (elementTotal > 0) toasts.success(`Pulled ${result.pulled.creates} new + ${result.pulled.updates} updated`);
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : String(err));
    } finally {
      refreshBtn.disabled = false;
    }
  });

  const testBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="test-connection"]');
  testBtn?.addEventListener('click', async () => {
    if (!world.api) return;
    const pin = getState().registry.pin;
    if (!pin) { toasts.error('Set your PIN first'); return; }
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
              api: { world_id: world.api.world_id, api_key: world.api.api_key, world_name: liveName },
            });
          } catch (err) {
            console.warn('[settings] persist api.world_name to world.json failed:', err);
          }
        }
        toasts.success(`Connected. Name on API is "${liveName}"${cachedName ? ` (was "${cachedName}")` : ''}`);
      } else {
        toasts.success(`Connected: ${liveName ?? 'world'}`);
      }
    } catch (err) {
      // Branch on the TYPED code, not on the status number. A revoked key and
      // a wrong PIN are both 401, and telling someone to check their PIN when
      // their key was revoked sends them to a control that cannot fix it. The
      // engine has distinguished these for a while (sync-engine noteAuthBail);
      // "test connection" was still giving one answer for three causes (S323).
      const code = (err as { code?: string } | null)?.code;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === 'key_revoked') {
        toasts.error('This world\'s access key was revoked. Unlink it here, then reopen it from the sidebar to get a new key.');
      } else if (code === 'permission_error') {
        toasts.error('This access key is read-only, so edits can\'t sync. Reopen the world with a write key.');
      } else if (code === 'invalid_credentials' || /401|403/.test(msg)) {
        toasts.error('API key or PIN invalid');
      } else if (/404/.test(msg)) {
        toasts.error('No world for that API key');
      } else {
        toasts.error(msg);
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
      `Unlink "${world.name}" from API?`,
      '',
      `WHAT HAPPENS:`,
      `  • Local folder${elementCount > 0 ? ` (${elementCount} element${elementCount === 1 ? '' : 's'})` : ''} stays exactly where it is`,
      `  • Sync stops immediately: no more push or pull`,
      `  • Local sync history is cleared (server timestamps, pending tombstones)`,
      `  • The world on onlyworlds.com is NOT deleted`,
      '',
      `REVERSIBLE: you can re-link later from settings or via "+ link api".`,
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
    const folder = getActiveStore();
    if (folder) {
      try {
        await folder.resetSyncBaseline();
      } catch (err) {
        // Don't block the unlink on a disk-write hiccup — the registry update
        // still proceeds, but warn loudly so the next Make-Online doesn't
        // silently produce an empty world.
        console.warn('[unlink] resetSyncBaseline failed:', err);
        toasts.error('Warning: could not fully clear sync history. Re-linking may produce an empty world; check console.');
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

  const deletePermBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="delete-world-permanent"]');
  deletePermBtn?.addEventListener('click', async () => {
    const ok = window.confirm(
      `PERMANENTLY DELETE "${world.name}"?\n\n` +
      `This removes atlas's record AND DELETES the world's folder on disk. ` +
      `Everything in it (elements, maps, media) is gone forever.\n\n` +
      `${world.state === 'api-linked' ? '\n(The matching API world on onlyworlds.com is NOT deleted server-side.)\n' : ''}` +
      `There is no undo. Continue?`
    );
    if (!ok) return;
    deletePermBtn.disabled = true;
    try {
      const store = getActiveStore();
      if (store) await store.close().catch(() => {});
      setActiveStore(null);
      evictParkedStore(world.id);
      // Detach any sync engine for this world before destroying its folder.
      detachSyncEngine();
      // Delete the on-disk folder first (we still have a working handle).
      await deleteWorldFolderUnderRoot(world.folder.folder_name);
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
      const msg = err instanceof Error ? err.message : String(err);
      toasts.error(`Delete failed: ${msg}`);
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
  const show = async (): Promise<void> => {
    // A run in progress writes the journal: that is not "did not finish".
    const interrupted = !rk.isRekeyRunning() && await store.hasRekeyJournal().catch(() => false);
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
        : n === 1 ? 'Finished giving 1 element a new id.' : `Finished giving ${n} elements new ids.`);
    } catch (err) {
      console.error('[settings] finishing the re-key failed:', err);
      toasts.error(refused(err) ?? 'The id update still could not finish. Nothing was lost; the world stays offline until it does.');
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
      toasts.error(refused(err) ?? 'Could not update the links');
    }
    await show();
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
    if (!store) { toasts.error('No active world'); return; }
    const missing = new Set(findDanglingLinks(getState().data.elements).map(d => d.missingId));
    btn.disabled = true;
    try {
      const changed = await scrubReferrers(store, missing);
      await refreshElementsAfterWrite(store);
      toasts.success(`Removed the broken links from ${changed.length} ${changed.length === 1 ? 'element' : 'elements'}`);
    } catch (err) {
      console.error('[settings] remove dangling links failed:', err);
      toasts.error('Could not remove the links');
    } finally {
      btn.disabled = false;
      show();
    }
  });
}
