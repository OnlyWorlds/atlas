/**
 * Sidebar driver — owns the mode toggle (in shell.sidebarToggle), dispatches
 * the body (worlds vs elements), and renders the footer gear.
 *
 * Session 223 decoupling: sidebar mode is now pure UI state (state.ui.sidebarMode,
 * persisted to localStorage via ui-prefs), NO LONGER derived from the URL.
 * Clicking the Worlds / Elements toggle updates state directly without
 * navigating. Room nav (top of middle pane) handles middle-pane navigation
 * independently. This matches Captain's "don't auto-switch" intent —
 * sidebar mode and room are orthogonal dimensions the user controls
 * independently.
 */

import { getState, patchSlice, subscribe, type SidebarMode } from '../core/state';
import { onHashChange, parseHash, navigate, elementHash, settingsHash } from '../core/router';
// elementsHash removed from imports — session 223 decoupling no longer routes
// through the /elements URL on toggle clicks or gear-toggle exit.
import { setSidebarModePref } from '../core/ui-prefs';
import type { ActiveWorldRef } from '../core/state';
import { mountWorldsBody } from './worlds-sidebar';
import { mountElementsBody } from './elements-sidebar';
import { ToastManager } from '../ui/toast-manager';
import { buildShortcutsContent } from '../ui/shortcuts-content';
import { escapeText } from '../core/dom-utils';

/**
 * Return-to-context destination given an active world: if a selection
 * survives in `ui.selectedElementId` AND that element still exists in the
 * active world's cache, return the element URL; otherwise return the world's
 * home URL.
 *
 * Used by:
 *   - gear-as-toggle (clicking gear while on Settings returns to the right
 *     context, which is the selected element if any, else home)
 *   - worlds-sidebar re-clicking the already-active world
 *
 * Session 223 change: previously fell back to `elementsHash` (sidebar elements
 * mode); after the sidebar-mode-from-URL decoupling, sidebar mode is its own
 * state and the URL fallback is the world's home room.
 *
 * The "still exists" check matters because the cache may be empty (we just
 * cleared it for an instant-feel world switch) — in that case fall back to
 * home rather than navigating to a URL that would render "element not found".
 */
export function rightTabHashFor(active: ActiveWorldRef): string {
  const state = getState();
  const sel = state.ui.selectedElementId;
  if (sel && state.data.elements.some(e => e.id === sel)) {
    return elementHash(active.worldId, sel);
  }
  return `#/w/${active.worldId}`;
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
  // Reads state.ui.sidebarMode (pure UI state, persisted to localStorage).
  // Toggle clicks update state directly — no URL navigation. Room nav owns
  // middle-pane routing independently.
  //
  // The right toggle's label reads from registry + URL (NOT state.active) so
  // the label flips synchronously on activation — state.active fills in
  // asynchronously after FS work, but the registry entry exists immediately.
  //
  // Right toggle is hidden when no world is active — there's nothing
  // meaningful to switch to. The Worlds toggle is always present.
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
    if (getState().ui.sidebarMode === target) return;
    patchSlice('ui', { ...getState().ui, sidebarMode: target });
    setSidebarModePref(target);
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

  // ----- Footer notes button — opens the per-world notes overlay (session 223) -----
  // Per-world freeform notes, atlas-local (never synced). Captain's "random
  // notes modal" — available from any room. Disabled when no world is active.
  const notesBtn = document.createElement('button');
  notesBtn.className = 'atlas-icon-btn';
  notesBtn.setAttribute('data-action', 'open-notes');
  notesBtn.setAttribute('aria-label', 'Notes');
  notesBtn.title = 'Notes for this world (N)';
  notesBtn.innerHTML = '<span class="material-symbols-outlined">sticky_note_2</span>';
  footer.appendChild(notesBtn);
  notesBtn.addEventListener('click', async () => {
    if (!getState().active) return;
    const mod = await import('../ui/notes-overlay');
    mod.openNotesOverlay();
  });

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
    // Resolve effective mode — elements requires a world in the URL (entry
    // exists). Without one, the elements toggle isn't even rendered, so
    // falling back to worlds keeps the UI coherent.
    const route = parseHash(window.location.hash);
    const reg = getState().registry;
    const entry = route.worldId ? reg.worlds.find(w => w.id === route.worldId) : undefined;
    let mode = getState().ui.sidebarMode;
    if (mode === 'elements' && !entry) mode = 'worlds';
    if (mode === currentBodyMode) return;
    unmountBody?.();
    currentBodyMode = mode;
    if (mode === 'worlds') {
      unmountBody = mountWorldsBody({ content, toasts });
    } else {
      unmountBody = mountElementsBody({ content, toasts });
    }
  }

  // Session 223: sidebar mode is no longer derived from the URL — it's a
  // user preference (state.ui.sidebarMode, persisted via ui-prefs). Toggle
  // clicks are the only thing that change it. The room (middle pane) and
  // sidebar mode are now independent dimensions of navigation.
  //
  // The previous `syncModeFromRoute` lived here; removed for decoupling.

  function renderGearState(): void {
    const route = parseHash(window.location.hash);
    gear.classList.toggle('active', route.mode === 'settings');
  }

  function render(): void {
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
