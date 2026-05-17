/**
 * Sidebar driver — owns the mode toggle (in shell.sidebarToggle), dispatches
 * the body (worlds vs elements), and renders the footer gear.
 *
 * The active mode comes from the URL hash (`#/w/<id>` → worlds;
 * `#/w/<id>/elements` or `#/w/<id>/element/<eid>` → elements). State mirrors
 * the route for components that prefer reading state. Settings sub-routes
 * keep the current sidebar mode they came from.
 */

import { getState, patchSlice, subscribe, type SidebarMode } from '../core/state';
import { onHashChange, parseHash, navigate, worldHash, elementsHash, elementHash, settingsHash } from '../core/router';
import type { ActiveWorldRef } from '../core/state';
import { mountWorldsBody } from './worlds-sidebar';
import { mountElementsBody } from './elements-sidebar';
import { ToastManager } from '../ui/toast-manager';
import { buildShortcutsContent } from '../ui/shortcuts-content';

/**
 * Right-tab destination given an active world: if a selection survives in
 * `ui.selectedElementId` AND that element still exists in the active world's
 * cache, return the element URL; otherwise return the bare elements-list URL.
 *
 * Used by:
 *   - sidebar mode toggle (clicking the right tab restores selection)
 *   - gear-as-toggle (clicking gear while on Settings returns to the right
 *     context, which is the selected element if any)
 *   - worlds-sidebar.activateWorld (instant-feel navigation)
 *
 * The "still exists" check matters because the cache may be empty (we just
 * cleared it for an instant-feel world switch) — in that case fall back to
 * the elements list rather than navigating to a URL that would render the
 * "element not found" empty state.
 */
export function rightTabHashFor(active: ActiveWorldRef): string {
  const state = getState();
  const sel = state.ui.selectedElementId;
  if (sel && state.data.elements.some(e => e.id === sel)) {
    return elementHash(active.worldId, sel);
  }
  return elementsHash(active.worldId);
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface SidebarMount {
  toggle: HTMLElement;
  content: HTMLElement;
  footer: HTMLElement;
  toasts: ToastManager;
  /**
   * Reset the three-pane shell ratios to defaults (and clear the persisted
   * value). Wired to the reset-layout icon button rendered next to the gear.
   */
  onResetLayout: () => void;
}

export function mountSidebar(mount: SidebarMount): () => void {
  const { toggle, content, footer, toasts, onResetLayout } = mount;
  toggle.innerHTML = '';
  footer.innerHTML = '';

  // ----- Mode toggle: [ worlds | <world-name> ] -----
  //
  // Reads URL + registry rather than `state.active` so the right-tab label
  // flips synchronously when a world is activated (the registry has the entry
  // immediately; state.active only fills in after FS work completes). This is
  // the lever that makes world-switch feel instant.
  //
  // Right tab is hidden entirely when no world is active — there's nothing
  // meaningful to switch to. The Worlds tab is always present.
  function renderToggle(): void {
    toggle.innerHTML = '';
    const route = parseHash(window.location.hash);
    const mode = getState().ui.sidebarMode;
    const reg = getState().registry;
    const worldId = route.worldId;
    const entry = worldId ? reg.worlds.find(w => w.id === worldId) : undefined;
    const worldsActive = mode === 'worlds';
    const elementsActive = mode === 'elements';

    const worldsBtn = document.createElement('button');
    worldsBtn.type = 'button';
    worldsBtn.className = 'atlas-mode-btn atlas-mode-btn-worlds' + (worldsActive ? ' active' : '');
    worldsBtn.setAttribute('data-action', 'mode-worlds');
    worldsBtn.title = 'Worlds';
    worldsBtn.innerHTML = '<span class="atlas-mode-btn-label">Worlds</span>';
    worldsBtn.addEventListener('click', () => switchMode('worlds'));
    toggle.appendChild(worldsBtn);

    if (entry) {
      const rightBtn = document.createElement('button');
      rightBtn.type = 'button';
      rightBtn.className = 'atlas-mode-btn' + (elementsActive ? ' active' : '');
      rightBtn.setAttribute('data-action', 'mode-elements');
      rightBtn.title = entry.name;
      rightBtn.innerHTML = `<span class="atlas-mode-btn-label">${escapeText(entry.name)}</span>`;
      rightBtn.addEventListener('click', () => switchMode('elements'));
      toggle.appendChild(rightBtn);
    }
  }

  function switchMode(target: SidebarMode): void {
    const state = getState();
    const active = state.active;
    if (target === 'worlds') {
      // Worlds tab works even without an active world: lands on the welcome
      // root. If a world IS active, navigating to its worldHash keeps the
      // sidebar in worlds mode and the middle in welcome.
      if (active) navigate(worldHash(active.worldId));
      else navigate('#/');
      return;
    }
    // target === 'elements'. Right tab navigates to the element if a selection
    // survives in state.ui (Q3 — selection-aware switch). Falls back to the
    // elements list if there's no selection or the selected element no longer
    // exists in the cache.
    if (!active) return;
    navigate(rightTabHashFor(active));
  }

  // ----- Footer gear: toggles Settings open/closed -----
  //
  // Clicking gear from any non-settings route → opens Settings.
  // Clicking gear from Settings → closes Settings + restores the right-tab
  // context (selected element if any, else elements list). This is Q3:
  // gear-as-toggle returns the user to where they were instead of stranding
  // them in a settings view.
  const gear = document.createElement('button');
  gear.className = 'atlas-icon-btn';
  // data-action stays "open-settings" for selector stability (heavy e2e usage);
  // the BEHAVIOR is open-on-first-click, close-on-second-click (toggle).
  gear.setAttribute('data-action', 'open-settings');
  gear.setAttribute('aria-label', 'Settings');
  gear.innerHTML = '<span class="material-symbols-outlined">settings</span>';
  footer.appendChild(gear);
  gear.addEventListener('click', () => {
    const state = getState();
    const active = state.active;
    const route = parseHash(window.location.hash);
    if (route.mode === 'settings') {
      // Close Settings.
      if (active) navigate(rightTabHashFor(active));
      else navigate('#/');
    } else {
      // Open Settings, scoped to active world if any.
      navigate(settingsHash(active?.worldId ?? null));
    }
  });

  // ----- Footer reset-layout icon — restore divider ratios to defaults -----
  const resetLayoutBtn = document.createElement('button');
  resetLayoutBtn.className = 'atlas-icon-btn';
  resetLayoutBtn.setAttribute('data-action', 'reset-layout');
  resetLayoutBtn.setAttribute('aria-label', 'Reset layout');
  resetLayoutBtn.title = 'Reset pane widths to defaults';
  resetLayoutBtn.innerHTML = '<span class="material-symbols-outlined">restart_alt</span>';
  footer.appendChild(resetLayoutBtn);
  resetLayoutBtn.addEventListener('click', () => onResetLayout());

  // ----- Footer ? button — keyboard shortcut reference (session 219) -----
  // Tiny inline popover listing implemented gestures + a "more coming"
  // footer. Discoverability for the bindings that exist TODAY (Esc, F,
  // Enter, Shift, right-click, etc.) while a full hotkeys kit lands later.
  const helpBtn = document.createElement('button');
  helpBtn.className = 'atlas-icon-btn';
  helpBtn.setAttribute('data-action', 'help-shortcuts');
  helpBtn.setAttribute('aria-label', 'Keyboard shortcuts');
  helpBtn.title = 'Keyboard shortcuts';
  helpBtn.innerHTML = '<span class="material-symbols-outlined">help</span>';
  footer.appendChild(helpBtn);
  helpBtn.addEventListener('click', () => openShortcutsPopover(helpBtn));

  // ----- Body mount/unmount as mode changes -----
  let unmountBody: (() => void) | null = null;
  let currentBodyMode: SidebarMode | null = null;

  function mountBody(): void {
    const mode = getState().ui.sidebarMode;
    if (mode === currentBodyMode) return;
    unmountBody?.();
    currentBodyMode = mode;
    if (mode === 'worlds') {
      unmountBody = mountWorldsBody({ content, toasts });
    } else {
      unmountBody = mountElementsBody({ content, toasts });
    }
  }

  // Keep state.ui.sidebarMode in sync with the URL. Routes that are
  // "content-y" (element, elements list, map, timeline) all imply the user
  // is browsing inside a world — keep the sidebar on the elements list.
  // Only fall back to worlds-mode for purely navigation/setup routes.
  function syncModeFromRoute(): void {
    const route = parseHash(window.location.hash);
    const contenty =
      route.mode === 'elements' ||
      route.mode === 'element' ||
      route.mode === 'map' ||
      route.mode === 'timeline';
    const want: SidebarMode = contenty ? 'elements' : 'worlds';
    if (getState().ui.sidebarMode !== want) {
      patchSlice('ui', { ...getState().ui, sidebarMode: want });
    }
  }

  function renderGearState(): void {
    const route = parseHash(window.location.hash);
    gear.classList.toggle('active', route.mode === 'settings');
  }

  function render(): void {
    syncModeFromRoute();
    renderToggle();
    renderGearState();
    mountBody();
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();

  return () => {
    unsubState();
    unsubHash();
    unmountBody?.();
  };
}

// ============================================================================
// Keyboard-shortcut reference popover (session 219).
// ============================================================================

let activeShortcutsPopover: HTMLElement | null = null;

function openShortcutsPopover(anchor: HTMLElement): void {
  if (activeShortcutsPopover) {
    closeShortcutsPopover();
    return;
  }
  const panel = document.createElement('div');
  panel.className = 'atlas-shortcuts-popover';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Keyboard shortcuts');
  const title = document.createElement('div');
  title.className = 'atlas-shortcuts-title';
  title.textContent = 'Keyboard shortcuts';
  panel.appendChild(title);
  panel.appendChild(buildShortcutsContent());
  document.body.appendChild(panel);

  // Anchor near the help button — pop UP-RIGHT since the button is in the
  // sidebar footer (bottom-left area).
  const r = anchor.getBoundingClientRect();
  panel.style.position = 'fixed';
  panel.style.left = `${Math.round(r.right + 6)}px`;
  panel.style.bottom = `${Math.round(window.innerHeight - r.bottom)}px`;
  panel.style.zIndex = '200';

  activeShortcutsPopover = panel;

  const outsideHandler = (e: MouseEvent) => {
    if (!activeShortcutsPopover) return;
    const t = e.target as Node;
    if (panel.contains(t) || anchor.contains(t)) return;
    closeShortcutsPopover();
  };
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeShortcutsPopover();
  };
  // Defer so the originating click doesn't immediately close us.
  setTimeout(() => {
    document.addEventListener('mousedown', outsideHandler);
    document.addEventListener('keydown', escHandler);
  }, 0);
  (panel as HTMLElement & { __atlasCleanup?: () => void }).__atlasCleanup = () => {
    document.removeEventListener('mousedown', outsideHandler);
    document.removeEventListener('keydown', escHandler);
  };
}

function closeShortcutsPopover(): void {
  if (!activeShortcutsPopover) return;
  const p = activeShortcutsPopover as HTMLElement & { __atlasCleanup?: () => void };
  p.__atlasCleanup?.();
  if (p.parentElement) p.parentElement.removeChild(p);
  activeShortcutsPopover = null;
}
