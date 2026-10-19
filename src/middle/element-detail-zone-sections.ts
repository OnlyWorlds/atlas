/**
 * Zone-specific sections injected into element-detail when a Zone is the
 * selected element (DESIGN_ZONES.md §4.4).
 *
 * Two sections:
 *   - "Zone visuals (local)" — atlas-extension fields (color/opacity/label),
 *     never pushed to API.
 *   - "Markers" — ordered list of markers belonging to this zone, grouped by
 *     map. Each row: order, (x, y), pan-to, delete. "Add marker" hint when
 *     a single map is implicated; multi-map zones surface the count per map.
 *
 * Writes go through the active FolderStore; UI patches state and triggers
 * autosave.
 */

import { getState, patchSlice } from '../core/state';
import { worldIsViewOnly } from '../core/view-only';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import type { Zone, Marker, WorldMap, Element } from '../core/types';
import { openMapTab } from '../tabs/right/map-index-tab';
import { panMapTabTo } from '../tabs/right/map-tab';
import { enterEditMode, isEditing, getEditingZoneId, doneEdit, cancelEdit } from '../tabs/right/zone-edit-mode';
import type { ToastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import { escapeText, hexColourOr, finiteOr } from '../core/dom-utils';
import { decideDeleteConfirm } from '../core/delete-confirm';
import { getEditorSettings } from '../registry/registry';
import { getWritingLabels } from './writing-helpers';
import { navigate, elementsHash } from '../core/router';
import { resolveStyle, kindLabel } from '../core/world-styles';

/** Point tables longer than this fold behind their map row. */
const MARKERS_FOLD_ABOVE = 8;

export function buildZoneSections(zone: Zone, toasts: ToastManager): HTMLElement[] {
  const sections = [
    buildZoneVisualsSection(zone, toasts),
    buildZoneMarkersSection(zone, toasts),
  ];
  // A view-only world reads (conv. 149): the visuals show their values with
  // nothing to change, and Edit shape, Delete zone and each marker's delete
  // go; Pan stays.
  if (worldIsViewOnly()) {
    for (const s of sections) {
      s.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach(i => { i.disabled = true; });
      s.querySelectorAll('[data-action="use-kind-colour"], [data-action="toggle-edit"], [data-action="cancel-edit"], [data-action="delete-zone"], [data-action="delete"]')
        .forEach(b => b.remove());
    }
  }
  return sections;
}

function buildZoneVisualsSection(zone: Zone, toasts: ToastManager): HTMLElement {
  const section = document.createElement('div');
  section.className = 'atlas-detail-section atlas-zone-visuals-section';

  const header = document.createElement('div');
  header.className = 'atlas-detail-section-header';
  // These three fields ride the v2 wire as extension fields (they are in
  // ATLAS_WIRE_EXTENSION_FIELDS); this header said "Local only" from the v1
  // era until S356.
  header.innerHTML = `
    <span class="atlas-detail-section-title">Zone visuals</span>
    <span class="atlas-detail-section-hint" title="atlas_color, atlas_opacity and atlas_label_visible are atlas extension fields; they sync with the world.">Synced</span>
  `;
  section.appendChild(header);

  const body = document.createElement('div');
  body.className = 'atlas-detail-section-body';
  section.appendChild(body);

  // World styles (S356): what this zone inherits from its kind's rule when
  // it has no colour of its own, so the picker shows the colour that is
  // actually drawn and the line under it says where it came from.
  const rule = resolveStyle(getState().styles.rules, zone);
  const ownColor = (zone as { atlas_color?: string }).atlas_color;
  // Hex only into the inputs below: the value comes from a world file (or
  // styles.json) and is interpolated into `value="…"` (S360: a quote in it
  // was a script breakout). A non-hex colour another tool wrote still draws on
  // the map; the picker just starts from the default.
  const currentColor = hexColourOr(ownColor, hexColourOr(rule.color, '#22d3ee'));
  const currentOpacity = (zone as { atlas_opacity?: number }).atlas_opacity ?? rule.fill_opacity ?? 0.4;
  const currentLabelVisible = !!(zone as { atlas_label_visible?: boolean }).atlas_label_visible;
  // A role rule (S362) names the role too: "Line · River · major river".
  const role = rule.source === 'role' && typeof (zone as { role?: unknown }).role === 'string' ? ((zone as { role?: string }).role ?? '').trim() : '';
  const kind = kindLabel({ supertype: typeof zone.supertype === 'string' ? zone.supertype : '', subtype: typeof zone.subtype === 'string' ? zone.subtype : '', role: role || undefined });
  const inheritLine = ownColor
    ? (rule.color
        ? `This zone has its own color. <button type="button" class="atlas-btn-link" data-action="use-kind-colour">Use the ${escapeText(kind)} color (${escapeText(rule.color)})</button>`
        : 'This zone has its own color.')
    : (rule.color
        ? `Colour from the world style for ${escapeText(kind)}. Pick one here to override it for this zone only.`
        : 'No world style for this kind yet; set one from the zones panel on the map.');

  body.innerHTML = `
    <div class="atlas-zone-visuals-row">
      <label class="atlas-zone-visuals-label">Color</label>
      <input type="color" class="atlas-zone-visuals-color" value="${currentColor}" data-field="atlas_color" />
      <input type="text" class="atlas-zone-visuals-color-text" value="${currentColor}" data-field="atlas_color_text" maxlength="7" />
    </div>
    <div class="atlas-zone-visuals-inherit">${inheritLine}</div>
    <div class="atlas-zone-visuals-row">
      <label class="atlas-zone-visuals-label">Opacity</label>
      <input type="range" min="0" max="100" value="${Math.round(currentOpacity * 100)}" class="atlas-zone-visuals-opacity" data-field="atlas_opacity" />
      <span class="atlas-zone-visuals-opacity-val">${Math.round(currentOpacity * 100)}%</span>
    </div>
    <div class="atlas-zone-visuals-row">
      <label class="atlas-zone-visuals-label">
        <input type="checkbox" data-field="atlas_label_visible" ${currentLabelVisible ? 'checked' : ''} />
        Show label on canvas
      </label>
    </div>
  `;

  // Wire writes.
  const persist = async (patch: Partial<Zone>): Promise<void> => {
    const store = getActiveStore();
    if (!store) return;
    try {
      await store.updateZone(zone.id, patch);
      const elements = await refreshElementsAfterWrite(store);
    } catch (err) {
      console.error('[zone-visuals] update failed:', err);
      showProblem(err, { doing: 'saving the zone style', toasts });
    }
  };

  const colorInput = body.querySelector<HTMLInputElement>('.atlas-zone-visuals-color')!;
  const colorText = body.querySelector<HTMLInputElement>('.atlas-zone-visuals-color-text')!;
  // Live: update text mirror while picking; commit on change (avoid spamming
  // store writes for every color-step the picker emits).
  colorInput.addEventListener('input', () => {
    colorText.value = colorInput.value;
  });
  colorInput.addEventListener('change', async () => {
    colorText.value = colorInput.value;
    await persist({ atlas_color: colorInput.value });
  });
  colorText.addEventListener('change', async () => {
    const v = colorText.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      colorInput.value = v;
      await persist({ atlas_color: v });
    } else {
      // Revert on invalid
      colorText.value = colorInput.value;
    }
  });

  const opacityInput = body.querySelector<HTMLInputElement>('.atlas-zone-visuals-opacity')!;
  const opacityVal = body.querySelector<HTMLSpanElement>('.atlas-zone-visuals-opacity-val')!;
  opacityInput.addEventListener('input', () => {
    opacityVal.textContent = `${opacityInput.value}%`;
  });
  opacityInput.addEventListener('change', async () => {
    const pct = Number(opacityInput.value);
    if (Number.isFinite(pct)) {
      await persist({ atlas_opacity: pct / 100 });
    }
  });

  const labelChk = body.querySelector<HTMLInputElement>('input[data-field="atlas_label_visible"]')!;
  labelChk.addEventListener('change', async () => {
    await persist({ atlas_label_visible: labelChk.checked });
  });

  body.querySelector<HTMLButtonElement>('[data-action="use-kind-colour"]')?.addEventListener('click', async () => {
    // Clearing the own colour: null is the wire's "unset" (convention #21).
    await persist({ atlas_color: null } as unknown as Partial<Zone>);
  });

  return section;
}

/**
 * Delete a zone (and its markers) from its element-detail section — Captain's
 * launch note: there was no VISIBLE way to delete a zone (the generic element
 * trash exists but reads "Delete element" in the header and is easy to miss on
 * a map-centric type). This routes through the SAME cascade-aware decision as
 * that trash: `decideDeleteConfirm` honours the S310 confirm-floor (a delete
 * that cascades always confirms) and names the markers that go with it, then
 * the standard delete → refresh → clear-selection → push, landing on the
 * elements list. `store.deleteZone` IS `deleteElement`, so this is the blessed
 * delete path with a discoverable, zone-labelled entry point.
 */
async function deleteZone(zone: Zone, toasts: ToastManager): Promise<void> {
  const store = getActiveStore();
  if (!store) return;
  let dependents: Element[] = [];
  try { dependents = await store.findDependents(zone.id); }
  catch { /* a failed probe must not block the delete */ }
  const worldId = getState().active?.worldId ?? '';
  const decision = decideDeleteConfirm({
    el: zone,
    dependents,
    allElements: getState().data.elements,
    labels: getWritingLabels(worldId),
    confirmPref: getEditorSettings(getState().registry).confirm_before_delete,
  });
  if (decision.needed && !window.confirm(decision.message)) return;
  try {
    await store.deleteElement(zone.id);
    const elements = await store.listElements();
    patchSlice('data', { elements });
    patchSlice('ui', { ...getState().ui, selectedElementId: null });
    requestPushIfLinked();
    toasts.success(`Deleted ${zone.name || 'zone'}`);
    if (worldId) navigate(elementsHash(worldId));
  } catch (err) {
    console.error('[zone-sections] delete zone failed:', err);
    showProblem(err, { doing: 'deleting the zone', toasts });
  }
}

function buildZoneMarkersSection(zone: Zone, toasts: ToastManager): HTMLElement {
  const section = document.createElement('div');
  section.className = 'atlas-detail-section atlas-zone-markers-section';

  const header = document.createElement('div');
  header.className = 'atlas-detail-section-header';

  const editingThisZone = isEditing() && getEditingZoneId() === zone.id;
  const editButtonLabel = editingThisZone ? 'Done editing' : 'Edit shape';
  const editButtonIcon = editingThisZone ? 'check' : 'edit';
  header.innerHTML = `
    <span class="atlas-detail-section-title">Markers</span>
    <span class="atlas-detail-section-spacer"></span>
    <button type="button" class="atlas-zone-edit-shape-btn ${editingThisZone ? 'is-editing' : ''}" data-action="toggle-edit">
      <span class="material-symbols-outlined">${editButtonIcon}</span>
      ${editButtonLabel}
    </button>
    ${editingThisZone ? `
      <button type="button" class="atlas-zone-edit-cancel-btn" data-action="cancel-edit" title="Discard changes (ESC)">
        <span class="material-symbols-outlined">close</span>
      </button>
    ` : `
      <button type="button" class="atlas-zone-delete-btn" data-action="delete-zone" title="Delete this zone and its markers">
        <span class="material-symbols-outlined">delete</span>
        Delete zone
      </button>
    `}
  `;

  header.querySelector<HTMLButtonElement>('[data-action="toggle-edit"]')?.addEventListener('click', () => {
    if (isEditing() && getEditingZoneId() === zone.id) {
      doneEdit();
      return;
    }
    // Find a map this zone has markers on. If only one such map, enter edit
    // on it directly. If multiple, pick the first (zone editing is per-map;
    // user can switch maps via the Markers list groups if needed).
    const elements = getState().data.elements;
    const markers = elements.filter(
      (e): e is Marker => e.type === 'marker' && (e as Marker).zone_id === zone.id,
    );
    if (markers.length === 0) {
      toasts.info('Zone has no markers to edit. Draw it on a map first');
      return;
    }
    const mapId = markers[0].map_id;
    // Open the map if not already open.
    const map = elements.find((e): e is WorldMap => e.type === 'map' && e.id === mapId);
    if (map) openMapTab(map);
    enterEditMode(zone.id, mapId, toasts);
  });

  header.querySelector<HTMLButtonElement>('[data-action="cancel-edit"]')?.addEventListener('click', () => {
    cancelEdit();
  });

  header.querySelector<HTMLButtonElement>('[data-action="delete-zone"]')?.addEventListener('click', () => {
    void deleteZone(zone, toasts);
  });

  section.appendChild(header);

  const body = document.createElement('div');
  body.className = 'atlas-detail-section-body';
  section.appendChild(body);

  const elements = getState().data.elements;
  const markers = elements
    .filter((e): e is Marker => e.type === 'marker' && (e as Marker).zone_id === zone.id)
    .sort((a, b) => ((a as Marker).order ?? 0) - ((b as Marker).order ?? 0));

  if (markers.length === 0) {
    body.innerHTML = `
      <div class="atlas-zone-markers-empty">
        No markers yet. Draw this zone on a map (Polygon or Line tool in the canvas toolbar)
        to give it geometry.
      </div>
    `;
    return section;
  }

  // Group by map for display, but preserve overall order within each map's
  // contribution. For single-map zones this still renders a flat list with a
  // light per-map header.
  const byMap = new Map<string, Marker[]>();
  for (const m of markers) {
    if (!byMap.has(m.map_id)) byMap.set(m.map_id, []);
    byMap.get(m.map_id)!.push(m);
  }

  for (const [mapId, list] of byMap.entries()) {
    const map = elements.find((e): e is WorldMap => e.type === 'map' && e.id === mapId);
    const mapName = map?.name ?? '(unknown map)';

    // The point table is for editing points, which is rare next to reading
    // the page; a long one used to be most of a zone's page (Sikelia's
    // roads: 44 rows). Past a handful it folds behind the map row, which
    // keeps the count and gains a pan-to-zone (S356).
    const folded = list.length > MARKERS_FOLD_ABOVE;
    const details = document.createElement('details');
    details.className = 'atlas-zone-markers-group';
    details.open = !folded;
    const groupHeader = document.createElement('summary');
    groupHeader.className = 'atlas-zone-markers-group-header';
    groupHeader.innerHTML = `
      <span class="material-symbols-outlined">map</span>
      <span>${escapeText(mapName)}</span>
      <span class="atlas-zone-markers-group-count">${list.length} point${list.length === 1 ? '' : 's'}</span>
      <button type="button" class="atlas-zone-markers-pan atlas-zone-markers-pan-zone" data-action="pan-zone" data-map-id="${escapeText(mapId)}" title="Pan the map to this zone">
        <span class="material-symbols-outlined">my_location</span>
      </button>
    `;
    details.appendChild(groupHeader);
    body.appendChild(details);

    const ul = document.createElement('ul');
    ul.className = 'atlas-zone-markers-list';

    for (const m of list) {
      const li = document.createElement('li');
      li.className = 'atlas-zone-markers-row';
      li.setAttribute('data-marker-id', m.id);
      li.innerHTML = `
        <span class="atlas-zone-markers-order">${finiteOr(m.order, 0) + 1}</span>
        <span class="atlas-zone-markers-coords">(${escapeText(m.x)}, ${escapeText(m.y)})</span>
        <button type="button" class="atlas-zone-markers-pan" data-action="pan" title="Pan to marker">
          <span class="material-symbols-outlined">my_location</span>
        </button>
        <button type="button" class="atlas-zone-markers-del" data-action="delete" title="Delete marker">
          <span class="material-symbols-outlined">delete</span>
        </button>
      `;
      ul.appendChild(li);
    }

    details.appendChild(ul);
  }

  // Delegate clicks for the whole section body.
  body.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const panZone = target.closest<HTMLElement>('[data-action="pan-zone"]');
    if (panZone) {
      e.preventDefault(); // a button inside <summary> must not toggle the fold
      const mapId = panZone.getAttribute('data-map-id') ?? '';
      const map = elements.find((el): el is WorldMap => el.type === 'map' && el.id === mapId);
      const list = markers.filter(m => m.map_id === mapId);
      if (!map || list.length === 0) return;
      openMapTab(map);
      panMapTabTo(map.id, list.reduce((s, m) => s + m.x, 0) / list.length, list.reduce((s, m) => s + m.y, 0) / list.length);
      return;
    }
    const row = target.closest<HTMLElement>('.atlas-zone-markers-row');
    if (!row) return;
    const markerId = row.getAttribute('data-marker-id');
    if (!markerId) return;
    const marker = elements.find((el): el is Marker => el.type === 'marker' && el.id === markerId);
    if (!marker) return;

    if (target.closest('[data-action="pan"]')) {
      // Open the map tab if not already open, then pan.
      const map = elements.find((el): el is WorldMap => el.type === 'map' && el.id === marker.map_id);
      if (!map) {
        toasts.error('The map this marker belongs to is not in this world any more.');
        return;
      }
      openMapTab(map);
      panMapTabTo(map.id, marker.x, marker.y);
      return;
    }

    if (target.closest('[data-action="delete"]')) {
      const ok = window.confirm(`Delete marker (${marker.x}, ${marker.y})?`);
      if (!ok) return;
      const store = getActiveStore();
      if (!store) return;
      try {
        await store.deleteMarker(markerId);
        const updated = await refreshElementsAfterWrite(store);
      } catch (err) {
        console.error('[zone-markers] delete marker failed:', err);
        showProblem(err, { doing: 'deleting the marker', toasts });
      }
    }
  });

  return section;
}

