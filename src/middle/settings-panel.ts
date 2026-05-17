/**
 * Settings panel — tabbed layout (Phase 3.5+).
 *
 * Tabs:
 *   identity  — global PIN + email (used by Make-Online + sync auth)
 *   atlas     — atlas root folder + change-root action
 *   sync      — global pause-all, default conflict policy, pull-on-activate,
 *               auto-refresh cadence, confirm-before-server-delete
 *   world     — active-world specific: rename, state, make-online / unlink,
 *               per-world stay-offline, refresh, delete (registry-only)
 *   about     — version + links
 *
 * Route: `#/settings/:tab` or `#/w/<id>/settings/:tab` (default tab is identity).
 * Clicking a tab navigates — the URL is the source of truth so deep-linking works.
 */

import { getState, subscribe, patchSlice } from '../core/state';
import {
  saveRegistry,
  setPin,
  setEmail,
  deleteWorldEntry,
  detachApi,
  renameWorld,
  setApiWorldName,
  setSyncPullOnActivate,
  setSyncCadenceMs,
  setSyncDefaultPolicy,
  setSyncConfirmServerDeletes,
  setSyncPauseAll,
  setWorldPaused,
  setMapsSettings,
  setEditorSettings,
  getEditorSettings,
  type FieldEditMode,
} from '../registry/registry';
import { deleteHandle } from '../store/handle-vault';
import { getActiveStore, setActiveStore } from '../ui/create-world-modal';
import { setupAtlasRoot, deleteWorldFolderUnderRoot } from '../setup/atlas-root-flow';
import { MakeOnlineModal } from '../ui/make-online-modal';
import { ToastManager } from '../ui/toast-manager';
import { navigate, parseHash, settingsHash, SETTINGS_TABS, onHashChange, type SettingsTab } from '../core/router';
import {
  attachSyncEngine,
  detachSyncEngine,
  getCurrentSyncEngine,
  pullNowAndRefresh,
} from '../sync/sync-attach';
import { OnlyWorldsClient } from '@onlyworlds/sdk';
import type { WorldRegistryEntry } from '../core/types';

export interface SettingsMount {
  target: HTMLElement;
  toasts: ToastManager;
}

const CADENCE_OPTIONS: Array<{ label: string; ms: number | null }> = [
  { label: 'off', ms: null },
  { label: 'every 1 min', ms: 60_000 },
  { label: 'every 5 min', ms: 5 * 60_000 },
  { label: 'every 15 min', ms: 15 * 60_000 },
  { label: 'every hour', ms: 60 * 60_000 },
  { label: 'every 6 hours', ms: 6 * 60 * 60_000 },
  { label: 'every day', ms: 24 * 60 * 60_000 },
];

const POLICY_OPTIONS: Array<{
  value: 'local-wins' | 'pause-and-review';
  label: string;
  hint: string;
}> = [
  {
    value: 'local-wins',
    label: 'local wins',
    hint: 'your edits always win. push overwrites server; pull skips applying server changes for elements you also edited. one toast per round, no badge.',
  },
  {
    value: 'pause-and-review',
    label: 'pause and review',
    hint: 'on conflict, nothing auto-resolves. push pauses, pull skips. ⚠ badge fires; modal lets you pick overwrite vs pull per element.',
  },
];

export function mountSettingsPanel(mount: SettingsMount): () => void {
  const { target, toasts } = mount;
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-middle-body atlas-settings';
  target.appendChild(root);

  function activeTab(): SettingsTab {
    return parseHash(window.location.hash).settingsTab ?? 'identity';
  }

  function render(): void {
    const state = getState();
    const tab = activeTab();
    const reg = state.registry;
    const activeWorldId = state.active?.worldId;
    const activeWorld = activeWorldId ? reg.worlds.find((w) => w.id === activeWorldId) : undefined;

    root.innerHTML = `
      <header class="atlas-middle-header">
        <h2>settings</h2>
      </header>
      <div class="atlas-settings-shell">
        <nav class="atlas-settings-tabs" role="tablist">
          ${SETTINGS_TABS.map((t) => {
            const enabled = t !== 'world' || !!activeWorld;
            const active = t === tab;
            return `<button type="button"
              class="atlas-settings-tab ${active ? 'active' : ''}"
              role="tab"
              data-settings-tab="${t}"
              ${enabled ? '' : 'disabled aria-disabled="true"'}
              aria-selected="${active}">${t}</button>`;
          }).join('')}
        </nav>
        <section class="atlas-settings-body" role="tabpanel" data-active-tab="${tab}">
          ${renderTab(tab, reg, activeWorld)}
        </section>
      </div>
    `;

    wireTabClicks();
    wireTabHandlers(tab, toasts, activeWorld);
  }

  function wireTabClicks(): void {
    root.querySelectorAll<HTMLButtonElement>('.atlas-settings-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const t = btn.dataset.settingsTab as SettingsTab;
        const wid = getState().active?.worldId ?? null;
        navigate(settingsHash(wid, t));
      });
    });
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();
  return () => { unsubState(); unsubHash(); };
}

function renderTab(
  tab: SettingsTab,
  reg: ReturnType<typeof getState>['registry'],
  activeWorld: WorldRegistryEntry | undefined
): string {
  switch (tab) {
    case 'identity':
      return renderIdentityTab(reg);
    case 'atlas':
      return renderAtlasTab();
    case 'sync':
      return renderSyncTab(reg);
    case 'maps':
      return renderMapsTab(reg);
    case 'world':
      return activeWorld ? renderWorldTab(activeWorld) : '<p class="atlas-settings-hint">no world is active.</p>';
    case 'about':
      return renderAboutTab();
  }
}

// ---- Maps subsystem settings (DESIGN_MAPS.md §3.5) ----

function renderMapsTab(reg: ReturnType<typeof getState>['registry']): string {
  const s = reg.maps_settings ?? {};
  const showMaps = !!s.show_map_names_in_header;
  const showPinMaps = !!s.show_pin_map_names_in_header;
  const showPinnedEls = !!s.show_pinned_element_names_in_header;
  return `
    <section class="atlas-settings-section">
      <h3>Maps</h3>
      <p class="atlas-settings-hint">how atlas renders maps and map affordances across the UI. label toggles default off — tighter icon-only layout. flip on for explicit names.</p>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="show-map-names-in-header" ${showMaps ? 'checked' : ''} />
        <span>Show map names alongside map icons in element header</span>
      </label>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="show-pin-map-names-in-header" ${showPinMaps ? 'checked' : ''} />
        <span>Show map names alongside pin icons in element header</span>
      </label>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="show-pinned-element-names-in-header" ${showPinnedEls ? 'checked' : ''} />
        <span>Show element names alongside category icons on Map detail</span>
      </label>
    </section>
  `;
}

// ---- Identity ----

function renderIdentityTab(reg: ReturnType<typeof getState>['registry']): string {
  return `
    <section class="atlas-settings-section">
      <h3>Identity</h3>
      <p class="atlas-settings-hint">global, used when creating or linking online worlds. changes to PIN take effect immediately — any active sync engine is re-attached.</p>
      <label class="atlas-settings-field">
        <span>Email</span>
        <input class="atlas-input" type="email" name="email"
               value="${escapeAttr(reg.email ?? '')}"
               placeholder="you@example.com"
               autocomplete="email" />
      </label>
      <label class="atlas-settings-field">
        <span>PIN</span>
        <input class="atlas-input" type="text" name="pin"
               value="${escapeAttr(reg.pin ?? '')}"
               placeholder="onlyworlds pin (4 digits)"
               inputmode="numeric"
               maxlength="4" />
      </label>
    </section>
  `;
}

// ---- Atlas root ----

function renderAtlasTab(): string {
  const ar = getState().atlasRoot;
  const editor = getEditorSettings(getState().registry);
  const fieldMode = editor.field_edit_mode;
  return `
    <section class="atlas-settings-section">
      <h3>Atlas folder</h3>
      <p class="atlas-settings-hint">where atlas keeps your worlds. new local worlds default here. changing this folder doesn't move existing worlds — they stay where they were created.</p>
      ${ar
        ? `<dl class="atlas-settings-meta">
            <dt>Folder</dt><dd><code>${escapeText(ar.pathHint ?? ar.folderName)}</code></dd>
          </dl>
          <div class="atlas-settings-actions">
            <button class="atlas-btn-ghost" data-action="change-atlas-root">Change folder</button>
          </div>`
        : `<p>not set up yet.</p>
           <div class="atlas-settings-actions">
             <button class="atlas-btn-primary" data-action="change-atlas-root">Set up atlas folder</button>
           </div>`}
    </section>
    <section class="atlas-settings-section">
      <h3>Editing</h3>
      <p class="atlas-settings-hint">how clicking a field's value opens the editor. text selection (dragging across text) never opens the editor regardless of mode.</p>
      <fieldset class="atlas-settings-fieldset">
        <legend>Field edit mode</legend>
        <label class="atlas-settings-radio">
          <input type="radio" name="field-edit-mode" value="modal" ${fieldMode === 'modal' ? 'checked' : ''} />
          <span class="atlas-settings-radio-body">
            <strong>Modal popover</strong>
            <em>floating panel anchored near the field. enter to save, esc to cancel.</em>
          </span>
        </label>
        <label class="atlas-settings-radio">
          <input type="radio" name="field-edit-mode" value="inline-single" ${fieldMode === 'inline-single' ? 'checked' : ''} />
          <span class="atlas-settings-radio-body">
            <strong>Inline (single line)</strong>
            <em>row transforms into a one-line input in place. click away to save, esc to cancel.</em>
          </span>
        </label>
        <label class="atlas-settings-radio">
          <input type="radio" name="field-edit-mode" value="inline-multi" ${fieldMode === 'inline-multi' ? 'checked' : ''} />
          <span class="atlas-settings-radio-body">
            <strong>Inline (multi-line, ~4 rows)</strong>
            <em>row transforms into a textarea in place. ctrl+enter to save, esc to cancel.</em>
          </span>
        </label>
      </fieldset>
    </section>
  `;
}

// ---- Sync (global settings) ----

function renderSyncTab(reg: ReturnType<typeof getState>['registry']): string {
  const cadenceMs = reg.sync_cadence_ms ?? null;
  const defaultPolicy = reg.sync_default_policy ?? 'local-wins';
  const pullOnActivate = !!reg.sync_pull_on_activate;
  const confirmServerDel = reg.sync_confirm_server_deletes !== false; // default true
  const pauseAll = !!reg.sync_pause_all;
  return `
    <section class="atlas-settings-section">
      <h3>Sync — global</h3>
      <p class="atlas-settings-hint">applies to every api-linked world. atlas is local-first: pulls are opt-in.</p>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="pause-all" ${pauseAll ? 'checked' : ''} />
        <span>Pause all sync (master kill switch)</span>
      </label>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="pull-on-activate" ${pullOnActivate ? 'checked' : ''} ${pauseAll ? 'disabled' : ''} />
        <span>Pull from API when a world activates</span>
      </label>
      <label class="atlas-settings-field">
        <span>Auto-refresh cadence</span>
        <select class="atlas-input" name="cadence" ${pauseAll ? 'disabled' : ''}>
          ${CADENCE_OPTIONS.map(o =>
            `<option value="${o.ms ?? ''}" ${o.ms === cadenceMs ? 'selected' : ''}>${o.label}</option>`
          ).join('')}
        </select>
      </label>
      <fieldset class="atlas-settings-fieldset" ${pauseAll ? 'disabled' : ''}>
        <legend>Default conflict policy</legend>
        ${POLICY_OPTIONS.map(p => `
          <label class="atlas-settings-radio">
            <input type="radio" name="policy" value="${p.value}" ${p.value === defaultPolicy ? 'checked' : ''} />
            <span class="atlas-settings-radio-body">
              <strong>${p.label}</strong>
              <em>${p.hint}</em>
            </span>
          </label>
        `).join('')}
      </fieldset>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="confirm-server-del" ${confirmServerDel ? 'checked' : ''} />
        <span>Confirm before deleting locally to match a server delete</span>
      </label>
    </section>
  `;
}

// ---- World (per-active-world) ----

function renderWorldTab(world: WorldRegistryEntry): string {
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
                ? ' <span class="atlas-settings-hint-inline" title="local name and server-side name diverged. atlas never renames the server world automatically.">(differs from local)</span>'
                : '';
              return `<dt>Name on API</dt><dd>${escapeText(apiName)}${hint}</dd>`;
            })()
          : ''}
      </dl>
      ${apiActions}
      <div class="atlas-settings-actions atlas-settings-actions-danger">
        <button class="atlas-btn-ghost" data-action="delete-world">Forget world (keep folder)</button>
        <button class="atlas-btn-ghost" data-action="delete-world-permanent" title="remove from atlas AND delete the world folder on disk">Delete world + folder</button>
      </div>
    </section>
  `;
}

// ---- About ----

function renderAboutTab(): string {
  return `
    <section class="atlas-settings-section">
      <h3>About Atlas</h3>
      <p>local-first OnlyWorlds browser + editor. folder is the source of truth; api sync is optional.</p>
      <dl class="atlas-settings-meta">
        <dt>Version</dt><dd>0.0.1 (phase 3.5)</dd>
        <dt>Repo</dt><dd><a href="https://github.com/OnlyWorlds/atlas" target="_blank" rel="noopener">github.com/OnlyWorlds/atlas</a></dd>
        <dt>OnlyWorlds</dt><dd><a href="https://onlyworlds.com" target="_blank" rel="noopener">onlyworlds.com</a></dd>
      </dl>
    </section>
  `;
}

// ---- Wiring ----

function wireTabHandlers(
  tab: SettingsTab,
  toasts: ToastManager,
  activeWorld: WorldRegistryEntry | undefined
): void {
  switch (tab) {
    case 'identity':
      wireIdentityTab(toasts);
      break;
    case 'atlas':
      wireAtlasTab(toasts);
      break;
    case 'sync':
      wireSyncTab(toasts);
      break;
    case 'maps':
      wireMapsTab(toasts);
      break;
    case 'world':
      if (activeWorld) wireWorldTab(activeWorld, toasts);
      break;
    case 'about':
      break;
  }
}

function wireIdentityTab(toasts: ToastManager): void {
  const emailInput = document.querySelector<HTMLInputElement>('.atlas-settings input[name="email"]');
  const pinInput = document.querySelector<HTMLInputElement>('.atlas-settings input[name="pin"]');
  emailInput?.addEventListener('change', () => {
    const next = setEmail(getState().registry, emailInput.value);
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info('email saved');
  });
  pinInput?.addEventListener('change', async () => {
    const prevPin = getState().registry.pin;
    const next = setPin(getState().registry, pinInput.value);
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info('pin saved');
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

function wireAtlasTab(toasts: ToastManager): void {
  const btn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="change-atlas-root"]');
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const result = await setupAtlasRoot();
      if (result) {
        toasts.success(
          result.imported > 0
            ? `atlas folder updated — found ${result.imported} world${result.imported === 1 ? '' : 's'} there`
            : 'atlas folder updated'
        );
      }
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : String(err));
    } finally {
      btn.disabled = false;
    }
  });

  // Field edit mode radio (session 219). Persists to registry.editor_settings.
  // The element-detail click handler reads this on every click — no reload
  // needed; the next field click uses the new mode immediately.
  const editModeInputs = document.querySelectorAll<HTMLInputElement>(
    '.atlas-settings input[name="field-edit-mode"]'
  );
  editModeInputs.forEach((inp) => {
    inp.addEventListener('change', () => {
      if (!inp.checked) return;
      const mode = inp.value as FieldEditMode;
      const next = setEditorSettings(getState().registry, { field_edit_mode: mode });
      saveRegistry(next);
      patchSlice('registry', next);
      toasts.info(`field edit mode: ${mode}`);
    });
  });
}

function wireSyncTab(toasts: ToastManager): void {
  const pauseAll = document.querySelector<HTMLInputElement>('.atlas-settings input[name="pause-all"]');
  const pullOnAct = document.querySelector<HTMLInputElement>('.atlas-settings input[name="pull-on-activate"]');
  const cadence = document.querySelector<HTMLSelectElement>('.atlas-settings select[name="cadence"]');
  const policyInputs = document.querySelectorAll<HTMLInputElement>('.atlas-settings input[name="policy"]');
  const confirmDel = document.querySelector<HTMLInputElement>('.atlas-settings input[name="confirm-server-del"]');

  pauseAll?.addEventListener('change', () => {
    const next = setSyncPauseAll(getState().registry, pauseAll.checked);
    saveRegistry(next);
    patchSlice('registry', next);
    // Toggle engine pause state to match.
    const engine = getCurrentSyncEngine();
    if (engine) {
      if (pauseAll.checked) engine.pause('manual');
      else engine.resume();
    }
    toasts.info(pauseAll.checked ? 'all sync paused' : 'sync resumed');
  });

  pullOnAct?.addEventListener('change', () => {
    const next = setSyncPullOnActivate(getState().registry, pullOnAct.checked);
    saveRegistry(next);
    patchSlice('registry', next);
  });

  cadence?.addEventListener('change', () => {
    const raw = cadence.value;
    const ms = raw === '' ? null : Number(raw);
    const next = setSyncCadenceMs(getState().registry, Number.isFinite(ms) ? (ms as number) : null);
    saveRegistry(next);
    patchSlice('registry', next);
  });

  policyInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const v = input.value as 'local-wins' | 'pause-and-review';
      const next = setSyncDefaultPolicy(getState().registry, v);
      saveRegistry(next);
      patchSlice('registry', next);
      // Apply to the running engine immediately — no detach/re-attach needed.
      const engine = getCurrentSyncEngine();
      if (engine) engine.setPolicy(v);
    });
  });

  confirmDel?.addEventListener('change', () => {
    const next = setSyncConfirmServerDeletes(getState().registry, confirmDel.checked);
    saveRegistry(next);
    patchSlice('registry', next);
  });
}

function wireMapsTab(_toasts: ToastManager): void {
  // Three independent toggles all stored on registry.maps_settings via the
  // partial-merge setMapsSettings helper. No info toasts — the visible state
  // change in element-detail headers is its own feedback.
  const wireToggle = (
    name: string,
    key: 'show_map_names_in_header' | 'show_pin_map_names_in_header' | 'show_pinned_element_names_in_header',
  ): void => {
    const el = document.querySelector<HTMLInputElement>(`.atlas-settings input[name="${name}"]`);
    el?.addEventListener('change', () => {
      const next = setMapsSettings(getState().registry, { [key]: el.checked });
      saveRegistry(next);
      patchSlice('registry', next);
    });
  };
  wireToggle('show-map-names-in-header', 'show_map_names_in_header');
  wireToggle('show-pin-map-names-in-header', 'show_pin_map_names_in_header');
  wireToggle('show-pinned-element-names-in-header', 'show_pinned_element_names_in_header');
}

function wireWorldTab(world: WorldRegistryEntry, toasts: ToastManager): void {
  const nameInput = document.querySelector<HTMLInputElement>('.atlas-settings input[name="world-name"]');
  nameInput?.addEventListener('change', () => {
    const v = nameInput.value.trim();
    if (!v) { nameInput.value = world.name; return; }
    const next = renameWorld(getState().registry, world.id, v);
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info('renamed');
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
    toasts.info(pausedInput.checked ? 'this world set to offline' : 'sync resumed for this world');
  });

  const refreshBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="refresh-from-api"]');
  refreshBtn?.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    try {
      const result = await pullNowAndRefresh();
      if (!result) { toasts.info('engine not ready'); return; }
      const total = result.pulled.creates + result.pulled.updates;
      toasts.success(total === 0 ? 'already up to date' : `pulled ${result.pulled.creates} new + ${result.pulled.updates} updated`);
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
    if (!pin) { toasts.error('set your pin first'); return; }
    testBtn.disabled = true;
    try {
      const client = new OnlyWorldsClient({ apiKey: world.api.api_key, apiPin: pin });
      const fetched = await client.worlds.get();
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
        toasts.success(`connected — name on api is "${liveName}"${cachedName ? ` (was "${cachedName}")` : ''}`);
      } else {
        toasts.success(`connected — ${liveName ?? 'world'}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/401|403/.test(msg)) toasts.error('api key or pin invalid');
      else if (/404/.test(msg)) toasts.error('no world for that api key');
      else toasts.error(msg);
    } finally {
      testBtn.disabled = false;
    }
  });

  const unlinkBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="unlink-from-api"]');
  unlinkBtn?.addEventListener('click', async () => {
    const ok = window.confirm(
      `unlink "${world.name}" from api?\n\nlocal files stay where they are. the world stops syncing. you can re-link later from settings or via "+ link api".\n\nthe api world on onlyworlds.com is NOT deleted.`
    );
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
        toasts.error('warning: could not fully clear sync history — re-linking may produce an empty world. check console.');
      }
    }
    const next = detachApi(getState().registry, world.id);
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.success(`unlinked ${world.name}`);
  });

  const makeOnlineBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="make-online"]');
  makeOnlineBtn?.addEventListener('click', () => new MakeOnlineModal(toasts).open());

  const deleteBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="delete-world"]');
  deleteBtn?.addEventListener('click', async () => {
    const ok = window.confirm(
      `remove "${world.name}" from atlas?\n\n` +
      `the folder on disk is NOT deleted — atlas just forgets about it. you can re-open the folder anytime to recover.`
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
    toasts.success(`forgot ${world.name}`);
    navigate('#/');
  });

  const deletePermBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="delete-world-permanent"]');
  deletePermBtn?.addEventListener('click', async () => {
    const ok = window.confirm(
      `PERMANENTLY DELETE "${world.name}"?\n\n` +
      `this removes atlas's record AND DELETES the world's folder on disk. ` +
      `everything in it — elements, maps, media — is gone forever.\n\n` +
      `${world.state === 'api-linked' ? '\n(the matching api world on onlyworlds.com is NOT deleted server-side.)\n' : ''}` +
      `there is no undo. continue?`
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
      toasts.success(`deleted ${world.name} permanently`);
      navigate('#/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toasts.error(`delete failed: ${msg}`);
      deletePermBtn.disabled = false;
    }
  });
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}
