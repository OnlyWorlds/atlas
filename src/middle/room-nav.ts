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
import { isDrawerOpen, onNarrowChange, toggleDrawer, type DrawerName } from '../layout/narrow-layout';
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
  // Search room DELETED (session 256; nav-hidden since 240) — the elements-
  // sidebar name filter is the interim search surface; the real replacement
  // is the Cmd+K command palette (see DESIGN.md "Search").
  // Icon: `wall_art` (S255v3, Captain's ask: not a globe, not a share-sheet —
  // the room is about showing off, publishing, displaying; a framed piece on
  // a wall is the exhibit).
  { id: 'share',     label: 'Pages',          icon: 'wall_art',       hashFor: (w) => shareHash(w), matches: ['share'] },
  { id: 'import',    label: 'Data',            icon: 'import_export',  hashFor: importHash,    matches: ['import'] },
  // Templates room DELETED (session 256; never built past a stub).
  // Settings dropped from the strip S255v4 (Captain): the sidebar footer gear
  // is the one settings entrance. Route + gear-as-toggle unaffected.
];

export interface RoomNavMount {
  target: HTMLElement;
}

/** Open the Cmd+K palette (dynamic import — same lazy path the hotkey uses). */
async function openPalette(): Promise<void> {
  const { openCommandPalette } = await import('../ui/command-palette');
  openCommandPalette();
}

/** Rooms shown in the labeled onboarding preview (settings joins later). */
const PREVIEW_ROOM_IDS = new Set(['home', 'writing', 'knowledge', 'timeline', 'share', 'import']);

/** Persistent labels-on preference — the ghost expander toggles it (S255v3). */
const NAV_LABELS_KEY = 'atlas_nav_labels';

export function mountRoomNav(mount: RoomNavMount): () => void {
  const { target } = mount;
  target.innerHTML = '';

  const strip = document.createElement('div');
  strip.className = 'atlas-room-nav-strip';
  target.appendChild(strip);

  // Tracks the preview→real transition: when the first world activates, one
  // render keeps the labels in the DOM and collapses them (max-width → 0),
  // so the icons visibly slide into their real nav positions (S255v2).
  let wasPreview = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  function renderPreview(): void {
    strip.innerHTML = '';
    strip.classList.add('is-preview');
    // The sidebar toggle belongs here too (S366): with no world open the
    // worlds sidebar is the ONLY way in, and below 820px it is a drawer. The
    // preview strip used to carry no toggle, so a narrow window with no world
    // (the first visit, or after "set up a folder") had no way to reach it.
    strip.appendChild(drawerToggle('sidebar', 'left_panel_open', 'Worlds and elements'));
    for (const room of ROOMS) {
      if (!PREVIEW_ROOM_IDS.has(room.id)) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'atlas-room-nav-btn atlas-room-nav-preview-btn';
      // aria-disabled, NOT native disabled (S309 — finishing the S301 call):
      // a disabled control fires no hover, so no tooltip can ever explain it.
      // These have no click handler, so removing `disabled` changes nothing
      // except that hover/focus now teach what the room will be.
      btn.setAttribute('aria-disabled', 'true');
      btn.title = `${room.label} · opens once a world exists`;
      btn.innerHTML =
        `<span class="material-symbols-outlined">${room.icon}</span>` +
        // S308: this carried `room.id === 'import' ? 'import' : ...`, a
        // shortener written when the label was "Import & export" and stranded
        // by the rename to "Data" — so the tooltip said Data and the label
        // underneath said import, on one control.
        `<span class="atlas-room-nav-label">${room.label.toLowerCase()}</span>`;
      strip.appendChild(btn);
    }
    wasPreview = true;
  }

  function render(): void {
    // Settle choreography in flight: world activation floods state updates,
    // and a mid-animation re-render would strip the labels instantly. Skip;
    // the timer's final pass repaints fresh (380ms, nothing user-critical
    // changes in the strip within that window).
    if (settleTimer) return;
    const route = parseHash(window.location.hash);
    const worldId = route.worldId ?? getState().active?.worldId ?? null;
    // A worldId the registry doesn't know (stale URL hash surviving a
    // clear-site-data, dead deep link) must not paint the real nav — it was
    // rendering a stuck icon-only strip full of dead routes (S255v4).
    const known = worldId != null && (
      getState().active?.worldId === worldId ||
      getState().registry.worlds.some(w => w.id === worldId)
    );
    if (!worldId || !known) {
      renderPreview();
      return;
    }

    const labelsOn = localStorage.getItem(NAV_LABELS_KEY) === '1';
    const settling = wasPreview && !labelsOn;
    wasPreview = false;
    strip.innerHTML = '';
    strip.classList.remove('is-preview');

    // Narrow-window drawer toggles (S323). Rendered ALWAYS and hidden by CSS
    // above the breakpoints, so the strip's markup does not change shape when
    // a window is resized across one — a re-render race on a resize is the
    // kind of thing that leaves a control missing until the next navigation.
    strip.appendChild(drawerToggle('sidebar', 'left_panel_open', 'Worlds and elements'));

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
      // Labels ride along while settling (then collapse) or permanently when
      // the ghost expander has them toggled on.
      const labelHtml = (settling || labelsOn) && PREVIEW_ROOM_IDS.has(room.id)
        ? `<span class="atlas-room-nav-label">${room.label.toLowerCase()}</span>`
        : '';
      btn.innerHTML = `<span class="material-symbols-outlined">${room.icon}</span>${labelHtml}`;
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

    // Ghost expander: re-shows / hides the room labels at will (S255v3 —
    // Captain wanted the settle-in re-showable; a persistent labels mode
    // beats a one-shot replay). Dim chevron at the end of the icon run.
    const expander = document.createElement('button');
    expander.type = 'button';
    expander.className = 'atlas-room-nav-expand';
    expander.title = labelsOn ? 'Hide room names' : 'Show room names';
    expander.innerHTML = `<span class="material-symbols-outlined">${labelsOn ? 'keyboard_double_arrow_left' : 'keyboard_double_arrow_right'}</span>`;
    expander.addEventListener('click', () => {
      if (settleTimer) return;
      if (labelsOn) {
        // Collapse with the settle animation, then drop the labels.
        strip.classList.add('is-settling');
        settleTimer = setTimeout(() => {
          strip.classList.remove('is-settling');
          settleTimer = null;
          localStorage.setItem(NAV_LABELS_KEY, '0');
          render();
        }, 420);
      } else {
        // Mount labels pre-collapsed, then release for the expand transition.
        localStorage.setItem(NAV_LABELS_KEY, '1');
        strip.classList.add('is-settling');
        render();
        requestAnimationFrame(() => requestAnimationFrame(() => strip.classList.remove('is-settling')));
      }
    });
    strip.appendChild(expander);

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

    // Search affordance (Captain, S309): the command palette is the app's only
    // global search and was reachable by shortcut alone. One field-shaped
    // control anchored at the strip's far right opens the SAME palette —
    // one search, two doors; an inline twin would be a second search surface
    // that can drift from the first.
    //
    // The spacer renders UNCONDITIONALLY (S312): it used to be skipped when an
    // element chip was present, which parked the search pill immediately after
    // the chip — mid-strip on prod, exactly where Captain found it. The pill's
    // anchor is the strip's right edge, chip or no chip.
    const spacer = document.createElement('div');
    spacer.className = 'atlas-room-nav-spacer';
    strip.appendChild(spacer);
    const search = document.createElement('button');
    search.type = 'button';
    search.className = 'atlas-room-nav-search';
    search.title = 'Search this world · Ctrl+K';
    search.setAttribute('aria-label', 'Search this world');
    search.innerHTML =
      `<span class="material-symbols-outlined">search</span>` +
      `<span class="atlas-room-nav-search-text">search</span>` +
      `<kbd class="atlas-room-nav-search-kbd">ctrl k</kbd>`;
    search.addEventListener('click', () => { void openPalette(); });
    strip.appendChild(search);

    strip.appendChild(drawerToggle('right', 'right_panel_open', 'Web, maps and charts'));

    if (settling) {
      // Lock re-renders out for the animation's lifetime FIRST, then collapse
      // the labels two frames later (they need one paint at full width).
      settleTimer = setTimeout(() => {
        strip.classList.remove('is-settling');
        settleTimer = null;
        render(); // clean pass without labels
      }, 420);
      requestAnimationFrame(() => requestAnimationFrame(() => strip.classList.add('is-settling')));
    }
  }

  function truncateName(name: string, max: number): string {
    if (name.length <= max) return name;
    return name.slice(0, max - 1).trimEnd() + '…';
  }

  /**
   * A drawer toggle for one of the side panes. Only visible under the narrow
   * breakpoints (CSS), where that pane has stopped being a column.
   */
  function drawerToggle(name: DrawerName, icon: string, label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `atlas-room-nav-drawer-btn is-${name}`;
    btn.setAttribute('data-drawer', name);
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-expanded', String(isDrawerOpen(name)));
    btn.title = label;
    btn.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span>`;
    btn.addEventListener('click', () => { toggleDrawer(name); });
    return btn;
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  // Re-render so the toggles' aria-expanded tracks the drawer state.
  const unsubNarrow = onNarrowChange(render);
  render();

  return () => {
    unsubState();
    unsubHash();
    unsubNarrow();
  };
}
