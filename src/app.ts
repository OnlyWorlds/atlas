/**
 * App orchestration — mounts the shell, sidebar driver, middle pane (room nav
 * strip + active room), and right pane. Routes between rooms via the URL hash.
 *
 * Room model (DESIGN.md "Rooms"): the middle pane is a flex column with a
 * persistent room nav strip on top (when a world is active) and the active
 * room's content below. Rooms: welcome, home (default for active worlds),
 * element, writing, timeline, search, publish, publish-detail, import,
 * templates, settings.
 */

import { mountAppShell, AppShell } from './layout/app-shell';
import { mountSidebar } from './sidebar/sidebar';
import { mountWelcomePanel } from './middle/welcome-panel';
import { mountSettingsPanel } from './middle/settings-panel';
import { mountElementDetail } from './middle/element-detail';
import { mountTimeline } from './middle/timeline';
import { mountWorldHome } from './middle/world-home';
import { mountWriting } from './middle/writing';
import { mountSearch } from './middle/search';
import { mountPublishRoom } from './middle/publish-room';
import { mountPublishDetail } from './middle/publish-detail';
import { mountImportRoom } from './middle/import-room';
import { mountTemplatesRoom } from './middle/templates-room';
import { mountRoomNav } from './middle/room-nav';
import { mountRightPane } from './tabs/right/right-pane';
import { openMapTab } from './tabs/right/map-index-tab';
import { loadPersistedRightTabs } from './tabs/right/right-tabs-persistence';
import { toastManager, ToastManager } from './ui/toast-manager';
import { loadRegistry } from './registry/registry';
import { patchSlice, getState, subscribe, type MiddleMode } from './core/state';
import { loadUiPrefs, setSidebarModePref } from './core/ui-prefs';
import { onHashChange, parseHash, navigate, homeHash } from './core/router';
import { hydrateAtlasRoot } from './setup/atlas-root-flow';
import { activateWorld } from './sidebar/worlds-sidebar';
import { initAutoPullScheduler } from './sync/auto-pull-scheduler';
import { installHotkeys, setHotkeyCallbacks } from './core/hotkeys';
import { ElementCreateModal } from './ui/element-create-modal';
import type { WorldMap } from './core/types';

export interface AppHandle {
  shell: AppShell;
  toasts: ToastManager;
  destroy(): void;
}

export function startApp(container: HTMLElement): AppHandle {
  // Hydrate registry from localStorage into observable state.
  patchSlice('registry', loadRegistry());
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
  void hydrateAtlasRoot();

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

  // Middle pane — routed by hash mode + active world.
  let unmountMiddle: (() => void) | null = null;
  let currentMode: MiddleMode | null = null;

  function renderMiddle(): void {
    const route = parseHash(window.location.hash);
    const active = getState().active;

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
        case 'search':
          nextMode = 'search';
          break;
        case 'publish':
          nextMode = 'publish';
          break;
        case 'publish-detail':
          nextMode = 'publish-detail';
          break;
        case 'import':
          nextMode = 'import';
          break;
        case 'templates':
          nextMode = 'templates';
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

    // Toggle the room nav strip's visibility — active when world is active and
    // we're NOT on welcome. Welcome owns the full middle pane during onboarding.
    const navActive = active != null && nextMode !== 'welcome';
    shell.middleRoomNav.setAttribute('data-active', navActive ? 'true' : 'false');

    if (nextMode !== currentMode) {
      unmountMiddle?.();
      currentMode = nextMode;
      unmountMiddle = mountRoom(nextMode, shell.middleContent, toasts);
      patchSliceIfChanged('middleMode', nextMode);
    }

    // Light-touch: if the hash names a world but state.active doesn't match,
    // try to silently activate. Skip if no handle in vault (sidebar click is
    // the explicit-permission path).
    void maybeAutoActivate(route.worldId, active?.worldId);

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
  // an element, focusing search) without coupling hotkeys.ts to UI modules.
  setHotkeyCallbacks({
    getActiveWorldId: () => getState().active?.worldId ?? null,
    openCreateElement: () => {
      const active = getState().active;
      if (!active) return;
      new ElementCreateModal(toasts).open();
    },
    focusSearch: () => {
      const active = getState().active;
      if (!active) return;
      // Flip to elements mode if needed (search lives in the elements body).
      // Session 223 decoupling: sidebar mode is pure state, set directly +
      // persist as a user preference. No URL navigation here.
      if (getState().ui.sidebarMode !== 'elements') {
        patchSlice('ui', { ...getState().ui, sidebarMode: 'elements' });
        // Persist the preference so the user's choice survives reload.
        setSidebarModePref('elements');
      }
      // Defer focus to after the elements body mounts.
      queueMicrotask(() => {
        const input = document.querySelector<HTMLInputElement>('input[data-role="elements-search"]');
        if (input) {
          input.focus();
          input.select();
        }
      });
    },
    hasSelectedElement: () => Boolean(getState().ui.selectedElementId),
    deselectToHome: () => {
      const active = getState().active;
      if (!active) return;
      // Clear selection + nav home — DESIGN convention #32.
      patchSlice('ui', { ...getState().ui, selectedElementId: null });
      navigate(homeHash(active.worldId));
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
    case 'search':
      return mountSearch(target);
    case 'publish':
      return mountPublishRoom(target);
    case 'publish-detail':
      return mountPublishDetail(target);
    case 'import':
      return mountImportRoom(target);
    case 'templates':
      return mountTemplatesRoom(target);
    case 'settings':
      return mountSettingsPanel({ target, toasts });
  }
}

function ensureMapTabOpen(mapId: string): void {
  const ui = getState().ui;
  const exists = ui.rightTabs.find(t => t.kind === 'map' && t.mapId === mapId);
  if (exists) return;
  const m = getState().data.elements.find((e): e is WorldMap => e.type === 'map' && e.id === mapId);
  if (!m) return;
  openMapTab(m);
}

function patchSliceIfChanged<K extends keyof ReturnType<typeof getState>>(
  key: K,
  value: ReturnType<typeof getState>[K]
): void {
  if (getState()[key] === value) return;
  patchSlice(key, value);
}

async function maybeAutoActivate(routeWorldId: string | null, activeWorldId: string | undefined): Promise<void> {
  if (!routeWorldId || routeWorldId === activeWorldId) return;
  // Mid-session activation is intentionally NOT automatic — without a fresh
  // user gesture, requestPermission would fail and we'd downgrade the URL to a
  // confusing "welcome" view. Sidebar click is the explicit permission path.
  // Boot-time silent activation is handled separately by `tryAutoActivateFromUrl`.
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
