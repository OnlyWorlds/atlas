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
import { mountContextTab } from './context-tab';
import { mapTabCache } from './map-tab-cache';
import { retargetVisualSettingsPopover, closeVisualSettingsPopover } from './map-visual-settings-popover';
import { navigate, parseHash, worldHash, elementHash, settingsHash } from '../../core/router';
import { getCurrentSyncEngine, pullNowAndRefresh, refreshConflictsCount, diagnoseSyncUnavailable } from '../../sync/sync-attach';
import { surfaceSyncUnavailable } from '../../ui/sync-toasts';
import { issuesFor } from '../../sync/sync-issues';
import { showProblem } from '../../ui/problem-fixes';
import { ConflictReviewModal } from '../../ui/conflict-review-modal';
import { savePersistedRightTabs } from './right-tabs-persistence';
import { clearCameraState } from '../../core/map-camera-persist';
import { escapeText } from '../../core/dom-utils';
import { filesWhereOf } from '../../core/browser-worlds';
import { SEAT_SECRET_MISSING_LINE } from '../../core/seat';

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
    if (t.kind === 'map') return `map:${t.mapId}`;
    if (t.kind === 'context') return 'context';
    return 'map-index';
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

    // No active world → no tab chrome at all (G4/T-G10). Showing Context|Maps
    // tabs (and whichever one happened to be "active" from persisted state)
    // is noise on an empty app, and it previously surfaced an inconsistency
    // (Maps rendered active while Context sat at index 0). One quiet
    // placeholder replaces both.
    if (!state.active) {
      tabBar.innerHTML = '';
      if (lastTabKey !== 'no-world') {
        unmountActive?.();
        unmountActive = null;
        closeVisualSettingsPopover();
        // Silent when no world is open — narration here competed with the
        // welcome/landing panel, the screen's one voice (S255).
        pane.innerHTML = '';
        lastTabKey = 'no-world';
      }
      renderSyncIndicator(state, toasts);
      return;
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
        // The saved camera targets the OLD coordinate space — restoring it
        // after the remount teleports the view somewhere meaningless on the
        // new canvas (S300b tidy). Clear it so the remount lands fit-to-image.
        clearCameraState(activeTab.mapId);
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
      // Leaving any map context — close the visual-settings popover since
      // it represents a specific map's prefs and has nothing to target.
      closeVisualSettingsPopover();
      unmountActive = mountMapIndexTab(pane, toasts);
    } else if (t.kind === 'context') {
      closeVisualSettingsPopover();
      unmountActive = mountContextTab({ pane, toasts });
    } else {
      // mountMapTab is non-returning (manages its own lifecycle via cache).
      mountMapTab(pane, t.mapId, toasts);
      // If the visual settings popover is open, re-target it at the newly-
      // active map so the user sees the new map's prefs without having to
      // close + reopen. Deferred to a microtask so the new map-tab's mount
      // (which creates the cache entry asynchronously via `entry.ready`)
      // has a chance to register before we read mapTabCache.
      queueMicrotask(() => {
        const newEntry = mapTabCache.get(t.mapId);
        if (newEntry) retargetVisualSettingsPopover(newEntry);
      });
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
      if (tab.kind === 'context') {
        btn.setAttribute('data-tab-kind', 'context');
        btn.innerHTML = `<span class="material-symbols-outlined">hub</span><span>Web</span>`;
        btn.title = 'Web · graph + details for the active element or narrative';
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
      btn.innerHTML = `<span class="material-symbols-outlined">${isStale ? 'cloud_off' : 'map'}</span><span>${escapeText(label)}</span><span class="atlas-tab-close" data-role="close" aria-label="Close tab">×</span>`;
      if (isStale) {
        btn.title = 'This map is no longer in the current world. Click anywhere on the tab to close it';
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
        // Right-click → select this map ELEMENT (navigate to element-detail).
        // Symmetric with the map-index tree row's right-click. Left-click
        // activates the tab; right-click is the "edit this map's fields"
        // gesture. Skip for stale tabs (no element to select).
        if (!isStale) {
          btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const worldId = getState().active?.worldId;
            if (!worldId || tab.kind !== 'map') return;
            patchSlice('ui', { ...getState().ui, selectedElementId: tab.mapId, sidebarMode: 'elements' });
            navigate(elementHash(worldId, tab.mapId));
          });
        }
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
  // Schedule a periodic tick so "synced 3m ago" ages naturally. State doesn't
  // re-render on its own; we just re-run this function from a 30s interval.
  // Idempotent — only one timer at a time.
  ensureSyncPillTicker(toasts);
  ensurePendingPushListener(toasts);
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
    pill.title = filesWhereOf(entry) === 'browser'
      ? 'Local world: kept in this browser'
      : 'Local world: the folder is the source of truth';
    pill.innerHTML = `
      <span class="atlas-sync-pill-dot"></span>
      <span>Local</span>
    `;
    pill.removeAttribute('data-clickable');
    return;
  }

  // View-only world (S264): the pill says what this world IS — read-only —
  // rather than mapping the engine's save states (nothing ever saves up).
  // Click still refreshes (pull-only).
  if (entry?.api?.read_only) {
    pill.dataset.state = 'view';
    pill.dataset.clickable = 'true';
    pill.title = "View-only world: you can read everything, edit nothing · click to refresh";
    pill.innerHTML = `
      <span class="atlas-sync-pill-dot"></span>
      <span class="material-symbols-outlined atlas-sync-pill-eye">visibility</span>
      <span>View only</span>
      <span class="material-symbols-outlined atlas-sync-pill-refresh" data-role="refresh" aria-label="Refresh from OnlyWorlds">refresh</span>
    `;
    const refreshView = async (): Promise<void> => {
      try {
        const result = await pullNowAndRefresh();
        if (!result) { surfaceSyncUnavailable(toasts); return; }
        const totalPulled = result.pulled.creates + result.pulled.updates + result.pulled.deletes
          + (result.meta_pulled?.length ?? 0);
        if (totalPulled === 0) toasts.info('Already up to date');
      } catch (err) {
        console.warn('[right-pane] view-only refresh failed:', err);
        showProblem(err, { doing: 'refreshing from OnlyWorlds', retry: refreshView, toasts });
      }
    };
    pill.onclick = refreshView;
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
        label: `Review ${conflictCount}`,
        title: `${conflictCount} unresolved conflict${conflictCount === 1 ? '' : 's'} · click ⚠ to resolve`,
      }
    : base;
  pill.dataset.state = dataState;
  pill.dataset.clickable = 'true';
  pill.title = title + (conflictCount > 0 ? '' : ' · click to refresh from OnlyWorlds');
  const conflictBadge = conflictCount > 0
    ? `<span class="atlas-sync-pill-conflict" data-role="review-conflicts" title="${conflictCount} conflict${conflictCount === 1 ? '' : 's'} to review">⚠ ${conflictCount}</span>`
    : '';
  // Elements still not syncing (S369): the place to come back to after a
  // failure toast. A first busy-file failure is left out: it usually clears
  // by itself in the next round, which is why its toast stays quiet too.
  const issueCount = issuesFor(active.worldId).filter(i => i.kind !== 'file_busy' || i.rounds > 1).length;
  const issueBadge = issueCount > 0
    ? `<span class="atlas-sync-pill-conflict atlas-sync-pill-issues" data-role="sync-issues" title="${issueCount} change${issueCount === 1 ? '' : 's'} not syncing · click to see why">⚠ ${issueCount}</span>`
    : '';
  pill.innerHTML = `
    <span class="atlas-sync-pill-dot"></span>
    <span>${label}</span>
    ${conflictBadge}
    ${issueBadge}
    <span class="material-symbols-outlined atlas-sync-pill-refresh" data-role="refresh" aria-label="Refresh from OnlyWorlds">refresh</span>
  `;
  pill.querySelector<HTMLElement>('[data-role="sync-issues"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    navigate(settingsHash(active.worldId, 'world'));
  });

  // Pending-push decay ring: if the engine has a debounced push scheduled,
  // surface it via a `data-pending="true"` attribute + `--decay-fraction` CSS
  // var. The conic-gradient ring around the dot fills as time elapses; the
  // rAF tick (ensurePendingPushListener) keeps the var updated smoothly.
  if (currentPendingPush) {
    pill.dataset.pending = 'true';
    const remaining = currentPendingPush.scheduledAt - Date.now();
    const debounceMs = Math.max(1, currentPendingPush.debounceMs);
    const elapsed = Math.max(0, Math.min(debounceMs, debounceMs - remaining));
    pill.style.setProperty('--decay-fraction', String(elapsed / debounceMs));
    pill.title = `Saving in ${Math.max(0, Math.ceil(remaining / 1000))}s · click to push now`;
  } else {
    pill.dataset.pending = 'false';
    pill.style.removeProperty('--decay-fraction');
  }

  // Conflict badge click — open the review modal. Caller stops propagation
  // so the pill's parent click handler doesn't fire a refresh.
  pill.querySelector<HTMLElement>('[data-role="review-conflicts"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    void new ConflictReviewModal(toasts).open().then(() => refreshConflictsCount());
  });

  // Click anywhere on the pill triggers a manual pull (when not already syncing).
  // Special case: during a pending push, click flushes the debounce instead —
  // the user is saying "push now, don't wait" rather than "fetch from server."
  pill.onclick = async () => {
    const eng = getCurrentSyncEngine();
    if (!eng) {
      surfaceSyncUnavailable(toasts);
      return;
    }
    if (currentPendingPush) {
      const pushNow = async (): Promise<void> => {
        try {
          await eng.flushPendingPush();
        } catch (err) {
          console.warn('[right-pane] push now failed:', err);
          showProblem(err, { doing: 'uploading changes', savedLocally: true, retry: pushNow, toasts });
        }
      };
      await pushNow();
      return;
    }
    const cur = state.sync.activeSync;
    // An errored pill says why in Settings → World, with the fix (S369):
    // a pull cannot help a dead key or a damaged file.
    if (cur?.kind === 'error') {
      navigate(settingsHash(active.worldId, 'world'));
      return;
    }
    if (cur?.kind === 'syncing') {
      // Already in flight; the engine will dedupe but no need to fire again.
      return;
    }
    if (cur?.kind === 'paused') {
      toasts.info(cur.reason === 'network' ? 'Offline, so nothing was refreshed.'
        : cur.reason === 'held' && cur.held_for === 'disk' ? 'Files changed on disk are waiting for your answer in the element list.'
        : cur.reason === 'held' && cur.held_for === 'move' ? 'This world is being moved to a folder. Refresh when that finishes.'
        : cur.reason === 'held' && cur.held_for === 'download' ? 'This world is being saved as one file. Refresh when that finishes.'
        : cur.reason === 'held' ? 'Ids are being updated in this world. Refresh when that finishes.'
        : 'Sync is paused. Turn off Pause sync or Pause all sync in Settings to refresh.');
      return;
    }
    try {
      const result = await pullNowAndRefresh();
      if (!result) {
        surfaceSyncUnavailable(toasts);
        return;
      }
      const totalPulled = result.pulled.creates + result.pulled.updates + result.pulled.deletes
        + (result.meta_pulled?.length ?? 0);
      const totalPushed = result.pushed.creates + result.pushed.updates + result.pushed.deletes
        + (result.meta_pushed?.length ?? 0);
      // pullNowAndRefresh fires the "pulled N" toast itself (so cadence /
      // pull-on-activate / catch-up pulls also surface). Pill-click adds ONLY
      // the "already up to date" affordance — it's a manual-only signal that
      // would spam if it fired on every cadence tick.
      //
      // Gate on BOTH push and pull counts: the engine's inFlight dedup means a
      // pillClick that fires during a debounced push round returns the push's
      // shared promise (push-shaped result, pulled.* all zero). Without the
      // pushed.* check, "already up to date" would fire after a push that
      // actually moved N records, misleading the user. (SYNC_NOTES M2.)
      if (totalPulled === 0 && totalPushed === 0 && result.conflicts.length === 0) {
        toasts.info('Already up to date');
      }
    } catch (err) {
      console.warn('[right-pane] refresh failed:', err);
      showProblem(err, { doing: 'refreshing from OnlyWorlds', savedLocally: true, retry: () => { void pullNowAndRefresh().catch(e => showProblem(e, { doing: 'refreshing from OnlyWorlds', savedLocally: true, toasts })); }, toasts });
    }
  };
}

function mapEngineStateToPill(
  engine: ReturnType<typeof getState>['sync']['activeSync']
): { dataState: string; label: string; title: string } {
  if (!engine) {
    // No engine state — distinguish "still spinning up" from "can never
    // spin up" (Captain's find, 2026-07-19: a linked world with no PIN
    // said 'engine starting up' forever). diagnoseSyncUnavailable knows.
    const reason = diagnoseSyncUnavailable();
    if (reason?.kind === 'pin-missing') {
      return {
        dataState: 'error',
        label: 'No PIN',
        title: 'This world is linked but cannot sync: no PIN is set. Add your PIN in Settings, under OnlyWorlds.',
      };
    }
    if (reason?.kind === 'seat-secret-missing') {
      return { dataState: 'error', label: 'Not syncing', title: SEAT_SECRET_MISSING_LINE };
    }
    return {
      dataState: 'api',
      label: 'Linked',
      title: 'Linked to OnlyWorlds · sync is starting',
    };
  }
  switch (engine.kind) {
    case 'idle': {
      // Surface "synced 3m ago" inline on the pill — the timestamp used to
      // live only in the tooltip, hiding the most useful signal (is sync
      // recent?) behind a hover. Relative-time helper falls back to a
      // wall-clock label once entries age past the hour.
      const rel = engine.last_sync_at ? formatRelative(engine.last_sync_at) : null;
      return {
        dataState: 'synced',
        label: rel ? `Synced ${rel}` : 'Synced',
        title: engine.last_sync_at ? `Last synced ${formatTime(engine.last_sync_at)}` : 'Idle · no sync yet',
      };
    }
    case 'syncing':
      return {
        dataState: 'saving',
        label: engine.phase === 'push' ? 'Saving…' : 'Fetching…',
        title: `Syncing${engine.progress ? ` ${engine.progress.done}/${engine.progress.total}` : ''}`,
      };
    case 'paused':
      if (engine.reason === 'held' && engine.held_for === 'disk') {
        return { dataState: 'pending', label: 'Waiting', title: 'Many files changed on disk. Upload them or pause sync, from the element list.' };
      }
      if (engine.reason === 'held' && engine.held_for === 'move') {
        return { dataState: 'saving', label: 'Moving', title: 'Moving this world to a folder. Sync resumes when it finishes.' };
      }
      if (engine.reason === 'held' && engine.held_for === 'download') {
        return { dataState: 'saving', label: 'Saving a copy', title: 'Saving this world as one file. Sync resumes when it finishes.' };
      }
      if (engine.reason === 'held') {
        return { dataState: 'saving', label: 'Updating ids', title: 'Giving elements new ids. Sync resumes when it finishes. If it does not, Settings can finish it.' };
      }
      return {
        dataState: 'pending',
        label: engine.reason === 'network' ? 'Offline' : 'Paused',
        title: engine.pending_changes
          ? `${engine.reason === 'network' ? 'Offline' : 'Paused'} · ${engine.pending_changes} pending`
          : engine.reason === 'network'
            ? 'Offline'
            : 'Paused · local edits queued',
      };
    case 'error':
      return {
        dataState: 'error',
        label: 'Error',
        title: engine.message,
      };
  }
}

/**
 * Single-shared interval to age the pill's "synced X ago" label without
 * needing the state to mutate. Kept module-scoped so re-mounts (world switch,
 * shell reset) don't multiply timers. Tick every 30s — fine resolution for
 * minute-level ages; cheap enough that the wall-clock interval doesn't
 * contend with anything.
 */
let syncPillTickerHandle: ReturnType<typeof setInterval> | null = null;
function ensureSyncPillTicker(toasts: ToastManager): void {
  if (syncPillTickerHandle !== null) return;
  syncPillTickerHandle = setInterval(() => {
    // Only re-render when there is a pill mounted; otherwise the tick is a
    // no-op (cheap).
    if (!document.querySelector('[data-role="sync-pill"]')) return;
    try { renderSyncIndicator(getState(), toasts); } catch { /* defensive */ }
  }, 30_000);
}

/**
 * Pending-push state mirrored from `atlas:pending-push` CustomEvent. Pill
 * renders a decay ring around its dot while this is non-null; ring fill is
 * driven by `--decay-fraction` updated each animation frame.
 */
let currentPendingPush: { scheduledAt: number; debounceMs: number } | null = null;
let pendingPushRafHandle: number | null = null;
let pendingPushListenerInstalled = false;

function ensurePendingPushListener(toasts: ToastManager): void {
  if (pendingPushListenerInstalled) return;
  pendingPushListenerInstalled = true;
  document.addEventListener('atlas:pending-push', ((e: CustomEvent) => {
    const detail = e.detail as { scheduledAt: number | null; debounceMs: number };
    currentPendingPush = detail.scheduledAt === null
      ? null
      : { scheduledAt: detail.scheduledAt, debounceMs: detail.debounceMs };
    try { renderSyncIndicator(getState(), toasts); } catch { /* defensive */ }
    if (currentPendingPush) startDecayTick(toasts);
    else stopDecayTick();
  }) as EventListener);
}

function startDecayTick(toasts: ToastManager): void {
  if (pendingPushRafHandle !== null) return;
  const tick = (): void => {
    if (!currentPendingPush) {
      pendingPushRafHandle = null;
      return;
    }
    const pill = document.querySelector<HTMLElement>('[data-role="sync-pill"]');
    if (pill) {
      const remaining = currentPendingPush.scheduledAt - Date.now();
      const debounceMs = Math.max(1, currentPendingPush.debounceMs);
      const elapsed = Math.max(0, Math.min(debounceMs, debounceMs - remaining));
      pill.style.setProperty('--decay-fraction', String(elapsed / debounceMs));
      // Update the time-left tooltip — rounded to nearest second so it
      // doesn't flicker every frame.
      pill.title = `Saving in ${Math.max(0, Math.ceil(remaining / 1000))}s · click to push now`;
    }
    pendingPushRafHandle = requestAnimationFrame(tick);
  };
  pendingPushRafHandle = requestAnimationFrame(tick);
}

function stopDecayTick(): void {
  if (pendingPushRafHandle !== null) {
    cancelAnimationFrame(pendingPushRafHandle);
    pendingPushRafHandle = null;
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

/**
 * Human-readable "X seconds/minutes/hours ago" for the sync pill label.
 * Returns `null` if the timestamp is unparseable or in the future (don't
 * surface confusing negative ages — fall back to the static label).
 *
 * Buckets: <10s → "just now", <60s → "Ns ago", <60m → "Nm ago",
 * <24h → "Nh ago", otherwise local date.
 */
function formatRelative(iso: string): string | null {
  try {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return null;
    const deltaMs = Date.now() - then;
    if (deltaMs < 0) return null;
    if (deltaMs < 10_000) return 'just now';
    if (deltaMs < 60_000) return `${Math.floor(deltaMs / 1000)}s ago`;
    if (deltaMs < 3_600_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
    if (deltaMs < 86_400_000) return `${Math.floor(deltaMs / 3_600_000)}h ago`;
    return new Date(then).toLocaleDateString();
  } catch {
    return null;
  }
}


