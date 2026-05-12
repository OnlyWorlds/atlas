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
import { onHashChange, parseHash, navigate, worldHash, elementsHash, settingsHash } from '../core/router';
import { mountWorldsBody } from './worlds-sidebar';
import { mountElementsBody } from './elements-sidebar';
import { ToastManager } from '../ui/toast-manager';

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface SidebarMount {
  toggle: HTMLElement;
  content: HTMLElement;
  footer: HTMLElement;
  toasts: ToastManager;
}

export function mountSidebar(mount: SidebarMount): () => void {
  const { toggle, content, footer, toasts } = mount;
  toggle.innerHTML = '';
  footer.innerHTML = '';

  // ----- Mode toggle (renders into shell.sidebarToggle which already has CSS) -----
  function renderToggle(): void {
    toggle.innerHTML = '';
    const mode = getState().ui.sidebarMode;
    const active = getState().active;
    const worldsActive = mode === 'worlds';
    const elementsActive = mode === 'elements';
    const elementsDisabled = !active;

    const worldLabel = active?.meta.name || 'worlds';
    const worldsBtn = document.createElement('button');
    worldsBtn.type = 'button';
    worldsBtn.className = 'atlas-mode-btn atlas-mode-btn-worlds' + (worldsActive ? ' active' : '');
    worldsBtn.setAttribute('data-action', 'mode-worlds');
    worldsBtn.title = active ? `active: ${active.meta.name}. click to manage worlds.` : 'worlds';
    worldsBtn.innerHTML = `
      <img class="atlas-mode-ow-icon" src="./owlogo.png" alt="OnlyWorlds" />
      <span class="atlas-mode-btn-label">${escapeText(worldLabel)}</span>
    `;
    worldsBtn.addEventListener('click', () => switchMode('worlds'));
    toggle.appendChild(worldsBtn);

    const elementsBtn = document.createElement('button');
    elementsBtn.type = 'button';
    elementsBtn.className = 'atlas-mode-btn' + (elementsActive ? ' active' : '');
    elementsBtn.setAttribute('data-action', 'mode-elements');
    elementsBtn.disabled = elementsDisabled;
    elementsBtn.title = elementsDisabled ? 'open a world to browse elements' : 'elements';
    elementsBtn.innerHTML = '<span class="atlas-mode-btn-label">elements</span>';
    elementsBtn.addEventListener('click', () => switchMode('elements'));
    toggle.appendChild(elementsBtn);
  }

  function switchMode(target: SidebarMode): void {
    const state = getState();
    const active = state.active;
    if (target === 'elements' && !active) return;
    // Settings sub-routes don't have a mode; leaving settings via mode click
    // returns to the relevant top-level for that mode.
    if (target === 'worlds') {
      if (active) navigate(worldHash(active.worldId));
      else navigate('#/');
    } else {
      if (active) navigate(elementsHash(active.worldId));
    }
  }

  // ----- Footer gear -----
  const gear = document.createElement('button');
  gear.className = 'atlas-icon-btn';
  gear.setAttribute('data-action', 'open-settings');
  gear.setAttribute('aria-label', 'settings');
  gear.innerHTML = '<span class="material-symbols-outlined">settings</span>';
  footer.appendChild(gear);
  gear.addEventListener('click', () => {
    const active = getState().active;
    navigate(settingsHash(active?.worldId ?? null));
  });

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

  // Keep state.ui.sidebarMode in sync with the URL.
  function syncModeFromRoute(): void {
    const route = parseHash(window.location.hash);
    const want: SidebarMode = (route.mode === 'elements' || route.mode === 'element') ? 'elements' : 'worlds';
    if (getState().ui.sidebarMode !== want) {
      patchSlice('ui', { ...getState().ui, sidebarMode: want });
    }
  }

  function render(): void {
    syncModeFromRoute();
    renderToggle();
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
