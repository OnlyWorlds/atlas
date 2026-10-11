/**
 * Elements-mode sidebar body — legacy markup (.atlas-list / .atlas-row).
 *
 * Filter strip (one icon per type) + search input + create button + list.
 * Click a row → select element + navigate to its detail.
 *
 * Body-only — the parent sidebar driver owns the mode toggle and footer gear.
 * Reads element data from `state.data.elements` (primed on world activation
 * by `activateWorld`); mutations refresh that slice with a new array reference.
 */

import { isAtlasGrounded } from '../core/grounded';
import { getState, subscribe, patchSlice } from '../core/state';
import { onHashChange, navigate, elementHash, homeHash } from '../core/router';
import { setWorldFavoriteElement, saveRegistry } from '../registry/registry';
import { CONTENT_ELEMENT_TYPES, type ElementType, type Element } from '../core/types';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import { lensKnownSet } from '../core/knowledge';
import { reservedRowHint } from '../core/taxonomy';
import { styleRowHint } from '../core/world-styles';
import { ToastManager } from '../ui/toast-manager';
import { openCreateDoor } from '../ui/create-element-door';
import { isQuietRef, isTourFlagActive } from '../tour/tour-flag';
import { MUTED_TAIL_TYPES, saveMutedTypes } from '../core/type-mutes';
import { escapeText, escapeAttr, installRowKeydownActivation } from '../core/dom-utils';
import { elementMatchesQuery } from '../core/element-search';
import { roomOf } from '../core/element-room';
import { panMapTabTo } from '../tabs/right/map-tab';
import { locateTargetFor } from './pin-locate';
import { answerHeldBatch, dismissDiskNotice, getDiskNotice, notSyncedNow, onDiskNotice, setDiskShowOnly } from '../core/live-folder';

/** Types shown in the filter strip — matches legacy: all 22 except pin/marker (placed via maps). */
// Pins and markers close the strip (S356): browsable when asked for, muted
// by default (core/type-mutes.ts), always the last two slots.
const FILTER_TYPES_WITH_MAP: ElementType[] = [...CONTENT_ELEMENT_TYPES, 'map', 'zone', ...MUTED_TAIL_TYPES];

/** "a", "a and b", "a, b and c", "a, b, c and 2 more". */
function joinTypeNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length > 4) return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The filter strip in words (S369): "All types", "Showing characters and
 * locations". Types the user hid by right-click are named; pins and markers,
 * hidden by default, are not. Strip order. Pure; exported for unit tests.
 */
export function filterSummary(filters: ReadonlySet<ElementType>, muted: ReadonlySet<ElementType>): string {
  if (filters.size > 0) {
    const shown = FILTER_TYPES_WITH_MAP.filter(t => filters.has(t)).map(t => ELEMENT_LABELS[t].plural);
    return `Showing ${joinTypeNames(shown)}`;
  }
  const hidden = FILTER_TYPES_WITH_MAP
    .filter(t => muted.has(t) && !MUTED_TAIL_TYPES.includes(t))
    .map(t => ELEMENT_LABELS[t].plural);
  return hidden.length === 0 ? 'All types' : `All types except ${joinTypeNames(hidden)}`;
}

/**
 * Single-flight lock for the right-click filter-chip refresh. Prevents
 * spam-clicks from stacking pulls and overlapping toasts (W4).
 */

/**
 * Element ids currently flashing in the sidebar (P3 / W5). A module-level
 * Set rather than DOM attributes because the element row is rebuilt on
 * every render — `pullNowAndRefresh` patches `data.elements` AFTER
 * dispatching `atlas:pulled-ids`, so an attribute set on the DOM during
 * the event would be wiped by the very next render. Storing the ids
 * out-of-DOM lets `renderElementRow` re-emit `data-flash="true"` on each
 * render until the timer clears the id.
 *
 * Set of id → cleanup timer handle.
 */
const flashingIds = new Map<string, ReturnType<typeof setTimeout>>();

/** Tour arrivals for the current step (S317) — sticky, replaced per dispatch. */
const tourFreshIds = new Set<string>();

/** All currently-mounted elements bodies (re-render hooks for the flash set). */
const mountedRerenders = new Set<() => void>();

/**
 * Public: trigger a flash for these ids. Called from the document-level
 * `atlas:pulled-ids` listener installed by every mounted body. Idempotent —
 * subsequent calls for the same id reset the timer.
 */
function triggerFlashForIds(ids: readonly string[]): void {
  if (ids.length === 0) return;
  for (const id of ids) {
    const existing = flashingIds.get(id);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => {
      flashingIds.delete(id);
      // Re-render every mounted body to drop the data-flash attribute.
      for (const fn of mountedRerenders) fn();
    }, 1400);
    flashingIds.set(id, handle);
  }
  // Re-render now so newly-flashing rows pick up the attribute.
  for (const fn of mountedRerenders) fn();
}

export interface ElementsBodyMount {
  content: HTMLElement;
  toasts: ToastManager;
}

export function mountElementsBody(mount: ElementsBodyMount): () => void {
  const { content, toasts } = mount;
  content.innerHTML = '';

  // ----- Filter strip -----
  const strip = document.createElement('div');
  strip.className = 'atlas-filter-strip';
  content.appendChild(strip);

  // ----- Search + create row (legacy pattern: + icon inside the search row) -----
  const searchRow = document.createElement('div');
  searchRow.className = 'atlas-search-row';
  const searchInput = document.createElement('input');
  searchInput.className = 'atlas-input';
  searchInput.type = 'text';
  searchInput.placeholder = 'Search elements…';
  searchInput.setAttribute('data-role', 'elements-search');
  searchInput.style.flex = '1 1 auto';
  searchRow.appendChild(searchInput);

  const createBtn = document.createElement('button');
  createBtn.type = 'button';
  createBtn.className = 'atlas-create-btn';
  createBtn.setAttribute('data-action', 'create-element');
  createBtn.title = 'New element';
  createBtn.innerHTML = '<span class="material-symbols-outlined">add</span>';
  // Whatever's typed in the search field rides into the create modal as the
  // name (S255v3): searched-for-it-and-it's-missing flows straight into
  // making it, and the empty-world "Create an element…" placeholder keeps
  // its promise.
  // The tour's scripting lives in the shared door (S301), not here: this
  // handler used to carry the only tour branch in the app while Ctrl+E and the
  // Charts room opened a free modal beside it.
  createBtn.addEventListener('click', () => { openNormalCreate(); });

  function openNormalCreate(): void {
    openCreateDoor(toasts, {
      initialName: searchInput.value.trim() || undefined,
      // A single active type filter carries into the modal as the preselected
      // category (S265, Captain) — filtering to characters then hitting + means
      // "another character" far more often than not.
      initialType: getState().ui.elementFilters?.size === 1
        ? [...getState().ui.elementFilters][0]
        : undefined,
      // The search text became the element's name — clear the filter so the
      // new element isn't the only visible row (S255v4, Captain).
      afterCreate: () => {
        searchInput.value = '';
        patchSlice('ui', { ...getState().ui, search: '' });
      },
    });
  }
  searchRow.appendChild(createBtn);

  content.appendChild(searchRow);

  // ----- What the strip is showing, in words (S369) -----
  // The strip is 22 glyphs and no words; this line says what they select.
  // Under the search row, not under the strip: the strip band's height is
  // matched by the writing sidebar so the two search rows line up.
  const filterSummaryLine = document.createElement('div');
  filterSummaryLine.className = 'atlas-row-meta atlas-filter-summary';
  filterSummaryLine.setAttribute('data-role', 'filter-summary');
  filterSummaryLine.setAttribute('aria-live', 'polite');
  content.appendChild(filterSummaryLine);

  searchInput.addEventListener('input', () => {
    patchSlice('ui', { ...getState().ui, search: searchInput.value });
  });

  // ----- Taxonomy sub-filter row (D9b lever 3) -----
  // Progressive disclosure: when the filter strip narrows to exactly ONE type,
  // a second small chip row appears with that type's distinct supertypes
  // (derived live from the loaded elements — never tracked). Picking one
  // narrows the list and reveals its subtypes as a second chip tier. State is
  // sidebar-local and resets whenever the single-type condition breaks.
  const subFilterRow = document.createElement('div');
  subFilterRow.className = 'atlas-subfilter-row';
  subFilterRow.hidden = true;
  content.appendChild(subFilterRow);
  let subFilterType: ElementType | null = null;   // which type the row is showing
  let superFilter: string | null = null;          // selected supertype (trimmed)
  let subtypeFilter: string | null = null;        // selected subtype (trimmed)

  function taxonomyValues(elements: readonly Element[], type: ElementType, field: 'supertype' | 'subtype', withinSupertype: string | null): string[] {
    const counts = new Map<string, number>();
    for (const el of elements) {
      if (el.type !== type) continue;
      if (withinSupertype && String((el as Record<string, unknown>).supertype ?? '').trim() !== withinSupertype) continue;
      const v = (el as Record<string, unknown>)[field];
      if (typeof v !== 'string') continue;
      const t = v.trim();
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.keys()]
      .sort((a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b));
  }

  function renderSubFilters(): void {
    const state = getState();
    const filters = state.ui.elementFilters;
    const single = filters.size === 1 ? [...filters][0] : null;
    if (!single) {
      subFilterRow.hidden = true;
      subFilterType = null; superFilter = null; subtypeFilter = null;
      return;
    }
    if (subFilterType !== single) {
      subFilterType = single; superFilter = null; subtypeFilter = null;
    }
    const supers = taxonomyValues(state.data.elements, single, 'supertype', null);
    // A selected value that no longer exists in the world (last holder edited
    // away) would leave a filter active with no chip to click off — auto-clear
    // instead of stranding the user on an empty list.
    if (superFilter && !supers.includes(superFilter)) {
      superFilter = null;
      subtypeFilter = null;
    }
    if (superFilter && subtypeFilter
      && !taxonomyValues(state.data.elements, single, 'subtype', superFilter).includes(subtypeFilter)) {
      subtypeFilter = null;
    }
    if (supers.length === 0) {
      subFilterRow.hidden = true;
      return;
    }
    subFilterRow.hidden = false;
    subFilterRow.innerHTML = '';
    for (const v of supers.slice(0, 12)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'atlas-subfilter-chip' + (superFilter === v ? ' active' : '');
      chip.textContent = v;
      chip.title = `Show only ${single}s with supertype "${v}"`;
      chip.addEventListener('click', () => {
        superFilter = superFilter === v ? null : v;
        subtypeFilter = null;
        render();
      });
      subFilterRow.appendChild(chip);
    }
    // Second tier: subtypes within the chosen supertype.
    if (superFilter) {
      for (const v of taxonomyValues(state.data.elements, single, 'subtype', superFilter).slice(0, 12)) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'atlas-subfilter-chip sub' + (subtypeFilter === v ? ' active' : '');
        chip.textContent = `· ${v}`;
        chip.title = `Narrow to subtype "${v}"`;
        chip.addEventListener('click', () => {
          subtypeFilter = subtypeFilter === v ? null : v;
          render();
        });
        subFilterRow.appendChild(chip);
      }
    }
  }

  // ----- Knowledge lens banner (hidden unless ui.knowledgeLens is set) -----
  // Explains why the list is dimmed + offers the exit. The lens persists
  // across rooms, so this is the always-visible affordance (the toggle that
  // set it lives in the known-view, which the user may have left).
  const lensBanner = document.createElement('div');
  lensBanner.className = 'atlas-lens-banner';
  lensBanner.setAttribute('data-active', 'false');
  const lensLabel = document.createElement('span');
  lensLabel.className = 'atlas-lens-banner-label';
  const lensOff = document.createElement('button');
  lensOff.type = 'button';
  lensOff.className = 'atlas-lens-banner-off';
  lensOff.title = 'Turn the knowledge lens off';
  lensOff.innerHTML = '<span class="material-symbols-outlined">close</span>';
  lensOff.addEventListener('click', () => {
    patchSlice('ui', { ...getState().ui, knowledgeLens: null });
  });
  lensBanner.innerHTML = '<span class="material-symbols-outlined atlas-lens-banner-icon">visibility</span>';
  lensBanner.appendChild(lensLabel);
  lensBanner.appendChild(lensOff);
  content.appendChild(lensBanner);

  // ----- Cast-assign banner (hidden unless ui.castAssign is set) -----
  // The home ghost card put the sidebar in assignment mode: the next click
  // on a matching row assigns the world's protagonist/home (one hop, no
  // hunting for the header pin — Captain, 2026-07-10).
  // Own class FAMILY, none shared with .atlas-lens-banner-* — the lens e2e
  // uses strict locators on those classes and a second match breaks them
  // (live finding, twice: parent AND child classes). CSS mirrors the look.
  const assignBanner = document.createElement('div');
  assignBanner.className = 'atlas-cast-assign-banner';
  assignBanner.setAttribute('data-active', 'false');
  const assignLabel = document.createElement('span');
  assignLabel.className = 'atlas-cast-assign-label';
  const assignOff = document.createElement('button');
  assignOff.type = 'button';
  assignOff.className = 'atlas-cast-assign-off';
  assignOff.title = 'Cancel assigning';
  assignOff.innerHTML = '<span class="material-symbols-outlined">close</span>';
  assignOff.addEventListener('click', () => {
    patchSlice('ui', { ...getState().ui, castAssign: null });
  });
  assignBanner.innerHTML = '<span class="material-symbols-outlined atlas-cast-assign-icon">person_pin</span>';
  assignBanner.appendChild(assignLabel);
  assignBanner.appendChild(assignOff);
  content.appendChild(assignBanner);

  // ----- The live folder's notice (S364): what another tool changed on disk -----
  // One line: "N changed on disk · show", plus what will not sync and what
  // cannot be read; a second line when a big batch holds sync for an answer.
  const diskBar = document.createElement('div');
  diskBar.className = 'atlas-disk-notice';
  diskBar.setAttribute('data-active', 'false');
  diskBar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-disk-action]');
    if (!btn) return;
    const action = btn.dataset.diskAction;
    if (action === 'show') setDiskShowOnly(!getDiskNotice()?.showOnly);
    else if (action === 'dismiss') dismissDiskNotice();
    else if (action === 'upload') void answerHeldBatch(true);
    else if (action === 'offline') void answerHeldBatch(false);
  });
  content.appendChild(diskBar);
  let lastDiskBar = '';
  function renderDiskBar(): void {
    const n = getDiskNotice();
    const active = !!n && (n.marked.size > 0 || n.unreadable.length > 0 || n.removed.length > 0 || !!n.held);
    const parts: string[] = [];
    if (n && n.marked.size > 0) {
      parts.push(`<span class="atlas-disk-notice-count">${n.marked.size} changed on disk</span>`);
      const notSynced = notSyncedNow(n, getState().data.elements);
      if (notSynced > 0) {
        parts.push(`<span class="atlas-disk-notice-warn" title="Changed outside Atlas without a new edit time, so they do not upload. Change them in Atlas to upload them.">${notSynced} not synced</span>`);
      }
      parts.push(`<button type="button" class="atlas-disk-notice-btn" data-disk-action="show">${n.showOnly ? 'Show all' : 'Show'}</button>`);
    }
    if (n && n.removed.length > 0) {
      const linked = getState().registry.worlds.find(w => w.id === n.worldId)?.state === 'api-linked';
      const tip = `Removed from the world folder by another program: ${n.removed.join(', ')}.`
        + (linked ? ' They are gone from this folder only and stay on your OnlyWorlds account; Refresh from OnlyWorlds brings them back.' : '');
      parts.push(`<span class="atlas-disk-notice-warn" title="${escapeAttr(tip)}">${n.removed.length} removed on disk</span>`);
    }
    if (n && n.unreadable.length > 0) {
      const tip = `These files would not open, so Atlas shows them as they were: ${n.unreadable.join(', ')}`;
      parts.push(`<span class="atlas-disk-notice-warn" title="${escapeAttr(tip)}">${n.unreadable.length} cannot be read</span>`);
    }
    const held = n?.held
      ? `<div class="atlas-disk-notice-held">Sync is waiting: ${n.held.count} elements changed on disk. `
        + `<button type="button" class="atlas-disk-notice-btn" data-disk-action="upload">Upload them</button> `
        + `<button type="button" class="atlas-disk-notice-btn" data-disk-action="offline">Pause sync</button></div>`
      : '';
    const html = !active ? '' : `<div class="atlas-disk-notice-line">`
      + `<span class="material-symbols-outlined atlas-disk-notice-icon">folder_open</span>`
      + parts.join('<span class="atlas-disk-notice-sep">·</span>')
      + (parts.length > 0 ? `<button type="button" class="atlas-disk-notice-off" data-disk-action="dismiss" title="Mark all seen"><span class="material-symbols-outlined">close</span></button>` : '')
      + `</div>${held}`;
    if (html === lastDiskBar) return;
    lastDiskBar = html;
    diskBar.setAttribute('data-active', active ? 'true' : 'false');
    diskBar.innerHTML = html;
  }

  // ----- List body -----
  const listEl = document.createElement('div');
  listEl.className = 'atlas-list';
  content.appendChild(listEl);

  installRowKeydownActivation(listEl);
  listEl.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-element-id]');
    if (!row) return;
    const id = row.getAttribute('data-element-id')!;
    const worldId = getState().active?.worldId;
    if (!worldId) return;
    // The on-map badge (the `place` glyph) is a LOCATE control (Captain's
    // launch note): click it to pan the open map to this element's pin, or a
    // zone's marker centroid, instead of routing to the element's room. The
    // badge only renders for active-map presence, so a target exists by
    // construction; if we somehow can't resolve one we fall through to the
    // normal open. Suppressed during cast-assign (a click there means assign).
    if (!getState().ui.castAssign
        && (e.target as HTMLElement).closest('.atlas-elements-row-onmap-badge')
        && locateOnActiveMap(id)) {
      return;
    }
    // Assignment mode: a click on a MATCHING row assigns the cast slot and
    // returns home to show the result (the loop the ghost card opened).
    const assign = getState().ui.castAssign;
    if (assign) {
      const el = getState().data.elements.find(x => x.id === id);
      const wantType = assign.kind === 'protagonist' ? 'character' : 'location';
      if (el?.type === wantType) {
        const next = setWorldFavoriteElement(getState().registry, worldId, assign.kind, id);
        saveRegistry(next);
        patchSlice('registry', next);
        patchSlice('ui', { ...getState().ui, castAssign: null });
        toasts.success(`${el.name || 'This element'} is now the world's ${assign.kind === 'protagonist' ? 'protagonist' : 'home'}`);
        navigate(homeHash(worldId));
        return;
      }
      // Mismatched type (user cleared the filter): fall through to normal open.
    }
    // Route to the room the element LIVES in (S306), the same answer the
    // palette and the home desk give. This list is the palette's OWN handoff
    // target — "see all →" hands its query straight here, and the two already
    // share their match language deliberately (see the filter above). Leaving
    // this as a bare `elementHash` meant one query, one surface, two
    // destinations: Enter in the palette opened the map/page/chapter, while
    // clicking the identical row here opened the field editor. When surface A
    // hands work to surface B, B has to keep A's promise.
    const clicked = getState().data.elements.find(x => x.id === id);
    const room = clicked ? roomOf(clicked, worldId) : { hash: '', label: '' };
    // MAPS ARE DELIBERATELY EXCLUDED HERE, and it is not an oversight.
    //
    // A map is the one type with BOTH a canvas (a right-pane tab) and an
    // editable record. This list is the browse-and-EDIT surface: clicking a map
    // here is how you reach its element page to set the name, the parent, or
    // the Image URL — and that last one is the real user path the S300
    // sketch-rescale hook hangs off (attaching art to a blank canvas rescales
    // its pins and zone markers). Routing map rows to the canvas instead took
    // that path away, which an existing spec caught immediately.
    //
    // The narratives have no such split — the knowledge / share / writing room
    // IS their editor, so sending them there loses nothing and is the whole
    // point of the fix.
    if (!clicked || room.label === '' || room.label === 'map') {
      patchSlice('ui', { ...getState().ui, selectedElementId: id });
      navigate(elementHash(worldId, id));
      return;
    }
    navigate(room.hash);
    // Sidebar-click no longer auto-opens an associated map (DESIGN_MAPS.md
    // §3.6 revised session 209). Auto-open from pin-click stays; the top-bar
    // affordances from MW will be the explicit path from element detail.
    // Convention #32: deselection happens via Esc, NOT via re-click of the
    // selected row. Re-click would conflict with common test/UX patterns
    // (re-clicking a row to refresh focus). Esc is the canonical exit.
  });

  // Drag-onto-map: rows are draggable; payload is {id, type}. Map tabs accept
  // the drop and create a pin at the drop coords (DESIGN_MAPS.md §8 — was
  // deferred from legacy as "drag-from-list deferred"; now landed). Pin/
  // marker/zone/map are pre-filtered from the list, so every draggable row
  // is a valid pin target.
  listEl.addEventListener('dragstart', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-element-id]');
    if (!row) return;
    const id = row.getAttribute('data-element-id');
    const type = row.getAttribute('data-element-type');
    if (!id || !type) return;
    // Type guard: maps and zones aren't pinnable. Map per §1.4; zones
    // because they're marker-constructed not pinned. Both render in the
    // sidebar list (zones for browsing, maps for selection) but neither
    // can become a pin target.
    if (type === 'map' || type === 'zone') {
      e.preventDefault();
      return;
    }
    const payload = JSON.stringify({ id, type });
    // Custom MIME so map-tab's drop handler can identify it cleanly without
    // colliding with file drops or generic text drops.
    e.dataTransfer?.setData('application/x-atlas-element', payload);
    e.dataTransfer?.setData('text/plain', id);
    e.dataTransfer!.effectAllowed = 'copy';
    row.classList.add('atlas-row-dragging');
  });
  listEl.addEventListener('dragend', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-element-id]');
    row?.classList.remove('atlas-row-dragging');
  });

  function renderFilters(): void {
    const state = getState();
    const elements = state.data.elements;
    const filters = state.ui.elementFilters;
    const muted = state.ui.mutedTypes;
    const countByType = new Map<ElementType, number>();
    for (const el of elements) countByType.set(el.type, (countByType.get(el.type) ?? 0) + 1);

    strip.innerHTML = '';
    filterSummaryLine.textContent = filterSummary(filters, muted);
    // During the tour the strip shows only types the world actually holds —
    // it GROWS as the world does, matching the reveal grammar (precision
    // audit #1, Captain-blessed 2026-07-20). Outside the tour: all types.
    const touring = isTourFlagActive();
    FILTER_TYPES_WITH_MAP.forEach(type => {
      if (touring && !(countByType.get(type) ?? 0)) return;
      const btn = document.createElement('button');
      const isMuted = muted.has(type) && !filters.has(type);
      btn.className = 'atlas-filter-btn' + (filters.has(type) ? ' active' : '') + (isMuted ? ' muted' : '');
      // Instant CSS tooltip (S264, Captain: the category label should appear
      // the moment you hover) — data-tip drives a ::after pseudo; no native
      // title (its OS delay is the complaint, and doubling would ghost).
      btn.dataset.tip = isMuted
        ? `${ELEMENT_LABELS[type].plural} (hidden when showing all; right-click to show)`
        : ELEMENT_LABELS[type].plural;
      // ...and the SAME text as the accessible name. `data-tip` is invisible to
      // assistive tech, so with the icon ligature correctly hidden (S308) these
      // buttons would otherwise have no accessible name at all — my own
      // icon-a11y sweep created that gap and its audit caught it. A visual
      // tooltip is not a label.
      btn.setAttribute('aria-label', ELEMENT_LABELS[type].plural);
      // The selected state, for assistive tech as for the eye (S369).
      btn.setAttribute('aria-pressed', filters.has(type) ? 'true' : 'false');
      btn.setAttribute('data-filter-type', type);

      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined';
      icon.textContent = ELEMENT_ICONS[type];
      btn.appendChild(icon);

      const count = countByType.get(type) ?? 0;
      if (count > 0) {
        const badge = document.createElement('span');
        badge.className = 'atlas-filter-count';
        badge.textContent = count > 99 ? '99+' : String(count);
        btn.appendChild(badge);
      }

      btn.addEventListener('click', () => {
        const curr = getState().ui.elementFilters;
        const next = new Set(curr);
        if (next.has(type)) next.delete(type); else next.add(type);
        patchSlice('ui', { ...getState().ui, elementFilters: next });
      });

      // Right-click → MUTE (S356): the type drops out of "show all" and
      // greys, one right-click brings it back. This replaced the per-type
      // "refresh from API" intent (a global pull dressed as a type action;
      // the sync pill's pull-now is the honest home for it). Muting a type
      // that was explicitly filtered on also drops that filter.
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const ui = getState().ui;
        const nextMuted = new Set(ui.mutedTypes);
        const nextFilters = new Set(ui.elementFilters);
        if (nextMuted.has(type)) nextMuted.delete(type);
        else { nextMuted.add(type); nextFilters.delete(type); }
        const worldId = getState().active?.worldId;
        if (worldId) saveMutedTypes(worldId, nextMuted);
        patchSlice('ui', { ...ui, mutedTypes: nextMuted, elementFilters: nextFilters });
      });

      strip.appendChild(btn);
    });
  }

  // THE LIST MEMO (S362). `render` runs on EVERY state notify and every hash
  // change, and the list is one innerHTML over every unmuted element: on
  // Sikelia (12,306 elements) that is 7,752 rows, 3 MB of markup and ~180 ms
  // of layout in Chromium, paid for sync ticks, toasts and each half of a row
  // click. The rows depend only on the inputs below; when none moved, the
  // list is left alone, and when only the selection moved, two classes move.
  // Anything new a row reads must join `listInputs` or it will not repaint.
  let lastList: Record<string, unknown> | null = null;
  let lastSelectedId: string | null = null;
  const sameInputs = (a: Record<string, unknown>, b: Record<string, unknown>): boolean =>
    Object.keys(a).every(k => a[k] === b[k]);

  function render(): void {
    const state = getState();

    if (!state.active) {
      lastList = null;
      strip.innerHTML = '';
      subFilterRow.hidden = true;
      subFilterType = null; superFilter = null; subtypeFilter = null;
      lensBanner.setAttribute('data-active', 'false');
      assignBanner.setAttribute('data-active', 'false');
      // Empty-state copy depends on what action the user can actually take.
      // (Session 221 W2 follow-up: the sidebar's old "pick one from Worlds tab"
      // message lied when there were no worlds because no atlas root existed.)
      // Pre-setup the panes stay silent — the middle pane is the only voice
      // on first launch (S255). With a root, the copy names the real action.
      let msg: string;
      if (!isAtlasGrounded(state)) {
        msg = '';
      } else if (state.registry.worlds.length === 0) {
        msg = 'No worlds yet. Create one from the Worlds tab.';
      } else {
        msg = 'No world open. Pick one from the Worlds tab.';
      }
      listEl.innerHTML = msg ? `<div class="atlas-pane-empty">${msg}</div>` : '';
      return;
    }

    renderFilters();
    renderSubFilters();

    if (searchInput.value !== state.ui.search) searchInput.value = state.ui.search;

    const elements = state.data.elements;
    const filters = state.ui.elementFilters;
    const query = state.ui.search.trim().toLowerCase();
    const selectedId = state.ui.selectedElementId;

    // Empty world: the search field invites creating instead (typed text
    // rides into the modal as the name), and the + button pulses a few beats
    // to spotlight where creation lives (S255v3).
    const worldEmpty = elements.length === 0 && !state.data.loading;
    searchInput.placeholder = worldEmpty ? 'Create an element…' : 'Search elements…';
    createBtn.classList.toggle('atlas-create-pulse', worldEmpty);

    // Knowledge lens: rows OUTSIDE the knower's known set dim. The banner
    // names the knower + offers the exit ×.
    const lens = state.ui.knowledgeLens;
    const knower = lens ? elements.find(e => e.id === lens.knowerId) : undefined;
    const knownSet = lens && knower ? lensKnownSet(lens.knowerId, elements) : null;
    lensBanner.setAttribute('data-active', knownSet ? 'true' : 'false');
    if (knownSet) lensLabel.textContent = `World as ${knower!.name || '(unnamed)'} knows it`;

    // Cast-assign banner: says what the next click does + offers the exit ×.
    const assign = state.ui.castAssign;
    assignBanner.setAttribute('data-active', assign ? 'true' : 'false');
    if (assign) {
      const isProt = assign.kind === 'protagonist';
      assignLabel.textContent = isProt
        ? 'Click a character to set your protagonist'
        : 'Click a location to set your home';
      const icon = assignBanner.querySelector('.atlas-cast-assign-icon');
      if (icon) icon.textContent = isProt ? 'person_pin' : 'home_pin';
    }

    // Pins + markers are map artifacts, created from map interactions and
    // reached through their map; they used to be excluded from this list
    // outright. Since S356 they are MUTED by default instead (hidden when
    // showing all, listed when filtered to), and any type can be muted the
    // same way: a world with 3,143 markers wants to read as 257 places.
    const muted = state.ui.mutedTypes;
    const activeMapId = (() => {
      const active = state.ui.rightTabs[state.ui.rightActiveIndex];
      return active && active.kind === 'map' ? active.mapId : null;
    })();
    renderDiskBar();
    const disk = getDiskNotice();
    const diskMarked = disk?.marked ?? new Set<string>();
    const diskOnly = !!disk?.showOnly && diskMarked.size > 0;
    const listInputs: Record<string, unknown> = {
      elements,
      disk: [...diskMarked].join(','),
      diskOnly,
      rules: state.styles.rules,
      filters: [...filters].sort().join(','),
      muted: [...muted].sort().join(','),
      query,
      superFilter,
      subtypeFilter,
      lens: lens?.knowerId ?? null,
      activeMapId,
      flashing: [...flashingIds.keys()].join(','),
      tourFresh: isTourFlagActive() ? [...tourFreshIds].join(',') : '',
      loading: state.data.loading,
      progress: state.data.loadingProgress?.done ?? null,
    };
    if (lastList && sameInputs(listInputs, lastList)) {
      if (selectedId !== lastSelectedId) {
        listEl.querySelector('.atlas-row.selected')?.classList.remove('selected');
        if (selectedId) listEl.querySelector(`.atlas-row[data-element-id="${CSS.escape(selectedId)}"]`)?.classList.add('selected');
        lastSelectedId = selectedId;
      }
      return;
    }
    lastList = listInputs;
    lastSelectedId = selectedId;

    const filtered = elements
      .filter(el => !diskOnly || diskMarked.has(el.id))
      .filter(el => filters.size > 0 || !muted.has(el.type) || diskOnly)
      // Tour-quiet machinery (the calendar construct) stays out of the list
      // while touring — an element appearing unannounced in the sidebar is
      // exactly the confusion the progressive build-up prevents (S316).
      .filter(el => !isTourFlagActive() || !isQuietRef(`${el.type}:${el.name}`))
      .filter(el => filters.size === 0 || filters.has(el.type))
      .filter(el => !superFilter || String((el as Record<string, unknown>).supertype ?? '').trim() === superFilter)
      .filter(el => !subtypeFilter || String((el as Record<string, unknown>).subtype ?? '').trim() === subtypeFilter)
      // Same match language as the command palette (name/alias/taxonomy/
      // description) — its "see all →" hands queries here and must never
      // under-deliver (core/element-search.ts).
      .filter(el => !query || elementMatchesQuery(el, query))
      // `name` is typed non-optional, but the Folder Format welcomes files
      // written by other tools, and a JSON file on disk with no name key is
      // `undefined` at runtime — which threw here and broke the whole list.
      // Every sibling sort site already guards (writing-sidebar, worlds-sidebar,
      // context-pane-lists); this was the one that did not.
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    if (filtered.length === 0) {
      // Empty ≠ loading: during activation the cache is priming from disk.
      // Empty world says nothing here — the pulsing + button and the home
      // onboarding tiles carry it (S255v3).
      const progress = state.data.loadingProgress;
      const msg = state.data.loading
        ? (progress
            ? `Opening world… ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`
            : 'Opening world…')
        : elements.length === 0
          ? ''
          : 'No elements match the current filter.';
      listEl.innerHTML = msg ? `<div class="atlas-pane-empty">${msg}</div>` : '';
      return;
    }

    // Index which location ids have at least one map anchored to them, so
    // the renderer can paint a small map icon on those Location rows. Built
    // once per render rather than scanning per-row. (DESIGN_MAPS.md §10b N1
    // fix #5 — affordance "this place has maps.")
    const locationsWithMaps = new Set<string>();
    for (const el of elements) {
      if (el.type !== 'map') continue;
      const loc = (el as { location?: unknown }).location;
      if (typeof loc === 'string' && loc) locationsWithMaps.add(loc);
    }

    // Index which element ids have presence on the CURRENTLY ACTIVE map
    // (Captain's session 215 request). Two kinds of presence:
    //   - a pin on the active map references this element → presence
    //   - this element is a zone with a marker on the active map → presence
    // Renders as a small map icon left of the row's category label,
    // signalling "this element is placed on the open map." (`activeMapId`
    // is resolved above, with the list memo's inputs.)
    const elementsOnActiveMap = new Set<string>();
    if (activeMapId) {
      for (const e of elements) {
        if (e.type === 'pin') {
          const pin = e as { element_id?: string; map_id?: string };
          if (pin.map_id === activeMapId && typeof pin.element_id === 'string') {
            elementsOnActiveMap.add(pin.element_id);
          }
        } else if (e.type === 'marker') {
          const marker = e as { zone_id?: string; map_id?: string };
          if (marker.map_id === activeMapId && typeof marker.zone_id === 'string') {
            elementsOnActiveMap.add(marker.zone_id);
          }
        }
      }
    }

    listEl.innerHTML = filtered
      .map(el =>
        renderElementRow(
          el,
          el.id === selectedId,
          locationsWithMaps.has(el.id),
          elementsOnActiveMap.has(el.id),
          flashingIds.has(el.id),
          knownSet ? !knownSet.has(el.id) : false,
          tourFreshIds.has(el.id) && isTourFlagActive(),
          diskMarked.has(el.id),
        ),
      )
      .join('');
  }

  // Auto-pull flash (W5): the document-level listener delegates to the
  // module-scoped `triggerFlashForIds`. Storing flashing ids out of DOM lets
  // the next render (triggered by pullNowAndRefresh's patchSlice) re-emit
  // the attribute, so the animation isn't wiped mid-flight.
  function handlePulledIds(ev: Event): void {
    const detail = (ev as CustomEvent<{ ids?: string[] }>).detail;
    const ids = detail?.ids;
    if (!ids || ids.length === 0) return;
    triggerFlashForIds(ids);
  }
  document.addEventListener('atlas:pulled-ids', handlePulledIds);
  // Tour arrivals (S317): a SUBTLE, STICKY highlight on the step's newly
  // revealed rows — replaced wholesale on every step-enter dispatch (an empty
  // list clears it), no timer, no animation. Distinct channel from the
  // auto-pull flash: the flash says "changed under your nose", this says
  // "these just joined the world you are being shown".
  function handleTourFresh(ev: Event): void {
    const ids = (ev as CustomEvent<{ ids?: string[] }>).detail?.ids ?? [];
    tourFreshIds.clear();
    for (const id of ids) tourFreshIds.add(id);
    for (const fn of mountedRerenders) fn();
  }
  document.addEventListener('atlas:tour-fresh-ids', handleTourFresh);
  mountedRerenders.add(render);

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  const unsubDisk = onDiskNotice(render);
  render();
  return () => {
    unsubState();
    unsubHash();
    unsubDisk();
    mountedRerenders.delete(render);
    document.removeEventListener('atlas:pulled-ids', handlePulledIds);
    document.removeEventListener('atlas:tour-fresh-ids', handleTourFresh);
  };
}

/** Pan the active map tab to an element's on-map placement (a pin's coords or a
 *  zone's marker centroid). Returns true iff a target resolved and a pan was
 *  issued; the caller falls through to opening the element otherwise. The
 *  active-map resolution mirrors the render pass that decides the badge. */
function locateOnActiveMap(id: string): boolean {
  const ui = getState().ui;
  const active = ui.rightTabs[ui.rightActiveIndex];
  const activeMapId = active && active.kind === 'map' ? active.mapId : null;
  if (!activeMapId) return false;
  const target = locateTargetFor(getState().data.elements, id, activeMapId);
  if (!target) return false;
  panMapTabTo(activeMapId, target.x, target.y);
  return true;
}

function renderElementRow(
  el: Element,
  selected: boolean,
  hasMap: boolean,
  onActiveMap: boolean,
  flash: boolean,
  lensDimmed: boolean,
  tourFresh = false,
  diskChanged = false,
): string {
  const icon = ELEMENT_ICONS[el.type] ?? 'category';
  const cls = ['atlas-row', selected ? 'selected' : '', lensDimmed ? 'atlas-row-lens-dim' : '']
    .filter(Boolean).join(' ');
  const flashAttr = (flash ? ' data-flash="true"' : '')
    + (tourFresh ? ' data-tour-fresh="true"' : '')
    + (diskChanged ? ' data-disk-changed="true"' : '');
  // The live folder's mark (S364): changed on disk, until opened or dismissed.
  const diskDot = diskChanged ? '<span class="atlas-row-disk-dot" title="Changed on disk"></span>' : '';
  // hasMap is set only for Location rows that have at least one map anchored.
  // Renders a small cyan-tinted map glyph between the name and the type chip.
  const mapBadge = hasMap
    ? `<span class="material-symbols-outlined atlas-elements-row-mapbadge" title="This location has at least one map">map</span>`
    : '';
  // onActiveMap is set for any element with presence on the currently active
  // map (pin pointing at it, or zone with a marker on the map). Different
  // semantic from `hasMap`: hasMap says "this place anchors a map"; onActiveMap
  // says "this element is rendered on the map you're looking at right now."
  // Rendered just left of the type chip, anchored right.
  const onMapBadge = onActiveMap
    ? `<span class="material-symbols-outlined atlas-elements-row-onmap-badge" title="Locate on the open map">place</span>`
    : '';
  // draggable=true on every row except maps and zones. Map elements appear
  // in the list but can't be pin targets (DESIGN_MAPS.md §1.4); zones can't
  // be pin targets either (constructed via markers, never pinned). Setting
  // the attribute selectively avoids even the start gesture.
  const draggable = (el.type !== 'map' && el.type !== 'zone') ? 'draggable="true"' : '';
  // Reserved-taxonomy mark (D9b): quiet grey sparkle left of the type label
  // when the element's supertype/subtype carries atlas semantics (writing
  // tier / knowledge / page / circle). Same mark family as element detail.
  const reserved = reservedRowHint(el);
  const reservedBadge = reserved
    ? `<span class="material-symbols-outlined atlas-row-reserved" title="${escapeAttr(reserved)}">auto_awesome</span>`
    : '';
  // World-style swatch (S356): the kind's colour, when a rule names it.
  const styled = styleRowHint(getState().styles.rules, el);
  const styleBadge = styled
    ? `<span class="atlas-row-style-swatch" style="background:${escapeAttr(styled.color)}" title="${escapeAttr(styled.title)}"></span>`
    : '';
  // Chronicle sparkle (2026-07-19): elements recorded from play (tangle
  // battle Events, tropaion Objects, chronicle Narratives — supertype
  // 'Chronicle' by the registered convention) carry a quiet mark.
  const chronicleBadge = (el as { supertype?: unknown }).supertype === 'Chronicle'
    ? `<span class="material-symbols-outlined atlas-row-chronicle" title="A chronicle recorded from play">swords</span>`
    : '';
  return `
    <div class="${cls}" ${draggable} data-element-id="${escapeAttr(el.id)}" data-element-type="${escapeAttr(el.type)}"${flashAttr} role="button" tabindex="0">
      <span class="material-symbols-outlined">${icon}</span>
      <span class="atlas-row-main">${escapeText(el.name || '(unnamed)')}</span>
      ${diskDot}
      ${mapBadge}
      ${onMapBadge}
      ${chronicleBadge}
      ${reservedBadge}
      ${styleBadge}
      <span class="atlas-row-meta">${escapeText(el.type)}</span>
    </div>
  `;
}


