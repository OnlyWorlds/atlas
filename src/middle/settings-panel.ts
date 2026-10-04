/**
 * Settings panel — orchestrator. Tabbed layout grouped by scope (session 232),
 * split into per-tab modules (session 233). This file owns the shell: the nav
 * rail, last-tab restore, and dispatch to each tab's render/wire pair.
 *
 * ATLAS (tool-wide, apply to every world):
 *   onlyworlds — account + waypoints + links → settings-onlyworlds.ts (+account.ts)
 *   storage    — atlas root folder + sync    → settings-storage.ts
 *   elements   — field-edit mode + display   → settings-elements.ts
 *   maps       — affordances + view defaults → settings-maps.ts
 * THIS WORLD (follow the active world):
 *   world    — rename / online / delete     → settings-world.ts
 *   writing  — tier labels / font / spell   → settings-writing.ts
 *   context  — web-pane graph prefs         → settings-context.ts (labeled "Web")
 *
 * Route: `#/settings/:tab` or `#/w/<id>/settings/:tab` (default tab is account).
 * Legacy keys (identity/atlas/sync/maps/about) still resolve via router alias.
 * Clicking a tab navigates — the URL is the source of truth so deep-linking works.
 */

import { isCodeLoadError } from '../core/reload-offer';
import { getState, subscribe } from '../core/state';
import { ToastManager } from '../ui/toast-manager';
import { navigate, parseHash, settingsHash, SETTINGS_TABS, SETTINGS_TAB_GROUPS, onHashChange, type SettingsTab } from '../core/router';
import type { WorldRegistryEntry, WorldsRegistry } from '../core/types';
import { escapeText } from '../core/dom-utils';
import { renderGeneralTab, wireGeneralTab } from './settings-general';
import { renderOnlyWorldsTab, wireOnlyWorldsTab } from './settings-onlyworlds';
import { renderStorageTab, wireStorageTab } from './settings-storage';
import { renderElementsTab, wireElementsTab } from './settings-elements';
import { renderMapsTab, wireMapsTab } from './settings-maps';
import { renderWorldTab, wireWorldTab } from './settings-world';
import { renderWritingTab, wireWritingTab } from './settings-writing';
import { renderContextTab, wireContextTab } from './settings-context';
import pkg from '../../package.json';

export interface SettingsMount {
  target: HTMLElement;
  toasts: ToastManager;
}

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
    // parseSettingsTab() defaults to 'onlyworlds' when the URL has no tab
    // segment, so route.settingsTab is always truthy — we can't use it to
    // detect "no tab in URL". Compare against the bare settings hash
    // instead: matches → URL has no tab → restore from storage.
    const wid = getState().active?.worldId ?? null;
    const bareSettings = settingsHash(wid);
    if (window.location.hash !== bareSettings) return;
    let stored: string | null = null;
    try { stored = localStorage.getItem(SETTINGS_LAST_TAB_KEY); } catch { /* private mode */ }
    if (!stored || stored === 'onlyworlds' || !(SETTINGS_TABS as string[]).includes(stored)) return;
    // Replace history entry so back-button doesn't bounce through the
    // intermediate /settings URL.
    window.location.replace(settingsHash(wid, stored as SettingsTab));
  })();

  function activeTab(): SettingsTab {
    return parseHash(window.location.hash).settingsTab ?? 'onlyworlds';
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
      <header class="atlas-room-header">
        <h1>Settings</h1>
        <p class="atlas-room-subtitle">Atlas preferences and this world's configuration.</p>
      </header>
      <div class="atlas-settings-shell">
        <nav class="atlas-settings-tabs" role="tablist">
          ${SETTINGS_TAB_GROUPS.map((group) => {
            const groupLabel = group.scope === 'atlas' ? 'Atlas' : 'This world';
            const groupIcon = group.scope === 'atlas' ? 'build' : 'public';
            const buttons = group.tabs.map((t) => {
              const enabled = group.scope !== 'world' || !!activeWorld;
              const active = t === tab;
              return `<button type="button"
                class="atlas-settings-tab ${active ? 'active' : ''}"
                role="tab"
                data-settings-tab="${t}"
                ${enabled ? '' : 'disabled aria-disabled="true"'}
                aria-selected="${active}">${tabLabel(t, activeWorld)}</button>`;
            }).join('');
            return `<div class="atlas-settings-tab-group-label">
                <span class="material-symbols-outlined">${groupIcon}</span>
                <span>${groupLabel}</span>
              </div>${buttons}`;
          }).join('')}
          <button type="button" class="atlas-settings-replay-chip" data-action="replay-tour"
            title="Replay the guided tour. It always starts fresh: the tour world is rebuilt from scratch and folds away again at the end.">Replay the tour</button>
          <div class="atlas-settings-version"><a href="changelog.html" target="_blank" rel="noopener" data-link="version-changelog" title="What's new in Atlas">Atlas v${pkg.version}</a> · <a href="https://onlyworlds.com" target="_blank" rel="noopener">onlyworlds.com</a></div>
        </nav>
        <section class="atlas-settings-body" role="tabpanel" data-active-tab="${tab}">
          ${renderTab(tab, reg, activeWorld)}
        </section>
      </div>
    `;

    wireTabClicks();
    wireReplayChip();
    wireTabHandlers(tab, toasts, activeWorld);
  }

  /**
   * The replay chip lives in the settings NAV, not in a tab (Captain, S306):
   * it is a quiet way out of the app, not an OnlyWorlds feature, and it used
   * to sit in the OnlyWorlds tab where its own hint already promised
   * "rebuilds the tour world from scratch" — a promise the replay path did
   * not keep until S307 made `startTour` clear the stage it had only assumed.
   * Wired here so it works from whichever tab is open.
   */
  function wireReplayChip(): void {
    root.querySelector<HTMLButtonElement>('[data-action="replay-tour"]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Starting…';
      try {
        const engine = await import('../tour/tour-engine');
        await engine.launchTour();
      } catch (err) {
        if (!isCodeLoadError(err)) toasts.error(err instanceof Error ? err.message : String(err));
        btn.disabled = false;
        btn.textContent = 'Replay the tour';
      }
    });
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

/** Tab display label — 'onlyworlds' is the brand name, the rest sentence-case. */
function tabLabel(t: SettingsTab, activeWorld?: WorldRegistryEntry): string {
  if (t === 'onlyworlds') return 'OnlyWorlds';
  // The right-pane graph tab is branded "Web" (2026-07-19); the settings tab
  // id stays 'context' — label and machinery diverge deliberately.
  if (t === 'context') return 'Web';
  // The 'world' tab wears the active world's name when one is open (Captain,
  // 2026-07-24) — "Sikelia" reads truer than a generic "World". Escaped (user
  // content) and length-capped so a long name can't blow out the tab row.
  if (t === 'world' && activeWorld?.name?.trim()) {
    const name = activeWorld.name.trim();
    return escapeText(name.length > 22 ? name.slice(0, 21) + '…' : name);
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function renderTab(
  tab: SettingsTab,
  reg: WorldsRegistry,
  activeWorld: WorldRegistryEntry | undefined
): string {
  const noWorld = '<p class="atlas-settings-hint">No world is active.</p>';
  switch (tab) {
    case 'general':
      return renderGeneralTab();
    case 'onlyworlds':
      return renderOnlyWorldsTab(reg, activeWorld);
    case 'storage':
      return renderStorageTab(reg);
    case 'elements':
      return renderElementsTab();
    case 'maps':
      return renderMapsTab(reg);
    case 'world':
      return activeWorld ? renderWorldTab(activeWorld) : noWorld;
    case 'writing':
      return activeWorld ? renderWritingTab(activeWorld) : noWorld;
    case 'context':
      return activeWorld ? renderContextTab(activeWorld) : noWorld;
  }
}

function wireTabHandlers(
  tab: SettingsTab,
  toasts: ToastManager,
  activeWorld: WorldRegistryEntry | undefined
): void {
  switch (tab) {
    case 'general':
      wireGeneralTab(toasts);
      break;
    case 'onlyworlds':
      wireOnlyWorldsTab(toasts, activeWorld);
      break;
    case 'storage':
      wireStorageTab(toasts);
      break;
    case 'elements':
      wireElementsTab(toasts);
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
  }
}
