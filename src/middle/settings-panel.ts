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
  setSyncDebounceMs,
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
import { getActiveStore, setActiveStore } from '../core/active-store';
import { setupAtlasRoot, deleteWorldFolderUnderRoot } from '../setup/atlas-root-flow';
import { MakeOnlineModal } from '../ui/make-online-modal';
import { ToastManager } from '../ui/toast-manager';
import { surfaceSyncUnavailable } from '../ui/sync-toasts';
import { navigate, parseHash, settingsHash, SETTINGS_TABS, onHashChange, type SettingsTab } from '../core/router';
import {
  attachSyncEngine,
  detachSyncEngine,
  getCurrentSyncEngine,
  getCurrentSyncFolder,
  pullNowAndRefresh,
  refreshConflictsCount,
} from '../sync/sync-attach';
import { OnlyWorldsClient } from '@onlyworlds/sdk';
import type { WorldRegistryEntry } from '../core/types';
import { escapeText, escapeAttr } from '../core/dom-utils';

export interface SettingsMount {
  target: HTMLElement;
  toasts: ToastManager;
}

const CADENCE_OPTIONS: Array<{ label: string; ms: number | null }> = [
  { label: 'Off', ms: null },
  { label: 'Every 1 min', ms: 60_000 },
  { label: 'Every 5 min', ms: 5 * 60_000 },
  { label: 'Every 15 min', ms: 15 * 60_000 },
  { label: 'Every hour', ms: 60 * 60_000 },
  { label: 'Every 6 hours', ms: 6 * 60 * 60_000 },
  { label: 'Every day', ms: 24 * 60 * 60_000 },
];

const POLICY_OPTIONS: Array<{
  value: 'local-wins' | 'pause-and-review';
  label: string;
  hint: string;
}> = [
  {
    value: 'local-wins',
    label: 'Local wins',
    hint: 'Your edits always win. Push overwrites server; pull skips applying server changes for elements you also edited. One toast per round, no badge.',
  },
  {
    value: 'pause-and-review',
    label: 'Pause and review',
    hint: 'On conflict, nothing auto-resolves. Push pauses, pull skips. ⚠ badge fires; modal lets you pick overwrite vs pull per element.',
  },
];

export function mountSettingsPanel(mount: SettingsMount): () => void {
  const { target, toasts } = mount;
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-middle-body atlas-settings';
  target.appendChild(root);

  // Restore the last-visited Settings subtab when the URL doesn't specify
  // one. Persists across world switches and reloads via localStorage.
  // Without this, opening Settings always lands on Identity, even if the
  // user was just on Writing five seconds ago.
  const SETTINGS_LAST_TAB_KEY = 'atlas_settings_last_tab';
  (function maybeRestoreTab(): void {
    const route = parseHash(window.location.hash);
    if (route.mode !== 'settings') return;
    // parseSettingsTab() defaults to 'identity' when the URL has no tab
    // segment, so route.settingsTab is always truthy — we can't use it to
    // detect "no tab in URL". Compare against the bare settings hash
    // instead: matches → URL has no tab → restore from storage.
    const wid = getState().active?.worldId ?? null;
    const bareSettings = settingsHash(wid);
    if (window.location.hash !== bareSettings) return;
    let stored: string | null = null;
    try { stored = localStorage.getItem(SETTINGS_LAST_TAB_KEY); } catch { /* private mode */ }
    if (!stored || stored === 'identity' || !(SETTINGS_TABS as string[]).includes(stored)) return;
    // Replace history entry so back-button doesn't bounce through the
    // intermediate /settings URL.
    window.location.replace(settingsHash(wid, stored as SettingsTab));
  })();

  function activeTab(): SettingsTab {
    return parseHash(window.location.hash).settingsTab ?? 'identity';
  }

  function rememberActiveTab(t: SettingsTab): void {
    try { localStorage.setItem(SETTINGS_LAST_TAB_KEY, t); } catch { /* private mode */ }
  }

  function render(): void {
    const state = getState();
    const tab = activeTab();
    // Keep the persisted "last visited" tab in sync with whatever the URL
    // says. Covers hash-driven nav (back/forward, direct links, etc.) — not
    // just our tab-click handler.
    rememberActiveTab(tab);
    const reg = state.registry;
    const activeWorldId = state.active?.worldId;
    const activeWorld = activeWorldId ? reg.worlds.find((w) => w.id === activeWorldId) : undefined;

    root.innerHTML = `
      <header class="atlas-middle-header">
        <h2>Settings</h2>
      </header>
      <div class="atlas-settings-shell">
        <nav class="atlas-settings-tabs" role="tablist">
          ${SETTINGS_TABS.map((t) => {
            const needsWorld = t === 'world' || t === 'writing' || t === 'context';
            const enabled = !needsWorld || !!activeWorld;
            const active = t === tab;
            return `<button type="button"
              class="atlas-settings-tab ${active ? 'active' : ''}"
              role="tab"
              data-settings-tab="${t}"
              ${enabled ? '' : 'disabled aria-disabled="true"'}
              aria-selected="${active}">${t.charAt(0).toUpperCase() + t.slice(1)}</button>`;
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
        rememberActiveTab(t);
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
      return activeWorld ? renderWorldTab(activeWorld) : '<p class="atlas-settings-hint">No world is active.</p>';
    case 'writing':
      return activeWorld ? renderWritingTab(activeWorld) : '<p class="atlas-settings-hint">No world is active.</p>';
    case 'context':
      return activeWorld ? renderContextTab(activeWorld) : '<p class="atlas-settings-hint">No world is active.</p>';
    case 'about':
      return renderAboutTab();
  }
}

// ---- Writing settings (DESIGN_WRITING.md) ----

function renderWritingTab(entry: WorldRegistryEntry): string {
  const labels = {
    l1: entry.writing_labels?.l1 ?? 'Book',
    l2: entry.writing_labels?.l2 ?? 'Chapter',
    l3: entry.writing_labels?.l3 ?? 'Scene',
    l4: entry.writing_labels?.l4 ?? 'Draft',
  };
  return `
    <section class="atlas-settings-section">
      <h3>Writing</h3>
      <p class="atlas-settings-hint">
        Four tier labels for the writing room. The label IS the
        <code>supertype</code> stored on each Narrative — renaming a label
        rewrites existing narratives' supertype so display and storage stay
        consistent.
      </p>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Level 1 (top)</label>
        <input class="atlas-input" data-setting="writing_l1" value="${escapeAttr(labels.l1)}" placeholder="Book" />
      </div>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Level 2 (middle)</label>
        <input class="atlas-input" data-setting="writing_l2" value="${escapeAttr(labels.l2)}" placeholder="Chapter" />
      </div>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Level 3 (deepest)</label>
        <input class="atlas-input" data-setting="writing_l3" value="${escapeAttr(labels.l3)}" placeholder="Scene" />
      </div>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Level 4 (flexible / draft)</label>
        <input class="atlas-input" data-setting="writing_l4" value="${escapeAttr(labels.l4)}" placeholder="Draft" />
      </div>
      <p class="atlas-settings-hint">
        Examples: Story / Substory / Scene / Note · Volume / Book / Chapter / Sketch.
        Existing narratives' supertype is migrated on label change.
      </p>
    </section>
    <section class="atlas-settings-section">
      <h3>Writing workspace</h3>
      <p class="atlas-settings-hint">Prose font size + family for the writing room. Applies live to both writing and reading mode.</p>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Font size</label>
        <select class="atlas-select" data-setting="writing_font_size_px">
          <option value="13" ${entry.writing_font_size_px === 13 ? 'selected' : ''}>13 (compact)</option>
          <option value="14" ${entry.writing_font_size_px === 14 ? 'selected' : ''}>14 (small)</option>
          <option value="15" ${(entry.writing_font_size_px ?? 15) === 15 ? 'selected' : ''}>15 (default)</option>
          <option value="16" ${entry.writing_font_size_px === 16 ? 'selected' : ''}>16 (large)</option>
          <option value="18" ${entry.writing_font_size_px === 18 ? 'selected' : ''}>18 (extra large)</option>
        </select>
      </div>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Font family</label>
        <select class="atlas-select" data-setting="writing_font_family">
          <option value="sans"  ${(entry.writing_font_family ?? 'sans') === 'sans' ? 'selected' : ''}>Sans (default)</option>
          <option value="serif" ${entry.writing_font_family === 'serif' ? 'selected' : ''}>Serif (Georgia)</option>
          <option value="slab"  ${entry.writing_font_family === 'slab' ? 'selected' : ''}>Slab</option>
          <option value="mono"  ${entry.writing_font_family === 'mono' ? 'selected' : ''}>Mono</option>
        </select>
      </div>
      <label class="atlas-settings-toggle">
        <input type="checkbox" data-setting="writing_spellcheck" ${entry.writing_spellcheck !== false ? 'checked' : ''} />
        <span>Spellcheck prose (browser-native; uncheck to disable squiggle lines)</span>
      </label>
    </section>
  `;
}

// ---- Context pane settings (session 231) ----

function renderContextTab(entry: WorldRegistryEntry): string {
  const hopExplicit = entry.context_hop_depth;
  const lockOn = entry.context_lock_layout === true;
  const edgeColorOn = entry.context_edge_color === true;
  return `
    <section class="atlas-settings-section">
      <h3>Context pane</h3>
      <p class="atlas-settings-hint">
        Preferences for the right-pane Context tab — the graph + element preview
        / cast lists. Per-world. The same toolbar controls live above the graph
        and write to the same settings.
      </p>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Default hop depth</label>
        <select class="atlas-select" data-setting="context_hop_depth">
          <option value="" ${hopExplicit === undefined ? 'selected' : ''}>Auto (tier-derived)</option>
          <option value="1" ${hopExplicit === 1 ? 'selected' : ''}>1-hop (direct cast only)</option>
          <option value="2" ${hopExplicit === 2 ? 'selected' : ''}>2-hop (cast + adjacent)</option>
          <option value="3" ${hopExplicit === 3 ? 'selected' : ''}>3-hop (deeper exploration)</option>
          <option value="4" ${hopExplicit === 4 ? 'selected' : ''}>4-hop (very wide)</option>
        </select>
      </div>
      <p class="atlas-settings-hint">
        Auto mode: narrative subjects at scene / draft default to 2-hop;
        chapter / book default to 1-hop; non-narrative subjects default to
        2-hop. Picking 1-4 explicitly overrides for every subject in this
        world. Higher depths use per-ring caps (12 / 8 / 6) so the graph
        stays readable.
      </p>
      <label class="atlas-settings-toggle">
        <input type="checkbox" data-setting="context_lock_layout" ${lockOn ? 'checked' : ''} />
        <span>Lock graph layout when toggling type filters (no sim re-run; surviving nodes don't jump)</span>
      </label>
    </section>
    <section class="atlas-settings-section">
      <h3>Edge styling</h3>
      <label class="atlas-settings-toggle">
        <input type="checkbox" data-setting="context_edge_color" ${edgeColorOn ? 'checked' : ''} />
        <span>Tint edges by the non-centre node's element type (uses the shared element palette)</span>
      </label>
      <p class="atlas-settings-hint">
        Off (default): all edges render in the neutral cyan accent. On:
        radial edges take the colour of the connected element's type — quick
        visual grouping by type at the edge of the graph.
      </p>
    </section>
  `;
}

function wireContextTab(entry: WorldRegistryEntry, toasts: ToastManager): void {
  const hopSel = document.querySelector<HTMLSelectElement>(`.atlas-settings select[data-setting="context_hop_depth"]`);
  hopSel?.addEventListener('change', () => {
    const raw = hopSel.value;
    let next: 1 | 2 | 3 | 4 | undefined;
    if (raw === '1') next = 1;
    else if (raw === '2') next = 2;
    else if (raw === '3') next = 3;
    else if (raw === '4') next = 4;
    else next = undefined;
    const reg = getState().registry;
    const idx = reg.worlds.findIndex(w => w.id === entry.id);
    if (idx < 0) return;
    const updated: WorldRegistryEntry = { ...reg.worlds[idx], context_hop_depth: next };
    const nextReg = { ...reg, worlds: reg.worlds.map((w, i) => (i === idx ? updated : w)) };
    saveRegistry(nextReg);
    patchSlice('registry', nextReg);
    toasts.info(`Context hop set to ${next === undefined ? 'auto' : `${next}-hop`}`);
  });

  const lockCb = document.querySelector<HTMLInputElement>(`.atlas-settings input[data-setting="context_lock_layout"]`);
  lockCb?.addEventListener('change', () => {
    const enabled = lockCb.checked;
    const reg = getState().registry;
    const idx = reg.worlds.findIndex(w => w.id === entry.id);
    if (idx < 0) return;
    const updated: WorldRegistryEntry = { ...reg.worlds[idx], context_lock_layout: enabled };
    const nextReg = { ...reg, worlds: reg.worlds.map((w, i) => (i === idx ? updated : w)) };
    saveRegistry(nextReg);
    patchSlice('registry', nextReg);
    toasts.info(`Context layout ${enabled ? 'locked' : 'free'}`);
  });

  const colorCb = document.querySelector<HTMLInputElement>(`.atlas-settings input[data-setting="context_edge_color"]`);
  colorCb?.addEventListener('change', () => {
    const enabled = colorCb.checked;
    const reg = getState().registry;
    const idx = reg.worlds.findIndex(w => w.id === entry.id);
    if (idx < 0) return;
    const updated: WorldRegistryEntry = { ...reg.worlds[idx], context_edge_color: enabled };
    const nextReg = { ...reg, worlds: reg.worlds.map((w, i) => (i === idx ? updated : w)) };
    saveRegistry(nextReg);
    patchSlice('registry', nextReg);
    toasts.info(`Edge colouring ${enabled ? 'on' : 'off'}`);
  });
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
      <p class="atlas-settings-hint">How atlas renders maps and map affordances across the UI. Label toggles default off — tighter icon-only layout. Flip on for explicit names.</p>
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
      <p class="atlas-settings-hint">Global, used when creating or linking online worlds. Changes to PIN take effect immediately — any active sync engine is re-attached.</p>
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
               placeholder="OnlyWorlds PIN (4 digits)"
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
      <p class="atlas-settings-hint">Where atlas keeps your worlds. New local worlds default here. Changing this folder doesn't move existing worlds — they stay where they were created.</p>
      ${ar
        ? `<dl class="atlas-settings-meta">
            <dt>Folder</dt><dd><code>${escapeText(ar.pathHint ?? ar.folderName)}</code></dd>
          </dl>
          <div class="atlas-settings-actions">
            <button class="atlas-btn-ghost" data-action="change-atlas-root">Change folder</button>
          </div>`
        : `<p>Not set up yet.</p>
           <div class="atlas-settings-actions">
             <button class="atlas-btn-primary" data-action="change-atlas-root">Set up atlas folder</button>
           </div>`}
    </section>
    <section class="atlas-settings-section">
      <h3>Editing</h3>
      <p class="atlas-settings-hint">How clicking a field's value opens the editor. Text selection (dragging across text) never opens the editor regardless of mode.</p>
      <fieldset class="atlas-settings-fieldset">
        <legend>Field edit mode</legend>
        <label class="atlas-settings-radio">
          <input type="radio" name="field-edit-mode" value="modal" ${fieldMode === 'modal' ? 'checked' : ''} />
          <span class="atlas-settings-radio-body">
            <strong>Modal popover <span class="atlas-settings-default-tag">default</span></strong>
            <em>Floating panel anchored near the field. Enter to save, Esc to cancel.</em>
          </span>
        </label>
        <label class="atlas-settings-radio">
          <input type="radio" name="field-edit-mode" value="inline-single" ${fieldMode === 'inline-single' ? 'checked' : ''} />
          <span class="atlas-settings-radio-body">
            <strong>Inline (single line)</strong>
            <em>Row transforms into a one-line input in place. Click away to save, Esc to cancel.</em>
          </span>
        </label>
        <label class="atlas-settings-radio">
          <input type="radio" name="field-edit-mode" value="inline-multi" ${fieldMode === 'inline-multi' ? 'checked' : ''} />
          <span class="atlas-settings-radio-body">
            <strong>Inline (multi-line, ~4 rows)</strong>
            <em>Row transforms into a textarea in place. Ctrl+Enter to save, Esc to cancel.</em>
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
  const debounceMs = typeof reg.sync_debounce_ms === 'number' && reg.sync_debounce_ms >= 0
    ? reg.sync_debounce_ms
    : 5000;
  const debounceSec = Math.round(debounceMs / 1000);
  return `
    <section class="atlas-settings-section">
      <h3>Sync — global</h3>
      <p class="atlas-settings-hint">Applies to every API-linked world. Atlas is local-first: pulls are opt-in.</p>
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
        <select class="atlas-select" name="cadence" ${pauseAll ? 'disabled' : ''}>
          ${CADENCE_OPTIONS.map(o =>
            `<option value="${o.ms ?? ''}" ${o.ms === cadenceMs ? 'selected' : ''}>${o.label}</option>`
          ).join('')}
        </select>
      </label>
      <label class="atlas-settings-field">
        <span>Autosave delay</span>
        <span class="atlas-settings-debounce-row">
          <input class="atlas-input atlas-settings-debounce-input" type="number" name="debounce-sec" min="1" max="3600" step="1" value="${debounceSec}" ${pauseAll ? 'disabled' : ''} />
          <span class="atlas-settings-debounce-unit">seconds</span>
        </span>
        <span class="atlas-settings-hint-sub">After a local edit, atlas waits this long before pushing to the API. The sync pill shows a decay ring during the wait — click it to push now.</span>
      </label>
      <fieldset class="atlas-settings-fieldset" ${pauseAll ? 'disabled' : ''}>
        <legend>Default conflict policy</legend>
        ${POLICY_OPTIONS.map(p => `
          <label class="atlas-settings-radio">
            <input type="radio" name="policy" value="${p.value}" ${p.value === defaultPolicy ? 'checked' : ''} />
            <span class="atlas-settings-radio-body">
              <strong>${p.label}${p.value === 'local-wins' ? ' <span class="atlas-settings-default-tag">default</span>' : ''}</strong>
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

// ---- About ----

function renderAboutTab(): string {
  return `
    <section class="atlas-settings-section">
      <h3>About Atlas</h3>
      <p>Local-first OnlyWorlds browser + editor. Folder is the source of truth; API sync is optional.</p>
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
    case 'writing':
      if (activeWorld) wireWritingTab(activeWorld, toasts);
      break;
    case 'context':
      if (activeWorld) wireContextTab(activeWorld, toasts);
      break;
    case 'about':
      break;
  }
}

function wireWritingTab(entry: WorldRegistryEntry, toasts: ToastManager): void {
  const save = async (key: 'l1' | 'l2' | 'l3' | 'l4', value: string): Promise<void> => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const reg = getState().registry;
    const idx = reg.worlds.findIndex(w => w.id === entry.id);
    if (idx < 0) return;
    const current = {
      l1: reg.worlds[idx].writing_labels?.l1 ?? 'Book',
      l2: reg.worlds[idx].writing_labels?.l2 ?? 'Chapter',
      l3: reg.worlds[idx].writing_labels?.l3 ?? 'Scene',
      l4: reg.worlds[idx].writing_labels?.l4 ?? 'Draft',
    };
    if (current[key] === trimmed) return;
    const nextLabels = { ...current, [key]: trimmed };
    // Reject duplicate tier labels.
    const values = [nextLabels.l1, nextLabels.l2, nextLabels.l3, nextLabels.l4];
    if (new Set(values).size !== 4) {
      toasts.error('Tier labels must be distinct.');
      // Revert input value.
      const el = document.querySelector<HTMLInputElement>(`.atlas-settings input[data-setting="writing_${key}"]`);
      if (el) el.value = current[key];
      return;
    }
    const updated: WorldRegistryEntry = {
      ...reg.worlds[idx],
      writing_labels: nextLabels,
    };
    const next = { ...reg, worlds: reg.worlds.map((w, i) => (i === idx ? updated : w)) };
    saveRegistry(next);
    patchSlice('registry', next);

    // Run rename migration: rewrite supertype on every narrative carrying the
    // old label value.
    const { applyLabelRenameMigration } = await import('./writing-promote');
    const { getActiveStore } = await import('../core/active-store');
    const folder = getActiveStore();
    if (folder) {
      const renamed = await applyLabelRenameMigration(
        folder,
        getState().data.elements,
        current,
        nextLabels,
      );
      if (renamed > 0) {
        const fresh = await folder.listElements();
        patchSlice('data', { elements: fresh });
        toasts.success(`${key.toUpperCase()} label saved (${renamed} narrative${renamed === 1 ? '' : 's'} migrated)`);
        const { requestPushIfLinked } = await import('../sync/sync-attach');
        requestPushIfLinked();
        return;
      }
    }
    toasts.info(`${key.toUpperCase()} label saved`);
  };
  for (const k of ['l1', 'l2', 'l3', 'l4'] as const) {
    const el = document.querySelector<HTMLInputElement>(`.atlas-settings input[data-setting="writing_${k}"]`);
    el?.addEventListener('change', () => { void save(k, el.value); });
  }

  // Font size selector — atlas-local pref, applies live to the workspace
  // via the --atlas-prose-font-size CSS var (read in writing-workspace.ts).
  const fontSel = document.querySelector<HTMLSelectElement>(`.atlas-settings select[data-setting="writing_font_size_px"]`);
  fontSel?.addEventListener('change', () => {
    const px = Number(fontSel.value);
    if (!Number.isFinite(px) || px < 12 || px > 22) return;
    const reg = getState().registry;
    const idx = reg.worlds.findIndex(w => w.id === entry.id);
    if (idx < 0) return;
    const updated: WorldRegistryEntry = { ...reg.worlds[idx], writing_font_size_px: px };
    const next = { ...reg, worlds: reg.worlds.map((w, i) => (i === idx ? updated : w)) };
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info(`Writing font size set to ${px}px`);
  });

  // Font-family selector — picks one of four system-font stacks via the
  // --atlas-prose-font-family CSS var.
  const famSel = document.querySelector<HTMLSelectElement>(`.atlas-settings select[data-setting="writing_font_family"]`);
  famSel?.addEventListener('change', () => {
    const v = famSel.value;
    if (v !== 'sans' && v !== 'serif' && v !== 'slab' && v !== 'mono') return;
    const reg = getState().registry;
    const idx = reg.worlds.findIndex(w => w.id === entry.id);
    if (idx < 0) return;
    const updated: WorldRegistryEntry = { ...reg.worlds[idx], writing_font_family: v };
    const next = { ...reg, worlds: reg.worlds.map((w, i) => (i === idx ? updated : w)) };
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info(`Writing font set to ${v}`);
  });

  const spellCb = document.querySelector<HTMLInputElement>(`.atlas-settings input[data-setting="writing_spellcheck"]`);
  spellCb?.addEventListener('change', () => {
    const enabled = spellCb.checked;
    const reg = getState().registry;
    const idx = reg.worlds.findIndex(w => w.id === entry.id);
    if (idx < 0) return;
    const updated: WorldRegistryEntry = { ...reg.worlds[idx], writing_spellcheck: enabled };
    const next = { ...reg, worlds: reg.worlds.map((w, i) => (i === idx ? updated : w)) };
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info(`Spellcheck ${enabled ? 'on' : 'off'}`);
  });
}

function wireIdentityTab(toasts: ToastManager): void {
  const emailInput = document.querySelector<HTMLInputElement>('.atlas-settings input[name="email"]');
  const pinInput = document.querySelector<HTMLInputElement>('.atlas-settings input[name="pin"]');
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

function wireAtlasTab(toasts: ToastManager): void {
  const btn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="change-atlas-root"]');
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const result = await setupAtlasRoot();
      if (result) {
        toasts.success(
          result.imported > 0
            ? `Atlas folder updated — found ${result.imported} world${result.imported === 1 ? '' : 's'} there`
            : 'Atlas folder updated'
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
      toasts.info(`Field edit mode: ${mode}`);
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
    toasts.info(pauseAll.checked ? 'All sync paused' : 'Sync resumed');
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

  const debounceInput = document.querySelector<HTMLInputElement>('.atlas-settings input[name="debounce-sec"]');
  // Persist on `change` (commit) so we don't write to localStorage on every
  // keystroke. Live `input` events update the engine's debounce so the next
  // requestPush picks up the new value immediately — feels like the setting
  // takes effect as soon as you type a digit.
  const commitDebounce = (): void => {
    if (!debounceInput) return;
    const raw = Number(debounceInput.value);
    if (!Number.isFinite(raw) || raw < 1) return;
    const sec = Math.min(3600, Math.max(1, Math.floor(raw)));
    if (sec !== raw) debounceInput.value = String(sec);
    const ms = sec * 1000;
    const next = setSyncDebounceMs(getState().registry, ms);
    saveRegistry(next);
    patchSlice('registry', next);
    const engine = getCurrentSyncEngine();
    if (engine) engine.setDebounceMs(ms);
  };
  debounceInput?.addEventListener('change', commitDebounce);
  debounceInput?.addEventListener('blur', commitDebounce);

  policyInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const v = input.value as 'local-wins' | 'pause-and-review';
      const prior = getState().registry.sync_default_policy;
      const next = setSyncDefaultPolicy(getState().registry, v);
      saveRegistry(next);
      patchSlice('registry', next);
      // Apply to the running engine immediately — no detach/re-attach needed.
      const engine = getCurrentSyncEngine();
      if (engine) engine.setPolicy(v);
      // Flipping pause-and-review → local-wins clears any persisted conflicts
      // for the active world. Under local-wins, divergence is auto-resolved
      // on the next sync round (local pushes anyway, server overwritten), so
      // a stale conflict badge from the prior policy would lie. (SYNC_NOTES
      // M4.) Only fire when the flip direction actually changes the semantic.
      if (prior === 'pause-and-review' && v === 'local-wins') {
        const folder = getCurrentSyncFolder();
        if (folder) {
          void folder.writeSyncState({ conflicts: [] })
            .then(() => refreshConflictsCount())
            .catch((err) => console.warn('[settings] clear conflicts failed:', err));
        }
      }
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
        toasts.success(`Connected — name on API is "${liveName}"${cachedName ? ` (was "${cachedName}")` : ''}`);
      } else {
        toasts.success(`Connected — ${liveName ?? 'world'}`);
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
      `  • Sync stops immediately — no more push or pull`,
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
        toasts.error('Warning: could not fully clear sync history — re-linking may produce an empty world. Check console.');
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
      `The folder on disk is NOT deleted — atlas just forgets about it. You can re-open the folder anytime to recover.`
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
      `Everything in it — elements, maps, media — is gone forever.\n\n` +
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


