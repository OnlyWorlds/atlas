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

import { getState, patchSlice, subscribe } from '../core/state';
import {
  onHashChange,
  parseHash,
  navigate,
  homeHash,
  writingHash,
  knowledgeHash,
  timelineHash,
  shareHash,
  importHash,
  settingsHash,
  type RouteMode,
} from '../core/router';
import { writingHashForNarrative } from './writing-helpers';
import { ELEMENT_ICONS } from '../core/constants';
import { elementHash } from '../core/router';
import { escapeText } from '../core/dom-utils';

interface RoomDef {
  id: RouteMode | 'home' | 'writing' | 'knowledge' | 'timeline' | 'search' | 'share' | 'import' | 'templates' | 'settings';
  label: string;
  icon: string; // Material Symbols name
  hashFor: (worldId: string) => string;
  /** Routes that count as "active" for this nav button. */
  matches: RouteMode[];
}

const ROOMS: RoomDef[] = [
  // Home matches 'home', 'elements' (legacy sidebar-mode URL, now middle=home),
  // and 'welcome' (no-world case never reaches room nav, but defensive).
  { id: 'home',      label: 'Home',      icon: 'home',           hashFor: homeHash,      matches: ['home', 'elements'] },
  // Icon pass 2026-07-10 (Captain): writing takes the book; knowledge/charts/
  // share candidates screenshotted for his pick (icons-variant-{a,b}.png).
  { id: 'writing',   label: 'Writing',   icon: 'menu_book',      hashFor: writingHash,   matches: ['writing'] },
  { id: 'knowledge', label: 'Knowledge', icon: 'psychology',     hashFor: knowledgeHash, matches: ['knowledge'] },
  { id: 'timeline',  label: 'Charts',    icon: 'insights',       hashFor: timelineHash,  matches: ['timeline'] },
  // Search room removed pre-release (session 240) — the dedicated room was the
  // weakest search surface; the planned replacement is a Cmd+K command palette
  // (see DESIGN.md "Search"). The elements-sidebar name filter remains interim.
  // Route + search.ts stay dormant; re-add this entry to restore the room.
  { id: 'share',     label: 'Share',          icon: 'ios_share',      hashFor: (w) => shareHash(w), matches: ['share'] },
  { id: 'import',    label: 'Import & export', icon: 'import_export',  hashFor: importHash,    matches: ['import'] },
  // Templates hidden pre-release (not building it before launch). Route +
  // templates-room.ts stay dormant; re-add this entry to restore it to the nav.
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
      btn.addEventListener('click', () => {
        // Special case for writing: clicking the writing icon clears the
        // sidebar writing-takeover override so the tree comes back even if
        // the user previously toggled to worlds/elements within this writing
        // session. Other rooms just navigate.
        if (room.id === 'writing' && getState().ui.sidebarWritingOverride) {
          patchSlice('ui', { ...getState().ui, sidebarWritingOverride: false });
        }
        // Writing icon special: if the user has a remembered last narrative
        // for this world, restore that view. Falls back to the base writing
        // path (empty state) when no memory or the remembered narrative no
        // longer exists.
        if (room.id === 'writing') {
          const entry = getState().registry.worlds.find(w => w.id === worldId);
          const lastId = entry?.last_writing_narrative_id;
          if (lastId) {
            const exists = getState().data.elements.some(e => e.id === lastId && e.type === 'narrative');
            if (exists) {
              navigate(writingHashForNarrative(worldId, lastId, getState().data.elements));
              return;
            }
          }
        }
        navigate(room.hashFor(worldId));
      });
      strip.appendChild(btn);
    }

    // Selected-element chip (far right). Visible whenever a selection exists;
    // gives a persistent "you have X selected, click to return" affordance
    // and ensures the strip always has *something* highlighted when route
    // mode is 'element' (the room buttons themselves never match it).
    const selectedId = getState().ui.selectedElementId;
    if (selectedId) {
      const el = getState().data.elements.find(e => e.id === selectedId);
      if (el) {
        const spacer = document.createElement('div');
        spacer.className = 'atlas-room-nav-spacer';
        strip.appendChild(spacer);

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'atlas-room-nav-selected';
        if (route.mode === 'element') chip.classList.add('active');
        chip.title = `${el.name || '(unnamed)'} · click to view`;
        const truncatedName = truncateName(el.name || '(unnamed)', 22);
        chip.innerHTML = `
          <span class="material-symbols-outlined atlas-room-nav-selected-icon">${ELEMENT_ICONS[el.type] ?? 'category'}</span>
          <span class="atlas-room-nav-selected-name">${escapeText(truncatedName)}</span>
          <span class="material-symbols-outlined atlas-room-nav-selected-close" data-action="clear-selection" title="Clear selection">close</span>
        `;
        chip.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.closest('[data-action="clear-selection"]')) {
            e.stopPropagation();
            patchSlice('ui', { ...getState().ui, selectedElementId: null });
            return;
          }
          navigate(elementHash(worldId, selectedId));
        });
        strip.appendChild(chip);
      }
    }
  }

  function truncateName(name: string, max: number): string {
    if (name.length <= max) return name;
    return name.slice(0, max - 1).trimEnd() + '…';
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();

  return () => {
    unsubState();
    unsubHash();
  };
}
