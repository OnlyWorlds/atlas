/**
 * Worlds-mode sidebar body.
 *
 * Lists the registry. Clicking a world activates it (re-grants FS permission,
 * opens the FolderStore). "+ Create Local" launches the create-world modal.
 *
 * Body-only — the parent sidebar driver owns the mode toggle (in shell.sidebarToggle)
 * and the footer gear (in shell.sidebarFooter).
 */

import { getState, subscribe, patchSlice } from '../core/state';
import { onHashChange, parseHash, navigate, elementsHash } from '../core/router';
import { setActiveWorld, saveRegistry, setFavorite, setWorldPaused, setWorldRightTabs, getWorldRightTabs } from '../registry/registry';
import { loadHandle, ensureWritable, queryWritable } from '../store/handle-vault';
import { FsFolderStore } from '../store/folder-store-fs';
import { setActiveStore, getActiveStore, CreateWorldModal } from '../ui/create-world-modal';
import { LinkWorldModal } from '../ui/link-world-modal';
import { setupAtlasRoot } from '../setup/atlas-root-flow';
import { attachSyncEngine, getCurrentSyncEngine, getCurrentSyncWorldId, pullNowAndRefresh } from '../sync/sync-attach';
import { resetElementDetailScrollMemory } from '../middle/element-detail';
import { rightTabHashFor } from './sidebar';
import { ToastManager } from '../ui/toast-manager';
import type { WorldRegistryEntry } from '../core/types';

export interface WorldsBodyMount {
  content: HTMLElement;
  toasts: ToastManager;
}

export function mountWorldsBody(mount: WorldsBodyMount): () => void {
  const { content, toasts } = mount;
  content.innerHTML = '';

  // Header — switches between "set up atlas" and "create local" depending on root state.
  const header = document.createElement('div');
  header.className = 'atlas-section atlas-worlds-header';
  content.appendChild(header);

  function renderHeader(): void {
    const root = getState().atlasRoot;
    header.innerHTML = root
      ? `
        <button class="atlas-btn-ghost" data-action="create-local" title="create a new world in your atlas folder">+ New local</button>
        <button class="atlas-btn-ghost" data-action="new-api" title="create a new world on onlyworlds.com AND in your atlas folder">+ New API</button>
        <button class="atlas-btn-ghost" data-action="link-api" title="download an existing OnlyWorlds api world into atlas">+ Link API</button>
      `
      : `
        <button class="atlas-btn-ghost" data-action="setup-atlas" title="pick the folder atlas will use for all your worlds">+ Set up atlas</button>
      `;
    const createBtn = header.querySelector<HTMLButtonElement>('[data-action="create-local"]');
    createBtn?.addEventListener('click', () => new CreateWorldModal(toasts).open());
    const newApiBtn = header.querySelector<HTMLButtonElement>('[data-action="new-api"]');
    newApiBtn?.addEventListener('click', () => {
      void import('../ui/new-api-world-modal').then(({ NewApiWorldModal }) => {
        new NewApiWorldModal(toasts).open();
      });
    });
    const linkBtn = header.querySelector<HTMLButtonElement>('[data-action="link-api"]');
    linkBtn?.addEventListener('click', () => new LinkWorldModal(toasts).open());
    const setupBtn = header.querySelector<HTMLButtonElement>('[data-action="setup-atlas"]');
    setupBtn?.addEventListener('click', async () => {
      setupBtn.disabled = true;
      try {
        const result = await setupAtlasRoot();
        if (result) {
          toasts.success(
            result.imported > 0
              ? `atlas folder set up — found ${result.imported} existing world${result.imported === 1 ? '' : 's'}`
              : 'atlas folder is set up'
          );
        }
      } catch (err) {
        toasts.error(err instanceof Error ? err.message : String(err));
      } finally {
        setupBtn.disabled = false;
      }
    });
  }

  // List body
  const listEl = document.createElement('div');
  listEl.className = 'atlas-list';
  content.appendChild(listEl);

  // Click delegation — separate the favorite-toggle from the row click.
  listEl.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const favBtn = target.closest<HTMLElement>('[data-role="fav-toggle"]');
    if (favBtn) {
      e.stopPropagation();
      const worldId = favBtn.getAttribute('data-world-id')!;
      const reg = getState().registry;
      const entry = reg.worlds.find(w => w.id === worldId);
      if (!entry) return;
      const next = setFavorite(reg, worldId, !entry.favorite);
      saveRegistry(next);
      patchSlice('registry', next);
      return;
    }
    const pauseBtn = target.closest<HTMLElement>('[data-role="toggle-paused"]');
    if (pauseBtn) {
      e.stopPropagation();
      const worldId = pauseBtn.getAttribute('data-world-id')!;
      const reg = getState().registry;
      const entry = reg.worlds.find(w => w.id === worldId);
      if (!entry) return;
      const next = setWorldPaused(reg, worldId, !entry.sync_paused);
      saveRegistry(next);
      patchSlice('registry', next);
      // If this is the active world's engine, toggle its pause state immediately.
      if (worldId === getCurrentSyncWorldId()) {
        const engine = getCurrentSyncEngine();
        if (engine) {
          if (!entry.sync_paused) engine.pause('manual');
          else engine.resume();
        }
      }
      toasts.info(!entry.sync_paused ? 'stayed offline' : 'sync resumed');
      return;
    }
    const refreshBtn = target.closest<HTMLElement>('[data-role="refresh-world"]');
    if (refreshBtn) {
      e.stopPropagation();
      const worldId = refreshBtn.getAttribute('data-world-id')!;
      // If the world isn't active yet, activate it first; refresh fires after.
      if (worldId !== getCurrentSyncWorldId()) {
        const ok = await activateWorld(worldId, toasts);
        if (!ok) return;
      }
      try {
        const result = await pullNowAndRefresh();
        if (!result) { toasts.info('engine not ready'); return; }
        const total = result.pulled.creates + result.pulled.updates;
        toasts.success(total === 0 ? 'already up to date' : `pulled ${result.pulled.creates} new + ${result.pulled.updates} updated`);
      } catch (err) {
        toasts.error(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    const row = target.closest<HTMLElement>('[data-world-id]');
    if (!row) return;
    const worldId = row.getAttribute('data-world-id')!;
    await activateWorld(worldId, toasts);
  });

  function render(): void {
    renderHeader();
    const state = getState();
    const route = parseHash(window.location.hash);
    const activeId = state.active?.worldId;
    const worlds = state.registry.worlds;

    if (worlds.length === 0) {
      listEl.innerHTML = state.atlasRoot
        ? `<div class="atlas-pane-empty">No worlds yet — create one to start.</div>`
        : `<div class="atlas-pane-empty">Set up your atlas folder above to begin.</div>`;
      return;
    }

    // Favorites first, then alphabetical.
    const sorted = [...worlds].sort((a, b) => {
      const fa = a.favorite ? 1 : 0;
      const fb = b.favorite ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
    const globalPaused = !!state.registry.sync_pause_all;
    listEl.innerHTML = sorted
      .map(w => renderRow(w, w.id === activeId, route.mode === 'settings' && w.id === activeId, globalPaused))
      .join('');
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();
  return () => { unsubState(); unsubHash(); };
}

function renderRow(world: WorldRegistryEntry, active: boolean, _settingsActive: boolean, globalPaused: boolean): string {
  // `cloud_off` (strike-through cloud) when this world is paused — either by
  // its own toggle or by the global "pause all sync" master switch. Local-only
  // worlds always render `folder` regardless of pause state (no sync to pause).
  const isPaused = world.state === 'api-linked' && (!!world.sync_paused || globalPaused);
  const stateIcon = world.state === 'api-linked'
    ? (isPaused ? 'cloud_off' : 'cloud')
    : 'folder';
  const stateChip = world.state === 'api-linked'
    ? '<span class="atlas-world-state-chip api-linked">api</span>'
    : '';
  const favIcon = world.favorite ? 'star' : 'star_border';
  const favCls = world.favorite ? 'is-fav' : '';
  const cls = ['atlas-row', active ? 'selected' : ''].filter(Boolean).join(' ');
  // Hover-reveal sync controls only for api-linked worlds.
  const syncActions = world.state === 'api-linked'
    ? `
        <button type="button" class="atlas-icon-btn-sm sync-action-btn ${world.sync_paused ? 'is-paused' : ''}" data-role="toggle-paused" data-world-id="${escapeAttr(world.id)}" title="${world.sync_paused ? 'resume sync' : 'stay offline'}">
          <span class="material-symbols-outlined">${world.sync_paused ? 'play_arrow' : 'pause'}</span>
        </button>
        <button type="button" class="atlas-icon-btn-sm sync-action-btn" data-role="refresh-world" data-world-id="${escapeAttr(world.id)}" title="refresh from api">
          <span class="material-symbols-outlined">refresh</span>
        </button>`
    : '';
  return `
    <div class="${cls}" data-world-id="${escapeAttr(world.id)}" role="button" tabindex="0">
      <span class="material-symbols-outlined">${stateIcon}</span>
      <span class="atlas-row-main">${escapeText(world.name)}</span>
      ${stateChip}
      <span class="atlas-inline-actions">${syncActions}
        <button type="button" class="atlas-icon-btn-sm fav-btn ${favCls}" data-role="fav-toggle" data-world-id="${escapeAttr(world.id)}" title="${world.favorite ? 'unfavorite' : 'favorite'}">
          <span class="material-symbols-outlined">${favIcon}</span>
        </button>
      </span>
    </div>
  `;
}

export interface ActivateWorldOpts {
  /** No toasts on failure paths. Useful for silent boot-time auto-activation. */
  silent?: boolean;
  /** Keep `selectedElementId` as-is (so a URL like /element/<eid> survives activation). Default false. */
  preserveSelection?: boolean;
  /**
   * `request` (default) calls `requestPermission` — needs a user gesture, throws/returns false otherwise.
   * `query` calls `queryPermission` only — silent, used at boot when no gesture is available.
   */
  permissionMode?: 'request' | 'query';
}

/**
 * Activate (or re-activate) a world by id: recall its FS handle from the vault,
 * re-grant write permission, open the FolderStore, push state. Also primes the
 * `data.elements` cache from the newly-opened folder.
 *
 * Returns true on success. Returns false silently if the silent/query path
 * couldn't acquire permission — caller decides what to surface.
 *
 * Navigation behavior on success:
 * - If the current URL already names this world (e.g. user reloaded into a deep
 *   `/element/<eid>` URL), the URL is preserved and a hashchange is fired so
 *   subscribers re-resolve.
 * - Otherwise, navigates to `elementsHash(worldId)` for legacy parity (clicking
 *   a world drops the user into elements mode, not the welcome panel).
 */
export async function activateWorld(
  worldId: string,
  toasts: ToastManager,
  opts: ActivateWorldOpts = {}
): Promise<boolean> {
  const { silent = false, preserveSelection = false, permissionMode = 'request' } = opts;
  const state = getState();
  const entry = state.registry.worlds.find(w => w.id === worldId);
  if (!entry) {
    if (!silent) toasts.error(`world ${worldId} not found in registry`);
    return false;
  }
  // Already active? Click should still "open" — switch to the right-tab view
  // if we're not already on a meaningful one. Without this, clicking the
  // already-active world from worlds-mode (default landing) appeared to do
  // nothing — Captain flagged this as a regression in the Bout CC follow-up.
  if (state.active?.worldId === worldId) {
    const route = parseHash(window.location.hash);
    const onRightTab =
      route.mode === 'elements' ||
      route.mode === 'element' ||
      route.mode === 'map' ||
      route.mode === 'timeline';
    if (!onRightTab) {
      // Worlds-mode landing or Settings → switch to the right tab (selected
      // element if any, else elements list).
      navigate(rightTabHashFor(state.active));
    } else {
      // Already on a right-tab route — re-fire hashchange so subscribers can
      // refresh against the (re-clicked) world.
      navigate(window.location.hash);
    }
    return true;
  }

  // INSTANT-FEEL navigation (normal click path only).
  //
  // The slow part of world activation is the FS work below (handle resolve,
  // permission re-grant, store.open, listElements). Pre-fix, navigation
  // happened AFTER all that — the user clicked, the UI froze ~500ms, then
  // suddenly switched. Move the cheap stuff up: clear stale cache + flip the
  // URL synchronously, so the sidebar toggle re-renders against the new
  // world's URL in the same frame as the click. The elements list mounts
  // empty until FS reads complete; the user sees the switch happen
  // immediately and the loading delay bleeds into a brief empty state rather
  // than into a frozen UI.
  //
  // The toggle reads world name from registry+URL (not state.active), so the
  // right-tab label flips correctly before state.active fills in.
  //
  // preserveSelection=true (boot path with a deep URL) skips this: the URL
  // already names the world, we don't want to wipe selection that the URL is
  // about to re-establish.
  const priorHash = window.location.hash;
  // Snapshot the outgoing world's right-pane tabs into its registry entry
  // BEFORE we touch state. Per-world tab persistence (DESIGN_MAPS.md §5):
  // each world remembers which maps it had open and which was active. Even
  // on the preserve-selection boot path we snapshot, since the active world
  // might have just been activated by /wake-style code paths.
  const priorActive = state.active?.worldId;
  if (priorActive && priorActive !== worldId) {
    const priorUi = getState().ui;
    const snapshotted = setWorldRightTabs(state.registry, priorActive, {
      tabs: priorUi.rightTabs,
      activeIndex: priorUi.rightActiveIndex,
    });
    saveRegistry(snapshotted);
    patchSlice('registry', snapshotted);
  }
  if (!preserveSelection) {
    patchSlice('data', { elements: [] });
    patchSlice('ui', { ...getState().ui, selectedElementId: null });
    const currentRoute = parseHash(window.location.hash);
    if (currentRoute.worldId !== worldId) {
      navigate(elementsHash(worldId));
    }
  }

  const handle = await loadHandle(entry.folder.handle_key);
  if (!handle) {
    if (!silent) toasts.error(`folder handle missing for ${entry.name}. delete + recreate to recover.`);
    if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
    return false;
  }
  const granted = permissionMode === 'query'
    ? await queryWritable(handle)
    : await ensureWritable(handle);
  if (!granted) {
    if (!silent) toasts.error(`folder permission denied for ${entry.name}`);
    if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
    return false;
  }

  // Close prior active store if any.
  const prior = getActiveStore();
  if (prior) await prior.close().catch(() => {});
  // World switch: drop scroll memory so stale element ids from the previous
  // world don't survive into this one.
  resetElementDetailScrollMemory();

  const store = new FsFolderStore();
  await store.open(handle);
  const meta = await store.readWorldMeta();
  setActiveStore(store);

  const nextRegistry = setActiveWorld(state.registry, worldId);
  saveRegistry(nextRegistry);
  patchSlice('registry', nextRegistry);
  patchSlice('active', { worldId, meta, opened: true });

  // Prime the elements cache for this world.
  try {
    const elements = await store.listElements();
    patchSlice('data', { elements });
  } catch (err) {
    console.warn('[worlds-sidebar] failed to prime elements:', err);
    patchSlice('data', { elements: [] });
  }

  // Hydrate right-pane tabs from the registry snapshot. Filter out stale
  // map tabs whose ids aren't in the world's elements (the map was deleted
  // while this world was inactive). Falls back to map-index-only default.
  hydrateRightTabsFromRegistry(worldId);

  // Attach SyncEngine if this world is api-linked. Auto-detaches the previous
  // world's engine. For local-only worlds this is a no-op (returns null).
  attachSyncEngine(entry, store);

  if (preserveSelection) {
    // Boot path: URL was already correct (deep route, possibly with /element/<id>).
    // Fire hashchange so route-aware subscribers re-resolve against the now-
    // populated state. Non-boot already navigated synchronously above.
    navigateAfterActivate(worldId);
  }
  return true;
}

/**
 * Restore the right-pane tabs for the just-activated world from the registry
 * snapshot. Drops any cached map-tab whose mapId isn't in the world's
 * elements cache (cleanup for maps deleted while the world was inactive).
 * If no snapshot exists, falls back to the default `[{kind:'map-index'}]`.
 */
function hydrateRightTabsFromRegistry(worldId: string): void {
  const state = getState();
  const snap = getWorldRightTabs(state.registry, worldId);
  const validMapIds = new Set(
    state.data.elements.filter(e => e.type === 'map').map(e => e.id),
  );
  if (!snap) {
    patchSlice('ui', { ...getState().ui, rightTabs: [{ kind: 'map-index' }], rightActiveIndex: 0 });
    return;
  }
  const tabs = snap.tabs.filter(t => t.kind === 'map-index' || validMapIds.has(t.mapId));
  if (tabs.length === 0) tabs.push({ kind: 'map-index' });
  const activeIndex = Math.max(0, Math.min(snap.activeIndex, tabs.length - 1));
  patchSlice('ui', { ...getState().ui, rightTabs: tabs, rightActiveIndex: activeIndex });
}

/**
 * Honor the existing deep URL if it already names this world; otherwise land
 * on elements mode (legacy click→elements behavior).
 */
function navigateAfterActivate(worldId: string): void {
  const route = parseHash(window.location.hash);
  if (route.worldId === worldId) {
    // URL is already on this world (possibly deep route) — re-fire hashchange.
    navigate(window.location.hash);
  } else {
    navigate(elementsHash(worldId));
  }
}

// ---- Escapes ----

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}
