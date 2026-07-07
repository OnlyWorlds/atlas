/**
 * Import & export room (DESIGN_IMPORT.md). One scrolling panel, two halves:
 *
 *   Bring in  — drop / paste / pick OnlyWorlds JSON → live review (format,
 *               counts, target world, validation + copy-fix-prompt, conflicts)
 *               → import. Full-world JSON defaults to a NEW world; loose lists
 *               (or "merge" mode) reconcile into the current world.
 *   Take out  — export the current world (or a by-type subset) to an
 *               ow.com-compatible JSON file.
 *
 * The reconcile core (parse → validate → reconcile → ImportPlan) is pure and
 * lives in src/import/; this room is its surface. Mode A writes a new world
 * folder; Mode B merges into the active world (convention #81-85).
 */

import { getState, subscribe } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { escapeText } from '../core/dom-utils';
import { ALL_ELEMENT_TYPES, type Element, type ElementType } from '../core/types';
import { ELEMENT_LABELS } from '../core/constants';
import { parsePayload } from '../import/parse';
import { validatePayload, generateFixPrompt } from '../import/validate';
import { reconcile } from '../import/reconcile';
import { buildWorldExport } from '../import/export-world';
import {
  createWorldFromImportedData,
  importIntoActiveWorld,
} from '../setup/atlas-root-flow';
import type { ParseResult, ImportPlan, ValidationIssue } from '../import/types';
import { ToastManager } from '../ui/toast-manager';

type Mode = 'new' | 'merge';

export function mountImportRoom(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-import-room';
  target.appendChild(root);

  root.innerHTML = `
    <header class="atlas-room-header">
      <h1>Import &amp; export</h1>
      <p class="atlas-room-subtitle">Bring OnlyWorlds data into atlas, or take a world out as a portable JSON file.</p>
    </header>
    <div class="atlas-room-tabs" role="tablist">
      <button type="button" class="atlas-room-tab is-active" data-tab="in" role="tab">
        <span class="material-symbols-outlined">download</span> Bring in
      </button>
      <button type="button" class="atlas-room-tab" data-tab="out" role="tab">
        <span class="material-symbols-outlined">upload</span> Take out
      </button>
    </div>
    <div class="atlas-import-body">
      <div class="atlas-import-panel" data-panel="in" role="tabpanel">
        <div class="atlas-import-drop" data-role="drop" tabindex="0" title="drop or click to choose a .json file">
          <span class="material-symbols-outlined">place_item</span>
          <p>drop a world or elements <b>.json</b> here</p>
          <span class="atlas-import-drop-sub">or click to choose a file</span>
          <input type="file" accept="application/json,.json" data-role="file" hidden />
        </div>
        <textarea class="atlas-import-paste" data-role="paste" rows="4"
          placeholder="…or paste OnlyWorlds JSON — a full world export, or loose element lists"></textarea>
        <div class="atlas-import-paste-actions">
          <button type="button" class="atlas-btn-ghost" data-action="load">load pasted JSON</button>
          <button type="button" class="atlas-btn-ghost" data-action="clear" hidden>clear</button>
        </div>
        <p class="atlas-import-error" data-role="error" hidden></p>
        <div data-role="review"></div>
      </div>
      <div class="atlas-import-panel" data-panel="out" role="tabpanel" hidden>
        <div data-role="export"></div>
      </div>
    </div>
  `;

  const dropEl = root.querySelector<HTMLElement>('[data-role="drop"]')!;
  const fileInput = root.querySelector<HTMLInputElement>('[data-role="file"]')!;
  const pasteEl = root.querySelector<HTMLTextAreaElement>('[data-role="paste"]')!;
  const errorEl = root.querySelector<HTMLElement>('[data-role="error"]')!;
  const reviewMount = root.querySelector<HTMLElement>('[data-role="review"]')!;
  const exportMount = root.querySelector<HTMLElement>('[data-role="export"]')!;
  const clearBtn = root.querySelector<HTMLButtonElement>('[data-action="clear"]')!;

  // Tabs: bring in | take out.
  const tabButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('.atlas-room-tab'));
  const panelIn = root.querySelector<HTMLElement>('[data-panel="in"]')!;
  const panelOut = root.querySelector<HTMLElement>('[data-panel="out"]')!;
  function setTab(t: 'in' | 'out'): void {
    tabButtons.forEach(b => b.classList.toggle('is-active', b.dataset.tab === t));
    panelIn.hidden = t !== 'in';
    panelOut.hidden = t !== 'out';
  }
  tabButtons.forEach(b => b.addEventListener('click', () => setTab((b.dataset.tab as 'in' | 'out') ?? 'in')));

  // ---- ephemeral parse/import state -----------------------------------------
  let parsed: ParseResult | null = null;
  let mode: Mode = 'new';
  let conflict: 'skip' | 'overwrite' = 'skip';
  let worldName = '';
  let importing = false;

  const activeWorld = () => getState().active;
  const activeElements = (): Element[] => getState().data.elements;

  // ---------------------------------------------------------------------------
  // Bring in
  // ---------------------------------------------------------------------------

  function showError(msg: string): void {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    parsed = null;
    reviewMount.innerHTML = '';
    clearBtn.hidden = false;
  }

  function ingest(text: string, sourceLabel: string): void {
    errorEl.hidden = true;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      showError(`${sourceLabel} isn't valid JSON — check for a missing comma, quote, or bracket.`);
      return;
    }
    const result = parsePayload(raw);
    if (!result.ok) {
      showError(result.error ?? 'Unrecognized format.');
      return;
    }
    parsed = result;
    clearBtn.hidden = false;
    // Default mode: full-world → new world; loose → merge into current.
    mode = result.format === 'full-world' ? 'new' : 'merge';
    conflict = 'skip';
    worldName = (typeof result.world?.name === 'string' && result.world.name.trim())
      ? result.world.name.trim()
      : 'Imported world';
    renderReview();
  }

  function clearLoaded(): void {
    parsed = null;
    pasteEl.value = '';
    errorEl.hidden = true;
    reviewMount.innerHTML = '';
    clearBtn.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Review (built after a successful parse)
  // ---------------------------------------------------------------------------

  function buildPlan(): ImportPlan {
    const existing = mode === 'merge' ? activeElements() : [];
    const plan = reconcile(parsed!, existing, { onConflict: conflict, matchByName: true });
    if (mode === 'new') {
      // The editable world name wins over the file's.
      plan.worldMeta = { ...(plan.worldMeta ?? {}), name: worldName.trim() || 'Imported world' };
    }
    return plan;
  }

  function renderReview(): void {
    if (!parsed) { reviewMount.innerHTML = ''; return; }

    const aw = activeWorld();
    const issues = validatePayload(parsed, mode === 'merge' ? activeElements() : []);
    const plan = buildPlan();
    const r = plan.report;
    const typeCount = parsed.byType.size;

    const isFull = parsed.format === 'full-world';
    const canMerge = !!aw;
    // Loose with no active world is a dead end — guide the user.
    const looseBlocked = !isFull && !canMerge;

    reviewMount.innerHTML = `
      <div class="atlas-import-review">
        <div class="atlas-import-summary">
          <span class="atlas-import-badge ${isFull ? 'is-world' : 'is-loose'}">${isFull ? 'full world' : 'loose elements'}</span>
          ${isFull && parsed.world?.name ? `<span class="atlas-import-summary-name">${escapeText(String(parsed.world.name))}</span>` : ''}
          <span class="atlas-import-summary-meta">${parsed.totalElements} element${parsed.totalElements === 1 ? '' : 's'} · ${typeCount} type${typeCount === 1 ? '' : 's'}</span>
        </div>

        ${looseBlocked ? `
          <p class="atlas-import-warn"><span class="material-symbols-outlined">info</span> Loose elements merge into an open world. Open or create a world first, then come back.</p>
        ` : `
          <div class="atlas-import-mode" data-role="mode">
            ${isFull ? `
              <label class="atlas-import-radio"><input type="radio" name="imp-mode" value="new" ${mode === 'new' ? 'checked' : ''}/> <span>Import as a new world</span></label>
              <label class="atlas-import-radio ${canMerge ? '' : 'is-disabled'}"><input type="radio" name="imp-mode" value="merge" ${mode === 'merge' ? 'checked' : ''} ${canMerge ? '' : 'disabled'}/> <span>Merge into ${canMerge ? escapeText(aw!.meta?.name ?? 'the current world') : 'the current world'}</span></label>
            ` : `
              <p class="atlas-import-mode-fixed">Merge into <b>${escapeText(aw!.meta?.name ?? 'the current world')}</b></p>
            `}
          </div>

          ${mode === 'new' ? `
            <label class="atlas-import-field">
              <span>New world name</span>
              <input type="text" class="atlas-import-name" data-role="world-name" value="${escapeText(worldName)}" />
            </label>
          ` : ''}

          ${mode === 'merge' && r.updated + r.skipped > 0 ? `
            <div class="atlas-import-conflict" data-role="conflict">
              <span class="atlas-import-conflict-count">${r.updated + r.skipped} already exist${r.updated + r.skipped === 1 ? 's' : ''} in this world</span>
              <label class="atlas-import-radio"><input type="radio" name="imp-conflict" value="skip" ${conflict === 'skip' ? 'checked' : ''}/> <span>Keep mine (skip duplicates)</span></label>
              <label class="atlas-import-radio"><input type="radio" name="imp-conflict" value="overwrite" ${conflict === 'overwrite' ? 'checked' : ''}/> <span>Overwrite with imported</span></label>
            </div>
          ` : ''}

          ${renderValidation(issues)}

          <div class="atlas-import-preview">
            <span class="atlas-import-stat"><b>${r.created}</b> create</span>
            ${r.updated ? `<span class="atlas-import-stat"><b>${r.updated}</b> update</span>` : ''}
            ${r.skipped ? `<span class="atlas-import-stat is-dim"><b>${r.skipped}</b> skip</span>` : ''}
            ${r.invalidRecords ? `<span class="atlas-import-stat is-warn"><b>${r.invalidRecords}</b> invalid</span>` : ''}
            ${r.droppedLinks.length ? `<span class="atlas-import-stat is-warn" title="Links to other elements not found in this import — the connection is dropped but each element is still created.">${r.droppedLinks.length} link${r.droppedLinks.length === 1 ? '' : 's'} dropped</span>` : ''}
          </div>

          <button type="button" class="atlas-btn-primary" data-action="import" ${importing ? 'disabled' : ''}>
            ${importing ? 'importing…' : (mode === 'new' ? 'create world' : 'import into world')}
          </button>
          ${importing ? `<div class="atlas-import-progress" data-role="import-progress"><div class="atlas-import-progress-fill"></div><span class="atlas-import-progress-label">writing 0 / ${r.created + r.updated}</span></div>` : ''}
        `}
      </div>
    `;
    wireReview(issues);
  }

  function renderValidation(issues: ValidationIssue[]): string {
    if (issues.length === 0) {
      return `<p class="atlas-import-ok"><span class="material-symbols-outlined">check_circle</span> Looks well-formed.</p>`;
    }
    const shown = issues.slice(0, 6);
    const more = issues.length - shown.length;
    return `
      <div class="atlas-import-issues" data-role="issues">
        <div class="atlas-import-issues-head">
          <span><span class="material-symbols-outlined">warning</span> ${issues.length} thing${issues.length === 1 ? '' : 's'} to check</span>
          <button type="button" class="atlas-btn-ghost" data-action="copy-fix">copy fix prompt</button>
        </div>
        <ul class="atlas-import-issue-list">
          ${shown.map(i => `<li><code>${escapeText(i.path)}</code> — ${escapeText(i.issue)}</li>`).join('')}
          ${more > 0 ? `<li class="is-dim">+${more} more…</li>` : ''}
        </ul>
        <p class="atlas-import-issues-note">Import still runs — invalid entries are skipped and broken links removed. Paste the fix prompt to your AI to repair the source.</p>
      </div>
    `;
  }

  function wireReview(issues: ValidationIssue[]): void {
    reviewMount.querySelectorAll<HTMLInputElement>('input[name="imp-mode"]').forEach(el => {
      el.addEventListener('change', () => { mode = el.value as Mode; conflict = 'skip'; renderReview(); });
    });
    reviewMount.querySelectorAll<HTMLInputElement>('input[name="imp-conflict"]').forEach(el => {
      el.addEventListener('change', () => { conflict = el.value as 'skip' | 'overwrite'; renderReview(); });
    });
    const nameInput = reviewMount.querySelector<HTMLInputElement>('[data-role="world-name"]');
    nameInput?.addEventListener('input', () => { worldName = nameInput.value; });
    reviewMount.querySelector<HTMLButtonElement>('[data-action="copy-fix"]')?.addEventListener('click', () => {
      void navigator.clipboard.writeText(generateFixPrompt(issues))
        .then(() => toasts.success('Fix prompt copied'))
        .catch(() => toasts.error('Could not copy to clipboard'));
    });
    reviewMount.querySelector<HTMLButtonElement>('[data-action="import"]')?.addEventListener('click', () => void runImport());
  }

  async function runImport(): Promise<void> {
    if (!parsed || importing) return;
    importing = true;
    const hadCreds = typeof parsed.world?.api_key === 'string' && parsed.world.api_key.trim().length > 0;
    renderReview(); // re-renders with the disabled button + progress bar
    const plan = buildPlan();
    const onProgress = (p: { done: number; total: number }) => {
      const el = reviewMount.querySelector<HTMLElement>('[data-role="import-progress"]');
      if (!el) return;
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 100;
      const fill = el.querySelector<HTMLElement>('.atlas-import-progress-fill');
      const label = el.querySelector<HTMLElement>('.atlas-import-progress-label');
      if (fill) fill.style.width = `${pct}%`;
      if (label) label.textContent = `writing ${p.done} / ${p.total}`;
    };
    try {
      if (mode === 'new') {
        const { applied } = await createWorldFromImportedData(plan, { name: worldName, onProgress });
        toasts.success(`Created "${plan.worldMeta?.name ?? 'world'}" — ${applied.created} element${applied.created === 1 ? '' : 's'}`);
        reportFailures(applied.failures.length, plan.report.droppedLinks.length);
        // The file carried API credentials — guide to the (separate, consent-gated) sync link.
        if (hadCreds) toasts.info('Imported as a local world. To sync it, use "make online" in settings.');
        clearLoaded();
        // New world is now active — refresh the export side.
        renderExport();
      } else {
        const applied = await importIntoActiveWorld(plan, { onProgress });
        const bits = [`${applied.created} created`];
        if (applied.updated) bits.push(`${applied.updated} updated`);
        if (plan.report.skipped) bits.push(`${plan.report.skipped} skipped`);
        toasts.success(`Imported — ${bits.join(', ')}`);
        reportFailures(applied.failures.length, plan.report.droppedLinks.length);
        clearLoaded();
        renderExport();
      }
    } catch (err) {
      console.error('[import] failed', err);
      toasts.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      importing = false;
      if (parsed) renderReview();
    }
  }

  function reportFailures(failures: number, droppedLinks: number): void {
    if (failures > 0) toasts.error(`${failures} element${failures === 1 ? '' : 's'} failed to write`);
    else if (droppedLinks > 0) toasts.info(`${droppedLinks} unresolved link${droppedLinks === 1 ? '' : 's'} dropped`);
  }

  // ---------------------------------------------------------------------------
  // Take out (export)
  // ---------------------------------------------------------------------------

  let includeCreds = true;

  function renderExport(): void {
    const aw = activeWorld();
    const store = getActiveStore();
    if (!aw || !store) {
      exportMount.innerHTML = `<p class="atlas-room-hint">Open a world to export it.</p>`;
      return;
    }
    // Count populated types from the in-memory cache.
    const counts = new Map<ElementType, number>();
    for (const e of activeElements()) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    const populated = ALL_ELEMENT_TYPES.filter(t => (counts.get(t) ?? 0) > 0);
    const isApiLinked = !!aw.meta?.id && getState().registry.worlds.find(w => w.id === aw.worldId)?.state === 'api-linked';

    if (populated.length === 0) {
      exportMount.innerHTML = `<p class="atlas-room-hint">This world has no elements yet — nothing to export.</p>`;
      return;
    }

    exportMount.innerHTML = `
      <p class="atlas-share-section-hint">Download <b>${escapeText(aw.meta?.name ?? 'this world')}</b> as an ow.com-compatible JSON. Untick types to export a subset.</p>
      <div class="atlas-import-types">
        ${populated.map(t => `
          <label class="atlas-import-type">
            <input type="checkbox" value="${t}" checked />
            <span>${escapeText(ELEMENT_LABELS[t]?.plural ?? t)}</span>
            <span class="atlas-import-type-count">${counts.get(t)}</span>
          </label>
        `).join('')}
      </div>
      ${isApiLinked ? `
        <label class="atlas-import-check">
          <input type="checkbox" data-role="creds" ${includeCreds ? 'checked' : ''}/>
          <span>Include API key (needed to re-upload to onlyworlds.com)</span>
        </label>
      ` : ''}
      <div class="atlas-import-export-actions">
        <button type="button" class="atlas-btn-primary" data-action="export">Save to file</button>
        <button type="button" class="atlas-btn-ghost" data-action="copy-json">Copy JSON</button>
      </div>
    `;

    const credsBox = exportMount.querySelector<HTMLInputElement>('[data-role="creds"]');
    credsBox?.addEventListener('change', () => { includeCreds = credsBox.checked; });
    const exportBtn = exportMount.querySelector<HTMLButtonElement>('[data-action="export"]')!;
    const copyJsonBtn = exportMount.querySelector<HTMLButtonElement>('[data-action="copy-json"]')!;
    const updateBtnLabel = () => {
      const all = exportMount.querySelectorAll<HTMLInputElement>('.atlas-import-type input');
      const checked = Array.from(all).filter(c => c.checked).length;
      const suffix = checked === all.length ? '' : ` ${checked} type${checked === 1 ? '' : 's'}`;
      exportBtn.textContent = checked === all.length ? 'Save to file' : `Save${suffix} to file`;
      copyJsonBtn.textContent = checked === all.length ? 'Copy JSON' : `Copy${suffix} as JSON`;
      exportBtn.disabled = checked === 0;
      copyJsonBtn.disabled = checked === 0;
    };
    exportMount.querySelectorAll<HTMLInputElement>('.atlas-import-type input').forEach(c =>
      c.addEventListener('change', updateBtnLabel));
    exportBtn.addEventListener('click', () => void runExport());
    copyJsonBtn.addEventListener('click', () => void runCopyJson());
  }

  async function runExport(): Promise<void> {
    const store = getActiveStore();
    const aw = activeWorld();
    if (!store || !aw) return;
    const checked = Array.from(exportMount.querySelectorAll<HTMLInputElement>('.atlas-import-type input'))
      .filter(c => c.checked).map(c => c.value as ElementType);
    const all = exportMount.querySelectorAll('.atlas-import-type input').length;
    try {
      const data = await buildWorldExport(store, {
        includeCredentials: includeCreds,
        types: checked.length === all ? undefined : new Set(checked),
      });
      const slug = (aw.meta?.name ?? 'world').replace(/[^a-z0-9]+/gi, '_').toLowerCase().replace(/^_+|_+$/g, '') || 'world';
      const date = new Date().toISOString().slice(0, 10);
      downloadJson(data, `onlyworlds_${slug}_${date}.json`);
      const n = checked.reduce((sum, t) => sum + (activeElements().filter(e => e.type === t).length), 0);
      toasts.success(`Exported ${n} element${n === 1 ? '' : 's'}`);
    } catch (err) {
      console.error('[export] failed', err);
      toasts.error('Export failed');
    }
  }

  /** IE4: the clipboard twin of runExport — same subset, same shape, no download. */
  async function runCopyJson(): Promise<void> {
    const store = getActiveStore();
    const aw = activeWorld();
    if (!store || !aw) return;
    const checked = Array.from(exportMount.querySelectorAll<HTMLInputElement>('.atlas-import-type input'))
      .filter(c => c.checked).map(c => c.value as ElementType);
    const all = exportMount.querySelectorAll('.atlas-import-type input').length;
    try {
      const data = await buildWorldExport(store, {
        includeCredentials: includeCreds,
        types: checked.length === all ? undefined : new Set(checked),
      });
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      const n = checked.reduce((sum, t) => sum + (activeElements().filter(e => e.type === t).length), 0);
      toasts.success(`Copied ${n} element${n === 1 ? '' : 's'} as JSON`);
    } catch (err) {
      console.error('[export] copy failed', err);
      toasts.error('Could not copy to clipboard');
    }
  }

  // ---- wire static controls -------------------------------------------------

  dropEl.addEventListener('dragover', e => { e.preventDefault(); dropEl.classList.add('is-over'); });
  dropEl.addEventListener('dragleave', () => dropEl.classList.remove('is-over'));
  dropEl.addEventListener('drop', e => {
    e.preventDefault();
    dropEl.classList.remove('is-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) void file.text().then(t => ingest(t, 'The dropped file'));
  });
  dropEl.addEventListener('click', () => fileInput.click());
  dropEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void file.text().then(t => ingest(t, 'The chosen file'));
    fileInput.value = '';
  });
  root.querySelector<HTMLButtonElement>('[data-action="load"]')!.addEventListener('click', () => {
    const text = pasteEl.value.trim();
    if (!text) { pasteEl.focus(); return; }
    ingest(text, 'The pasted text');
  });
  clearBtn.addEventListener('click', clearLoaded);

  // ---- react to world switches (room persists across them) -------------------
  let lastWorldId = activeWorld()?.worldId ?? null;
  let lastElementsRef: readonly Element[] | null = activeElements();
  const unsub = subscribe(() => {
    const wid = activeWorld()?.worldId ?? null;
    const elsRef = activeElements();
    const worldChanged = wid !== lastWorldId;
    const elsChanged = elsRef !== lastElementsRef;
    if (worldChanged) { lastWorldId = wid; renderExport(); if (parsed) renderReview(); }
    else if (elsChanged) {
      lastElementsRef = elsRef;
      renderExport();
      if (parsed && mode === 'merge') renderReview();
    }
  });

  renderExport();

  return () => unsub();
}

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
