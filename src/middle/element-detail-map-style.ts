/**
 * Map-only "Map style" row (S423, a map drawn from its own zones): Plain, or
 * a style that draws each zone from its kind (`core/map-ink.ts`). Writes the
 * map's `atlas_map_style` (a synced extension field; null for Plain).
 */

import { ToastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import { getActiveStore } from '../core/active-store';
import { worldIsViewOnly } from '../core/view-only';
import { refreshElementsAfterWrite } from '../sync/sync-attach';
import { MAP_STYLE_IDS, mapStylePreset, mapStyleOf } from '../core/map-ink';
import type { WorldMap } from '../core/types';
import { pickMapImageSource } from '../tabs/right/map-image-source';

export function buildMapStyleRow(m: WorldMap, toasts: ToastManager): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-field atlas-map-style';
  wrap.dataset.field = 'atlas_map_style';

  const label = document.createElement('div');
  label.className = 'atlas-field-label';
  label.textContent = 'Map style';
  label.title = 'Draws the zones on this map from their kind (a Landmass, a Range, a River). Only the look changes: the zones stay as they are.';
  wrap.appendChild(label);

  const value = document.createElement('div');
  value.className = 'atlas-field-value';
  wrap.appendChild(value);

  const select = document.createElement('select');
  select.className = 'atlas-select atlas-map-style-select';
  select.setAttribute('aria-label', 'Map style');
  const plain = new Option('Plain', '');
  select.add(plain);
  for (const id of MAP_STYLE_IDS) select.add(new Option(mapStylePreset(id)!.name, id));
  select.value = mapStyleOf(m)?.id ?? '';
  // A view-only world shows its style with nothing to change (conv. 149).
  select.disabled = worldIsViewOnly();
  value.appendChild(select);

  // Over a picture the style draws the zones' ink and covers nothing (gate G3, `overPicture`).
  if (pickMapImageSource(m).kind !== 'flat') {
    const note = document.createElement('div');
    note.className = 'atlas-map-style-note';
    note.textContent = 'Over a picture, the zones take the style\'s lines and names, and the picture stays the ground.';
    value.appendChild(note);
  }

  select.addEventListener('change', async () => {
    const store = getActiveStore();
    if (!store) return;
    const next = select.value || null;
    try {
      await store.updateMap(m.id, { atlas_map_style: next } as unknown as Partial<WorldMap>);
      await refreshElementsAfterWrite(store);
    } catch (err) {
      console.error('[map-style] write failed:', err);
      showProblem(err, { doing: 'changing the map style', toasts });
    }
  });

  return wrap;
}
