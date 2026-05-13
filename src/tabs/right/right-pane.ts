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
    renderSyncIndicator(state, toasts);

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
      btn.addEventListener('click', () => {
        patchSlice('ui', { ...getState().ui, rightActiveIndex: idx });
      });
      if (tab.kind === 'map-index') {
        btn.setAttribute('data-tab-kind', 'map-index');
        btn.innerHTML = `<span class="material-symbols-outlined">view_list</span><span>maps</span>`;
        tabBar.appendChild(btn);
        return;
      }
      btn.setAttribute('data-tab-kind', 'map');
      btn.setAttribute('data-tab-map-id', tab.mapId);
      const m = getState().data.elements.find((e): e is WorldMap => e.type === 'map' && e.id === tab.mapId);
      const label = m?.name || tab.label || '(untitled)';
      // Close affordance lives inside the tab as a span (legacy `.atlas-tab-close`)
      // — direct child listener on the span, no nested buttons.
      btn.innerHTML = `<span class="material-symbols-outlined">map</span><span>${escapeText(label)}</span><span class="atlas-tab-close" data-role="close" aria-label="close tab">×</span>`;
      const closeEl = btn.querySelector<HTMLElement>('[data-role="close"]');
      closeEl?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (tab.kind === 'map') closeMapTab(idx, tab.mapId);
      });
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
    document.body.appendChild(pill);
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
      // Engine's onSyncResult callback owns conflict toasts (policy-aware).
      // Pill emits feedback only for the clean cases: pulled-something + nothing-new.
      // Avoid double-toasting on conflicts.
      if (totalUpdates > 0) {
        toasts.success(`pulled ${result.pulled.creates} new + ${result.pulled.updates} updated`);
      } else if (result.conflicts.length === 0) {
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
