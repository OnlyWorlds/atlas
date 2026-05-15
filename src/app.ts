/**
 * App orchestration — mounts the shell, sidebar driver, middle panel, and
 * routes between welcome / settings / element based on the URL hash.
 */

import { mountAppShell, AppShell } from './layout/app-shell';
import { mountSidebar } from './sidebar/sidebar';
import { mountWelcomePanel } from './middle/welcome-panel';
import { mountSettingsPanel } from './middle/settings-panel';
import { mountElementDetail } from './middle/element-detail';
import { mountTimeline } from './middle/timeline';
import { mountRightPane } from './tabs/right/right-pane';
import { openMapTab } from './tabs/right/map-index-tab';
import { loadPersistedRightTabs } from './tabs/right/right-tabs-persistence';
import { toastManager, ToastManager } from './ui/toast-manager';
import { loadRegistry } from './registry/registry';
import { patchSlice, getState, subscribe, type MiddleMode } from './core/state';
import { onHashChange, parseHash } from './core/router';
import { hydrateAtlasRoot } from './setup/atlas-root-flow';
import { activateWorld } from './sidebar/worlds-sidebar';
import { initAutoPullScheduler } from './sync/auto-pull-scheduler';
import type { WorldMap } from './core/types';

export interface AppHandle {
  shell: AppShell;
  toasts: ToastManager;
  destroy(): void;
}

export function startApp(container: HTMLElement): AppHandle {
  // Hydrate registry from localStorage into observable state.
  patchSlice('registry', loadRegistry());
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

    let nextMode: MiddleMode;
    if (route.mode === 'settings') nextMode = 'settings';
    else if (route.mode === 'element') nextMode = 'element';
    else if (route.mode === 'timeline') nextMode = 'timeline';
    else if (route.mode === 'map') {
      if (route.mapId) ensureMapTabOpen(route.mapId);
      nextMode = route.elementId ? 'element' : 'welcome';
    }
    else nextMode = 'welcome';

    if (nextMode !== currentMode) {
      unmountMiddle?.();
      currentMode = nextMode;
      if (nextMode === 'settings') {
        unmountMiddle = mountSettingsPanel({ target: shell.middle, toasts });
      } else if (nextMode === 'element') {
        unmountMiddle = mountElementDetail(shell.middle);
      } else if (nextMode === 'timeline') {
        unmountMiddle = mountTimeline(shell.middle, toasts);
      } else {
        unmountMiddle = mountWelcomePanel(shell.middle);
      }
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

  return {
    shell,
    toasts,
    destroy() {
      unsubSidebar();
      unsubRight();
      unsubHash();
      unsubState();
      unmountMiddle?.();
    },
  };
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
