/**
 * Settings → Storage tab (extracted from settings-panel). Two
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
  getCurrentSyncWorldId,
  reapplySyncPolicy,
} from '../sync/sync-attach';
import type { WorldsRegistry } from '../core/types';
import { escapeText } from '../core/dom-utils';
import { BROWSER_STORAGE_FULL_LINE, NO_BROWSER_STORAGE_LINE, hasFolderMode, hasOpfsMode, knownOpfsStatus, opfsStatus, type OpfsStatus } from '../core/capabilities';
import { isBrowserWorld } from '../core/browser-worlds';
import { staleBrowserCopies } from '../core/browser-home';

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
    hint: 'Your edits always win: they replace the online copy, and online changes to an element you also edited are dropped. No ⚠ badge.',
  },
  {
    value: 'pause-and-review',
    label: 'Pause and review',
    hint: 'When an element changed both here and online, Atlas holds it and shows ⚠. You pick which copy wins, element by element.',
  },
];

export function renderStorageTab(reg: WorldsRegistry): string {
  return `
    ${renderStorageDeviceSection()}
    ${renderSyncTab(reg)}
    ${renderForgetSection()}
  `;
}

export function wireStorageTab(toasts: ToastManager): void {
  wireStorageDeviceActions(toasts);
  wireBrowserStorageSection();
  wireSyncTab(toasts);
  document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="forget-browser"]')?.addEventListener('click', () => {
    void import('../ui/forget-browser-modal').then(m => new m.ForgetBrowserModal().open());
  });
}

// ---- Fully forget (#140) ----

function renderForgetSection(): string {
  return `
    <section class="atlas-settings-section" data-role="forget-browser">
      <h3>Start over in this browser</h3>
      <p class="atlas-settings-hint">Removes everything Atlas keeps in this browser: the worlds kept here, your PIN and sign-in, the folders it remembers and every setting. Folders on your drive and worlds on onlyworlds.com stay.</p>
      <button class="atlas-btn-ghost atlas-btn-danger" data-action="forget-browser">Forget everything in this browser</button>
    </section>
  `;
}

// ---- On this device (atlas root) ----

function renderStorageDeviceSection(): string {
  const state = getState();
  const ar = state.atlasRoot;
  const recoverable = state.atlasRootRecoverable;
  return `
    <section class="atlas-settings-section">
      <h3>On this device</h3>
      ${hasFolderMode() ? '<p class="atlas-settings-hint">The folder on your drive where Atlas keeps the new worlds you choose to keep in a folder. Existing worlds stay where they were made.</p>' : ''}
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

// ---- In this browser (1.17) ----

/** Shown where worlds live in this browser, or can only live there (no folder picker). */
function showBrowserStorageSection(): boolean {
  if (!hasOpfsMode()) return false;
  return !hasFolderMode() || staleBrowserCopies().length > 0 || getState().registry.worlds.some(w => isBrowserWorld(w) && w.demo !== true);
}

/**
 * The worlds this browser keeps, and the ones it cleared: a cleared row is
 * not kept, and asking the browser to keep it means nothing.
 */
function browserWorldCounts(): { kept: number; cleared: number } {
  const own = getState().registry.worlds.filter(w => isBrowserWorld(w) && w.demo !== true);
  const cleared = own.filter(w => w.cleared_at).length;
  return { kept: own.length - cleared, cleared };
}

/** A window whose browser storage refuses or is full says only that. */
function storageStatusLine(status: OpfsStatus | null): string | null {
  if (status === 'refused') return NO_BROWSER_STORAGE_LINE;
  if (status === 'full') return BROWSER_STORAGE_FULL_LINE;
  return null;
}

/** Copies a move left in this browser whose world now lives in a folder (contract §3.2 rule 5, §3.4). */
function staleCopiesLine(): string {
  const k = staleBrowserCopies().length;
  if (k === 0) return '';
  return `<p class="atlas-settings-hint" data-role="browser-stale">${k === 1
    ? 'An older copy of a world that now lives in a folder is still in this browser. Atlas does not open it.'
    : `${k} older copies of worlds that now live in folders are still in this browser. Atlas does not open them.`}</p>`;
}

/** Filled in by `wireBrowserStorageSection`: the estimate and `persisted()` are async. */
function renderBrowserStorageSection(): string {
  const statusLine = storageStatusLine(knownOpfsStatus());
  if (statusLine) {
    return `
    <section class="atlas-settings-section" data-role="browser-storage">
      <h3>In this browser</h3>
      <p class="atlas-settings-hint" data-role="browser-status">${escapeText(statusLine)}</p>
    </section>`;
  }
  const { kept: n, cleared } = browserWorldCounts();
  const clearedLine = cleared > 0 ? ` ${cleared} cleared by this browser.` : '';
  return `
    <section class="atlas-settings-section" data-role="browser-storage">
      <h3>In this browser</h3>
      <p class="atlas-settings-hint" data-role="browser-count">${n} world${n === 1 ? '' : 's'} kept in this browser.${clearedLine}<span data-role="browser-usage"></span></p>
      <p class="atlas-settings-hint" data-role="browser-persisted" hidden></p>
      <div class="atlas-settings-actions" data-role="browser-persist-actions" hidden>
        <button class="atlas-btn-ghost" data-action="ask-persist">Ask the browser to keep ${n === 1 ? 'it' : 'them'}</button>
      </div>
      <p class="atlas-settings-hint-sub" data-role="browser-persist-note" hidden></p>
      ${staleCopiesLine()}
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
  // The probe may settle after the render: a refusal or a full origin then
  // replaces the section's body with its one line.
  void opfsStatus().then(status => {
    const statusLine = storageStatusLine(status);
    if (!statusLine || section.querySelector('[data-role="browser-status"]')) return;
    section.innerHTML = `<h3>In this browser</h3><p class="atlas-settings-hint" data-role="browser-status">${escapeText(statusLine)}</p>`;
  }).catch(() => {});
  if (section.querySelector('[data-role="browser-status"]')) return;
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
  const n = browserWorldCounts().kept;
  // No world kept here: nothing for the browser to keep or clear, so no
  // line and no Ask. The first make asks.
  if (n === 0) return;
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
    // Inside the click, never awaited (Firefox may never answer).
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
      // A world pick opens in place; a folder pick says what it found.
      // "updated" only when there was one to update.
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
      <p class="atlas-settings-hint">Applies to every linked world. Atlas is local-first: pulls are opt-in.</p>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="pause-all" ${pauseAll ? 'checked' : ''} />
        <span>Pause all sync</span>
      </label>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="pull-on-activate" ${pullOnActivate ? 'checked' : ''} ${pauseAll ? 'disabled' : ''} />
        <span>Pull from OnlyWorlds when a world activates</span>
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
        <span class="atlas-settings-hint-sub">After a local edit, Atlas waits this long before syncing. The sync pill shows a decay ring during the wait; click it to push now.</span>
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
        <p class="atlas-settings-hint-sub" data-role="shared-policy-note">A world shared with others always holds a change made both here and online for you to choose, and pulls when it opens. To turn that off for one world, open Settings, This world.</p>
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
    // resume a world the user keeps offline.
    const engine = getCurrentSyncEngine();
    const entry = next.worlds.find(w => w.id === getCurrentSyncWorldId());
    const stillPaused = effectiveSyncPaused(entry, next);
    if (engine) {
      if (stillPaused) engine.pause('manual');
      else engine.resume();
    }
    toasts.info(pauseAll.checked
      ? 'All sync paused'
      : entry?.sync_paused ? 'Sync resumed. This world\'s own pause is still on.' : 'Sync resumed');
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
      const next = setSyncDefaultPolicy(getState().registry, v);
      saveRegistry(next);
      patchSlice('registry', next);
      // The running engine follows its world's policy, which a shared world
      // keeps as pause-and-review whatever this says. Leaving
      // pause-and-review clears the held conflicts and pushes (SYNC_NOTES M4).
      reapplySyncPolicy();
    });
  });

  confirmDel?.addEventListener('change', () => {
    const next = setSyncConfirmServerDeletes(getState().registry, confirmDel.checked);
    saveRegistry(next);
    patchSlice('registry', next);
  });
}
