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
import { deleteHandle } from '../store/handle-vault';
import { getActiveStore, setActiveStore } from '../core/active-store';
import { deleteWorldFolderUnderRoot } from '../setup/atlas-root-flow';
import { MakeOnlineModal } from '../ui/make-online-modal';
import { ToastManager } from '../ui/toast-manager';
import { surfaceSyncUnavailable } from '../ui/sync-toasts';
import { navigate } from '../core/router';
import {
  detachSyncEngine,
  getCurrentSyncEngine,
  pullNowAndRefresh,
} from '../sync/sync-attach';
import { buildV2Adapter } from '../sync/make-online';
import type { WorldRegistryEntry } from '../core/types';
import { escapeText, escapeAttr } from '../core/dom-utils';

export function renderWorldTab(world: WorldRegistryEntry): string {
  const stateLabel = world.state === 'api-linked' ? 'api-linked' : 'local-only';
  const paused = !!world.sync_paused;
  const apiActions = world.state === 'api-linked'
    ? `
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="world-paused" ${paused ? 'checked' : ''} />
        <span>Stay offline (per-world)</span>
      </label>
      <div class="atlas-settings-actions">
        <button class="atlas-btn-ghost" data-action="refresh-from-api" ${paused ? 'disabled' : ''}>Refresh from API</button>
        <button class="atlas-btn-ghost" data-action="test-connection">Test connection</button>
        <button class="atlas-btn-ghost" data-action="unlink-from-api">Unlink from API</button>
      </div>`
    : `<div class="atlas-settings-actions">
        <button class="atlas-btn-primary" data-action="make-online">Make online</button>
      </div>`;
  return `
    <section class="atlas-settings-section">
      <h3>Active world</h3>
      <label class="atlas-settings-field">
        <span>Name</span>
        <input class="atlas-input" type="text" name="world-name" value="${escapeAttr(world.name)}" />
      </label>
      <dl class="atlas-settings-meta">
        <dt>State</dt><dd>${stateLabel}</dd>
        <dt>Folder</dt><dd><code>${escapeText(world.folder.folder_name)}</code></dd>
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
      <div class="atlas-settings-actions atlas-settings-actions-danger">
        <button class="atlas-btn-ghost" data-action="delete-world">Forget world (keep folder)</button>
        <button class="atlas-btn-ghost" data-action="delete-world-permanent" title="Remove from atlas AND delete the world folder on disk">Delete world + folder</button>
      </div>
    </section>
  `;
}

export function wireWorldTab(world: WorldRegistryEntry, toasts: ToastManager): void {
  const nameInput = document.querySelector<HTMLInputElement>('.atlas-settings input[name="world-name"]');
  nameInput?.addEventListener('change', () => {
    const v = nameInput.value.trim();
    if (!v) { nameInput.value = world.name; return; }
    const next = renameWorld(getState().registry, world.id, v);
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info('Renamed');
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
      const total = result.pulled.creates + result.pulled.updates;
      toasts.success(total === 0 ? 'Already up to date' : `Pulled ${result.pulled.creates} new + ${result.pulled.updates} updated`);
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
      const msg = err instanceof Error ? err.message : String(err);
      if (/401|403/.test(msg)) toasts.error('API key or PIN invalid');
      else if (/404/.test(msg)) toasts.error('No world for that API key');
      else toasts.error(msg);
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
