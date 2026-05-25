/**
 * Settings → Writing tab (DESIGN_WRITING.md; extracted from settings-panel
 * session 233). Tier labels (l1-l4, which ARE the supertype storage value —
 * renaming migrates existing narratives), prose font size/family, spellcheck.
 */

import { getState, patchSlice } from '../core/state';
import { saveRegistry, updateWorldEntry } from '../registry/registry';
import { ToastManager } from '../ui/toast-manager';
import type { WorldRegistryEntry } from '../core/types';
import { escapeAttr } from '../core/dom-utils';

export function renderWritingTab(entry: WorldRegistryEntry): string {
  const labels = {
    l1: entry.writing_labels?.l1 ?? 'Book',
    l2: entry.writing_labels?.l2 ?? 'Chapter',
    l3: entry.writing_labels?.l3 ?? 'Scene',
    l4: entry.writing_labels?.l4 ?? 'Draft',
  };
  return `
    <section class="atlas-settings-section">
      <h3>Writing</h3>
      <p class="atlas-settings-hint">
        Four tier labels for the writing room. The label IS the
        <code>supertype</code> stored on each Narrative — renaming a label
        rewrites existing narratives' supertype so display and storage stay
        consistent.
      </p>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Level 1 (top)</label>
        <input class="atlas-input" data-setting="writing_l1" value="${escapeAttr(labels.l1)}" placeholder="Book" />
      </div>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Level 2 (middle)</label>
        <input class="atlas-input" data-setting="writing_l2" value="${escapeAttr(labels.l2)}" placeholder="Chapter" />
      </div>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Level 3 (deepest)</label>
        <input class="atlas-input" data-setting="writing_l3" value="${escapeAttr(labels.l3)}" placeholder="Scene" />
      </div>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Level 4 (flexible / draft)</label>
        <input class="atlas-input" data-setting="writing_l4" value="${escapeAttr(labels.l4)}" placeholder="Draft" />
      </div>
      <p class="atlas-settings-hint">
        Examples: Story / Substory / Scene / Note · Volume / Book / Chapter / Sketch.
        Existing narratives' supertype is migrated on label change.
      </p>
    </section>
    <section class="atlas-settings-section">
      <h3>Writing workspace</h3>
      <p class="atlas-settings-hint">Prose font size + family for the writing room. Applies live to both writing and reading mode.</p>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Font size</label>
        <select class="atlas-select" data-setting="writing_font_size_px">
          <option value="13" ${entry.writing_font_size_px === 13 ? 'selected' : ''}>13 (compact)</option>
          <option value="14" ${entry.writing_font_size_px === 14 ? 'selected' : ''}>14 (small)</option>
          <option value="15" ${(entry.writing_font_size_px ?? 15) === 15 ? 'selected' : ''}>15 (default)</option>
          <option value="16" ${entry.writing_font_size_px === 16 ? 'selected' : ''}>16 (large)</option>
          <option value="18" ${entry.writing_font_size_px === 18 ? 'selected' : ''}>18 (extra large)</option>
        </select>
      </div>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Font family</label>
        <select class="atlas-select" data-setting="writing_font_family">
          <option value="sans"  ${(entry.writing_font_family ?? 'sans') === 'sans' ? 'selected' : ''}>Sans (default)</option>
          <option value="serif" ${entry.writing_font_family === 'serif' ? 'selected' : ''}>Serif (Georgia)</option>
          <option value="slab"  ${entry.writing_font_family === 'slab' ? 'selected' : ''}>Slab</option>
          <option value="mono"  ${entry.writing_font_family === 'mono' ? 'selected' : ''}>Mono</option>
        </select>
      </div>
      <label class="atlas-settings-toggle">
        <input type="checkbox" data-setting="writing_spellcheck" ${entry.writing_spellcheck !== false ? 'checked' : ''} />
        <span>Spellcheck prose (browser-native; uncheck to disable squiggle lines)</span>
      </label>
    </section>
  `;
}

export function wireWritingTab(entry: WorldRegistryEntry, toasts: ToastManager): void {
  const save = async (key: 'l1' | 'l2' | 'l3' | 'l4', value: string): Promise<void> => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const reg = getState().registry;
    const idx = reg.worlds.findIndex(w => w.id === entry.id);
    if (idx < 0) return;
    const current = {
      l1: reg.worlds[idx].writing_labels?.l1 ?? 'Book',
      l2: reg.worlds[idx].writing_labels?.l2 ?? 'Chapter',
      l3: reg.worlds[idx].writing_labels?.l3 ?? 'Scene',
      l4: reg.worlds[idx].writing_labels?.l4 ?? 'Draft',
    };
    if (current[key] === trimmed) return;
    const nextLabels = { ...current, [key]: trimmed };
    // Reject duplicate tier labels.
    const values = [nextLabels.l1, nextLabels.l2, nextLabels.l3, nextLabels.l4];
    if (new Set(values).size !== 4) {
      toasts.error('Tier labels must be distinct.');
      // Revert input value.
      const el = document.querySelector<HTMLInputElement>(`.atlas-settings input[data-setting="writing_${key}"]`);
      if (el) el.value = current[key];
      return;
    }
    const next = updateWorldEntry(reg, entry.id, { writing_labels: nextLabels });
    saveRegistry(next);
    patchSlice('registry', next);

    // Run rename migration: rewrite supertype on every narrative carrying the
    // old label value.
    const { applyLabelRenameMigration } = await import('./writing-promote');
    const { getActiveStore } = await import('../core/active-store');
    const folder = getActiveStore();
    if (folder) {
      const renamed = await applyLabelRenameMigration(
        folder,
        getState().data.elements,
        current,
        nextLabels,
      );
      if (renamed > 0) {
        const fresh = await folder.listElements();
        patchSlice('data', { elements: fresh });
        toasts.success(`${key.toUpperCase()} label saved (${renamed} narrative${renamed === 1 ? '' : 's'} migrated)`);
        const { requestPushIfLinked } = await import('../sync/sync-attach');
        requestPushIfLinked();
        return;
      }
    }
    toasts.info(`${key.toUpperCase()} label saved`);
  };
  for (const k of ['l1', 'l2', 'l3', 'l4'] as const) {
    const el = document.querySelector<HTMLInputElement>(`.atlas-settings input[data-setting="writing_${k}"]`);
    el?.addEventListener('change', () => { void save(k, el.value); });
  }

  // Font/family/spellcheck — atlas-local prefs, applied live to the workspace
  // via CSS vars (read in writing-workspace.ts). All share the commit path.
  const commit = (patch: Partial<WorldRegistryEntry>, message: string): void => {
    const next = updateWorldEntry(getState().registry, entry.id, patch);
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info(message);
  };

  const fontSel = document.querySelector<HTMLSelectElement>(`.atlas-settings select[data-setting="writing_font_size_px"]`);
  fontSel?.addEventListener('change', () => {
    const px = Number(fontSel.value);
    if (!Number.isFinite(px) || px < 12 || px > 22) return;
    commit({ writing_font_size_px: px }, `Writing font size set to ${px}px`);
  });

  const famSel = document.querySelector<HTMLSelectElement>(`.atlas-settings select[data-setting="writing_font_family"]`);
  famSel?.addEventListener('change', () => {
    const v = famSel.value;
    if (v !== 'sans' && v !== 'serif' && v !== 'slab' && v !== 'mono') return;
    commit({ writing_font_family: v }, `Writing font set to ${v}`);
  });

  const spellCb = document.querySelector<HTMLInputElement>(`.atlas-settings input[data-setting="writing_spellcheck"]`);
  spellCb?.addEventListener('change', () => {
    commit({ writing_spellcheck: spellCb.checked }, `Spellcheck ${spellCb.checked ? 'on' : 'off'}`);
  });
}
