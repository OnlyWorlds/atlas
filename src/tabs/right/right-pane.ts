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
import { getCurrentSyncEngine, pullNowAndRefresh, refreshConflictsCount } from '../../sync/sync-attach';
import { ConflictReviewModal } from '../../ui/conflict-review-modal';
import { savePersistedRightTabs } from './right-tabs-persistence';

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
  let lastActiveStale: boolean | null = null;
  let lastActiveMapDimsKey: string | null = null;
  let lastPersistedTabsRef: unknown = null;
  let lastPersistedActiveIndex = -1;
  let unmountActive: (() => void) | null = null;

  function activeTabKey(): string {
    const ui = getState().ui;
    const t = ui.rightTabs[ui.rightActiveIndex];
    if (!t) return 'map-index';
    return t.kind === 'map' ? `map:${t.mapId}` : 'map-index';
  }

  function activeTabIsStale(state: ReturnType<typeof getState>): boolean {
    const ui = state.ui;
    const t = ui.rightTabs[ui.rightActiveIndex];
    if (!t || t.kind !== 'map') return false;
    return !state.data.elements.find(e => e.type === 'map' && e.id === t.mapId);
  }

  function render(): void {
    const state = getState();
    const ui = state.ui;
    const worldId = state.active?.worldId ?? null;

    // World switched? dispose all map caches AND invalidate lastTabKey so the
    // body actually remounts even when both worlds happen to have the same
    // active tab kind (e.g. both default to map-index, or both restored to
    // `map:X` — without the reset, the body stayed wedged showing the prior
    // world's pane, which is the bug behind DESIGN_MAPS.md §5 (Issue C).
    if (lastWorldId !== worldId) {
      disposeAllMapTabs();
      lastWorldId = worldId;
      lastTabKey = null;
    }

    renderTabBar(ui.rightTabs, ui.rightActiveIndex);
    renderSyncIndicator(state, toasts);

    // Persist tab snapshot to localStorage when either the array reference
    // or the active index changes. Survives page reloads (DESIGN_MAPS.md §5).
    if (ui.rightTabs !== lastPersistedTabsRef || ui.rightActiveIndex !== lastPersistedActiveIndex) {
      savePersistedRightTabs(ui.rightTabs, ui.rightActiveIndex);
      lastPersistedTabsRef = ui.rightTabs;
      lastPersistedActiveIndex = ui.rightActiveIndex;
    }

    // Staleness flip → force a body remount. Without this, when the user
    // switches back to the world that owns a stale map tab, the tab kind +
    // mapId don't change but the underlying data did (map is now in
    // elements). tabKey-based short-circuit would skip the remount and the
    // stale pane would persist forever. See DESIGN_MAPS.md §5.
    const stale = activeTabIsStale(state);
    if (lastActiveStale !== null && lastActiveStale !== stale) {
      lastTabKey = null;
    }
    lastActiveStale = stale;

    // Active map's canvas DIMS flip → dispose + remount with fresh manager.
    // The Leaflet2DManager freezes canvasWidth/canvasHeight at construction;
    // when an image URL is added to a no-image map (or replaced with one of
    // different dims), the underlying map.width/height auto-update via
    // applyMapBackground's decode-and-store path. The manager's internal
    // canvasHeight stays stale → leafletToStorage uses the wrong Y-flip →
    // pins stored at click-time have coords valid for the OLD canvas but
    // misplace on reload when the manager is built with the NEW dims.
    // Dispose+remount aligns the manager's canvas with current map dims.
    const activeTab = ui.rightTabs[ui.rightActiveIndex];
    if (activeTab?.kind === 'map' && !stale) {
      const m = state.data.elements.find((e): e is WorldMap => e.type === 'map' && e.id === activeTab.mapId);
      const newDimsKey = m ? `${m.width ?? 2000}x${m.height ?? 2000}` : null;
      if (lastActiveMapDimsKey !== null && newDimsKey !== null && lastActiveMapDimsKey !== newDimsKey) {
        disposeMapTab(activeTab.mapId);
        lastTabKey = null;
      }
      lastActiveMapDimsKey = newDimsKey;
    } else {
      lastActiveMapDimsKey = null;
    }

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
      btn.className = 'atlas-tab' + (idx === activeIndex ? ' active' : '');
      btn.setAttribute('data-tab-index', String(idx));
      if (tab.kind === 'map-index') {
        btn.setAttribute('data-tab-kind', 'map-index');
        btn.innerHTML = `<span class="material-symbols-outlined">view_list</span><span>Maps</span>`;
        btn.addEventListener('click', () => {
          patchSlice('ui', { ...getState().ui, rightActiveIndex: idx });
        });
        tabBar.appendChild(btn);
        return;
      }
      btn.setAttribute('data-tab-kind', 'map');
      btn.setAttribute('data-tab-map-id', tab.mapId);
      const m = getState().data.elements.find((e): e is WorldMap => e.type === 'map' && e.id === tab.mapId);
      // STALE = the world's elements no longer contain this map id (deleted
      // elsewhere, never restored after a stale-tab persist, or a sync swap
      // that didn't migrate). Visual: darkened tab with click-to-close
      // affordance per DESIGN_MAPS.md §10b MR.
      const isStale = !m;
      if (isStale) btn.classList.add('atlas-tab-stale');
      const label = m?.name || tab.label || '(missing map)';
      btn.innerHTML = `<span class="material-symbols-outlined">${isStale ? 'cloud_off' : 'map'}</span><span>${escapeText(label)}</span><span class="atlas-tab-close" data-role="close" aria-label="close tab">×</span>`;
      if (isStale) {
        btn.title = 'this map is no longer in the current world — click anywhere on the tab to close it';
      }
      const closeEl = btn.querySelector<HTMLElement>('[data-role="close"]');
      closeEl?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (tab.kind === 'map') closeMapTab(idx, tab.mapId);
      });
      // Stale tabs: ANY click on the tab body (not the lock — there's none —
      // and not the explicit close ×) closes the tab. Active-on-click would
      // just show the same "missing map" pane, which is dead-end UX.
      if (isStale) {
        btn.addEventListener('click', () => {
          if (tab.kind === 'map') closeMapTab(idx, tab.mapId);
        });
      } else {
        btn.addEventListener('click', () => {
          patchSlice('ui', { ...getState().ui, rightActiveIndex: idx });
        });
      }
      // Middle-click (auxiliary button, e.button === 1) on a non-pinned map
      // tab closes it. Standard browser-tab QOL. Use `mousedown` so we don't
      // require the user to also release inside the button — same behavior
      // every browser tab strip has. preventDefault stops the OS-level
      // middle-click autoscroll cursor from popping in.
      if (tab.kind === 'map') {
        btn.addEventListener('mousedown', (e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          closeMapTab(idx, tab.mapId);
        });
        // Also block the auxclick that Chrome fires on middle-mouse so it
        // doesn't bubble to anything default (paste-on-middle in some
        // contexts).
        btn.addEventListener('auxclick', (e) => {
          if (e.button === 1) e.preventDefault();
        });
      }
      tabBar.appendChild(btn);
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
 *
 * State derivation:
 * - No active world → hidden (`data-state="none"`)
 * - Active world is local-only → `data-state="local"`, label "local"
 * - Active world is api-linked → label + state derived from `state.sync.activeSync`
 *   (SyncEngineState.kind): idle→synced, syncing→saving, paused→offline, error→error.
 *   Falls back to `linked` if no engine state has reported yet.
 */
function renderSyncIndicator(state: ReturnType<typeof getState>, toasts: ToastManager): void {
  let pill = document.querySelector<HTMLElement>('[data-role="sync-pill"]');
  if (!pill) {
    pill = document.createElement('div');
    pill.setAttribute('data-role', 'sync-pill');
    pill.className = 'atlas-sync-pill';
    // Bout EE: pill lives in the sidebar footer alongside the gear and the
    // reset-layout button (anchored right via margin-left:auto in CSS). Falls
    // back to document.body only if the shell hasn't mounted yet (test envs
    // that bypass the shell, etc.).
    const target = document.querySelector('.atlas-sidebar-footer') ?? document.body;
    target.appendChild(pill);
  }
  const active = state.active;
  if (!active) {
    pill.dataset.state = 'none';
    pill.innerHTML = '';
    pill.removeAttribute('data-clickable');
    return;
  }
  const entry = state.registry.worlds.find(w => w.id === active.worldId);
  const linked = entry?.state === 'api-linked';
  if (!linked) {
    pill.dataset.state = 'local';
    pill.title = 'local-only world — folder is the source of truth';
    pill.innerHTML = `
      <span class="atlas-sync-pill-dot"></span>
      <span>local</span>
    `;
    pill.removeAttribute('data-clickable');
    return;
  }

  // api-linked: surface engine state if available.
  const engine = state.sync.activeSync;
  const conflictCount = state.sync.activeConflictsCount;
  const base = mapEngineStateToPill(engine);
  // Pending conflicts override "synced" — sync is technically idle but the
  // user has unresolved divergence. Show warm "review N" label instead of
  // misleading green-synced.
  const { dataState, label, title } = conflictCount > 0 && base.dataState === 'synced'
    ? {
        dataState: 'pending',
        label: `review ${conflictCount}`,
        title: `${conflictCount} unresolved conflict${conflictCount === 1 ? '' : 's'} — click ⚠ to resolve`,
      }
    : base;
  pill.dataset.state = dataState;
  pill.dataset.clickable = 'true';
  pill.title = title + (conflictCount > 0 ? '' : ' · click to refresh from api');
  const conflictBadge = conflictCount > 0
    ? `<span class="atlas-sync-pill-conflict" data-role="review-conflicts" title="${conflictCount} conflict${conflictCount === 1 ? '' : 's'} to review">⚠ ${conflictCount}</span>`
    : '';
  pill.innerHTML = `
    <span class="atlas-sync-pill-dot"></span>
    <span>${label}</span>
    ${conflictBadge}
    <span class="material-symbols-outlined atlas-sync-pill-refresh" data-role="refresh" aria-label="refresh from api">refresh</span>
  `;

  // Conflict badge click — open the review modal. Caller stops propagation
  // so the pill's parent click handler doesn't fire a refresh.
  pill.querySelector<HTMLElement>('[data-role="review-conflicts"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    void new ConflictReviewModal(toasts).open().then(() => refreshConflictsCount());
  });

  // Click anywhere on the pill triggers a manual pull (when not already syncing).
  pill.onclick = async () => {
    const eng = getCurrentSyncEngine();
    if (!eng) {
      toasts.info('engine not ready');
      return;
    }
    const cur = state.sync.activeSync;
    if (cur?.kind === 'syncing') {
      // Already in flight; the engine will dedupe but no need to fire again.
      return;
    }
    if (cur?.kind === 'paused') {
      toasts.info(cur.reason === 'network' ? 'offline — pull skipped' : 'sync paused — flip stay-offline off to pull');
      return;
    }
    try {
      const result = await pullNowAndRefresh();
      if (!result) {
        toasts.info('engine not ready');
        return;
      }
      const totalUpdates = result.pulled.creates + result.pulled.updates;
      // pullNowAndRefresh fires the "pulled N" toast itself (so cadence /
      // pull-on-activate / catch-up pulls also surface). Pill-click adds ONLY
      // the "already up to date" affordance — it's a manual-only signal that
      // would spam if it fired on every cadence tick.
      if (totalUpdates === 0 && result.conflicts.length === 0) {
        toasts.info('already up to date');
      }
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : String(err));
    }
  };
}

function mapEngineStateToPill(
  engine: ReturnType<typeof getState>['sync']['activeSync']
): { dataState: string; label: string; title: string } {
  if (!engine) {
    return {
      dataState: 'api',
      label: 'linked',
      title: 'api-linked world — engine starting up',
    };
  }
  switch (engine.kind) {
    case 'idle':
      return {
        dataState: 'synced',
        label: 'synced',
        title: engine.last_sync_at ? `last synced ${formatTime(engine.last_sync_at)}` : 'idle — no sync yet',
      };
    case 'syncing':
      return {
        dataState: 'saving',
        label: engine.phase === 'push' ? 'saving…' : 'fetching…',
        title: `syncing (${engine.phase})${engine.progress ? ` ${engine.progress.done}/${engine.progress.total}` : ''}`,
      };
    case 'paused':
      return {
        dataState: 'pending',
        label: engine.reason === 'network' ? 'offline' : 'paused',
        title: engine.pending_changes
          ? `${engine.reason === 'network' ? 'offline' : 'paused'} — ${engine.pending_changes} pending`
          : engine.reason === 'network'
            ? 'offline'
            : 'paused — local edits queued',
      };
    case 'error':
      return {
        dataState: 'error',
        label: 'error',
        title: engine.message,
      };
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  } catch {
    return iso;
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
