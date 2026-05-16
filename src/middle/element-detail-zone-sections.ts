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
import { getActiveStore } from '../ui/create-world-modal';
import { requestPushIfLinked } from '../sync/sync-attach';
import type { Zone, Marker, WorldMap } from '../core/types';
import { openMapTab } from '../tabs/right/map-index-tab';
import { panMapTabTo } from '../tabs/right/map-tab';
import { enterEditMode, isEditing, getEditingZoneId, doneEdit, cancelEdit } from '../tabs/right/zone-edit-mode';
import type { ToastManager } from '../ui/toast-manager';

export function buildZoneSections(zone: Zone, toasts: ToastManager): HTMLElement[] {
  return [
    buildZoneVisualsSection(zone, toasts),
    buildZoneMarkersSection(zone, toasts),
  ];
}

function buildZoneVisualsSection(zone: Zone, toasts: ToastManager): HTMLElement {
  const section = document.createElement('div');
  section.className = 'atlas-detail-section atlas-zone-visuals-section';

  const header = document.createElement('div');
  header.className = 'atlas-detail-section-header';
  header.innerHTML = `
    <span class="atlas-detail-section-title">Zone visuals</span>
    <span class="atlas-detail-section-hint" title="These fields are stored locally and are NOT synced to the OnlyWorlds API.">local only</span>
  `;
  section.appendChild(header);

  const body = document.createElement('div');
  body.className = 'atlas-detail-section-body';
  section.appendChild(body);

  const currentColor = (zone as { atlas_color?: string }).atlas_color ?? '#22d3ee';
  const currentOpacity = (zone as { atlas_opacity?: number }).atlas_opacity ?? 0.4;
  const currentLabelVisible = !!(zone as { atlas_label_visible?: boolean }).atlas_label_visible;

  body.innerHTML = `
    <div class="atlas-zone-visuals-row">
      <label class="atlas-zone-visuals-label">Color</label>
      <input type="color" class="atlas-zone-visuals-color" value="${currentColor}" data-field="atlas_color" />
      <input type="text" class="atlas-zone-visuals-color-text" value="${currentColor}" data-field="atlas_color_text" maxlength="7" />
    </div>
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
      const elements = await store.listElements();
      patchSlice('data', { elements });
      requestPushIfLinked();
    } catch (err) {
      console.error('[zone-visuals] update failed:', err);
      toasts.error('failed to update zone visual');
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

  return section;
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
    ` : ''}
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
      toasts.info('zone has no markers to edit — draw it on a map first');
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
        No markers yet — draw this zone on a map (Polygon or Line tool in the canvas toolbar)
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

    const groupHeader = document.createElement('div');
    groupHeader.className = 'atlas-zone-markers-group-header';
    groupHeader.innerHTML = `
      <span class="material-symbols-outlined">map</span>
      <span>${escapeHtml(mapName)}</span>
      <span class="atlas-zone-markers-group-count">${list.length}</span>
    `;
    body.appendChild(groupHeader);

    const ul = document.createElement('ul');
    ul.className = 'atlas-zone-markers-list';

    for (const m of list) {
      const li = document.createElement('li');
      li.className = 'atlas-zone-markers-row';
      li.setAttribute('data-marker-id', m.id);
      li.innerHTML = `
        <span class="atlas-zone-markers-order">${(m.order ?? 0) + 1}</span>
        <span class="atlas-zone-markers-coords">(${m.x}, ${m.y})</span>
        <button type="button" class="atlas-zone-markers-pan" data-action="pan" title="Pan to marker">
          <span class="material-symbols-outlined">crosshair</span>
        </button>
        <button type="button" class="atlas-zone-markers-del" data-action="delete" title="Delete marker">
          <span class="material-symbols-outlined">delete</span>
        </button>
      `;
      ul.appendChild(li);
    }

    body.appendChild(ul);
  }

  // Delegate clicks for the whole section body.
  body.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
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
        toasts.error('marker map not found');
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
        const updated = await store.listElements();
        patchSlice('data', { elements: updated });
        requestPushIfLinked();
      } catch (err) {
        console.error('[zone-markers] delete marker failed:', err);
        toasts.error('failed to delete marker');
      }
    }
  });

  return section;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] as string);
}
