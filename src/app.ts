/**
 * App orchestration — mounts the shell, sidebar, middle panel, and routes
 * between welcome / settings based on the URL hash.
 *
 * Phase 2 minimum. Right pane and tabs land in Phase 5.
 */

import { mountAppShell, AppShell } from './layout/app-shell';
import { mountWorldsSidebar } from './sidebar/worlds-sidebar';
import { mountWelcomePanel } from './middle/welcome-panel';
import { mountSettingsPanel } from './middle/settings-panel';
import { toastManager, ToastManager } from './ui/toast-manager';
import { loadRegistry } from './registry/registry';
import { patchSlice, getState, subscribe } from './core/state';
import { onHashChange, parseHash } from './core/router';
import { hydrateAtlasRoot } from './setup/atlas-root-flow';

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

  // Sidebar.
  const unsubSidebar = mountWorldsSidebar({
    content: shell.sidebarContent,
    footer: shell.sidebarFooter,
    toasts,
  });

  // Middle pane — routed by hash mode + active world.
  let unmountMiddle: (() => void) | null = null;
  function renderMiddle(): void {
    const route = parseHash(window.location.hash);
    const active = getState().active;
    unmountMiddle?.();
    if (route.mode === 'settings') {
      patchSliceIfChanged('middleMode', 'settings');
      unmountMiddle = mountSettingsPanel({ target: shell.middle, toasts });
    } else {
      patchSliceIfChanged('middleMode', 'welcome');
      unmountMiddle = mountWelcomePanel(shell.middle);
    }
    // Light-touch: if the hash names a world but state.active doesn't match,
    // try to silently activate. Skip if no handle in vault (sidebar click is
    // the explicit-permission path).
    void maybeAutoActivate(route.worldId, active?.worldId);
  }

  const unsubHash = onHashChange(renderMiddle);
  const unsubState = subscribe(() => {
    // Re-render middle when state changes (active world / meta change affect welcome).
    renderMiddle();
  });
  renderMiddle();

  return {
    shell,
    toasts,
    destroy() {
      unsubSidebar();
      unsubHash();
      unsubState();
      unmountMiddle?.();
    },
  };
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
  // Future polish: surface a banner "click {name} to grant folder access".
}
