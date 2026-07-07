/**
 * Writing setup screen.
 *
 * Shown when `isWritingInitialized` returns false for the active world. The
 * user picks tier labels (l1=Book, l2=Chapter, l3=Scene, l4=Draft by
 * default), optionally adopts detected supertypes, and optionally classifies
 * existing structured narratives into the writing tree.
 *
 * On "Save & start writing" the registry gets `writing_initialized: true`
 * plus the chosen labels; the classification (if any candidates) writes
 * supertype + order to each candidate via the FolderStore.
 *
 * Re-openable from the writing tree header gear ("writing settings"). When
 * the user re-opens setup after init, labels start with current values and
 * label changes trigger rename-migration on save.
 */

import { getState, patchSlice } from '../core/state';
import { saveRegistry } from '../registry/registry';
import { getActiveStore } from '../core/active-store';
import { requestPushIfLinked } from '../sync/sync-attach';
import { ToastManager } from '../ui/toast-manager';
import {
  getWritingLabels,
  DEFAULT_WRITING_LABELS,
  type WritingLabels,
} from './writing-helpers';
import {
  buildPromoteCandidates,
  detectExistingLabels,
  applyPromote,
  applyLabelRenameMigration,
  type PromoteCandidate,
} from './writing-promote';
import { escapeAttr, escapeText } from '../core/dom-utils';

export function mountWritingSetup(
  target: HTMLElement,
  toasts: ToastManager,
  onFinish: () => void,
): () => void {
  const active = getState().active;
  if (!active) {
    target.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
    return () => {};
  }
  const worldId = active.worldId;

  const currentLabels = getWritingLabels(worldId);
  const allElements = getState().data.elements;
  const candidates = buildPromoteCandidates(allElements, currentLabels);
  const detected = detectExistingLabels(candidates);

  // Working state — what the user has picked. Starts at current labels.
  const labels: WritingLabels = { ...currentLabels };

  const root = document.createElement('div');
  root.className = 'atlas-writing-setup';
  target.innerHTML = '';
  target.appendChild(root);

  function render(): void {
    root.innerHTML = `
      <div class="atlas-writing-setup-inner">
        <header class="atlas-writing-setup-header">
          <h1>Set up writing</h1>
          <p class="atlas-writing-setup-subtitle">
            A common shape: Book / Chapter / Scene, plus a flexible Draft tier.
            Rename any of them to fit your project.
          </p>
          <!-- div, not p: the HTML parser closes a <p> at a <details> (flow
               content), which would eject the info toggle onto its own line. -->
          <div class="atlas-writing-setup-lead">
            These labels organise your narratives into a tree.<details class="atlas-writing-setup-tech"><summary title="How labels are stored"><span class="material-symbols-outlined atlas-writing-setup-tech-icon">info</span></summary><span class="atlas-writing-setup-tech-body">Each label is stored as the narrative's <code>supertype</code>, so other OnlyWorlds tools see the same labels too.</span></details>
          </div>
        </header>

        <section class="atlas-writing-setup-labels">
          <div class="atlas-writing-setup-nest">
            ${nestRowHtml('l1', 0, labels.l1, DEFAULT_WRITING_LABELS.l1, detected.l1)}
            ${nestRowHtml('l2', 1, labels.l2, DEFAULT_WRITING_LABELS.l2, detected.l2)}
            ${nestRowHtml('l3', 2, labels.l3, DEFAULT_WRITING_LABELS.l3, detected.l3)}
          </div>
          ${draftRowHtml('l4', labels.l4, DEFAULT_WRITING_LABELS.l4, detected.l4)}
        </section>

        ${candidates.length > 0 ? promoteSectionHtml(candidates, labels) : ''}

        <div class="atlas-writing-setup-actions">
          ${candidates.length > 0
            ? '<button class="atlas-btn-ghost" data-action="skip">Skip for now</button>'
            : ''}
          <button class="atlas-btn-primary" data-action="save">Save and start writing</button>
        </div>
        ${candidates.length > 0
          ? '<p class="atlas-writing-setup-skip-note">Skip leaves the room unconfigured, so setup reappears next visit. You can also set it up later in Settings → Writing.</p>'
          : ''}
      </div>
    `;
    wireInputs();
  }

  /** One editable label in the nested Book › Chapter › Scene spine. */
  function nestRowHtml(
    key: 'l1' | 'l2' | 'l3',
    depth: 0 | 1 | 2,
    value: string,
    defaultValue: string,
    detectedValue: string | null,
  ): string {
    const connector = depth > 0
      ? `<span class="atlas-writing-setup-nest-connector material-symbols-outlined">subdirectory_arrow_right</span>`
      : '';
    return `
      <div class="atlas-writing-setup-nest-row" data-depth="${depth}">
        ${connector}
        ${labelInputHtml(key, value, defaultValue)}
        ${suggestionHtml(key, value, defaultValue, detectedValue)}
      </div>
    `;
  }

  /** The flexible Draft tier — floats beside the spine, not part of it. */
  function draftRowHtml(
    key: 'l4',
    value: string,
    defaultValue: string,
    detectedValue: string | null,
  ): string {
    return `
      <div class="atlas-writing-setup-nest-draft">
        <div class="atlas-writing-setup-nest-draft-head">
          <span class="atlas-writing-setup-nest-badge">flexible</span>
          ${labelInputHtml(key, value, defaultValue)}
          ${suggestionHtml(key, value, defaultValue, detectedValue)}
        </div>
        <span class="atlas-writing-setup-hint">Sits anywhere in the tree. Useful for half-formed ideas, alternate versions, or research notes.</span>
      </div>
    `;
  }

  /** Inline-editable label. Reads as text; click to place the cursor and edit. */
  function labelInputHtml(
    key: 'l1' | 'l2' | 'l3' | 'l4',
    value: string,
    defaultValue: string,
  ): string {
    return `
      <span class="atlas-writing-setup-label-wrap">
        <input
          type="text"
          class="atlas-writing-setup-label"
          data-label-key="${key}"
          value="${escapeAttr(value)}"
          placeholder="${escapeAttr(defaultValue)}"
          aria-label="${escapeAttr(key === 'l4' ? 'Flexible tier label' : 'Tier label')}"
          autocomplete="off"
          spellcheck="false"
        />
        <span class="atlas-writing-setup-label-pencil material-symbols-outlined" aria-hidden="true">edit</span>
      </span>
    `;
  }

  function suggestionHtml(
    key: 'l1' | 'l2' | 'l3' | 'l4',
    value: string,
    defaultValue: string,
    detectedValue: string | null,
  ): string {
    return detectedValue && detectedValue !== value && detectedValue !== defaultValue
      ? `<button type="button" class="atlas-writing-setup-suggestion" data-suggest="${escapeAttr(key)}" data-suggest-value="${escapeAttr(detectedValue)}">use detected: <strong>${escapeText(detectedValue)}</strong></button>`
      : '';
  }

  function promoteSectionHtml(cands: PromoteCandidate[], current: WritingLabels): string {
    const groups: Record<number, PromoteCandidate[]> = { 0: [], 1: [], 2: [], 3: [] };
    for (const c of cands) groups[Math.min(c.depth, 3)].push(c);
    function depthRow(d: 0 | 1 | 2 | 3): string {
      const list = groups[d];
      if (list.length === 0) return '';
      const tierLabel = d === 0 ? current.l1 : d === 1 ? current.l2 : d === 2 ? current.l3 : current.l4;
      // Delta-only: only speak when a label actually changes on this row.
      const changed = list.filter(c => c.currentSupertype !== c.proposedSupertype);
      const oldValues = [...new Set(changed.map(c => c.currentSupertype).filter(Boolean))];
      let delta = '';
      if (changed.length > 0) {
        delta = oldValues.length > 0
          ? `${oldValues.map(v => `"${v ?? ''}"`).join(', ')} → "${tierLabel}"`
          : `→ "${tierLabel}"`;
      }
      return `
        <tr class="atlas-writing-setup-promote-trow">
          <td class="atlas-writing-setup-promote-tier">${escapeText(tierLabel)}</td>
          <td class="atlas-writing-setup-promote-count">${list.length}</td>
          <td class="atlas-writing-setup-promote-delta">${escapeText(delta)}</td>
        </tr>
      `;
    }
    return `
      <section class="atlas-writing-setup-promote">
        <h2 class="atlas-writing-setup-section-title">Existing narratives</h2>
        <p class="atlas-writing-setup-section-subtitle">
          Atlas found ${cands.length} narrative${cands.length === 1 ? '' : 's'} already
          arranged in parent/child chains. They look like a writing project.
        </p>
        <table class="atlas-writing-setup-promote-table">
          <tbody>
            ${depthRow(0)}
            ${depthRow(1)}
            ${depthRow(2)}
            ${depthRow(3)}
          </tbody>
        </table>
        <label class="atlas-writing-setup-promote-toggle">
          <input type="checkbox" data-role="promote-toggle" checked />
          These keep their current labels and appear in the tree.
        </label>
      </section>
    `;
  }

  function wireInputs(): void {
    root.querySelectorAll<HTMLInputElement>('[data-label-key]').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.dataset.labelKey as 'l1' | 'l2' | 'l3' | 'l4';
        labels[key] = input.value.trim() || DEFAULT_WRITING_LABELS[key];
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-suggest]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.suggest as 'l1' | 'l2' | 'l3' | 'l4';
        const value = btn.dataset.suggestValue ?? '';
        labels[key] = value;
        render();
      });
    });
    const saveBtn = root.querySelector<HTMLButtonElement>('[data-action="save"]');
    saveBtn?.addEventListener('click', () => {
      void runFinish({ promote: shouldPromote() }, saveBtn);
    });
    const skipBtn = root.querySelector<HTMLButtonElement>('[data-action="skip"]');
    skipBtn?.addEventListener('click', () => {
      void runFinish({ promote: false }, skipBtn);
    });
  }

  function shouldPromote(): boolean {
    const toggle = root.querySelector<HTMLInputElement>('[data-role="promote-toggle"]');
    return toggle ? toggle.checked : false;
  }

  async function runFinish(opts: { promote: boolean }, button: HTMLButtonElement): Promise<void> {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      await finish(opts);
    } catch (err) {
      console.error('[atlas:writing-setup] save failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      toasts.error(`Could not save writing setup: ${msg}`);
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function finish(opts: { promote: boolean }): Promise<void> {
    const folder = getActiveStore();
    if (!folder) {
      toasts.error('No active world.');
      return;
    }

    // Validate labels — non-empty, distinct.
    const all = [labels.l1, labels.l2, labels.l3, labels.l4];
    if (all.some(v => !v || v.trim().length === 0)) {
      toasts.error('All four tier labels are required.');
      return;
    }
    if (new Set(all).size !== 4) {
      toasts.error('Tier labels must be different from each other.');
      return;
    }

    // Apply rename migration if labels changed FROM existing initialized state.
    const reg = getState().registry;
    const entry = reg.worlds.find(w => w.id === worldId);
    const wasInitialized = entry?.writing_initialized === true;
    if (wasInitialized && entry?.writing_labels) {
      const oldLabels: WritingLabels = {
        l1: entry.writing_labels.l1 ?? DEFAULT_WRITING_LABELS.l1,
        l2: entry.writing_labels.l2 ?? DEFAULT_WRITING_LABELS.l2,
        l3: entry.writing_labels.l3 ?? DEFAULT_WRITING_LABELS.l3,
        l4: (entry.writing_labels as Partial<WritingLabels>).l4 ?? DEFAULT_WRITING_LABELS.l4,
      };
      const renamed = await applyLabelRenameMigration(folder, getState().data.elements, oldLabels, labels);
      if (renamed > 0) {
        const fresh = await folder.listElements();
        patchSlice('data', { elements: fresh });
        toasts.info(`Renamed ${renamed} narrative${renamed === 1 ? '' : 's'} to match new labels.`);
      }
    }

    // Save labels + flag FIRST. This way the outer mount's subscribe sees
    // writing_initialized=true and switches to tree mode cleanly. If we
    // saved after the promote, the data-side patchSlice would trigger a
    // re-mount with stale registry state and fight us.
    const nextWorlds = reg.worlds.map(w =>
      w.id === worldId
        ? { ...w, writing_labels: labels, writing_initialized: true }
        : w,
    );
    const nextReg = { ...reg, worlds: nextWorlds };
    saveRegistry(nextReg);
    patchSlice('registry', nextReg);

    // Promote candidates. Each failure is logged but doesn't abort the batch.
    if (opts.promote && candidates.length > 0) {
      const finalCandidates = buildPromoteCandidates(getState().data.elements, labels);
      let written = 0;
      const failures: Array<{ id: string; error: string }> = [];
      for (const c of finalCandidates) {
        const patch: Record<string, unknown> = {};
        if (c.currentSupertype !== c.proposedSupertype) patch.supertype = c.proposedSupertype;
        if (c.needsOrder) patch.order = c.proposedOrder;
        if (Object.keys(patch).length === 0) continue;
        try {
          await folder.updateElement(c.el.id, patch as never);
          written++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push({ id: c.el.id, error: msg });
          console.warn(`[atlas:writing-setup] failed to write ${c.el.name} (${c.el.id}):`, err);
        }
      }
      const fresh = await folder.listElements();
      patchSlice('data', { elements: fresh });
      if (written > 0) {
        toasts.success(`Added ${written} narrative${written === 1 ? '' : 's'} to the writing tree.`);
      }
      if (failures.length > 0) {
        toasts.error(`${failures.length} narrative${failures.length === 1 ? '' : 's'} could not be updated. See console.`);
      }
    } else {
      // Even when not promoting we re-list to ensure state is fresh.
      const fresh = await folder.listElements();
      patchSlice('data', { elements: fresh });
    }

    requestPushIfLinked();
    onFinish();
  }

  render();
  return () => {
    // No persistent subscriptions — the inputs own their state.
  };
}

// Re-use applyPromote signature reference; unused locally but kept so the
// promote module's idempotency helper isn't dead-imported elsewhere if
// future refactors land.
void applyPromote;
