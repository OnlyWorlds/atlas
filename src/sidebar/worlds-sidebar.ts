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
import {
  onHashChange, parseHash, navigate, worldHash, settingsHash,
  writingHash, knowledgeHash, timelineHash, shareHash, importHash,
} from '../core/router';
import { setActiveWorld, saveRegistry, setFavorite, setWorldPaused, deleteWorldEntry } from '../registry/registry';
import { loadHandle, ensureWritable, queryWritable, deleteHandle } from '../store/handle-vault';
import { FsFolderStore, ELockHeld } from '../store/folder-store-fs';
import { CreateWorldModal } from '../ui/create-world-modal';
import { setActiveStore, getActiveStore } from '../core/active-store';
import { LinkWorldModal } from '../ui/link-world-modal';
import { escapeText, escapeAttr } from '../core/dom-utils';
// setupAtlasRoot/recoverAtlasRoot are wired in the welcome panel only (W2).
import { attachSyncEngine, getCurrentSyncEngine, getCurrentSyncWorldId, pullNowAndRefresh } from '../sync/sync-attach';
import { surfaceSyncUnavailable } from '../ui/sync-toasts';
import { resetElementDetailScrollMemory } from '../middle/element-detail';
import { rightTabHashFor } from './sidebar';
import { ToastManager } from '../ui/toast-manager';
import type { WorldRegistryEntry } from '../core/types';

/** One-time "start here" tour tag on +folder — dismissed forever on first hover. */
const TOUR_CREATE_SEEN_KEY = 'atlas_tour_create_seen';

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
    const state = getState();
    const root = state.atlasRoot;
    const recoverable = state.atlasRootRecoverable;
    if (root) {
      // Uniform compound-icon-button row (Captain session 219). Each button
      // reads "+target" via a small `add` glyph + a target glyph, with the
      // full action surfaced in the tooltip. Matches the [+map] / [+pin]
      // pattern in element-detail headers for visual coherence.
      header.innerHTML = `
        <button class="atlas-create-icon-btn atlas-header-add-glyph" data-action="create-local" title="New local world (in your atlas folder)">
          <span class="material-symbols-outlined atlas-add-glyph-plus">add</span>
          <span class="material-symbols-outlined atlas-add-glyph-main">folder</span>
        </button>
        <button class="atlas-create-icon-btn atlas-header-add-glyph" data-action="new-api" title="New API world (creates on onlyworlds.com AND locally)">
          <span class="material-symbols-outlined atlas-add-glyph-plus">add</span>
          <span class="material-symbols-outlined atlas-add-glyph-main">cloud_upload</span>
        </button>
        <button class="atlas-create-icon-btn atlas-header-add-glyph" data-action="link-api" title="Add existing API world (downloads into atlas)">
          <span class="material-symbols-outlined atlas-add-glyph-plus">add</span>
          <span class="material-symbols-outlined atlas-add-glyph-main">link</span>
        </button>
      `;
    } else {
      // No atlas root (recoverable or first-launch): the sidebar header has
      // no actions. The welcome panel in the middle pane is the single CTA
      // for both "+ Set up atlas folder" and "↻ Recover atlas folder."
      // Captain session 221: the sidebar's lone single-glyph button felt
      // orphaned against the column of compound-icon create buttons that
      // appear when a root IS set. Dropping it removes the visual mismatch
      // and consolidates the first-launch path to one place.
      header.innerHTML = '';
    }
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

    // Hover trail (S255v2): hovering a create button paints its explanation
    // into the grounded welcome's detail zone. The welcome panel listens for
    // this event; when it isn't mounted the dispatch is a no-op.
    const dispatchHover = (path: string | null): void => {
      window.dispatchEvent(new CustomEvent('atlas:worlds-path-hover', { detail: { path } }));
    };
    for (const btn of [createBtn, newApiBtn, linkBtn]) {
      if (!btn) continue;
      const path = btn.getAttribute('data-action');
      btn.addEventListener('mouseenter', () => dispatchHover(path));
      btn.addEventListener('mouseleave', () => dispatchHover(null));
    }

    // One-time tour tag: with a fresh root and zero worlds, a small floating
    // label points at +folder — the always-start-here action. First hover
    // dismisses it for good (the detail zone takes over the teaching).
    if (root && getState().registry.worlds.length === 0
        && !localStorage.getItem(TOUR_CREATE_SEEN_KEY) && createBtn) {
      createBtn.classList.add('atlas-tour-target');
      const tag = document.createElement('span');
      tag.className = 'atlas-tour-tag';
      tag.textContent = 'start here';
      header.appendChild(tag);
      createBtn.addEventListener('mouseenter', () => {
        localStorage.setItem(TOUR_CREATE_SEEN_KEY, '1');
        createBtn.classList.remove('atlas-tour-target');
        tag.remove();
      }, { once: true });
    }
    // Setup/recover-atlas buttons moved exclusively to the welcome panel
    // (session 221 W2). The sidebar no longer renders them; their handlers
    // were dropped along with the markup.
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
      toasts.info(!entry.sync_paused ? 'Stayed offline' : 'Sync resumed');
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
        if (!result) { surfaceSyncUnavailable(toasts); return; }
        const total = result.pulled.creates + result.pulled.updates;
        toasts.success(total === 0 ? 'Already up to date' : `Pulled ${result.pulled.creates} new + ${result.pulled.updates} updated`);
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
      // Silent in both pre-root and zero-worlds states (S255v2): pre-root the
      // landing is the one voice; with a root, the tour tag + hover details
      // teach — a narration line under them was redundant.
      listEl.innerHTML = '';
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
    ? '<span class="atlas-world-state-chip api-linked">online</span>'
    : '';
  const favIcon = world.favorite ? 'star' : 'star_border';
  const favCls = world.favorite ? 'is-fav' : '';
  const cls = ['atlas-row', active ? 'selected' : ''].filter(Boolean).join(' ');
  // Hover-reveal sync controls only for api-linked worlds. The dedicated
  // refresh button is gone: the CLOUD state icon is the refresh action now
  // (Captain, 2026-07-10) — one icon fewer, same reach.
  const syncActions = world.state === 'api-linked'
    ? `
        <button type="button" class="atlas-icon-btn-sm sync-action-btn ${world.sync_paused ? 'is-paused' : ''}" data-role="toggle-paused" data-world-id="${escapeAttr(world.id)}" title="${world.sync_paused ? 'Resume sync' : 'Stay offline'}">
          <span class="material-symbols-outlined">${world.sync_paused ? 'play_arrow' : 'pause'}</span>
        </button>`
    : '';
  const pathHint = world.folder?.last_path_hint ?? '';
  const stateIconHtml = world.state === 'api-linked'
    ? `<button type="button" class="atlas-world-cloud-btn" data-role="refresh-world" data-world-id="${escapeAttr(world.id)}" title="Refresh from API">
        <span class="material-symbols-outlined">${stateIcon}</span>
      </button>`
    : `<span class="material-symbols-outlined"${pathHint ? ` title="${escapeAttr(pathHint)}"` : ''}>${stateIcon}</span>`;
  return `
    <div class="${cls}" data-world-id="${escapeAttr(world.id)}" role="button" tabindex="0"${pathHint ? ` title="${escapeAttr(pathHint)}"` : ''}>
      ${stateIconHtml}
      <span class="atlas-row-main">${escapeText(world.name)}</span>
      ${stateChip}
      <span class="atlas-inline-actions">${syncActions}
        <button type="button" class="atlas-icon-btn-sm fav-btn ${favCls}" data-role="fav-toggle" data-world-id="${escapeAttr(world.id)}" title="${world.favorite ? 'Unfavorite' : 'Favorite'}">
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
// Concurrent activations interleave on the SHARED active store: the second
// call's `prior.close()` closes the first call's just-opened store mid-flight,
// its `listElements` throws "FsFolderStore not open", and the catch primes
// `elements: []` — the "world opens empty sometimes" race (boot-path
// activation overlapping an early sidebar click, or a double-click). All
// activations serialize through this chain; a queued request that has been
// superseded by a newer click is skipped instead of run.
let activationSeq = 0;
let activationChain: Promise<unknown> = Promise.resolve();

export async function activateWorld(
  worldId: string,
  toasts: ToastManager,
  opts: ActivateWorldOpts = {}
): Promise<boolean> {
  const gen = ++activationSeq;
  const run = activationChain.then(async () => {
    if (gen !== activationSeq) return false; // superseded while queued
    // Watchdog: an activation that WEDGES (observed 2026-07-10 on OPFS after
    // rapid reloads — a first listElements that never resolves, suspected
    // stale OPFS write-lock held by the bfcached previous document) would
    // otherwise show "Opening world…" forever with no explanation. Honest
    // guidance beats silence; the hang itself is banked for forensics.
    const watchdog = setTimeout(() => {
      if (getState().data.loading) {
        toasts.info('This world is taking unusually long to open. A reload usually clears it.');
      }
    }, 15_000);
    try {
      return await doActivateWorld(worldId, toasts, opts);
    } finally {
      clearTimeout(watchdog);
      // Whatever path activation took (success primes, failures return
      // early), the loading flag must not outlive the attempt — a stuck
      // flag would show "Opening world…" forever.
      const d = getState().data;
      if (d.loading) patchSlice('data', { ...d, loading: false });
    }
  });
  // The chain must survive a failed activation (never reject downstream).
  activationChain = run.then(() => undefined, () => undefined);
  return run;
}

async function doActivateWorld(
  worldId: string,
  toasts: ToastManager,
  opts: ActivateWorldOpts = {}
): Promise<boolean> {
  const { silent = false, preserveSelection = false, permissionMode = 'request' } = opts;
  const state = getState();
  const entry = state.registry.worlds.find(w => w.id === worldId);
  if (!entry) {
    if (!silent) toasts.error(`World ${worldId} not found in registry`);
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
  // Tabs are GLOBAL across world switches by design (DESIGN_MAPS.md §5 revised
  // session 209). Tabs whose mapId isn't in the active world's elements get
  // the stale visual treatment (darkened, click-to-close) in right-pane.ts.
  if (!preserveSelection) {
    // loading:true — the cache is about to be primed async; empty ≠ loading
    // (the misleading empty-home flash, 2026-07-10).
    patchSlice('data', { elements: [], loading: true });
    // knowledgeLens + castAssign cleared too — both reference the OLD world.
    patchSlice('ui', { ...getState().ui, selectedElementId: null, knowledgeLens: null, castAssign: null });
    const currentRoute = parseHash(window.location.hash);
    if (currentRoute.worldId !== worldId) {
      // Room-stable world switch (S256, Captain: "less jumpy"): world-agnostic
      // room KINDS follow to the new world at their landing level; specific
      // entity ids (narrative/entry/page/focus) are world-bound and drop.
      // Element + map routes fall to home. Settings keeps its tab — the
      // original 2026-07-10 precedent this generalizes.
      switch (currentRoute.mode) {
        case 'settings':
          navigate(settingsHash(worldId, currentRoute.settingsTab));
          break;
        case 'writing':
          navigate(writingHash(worldId));
          break;
        case 'knowledge':
          navigate(knowledgeHash(worldId));
          break;
        case 'timeline':
          navigate(timelineHash(worldId));
          break;
        case 'share':
          navigate(shareHash(worldId));
          break;
        case 'import':
          navigate(importHash(worldId));
          break;
        default:
          // element / map / home / anything world-bound → home. (Session 223:
          // activate → home, not /elements; sidebar mode is independent UI
          // state, activation doesn't force a flip.)
          navigate(worldHash(worldId));
      }
    }
  } else {
    patchSlice('data', { ...getState().data, loading: true });
  }

  const handle = await loadHandle(entry.folder.handle_key);
  if (!handle) {
    if (!silent) toasts.error(`Folder handle missing for ${entry.name}. Delete + recreate to recover.`);
    if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
    return false;
  }
  const granted = permissionMode === 'query'
    ? await queryWritable(handle)
    : await ensureWritable(handle);
  if (!granted) {
    if (!silent) toasts.error(`Folder permission denied for ${entry.name}`);
    if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
    return false;
  }

  // Close prior active store if any.
  const prior = getActiveStore();
  if (prior) await prior.close().catch(() => {});
  // World switch: drop scroll memory so stale element ids from the previous
  // world don't survive into this one.
  resetElementDetailScrollMemory();

  let store = new FsFolderStore();
  try {
    await store.open(handle);
  } catch (err) {
    // Folder gone from disk (user deleted it outside atlas). The handle in
    // IDB is now a dead reference — clean up the registry entry + handle so
    // the world stops appearing in the sidebar. No data loss: the folder is
    // already gone; we're just removing the pointer to it.
    if (isFolderMissing(err)) {
      await deleteHandle(entry.folder.handle_key).catch(() => {});
      const cleaned = deleteWorldEntry(getState().registry, worldId);
      saveRegistry(cleaned);
      patchSlice('registry', cleaned);
      if (!silent) toasts.info(`"${entry.name}" folder is gone; removed from atlas`);
      if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
      return false;
    }
    // Another tab holds a live folder lock. Dead-ending here left the user
    // stranded (Captain, 2026-07-10) — offer an explicit, consented takeover.
    // Never prompt on the silent boot path.
    if (err instanceof ELockHeld && !silent) {
      const hb = Date.parse(err.lock.last_heartbeat);
      const ageS = Number.isFinite(hb) ? Math.max(0, Math.round((Date.now() - hb) / 1000)) : null;
      const take = window.confirm(
        `"${entry.name}" appears to be open in another atlas tab` +
        (ageS != null ? ` (last active ${ageS}s ago)` : '') +
        `.\n\nClose the other tab, or take over here. Taking over while the other tab is still live can cause conflicting writes.\n\nTake over?`
      );
      if (!take) {
        if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
        return false;
      }
      store = new FsFolderStore({ forceTakeLock: true });
      try {
        await store.open(handle);
      } catch (err2) {
        toasts.error(`Failed to open ${entry.name}: ${err2 instanceof Error ? err2.message : String(err2)}`);
        if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
        return false;
      }
    } else {
      if (!silent) toasts.error(`Failed to open ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
      if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
      return false;
    }
  }
  const meta = await store.readWorldMeta();
  setActiveStore(store);

  const nextRegistry = setActiveWorld(getState().registry, worldId);
  saveRegistry(nextRegistry);
  patchSlice('registry', nextRegistry);
  patchSlice('active', { worldId, meta, opened: true });

  // Prime the elements cache for this world.
  try {
    const elements = await store.listElements();
    patchSlice('data', { elements, loading: false });
  } catch (err) {
    console.warn('[worlds-sidebar] failed to prime elements:', err);
    patchSlice('data', { elements: [], loading: false });
  }
  // Orphan-snapshot recovery (Captain smoke session 219): if the user
  // refreshed the page mid-zone-edit, the in-flight snapshot persisted to
  // localStorage. Replay revert via 3-way diff before sync engine attaches
  // so the autosave that fires on the diff doesn't fight with a fresh pull.
  try {
    const { recoverFromOrphanSnapshot } = await import('../tabs/right/zone-edit-mode');
    await recoverFromOrphanSnapshot(worldId, toasts);
    // Re-prime elements after revert so UI reflects the rollback.
    const fresh = await store.listElements();
    patchSlice('data', { elements: fresh });
  } catch (err) {
    console.warn('[worlds-sidebar] orphan-snapshot recovery failed:', err);
  }
  // No tab hydration — tabs are global across world switches (see comment
  // earlier in this function).

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
 * Honor the existing deep URL if it already names this world; otherwise land
 * on elements mode (legacy click→elements behavior).
 */
function navigateAfterActivate(worldId: string): void {
  const route = parseHash(window.location.hash);
  if (route.worldId === worldId) {
    // URL is already on this world (possibly deep route) — re-fire hashchange.
    navigate(window.location.hash);
  } else {
    // Session 223: navigate to home, not /elements. Sidebar mode is now
    // independent state — activation doesn't dictate sidebar mode.
    navigate(worldHash(worldId));
  }
}

/**
 * Detect the "folder is gone from disk" error shape. FS Access API throws
 * DOMException with name 'NotFoundError' when the underlying directory has
 * been deleted out from under the handle. We treat this as "remove from
 * atlas" rather than a real failure.
 */
function isFolderMissing(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  if (e.name === 'NotFoundError') return true;
  // Chrome occasionally throws as a generic Error with a message that names
  // the underlying cause. Best-effort string match for robustness.
  return typeof e.message === 'string' && /not\s*found|no such (file|directory)/i.test(e.message);
}

