/**
 * Stale map-tab pane — extracted from map-tab.ts.
 *
 * Rendered when a map tab's mapId isn't in the current world's elements:
 * either the map was deleted, or the user switched worlds while the tab was
 * open. Resolves the owning world's name via the tab's worldId stamp and
 * offers a close button.
 */

import { getState, patchSlice } from '../../core/state';
import { escapeText } from '../../core/dom-utils';

export function renderStaleMapPane(pane: HTMLElement, mapId: string): void {
  const state = getState();
  const tab = state.ui.rightTabs.find(t => t.kind === 'map' && t.mapId === mapId);
  const ownerWorldId = tab && tab.kind === 'map' ? tab.worldId : undefined;
  const ownerWorld = ownerWorldId ? state.registry.worlds.find(w => w.id === ownerWorldId) : undefined;
  const ownerLabel = ownerWorld?.name ?? null;
  const tabLabel = tab && tab.kind === 'map' ? tab.label : '';
  const subMsg = ownerLabel
    ? `This map belongs to <b>${escapeText(ownerLabel)}</b>${tabLabel ? ` ("${escapeText(tabLabel)}")` : ''}. Switch to that world to view it.`
    : `It may have been deleted, or you switched worlds while it was open.`;
  pane.innerHTML = `
    <div class="atlas-empty-state atlas-map-stale-pane" data-role="map-stale-pane">
      <div class="material-symbols-outlined atlas-map-stale-icon">cloud_off</div>
      <div class="atlas-map-stale-title">${ownerLabel ? `Map from another world` : `This map isn't in the current world`}</div>
      <div class="atlas-map-stale-sub">${subMsg}</div>
      <button type="button" class="atlas-btn-ghost" data-action="close-stale">Close tab</button>
    </div>
  `;
  pane.querySelector<HTMLButtonElement>('[data-action="close-stale"]')?.addEventListener('click', () => {
    const ui = getState().ui;
    const tabIdx = ui.rightTabs.findIndex(t => t.kind === 'map' && t.mapId === mapId);
    if (tabIdx < 0) return;
    const next = [...ui.rightTabs];
    next.splice(tabIdx, 1);
    const active = ui.rightActiveIndex >= tabIdx ? Math.max(0, ui.rightActiveIndex - 1) : ui.rightActiveIndex;
    patchSlice('ui', { ...ui, rightTabs: next, rightActiveIndex: active });
  });
}
