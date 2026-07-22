/**
 * Worlds-mode sidebar body.
 *
 * Lists the registry. Clicking a world activates it (re-grants FS permission,
 * opens the FolderStore). "+ Create Local" launches the create-world modal.
 *
 * Body-only — the parent sidebar driver owns the mode toggle (in shell.sidebarToggle)
 * and the footer gear (in shell.sidebarFooter).
 */

import { currentActivationGen, enqueueActivation } from '../core/activation-chain';
import { awaitEviction, evictParkedStore, getActiveStore, parkStore, setActiveStore, takeParkedStore } from '../core/active-store';
import { escapeAttr, escapeText, installRowKeydownActivation } from '../core/dom-utils';
import {
  importHash,
  knowledgeHash,
  navigate,
  onHashChange, parseHash,
  settingsHash,
  shareHash,
  timelineHash,
  worldHash,
  writingHash,
} from '../core/router';
import { getState, patchSlice, subscribe } from '../core/state';
import { deleteWorldEntry, saveRegistry, setActiveWorld, setFavorite, setWorldPaused } from '../registry/registry';
import { ELockHeld, FsFolderStore } from '../store/folder-store-fs';
import { deleteHandle, ensureWritable, loadHandle, queryWritable } from '../store/handle-vault';
import { CreateWorldModal } from '../ui/create-world-modal';
import { LinkWorldModal } from '../ui/link-world-modal';
// setupAtlasRoot/recoverAtlasRoot are wired in the welcome panel only (W2).
import type { WorldRegistryEntry } from '../core/types';
import { resetElementDetailScrollMemory } from '../middle/element-detail';
import { openAccountWorld, refreshAccountWorlds, remoteAccountWorlds } from '../sync/account-worlds';
import { attachSyncEngine, getCurrentSyncEngine, getCurrentSyncWorldId, pullNowAndRefresh } from '../sync/sync-attach';
import { surfaceSyncUnavailable } from '../ui/sync-toasts';
import { ToastManager } from '../ui/toast-manager';
import { rightTabHashFor } from './sidebar';

/** One-time "start here" tour tag on +folder — dismissed forever on first hover. */
const TOUR_CREATE_SEEN_KEY = 'atlas_tour_create_seen';

import { isTourFlagActive } from '../tour/tour-flag';

/**
 * Guided tour running. The tour OWNS the sidebar while it runs, whether or
 * not the user has an atlas root.
 *
 * This used to be `isTouringNoRoot` (`!atlasRoot && isTourFlagActive()`) and
 * was tested BELOW the `if (root)` branch, which made it dead for anyone
 * replaying the tour after finishing it — finishing is precisely what sets a
 * root. Those users took the root branch, whose create button opens a PLAIN
 * modal with no `overrideCreate`, while `tour-bar` gates the create-world
 * step on `tourWorldExists()` and renders no forward control until it passes.
 * No Next, no scripted create: hard stuck at step 1. Worse, pressing the live
 * +folder built a REAL world in their own root and left them stuck anyway.
 */
function isTouring(): boolean {
  return isTourFlagActive();
}

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
    // ORDER IS LOAD-BEARING: the tour branch is tested FIRST. A replayer has a
    // root (finishing the tour is what sets one), and the root branch's create
    // button carries no tour override — see `isTouring`.
    if (root && !isTouring()) {
      // Uniform compound-icon-button row (Captain session 219). Each button
      // reads "+target" via a small `add` glyph + a target glyph, with the
      // full action surfaced in the tooltip. Matches the [+map] / [+pin]
      // pattern in element-detail headers for visual coherence.
      header.innerHTML = `
        <button class="atlas-create-icon-btn atlas-header-add-glyph" data-action="create-local" title="New local world (in your OnlyWorlds folder)">
          <span class="material-symbols-outlined atlas-add-glyph-plus">add</span>
          <span class="material-symbols-outlined atlas-add-glyph-main">folder</span>
        </button>
        <button class="atlas-create-icon-btn atlas-header-add-glyph" data-action="open-folder" title="Open an existing world folder from your disk (no copy, no download)">
          <span class="material-symbols-outlined atlas-add-glyph-plus">add</span>
          <span class="material-symbols-outlined atlas-add-glyph-main">folder_open</span>
        </button>
        <button class="atlas-create-icon-btn atlas-header-add-glyph" data-action="new-api" title="New API world (creates on onlyworlds.com AND locally)">
          <span class="material-symbols-outlined atlas-add-glyph-plus">add</span>
          <span class="material-symbols-outlined atlas-add-glyph-main">cloud_upload</span>
        </button>
        <button class="atlas-create-icon-btn atlas-header-add-glyph" data-action="link-api" title="Add existing API world (downloads into atlas)">
          <span class="material-symbols-outlined atlas-add-glyph-plus">add</span>
          <span class="material-symbols-outlined atlas-add-glyph-main">link</span>
        </button>
        <button class="atlas-create-icon-btn atlas-header-add-glyph" data-action="view-api" title="View a world with a read key (downloads it, view only)">
          <span class="material-symbols-outlined atlas-add-glyph-plus">add</span>
          <span class="material-symbols-outlined atlas-add-glyph-main">visibility</span>
        </button>
      `;
    } else if (isTouring()) {
      // Guided tour, stage 1: the sidebar shows its TRUE
      // final structure — all five action icons in their real places — with
      // only create-world live and the rest greyed (Captain's call: the
      // landscape appears once, in its exact geometry; nothing jumps into
      // existence later).
      header.innerHTML = `
        <button class="atlas-create-icon-btn atlas-header-add-glyph atlas-create-pulse" data-action="create-local" title="Create a world. This one is the tour’s: Hyperion.">
          <span class="material-symbols-outlined atlas-add-glyph-plus">add</span>
          <span class="material-symbols-outlined atlas-add-glyph-main">folder</span>
        </button>
        <button class="atlas-create-icon-btn atlas-header-add-glyph atlas-tour-locked" aria-disabled="true" title="Open a world folder already on your drive. Yours to use after the tour.">
          <span class="material-symbols-outlined atlas-add-glyph-plus">add</span>
          <span class="material-symbols-outlined atlas-add-glyph-main">folder_open</span>
        </button>
        <button class="atlas-create-icon-btn atlas-header-add-glyph atlas-tour-locked" aria-disabled="true" title="Create a world that lives on onlyworlds.com as well as on your drive. Yours to use after the tour.">
          <span class="material-symbols-outlined atlas-add-glyph-plus">add</span>
          <span class="material-symbols-outlined atlas-add-glyph-main">cloud_upload</span>
        </button>
        <button class="atlas-create-icon-btn atlas-header-add-glyph atlas-tour-locked" aria-disabled="true" title="Bring in a world you already keep on onlyworlds.com. Yours to use after the tour.">
          <span class="material-symbols-outlined atlas-add-glyph-plus">add</span>
          <span class="material-symbols-outlined atlas-add-glyph-main">link</span>
        </button>
        <button class="atlas-create-icon-btn atlas-header-add-glyph atlas-tour-locked" aria-disabled="true" title="Open someone else's world with a read key, look but do not touch. Yours to use after the tour.">
          <span class="material-symbols-outlined atlas-add-glyph-plus">add</span>
          <span class="material-symbols-outlined atlas-add-glyph-main">visibility</span>
        </button>
      `;
      header.querySelector<HTMLButtonElement>('[data-action="create-local"]')
        ?.addEventListener('click', () => {
          void import('../tour/tour-engine').then(async (engine) => {
            new CreateWorldModal(toasts, undefined, {
              lockedName: 'Hyperion',
              hint: '',
              overrideCreate: async () => { await engine.createWorldFromTour(); },
            }).open();
          });
        });
      return;
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
    const viewBtn = header.querySelector<HTMLButtonElement>('[data-action="view-api"]');
    viewBtn?.addEventListener('click', () => {
      void import('../ui/view-world-modal').then(({ ViewWorldModal }) => {
        new ViewWorldModal(toasts).open();
      });
    });
    const openFolderBtn = header.querySelector<HTMLButtonElement>('[data-action="open-folder"]');
    openFolderBtn?.addEventListener('click', () => {
      void (async () => {
        let picked: FileSystemDirectoryHandle;
        try {
          picked = await (window as unknown as { showDirectoryPicker(opts?: { mode?: string }): Promise<FileSystemDirectoryHandle> })
            .showDirectoryPicker({ mode: 'readwrite' });
        } catch { return; } // user cancelled the picker
        try {
          const { openWorldFolder } = await import('../setup/atlas-root-flow');
          const { worldId, already } = await openWorldFolder(picked);
          if (already) toasts.info('That world is already in atlas. Opening it');
          else toasts.success(`Opened "${picked.name}" in place. The folder stays where it is`);
          const ok = await activateWorld(worldId, toasts);
          // Rollback a JUST-registered folder whose first open failed
          // (read-only media, dead handle) so it doesn't sit permanently
          // unopenable in the sidebar (close-gate LOW). Guarded against the
          // supersede case: never roll back a world that became active.
          if (!ok && !already && getState().active?.worldId !== worldId) {
            const entry = getState().registry.worlds.find(w => w.id === worldId);
            if (entry) {
              await deleteHandle(entry.folder.handle_key).catch(() => {});
              const cleaned = deleteWorldEntry(getState().registry, worldId);
              saveRegistry(cleaned);
              patchSlice('registry', cleaned);
              toasts.info('Removed the folder from the list: it could not be opened');
            }
          }
        } catch (err) {
          toasts.error(err instanceof Error ? err.message : String(err));
        }
      })();
    });

    // Hover trail (S255v2): hovering a create button paints its explanation
    // into the grounded welcome's detail zone. The welcome panel listens for
    // this event; when it isn't mounted the dispatch is a no-op.
    const dispatchHover = (path: string | null): void => {
      window.dispatchEvent(new CustomEvent('atlas:worlds-path-hover', { detail: { path } }));
    };
    // Focus teaches too (S309): a keyboard user tabbing the row gets the same
    // trail — and open-folder joins the loop, which had NO teaching on any
    // input path (its DETAILS entry lives with the welcome panel's map).
    for (const btn of [createBtn, newApiBtn, linkBtn, viewBtn, openFolderBtn]) {
      if (!btn) continue;
      const path = btn.getAttribute('data-action');
      btn.addEventListener('mouseenter', () => dispatchHover(path));
      btn.addEventListener('mouseleave', () => dispatchHover(null));
      btn.addEventListener('focus', () => dispatchHover(path));
      btn.addEventListener('blur', () => dispatchHover(null));
    }

    // ZERO WORLDS: the create action is highlighted for as long as the state
    // lasts (Captain, S308). This used to be a one-time tag dismissed FOREVER
    // on first hover — so a user who set up a folder, brushed the button with
    // the cursor and came back the next day found an unexplained row of five
    // icons and the largest pane on screen saying only "your folder is ready".
    // The state it teaches ("you have nowhere to put anything yet") does not
    // expire on hover, so neither should the signal.
    //
    // The floating "start here" tag KEEPS its one-time behaviour — a label that
    // reappears every session reads as nagging. The persistent half is the
    // quiet highlight on the button; the loud half still fires once.
    if (root && getState().registry.worlds.length === 0 && createBtn) {
      createBtn.classList.add('atlas-tour-target');
      if (!localStorage.getItem(TOUR_CREATE_SEEN_KEY)) {
        const tag = document.createElement('span');
        tag.className = 'atlas-tour-tag';
        tag.textContent = 'start here';
        header.appendChild(tag);
        createBtn.addEventListener('mouseenter', () => {
          localStorage.setItem(TOUR_CREATE_SEEN_KEY, '1');
          tag.remove();
        }, { once: true });
      }
    }
    // Setup/recover-atlas buttons moved exclusively to the welcome panel
    // (session 221 W2). The sidebar no longer renders them; their handlers
    // were dropped along with the markup.
  }

  // List body
  const listEl = document.createElement('div');
  listEl.className = 'atlas-list';
  content.appendChild(listEl);

  // "On OnlyWorlds" — account worlds not yet on disk (account mode, S260).
  // Renders only when signed in; local rows above never wait on it.
  const remoteEl = document.createElement('div');
  remoteEl.className = 'atlas-remote-worlds';
  content.appendChild(remoteEl);

  remoteEl.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const refreshBtn = target.closest<HTMLElement>('[data-role="remote-refresh"]');
    if (refreshBtn) {
      refreshAccountWorlds(true);
      return;
    }
    const row = target.closest<HTMLElement>('[data-remote-world-id]');
    if (!row) return;
    const worldId = row.getAttribute('data-remote-world-id')!;
    const remote = remoteAccountWorlds().find(r => r.id === worldId);
    if (!remote) return;
    if (remote.role === 'collaborator') {
      // Minting is owner-only (server 404s) — the honest path for a shared
      // world is a key from its owner via the existing link flow.
      toasts.info('Shared world: ask its owner for an API key, then link it');
      new LinkWorldModal(toasts).open();
      return;
    }
    await openAccountWorld(remote, toasts);
  });

  // Click delegation — separate the favorite-toggle from the row click.
  installRowKeydownActivation(listEl);
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
        const elementTotal = result.pulled.creates + result.pulled.updates;
        const metaTotal = result.meta_pulled?.length ?? 0;
        // Meta-only pulls already toast "Pulled world settings from API" in
        // pullNowAndRefresh — stay quiet here rather than double-toasting.
        if (elementTotal + metaTotal === 0) toasts.success('Already up to date');
        else if (elementTotal > 0) toasts.success(`Pulled ${result.pulled.creates} new + ${result.pulled.updates} updated`);
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
    // During the tour the list shows the TOUR's world and nothing else. On a
    // first launch this was free (the registry was empty), which is why the
    // filter never existed; on a replay the user's real worlds are sitting
    // there, and the tour would narrate "your world" over a list of them.
    const worlds = isTouring()
      ? state.registry.worlds.filter(w => w.demo === true)
      : state.registry.worlds;

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

  function renderRemote(): void {
    const state = getState();
    const token = state.registry.account_token;
    if (!token || !state.atlasRoot) {
      remoteEl.innerHTML = '';
      return;
    }
    // R6: render-path fetch trigger — token-identity-guarded no-op when the
    // current token's list is already fetched or in flight. Covers mount AND
    // the sign-in-from-Settings transition without a remount.
    refreshAccountWorlds();
    const aw = state.accountWorlds;
    const rows = remoteAccountWorlds();
    if (aw.status === 'error' && rows.length === 0) {
      remoteEl.innerHTML = `
        <div class="atlas-remote-head">
          <span>On OnlyWorlds</span>
          <button type="button" class="atlas-icon-btn-sm" data-role="remote-refresh" title="Retry">
            <span class="material-symbols-outlined">refresh</span>
          </button>
        </div>
        <div class="atlas-remote-error">${escapeText(aw.error ?? 'Could not reach onlyworlds')}</div>
      `;
      return;
    }
    if (rows.length === 0) {
      // Nothing remote-only (or still loading a first fetch) — stay quiet.
      remoteEl.innerHTML = aw.status === 'loading'
        ? '<div class="atlas-remote-head"><span>On OnlyWorlds</span><span class="atlas-remote-loading">…</span></div>'
        : '';
      return;
    }
    const items = rows.map(r => {
      const opening = aw.opening === r.id;
      const roleChip = r.role === 'collaborator'
        ? '<span class="atlas-world-state-chip">shared</span>'
        : '';
      return `
        <div class="atlas-row atlas-remote-row ${opening ? 'is-opening' : ''}" data-remote-world-id="${escapeAttr(r.id)}" role="button" tabindex="0"
             title="${r.role === 'collaborator' ? 'Shared with you: link with a key from its owner' : 'Open: download this world into your OnlyWorlds folder'}">
          <span class="material-symbols-outlined">${opening ? 'downloading' : 'cloud'}</span>
          <span class="atlas-row-main">${escapeText(r.name)}</span>
          ${roleChip}
          ${opening ? '<span class="atlas-remote-loading">opening…</span>' : ''}
        </div>
      `;
    }).join('');
    remoteEl.innerHTML = `
      <div class="atlas-remote-head">
        <span>On OnlyWorlds</span>
        <button type="button" class="atlas-icon-btn-sm" data-role="remote-refresh" title="Refresh list">
          <span class="material-symbols-outlined">refresh</span>
        </button>
      </div>
      ${items}
    `;
  }

  function renderAll(): void {
    render();
    renderRemote();
  }

  const unsubState = subscribe(renderAll);
  const unsubHash = onHashChange(renderAll);
  renderAll();
  return () => { unsubState(); unsubHash(); };
}

function renderRow(world: WorldRegistryEntry, active: boolean, _settingsActive: boolean, globalPaused: boolean): string {
  // `cloud_off` (strike-through cloud) when this world is paused — either by
  // its own toggle or by the global "pause all sync" master switch. Local-only
  // worlds always render `folder` regardless of pause state (no sync to pause).
  const isPaused = world.state === 'api-linked' && (!!world.sync_paused || globalPaused);
  // View-only worlds (S264, read-key link): the EYE is the identity — the row
  // says at a glance this world is someone else's, read-not-write.
  const viewOnly = world.state === 'api-linked' && !!world.api?.read_only;
  const stateIcon = viewOnly ? 'visibility'
    : world.state === 'api-linked'
      ? (isPaused ? 'cloud_off' : 'cloud')
      : 'folder';
  const stateChip = viewOnly
    ? '<span class="atlas-world-state-chip view-only">view</span>'
    : world.state === 'api-linked'
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
// Serialization moved to core/activation-chain.ts (gate R2, 2026-07-13):
// ONE chain now covers activations AND link/download flows, so a mid-flight
// initial download can't be closed by a world click racing beside it.

export async function activateWorld(
  worldId: string,
  toasts: ToastManager,
  opts: ActivateWorldOpts = {}
): Promise<boolean> {
  return enqueueActivation(async (gen) => {
    if (gen !== currentActivationGen()) return false; // superseded while queued
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
    patchSlice('data', { elements: [], loading: true, loadingProgress: null });
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
    patchSlice('data', { ...getState().data, loading: true, loadingProgress: null });
  }

  const handle = await loadHandle(entry.folder.handle_key);
  if (!handle) {
    // NEVER advise deletion here. The files are intact on disk — only the
    // browser's handle to them is gone (cleared storage, another profile, a
    // moved folder). "Delete + recreate to recover" (the wording until S307)
    // pointed at the one action that actually loses the world, while the real
    // one-click fix is the [+folder_open] button in this very header.
    if (!silent) toasts.error(`Lost access to ${entry.name}'s folder. Your files are safe: use "open an existing world folder" in the sidebar header to point atlas at it again.`);
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

  // PARK the prior store instead of closing it (speed bout, 2026-07-19):
  // heartbeat stops, caches + lock stay — switching back revives it without
  // re-walking the folder. Falls back to close when we can't name it.
  const prior = getActiveStore();
  if (prior) {
    const priorWorldId = getState().active?.worldId ?? null;
    if (priorWorldId && priorWorldId !== worldId) parkStore(priorWorldId, prior);
    else await prior.close().catch(() => {});
  }
  // World switch: drop scroll memory so stale element ids from the previous
  // world don't survive into this one.
  resetElementDetailScrollMemory();

  // Revive a parked store when its lock is still ours; a missing/foreign
  // lock means another tab held the world — close and re-open cold.
  let store: FsFolderStore;
  let revived = false;
  const parked = takeParkedStore(worldId);
  if (parked) {
    if (await parked.unpark()) {
      store = parked;
      revived = true;
    } else {
      await parked.close().catch(() => {});
      store = new FsFolderStore();
    }
  } else {
    store = new FsFolderStore();
  }
  try {
    if (!revived) {
      // A just-evicted parked store's async close may still be deleting the
      // lock file — opening before it finishes would race our fresh claim.
      await awaitEviction(worldId);
      await store.open(handle);
    }
  } catch (err) {
    // Folder gone from disk (user deleted it outside atlas). The handle in
    // IDB is now a dead reference — clean up the registry entry + handle so
    // the world stops appearing in the sidebar. No data loss: the folder is
    // already gone; we're just removing the pointer to it.
    if (isFolderMissing(err)) {
      evictParkedStore(worldId);
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
  // View-only worlds (S264): arm the store guard before the UI can reach it.
  store.setViewOnly(!!entry.api?.read_only);
  setActiveStore(store);

  const nextRegistry = setActiveWorld(getState().registry, worldId);
  saveRegistry(nextRegistry);
  patchSlice('registry', nextRegistry);
  patchSlice('active', { worldId, meta, opened: true });

  // Prime the elements cache for this world. Cold opens report progress —
  // throttled: every patchSlice re-renders subscribers, so per-file patches
  // on a 1500-element walk would burn the win they're reporting on.
  // SUPERSEDE GUARD (close-gate finding, 2026-07-19): if the user activates
  // another world mid-walk, this store is closed and replaced — but the
  // body-cache hit path can still resolve with THIS world's elements (it no
  // longer touches root, so it can't throw the way the disk path did).
  // Without the guard the slower world's resolve stomps the new world's
  // state. Every patch below is gated on this store still being active.
  const stillActive = () => getActiveStore() === store;
  try {
    const elements = await store.listElements(undefined, {
      onProgress: (done, total) => {
        if (total < 100 || !stillActive()) return; // fast opens never flash a counter
        // Count-based throttle (not time): parallel FS reads resolve in
        // bursts, so time windows can swallow the whole spread. Every 100
        // files = ≤ ~15 renders on the biggest worlds, evenly spaced by work.
        if (done % 100 !== 0 && done !== total && done !== 0) return;
        patchSlice('data', { ...getState().data, loadingProgress: { done, total } });
      },
    });
    if (stillActive()) patchSlice('data', { elements, loading: false, loadingProgress: null });
  } catch (err) {
    console.warn('[worlds-sidebar] failed to prime elements:', err);
    if (stillActive()) patchSlice('data', { elements: [], loading: false, loadingProgress: null });
  }
  if (!stillActive()) return true; // superseded — the newer activation owns state now
  // Orphan-snapshot recovery (Captain smoke session 219): if the user
  // refreshed the page mid-zone-edit, the in-flight snapshot persisted to
  // localStorage. Replay revert via 3-way diff before sync engine attaches
  // so the autosave that fires on the diff doesn't fight with a fresh pull.
  try {
    const { recoverFromOrphanSnapshot } = await import('../tabs/right/zone-edit-mode');
    const recovered = await recoverFromOrphanSnapshot(worldId, toasts);
    if (recovered) {
      // Re-prime elements after an ACTUAL revert so UI reflects the rollback
      // (cheap now — the body cache absorbed the revert writes).
      const fresh = await store.listElements();
      patchSlice('data', { elements: fresh });
    }
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

