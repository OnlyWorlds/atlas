/**
 * Settings → Storage tab (extracted from settings-panel session 233). Two
 * sections: "On this device" (atlas root folder) + global Sync settings
 * (pause-all, pull-on-activate, cadence, autosave debounce, conflict policy,
 * confirm-server-deletes). All sync settings are atlas-wide (every api-linked
 * world); atlas is local-first so pulls are opt-in.
 */

import { getState, patchSlice } from '../core/state';
import {
  saveRegistry,
  setSyncPullOnActivate,
  setSyncCadenceMs,
  setSyncDebounceMs,
  setSyncDefaultPolicy,
  setSyncConfirmServerDeletes,
  setSyncPauseAll,
  effectiveSyncPaused,
} from '../registry/registry';
import { setupAtlasRoot, recoverAtlasRoot } from '../setup/atlas-root-flow';
import { finishSetupDoor } from '../setup/world-doors';
import { ToastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import {
  getCurrentSyncEngine,
  getCurrentSyncFolder,
  getCurrentSyncWorldId,
  refreshConflictsCount,
} from '../sync/sync-attach';
import type { WorldsRegistry } from '../core/types';
import { escapeText } from '../core/dom-utils';
import { hasFolderMode, hasOpfsMode } from '../core/capabilities';
import { isBrowserWorld } from '../core/browser-worlds';

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

export function renderStorageTab(reg: WorldsRegistry): string {
  return `
    ${renderStorageDeviceSection()}
    ${renderSyncTab(reg)}
  `;
}

export function wireStorageTab(toasts: ToastManager): void {
  wireStorageDeviceActions(toasts);
  wireBrowserStorageSection();
  wireSyncTab(toasts);
}

// ---- On this device (atlas root) ----

function renderStorageDeviceSection(): string {
  const state = getState();
  const ar = state.atlasRoot;
  const recoverable = state.atlasRootRecoverable;
  return `
    <section class="atlas-settings-section">
      <h3>On this device</h3>
      <p class="atlas-settings-hint">The folder on your drive where Atlas keeps the new worlds you choose to keep in a folder. Existing worlds stay where they were made.</p>
      ${ar
        ? `<dl class="atlas-settings-meta">
            <dt>Folder</dt><dd><code>${escapeText(ar.pathHint ?? ar.folderName)}</code></dd>
          </dl>
          <div class="atlas-settings-actions">
            <button class="atlas-btn-ghost" data-action="change-atlas-root">Change folder</button>
          </div>`
        : recoverable
          ? `<p>A previous OnlyWorlds folder can be re-linked: <code>${escapeText(recoverable.folderName)}</code>.</p>
             <div class="atlas-settings-actions">
               <button class="atlas-btn-primary" data-action="recover-atlas-root">Re-link folder</button>
             </div>
             <p class="atlas-settings-hint-sub"><button class="atlas-btn-link" data-action="change-atlas-root">Or set up a different folder</button></p>`
          : hasFolderMode()
            ? `<p>Not set up yet.</p>
             <div class="atlas-settings-actions">
               <button class="atlas-btn-primary" data-action="change-atlas-root">Set up OnlyWorlds folder</button>
             </div>`
            : `<p>Keeping worlds in a folder on your drive needs a desktop Chromium browser: Chrome, Edge or Brave.</p>`}
    </section>
    ${showBrowserStorageSection() ? renderBrowserStorageSection() : ''}
  `;
}

// ---- In this browser (1.17, contract §3.4, lens C R3-k) ----

/** Shown where worlds live in this browser, or can only live there (no folder picker). */
function showBrowserStorageSection(): boolean {
  if (!hasOpfsMode()) return false;
  return !hasFolderMode() || getState().registry.worlds.some(w => isBrowserWorld(w) && w.demo !== true);
}

/** Filled in by `wireBrowserStorageSection`: the estimate and `persisted()` are async. */
function renderBrowserStorageSection(): string {
  const n = getState().registry.worlds.filter(w => isBrowserWorld(w) && w.demo !== true).length;
  return `
    <section class="atlas-settings-section" data-role="browser-storage">
      <h3>In this browser</h3>
      <p class="atlas-settings-hint" data-role="browser-count">${n} world${n === 1 ? '' : 's'} kept in this browser.<span data-role="browser-usage"></span></p>
      <p class="atlas-settings-hint" data-role="browser-persisted" hidden></p>
      <div class="atlas-settings-actions" data-role="browser-persist-actions" hidden>
        <button class="atlas-btn-ghost" data-action="ask-persist">Ask the browser to keep ${n === 1 ? 'it' : 'them'}</button>
      </div>
      <p class="atlas-settings-hint-sub" data-role="browser-persist-note" hidden></p>
    </section>`;
}

/** "12.4 MB": a size for people, never more exact than it can be. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'an unknown amount';
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function wireBrowserStorageSection(): void {
  const section = document.querySelector<HTMLElement>('.atlas-settings [data-role="browser-storage"]');
  if (!section) return;
  const storage = (navigator as unknown as {
    storage?: { estimate?: () => Promise<{ usage?: number }>; persisted?: () => Promise<boolean>; persist?: () => Promise<boolean> };
  }).storage;
  // `estimate()` is the whole origin, so the line says Atlas, never "your worlds".
  void storage?.estimate?.().then(({ usage }) => {
    const span = section.querySelector<HTMLElement>('[data-role="browser-usage"]');
    if (span && typeof usage === 'number') span.textContent = ` Atlas uses ${formatBytes(usage)} of this browser's storage.`;
  }).catch(() => {});
  const line = section.querySelector<HTMLElement>('[data-role="browser-persisted"]')!;
  const actions = section.querySelector<HTMLElement>('[data-role="browser-persist-actions"]')!;
  const note = section.querySelector<HTMLElement>('[data-role="browser-persist-note"]')!;
  const n = getState().registry.worlds.filter(w => isBrowserWorld(w) && w.demo !== true).length;
  const them = n === 1 ? 'it' : 'them';
  const show = (kept: boolean): void => {
    line.textContent = kept
      ? `This browser has agreed not to clear ${them} when space runs low. Clearing this site's data still removes ${them}.`
      : `This browser may clear ${them} when space runs low, and clearing this site's data removes ${them}.`;
    line.hidden = false;
    actions.hidden = kept;
  };
  // Read live every time; nothing about it is stored (contract §2.3).
  void storage?.persisted?.().then(show).catch(() => {});
  section.querySelector<HTMLButtonElement>('[data-action="ask-persist"]')?.addEventListener('click', () => {
    if (typeof storage?.persist !== 'function') return;
    // Inside the click, never awaited (Firefox may never answer, gate B M8).
    void storage.persist().then(kept => {
      show(kept);
      if (!kept && hasFolderMode()) {
        // Chromium answers without asking anyone, by how the site is used.
        note.textContent = 'This browser decides by how you use Atlas, and has not agreed yet. A copy outside the browser is the sure way to keep a world.';
        note.hidden = false;
      }
    }).catch(() => {});
  });
}

function wireStorageDeviceActions(toasts: ToastManager): void {
  const btn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="change-atlas-root"]');
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      // A world pick opens in place; a folder pick says what it found (S365).
      // "updated" only when there was one to update (S365 gate lens B F11b).
      const had = !!getState().atlasRoot;
      await finishSetupDoor(await setupAtlasRoot(), toasts, had ? 'updated' : 'set up');
    } catch (err) {
      console.warn('[settings] folder change failed:', err);
      showProblem(err, { doing: 'setting up your OnlyWorlds folder', folder: 'picked', toasts });
    } finally {
      btn.disabled = false;
    }
  });

  const recoverBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="recover-atlas-root"]');
  recoverBtn?.addEventListener('click', async () => {
    recoverBtn.disabled = true;
    recoverBtn.textContent = 'Re-linking…';
    try {
      const result = await recoverAtlasRoot();
      if (result) {
        toasts.success(
          result.imported > 0
            ? `Re-linked OnlyWorlds folder: restored ${result.imported} world${result.imported === 1 ? '' : 's'}`
            : 'Re-linked OnlyWorlds folder (no worlds found inside)'
        );
      }
    } catch (err) {
      console.warn('[settings] folder re-link failed:', err);
      showProblem(err, { doing: 're-linking your OnlyWorlds folder', folder: 'picked', toasts });
    } finally {
      recoverBtn.disabled = false;
      recoverBtn.textContent = 'Re-link folder';
    }
  });
}

// ---- Sync (global settings) ----

function renderSyncTab(reg: WorldsRegistry): string {
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
      <h3>Global sync</h3>
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
        <span class="atlas-settings-hint-sub">After a local edit, atlas waits this long before pushing to the API. The sync pill shows a decay ring during the wait; click it to push now.</span>
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
    // Match the engine to the EFFECTIVE pause: turning Pause all off must not
    // resume a world the user keeps offline (S367 critic C7).
    const engine = getCurrentSyncEngine();
    const entry = next.worlds.find(w => w.id === getCurrentSyncWorldId());
    const stillPaused = effectiveSyncPaused(entry, next);
    if (engine) {
      if (stillPaused) engine.pause('manual');
      else engine.resume();
    }
    toasts.info(pauseAll.checked
      ? 'All sync paused'
      : entry?.sync_paused ? 'Sync resumed. This world stays offline.' : 'Sync resumed');
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
      //
      // Then ACTIVELY converge: fire a push so the cleared elements' pending
      // local edits overwrite the server NOW. Under the v2 cursor pull, the
      // conflicting ops are already behind the watermark — nothing re-detects
      // them (event-once detection), so without this push the divergence
      // would sit invisible until the next edit on either side (gate finding,
      // 2026-07-12). The conflicted elements all have local_updated_at ahead
      // of baseline, so pushOnce covers exactly the cleared set.
      if (prior === 'pause-and-review' && v === 'local-wins') {
        const folder = getCurrentSyncFolder();
        if (folder) {
          void folder.writeSyncState({ conflicts: [] })
            .then(() => refreshConflictsCount())
            .then(() => {
              const eng = getCurrentSyncEngine();
              if (eng) {
                return eng.pushOnce().then(() => undefined).catch((err) => {
                  console.warn('[settings] post-policy-flip convergence push failed:', err);
                });
              }
            })
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
