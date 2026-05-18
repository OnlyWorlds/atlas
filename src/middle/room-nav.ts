/**
 * Room nav strip — persistent icon row at the top of the middle pane (when a
 * world is active). Renders once and stays installed for the life of the app;
 * its visibility is toggled by `app.ts` via `data-active` on the container
 * (see DESIGN.md Rooms + convention #31).
 *
 * Each icon navigates to its room. The active room (derived from URL hash) is
 * highlighted with the cyan accent. Hover shows a sentence-case tooltip.
 *
 * Stub for Bout 2 — fleshed out properly in Bout 3.
 */

import { getState, subscribe } from '../core/state';
import {
  onHashChange,
  parseHash,
  navigate,
  homeHash,
  writingHash,
  timelineHash,
  searchHash,
  publishHash,
  importHash,
  templatesHash,
  settingsHash,
  type RouteMode,
} from '../core/router';

interface RoomDef {
  id: RouteMode | 'home' | 'writing' | 'timeline' | 'search' | 'publish' | 'import' | 'templates' | 'settings';
  label: string;
  icon: string; // Material Symbols name
  hashFor: (worldId: string) => string;
  /** Routes that count as "active" for this nav button (handles publish-detail too). */
  matches: RouteMode[];
}

const ROOMS: RoomDef[] = [
  // Home matches 'home', 'elements' (legacy sidebar-mode URL, now middle=home),
  // and 'welcome' (no-world case never reaches room nav, but defensive).
  { id: 'home',      label: 'Home',      icon: 'home',           hashFor: homeHash,      matches: ['home', 'elements'] },
  { id: 'writing',   label: 'Writing',   icon: 'edit_note',      hashFor: writingHash,   matches: ['writing'] },
  { id: 'timeline',  label: 'Timeline',  icon: 'timeline',       hashFor: timelineHash,  matches: ['timeline'] },
  { id: 'search',    label: 'Search',    icon: 'search',         hashFor: (w) => searchHash(w), matches: ['search'] },
  { id: 'publish',   label: 'Publish',   icon: 'ios_share',      hashFor: publishHash,   matches: ['publish', 'publish-detail'] },
  { id: 'import',    label: 'Import',    icon: 'download',       hashFor: importHash,    matches: ['import'] },
  { id: 'templates', label: 'Templates', icon: 'extension',      hashFor: templatesHash, matches: ['templates'] },
  { id: 'settings',  label: 'Settings',  icon: 'settings',       hashFor: (w) => settingsHash(w), matches: ['settings'] },
];

export interface RoomNavMount {
  target: HTMLElement;
}

export function mountRoomNav(mount: RoomNavMount): () => void {
  const { target } = mount;
  target.innerHTML = '';

  const strip = document.createElement('div');
  strip.className = 'atlas-room-nav-strip';
  target.appendChild(strip);

  function render(): void {
    strip.innerHTML = '';
    const route = parseHash(window.location.hash);
    const worldId = route.worldId ?? getState().active?.worldId ?? null;
    if (!worldId) return; // No world → strip stays empty; container is hidden anyway.

    for (const room of ROOMS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'atlas-room-nav-btn';
      btn.setAttribute('data-room', room.id);
      btn.setAttribute('aria-label', room.label);
      btn.title = room.label;
      if (room.matches.includes(route.mode)) {
        btn.classList.add('active');
      }
      btn.innerHTML = `<span class="material-symbols-outlined">${room.icon}</span>`;
      btn.addEventListener('click', () => navigate(room.hashFor(worldId)));
      strip.appendChild(btn);
    }
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();

  return () => {
    unsubState();
    unsubHash();
  };
}
