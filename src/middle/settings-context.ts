/**
 * Settings → Context pane tab (session 231; extracted from settings-panel
 * session 233). Per-world prefs for the right-pane Context tab — hop depth,
 * lock-layout, edge coloring. The same controls live on the graph toolbar and
 * write to the same registry fields (convention #59: one-direction prefs flow).
 */

import { getState, patchSlice } from '../core/state';
import { saveRegistry, updateWorldEntry } from '../registry/registry';
import { ToastManager } from '../ui/toast-manager';
import type { WorldRegistryEntry } from '../core/types';

export function renderContextTab(entry: WorldRegistryEntry): string {
  const hopExplicit = entry.context_hop_depth;
  const lockOn = entry.context_lock_layout === true;
  const edgeColorOn = entry.context_edge_color === true;
  return `
    <section class="atlas-settings-section">
      <h3>Context pane</h3>
      <p class="atlas-settings-hint">
        Preferences for the right-pane Context tab: the graph + element preview
        / cast lists. Per-world. The same toolbar controls live above the graph
        and write to the same settings.
      </p>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Default hop depth</label>
        <select class="atlas-select" data-setting="context_hop_depth">
          <option value="" ${hopExplicit === undefined ? 'selected' : ''}>Auto (tier-derived)</option>
          <option value="1" ${hopExplicit === 1 ? 'selected' : ''}>1-hop (direct cast only)</option>
          <option value="2" ${hopExplicit === 2 ? 'selected' : ''}>2-hop (cast + adjacent)</option>
          <option value="3" ${hopExplicit === 3 ? 'selected' : ''}>3-hop (deeper exploration)</option>
          <option value="4" ${hopExplicit === 4 ? 'selected' : ''}>4-hop (very wide)</option>
        </select>
      </div>
      <p class="atlas-settings-hint">
        Auto mode: narrative subjects at scene / draft default to 2-hop;
        chapter / book default to 1-hop; non-narrative subjects default to
        2-hop. Picking 1-4 explicitly overrides for every subject in this
        world. Higher depths use per-ring caps (12 / 8 / 6) so the graph
        stays readable.
      </p>
      <label class="atlas-settings-toggle">
        <input type="checkbox" data-setting="context_lock_layout" ${lockOn ? 'checked' : ''} />
        <span>Lock graph layout when toggling type filters (no sim re-run; surviving nodes don't jump)</span>
      </label>
    </section>
    <section class="atlas-settings-section">
      <h3>Edge styling</h3>
      <label class="atlas-settings-toggle">
        <input type="checkbox" data-setting="context_edge_color" ${edgeColorOn ? 'checked' : ''} />
        <span>Tint edges by the non-centre node's element type (uses the shared element palette)</span>
      </label>
      <p class="atlas-settings-hint">
        Off (default): all edges render in the neutral cyan accent. On:
        radial edges take the colour of the connected element's type, a quick
        visual grouping by type at the edge of the graph.
      </p>
    </section>
  `;
}

export function wireContextTab(entry: WorldRegistryEntry, toasts: ToastManager): void {
  // Shared commit path — merge a per-world patch, persist, surface a toast.
  const commit = (patch: Partial<WorldRegistryEntry>, message: string): void => {
    const next = updateWorldEntry(getState().registry, entry.id, patch);
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info(message);
  };

  const hopSel = document.querySelector<HTMLSelectElement>(`.atlas-settings select[data-setting="context_hop_depth"]`);
  hopSel?.addEventListener('change', () => {
    const raw = hopSel.value;
    let next: 1 | 2 | 3 | 4 | undefined;
    if (raw === '1') next = 1;
    else if (raw === '2') next = 2;
    else if (raw === '3') next = 3;
    else if (raw === '4') next = 4;
    else next = undefined;
    commit({ context_hop_depth: next }, `Context hop set to ${next === undefined ? 'auto' : `${next}-hop`}`);
  });

  const lockCb = document.querySelector<HTMLInputElement>(`.atlas-settings input[data-setting="context_lock_layout"]`);
  lockCb?.addEventListener('change', () => {
    commit({ context_lock_layout: lockCb.checked }, `Context layout ${lockCb.checked ? 'locked' : 'free'}`);
  });

  const colorCb = document.querySelector<HTMLInputElement>(`.atlas-settings input[data-setting="context_edge_color"]`);
  colorCb?.addEventListener('change', () => {
    commit({ context_edge_color: colorCb.checked }, `Edge colouring ${colorCb.checked ? 'on' : 'off'}`);
  });
}
