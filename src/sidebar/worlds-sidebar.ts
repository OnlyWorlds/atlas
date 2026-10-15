/**
 * Worlds-mode sidebar body.
 *
 * Lists the registry. Clicking a world activates it (re-grants FS permission,
 * opens the FolderStore). "+ Create Local" launches the create-world modal.
 *
 * Body-only — the parent sidebar driver owns the mode toggle (in shell.sidebarToggle)
 * and the footer gear (in shell.sidebarFooter).
 */

import { hasFolderMode } from '../core/capabilities';
import { isAtlasGrounded } from '../core/grounded';
import { addWorldLabel, newWorldGlyph, openAddWorldChooser, runAddWorldAction, type AddWorldAction } from '../setup/world-doors';
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
import { deleteWorldEntry, effectiveSyncPaused, saveRegistry, setActiveWorld, setFavorite, setWorldPaused } from '../registry/registry';
import { ELockHeld, FsFolderStore } from '../store/folder-store-fs';
import { deleteHandle, ensureWritable, queryWritable } from '../store/handle-vault';
import { MOVING_IN_ANOTHER_TAB, deriveBrowserWorldHandle, filesWhereOf, isBrowserWorld, isGoneError, markWorldCleared, unmarkWorldCleared, worldHandleFor } from '../core/browser-worlds';
import { CreateWorldModal } from '../ui/create-world-modal';
// setupAtlasRoot/recoverAtlasRoot are wired in the welcome panel only (W2).
import type { WorldRegistryEntry } from '../core/types';
import { resetElementDetailScrollMemory } from '../middle/element-detail';
import { openAccountWorld, refreshAccountWorlds, remoteAccountWorlds } from '../sync/account-worlds';
import { attachSyncEngine, getCurrentSyncEngine, getCurrentSyncWorldId, pullNowAndRefresh } from '../sync/sync-attach';
import { surfaceSyncUnavailable } from '../ui/sync-toasts';
import { showProblem } from '../ui/problem-fixes';
import { ToastManager } from '../ui/toast-manager';
import { rightTabHashFor } from './sidebar';

/** One-time "start here" tour tag on +folder — dismissed forever on first hover. */
const TOUR_CREATE_SEEN_KEY = 'atlas_tour_create_seen';

import { isTourFlagActive } from '../tour/tour-flag';
import { loadWorldStyles, resetWorldStyles } from '../core/world-styles-state';
import { loadMutedTypes } from '../core/type-mutes';
import { flushBeforeLeavingWorld } from '../core/leave-flush';

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
    const root = isAtlasGrounded(state);
    const recoverable = state.atlasRootRecoverable;
    // ORDER IS LOAD-BEARING: the tour branch is tested FIRST. A replayer has a
    // root (finishing the tour is what sets one), and the root branch's create
    // button carries no tour override — see `isTouring`.
    if (root && !isTouring()) {
      // Uniform compound-icon-button row (Captain session 219). Each button
      // reads "+target" via a small `add` glyph + a target glyph, with the
      // full action surfaced in the tooltip. Matches the [+map] / [+pin]
      // pattern in element-detail headers for visual coherence.
      // The icon row is Captain's (S219) and stays the default; the labelled
      // "add a world" button under it opens the same five as plain rows, and
      // Settings → General can hide the icons (S365).
      // Each icon names its action twice (S369): `title` for the pointer,
      // `aria-label` (the chooser's own row title) for a screen reader, which
      // would otherwise read the glyphs' ligature text ("add folder_open").
      const icons = state.registry.worlds_add_icons === false ? '' : `<div class="atlas-worlds-add-icons">
        ${addIconButton('create-local', newWorldGlyph(), hasFolderMode() ? 'Start a world: in a folder on your drive or in this browser' : 'Start a world: kept in this browser')}
        ${hasFolderMode() ? addIconButton('open-folder', 'folder_open', 'Open a world folder you already have. It opens where it is; nothing is copied.') : ''}
        ${addIconButton('new-api', 'cloud_upload', hasFolderMode() ? 'New world on OnlyWorlds: made on onlyworlds.com and on your drive or in this browser' : 'New world on OnlyWorlds: made on onlyworlds.com and in this browser')}
        ${addIconButton('link-api', 'link', 'Download a world from OnlyWorlds with its API key')}
        ${addIconButton('view-api', 'visibility', 'View a shared world with a read key, view only')}
        </div>`;
      header.innerHTML = `${icons}
        <button type="button" class="atlas-worlds-add-btn" data-action="add-world">
          <span class="material-symbols-outlined" aria-hidden="true">add</span>Add a world
        </button>
      `;
    } else if (isTouring()) {
      // Guided tour, stage 1: the sidebar shows its TRUE
      // final structure — all five action icons in their real places — with
      // only create-world live and the rest greyed (Captain's call: the
      // landscape appears once, in its exact geometry; nothing jumps into
      // existence later).
      // Same geometry as the real header: the icon wrapper and the labelled
      // button, locked (S365 gate lens C L3: nothing appears after the tour).
      header.innerHTML = `
        <div class="atlas-worlds-add-icons">
        ${addIconButton('create-local', newWorldGlyph(), 'Start a world. This one is the tour’s: Hyperion.', { pulse: true })}
        ${hasFolderMode() ? addIconButton('open-folder', 'folder_open', 'Open a world folder already on your drive. Yours to use after the tour.', { locked: true }) : ''}
        ${addIconButton('new-api', 'cloud_upload', hasFolderMode() ? 'Create a world that lives on onlyworlds.com as well as on your drive or in this browser. Yours to use after the tour.' : 'Create a world that lives on onlyworlds.com as well as in this browser. Yours to use after the tour.', { locked: true })}
        ${addIconButton('link-api', 'link', 'Bring in a world you already keep on onlyworlds.com. Yours to use after the tour.', { locked: true })}
        ${addIconButton('view-api', 'visibility', 'Open someone else\'s world with a read key, look but do not touch. Yours to use after the tour.', { locked: true })}
        </div>
        <button type="button" class="atlas-worlds-add-btn atlas-tour-locked" aria-disabled="true" title="Every way to add a world. Yours to use after the tour.">
          <span class="material-symbols-outlined" aria-hidden="true">add</span>Add a world
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
    const newApiBtn = header.querySelector<HTMLButtonElement>('[data-action="new-api"]');
    const linkBtn = header.querySelector<HTMLButtonElement>('[data-action="link-api"]');
    const viewBtn = header.querySelector<HTMLButtonElement>('[data-action="view-api"]');
    const openFolderBtn = header.querySelector<HTMLButtonElement>('[data-action="open-folder"]');
    // One runner for the icon row, the chooser and Ctrl+K (S365,
    // setup/world-doors.ts): the four that make a world folder ask for the
    // home folder first when there is none; open-folder opens a world in
    // place, or recognises a folder that keeps worlds.
    for (const btn of [createBtn, newApiBtn, linkBtn, viewBtn, openFolderBtn]) {
      const action = btn?.getAttribute('data-action') as AddWorldAction | null;
      if (btn && action) btn.addEventListener('click', () => { void runAddWorldAction(action, toasts); });
    }
    header.querySelector<HTMLButtonElement>('[data-action="add-world"]')
      ?.addEventListener('click', () => openAddWorldChooser(toasts));

    // Hover trail (S255v2): hovering a create button paints its explanation
    // into the grounded welcome's detail zone. The welcome panel listens for
    // this event; when it isn't mounted the dispatch is a no-op.
    const dispatchHover = (path: string | null): void => {
      window.dispatchEvent(new CustomEvent('atlas:worlds-path-hover', { detail: { path } }));
    };
    // Focus teaches too (S309): a keyboard user tabbing the row gets the same
    // trail — and open-folder joins the loop, which had NO teaching on any
    // input path (its DETAILS entry lives with the welcome panel's map).
    const addWorldBtn = header.querySelector<HTMLButtonElement>('[data-action="add-world"]');
    for (const btn of [createBtn, newApiBtn, linkBtn, viewBtn, openFolderBtn, addWorldBtn]) {
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
    // With the icon row hidden in Settings, the signal goes on "add a world" (S365 lens C M5).
    const startBtn = createBtn ?? addWorldBtn;
    if (root && getState().registry.worlds.length === 0 && startBtn) {
      startBtn.classList.add('atlas-tour-target');
      if (!localStorage.getItem(TOUR_CREATE_SEEN_KEY)) {
        const tag = document.createElement('span');
        tag.className = 'atlas-tour-tag';
        tag.textContent = 'Start here';
        header.appendChild(tag);
        startBtn.addEventListener('mouseenter', () => {
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
    // A shared world opens like an owned one, on a key made for this member (#199).
    await openAccountWorld(remote, toasts);
  });

  // Click delegation — separate the favorite-toggle from the row click.
  installRowKeydownActivation(listEl);
  listEl.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-role="open-file-cleared"]')) {
      // The world's own download restores it under this row (contract §5.2).
      e.stopPropagation();
      void runAddWorldAction('open-file', toasts);
      return;
    }
    const bringDownBtn = target.closest<HTMLElement>('[data-role="bring-down-cleared"]');
    if (bringDownBtn) {
      e.stopPropagation();
      const entry = getState().registry.worlds.find(w => w.id === bringDownBtn.getAttribute('data-world-id'));
      if (!entry?.cleared_at) return;
      void import('../ui/bring-down-again-modal').then(({ BringDownAgainModal }) => new BringDownAgainModal(entry, toasts).open());
      return;
    }
    const removeBtn = target.closest<HTMLElement>('[data-role="remove-cleared"]');
    if (removeBtn) {
      // A world the browser cleared leaves the list only on the user's word
      // (conv. 129); its storage is already gone, so nothing else is removed.
      e.stopPropagation();
      const worldId = removeBtn.getAttribute('data-world-id')!;
      const entry = getState().registry.worlds.find(w => w.id === worldId);
      if (!entry?.cleared_at) return;
      if (!window.confirm(`Remove "${entry.name}" from your list? The browser has already cleared its storage.`)) return;
      const next = deleteWorldEntry(getState().registry, worldId);
      saveRegistry(next);
      patchSlice('registry', next);
      return;
    }
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
      // Active world's engine follows the EFFECTIVE pause, so resuming here
      // does not override Pause all (S367 critic C7).
      const stillPaused = effectiveSyncPaused(next.worlds.find(w => w.id === worldId), next);
      if (worldId === getCurrentSyncWorldId()) {
        const engine = getCurrentSyncEngine();
        if (engine) {
          if (stillPaused) engine.pause('manual');
          else engine.resume();
        }
      }
      toasts.info(!entry.sync_paused
        ? 'Sync paused for this world'
        : stillPaused ? 'This world can sync again, but Pause all sync is still on' : 'Sync resumed');
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
        // pullNowAndRefresh says what came down (the counts, or the conflicts'
        // own toasts): only the nothing-came case is said here (S411).
        if (elementTotal + metaTotal === 0) toasts.success('Already up to date');
      } catch (err) {
        console.warn('[worlds-sidebar] refresh failed:', err);
        showProblem(err, {
          doing: 'refreshing from OnlyWorlds', savedLocally: true, worldId, toasts,
          retry: () => {
            if (worldId !== getCurrentSyncWorldId()) return;
            void pullNowAndRefresh().catch(e2 => showProblem(e2, { doing: 'refreshing from OnlyWorlds', savedLocally: true, worldId, toasts }));
          },
        });
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
    if (!token || !isAtlasGrounded(state)) {
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
        <div class="atlas-remote-error">${escapeText(aw.error ?? 'Could not reach OnlyWorlds')}</div>
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
             title="${r.role === 'collaborator' ? 'Shared with you. ' : ''}${(hasFolderMode() && getState().atlasRoot) ? 'Open: download this world into your OnlyWorlds folder' : 'Open: download this world into this browser'}">
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

/**
 * One "+target" icon button of the add-a-world row. `title` explains it on
 * hover; `aria-label` names it in the chooser's words; the two glyphs are
 * hidden from assistive tech. A tour-locked button carries no `data-action`
 * (nothing may wire it while the tour runs).
 */
function addIconButton(
  action: AddWorldAction,
  glyph: string,
  title: string,
  opts: { locked?: boolean; pulse?: boolean } = {},
): string {
  const cls = ['atlas-create-icon-btn', 'atlas-header-add-glyph', opts.pulse ? 'atlas-create-pulse' : '', opts.locked ? 'atlas-tour-locked' : '']
    .filter(Boolean).join(' ');
  const wiring = opts.locked ? 'aria-disabled="true"' : `data-action="${action}"`;
  return `<button type="button" class="${cls}" ${wiring} title="${escapeAttr(title)}" aria-label="${escapeAttr(addWorldLabel(action))}">
          <span class="material-symbols-outlined atlas-add-glyph-plus" aria-hidden="true">add</span>
          <span class="material-symbols-outlined atlas-add-glyph-main" aria-hidden="true">${glyph}</span>
        </button>`;
}

function renderRow(world: WorldRegistryEntry, active: boolean, _settingsActive: boolean, globalPaused: boolean): string {
  // `cloud_off` (strike-through cloud) when this world is paused — either by
  // its own toggle or by the global "pause all sync" master switch. Local-only
  // worlds always render `folder` regardless of pause state (no sync to pause).
  const isPaused = world.state === 'api-linked' && (!!world.sync_paused || globalPaused);
  // View-only worlds (S264, read-key link): the EYE is the identity — the row
  // says at a glance this world is someone else's, read-not-write.
  const viewOnly = world.state === 'api-linked' && !!world.api?.read_only;
  // A world in this browser's storage carries its own glyph (conv. 129);
  // one the browser cleared says so in the row, never "folder".
  const inBrowser = isBrowserWorld(world);
  const cleared = inBrowser && !!world.cleared_at && world.demo !== true;
  const stateIcon = cleared ? 'browser_not_supported'
    : viewOnly ? 'visibility'
    : world.state === 'api-linked'
      ? (isPaused ? 'cloud_off' : 'cloud')
      : inBrowser ? 'web' : 'folder';
  const stateChip = cleared
    ? '<span class="atlas-world-state-chip cleared" title="Cleared by this browser">cleared</span>'
    : viewOnly
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
  // A cleared row has nothing to sync: no pause, no refresh (S376 lens C C13).
  const syncActions = world.state === 'api-linked' && !cleared
    ? `
        <button type="button" class="atlas-icon-btn-sm sync-action-btn ${world.sync_paused ? 'is-paused' : ''}" data-role="toggle-paused" data-world-id="${escapeAttr(world.id)}" title="${world.sync_paused ? 'Resume sync' : 'Pause sync (this world)'}">
          <span class="material-symbols-outlined">${world.sync_paused ? 'play_arrow' : 'pause'}</span>
        </button>`
    : '';
  const pathHint = cleared
    ? 'Cleared by this browser: its storage for this world is gone.'
    : inBrowser ? 'Stored in this browser' : world.folder?.last_path_hint ?? '';
  // A linked world comes back from onlyworlds.com under this row (contract §3.3).
  const bringDown = cleared && world.api?.api_key
    ? `<button type="button" class="atlas-icon-btn-sm" data-role="bring-down-cleared" data-world-id="${escapeAttr(world.id)}" title="Download it again from onlyworlds.com" aria-label="Download it again">
          <span class="material-symbols-outlined" aria-hidden="true">cloud_download</span>
        </button>`
    : '';
  const removeCleared = cleared
    ? `${bringDown}<button type="button" class="atlas-icon-btn-sm" data-role="open-file-cleared" title="Open a world file: a download of this world brings it back" aria-label="Open a world file">
          <span class="material-symbols-outlined" aria-hidden="true">file_open</span>
        </button>
        <button type="button" class="atlas-icon-btn-sm" data-role="remove-cleared" data-world-id="${escapeAttr(world.id)}" title="Remove from the list" aria-label="Remove from the list">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>`
    : '';
  const stateIconHtml = world.state === 'api-linked' && !cleared
    ? `<button type="button" class="atlas-world-cloud-btn" data-role="refresh-world" data-world-id="${escapeAttr(world.id)}" title="Refresh from OnlyWorlds">
        <span class="material-symbols-outlined">${stateIcon}</span>
      </button>`
    : `<span class="material-symbols-outlined"${pathHint ? ` title="${escapeAttr(pathHint)}"` : ''}>${stateIcon}</span>`;
  return `
    <div class="${cls}" data-world-id="${escapeAttr(world.id)}"${pathHint ? ` title="${escapeAttr(pathHint)}"` : ''}>
      ${stateIconHtml}
      <button type="button" class="atlas-row-main atlas-world-row-open" data-role="open-world"${active ? ' aria-current="true"' : ''}>${escapeText(world.name)}</button>
      ${stateChip}
      <span class="atlas-inline-actions">${syncActions}${removeCleared}
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
  /**
   * No "Finished giving N elements new ids" when the open finishes a re-key:
   * the caller says its own outcome (the tour keep's K0: one "yours now", no
   * id jargon, contract §7.3; S376 lens A A7).
   */
  quietRekey?: boolean;
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
    } catch (err) {
      // An open never rejects (conv. 142, the S405 census): a toast's Open it, a
      // retry and a row click fire this and forget it, so whatever escapes the
      // open's own catches is said here, as what it was doing, never as
      // background work. Silent opens (boot's auto-activate) only log.
      console.warn('[atlas] opening a world failed:', err);
      if (!opts.silent) showProblem(err, { doing: 'opening this world', worldId, toasts, retry: () => { void activateWorld(worldId, toasts); } });
      return false;
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
  const { silent = false, quietRekey = false, preserveSelection = false, permissionMode = 'request' } = opts;
  const state = getState();
  let entry = state.registry.worlds.find(w => w.id === worldId);
  if (!entry) {
    // A stale link or a world removed in another tab (C2, S369: the id and
    // the word "registry" were the whole message).
    if (!silent) toasts.error(hasFolderMode()
      ? 'That world is no longer in your list. If its folder is still on your drive, use Open a world folder to bring it back.'
      : 'That world is no longer in your list.');
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
  // Save what the open rooms still hold for the world being left BEFORE the
  // element cache is emptied below (S360 F1: a room whose element vanished
  // dropped its debounced prose). A no-op when nothing is pending.
  if (!preserveSelection) await flushBeforeLeavingWorld();
  const priorHash = window.location.hash;
  // Tabs are GLOBAL across world switches by design (DESIGN_MAPS.md §5 revised
  // session 209). Tabs whose mapId isn't in the active world's elements get
  // the stale visual treatment (darkened, click-to-close) in right-pane.ts.
  if (!preserveSelection) {
    // loading:true — the cache is about to be primed async; empty ≠ loading
    // (the misleading empty-home flash, 2026-07-10).
    patchSlice('data', { elements: [], loading: true, loadingProgress: null });
    resetWorldStyles();
    // knowledgeLens + castAssign cleared too — both reference the OLD world.
    // Muted types are per world (S356).
    patchSlice('ui', { ...getState().ui, selectedElementId: null, knowledgeLens: null, castAssign: null, mutedTypes: loadMutedTypes(worldId) });
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

  // The world's directory: derived for a browser world (conv. 129), from the
  // vault for a folder world. A browser world whose directory the browser no
  // longer holds keeps its row (and its link) as "Cleared by this browser";
  // the tour's sandbox is torn down instead, and the tour rebuilds it.
  // A move to a folder a crash interrupted finishes first (contract §4.3):
  // before its commit the browser copy is the world; after it, the stale
  // browser copy goes. A no-op when nothing is pending or it must wait.
  if (entry.move || entry.moved_from) {
    const { recoverBrowserMove } = await import('../setup/browser-world-move');
    await recoverBrowserMove(worldId).catch(err => console.warn('[worlds-sidebar] move recovery waits', err)); // raw-error-ok: a console record
    // The registry may have moved on under it (recovery, or another tab's commit).
    entry = getState().registry.worlds.find(w => w.id === worldId) ?? entry;
  }
  // A world being moved (or made) in any tab holds its Web Lock: opening it
  // now would edit a copy about to be removed (S373 gate F2, F8: a duplicated
  // tab shares this tab's id, so the lock file alone cannot tell).
  if (isBrowserWorld(entry)) {
    const { ifWorldLockFree } = await import('../core/browser-home');
    const free = await ifWorldLockFree(entry.folder.folder_name, async () => true);
    if (!free.ran) {
      if (!silent) toasts.info(MOVING_IN_ANOTHER_TAB);
      if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
      return false;
    }
  }
  let resolved: Awaited<ReturnType<typeof worldHandleFor>>;
  try {
    resolved = await worldHandleFor(entry);
  } catch (err) {
    console.warn('[worlds-sidebar] could not reach the world', err);
    if (!silent) showProblem(err, { doing: 'opening this world', worldId, toasts, retry: () => { void activateWorld(worldId, toasts); } });
    if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
    return false;
  }
  if (resolved.kind === 'gone') {
    settleGoneBrowserWorld(entry, silent, toasts);
    if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
    return false;
  }
  if (isBrowserWorld(entry) && entry.cleared_at) {
    // Its directory is back (a restore that finished, or a mark made in error).
    const back = unmarkWorldCleared(getState().registry, worldId);
    saveRegistry(back);
    patchSlice('registry', back);
  }
  const handle = resolved.kind === 'ok' ? resolved.handle : null;
  if (!handle) {
    // NEVER advise deletion here. The files are intact on disk — only the
    // browser's handle to them is gone (cleared storage, another profile, a
    // moved folder). "Delete + recreate to recover" (the wording until S307)
    // pointed at the one action that actually loses the world, while the real
    // one-click fix is the [+folder_open] button in this very header.
    // The toast carries that fix itself (S369): picking the folder again
    // restores this entry's handle (`openWorldFolder` re-stores a missing one).
    if (!silent) {
      toasts.show(
        `Atlas lost access to the folder of "${entry.name}". Your files are safe. Open the folder and pick it again to reconnect.`,
        'error', 8000,
        // The fix is a folder pick, which only a folder-mode browser has.
        hasFolderMode() ? { actions: [{ label: 'Open the folder', run: () => runAddWorldAction('open-folder', toasts) }] } : undefined,
      );
    }
    if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
    return false;
  }
  // Browser storage needs no permission; only a folder on the drive asks.
  const granted = isBrowserWorld(entry)
    ? true
    : permissionMode === 'query'
      ? await queryWritable(handle)
      : await ensureWritable(handle);
  if (!granted) {
    // Worded as a disk-permission problem (S369), whose fix is Allow access:
    // it asks for this world's folder inside the click, then opens it again.
    if (!silent) {
      showProblem(new DOMException('Folder permission was not granted', 'NotAllowedError'), {
        doing: 'opening this world', worldId, toasts,
        retry: () => { void activateWorld(worldId, toasts); },
      });
    }
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
    // A browser world removed between the derive and the open: re-derive.
    // Gone = cleared (the row stays); anything else is a problem. This catch
    // never deletes a browser world's entry (S370 gate B10).
    if (isBrowserWorld(entry) && isFolderMissing(err)) {
      evictParkedStore(worldId);
      let gone = false;
      try { await deriveBrowserWorldHandle(entry); } catch (e) { gone = isGoneError(e); }
      if (gone) {
        settleGoneBrowserWorld(entry, silent, toasts);
      } else if (!silent) {
        showProblem(err, { doing: 'opening this world', worldId, toasts, retry: () => { void activateWorld(worldId, toasts); } });
      }
      if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
      return false;
    }
    if (isFolderMissing(err)) {
      // Confirm against the filesystem before destroying anything. The error
      // name alone is not evidence: it can come from any one of the ~30
      // directory calls inside store.open(). Only a root that is really gone
      // earns the cleanup.
      if (await rootDirectoryIsGone(handle)) {
        evictParkedStore(worldId);
        await deleteHandle(entry.folder.handle_key).catch(() => {});
        const cleaned = deleteWorldEntry(getState().registry, worldId);
        saveRegistry(cleaned);
        patchSlice('registry', cleaned);
        if (!silent) toasts.info(`The folder of "${entry.name}" is gone, so Atlas took it off the list.`);
        if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
        return false;
      }
      // The folder is there; something inside the open failed. Keep the entry
      // and the handle, and say what we actually know.
      console.error('[worlds-sidebar] open failed but the root directory exists', err);
      evictParkedStore(worldId);
      if (!silent) {
        toasts.error(`Could not open ${entry.name}. ${filesWhereOf(entry) === 'browser' ? 'Its storage' : 'The folder'} is still there, so nothing was removed. Try again, and check that no other Atlas tab has it open.`);
      }
      if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
      return false;
    }
    // Another tab is moving this world to a folder: never offered for
    // take-over (1.17, contract §4.4), only said.
    if (err instanceof ELockHeld && err.moving) {
      if (!silent) toasts.info(MOVING_IN_ANOTHER_TAB);
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
        `"${entry.name}" appears to be open in another Atlas tab` +
        (ageS != null ? ` (last active ${ageS}s ago)` : '') +
        `.\n\nClose the other tab, or take over here. Taking over while the other tab is still in use can lose changes.\n\nTake over?`
      );
      if (!take) {
        if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
        return false;
      }
      store = new FsFolderStore({ forceTakeLock: true });
      try {
        await store.open(handle);
      } catch (err2) {
        console.warn('[worlds-sidebar] open after take-over failed:', err2);
        showProblem(err2, { doing: 'opening this world', worldId, toasts, retry: () => { void activateWorld(worldId, toasts); } });
        if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
        return false;
      }
    } else {
      console.warn('[worlds-sidebar] open failed:', err);
      if (!silent) showProblem(err, { doing: 'opening this world', worldId, toasts, retry: () => { void activateWorld(worldId, toasts); } });
      if (!preserveSelection && window.location.hash !== priorHash) navigate(priorHash);
      return false;
    }
  }
  const meta = await store.readWorldMeta();
  // View-only worlds (S264): arm the store guard before the UI can reach it.
  store.setViewOnly(!!entry.api?.read_only);
  // The world's notes, cast, calendar lens and writing labels, from its
  // folder (S364). BEFORE re-key recovery: recovery remaps the registry's
  // cast ids, and the prefs sync then writes the remapped ids back out.
  {
    const { loadWorldPrefs } = await import('../core/world-prefs');
    await loadWorldPrefs(store, worldId);
  }
  // An id update that did not finish (a crash, a closed tab) completes HERE,
  // on both the open and the revive path, before anything reads the world
  // (S363, re-key gate lens 1 F3/F6): otherwise the list would show old and
  // new elements as twins. Until it completes the sync engine refuses every
  // round (the journal gate), so a failure here costs sync, never data.
  if (await store.hasRekeyJournal().catch(() => false)) {
    try {
      const { recoverRekey } = await import('../store/rekey');
      const { rekeyPersistedState, isRekeyRunning } = await import('../sync/rekey-run');
      const { rekeyRouteHash } = await import('../sync/rekey-route');
      // A run still going (the user navigated back to this world under its
      // modal) owns the folder; a second writer beside it is the one thing
      // the journal cannot survive (S363 gate lens C F1).
      const done = isRekeyRunning() ? null : await recoverRekey(store, { rekeyPersistedState });
      if (done) {
        // The live folder's marks follow too (S367 gate B13; rekeyLiveUi does
        // it for live runs, but this path never reaches rekeyLiveUi).
        const { remapDiskNoticeIds } = await import('../core/live-folder');
        remapDiskNoticeIds(worldId, done.map);
        const next = rekeyRouteHash(window.location.hash, worldId, done.map);
        if (next) window.location.replace(next);
        // A finished Route 2 journal speaks even on the silent boot path: the
        // link itself is still not done, and nothing else would say so (S367
        // gate B6: a reload mid-link reopens the world silently).
        if (((!silent && !quietRekey) || done.origin === 'merge') && done.map.size > 0) {
          toasts.info(done.origin === 'merge'
            ? `Finished matching ${done.map.size} ${done.map.size === 1 ? 'element' : 'elements'} to OnlyWorlds. Linking did not finish: run Make online again with the same key.`
            : `Finished giving ${done.map.size} ${done.map.size === 1 ? 'element a new id' : 'elements new ids'}.`);
        }
        // Files that would not open keep old ids; Settings offers "Update
        // links" once they are repaired (gate lens A F5).
        if (done.unrewritten.length > 0) {
          const n = done.unrewritten.length;
          toasts.error(`${n === 1 ? '1 element' : `${n} elements`} could not be updated because ${n === 1 ? 'its file' : 'their files'} would not open. Fix ${n === 1 ? 'it' : 'them'}, then use Update links in Settings.`, 10_000);
        }
      }
    } catch (err) {
      console.warn('[worlds-sidebar] re-key recovery failed:', err);
      const { rekeyJournalOrigin } = await import('../store/rekey');
      toasts.error((await rekeyJournalOrigin(store)) === 'merge'
        ? `Linking ${entry.name} to OnlyWorlds did not finish. Settings, under This world, can finish or undo it; then run Make online again with the same key.`
        : `An id update in ${entry.name} could not finish, so it is not syncing. Settings, under This world, can finish or undo it.`);
    }
  }
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
    // The world's style rules ride in after the elements (the map reads both).
    await loadWorldStyles(store);
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

  // A revived store trusted its caches: anything another tool wrote while the
  // world sat parked shows after one pass (the live folder, S364). Background:
  // never blocks the switch-back.
  if (revived) void import('../core/live-folder').then(m => m.rescanNow({ force: true }));

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
 * A browser world whose directory is gone (conv. 129). A world of the user's
 * own keeps its row, marked "Cleared by this browser", with its link intact,
 * until the user removes it. The tour's sandbox is removed as before and the
 * tour rebuilds it when it resumes (S370 gate B7).
 */
function settleGoneBrowserWorld(entry: WorldRegistryEntry, silent: boolean, toasts: ToastManager): void {
  evictParkedStore(entry.id);
  if (entry.demo === true) {
    void deleteHandle(entry.folder.handle_key).catch(() => {});
    const cleaned = deleteWorldEntry(getState().registry, entry.id);
    saveRegistry(cleaned);
    patchSlice('registry', cleaned);
    return;
  }
  if (!entry.cleared_at) {
    const marked = markWorldCleared(getState().registry, entry.id);
    saveRegistry(marked);
    patchSlice('registry', marked);
  }
  // The row is still there, with the ways back on it (S376 lens C C13).
  if (!silent) {
    toasts.info(entry.api?.api_key
      ? `"${entry.name}" was cleared by this browser. Its row can bring it back from onlyworlds.com or from a world file.`
      : `"${entry.name}" was cleared by this browser. Its row can bring it back from a world file.`);
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

/**
 * Ask the FILESYSTEM whether the world's root directory is really gone,
 * rather than inferring it from an error's name.
 *
 * `isFolderMissing` is a guess about a string: `store.open()` makes some
 * thirty directory calls building the layout and claiming the lock, and ANY
 * NotFoundError among them — or any error whose message merely contains "not
 * found" — used to be read as "the whole folder was deleted". The action
 * taken on that guess is destructive and irreversible from the UI: it drops
 * the registry entry (which for an api-linked world carries its credentials)
 * and deletes the saved handle, so a transient failure cost the user their
 * world listing and their key.
 *
 * Reading one entry off the root touches the directory itself. If that
 * succeeds, the folder exists and the original error was something else, so
 * nothing gets destroyed (S323).
 */
async function rootDirectoryIsGone(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    // `values()` yields lazily; one step is enough to touch the directory.
    const iterator = (handle as unknown as { values(): AsyncIterableIterator<unknown> }).values();
    await iterator.next();
    return false;
  } catch (probeErr) {
    return isFolderMissing(probeErr);
  }
}

