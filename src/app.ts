/**
 * App orchestration — mounts the shell, sidebar driver, middle pane (room nav
 * strip + active room), and right pane. Routes between rooms via the URL hash.
 *
 * Room model (DESIGN.md "Rooms"): the middle pane is a flex column with a
 * persistent room nav strip on top (when a world is active) and the active
 * room's content below. Rooms: welcome, home (default for active worlds),
 * element, writing, knowledge, timeline, share, import, settings.
 * (search + templates rooms removed session 256; legacy URLs land on home.)
 */

import { mountAppShell, AppShell } from './layout/app-shell';
import { installNarrowLayout } from './layout/narrow-layout';
import { mountSidebar } from './sidebar/sidebar';
import { mountWelcomePanel } from './middle/welcome-panel';
import { mountSettingsPanel } from './middle/settings-panel';
import { mountElementDetail } from './middle/element-detail';
import { mountTimeline } from './middle/timeline';
import { mountWorldHome } from './middle/world-home';
import { mountWriting } from './middle/writing';
import { mountKnowledgeRoom } from './middle/knowledge-room';
import { mountShareRoom } from './middle/share-room';
import { mountImportRoom } from './middle/import-room';
import { mountRoomNav } from './middle/room-nav';
import { mountRightPane } from './tabs/right/right-pane';
import { installContextTabLifecycle } from './tabs/right/context-tab-lifecycle';
import { openMapTab } from './tabs/right/map-index-tab';
import { loadPersistedRightTabs } from './tabs/right/right-tabs-persistence';
import { toastManager, ToastManager } from './ui/toast-manager';
import { loadRegistry, adoptStoredRegistry } from './registry/registry';
import { enqueueActivationTask } from './core/activation-chain';
import { hasOpfsMode } from './core/capabilities';
import { beginBootReconciliation, reconcileAtBoot } from './core/browser-home';
import { REGISTRY_STORAGE_KEY } from './core/constants';
import { patchSlice, getState, subscribe, type MiddleMode } from './core/state';
import { loadUiPrefs } from './core/ui-prefs';
import { onHashChange, parseHash, navigate, homeHash, elementHash } from './core/router';
import { hydrateAtlasRoot } from './setup/atlas-root-flow';
import { activateWorld } from './sidebar/worlds-sidebar';
import { initAutoPullScheduler } from './sync/auto-pull-scheduler';
import { installHotkeys, setHotkeyCallbacks } from './core/hotkeys';
import { openCreateDoor } from './ui/create-element-door';
import type { WorldMap } from './core/types';
import { installLiveFolder } from './core/live-folder';
import { installWorldPrefsSync } from './core/world-prefs';
import { captureJoinCode, hasPendingJoin } from './core/join-capture';
import { captureOpenWorld, takePendingOpen, takePendingOpenElements } from './core/open-capture';
import { clearOpenLanding, landingStep, peekOpenLanding, setOpenLanding } from './core/open-landing';
import { openPacketBar } from './ui/open-packet-bar';
import { installForgetPresence } from './setup/forget-browser';

export interface AppHandle {
  shell: AppShell;
  toasts: ToastManager;
  destroy(): void;
}

export function startApp(container: HTMLElement): AppHandle {
  // Hydrate registry from localStorage into observable state.
  patchSlice('registry', loadRegistry());
  // Another tab saved the registry: take its changes in, keep ours (S365
  // gate lens A H1/H2). Without this a tab's memory went stale and its next
  // save of the same world put the old copy back.
  window.addEventListener('storage', (e) => {
    if (e.key !== REGISTRY_STORAGE_KEY) return;
    const merged = adoptStoredRegistry(getState().registry);
    if (merged) patchSlice('registry', merged);
  });
  // Hydrate UI prefs (sidebar mode is state-driven since session 223 —
  // decoupled from URL routing; persists across reloads as a user preference).
  const prefs = loadUiPrefs();
  patchSlice('ui', { ...getState().ui, sidebarMode: prefs.sidebarMode });
  // Restore right-pane tabs from localStorage so map tabs survive a page
  // reload. Stale tabs from worlds not currently active will surface as
  // darkened-and-click-to-close per the §5 design (their mapId isn't in
  // current data.elements until the world is activated).
  const persistedTabs = loadPersistedRightTabs();
  if (persistedTabs) {
    patchSlice('ui', {
      ...getState().ui,
      rightTabs: persistedTabs.tabs,
      rightActiveIndex: persistedTabs.activeIndex,
    });
  }
  // Resolve atlas root reference (runtime info only; handle stays in vault).
  const rootHydrated = hydrateAtlasRoot();

  // The browser home's reconciliation (1.17, conv. 129): FIRST in the
  // activation chain, so no activation, resume or make in this tab runs
  // before it. It re-adopts browser worlds the registry lost, removes crashed
  // makes, marks worlds the browser cleared, and deletes nothing else.
  // Every make in this tab waits for it (`openBrowserMake`), the ones off the
  // activation chain too (S376 gate B1).
  const settleReconciled = beginBootReconciliation();
  void enqueueActivationTask(async () => {
    try {
      await rootHydrated.catch(() => {});
      if (!hasOpfsMode()) return;
      const out = await reconcileAtBoot();
      if (out.adopted.length || out.removed.length || out.cleared.length || out.stale.length) {
        console.info('[browser-home] reconciled', { adopted: out.adopted, removed: out.removed, cleared: out.cleared.length, stale: out.stale });
      }
    } catch (err) {
      console.warn('[browser-home] reconciliation skipped', err); // raw-error-ok: a console record, never shown
    } finally {
      settleReconciled();
    }
    // A move to a folder that a crash interrupted (contract §4.3): finished
    // here when it can be without a gesture, else when the world opens or
    // the next Move click.
    const moves = getState().registry.worlds.filter(w => w.move || w.moved_from);
    if (moves.length > 0) {
      const { recoverBrowserMove } = await import('./setup/browser-world-move');
      for (const w of moves) {
        await recoverBrowserMove(w.id).catch(err => console.warn('[browser-home] move recovery waits', err)); // raw-error-ok: a console record
      }
    }
  });

  // Mount toast surface (uses #toast-container element from index.html)
  toastManager.init();
  const toasts = toastManager;

  // Wire periodic auto-pull (Phase 3.5+). Reads settings from registry;
  // reconciles every state tick. No-op when cadence is off (default).
  initAutoPullScheduler();

  // Boot-time auto-activation: if the URL names a world and FS permission was
  // already granted in a previous session (queryPermission returns 'granted'
  // without a gesture), silently re-open the world so a reload preserves state.
  // If permission isn't auto-granted, do nothing — sidebar click is the
  // explicit re-grant path (it has a user gesture).
  void tryAutoActivateFromUrl(toasts);

  // Mount shell.
  const shell = mountAppShell(container);

  // Narrow-window layer (S323): stamps the breakpoint classes that turn the
  // side panes into drawers below 1100 / 820px. Must run before the first
  // paint of the nav so its drawer toggles read the right state.
  installNarrowLayout();

  // Guided tour (2026-07-19): lazy — the chunk loads only when a persisted
  // tour is active. ensureTourBar mounts/unmounts on tour-state changes; the
  // resume path reactivates the tour's demo world after a reload.
  try {
    if (localStorage.getItem('atlas_tour_v1')) {
      void import('./tour/tour-engine').then(async (engine) => {
        if (!engine.isTourActive()) return;
        await engine.resumeTour();
        const { ensureTourBar } = await import('./tour/tour-bar');
        ensureTourBar(document.body);
      });
    }
  } catch { /* private mode */ }

  // Sidebar driver (owns mode toggle + body + footer gear).
  const unsubSidebar = mountSidebar({
    toggle: shell.sidebarToggle,
    content: shell.sidebarContent,
    footer: shell.sidebarFooter,
    toasts,
    onResetLayout: () => shell.resetRatios(),
  });

  // Room nav strip mounts to its dedicated middle-top region. Stays installed
  // for the life of the app — it manages its own visibility based on state.
  const unsubRoomNav = mountRoomNav({ target: shell.middleRoomNav });

  // Right pane (tab bar + active tab body).
  const unsubRight = mountRightPane({
    tabBar: shell.rightTabBar,
    pane: shell.rightPane,
    toasts,
  });

  // Context tab lifecycle — ensures exactly one permanent context tab at
  // index 0 of the right pane. No auto-open; route-driven content.
  const unsubContextTab = installContextTabLifecycle();

  // The live folder (S364): what another tool wrote shows when you come back.
  const uninstallLiveFolder = installLiveFolder();
  // The world's notes, cast, calendar lens and writing labels travel in its folder (S364).
  const uninstallWorldPrefs = installWorldPrefsSync();
  // Fully forget (#140): this tab answers another tab's roll call, and
  // reloads when another tab has forgotten, so its memory never writes the
  // list of worlds back.
  const uninstallForgetPresence = installForgetPresence();

  // Middle pane — routed by hash mode + active world.
  let unmountMiddle: (() => void) | null = null;
  let currentMode: MiddleMode | null = null;
  let mountedWorldId: string | null = null;
  let demoWasMounted = false;

  // An open link's landing (#487): once the world it names is open and loaded,
  // move to its element (or the packet's first), once.
  function applyOpenLanding(): void {
    const s = getState();
    const l = peekOpenLanding();
    const entry = s.active ? s.registry.worlds.find(w => w.id === s.active!.worldId) : undefined;
    // Every path of the door ends at the world's Home: land after that, never before it.
    const route = parseHash(window.location.hash);
    if (!s.active || route.mode !== 'home' || route.worldId !== s.active.worldId) return;
    const step = landingStep(l, s.active, entry, s.data.loading === true, s.data.elements);
    if (step.kind === 'wait') return;
    clearOpenLanding();
    if (step.kind === 'expired') return;
    if (step.found.length === 0) {
      toasts.info(step.missing === 1
        ? 'The element this link names is not in this world, or not in your view of it.'
        : 'The elements this link names are not in this world, or not in your view of it.', 10_000);
      return;
    }
    if (step.found.length === 1) {
      navigate(elementHash(step.localWorldId, step.found[0]));
      if (step.missing > 0) toasts.info(`${step.missing} of the elements this link names ${step.missing === 1 ? 'is' : 'are'} not in this world.`, 10_000);
      return;
    }
    openPacketBar(step.localWorldId, step.found, step.missing);
  }

  function renderMiddle(): void {
    // #/try-demo (1.18.1): the home page's link into the demo world. It runs
    // the same door as the landing's button, once: the hash goes first, so a
    // reload, Back or the next state tick never asks again. The door itself
    // waits for the boot reconciliation and finds a copy already here.
    if (parseHash(window.location.hash).mode === 'try-demo') {
      history.replaceState(history.state, '', '#/');
      void import('./setup/world-doors').then(m => m.runAddWorldAction('try-demo', toasts));
    }
    // #/start and #/bring-in (#127): the Start page's other two answers, the
    // same way: the hash goes first, then the start-a-world dialog opens once.
    // #/join/<code> (#104): a world opened from onlyworlds.com. main.ts took a
    // code present at boot; one opened into this running tab is taken here,
    // the hash first (R2), then the door runs once.
    captureJoinCode();
    if (hasPendingJoin()) {
      void import('./ui/join-world-modal').then(m => m.runPendingJoin(toasts));
    }
    // #/open/<world id> (#104, S416): a world page's Open in Atlas, the same way.
    // The id is taken before the chunk loads, so a chunk that fails to load
    // (a tab older than a deploy) is not asked for again on every render.
    captureOpenWorld();
    const openId = takePendingOpen();
    if (openId !== null) {
      // Where the link lands (#487): a new link replaces any landing still waiting.
      const landOn = takePendingOpenElements();
      if (openId) setOpenLanding(openId, landOn); else clearOpenLanding();
      void import('./setup/open-door').then(m => m.runOpenLink(openId, toasts)).then(() => applyOpenLanding());
    }
    applyOpenLanding();
    const linkMode = parseHash(window.location.hash).mode;
    if (linkMode === 'start' || linkMode === 'bring-in') {
      history.replaceState(history.state, '', '#/');
      void import('./setup/world-doors').then(m => m.startWorldFromLink(linkMode === 'bring-in' ? 'bring-in' : 'home', toasts));
    }
    const route = parseHash(window.location.hash);
    const active = getState().active;

    // The demo is a full-viewport overlay above the shell — the middle pane
    // behind it stays on whatever the no-demo route resolves to. The chunk
    // only ever loads once the user visits #/demo (demoWasMounted guard).
    if (route.mode === 'demo') {
      demoWasMounted = true;
      void import('./demo/demo-view').then(m => m.mountDemo());
    } else if (demoWasMounted) {
      demoWasMounted = false;
      void import('./demo/demo-view').then(m => m.unmountDemo());
    }

    // Resolve the room (middleMode) from the route + active state.
    let nextMode: MiddleMode;
    if (!active) {
      // No active world → either welcome (root) or settings (no-world settings).
      nextMode = route.mode === 'settings' ? 'settings' : 'welcome';
    } else {
      switch (route.mode) {
        case 'settings':
          nextMode = 'settings';
          break;
        case 'element':
          nextMode = 'element';
          break;
        case 'timeline':
          nextMode = 'timeline';
          break;
        case 'writing':
          nextMode = 'writing';
          break;
        case 'knowledge':
          nextMode = 'knowledge';
          break;
        case 'share':
          nextMode = 'share';
          break;
        case 'import':
          nextMode = 'import';
          break;
        case 'map':
          if (route.mapId) ensureMapTabOpen(route.mapId);
          // Map composes with the room — element selection wins over home if
          // present in the URL (matches the right-pane map convention).
          nextMode = route.elementId ? 'element' : 'home';
          break;
        case 'elements':
        case 'welcome':
        case 'home':
        default:
          // Bare /w/<id>, /w/<id>/elements, or any unrecognised route with an
          // active world → home (the world's identity room).
          nextMode = 'home';
          break;
      }
    }

    // Room nav strip visibility: shown when a world is active (the real nav),
    // AND during onboarding when no world exists (labeled PREVIEW mode —
    // S255v2: the future nav doubles as the landing's "what's inside" line;
    // labels collapse away when the first world activates). Hidden only for
    // the legacy active-world welcome branch.
    const navActive = active == null || nextMode !== 'welcome';
    shell.middleRoomNav.setAttribute('data-active', navActive ? 'true' : 'false');

    // A room instance belongs to ONE world. The room-stable world switch
    // (S256) keeps the room KIND, but rooms read world files once at mount
    // (charts.json, pages) and write whole lists back, so an instance carried
    // across a switch wrote world A's charts over world B's (S364). Remount on
    // a world change too; activateWorld flushes pending saves before it gets
    // here (flushBeforeLeavingWorld).
    const nextWorldId = active?.worldId ?? null;
    if (nextMode !== currentMode || nextWorldId !== mountedWorldId) {
      unmountMiddle?.();
      currentMode = nextMode;
      mountedWorldId = nextWorldId;
      unmountMiddle = mountRoom(nextMode, shell.middleContent, toasts);
      patchSliceIfChanged('middleMode', nextMode);
    }

    // Mid-session activation is intentionally NOT automatic — without a fresh
    // user gesture, requestPermission would fail and we'd downgrade the URL to
    // a confusing "welcome" view. Sidebar click is the explicit permission
    // path. Boot-time silent activation is handled by `tryAutoActivateFromUrl`.

    // If the route names an element id, mirror it in selection.
    if (route.elementId && getState().ui.selectedElementId !== route.elementId) {
      patchSlice('ui', { ...getState().ui, selectedElementId: route.elementId });
    }
  }

  const unsubHash = onHashChange(renderMiddle);
  const unsubState = subscribe(() => {
    // Re-resolve route on every state tick — the active middle component handles
    // its own re-render via its own subscription, but mode transitions need this.
    renderMiddle();
  });
  renderMiddle();

  // Global hotkeys. Callbacks bind the dispatcher to app behavior (creating
  // an element, opening the palette) without coupling hotkeys.ts to UI modules.
  setHotkeyCallbacks({
    getActiveWorldId: () => getState().active?.worldId ?? null,
    openCreateElement: () => {
      const active = getState().active;
      if (!active) return;
      // Through the shared door (S301): this hotkey used to open a free-form
      // create modal beside the tour's scripted one.
      openCreateDoor(toasts);
    },
    openCommandPalette: () => {
      const active = getState().active;
      if (!active) return;
      // Lazy chunk — same pattern as the notes/help overlays.
      void import('./ui/command-palette').then(m => m.openCommandPalette());
    },
    hasSelectedElement: () => Boolean(getState().ui.selectedElementId),
    deselectToHome: () => {
      const active = getState().active;
      if (!active) return;
      // Nav home, then clear the selection: DESIGN convention #32. In this
      // order, because every state tick mirrors a route's element into the
      // selection, so a clear made while the route still names the element
      // came straight back (#175, S388).
      navigate(homeHash(active.worldId));
      patchSlice('ui', { ...getState().ui, selectedElementId: null });
    },
    openNotes: () => {
      const active = getState().active;
      if (!active) return;
      void import('./ui/notes-overlay').then(m => m.openNotesOverlay());
    },
  });
  const uninstallHotkeys = installHotkeys();

  return {
    shell,
    toasts,
    destroy() {
      unsubSidebar();
      unsubRoomNav();
      unsubRight();
      unsubContextTab();
      uninstallLiveFolder();
      uninstallWorldPrefs();
      uninstallForgetPresence();
      unsubHash();
      unsubState();
      unmountMiddle?.();
      uninstallHotkeys();
    },
  };
}

/**
 * Mount the active room's component into the given target. Returns a teardown
 * function the caller invokes on next room switch.
 */
function mountRoom(mode: MiddleMode, target: HTMLElement, toasts: ToastManager): () => void {
  switch (mode) {
    case 'welcome':
      return mountWelcomePanel(target);
    case 'home':
      return mountWorldHome(target, toasts);
    case 'element':
      return mountElementDetail(target);
    case 'writing':
      return mountWriting(target, toasts);
    case 'timeline':
      return mountTimeline(target, toasts);
    case 'knowledge':
      return mountKnowledgeRoom(target, toasts);
    case 'share':
      return mountShareRoom(target, toasts);
    case 'import':
      return mountImportRoom(target, toasts);
    case 'settings':
      return mountSettingsPanel({ target, toasts });
  }
}

function ensureMapTabOpen(mapId: string): void {
  const ui = getState().ui;
  const existsIndex = ui.rightTabs.findIndex(t => t.kind === 'map' && t.mapId === mapId);
  if (existsIndex >= 0) {
    // Activate a background tab — a /map/<id> route that lands on an open but
    // inactive tab should surface it (S265). Guarded: only patch when the
    // index actually changes, since this runs inside the render pass and an
    // unconditional patch would re-enter renderMiddle forever.
    if (ui.rightActiveIndex !== existsIndex) {
      patchSlice('ui', { ...ui, rightActiveIndex: existsIndex });
    }
    return;
  }
  const m = getState().data.elements.find((e): e is WorldMap => e.type === 'map' && e.id === mapId);
  if (!m) return;
  // Imageless maps open normally since S300 (flat canvas); openMapTab no
  // longer diverts, so the S254 render-pass recursion guard is unnecessary.
  openMapTab(m);
}

function patchSliceIfChanged<K extends keyof ReturnType<typeof getState>>(
  key: K,
  value: ReturnType<typeof getState>[K]
): void {
  if (getState()[key] === value) return;
  patchSlice(key, value);
}

/**
 * On app boot, attempt to re-activate the world named in the URL without
 * prompting for permission. This uses `queryPermission` (no gesture needed):
 * if Chrome already considers permission granted from a recent session, we
 * activate silently and the URL's deep route (element selection, open map tab)
 * is restored via the normal render path. If permission isn't pre-granted, we
 * do nothing — the user clicks the world in the sidebar to re-grant.
 */
async function tryAutoActivateFromUrl(toasts: ToastManager): Promise<void> {
  const route = parseHash(window.location.hash);
  if (!route.worldId) return;
  const entry = getState().registry.worlds.find(w => w.id === route.worldId);
  if (!entry) return;
  try {
    await activateWorld(route.worldId, toasts, {
      silent: true,
      preserveSelection: true,
      permissionMode: 'query',
    });
  } catch (err) {
    // Errors here would be surprising — log and move on. The user can always
    // click the world card to retry with a gesture.
    console.warn('[boot] silent auto-activate failed:', err);
  }
}
