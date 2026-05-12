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
import { toastManager, ToastManager } from './ui/toast-manager';
import { loadRegistry } from './registry/registry';
import { patchSlice, getState, subscribe, type MiddleMode } from './core/state';
import { onHashChange, parseHash } from './core/router';
import { hydrateAtlasRoot } from './setup/atlas-root-flow';
import type { WorldMap } from './core/types';

export interface AppHandle {
  shell: AppShell;
  toasts: ToastManager;
  destroy(): void;
}

export function startApp(container: HTMLElement): AppHandle {
  // Hydrate registry from localStorage into observable state.
  patchSlice('registry', loadRegistry());
  // Resolve atlas root reference (runtime info only; handle stays in vault).
  void hydrateAtlasRoot();

  // Mount toast surface (uses #toast-container element from index.html)
  toastManager.init();
  const toasts = toastManager;

  // Mount shell.
  const shell = mountAppShell(container);

  // Sidebar driver (owns mode toggle + body + footer gear).
  const unsubSidebar = mountSidebar({
    toggle: shell.sidebarToggle,
    content: shell.sidebarContent,
    footer: shell.sidebarFooter,
    toasts,
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
  // No-op for Phase 2 — sidebar click is the explicit permission path. We keep
  // the URL "ahead of state" deliberately so a fresh tab landing on /w/<id>
  // shows the empty welcome until the user clicks the world (which triggers
  // the FS Access permission prompt).
}
