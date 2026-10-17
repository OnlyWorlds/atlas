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

import { isAtlasGrounded } from '../core/grounded';
import { getState, patchSlice, subscribe, type SidebarMode } from '../core/state';
import { onHashChange, parseHash, navigate, elementHash, settingsHash } from '../core/router';
// elementsHash removed from imports — session 223 decoupling no longer routes
// through the /elements URL on toggle clicks or gear-toggle exit.
import { setSidebarModePref } from '../core/ui-prefs';
import { isTourFlagActive } from '../tour/tour-flag';
import type { ActiveWorldRef } from '../core/state';
import { mountWorldsBody } from './worlds-sidebar';
import { mountElementsBody } from './elements-sidebar';
import { mountWritingBody } from './writing-sidebar';
import { ToastManager } from '../ui/toast-manager';
import { escapeText } from '../core/dom-utils';
import { renderGate } from '../ui/render-gate';

/**
 * Effective sidebar body — accounts for the writing-room takeover. When the
 * route is `writing` and the user hasn't toggled to a specific mode during
 * this writing session, the writing tree replaces the worlds/elements body.
 * Toggle clicks set `sidebarWritingOverride` to escape the takeover; the
 * override clears when the URL leaves writing (handled in the sidebar's hash
 * watcher).
 */
type EffectiveSidebarBody = 'worlds' | 'elements' | 'writing';

function resolveEffectiveBody(): EffectiveSidebarBody {
  const route = parseHash(window.location.hash);
  const ui = getState().ui;
  const reg = getState().registry;
  const entry = route.worldId ? reg.worlds.find(w => w.id === route.worldId) : undefined;
  if (route.mode === 'writing' && entry && !ui.sidebarWritingOverride) {
    return 'writing';
  }
  let mode: EffectiveSidebarBody = ui.sidebarMode;
  if (mode === 'elements' && !entry) mode = 'worlds';
  return mode;
}

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
  // Rebuilt only when it would come out different (conv. 146, S421): a
  // rebuild between a press and its release loses the click. Its handlers
  // read state at the click, so the key is what it draws.
  const toggleGate = renderGate();
  const toggleUnchanged = (key: string): boolean => !toggleGate.changed([key]);
  function renderToggle(): void {
    const route = parseHash(window.location.hash);
    const mode = getState().ui.sidebarMode;
    const reg = getState().registry;
    const worldId = route.worldId;
    const entry = worldId ? reg.worlds.find(w => w.id === worldId) : undefined;
    // Pre-setup (no atlas root) the whole sidebar is silent — a lit "Worlds"
    // tab over an empty rail competed with the landing, the screen's one
    // voice (S255). The header appears once a root exists — OR once a world
    // is live on the route (the guided tour's OPFS world has no root, and
    // hiding the toggle left the tour stuck in worlds mode, 2026-07-19) —
    // OR during the tour's world-create step (the sidebar must appear in its
    // exact final structure, Worlds tab included).
    if (!isAtlasGrounded() && !entry && !isTourFlagActive()) {
      if (!toggleUnchanged('hidden')) toggle.innerHTML = '';
      return;
    }
    // When the writing-room takeover is active, neither toggle button is lit —
    // the body is the writing tree, the toggle is an escape hatch.
    const effective = resolveEffectiveBody();
    const worldsActive = mode === 'worlds' && effective !== 'writing';
    const elementsActive = mode === 'elements' && effective !== 'writing';
    if (toggleUnchanged(JSON.stringify([worldsActive, elementsActive, entry?.name ?? null, !!entry, isTourFlagActive()]))) return;
    toggle.innerHTML = '';

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
    } else if (isTourFlagActive()) {
      // Tour stages before the world exists: the toggle keeps its TRUE final
      // geometry (same principle as the greyed worlds-header icons) — a
      // locked ghost segment holds the place the world name will take, so
      // "Worlds" renders at its real compact size from the first frame
      // instead of a full-width centered label (Captain's round, 2026-07-19).
      const ghost = document.createElement('button');
      ghost.type = 'button';
      ghost.className = 'atlas-mode-btn atlas-tour-locked';
      ghost.disabled = true;
      ghost.innerHTML = '<span class="atlas-mode-btn-label">&nbsp;</span>';
      toggle.appendChild(ghost);
    }
  }

  /**
   * Switch sidebar mode. If we're currently in the writing room takeover,
   * setting the override marks the user's explicit choice — the takeover
   * yields to it until the user leaves and re-enters writing.
   */
  function switchMode(target: SidebarMode): void {
    const route = parseHash(window.location.hash);
    const inWriting = route.mode === 'writing';
    const ui = getState().ui;
    const needsOverride = inWriting && !ui.sidebarWritingOverride;
    if (ui.sidebarMode === target && !needsOverride) return;
    patchSlice('ui', {
      ...ui,
      sidebarMode: target,
      sidebarWritingOverride: inWriting ? true : ui.sidebarWritingOverride,
    });
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

  function renderNotesButtonState(): void {
    const active = !!getState().active;
    notesBtn.disabled = !active;
    notesBtn.classList.toggle('atlas-icon-btn-disabled', !active);
    notesBtn.title = active ? 'Notes for this world (N)' : 'Open a world to use notes';
  }

  // ----- Footer OW icon — opens Settings → OnlyWorlds (Bout OW, D11) -----
  // No new window concept: it's a route; browser Back returns for free.
  const owBtn = document.createElement('button');
  owBtn.className = 'atlas-icon-btn atlas-footer-owmark';
  owBtn.setAttribute('data-action', 'open-onlyworlds');
  owBtn.setAttribute('aria-label', 'OnlyWorlds');
  owBtn.title = 'OnlyWorlds · account, waypoints, links';
  owBtn.innerHTML = '<img class="atlas-footer-ow-icon" src="owlogo.png" alt="" />';
  owBtn.addEventListener('click', () => {
    navigate(settingsHash(getState().active?.worldId ?? null, 'onlyworlds'));
  });

  // ----- Footer ? button — keyboard shortcut reference (session 219) -----
  // Tiny inline popover listing implemented gestures + a "more coming"
  // footer. Discoverability for the bindings that exist TODAY (Esc, F,
  // Enter, Shift, right-click, etc.) while a full hotkeys kit lands later.
  const helpBtn = document.createElement('button');
  helpBtn.className = 'atlas-icon-btn';
  helpBtn.setAttribute('data-action', 'help-shortcuts');
  helpBtn.setAttribute('aria-label', 'Help');
  helpBtn.title = 'Help · this room + shortcuts (?)';
  helpBtn.innerHTML = '<span class="material-symbols-outlined">help</span>';
  // S255v4 (Captain): the ? glyph read as general help but opened only the
  // shortcuts popover. It now opens the room-aware help overlay (same surface
  // as the ? hotkey — room purpose, "you can", full shortcut reference). The
  // old shortcuts popover retires with its content module.
  helpBtn.addEventListener('click', () => {
    void import('../ui/help-overlay').then(({ openHelpOverlay }) => {
      openHelpOverlay(parseHash(window.location.hash).mode);
    });
  });

  // Order (S255v3, Captain): shortcuts before the OW mark — the brand glyph
  // anchors the row's right end.
  footer.appendChild(helpBtn);
  footer.appendChild(owBtn);

  // ----- Body mount/unmount as effective body changes -----
  let unmountBody: (() => void) | null = null;
  let currentBody: EffectiveSidebarBody | null = null;

  function mountBody(): void {
    const effective = resolveEffectiveBody();
    if (effective === currentBody) return;
    unmountBody?.();
    currentBody = effective;
    if (effective === 'worlds') {
      unmountBody = mountWorldsBody({ content, toasts });
    } else if (effective === 'elements') {
      unmountBody = mountElementsBody({ content, toasts });
    } else {
      unmountBody = mountWritingBody({ content, toasts });
    }
  }

  // ----- Writing-takeover override: clear on entering/leaving writing route -----
  // The override is a per-writing-session flag. When the URL leaves writing
  // (user nav to another room), clear it so the next visit to writing starts
  // with the tree visible. When ENTERING writing, also clear — covers the
  // "leave then come back" case where the user expects the tree by default.
  let prevRouteMode: string | null = null;
  function handleRouteTransition(): void {
    const route = parseHash(window.location.hash);
    const enteringWriting = route.mode === 'writing' && prevRouteMode !== 'writing';
    const leavingWriting = prevRouteMode === 'writing' && route.mode !== 'writing';
    if ((enteringWriting || leavingWriting) && getState().ui.sidebarWritingOverride) {
      patchSlice('ui', { ...getState().ui, sidebarWritingOverride: false });
    }
    prevRouteMode = route.mode;
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
    handleRouteTransition();
    renderToggle();
    renderGearState();
    renderNotesButtonState();
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

// (Shortcuts popover retired S255v4 — the footer ? opens the room-aware
// help overlay, which includes the full shortcut reference.)
