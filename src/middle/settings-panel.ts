/**
 * Settings panel — orchestrator. Tabbed layout grouped by scope (session 232),
 * split into per-tab modules (session 233). This file owns the shell: the nav
 * rail, last-tab restore, and dispatch to each tab's render/wire pair.
 *
 * ATLAS (tool-wide, apply to every world):
 *   account  — global PIN + email          → settings-account.ts
 *   storage  — atlas root folder + sync     → settings-storage.ts
 *   editing  — field-edit mode + maps       → settings-editing.ts
 * THIS WORLD (follow the active world):
 *   world    — rename / online / delete     → settings-world.ts
 *   writing  — tier labels / font / spell   → settings-writing.ts
 *   context  — context-pane graph prefs     → settings-context.ts
 *
 * Route: `#/settings/:tab` or `#/w/<id>/settings/:tab` (default tab is account).
 * Legacy keys (identity/atlas/sync/maps/about) still resolve via router alias.
 * Clicking a tab navigates — the URL is the source of truth so deep-linking works.
 */

import { getState, subscribe } from '../core/state';
import { ToastManager } from '../ui/toast-manager';
import { navigate, parseHash, settingsHash, SETTINGS_TABS, SETTINGS_TAB_GROUPS, onHashChange, type SettingsTab } from '../core/router';
import type { WorldRegistryEntry, WorldsRegistry } from '../core/types';
import { renderAccountTab, wireAccountTab } from './settings-account';
import { renderStorageTab, wireStorageTab } from './settings-storage';
import { renderEditingTab, wireEditingTab } from './settings-editing';
import { renderWorldTab, wireWorldTab } from './settings-world';
import { renderWritingTab, wireWritingTab } from './settings-writing';
import { renderContextTab, wireContextTab } from './settings-context';

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
    // parseSettingsTab() defaults to 'account' when the URL has no tab
    // segment, so route.settingsTab is always truthy — we can't use it to
    // detect "no tab in URL". Compare against the bare settings hash
    // instead: matches → URL has no tab → restore from storage.
    const wid = getState().active?.worldId ?? null;
    const bareSettings = settingsHash(wid);
    if (window.location.hash !== bareSettings) return;
    let stored: string | null = null;
    try { stored = localStorage.getItem(SETTINGS_LAST_TAB_KEY); } catch { /* private mode */ }
    if (!stored || stored === 'account' || !(SETTINGS_TABS as string[]).includes(stored)) return;
    // Replace history entry so back-button doesn't bounce through the
    // intermediate /settings URL.
    window.location.replace(settingsHash(wid, stored as SettingsTab));
  })();

  function activeTab(): SettingsTab {
    return parseHash(window.location.hash).settingsTab ?? 'account';
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
                aria-selected="${active}">${t.charAt(0).toUpperCase() + t.slice(1)}</button>`;
            }).join('');
            return `<div class="atlas-settings-tab-group-label">
                <span class="material-symbols-outlined">${groupIcon}</span>
                <span>${groupLabel}</span>
              </div>${buttons}`;
          }).join('')}
          <div class="atlas-settings-version">Atlas v0.0.1 · <a href="https://onlyworlds.com" target="_blank" rel="noopener">onlyworlds.com</a></div>
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
  reg: WorldsRegistry,
  activeWorld: WorldRegistryEntry | undefined
): string {
  const noWorld = '<p class="atlas-settings-hint">No world is active.</p>';
  switch (tab) {
    case 'account':
      return renderAccountTab(reg);
    case 'storage':
      return renderStorageTab(reg);
    case 'editing':
      return renderEditingTab(reg);
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
    case 'account':
      wireAccountTab(toasts);
      break;
    case 'storage':
      wireStorageTab(toasts);
      break;
    case 'editing':
      wireEditingTab(toasts);
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
