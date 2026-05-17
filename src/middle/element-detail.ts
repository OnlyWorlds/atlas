/**
 * Middle pane — element detail view (Bout B: schema-driven editor).
 *
 * Reads schema sections from `field-schema.ts` (SDK FIELD_SCHEMA + ELEMENT_SECTIONS).
 * Each field renders by widget:
 *   - text-short / text-long / number → click value → popover edit
 *   - single-link → chip + pick button (opens picker modal)
 *   - multi-link → chips + add button
 *
 * Reads element data from `state.data.elements` (cached from FolderStore).
 * Writes go through `FolderStore.updateElement` then refresh the cache with
 * a new array reference (force-rerender; convention #2).
 *
 * "Referenced By" section at the bottom: scans `data.elements` for any
 * element whose fields point back at this element's id — SDK-shape-agnostic
 * (scan all array fields whose items have `id` + all scalar id-like fields).
 */

import { getState, patchSlice, subscribe } from '../core/state';
import { onHashChange, parseHash, navigate, elementsHash, elementHash } from '../core/router';
import type { Element, ElementType, WorldMap } from '../core/types';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import { getActiveStore } from '../ui/create-world-modal';
import { openFieldEditPopover } from '../ui/field-edit-popover';
import { openFieldEditInline } from '../ui/field-edit-inline';
import { toastManager } from '../ui/toast-manager';
import { sectionsFor, type FieldMeta, type SectionLayout } from '../editor/field-schema';
import { getFieldDescription } from '../editor/field-descriptions';
import { pickElement } from '../ui/element-picker-modal';
import { requestPushIfLinked } from '../sync/sync-attach';
import { getAssociatedMaps } from '../tabs/right/auto-open-map';
import { openMapTab } from '../tabs/right/map-index-tab';
import { panMapTabTo } from '../tabs/right/map-tab';
import { createMapDialog } from '../ui/map-create-modal';
import { readImageDimsFromUrl } from '../ui/image-dims';
import { getMapsSettings, getEditorSettings } from '../registry/registry';
import { mapHash } from '../core/router';
import { buildZoneSections } from './element-detail-zone-sections';

/** Known acronyms uppercased in labels: "image_url" → "Image URL". */
const ACRONYMS = new Set(['url', 'id', 'api', 'ui', 'ip', 'html', 'http', 'dns', 'uuid', 'sdk', 'pin', 'gps']);

/** Set of `${type}::${section}` keys currently collapsed. Module-level (survives re-render). */
const collapsedSections = new Set<string>();

/**
 * Per-element scroll position memory. Survives re-renders (field edits, link
 * toggles, picker resolves all cause re-renders that would otherwise reset
 * scroll to 0) and back-navigation (A → B → back to A returns to A's saved
 * scrollTop).
 *
 * Key = element id. Cleared lazily on world switch via `resetElementDetailScrollMemory()`.
 * See atlas-deprecated/src/middle/element-detail.ts and craft #104 for rationale.
 */
const scrollMemory = new Map<string, number>();

/** Drop scroll memory — call on world switch so stale ids don't accumulate. */
export function resetElementDetailScrollMemory(): void {
  scrollMemory.clear();
}

/**
 * Pending "auto-edit on next render" signal. When set to an element id, the
 * very next renderHeader for that element opens its name in inline edit mode
 * with the text selected — used by zone-create to drop the user straight into
 * naming (DESIGN_MAPS work pile B3). Consumed on use.
 */
let pendingAutoEditNameForId: string | null = null;

export function requestInlineNameEditOnNextRender(elementId: string): void {
  pendingAutoEditNameForId = elementId;
}

export function mountElementDetail(target: HTMLElement): () => void {
  target.innerHTML = '';

  function getSelectedElement(): Element | null {
    const state = getState();
    const route = parseHash(window.location.hash);
    const id = route.elementId ?? state.ui.selectedElementId;
    if (!id) return null;
    return state.data.elements.find(e => e.id === id) ?? null;
  }

  /**
   * Capture the current body's scrollTop BEFORE we wipe target.innerHTML.
   * Without this, every re-render (field edit, link toggle) would lose the
   * scroll position before the live listener has a chance to save it.
   */
  function captureScrollBeforeRender(): void {
    const prevBody = target.querySelector<HTMLElement>('.atlas-middle-body');
    if (!prevBody) return;
    const prevId = prevBody.dataset.elementId;
    if (prevId && prevBody.scrollTop > 0) {
      scrollMemory.set(prevId, prevBody.scrollTop);
    }
  }

  function render(): void {
    captureScrollBeforeRender();
    target.innerHTML = '';
    const state = getState();
    const route = parseHash(window.location.hash);
    const el = getSelectedElement();

    if (!state.active) {
      target.innerHTML = `<div class="atlas-pane-empty">no active world.</div>`;
      return;
    }
    if (!el) {
      const msg = route.elementId
        ? `element <code>${escapeText(route.elementId)}</code> not found in this world.`
        : 'no element selected. pick one from the <b>elements</b> sidebar.';
      target.innerHTML = `<div class="atlas-pane-empty">${msg}</div>`;
      return;
    }
    renderDetail(el);
  }

  function renderDetail(el: Element): void {
    target.appendChild(renderHeader(el));

    const body = document.createElement('div');
    body.className = 'atlas-middle-body';
    body.dataset.elementId = el.id;
    target.appendChild(body);

    // Live-track scroll position so even partial scrolls survive re-renders.
    body.addEventListener(
      'scroll',
      () => { scrollMemory.set(el.id, body.scrollTop); },
      { passive: true }
    );

    const detail = document.createElement('div');
    detail.className = 'atlas-detail';
    body.appendChild(detail);

    const sections = sectionsFor(el.type);
    sections.forEach((section, idx) => {
      const sectionEl = renderSection(section, el, idx === 0);
      if (sectionEl) detail.appendChild(sectionEl);
    });

    // Zone-specific sections (visuals + markers) — DESIGN_ZONES.md §4.4.
    if (el.type === 'zone') {
      for (const node of buildZoneSections(el as import('../core/types').Zone, toastManager)) {
        detail.appendChild(node);
      }
    }

    const refs = renderReferencedBy(el);
    if (refs) detail.appendChild(refs);

    detail.appendChild(renderFooter(el));

    // Restore previous scrollTop after the body has laid out. scrollTop set on
    // an empty/unrendered body is silently dropped, hence queueMicrotask.
    const restoreTop = scrollMemory.get(el.id);
    if (typeof restoreTop === 'number' && restoreTop > 0) {
      queueMicrotask(() => { body.scrollTop = restoreTop; });
    }
  }

  // ====== Header ======

  /**
   * Replace the name h2 in-place with an editable input. Enter commits, Escape
   * reverts, blur commits. Click-outside fires blur via the browser. The next
   * render will rebuild the h2 from `el.name` post-commit.
   *
   * One-field exception to the schema-driven popover pattern (B2). Name is
   * universally the primary identity field; making it edit-in-place removes a
   * click without disrupting the popover for everything else.
   */
  function startInlineNameEdit(host: HTMLElement, el: Element): void {
    if (host.querySelector('input')) return; // already editing

    const original = el.name || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'atlas-element-name-input';
    input.value = original;
    input.setAttribute('aria-label', 'rename');

    host.innerHTML = '';
    host.appendChild(input);

    // Two-phase setup so the browser computes layout before focus + select.
    queueMicrotask(() => {
      input.focus();
      input.select();
    });

    let reverting = false;
    let committed = false;

    const commit = async () => {
      if (committed) return;
      committed = true;
      const next = input.value.trim();
      // Empty rename is a no-op rather than an unnamed element.
      if (!next || next === original) {
        host.textContent = original || '(unnamed)';
        return;
      }
      const store = getActiveStore();
      if (!store) {
        host.textContent = original || '(unnamed)';
        toastManager.error('cannot rename — no active world');
        return;
      }
      try {
        await store.updateElement(el.id, { name: next });
        const updated = await store.listElements();
        patchSlice('data', { elements: updated });
        requestPushIfLinked();
        // Re-render naturally repaints the header with the new name. Don't
        // overwrite host.textContent here — the subscribe will fire and the
        // full header rebuilds.
      } catch (err) {
        console.error('[element-detail] inline rename failed:', err);
        host.textContent = original || '(unnamed)';
        toastManager.error('failed to rename');
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur(); // triggers commit via the blur listener
      } else if (e.key === 'Escape') {
        e.preventDefault();
        reverting = true;
        input.blur();
      }
    });
    // Ctrl/Cmd+S also commits — same effect as Enter, but routed through the
    // shared save-request event so the global hotkey works while the input
    // is focused.
    const saveRequestHandler = () => { input.blur(); };
    document.addEventListener('atlas:save-request', saveRequestHandler);
    input.addEventListener('blur', () => {
      document.removeEventListener('atlas:save-request', saveRequestHandler);
      if (reverting) {
        host.textContent = original || '(unnamed)';
        return;
      }
      void commit();
    });
  }

  function buildSyncDot(el: Element): HTMLElement {
    const dot = document.createElement('span');
    dot.className = 'atlas-element-sync-dot';
    dot.setAttribute('data-role', 'element-sync-dot');
    const activeId = getState().active?.worldId;
    const worldEntry = activeId
      ? getState().registry.worlds.find((w) => w.id === activeId)
      : undefined;
    const isApi = worldEntry?.state === 'api-linked';
    let icon: string;
    let title: string;
    let state: 'local' | 'synced' | 'dirty';
    if (!isApi) {
      icon = 'save';
      title = 'Saved to folder';
      state = 'local';
    } else {
      const localStamp = el.local_updated_at ?? '';
      const serverStamp = el.server_updated_at ?? '';
      const dirty = !serverStamp || localStamp > serverStamp;
      if (dirty) {
        icon = 'cloud_upload';
        title = 'Pending sync — autosave will push within a few seconds';
        state = 'dirty';
      } else {
        icon = 'cloud_done';
        title = 'Synced';
        state = 'synced';
      }
    }
    dot.dataset.state = state;
    dot.title = title;
    dot.innerHTML = `<span class="material-symbols-outlined">${icon}</span>`;
    return dot;
  }

  function renderHeader(el: Element): HTMLElement {
    const header = document.createElement('div');
    header.className = 'atlas-middle-header';

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.textContent = ELEMENT_ICONS[el.type] ?? 'category';
    icon.title = ELEMENT_LABELS[el.type].singular;
    header.appendChild(icon);

    const title = document.createElement('h2');
    title.dataset.role = 'element-name';
    title.className = 'atlas-element-name';
    title.textContent = el.name || '(unnamed)';
    title.title = 'click to rename';
    title.tabIndex = 0;
    title.addEventListener('click', () => startInlineNameEdit(title, el));
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startInlineNameEdit(title, el);
      }
    });
    header.appendChild(title);

    // B3: if zone-create (or another flow) signalled an auto-edit for this
    // element, drop the user straight into rename mode with the placeholder
    // text selected. One-shot — clear after consumption.
    if (pendingAutoEditNameForId === el.id) {
      pendingAutoEditNameForId = null;
      queueMicrotask(() => startInlineNameEdit(title, el));
    }

    const spacer = document.createElement('div');
    spacer.className = 'atlas-middle-spacer';
    header.appendChild(spacer);

    // Map/pin affordances cluster (DESIGN_MAPS.md §3.5). Replaces the M7
    // inline body widget. Visual ordering left → right:
    //   - For Locations: [map][map] | [pin][pin] | [+map] [+pin] [sync] [trash]
    //   - For others:                  [pin][pin] | [+pin]        [sync] [trash]
    // The clusters render only when they have items. Empty Locations still
    // get [+map] so the affordance to start is always visible.
    renderMapPinClusters(el, header);

    // Per-element save/sync indicator. Local-only world = always "saved"
    // (synchronous disk write). Api-linked + local stamp > server stamp =
    // pending push (autosave debounce will fire soon).
    header.appendChild(buildSyncDot(el));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'atlas-icon-btn-sm danger';
    delBtn.setAttribute('data-action', 'delete-element');
    delBtn.title = 'delete element';
    delBtn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
    delBtn.addEventListener('click', () => onDelete(el));
    header.appendChild(delBtn);

    return header;
  }

  // ====== Map / Pin clusters (DESIGN_MAPS.md §3.5) ======

  /**
   * Append the map/pin affordance clusters to the element-detail header. For
   * Locations: existing-maps cluster, existing-pins cluster, [+map] button,
   * [+pin] button. For non-Locations: existing-pins cluster, [+pin] button.
   * Dividers render only between non-empty clusters.
   */
  function renderMapPinClusters(el: Element, header: HTMLElement): void {
    const state = getState();
    const elements = state.data.elements;
    const mapsSettings = getMapsSettings(state.registry);
    const showMapNames = mapsSettings.show_map_names_in_header;
    const showPinMapNames = mapsSettings.show_pin_map_names_in_header;
    const isLocation = el.type === 'location';
    const isMap = el.type === 'map';
    const isZone = el.type === 'zone';

    // Map detail gets a different cluster: a strip of category icons, one per
    // element pinned on this map, PLUS a single "open this map in a tab"
    // affordance. Click any pinned icon → navigate to that element while
    // keeping the map open in the right pane (via chained URL). Click the
    // open-tab icon → open this map's right-pane tab (or focus if already
    // open). DESIGN_MAPS.md §3.5 — Map case.
    if (isMap) {
      renderMapPinnedElementStrip(el, elements, header, mapsSettings.show_pinned_element_names_in_header);
      header.appendChild(buildSelfOpenMapAffordance(el as WorldMap));
      return;
    }

    // Existing maps anchored to / hosting this element.
    //   - Location → maps with map.location === el.id
    //   - Zone     → distinct maps that hold any marker for this zone
    //   - other    → none here (their pins handle "where it is")
    const associatedMaps = (isLocation || isZone) ? getAssociatedMaps(el.id, elements) : [];
    // Existing pins targeting this element. Includes Locations too — a
    // Location can have pins (e.g. a city's flag pinned on a continent map).
    // Zones cannot be pin targets (DESIGN_MAPS.md §1.4) so they skip pins.
    const pinsForElement = isZone ? [] : elements.filter(
      (e): e is Element & { map_id: string; element_id: string; x: number; y: number } =>
        e.type === 'pin' && (e as { element_id?: string }).element_id === el.id,
    );

    const hasMaps = associatedMaps.length > 0;
    const hasPins = pinsForElement.length > 0;

    if (hasMaps || hasPins) {
      const cluster = document.createElement('div');
      cluster.className = 'atlas-header-cluster atlas-header-existing';

      if (hasMaps) {
        // Imageless maps render LEFT, has-image maps RIGHT. Reading
        // left-to-right, the eye lands on the bright cyan "ready to view"
        // ones last. Imageless ones group as muted background — present
        // for completeness but visually subordinate.
        const sortedMaps = [...associatedMaps].sort((a, b) => {
          const aHas = !!(a.image_url || a.image_media_id);
          const bHas = !!(b.image_url || b.image_media_id);
          if (aHas === bHas) return 0;
          return aHas ? 1 : -1; // imageless first
        });
        for (const m of sortedMaps) {
          cluster.appendChild(
            buildMapAffordance(m, showMapNames, el.id, isZone ? el.id : undefined),
          );
        }
      }

      if (hasMaps && hasPins) {
        cluster.appendChild(buildClusterDivider());
      }

      if (hasPins) {
        for (const pin of pinsForElement) {
          cluster.appendChild(buildPinAffordance(pin, elements, el.id, showPinMapNames));
        }
      }

      header.appendChild(cluster);
    }

    // Create buttons cluster — [+map] for Locations, [+pin] always (gated on
    // active map tab same as before).
    const createCluster = document.createElement('div');
    createCluster.className = 'atlas-header-cluster atlas-header-create';

    if (isLocation) {
      const addMapBtn = document.createElement('button');
      addMapBtn.type = 'button';
      addMapBtn.className = 'atlas-icon-btn-sm atlas-header-add-glyph';
      addMapBtn.setAttribute('data-action', 'add-map');
      addMapBtn.title = `create a new map of ${el.name || 'this location'}`;
      // Two-glyph composition reads as "add map" — small + plus the action
      // glyph. Same shape as [+pin]; the two read as a coherent pair.
      addMapBtn.innerHTML =
        '<span class="material-symbols-outlined atlas-add-glyph-plus">add</span>' +
        '<span class="material-symbols-outlined atlas-add-glyph-main">map</span>';
      addMapBtn.addEventListener('click', async () => {
        const suggestedName = `Map of ${el.name || 'this location'}`;
        await createMapDialog(toastManager, {
          initialName: suggestedName,
          initialLocationId: el.id,
        });
      });
      createCluster.appendChild(addMapBtn);
    }

    // [+pin] retains its existing gating: only renders when a map tab is
    // active in the right pane. Without an active map there's nowhere to
    // drop the pin. Same as before MW. ALSO: zones are never pinnable —
    // they're constructed via markers (DESIGN_MAPS.md §1.4 extension).
    const ui = state.ui;
    const active = ui.rightTabs[ui.rightActiveIndex];
    const activeMapId = active && active.kind === 'map' ? active.mapId : null;
    if (activeMapId && el.type !== 'zone') {
      const placing = ui.pinPlacement?.elementId === el.id;
      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = 'atlas-icon-btn-sm atlas-header-add-glyph' + (placing ? ' active' : '');
      pinBtn.setAttribute('data-action', 'pin-element');
      pinBtn.title = placing ? 'cancel pin placement' : 'place pin on active map';
      // Two-glyph composition matches `[+map]` — small `add` + the action
      // glyph (push_pin). Reads "+pin" at a glance, parallel to "+map".
      pinBtn.innerHTML =
        '<span class="material-symbols-outlined atlas-add-glyph-plus">add</span>' +
        '<span class="material-symbols-outlined atlas-add-glyph-main">push_pin</span>';
      pinBtn.addEventListener('click', () => {
        const placement = getState().ui.pinPlacement;
        if (placement?.elementId === el.id) {
          patchSlice('ui', { ...getState().ui, pinPlacement: null });
        } else {
          patchSlice('ui', { ...getState().ui, pinPlacement: { elementId: el.id } });
          toastManager.info('click on the map to place the pin');
        }
      });
      createCluster.appendChild(pinBtn);
    }

    if (createCluster.children.length > 0) {
      header.appendChild(createCluster);
    }
  }

  function buildClusterDivider(): HTMLElement {
    const div = document.createElement('span');
    div.className = 'atlas-header-cluster-divider';
    div.setAttribute('aria-hidden', 'true');
    return div;
  }

  /**
   * Render the strip of pinned-element category icons in a Map element's top
   * bar. First N visible; if more exist, a `+K more` chip opens an element
   * picker filtered to the remaining pinned-element ids.
   *
   * Clicking a single icon navigates to that element via the chained map URL
   * — keeps the current Map tab open in the right pane.
   */
  function renderMapPinnedElementStrip(
    mapEl: Element,
    elements: readonly Element[],
    header: HTMLElement,
    showElementNames: boolean,
  ): void {
    const VISIBLE_CAP = 12;
    // Pins belonging to this map.
    const pinsOnMap = elements.filter(
      (e): e is Element & { map_id: string; element_id: string } =>
        e.type === 'pin' && (e as Record<string, unknown>).map_id === mapEl.id,
    );
    if (pinsOnMap.length === 0) return;
    // Dedupe element ids — multiple pins for the same element collapse to one
    // strip entry.
    const seenIds = new Set<string>();
    const uniqElementIds: string[] = [];
    for (const p of pinsOnMap) {
      if (seenIds.has(p.element_id)) continue;
      seenIds.add(p.element_id);
      uniqElementIds.push(p.element_id);
    }
    // Resolve to Element objects, drop any that no longer exist (broken pins).
    const pinnedEls: Element[] = [];
    for (const id of uniqElementIds) {
      const el = elements.find(e => e.id === id);
      if (el) pinnedEls.push(el);
    }
    if (pinnedEls.length === 0) return;
    pinnedEls.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    const cluster = document.createElement('div');
    cluster.className = 'atlas-header-cluster atlas-header-map-pinned-strip';

    const visible = pinnedEls.slice(0, VISIBLE_CAP);
    const overflow = pinnedEls.slice(VISIBLE_CAP);

    for (const pinnedEl of visible) {
      cluster.appendChild(buildPinnedElementIcon(mapEl, pinnedEl, showElementNames));
    }

    if (overflow.length > 0) {
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'atlas-icon-btn-sm atlas-header-pinned-more';
      moreBtn.setAttribute('data-action', 'pinned-more');
      moreBtn.title = `${overflow.length} more pinned element${overflow.length === 1 ? '' : 's'} — click to search all`;
      moreBtn.textContent = `+${overflow.length}`;
      moreBtn.addEventListener('click', async () => {
        // Picker filtered to the remaining ids. User can search by name +
        // filter by type; click any row → navigate to that element + keep
        // the map open via chained URL.
        const picked = await pickElement({
          title: `Pinned on ${mapEl.name || '(this map)'}`,
          restrictToIds: pinnedEls.map(e => e.id),
        });
        if (!picked) return;
        navigateToPinnedElement(mapEl, picked);
      });
      cluster.appendChild(moreBtn);
    }

    header.appendChild(cluster);
  }

  function buildPinnedElementIcon(mapEl: Element, pinnedEl: Element, showName: boolean): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-icon-btn-sm atlas-header-pinned-icon';
    btn.setAttribute('data-action', 'goto-pinned-element');
    btn.setAttribute('data-element-id', pinnedEl.id);
    btn.title = `${pinnedEl.name || '(unnamed)'} (${pinnedEl.type})`;
    const iconHtml = `<span class="material-symbols-outlined">${ELEMENT_ICONS[pinnedEl.type] ?? 'category'}</span>`;
    if (showName) {
      btn.innerHTML = `${iconHtml}<span class="atlas-header-map-label">${escapeText(pinnedEl.name || '(unnamed)')}</span>`;
      // Reuse the labeled-affordance CSS pattern so width grows past the
      // 22×22 fixed square. atlas-header-map-affordance-labeled is the
      // semantic name but its rules apply equally here.
      btn.classList.add('atlas-header-map-affordance-labeled');
    } else {
      btn.innerHTML = iconHtml;
    }
    btn.addEventListener('click', () => navigateToPinnedElement(mapEl, pinnedEl));
    return btn;
  }

  function navigateToPinnedElement(mapEl: Element, pinnedEl: Element): void {
    const worldId = getState().active?.worldId;
    if (!worldId) return;
    // Chained URL: open the map AND select the pinned element. Keeps the map
    // open in the right pane while the middle flips to the pinned element.
    patchSlice('ui', { ...getState().ui, selectedElementId: pinnedEl.id });
    navigate(mapHash(worldId, mapEl.id, pinnedEl.id));
    // Also pan+zoom the map tab to one of this element's pins on this map.
    // Same zoom-and-center logic as the element-detail top-bar [pin] click,
    // so the user lands inside the pin's neighborhood rather than at the
    // tab's wide default view. Use the first pin found — multi-pin elements
    // on the same map are uncommon and "first match" is a reasonable default.
    const elements = getState().data.elements;
    const pin = elements.find(
      (e): e is Element & { map_id: string; element_id: string; x: number; y: number } =>
        e.type === 'pin'
        && (e as Record<string, unknown>).map_id === mapEl.id
        && (e as Record<string, unknown>).element_id === pinnedEl.id,
    );
    if (pin) panMapTabTo(mapEl.id, pin.x, pin.y);
  }

  /**
   * Self-open affordance for Map elements: a single icon button in the
   * map-detail top bar that opens (or focuses) this map's right-pane tab.
   * Distinct from the location-Map affordance: this one is for the map
   * element viewing its own detail.
   */
  function buildSelfOpenMapAffordance(m: WorldMap): HTMLElement {
    const cluster = document.createElement('div');
    cluster.className = 'atlas-header-cluster atlas-header-create';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-icon-btn-sm atlas-header-map-affordance';
    btn.setAttribute('data-action', 'open-self-map');
    const hasImage = !!(m.image_url || m.image_media_id);
    if (hasImage) btn.classList.add('atlas-map-tree-icon-has-image');
    btn.title = 'open this map in the right pane';
    btn.innerHTML = '<span class="material-symbols-outlined">map</span>';
    btn.addEventListener('click', () => openMapTab(m));
    cluster.appendChild(btn);
    return cluster;
  }

  function buildMapAffordance(
    m: WorldMap,
    showName: boolean,
    sourceElementId: string,
    panToZoneId?: string,
  ): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-icon-btn-sm atlas-header-map-affordance';
    btn.setAttribute('data-action', 'open-map');
    btn.setAttribute('data-map-id', m.id);
    const hasImage = !!(m.image_url || m.image_media_id);
    if (hasImage) btn.classList.add('atlas-map-tree-icon-has-image');
    const titleSuffix = panToZoneId ? ' (will pan to zone)' : '';
    btn.title = `open map: ${m.name || '(untitled)'}${titleSuffix}`;
    const iconHtml = '<span class="material-symbols-outlined">map</span>';
    if (showName) {
      btn.innerHTML = `${iconHtml}<span class="atlas-header-map-label">${escapeText(m.name || '(untitled)')}</span>`;
      btn.classList.add('atlas-header-map-affordance-labeled');
    } else {
      btn.innerHTML = iconHtml;
    }
    // Preserve the current element selection in the URL so the middle pane
    // doesn't drop into the welcome-stat panel when the map opens. The
    // chained `/map/<mid>/element/<eid>` route keeps element-detail mounted.
    btn.addEventListener('click', () => {
      openMapTab(m, sourceElementId);
      // Zone case: pan to the zone's centroid (average of its markers on
      // this map). Captain's request session 215 — clicking a zone's map
      // icon should center-view the zone.
      if (panToZoneId) {
        const state = getState();
        const zoneMarkers = state.data.elements.filter(
          (e): e is import('../core/types').Marker =>
            e.type === 'marker' &&
            (e as import('../core/types').Marker).zone_id === panToZoneId &&
            (e as import('../core/types').Marker).map_id === m.id,
        );
        if (zoneMarkers.length > 0) {
          const cx = Math.round(
            zoneMarkers.reduce((s, mk) => s + mk.x, 0) / zoneMarkers.length,
          );
          const cy = Math.round(
            zoneMarkers.reduce((s, mk) => s + mk.y, 0) / zoneMarkers.length,
          );
          panMapTabTo(m.id, cx, cy);
        }
      }
    });
    return btn;
  }

  function buildPinAffordance(
    pin: Element & { map_id: string; element_id: string; x: number; y: number },
    elements: readonly Element[],
    sourceElementId: string,
    showMapName: boolean,
  ): HTMLElement {
    const m = elements.find((e): e is WorldMap => e.type === 'map' && e.id === pin.map_id);
    const mapName = m?.name || '(unknown map)';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-icon-btn-sm atlas-header-pin-affordance';
    btn.setAttribute('data-action', 'goto-pin');
    btn.setAttribute('data-pin-id', pin.id);
    // Surface the right-click affordance in the tooltip — symmetric with
    // the drag-to-trash on the map canvas and the right-click-ghost prune.
    btn.title = `pin on ${mapName} — click to open and center, right-click to delete pin`;
    const iconHtml = '<span class="material-symbols-outlined">push_pin</span>';
    if (showMapName) {
      btn.innerHTML = `${iconHtml}<span class="atlas-header-map-label">${escapeText(mapName)}</span>`;
      btn.classList.add('atlas-header-map-affordance-labeled');
    } else {
      btn.innerHTML = iconHtml;
    }
    btn.addEventListener('click', () => {
      if (!m) return;
      // Preserve the element selection — same chained-URL trick.
      openMapTab(m, sourceElementId);
      // panMapTabTo waits on entry.ready, so a freshly opened tab settles
      // before the camera moves.
      panMapTabTo(pin.map_id, pin.x, pin.y);
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      void deletePinFromHeader(pin.id, mapName);
    });
    return btn;
  }

  /**
   * Delete a pin via the element-detail header's right-click affordance.
   * Symmetric with the drag-to-trash flow on the map canvas — same store
   * call, same autosave path. No confirmation modal: the action is mild
   * (re-place the pin if you change your mind) and a modal here would
   * dilute the gesture's lightness.
   */
  async function deletePinFromHeader(pinId: string, mapName: string): Promise<void> {
    const store = getActiveStore();
    if (!store) return;
    try {
      await store.deletePin(pinId);
      const elements = await store.listElements();
      patchSlice('data', { elements });
      requestPushIfLinked();
      toastManager.success(`pin on ${mapName} deleted`);
    } catch (err) {
      console.error('[element-detail] deletePinFromHeader failed:', err);
      toastManager.error('failed to delete pin');
    }
  }

  // ====== Sections ======

  function renderSection(section: SectionLayout, el: Element, alwaysExpanded: boolean): HTMLElement | null {
    if (section.fields.length === 0) return null;

    const wrap = document.createElement('div');
    wrap.className = 'atlas-detail-section';

    const headerRow = document.createElement('div');
    headerRow.className = 'atlas-detail-section-header' + (alwaysExpanded ? ' no-toggle' : '');

    const titleSpan = document.createElement('span');
    titleSpan.textContent = section.name;
    headerRow.appendChild(titleSpan);

    const collapsedKey = `${el.type}::${section.name}`;
    const isCollapsed = !alwaysExpanded && collapsedSections.has(collapsedKey);

    if (!alwaysExpanded) {
      const chev = document.createElement('span');
      chev.className = 'material-symbols-outlined';
      chev.textContent = isCollapsed ? 'expand_more' : 'expand_less';
      headerRow.appendChild(chev);
      headerRow.addEventListener('click', () => {
        if (collapsedSections.has(collapsedKey)) collapsedSections.delete(collapsedKey);
        else collapsedSections.add(collapsedKey);
        // Force a re-render of the detail by re-emitting data.elements.
        forceRerender();
      });
    }
    wrap.appendChild(headerRow);

    if (!isCollapsed) {
      const body = document.createElement('div');
      body.className = 'atlas-detail-section-body';
      section.fields.forEach(meta => body.appendChild(renderField(meta, el)));
      wrap.appendChild(body);
    }
    return wrap;
  }

  // ====== Field rendering ======

  function renderField(meta: FieldMeta, el: Element): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-field';

    const label = document.createElement('div');
    label.className = 'atlas-field-label';
    // SDK-sourced field description shown as a tooltip on label hover. Falls
    // back silently when no description exists for this (type, field) pair.
    const description = getFieldDescription(el.type, meta.name);
    if (description) label.title = description;
    const labelText = document.createElement('span');
    labelText.textContent = humanizeFieldName(meta.name);
    label.appendChild(labelText);
    if (meta.required) {
      const req = document.createElement('span');
      req.className = 'field-required';
      req.textContent = '*';
      label.appendChild(req);
    }
    // Clicking the label triggers the same edit affordance as clicking the
    // value — opens the popover for text/number, opens the picker for links.
    // The actual click handlers live on the value/pick button below; we just
    // forward the click here.
    label.classList.add('atlas-field-label-clickable');
    label.addEventListener('click', (e) => {
      // Don't double-fire if user clicked the value (would bubble up otherwise).
      if ((e.target as HTMLElement).closest('.atlas-field-value, .atlas-link-pick, .atlas-link-chip')) return;
      // Forward to whichever affordance lives in this row.
      const target = wrap.querySelector<HTMLElement>(
        '.atlas-field-value, .atlas-link-pick'
      );
      target?.click();
    });
    wrap.appendChild(label);

    if (meta.widget === 'single-link') {
      wrap.appendChild(renderSingleLink(meta, el));
      return wrap;
    }
    if (meta.widget === 'multi-link') {
      wrap.appendChild(renderMultiLink(meta, el));
      return wrap;
    }

    const raw = (el as any)[meta.name];
    const valueText = formatValue(raw);
    const isEmpty = !valueText;
    const valueEl = document.createElement('div');
    valueEl.className = 'atlas-field-value' + (isEmpty ? ' empty' : '');
    if (isEmpty) {
      // Widget-aware empty placeholder via CSS ::before (see atlas.css). Number
      // shows '#', text fields show a thin line. Avoids putting the placeholder
      // glyph in textContent so copy/select doesn't pick up sentinel chars.
      valueEl.dataset.widget = meta.widget;
    }
    valueEl.textContent = valueText;
    // Selection-vs-click discriminator: if the user is dragging to select
    // text, suppress the editor open. mousedown records start coords; on
    // mouseup we check whether the cursor moved (drag = selection intent)
    // or whether a non-empty selection now exists. The click handler then
    // gates on a flag set by mouseup. Fixes the bug where text selection
    // (especially left→right) opened the modal instead of leaving the user
    // with their highlight.
    let mouseDownAt: { x: number; y: number } | null = null;
    let suppressNextClick = false;
    valueEl.addEventListener('mousedown', (e) => {
      mouseDownAt = { x: e.clientX, y: e.clientY };
      suppressNextClick = false;
    });
    valueEl.addEventListener('mouseup', (e) => {
      if (!mouseDownAt) return;
      const dx = Math.abs(e.clientX - mouseDownAt.x);
      const dy = Math.abs(e.clientY - mouseDownAt.y);
      mouseDownAt = null;
      // 4px tolerance — accounts for tiny jitter on intended clicks while
      // catching deliberate drag-selection. Also check actual selection
      // state in case mouseup landed inside the same px (rapid swipe).
      const dragged = dx > 4 || dy > 4;
      const sel = window.getSelection();
      const hasSelectionInValue = !!sel && sel.toString().length > 0
        && valueEl.contains(sel.anchorNode) && valueEl.contains(sel.focusNode);
      if (dragged || hasSelectionInValue) {
        suppressNextClick = true;
      }
    });
    valueEl.addEventListener('click', () => {
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      // Double-gate: even if the mouseup discriminator missed (mouseup outside
      // valueEl during a drag, browser timing quirks, etc.), bail if there's
      // ANY active text selection inside or overlapping valueEl at click time.
      // Without this, asymmetric drag directions can leak past the mouseup gate.
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) {
        const anchorIn = sel.anchorNode && valueEl.contains(sel.anchorNode);
        const focusIn = sel.focusNode && valueEl.contains(sel.focusNode);
        if (anchorIn || focusIn) return;
      }
      // Resolve dispatch mode from registry editor settings (session 219).
      // Default is 'modal' (back-compat with everything that shipped before).
      const editorSettings = getEditorSettings(getState().registry);
      const mode = editorSettings.field_edit_mode;
      const initialValue = raw === undefined || raw === null ? '' : String(raw);
      const editWidget = meta.widget === 'number' ? 'number' : (meta.widget === 'text-long' ? 'text-long' : 'text-short');
      if (mode === 'inline-single') {
        openFieldEditInline({
          anchor: valueEl,
          value: initialValue,
          widget: editWidget,
          mode: 'single',
          onSave: async (nextValue) => {
            await persistFieldPatch(el, meta.name, nextValue);
          },
        });
        return;
      }
      if (mode === 'inline-multi') {
        openFieldEditInline({
          anchor: valueEl,
          value: initialValue,
          widget: editWidget,
          mode: 'multi',
          onSave: async (nextValue) => {
            await persistFieldPatch(el, meta.name, nextValue);
          },
        });
        return;
      }
      // mode === 'modal' (default)
      openFieldEditPopover({
        anchor: valueEl,
        label: humanizeFieldName(meta.name),
        value: initialValue,
        widget: editWidget,
        onSave: async (nextValue) => {
          await persistFieldPatch(el, meta.name, nextValue);
        },
      });
    });
    wrap.appendChild(valueEl);
    return wrap;
  }

  function renderSingleLink(meta: FieldMeta, el: Element): HTMLElement {
    const row = document.createElement('div');
    row.className = 'atlas-link-row';
    const raw = (el as any)[meta.name];

    if (raw) {
      row.appendChild(buildLinkChip(String(raw), meta, async () => {
        // Use `null`, not `undefined`. undefined gets dropped by JSON.stringify
        // at disk-write AND by the adapter's wire serializer, so the PATCH
        // body omits the field and the server keeps its old value. See
        // sync-engine.fieldClear.test.ts. Convention #21.
        await persistFieldPatch(el, meta.name, null);
      }));
    } else {
      row.classList.add('atlas-link-row-empty');
    }

    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'atlas-icon-btn-sm atlas-link-pick';
    if (!raw) pickBtn.classList.add('atlas-link-pick-empty');
    pickBtn.title = raw ? 'change link' : `pick a ${meta.target ?? 'link'}`;
    // ALWAYS show the type-specific icon so users see at a glance what kind of
    // element this field links to — even before any link exists. Empty state
    // still uses the `atlas-link-pick-empty` class for muted styling (was a
    // generic `+` before, which hid which category the field targeted).
    pickBtn.innerHTML = `<span class="material-symbols-outlined">${pickIconFor(meta.target)}</span>`;
    pickBtn.addEventListener('click', async () => {
      // Exclude the current element itself and any value already linked here.
      // Self-linking is never meaningful — a Character pointing at itself via
      // `friends`, a Location pointing at itself via `parent_location_id`, etc.
      const exclude = new Set<string>();
      exclude.add(el.id);
      if (raw) exclude.add(String(raw));
      const picked = await pickElement({
        restrictToType: meta.target,
        excludeIds: [...exclude],
        title: `pick a ${meta.target ?? 'link'} for ${humanizeFieldName(meta.name)}`,
      });
      if (!picked) return;
      await persistFieldPatch(el, meta.name, picked.id);
    });
    row.appendChild(pickBtn);
    return row;
  }

  function renderMultiLink(meta: FieldMeta, el: Element): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-link-row';

    const raw = (el as any)[meta.name];
    const ids: string[] = Array.isArray(raw) ? raw.map(String) : [];

    ids.forEach(id => {
      wrap.appendChild(buildLinkChip(id, meta, async () => {
        const next = ids.filter(x => x !== id);
        await persistFieldPatch(el, meta.name, next);
      }));
    });

    if (ids.length === 0) wrap.classList.add('atlas-link-row-empty');
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'atlas-icon-btn-sm atlas-link-pick';
    if (ids.length === 0) addBtn.classList.add('atlas-link-pick-empty');
    addBtn.title = ids.length === 0 ? `pick a ${meta.target ?? 'link'}` : `add another ${meta.target ?? 'link'}`;
    // Always show the type-specific icon so users see WHICH category this
    // multi-link field targets at a glance. `margin-left: auto` keeps the
    // button anchored right past any existing chips.
    addBtn.innerHTML = `<span class="material-symbols-outlined">${pickIconFor(meta.target)}</span>`;
    addBtn.addEventListener('click', async () => {
      // Exclude the current element + everything already in the list. Same
      // self-link rule as renderSingleLink — A Character's `friends` shouldn't
      // include the character itself.
      const picked = await pickElement({
        restrictToType: meta.target,
        excludeIds: [el.id, ...ids],
        title: `add a ${meta.target ?? 'link'} to ${humanizeFieldName(meta.name)}`,
      });
      if (!picked) return;
      const next = [...ids, picked.id];
      await persistFieldPatch(el, meta.name, next);
    });
    wrap.appendChild(addBtn);
    return wrap;
  }

  function buildLinkChip(id: string, meta: FieldMeta, onRemove: () => void): HTMLElement {
    const linked = getState().data.elements.find(e => e.id === id);
    const chip = document.createElement('span');
    chip.className = 'atlas-link-chip' + (linked ? '' : ' atlas-link-chip-unresolved');

    const name = document.createElement('span');
    if (linked) {
      name.textContent = linked.name || '(unnamed)';
      chip.title = `${linked.type} · id ${id}`;
    } else {
      name.textContent = id;
      chip.title = `unresolved id (target type: ${meta.target ?? 'unknown'})`;
    }
    chip.appendChild(name);

    chip.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.remove) return;
      const worldId = getState().active?.worldId;
      if (linked && worldId) {
        patchSlice('ui', { ...getState().ui, selectedElementId: linked.id });
        navigate(elementHash(worldId, linked.id));
      }
    });

    const rm = document.createElement('span');
    rm.className = 'material-symbols-outlined atlas-link-chip-remove';
    rm.dataset.remove = '1';
    rm.textContent = 'close';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });
    chip.appendChild(rm);

    return chip;
  }

  // ====== Referenced By ======

  function renderReferencedBy(el: Element): HTMLElement | null {
    const incoming = findIncomingReferences(el.id);
    if (incoming.length === 0) return null;

    const wrap = document.createElement('div');
    wrap.className = 'atlas-detail-section';

    const header = document.createElement('div');
    header.className = 'atlas-detail-section-header no-toggle';
    header.innerHTML = `<span>Referenced By</span><span class="atlas-refs-count">${incoming.length}</span>`;
    wrap.appendChild(header);

    const body = document.createElement('div');
    body.className = 'atlas-detail-section-body atlas-detail-refs';
    wrap.appendChild(body);

    // Group by source type for readability.
    const byType = new Map<ElementType, Element[]>();
    for (const src of incoming) {
      const arr = byType.get(src.type) ?? [];
      arr.push(src);
      byType.set(src.type, arr);
    }

    for (const [type, sources] of byType.entries()) {
      const group = document.createElement('div');
      group.className = 'atlas-field';
      const label = document.createElement('div');
      label.className = 'atlas-field-label';
      label.textContent = ELEMENT_LABELS[type]?.plural ?? type;
      group.appendChild(label);
      const chips = document.createElement('div');
      chips.className = 'atlas-link-row';
      sources.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
      for (const src of sources) {
        chips.appendChild(buildRefChip(src));
      }
      group.appendChild(chips);
      body.appendChild(group);
    }
    return wrap;
  }

  function buildRefChip(src: Element): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'atlas-link-chip';
    chip.title = `${src.type} · id ${src.id}`;
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined atlas-link-chip-icon';
    icon.textContent = ELEMENT_ICONS[src.type];
    chip.appendChild(icon);
    const name = document.createElement('span');
    name.textContent = src.name || '(unnamed)';
    chip.appendChild(name);
    chip.addEventListener('click', () => {
      const worldId = getState().active?.worldId;
      if (worldId) {
        patchSlice('ui', { ...getState().ui, selectedElementId: src.id });
        navigate(elementHash(worldId, src.id));
      }
    });
    return chip;
  }

  // ====== Footer ======

  function renderFooter(el: Element): HTMLElement {
    const meta = document.createElement('div');
    meta.className = 'atlas-detail-meta';
    const updated = el.local_updated_at ? new Date(el.local_updated_at).toLocaleString() : '—';
    const synced = el.server_updated_at ? new Date(el.server_updated_at).toLocaleString() : 'not synced';
    meta.innerHTML = `
      <div>ID: <code>${escapeText(el.id)}</code></div>
      <div>Updated locally: ${escapeText(updated)}</div>
      <div>Server: ${escapeText(synced)}</div>
    `;
    return meta;
  }

  // ====== Persistence helpers ======

  async function persistFieldPatch(el: Element, fieldName: string, nextValue: unknown): Promise<void> {
    const store = getActiveStore();
    if (!store) {
      toastManager.error('no active store');
      return;
    }
    try {
      await store.updateElement(el.id, { [fieldName]: nextValue } as Partial<Element>);
      const elements = await store.listElements();
      patchSlice('data', { elements });
      // Local write succeeded — schedule a debounced push. No-op for local-only.
      requestPushIfLinked();

      // Map.image_url auto-detect (DESIGN_MAPS.md §4 + session 211 bout ID):
      // when a Map element's image_url changes to a non-empty value, fetch
      // the image's natural dims and update the map's width/height so the
      // canvas matches the new image. Without this, the stored dims stay
      // pinned to whatever the prior image was (or the 2000-default), and
      // pins end up off-image when image dimensions change.
      if (el.type === 'map' && fieldName === 'image_url' && typeof nextValue === 'string' && nextValue.trim()) {
        void autoUpdateMapDims(el.id, nextValue.trim());
      }
    } catch (err) {
      console.error('[element-detail] update failed:', err);
      toastManager.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /**
   * Fire-and-forget: decode an image URL's natural dimensions and patch the
   * map's width/height. Silent on failure (CORS, 404, etc.) — pins keep
   * working with stale dims; user can manually edit width/height fields
   * if the auto-detect can't reach the image.
   */
  async function autoUpdateMapDims(mapId: string, url: string): Promise<void> {
    const dims = await readImageDimsFromUrl(url);
    if (!dims) return;
    const store = getActiveStore();
    if (!store) return;
    try {
      await store.updateMap(mapId, { width: dims.w, height: dims.h });
      const elements = await store.listElements();
      patchSlice('data', { elements });
      requestPushIfLinked();
      toastManager.info(`map dimensions updated to ${dims.w}×${dims.h}`);
    } catch (err) {
      console.error('[element-detail] map dim auto-update failed:', err);
    }
  }

  async function onDelete(el: Element): Promise<void> {
    const store = getActiveStore();
    if (!store) return;
    let dependentCount = 0;
    try {
      const dependents = await store.findDependents(el.id);
      dependentCount = dependents.length;
    } catch { /* fall through with 0 */ }
    const extra = dependentCount > 0 ? ` this will also remove ${dependentCount} dependent element${dependentCount === 1 ? '' : 's'}.` : '';
    const ok = window.confirm(`delete "${el.name || el.id}"?${extra}`);
    if (!ok) return;
    try {
      await store.deleteElement(el.id);
      const elements = await store.listElements();
      patchSlice('data', { elements });
      patchSlice('ui', { ...getState().ui, selectedElementId: null });
      // Local delete + tombstones written — schedule a push to DELETE on server.
      requestPushIfLinked();
      toastManager.success(`deleted ${el.name || 'element'}`);
      const worldId = getState().active?.worldId;
      if (worldId) navigate(elementsHash(worldId));
    } catch (err) {
      console.error('[element-detail] delete failed:', err);
      toastManager.error(err instanceof Error ? err.message : String(err));
    }
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();
  return () => { unsubState(); unsubHash(); };
}

// ============================================================
// Reverse-link scan (SDK-shape-agnostic — convention #5)
// ============================================================

/**
 * Find all elements in `state.data.elements` that reference `targetId` somewhere
 * in their field values. Scans every property that looks like an id or array of
 * ids — no hardcoded field-name suffix detection.
 *
 * Excludes the target itself.
 */
function findIncomingReferences(targetId: string): Element[] {
  const all = getState().data.elements;
  const hits: Element[] = [];
  for (const el of all) {
    if (el.id === targetId) continue;
    if (refersTo(el, targetId)) hits.push(el);
  }
  return hits;
}

function refersTo(el: Element, targetId: string): boolean {
  for (const [key, value] of Object.entries(el)) {
    // Skip the obvious non-id metadata.
    if (key === 'id' || key === 'name' || key === 'description' || key === 'type'
      || key === 'local_updated_at' || key === 'server_updated_at') continue;
    if (typeof value === 'string') {
      if (value === targetId) return true;
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item === targetId) return true;
        if (item && typeof item === 'object' && (item as any).id === targetId) return true;
      }
    } else if (value && typeof value === 'object') {
      if ((value as any).id === targetId) return true;
    }
  }
  return false;
}

// ============================================================
// Helpers
// ============================================================

function humanizeFieldName(name: string): string {
  return name
    .split('_')
    .map(word => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function formatValue(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  return String(raw);
}

function pickIconFor(target: ElementType | undefined): string {
  if (target && ELEMENT_ICONS[target]) return ELEMENT_ICONS[target];
  return 'add_link';
}

function forceRerender(): void {
  // Re-emit data.elements with a new array reference so the detail subscriber re-fires.
  const data = getState().data;
  patchSlice('data', { elements: [...data.elements] });
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}
