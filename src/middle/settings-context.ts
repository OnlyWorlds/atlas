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
      <h3>Web pane</h3>
      <p class="atlas-settings-hint">
        The graph and lists in the right pane's Web tab, for this world. The
        same controls sit above the graph.
      </p>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Graph reach</label>
        <select class="atlas-select" data-setting="context_hop_depth">
          <option value="" ${hopExplicit === undefined ? 'selected' : ''}>Auto</option>
          <option value="1" ${hopExplicit === 1 ? 'selected' : ''}>1 · direct links only</option>
          <option value="2" ${hopExplicit === 2 ? 'selected' : ''}>2 · their links too</option>
          <option value="3" ${hopExplicit === 3 ? 'selected' : ''}>3 · wider</option>
          <option value="4" ${hopExplicit === 4 ? 'selected' : ''}>4 · widest</option>
        </select>
      </div>
      <p class="atlas-settings-hint">
        Auto reaches 1 step from a book or a chapter, and 2 from everything
        else. A number sets the reach for everything in this world. The
        farther steps show only their best-connected elements, so the graph
        stays readable.
      </p>
      <label class="atlas-settings-toggle">
        <input type="checkbox" data-setting="context_lock_layout" ${lockOn ? 'checked' : ''} />
        <span>Keep the graph still when a type is hidden or shown (the other elements stay where they are)</span>
      </label>
    </section>
    <section class="atlas-settings-section">
      <h3>Graph lines</h3>
      <label class="atlas-settings-toggle">
        <input type="checkbox" data-setting="context_edge_color" ${edgeColorOn ? 'checked' : ''} />
        <span>Colour each line by the type of the element it leads to</span>
      </label>
      <p class="atlas-settings-hint">
        Off (the default): every line is cyan. On: the lines take their
        element's type colour, so the types group at a glance.
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
    commit({ context_hop_depth: next }, `Graph reach: ${next === undefined ? 'auto' : next}`);
  });

  const lockCb = document.querySelector<HTMLInputElement>(`.atlas-settings input[data-setting="context_lock_layout"]`);
  lockCb?.addEventListener('change', () => {
    commit({ context_lock_layout: lockCb.checked }, `Graph ${lockCb.checked ? 'kept still' : 'free to move'}`);
  });

  const colorCb = document.querySelector<HTMLInputElement>(`.atlas-settings input[data-setting="context_edge_color"]`);
  colorCb?.addEventListener('change', () => {
    commit({ context_edge_color: colorCb.checked }, `Line colours ${colorCb.checked ? 'on' : 'off'}`);
  });
}
