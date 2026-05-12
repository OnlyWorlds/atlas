/**
 * Right pane driver — tab bar + active tab body.
 *
 * Reads `state.ui.rightTabs` (always starts with implicit `map-index`).
 * Clicking a tab → patches `rightActiveIndex`. Clicking the × on a map tab
 * removes that tab and shifts the active index.
 *
 * Body dispatch:
 *   - `map-index` → mountMapIndexTab
 *   - `map` → mountMapTab(mapId)
 *
 * The map-tab cache keeps state across mode switches; only world-switch
 * tears them all down.
 */

import { getState, patchSlice, subscribe, type RightTabRef } from '../../core/state';
import type { WorldMap } from '../../core/types';
import { ToastManager } from '../../ui/toast-manager';
import { mountMapIndexTab } from './map-index-tab';
import { mountMapTab, disposeMapTab, disposeAllMapTabs } from './map-tab';
import { navigate, parseHash, worldHash } from '../../core/router';

export interface RightPaneMount {
  tabBar: HTMLElement;
  pane: HTMLElement;
  toasts: ToastManager;
}

export function mountRightPane(mount: RightPaneMount): () => void {
  const { tabBar, pane, toasts } = mount;
  tabBar.innerHTML = '';
  pane.innerHTML = '';

  let lastTabKey: string | null = null;
  let lastWorldId: string | null = null;
  let unmountActive: (() => void) | null = null;

  function activeTabKey(): string {
    const ui = getState().ui;
    const t = ui.rightTabs[ui.rightActiveIndex];
    if (!t) return 'map-index';
    return t.kind === 'map' ? `map:${t.mapId}` : 'map-index';
  }

  function render(): void {
    const state = getState();
    const ui = state.ui;
    const worldId = state.active?.worldId ?? null;

    // World switched? dispose all map caches.
    if (lastWorldId !== worldId) {
      disposeAllMapTabs();
      lastWorldId = worldId;
    }

    renderTabBar(ui.rightTabs, ui.rightActiveIndex);
    renderSyncIndicator(state);

    const tabKey = activeTabKey();
    if (tabKey === lastTabKey) return;
    lastTabKey = tabKey;

    unmountActive?.();
    unmountActive = null;

    const t = ui.rightTabs[ui.rightActiveIndex];
    if (!t || t.kind === 'map-index') {
      unmountActive = mountMapIndexTab(pane, toasts);
    } else {
      // mountMapTab is non-returning (manages its own lifecycle via cache).
      mountMapTab(pane, t.mapId, toasts);
    }
  }

  function renderTabBar(tabs: RightTabRef[], activeIndex: number): void {
    tabBar.innerHTML = '';
    tabs.forEach((tab, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'atlas-right-tab' + (idx === activeIndex ? ' is-active' : '');
      btn.setAttribute('data-tab-index', String(idx));
      if (tab.kind === 'map-index') {
        btn.setAttribute('data-tab-kind', 'map-index');
        btn.innerHTML = `<span class="material-symbols-outlined">view_list</span><span>maps</span>`;
        btn.addEventListener('click', () => {
          patchSlice('ui', { ...getState().ui, rightActiveIndex: idx });
        });
        tabBar.appendChild(btn);
        return;
      }
      // Map tab: button for activation + sibling button for close (no nested buttons).
      btn.setAttribute('data-tab-kind', 'map');
      btn.setAttribute('data-tab-map-id', tab.mapId);
      const m = getState().data.elements.find((e): e is WorldMap => e.type === 'map' && e.id === tab.mapId);
      const label = m?.name || tab.label || '(untitled)';
      btn.innerHTML = `<span class="material-symbols-outlined">map</span><span class="atlas-right-tab-label">${escapeText(label)}</span>`;
      btn.addEventListener('click', () => {
        patchSlice('ui', { ...getState().ui, rightActiveIndex: idx });
      });
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'atlas-right-tab-close';
      closeBtn.setAttribute('data-role', 'close');
      closeBtn.setAttribute('aria-label', 'close tab');
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (tab.kind === 'map') closeMapTab(idx, tab.mapId);
      });
      // Wrap activate + close in a tab group so the bar layout stays the same.
      const group = document.createElement('div');
      group.className = 'atlas-right-tab-group' + (idx === activeIndex ? ' is-active' : '');
      group.appendChild(btn);
      group.appendChild(closeBtn);
      tabBar.appendChild(group);
    });
  }

  const unsubState = subscribe(render);
  render();
  return () => {
    unsubState();
    unmountActive?.();
  };
}

function closeMapTab(idx: number, mapId: string): void {
  // If the URL still names this map, leave the map route first so the
  // app-shell doesn't immediately re-open the tab via ensureMapTabOpen.
  const route = parseHash(window.location.hash);
  if (route.mode === 'map' && route.mapId === mapId && route.worldId) {
    navigate(worldHash(route.worldId));
  }
  const ui = getState().ui;
  const next = [...ui.rightTabs];
  next.splice(idx, 1);
  let active = ui.rightActiveIndex;
  if (active >= idx) active = Math.max(0, active - 1);
  patchSlice('ui', { ...getState().ui, rightTabs: next, rightActiveIndex: active });
  disposeMapTab(mapId);
}

/**
 * Sync pill — fixed-positioned (bottom-right) via legacy `.atlas-sync-pill`
 * CSS. Mounts once to document.body and updates in place.
 */
function renderSyncIndicator(state: ReturnType<typeof getState>): void {
  let pill = document.querySelector<HTMLElement>('[data-role="sync-pill"]');
  if (!pill) {
    pill = document.createElement('div');
    pill.setAttribute('data-role', 'sync-pill');
    pill.className = 'atlas-sync-pill';
    document.body.appendChild(pill);
  }
  const active = state.active;
  if (!active) {
    pill.dataset.state = 'none';
    pill.innerHTML = '';
    return;
  }
  const entry = state.registry.worlds.find(w => w.id === active.worldId);
  const linked = entry?.state === 'api-linked';
  pill.dataset.state = linked ? 'api' : 'local';
  pill.title = linked ? 'api-linked world (sync flows land in phase 3)' : 'local-only world';
  pill.innerHTML = `
    <span class="atlas-sync-pill-dot"></span>
    <span>${linked ? 'linked' : 'local'}</span>
  `;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
