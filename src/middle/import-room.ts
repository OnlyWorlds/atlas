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
import { ELEMENT_LABELS, ELEMENT_ICONS, SPATIAL_TYPES } from '../core/constants';
import { sectionsFor } from '../editor/field-schema';
import { parsePayload } from '../import/parse';
import { validatePayload, generateFixPrompt } from '../import/validate';
import { reconcile } from '../import/reconcile';
import { buildWorldExport } from '../import/export-world';
import {
  createWorldFromImportedData,
  importIntoActiveWorld,
} from '../setup/atlas-root-flow';
import { activateWorld } from '../sidebar/worlds-sidebar';
import { findWorldByOwIdentity } from '../registry/registry';
import type { ParseResult, ImportPlan, ValidationIssue } from '../import/types';
import { ToastManager } from '../ui/toast-manager';
import { completeWaypoint } from '../core/waypoints';

type Mode = 'new' | 'merge';

/** The OnlyWorlds AI toolkit — teaches an assistant the schema + naming rules. */
const OW_TOOLKIT_URL = 'https://onlyworlds.github.io';

/**
 * IE7: a minimal valid full-world export. Doubles as format documentation —
 * a World block plus a few element arrays, with a name-based relation
 * (`birthplace` → the Location by name) to show how links resolve on import.
 */
const EXAMPLE_JSON = `{
  "World": {
    "name": "Example World",
    "description": "A tiny world showing the OnlyWorlds import format."
  },
  "Character": [
    { "name": "Ada the Cartographer", "birthplace": "Old Harbor" },
    { "name": "Bram Quill" }
  ],
  "Location": [
    { "name": "Old Harbor", "description": "A fog-wrapped port town." }
  ],
  "Object": [
    { "name": "The Brass Astrolabe" }
  ]
}
`;

/**
 * The full field whitelist, generated from the SDK FIELD_SCHEMA at runtime so
 * the prompt is schema-true forever — no URL for the assistant to (fail to)
 * fetch, no drift (S264; the schema-less prompt invited hallucinated fields
 * like Character.age, the toolkit's top import-failure class).
 * Grammar: bare = text · #field = number · field>Type = single link (value:
 * the target's name) · field>>Type = list of links.
 */
export function buildSchemaDigest(): string {
  const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
  const lines: string[] = [];
  for (const type of ALL_ELEMENT_TYPES) {
    const fields: string[] = [];
    const seen = new Set<string>();
    for (const section of sectionsFor(type)) {
      for (const f of section.fields) {
        if (f.name === 'name' || f.name.startsWith('atlas_') || seen.has(f.name)) continue;
        seen.add(f.name);
        if (f.widget === 'number') fields.push(`#${f.name}`);
        else if (f.widget === 'single-link') fields.push(`${f.name}>${cap(f.target ?? 'element')}`);
        else if (f.widget === 'multi-link') fields.push(`${f.name}>>${cap(f.target ?? 'element')}`);
        else fields.push(f.name);
      }
    }
    lines.push(`${cap(type)}: ${fields.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * D8: a copyable prompt that teaches any AI assistant to convert freeform notes
 * into OnlyWorlds import JSON. Sibling to validate.ts's fix-prompt — same idea,
 * pointed at creation rather than repair. Carries the FULL generated field
 * whitelist (S264) so the assistant never needs a schema lookup; key rules
 * adapted from the OnlyWorlds toolkit's parsing skill.
 */
export function buildConvertNotesPrompt(): string {
  return [
    'I have freeform worldbuilding notes I want to import into OnlyWorlds. Convert them into a single JSON object in this shape:',
    '',
    '- Top-level keys are element types in PascalCase, each holding an array of elements.',
    '- Every element needs a "name" (a non-empty string). Everything else is optional: sparse is valid.',
    '- Only the fields listed below exist. Do not invent field names (no Character.age, no Object.owner). A detail that deserves its own field can be a custom field prefixed x_ (like "x_mood": "grim"); when unsure, put it in "description".',
    '- Field grammar in the list: a bare field is text · #field is a number (dates are plain numbers in the world\'s own timeline) · field>Type is a single link, its value the target element\'s name · field>>Type is a list of links.',
    '- Only reference elements you also include. Prefer fields over tiny elements (physicality: "tall" beats a Trait named "Tall"). Only make elements for things specific to this world.',
    '- Optionally add a "World" block with "name" and "description" to make it a full world.',
    '',
    'Example of the shape (two elements, sparse on purpose; note the JSON keys are the bare field names, and the # and > marks below are list notation only):',
    '',
    '{"World": {"name": "Emberfall"}, "Character": [{"name": "Aralia", "birth_date": 312, "birthplace": "Vallaki", "friends": ["Bram"], "x_mood": "grim"}, {"name": "Bram"}], "Location": [{"name": "Vallaki", "description": "A walled river town."}]}',
    '',
    'The field list per type:',
    '',
    buildSchemaDigest(),
    '',
    'Return only the JSON, nothing else.',
    '',
    'My notes:',
    '<paste your notes here>',
  ].join('\n');
}

/** Rough token estimate for the size hint (chars/4 is close enough for UI). */
function estimateTokens(s: string): number {
  return Math.round(s.length / 4);
}

export function mountImportRoom(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-import-room';
  target.appendChild(root);

  root.innerHTML = `
    <header class="atlas-room-header">
      <h1>Data</h1>
      <p class="atlas-room-subtitle">Export your world as a complete file, or bring in OnlyWorlds-formatted data.</p>
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
        <p class="atlas-import-lead">Bring in a world exported from onlyworlds.com, or loose elements from an AI assistant. Drop a file or paste the JSON, then review before it lands.</p>
        <div class="atlas-import-drop" data-role="drop" tabindex="0" title="drop or click to choose a .json file">
          <span class="material-symbols-outlined">place_item</span>
          <p>drop a world or elements <b>.json</b> here</p>
          <span class="atlas-import-drop-sub">or click to choose a file</span>
          <input type="file" accept="application/json,.json" data-role="file" hidden />
        </div>
        <textarea class="atlas-import-paste" data-role="paste" rows="6"
          placeholder="…or paste OnlyWorlds JSON: a full world export, or loose element lists"></textarea>
        <p class="atlas-import-live" data-role="live" hidden></p>
        <div class="atlas-import-paste-actions">
          <button type="button" class="atlas-btn-ghost" data-action="load">load pasted JSON</button>
          <button type="button" class="atlas-btn-ghost" data-action="clear" hidden>clear</button>
          <span class="atlas-import-example">
            <button type="button" class="atlas-btn-link" data-action="example-copy">copy example JSON</button>
            <span class="atlas-import-example-sep">·</span>
            <button type="button" class="atlas-btn-link" data-action="example-download">download example.json</button>
          </span>
        </div>
        <p class="atlas-import-error" data-role="error" hidden></p>
        <div data-role="review"></div>
        <div class="atlas-import-ai">
          <span class="material-symbols-outlined">auto_awesome</span>
          <div class="atlas-import-ai-body">
            <p class="atlas-import-ai-lead">Bring notes from anywhere: any AI assistant can turn freeform notes into importable JSON.</p>
            <div class="atlas-import-ai-actions">
              <button type="button" class="atlas-btn-ghost" data-action="convert-prompt">copy the convert-my-notes prompt</button>
              <a class="atlas-btn-link" href="${OW_TOOLKIT_URL}" target="_blank" rel="noopener">open the OnlyWorlds AI toolkit</a>
            </div>
            <p class="atlas-import-ai-size">the prompt carries the full field list for every type · ~${Math.max(1, Math.round(estimateTokens(buildConvertNotesPrompt()) / 1000))}k tokens</p>
          </div>
        </div>
      </div>
      <div class="atlas-import-panel" data-panel="out" role="tabpanel" hidden>
        <div data-role="export"></div>
      </div>
    </div>
  `;

  const dropEl = root.querySelector<HTMLElement>('[data-role="drop"]')!;
  const fileInput = root.querySelector<HTMLInputElement>('[data-role="file"]')!;
  const pasteEl = root.querySelector<HTMLTextAreaElement>('[data-role="paste"]')!;
  const liveEl = root.querySelector<HTMLElement>('[data-role="live"]')!;
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

  /** The exported world's id, when the payload carries one (envelope only). */
  const exportWorldId = (): string | null => {
    const id = parsed?.world?.id;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  };
  /**
   * The local world (if any) that already carries the export's world id — via
   * the handle-key convention OR the api-link fields (see
   * `findWorldByOwIdentity`; checking only the handle key let re-importing an
   * api-linked world's own export fork its identity, S315 gate HIGH). The
   * match's presence turns the mode choice into merge-into-it vs
   * import-a-separate-copy (Captain, S313); its absence lets a new import
   * ADOPT the id (lossless).
   */
  const idMatchWorld = () => {
    const id = exportWorldId();
    if (!id) return null;
    return findWorldByOwIdentity(getState().registry, id) ?? null;
  };

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
      showError(`${sourceLabel} isn't valid JSON. Check for a missing comma, quote, or bracket.`);
      return;
    }
    const result = parsePayload(raw);
    if (!result.ok) {
      showError(result.error ?? 'Unrecognized format.');
      return;
    }
    parsed = result;
    clearBtn.hidden = false;
    liveEl.hidden = true; // the review summary now carries the format read-out
    // Default mode: a full world whose id already exists locally defaults to
    // MERGE (updating it is the usual intent on re-import); an unseen full world
    // → new; loose lists → merge into current.
    mode = result.format === 'full-world'
      ? (idMatchWorld() ? 'merge' : 'new')
      : 'merge';
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
    autoGrow();
    liveValidate();
  }

  // ---------------------------------------------------------------------------
  // Paste box: auto-grow (IE5) + debounced live validation (IE6)
  // ---------------------------------------------------------------------------

  /** Grow the textarea with its content up to a max, then scroll (IE5). */
  function autoGrow(): void {
    pasteEl.style.height = 'auto';
    const max = 340;
    const next = Math.min(pasteEl.scrollHeight, max);
    pasteEl.style.height = `${next}px`;
    pasteEl.style.overflowY = pasteEl.scrollHeight > max ? 'auto' : 'hidden';
  }

  /**
   * IE6: surface parse/shape validity on the box itself. Neutral when empty,
   * green when the text is JSON with a recognizable OW shape, red otherwise with
   * the most granular error inline. Reuses parsePayload — no new logic, and it
   * never auto-loads (the load button stays the explicit step).
   */
  function liveValidate(): void {
    const text = pasteEl.value.trim();
    pasteEl.classList.remove('is-valid', 'is-invalid');
    if (!text) { liveEl.hidden = true; liveEl.textContent = ''; return; }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      pasteEl.classList.add('is-invalid');
      const detail = err instanceof Error ? err.message : 'invalid JSON';
      setLive('invalid', `Not valid JSON: ${detail}.`);
      return;
    }
    const result = parsePayload(raw);
    if (!result.ok) {
      pasteEl.classList.add('is-invalid');
      setLive('invalid', result.error ?? 'No recognizable OnlyWorlds elements.');
      return;
    }
    pasteEl.classList.add('is-valid');
    const name = result.format === 'full-world' && typeof result.world?.name === 'string' && result.world.name.trim()
      ? ` "${result.world.name.trim()}"`
      : '';
    const kind = result.format === 'full-world' ? `Full world${name}` : 'Loose elements';
    setLive('valid', `${kind} · ${result.totalElements} element${result.totalElements === 1 ? '' : 's'}. Load to review.`);
  }

  function setLive(state: 'valid' | 'invalid', msg: string): void {
    liveEl.hidden = false;
    liveEl.className = `atlas-import-live is-${state}`;
    liveEl.textContent = msg;
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
    const idMatch = idMatchWorld();
    // The numeric preview is reconciled against the ACTIVE world's elements, so
    // it is only accurate when the merge target IS the active world. Merging
    // into a matched-but-not-open world opens it first (at import time), so here
    // we state intent instead of counts.
    const mergeTargetIsActive = idMatch ? idMatch.id === aw?.worldId : true;
    const mergeTargetName = idMatch ? idMatch.name : (aw?.meta?.name ?? 'the current world');
    // A view-only world blocks every store mutation at the seam, so a merge
    // into it would surface as N per-element write failures (S315 gate) —
    // say it once, up front, instead.
    const mergeTargetEntry = idMatch ?? getState().registry.worlds.find(w => w.id === aw?.worldId) ?? null;
    const mergeTargetViewOnly = mode === 'merge' && mergeTargetEntry?.api?.read_only === true;
    const accuratePreview = mode !== 'merge' || mergeTargetIsActive;
    const issues = validatePayload(parsed, mode === 'merge' && mergeTargetIsActive ? activeElements() : []);
    const plan = buildPlan();
    const r = plan.report;
    const typeCount = parsed.byType.size;

    const isFull = parsed.format === 'full-world';
    const canMerge = !!aw;
    // Loose with no active world is a dead end — guide the user.
    const looseBlocked = !isFull && !canMerge;
    const adopting = isFull && !!exportWorldId() && !idMatch;

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
          ${idMatch ? `
            <p class="atlas-import-warn"><span class="material-symbols-outlined">info</span> A world with this id already exists here as <b>${escapeText(idMatch.name)}</b>. Update it, or bring this in as a separate copy.</p>
          ` : ''}
          <div class="atlas-import-mode" data-role="mode">
            ${isFull ? (idMatch ? `
              <label class="atlas-import-radio"><input type="radio" name="imp-mode" value="merge" ${mode === 'merge' ? 'checked' : ''}/> <span>Merge into ${escapeText(idMatch.name)} (update the existing world)</span></label>
              <label class="atlas-import-radio"><input type="radio" name="imp-mode" value="new" ${mode === 'new' ? 'checked' : ''}/> <span>Import as a separate new world</span></label>
            ` : `
              <label class="atlas-import-radio"><input type="radio" name="imp-mode" value="new" ${mode === 'new' ? 'checked' : ''}/> <span>Import as a new world</span></label>
              ${canMerge ? `<label class="atlas-import-radio"><input type="radio" name="imp-mode" value="merge" ${mode === 'merge' ? 'checked' : ''}/> <span>Merge into ${escapeText(aw!.meta?.name ?? 'the current world')}</span></label>` : ''}
            `) : `
              <p class="atlas-import-mode-fixed">Merge into <b>${escapeText(aw!.meta?.name ?? 'the current world')}</b></p>
            `}
          </div>

          ${mode === 'new' ? `
            <label class="atlas-import-field">
              <span>New world name</span>
              <input type="text" class="atlas-import-name" data-role="world-name" value="${escapeText(worldName)}" />
            </label>
            ${adopting ? `<p class="atlas-import-subnote">Keeps its original world id, so it round-trips cleanly back to onlyworlds.com.</p>` : ''}
          ` : ''}

          ${mode === 'merge' && mergeTargetIsActive && r.updated + r.skipped > 0 ? `
            <div class="atlas-import-conflict" data-role="conflict">
              <span class="atlas-import-conflict-count">${r.updated + r.skipped} already exist${r.updated + r.skipped === 1 ? 's' : ''} in this world</span>
              <label class="atlas-import-radio"><input type="radio" name="imp-conflict" value="skip" ${conflict === 'skip' ? 'checked' : ''}/> <span>Keep mine (skip duplicates)</span></label>
              <label class="atlas-import-radio"><input type="radio" name="imp-conflict" value="overwrite" ${conflict === 'overwrite' ? 'checked' : ''}/> <span>Overwrite with imported</span></label>
            </div>
          ` : ''}

          ${renderValidation(issues)}

          ${accuratePreview ? `
          <div class="atlas-import-preview">
            <span class="atlas-import-stat"><b>${r.created}</b> create</span>
            ${r.updated ? `<span class="atlas-import-stat"><b>${r.updated}</b> update</span>` : ''}
            ${r.skipped ? `<span class="atlas-import-stat is-dim"><b>${r.skipped}</b> skip</span>` : ''}
            ${r.invalidRecords ? `<span class="atlas-import-stat is-warn"><b>${r.invalidRecords}</b> invalid</span>` : ''}
            ${r.droppedLinks.length ? `<span class="atlas-import-stat is-warn" title="Links to other elements not found in this import. The connection is dropped; each element is still created.">${r.droppedLinks.length} link${r.droppedLinks.length === 1 ? '' : 's'} dropped</span>` : ''}
          </div>
          ` : `
          <p class="atlas-import-subnote"><span class="material-symbols-outlined">info</span> Opens ${escapeText(mergeTargetName)} and merges these ${parsed.totalElements} element${parsed.totalElements === 1 ? '' : 's'} in. Existing elements are kept (choose overwrite once it's open to replace them).</p>
          `}

          ${mergeTargetViewOnly ? `
          <p class="atlas-import-subnote is-warn"><span class="material-symbols-outlined">visibility</span> ${escapeText(mergeTargetName)} is view-only — nothing can be written into it. Import as a separate copy instead.</p>
          ` : ''}
          <button type="button" class="atlas-btn-primary" data-action="import" ${importing || mergeTargetViewOnly ? 'disabled' : ''}>
            ${importing ? 'importing…' : (mode === 'new' ? 'create world' : `merge into ${escapeText(mergeTargetName)}`)}
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
          ${shown.map(i => `<li><code>${escapeText(i.path)}</code>: ${escapeText(i.issue)}</li>`).join('')}
          ${more > 0 ? `<li class="is-dim">+${more} more…</li>` : ''}
        </ul>
        <p class="atlas-import-issues-note">Import still runs; invalid entries are skipped and broken links removed. Paste the fix prompt to your AI to repair the source.</p>
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
    // The plan is (re)built inside each branch — a merge into a matched world
    // rebuilds it AFTER opening that world, so it reconciles against the right
    // element set.
    const onProgress = (p: { done: number; total: number }) => {
      const el = reviewMount.querySelector<HTMLElement>('[data-role="import-progress"]');
      if (!el) return;
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 100;
      const fill = el.querySelector<HTMLElement>('.atlas-import-progress-fill');
      const label = el.querySelector<HTMLElement>('.atlas-import-progress-label');
      if (fill) fill.style.width = `${pct}%`;
      if (label) label.textContent = `writing ${p.done} / ${p.total}`;
    };
    // If the user loads ANOTHER payload while this import is still writing,
    // the completion path below must not stomp their fresh review — `parsed`
    // identity is the guard (S315: the first import's clearLoaded() wiped a
    // second payload loaded mid-flight).
    const runParsed = parsed;
    const stillMine = () => parsed === runParsed;
    try {
      if (mode === 'new') {
        // Adopt the exported world id ONLY when nothing local already uses it —
        // otherwise a separate copy would collide with the existing world's
        // identity. The collision case chooses merge (below) or a fresh mint here.
        const eid = exportWorldId();
        const adoptWorldId = (parsed.format === 'full-world' && eid && !idMatchWorld()) ? eid : undefined;
        const plan = buildPlan();
        const { applied } = await createWorldFromImportedData(plan, { name: worldName, onProgress, adoptWorldId });
        toasts.success(`Created "${plan.worldMeta?.name ?? 'world'}" · ${applied.created} element${applied.created === 1 ? '' : 's'}`);
        reportFailures(applied.failures.length, plan.report.droppedLinks.length);
        // The file carried API credentials — guide to the (separate, consent-gated) sync link.
        if (hadCreds) toasts.info('Imported as a local world. To sync it, use "make online" in settings.');
        if (stillMine()) {
          clearLoaded();
          // New world is now active — refresh the export side.
          renderExport();
        }
      } else {
        // Merge target: the id-matched world, else the active world. Open the
        // match first if it isn't already active, so the reconcile runs against
        // ITS elements — activation navigates to it, so the import room may
        // unmount; guard the DOM touches afterward (toasts are global).
        const idMatch = idMatchWorld();
        const targetId = idMatch?.id ?? activeWorld()?.worldId ?? null;
        if (!targetId) throw new Error('No world to merge into');
        const targetName = idMatch?.name ?? activeWorld()?.meta?.name ?? 'world';
        // Fail fast on a view-only target (the UI disables the button, but the
        // room can be driven by keyboard/state races — one clear message beats
        // N per-element write failures).
        const targetEntry = getState().registry.worlds.find(w => w.id === targetId);
        if (targetEntry?.api?.read_only === true) {
          throw new Error(`"${targetName}" is view-only — import as a separate copy instead`);
        }
        if (targetId !== activeWorld()?.worldId) {
          const ok = await activateWorld(targetId, toasts);
          if (!ok) throw new Error(`Could not open "${targetName}" to merge into`);
        }
        const plan = buildPlan(); // existing = the now-active target's elements
        const applied = await importIntoActiveWorld(plan, { onProgress });
        const bits = [`${applied.created} created`];
        if (applied.updated) bits.push(`${applied.updated} updated`);
        if (plan.report.skipped) bits.push(`${plan.report.skipped} skipped`);
        toasts.success(`Merged into ${targetName} · ${bits.join(', ')}`);
        reportFailures(applied.failures.length, plan.report.droppedLinks.length);
        if (reviewMount.isConnected && stillMine()) { clearLoaded(); renderExport(); }
      }
      // Waypoint (hookmap wp7): the import BUTTON gesture is the waypoint —
      // ungated (portability class). The imported DATA completes nothing.
      completeWaypoint('import');
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
      exportMount.innerHTML = `<p class="atlas-room-hint">This world has no elements yet; nothing to export.</p>`;
      return;
    }

    const contentTypes = populated.filter(t => !SPATIAL_TYPES.has(t));
    const spatialTypes = populated.filter(t => SPATIAL_TYPES.has(t));
    const totalEls = populated.reduce((sum, t) => sum + (counts.get(t) ?? 0), 0);
    const typeRow = (t: ElementType) => `
      <label class="atlas-import-type-row">
        <span class="material-symbols-outlined atlas-import-type-icon">${escapeText(ELEMENT_ICONS[t] ?? 'category')}</span>
        <span class="atlas-import-type-name">${escapeText(ELEMENT_LABELS[t]?.plural ?? t)}</span>
        <span class="atlas-import-type-count">${counts.get(t)}</span>
        <input type="checkbox" value="${t}" checked />
      </label>`;

    exportMount.innerHTML = `
      <p class="atlas-share-section-hint">Download <b>${escapeText(aw.meta?.name ?? 'this world')}</b> as an ow.com-compatible JSON. Untick types to export a subset.</p>
      <div class="atlas-import-typelist">
        <label class="atlas-import-type-all">
          <input type="checkbox" data-role="all" checked />
          <span class="atlas-import-type-all-label">all types</span>
          <span class="atlas-import-type-all-count">${totalEls} element${totalEls === 1 ? '' : 's'}</span>
        </label>
        <div class="atlas-import-type-cols">
          <div class="atlas-import-type-col">
            ${contentTypes.map(typeRow).join('')}
          </div>
          <div class="atlas-import-type-col">
            ${spatialTypes.length ? spatialTypes.map(typeRow).join('') : '<p class="atlas-import-type-col-empty">no maps, pins, or zones yet</p>'}
          </div>
        </div>
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
    const allBox = exportMount.querySelector<HTMLInputElement>('[data-role="all"]')!;
    const exportBtn = exportMount.querySelector<HTMLButtonElement>('[data-action="export"]')!;
    const copyJsonBtn = exportMount.querySelector<HTMLButtonElement>('[data-action="copy-json"]')!;
    const updateBtnLabel = () => {
      const all = exportMount.querySelectorAll<HTMLInputElement>('.atlas-import-type-row input');
      const checked = Array.from(all).filter(c => c.checked).length;
      // Reflect the type-checkbox state on the all/none toggle.
      allBox.checked = checked === all.length;
      allBox.indeterminate = checked > 0 && checked < all.length;
      const suffix = checked === all.length ? '' : ` ${checked} type${checked === 1 ? '' : 's'}`;
      exportBtn.textContent = checked === all.length ? 'Save to file' : `Save${suffix} to file`;
      copyJsonBtn.textContent = checked === all.length ? 'Copy JSON' : `Copy${suffix} as JSON`;
      exportBtn.disabled = checked === 0;
      copyJsonBtn.disabled = checked === 0;
    };
    exportMount.querySelectorAll<HTMLInputElement>('.atlas-import-type-row input').forEach(c =>
      c.addEventListener('change', updateBtnLabel));
    allBox.addEventListener('change', () => {
      exportMount.querySelectorAll<HTMLInputElement>('.atlas-import-type-row input')
        .forEach(c => { c.checked = allBox.checked; });
      updateBtnLabel();
    });
    exportBtn.addEventListener('click', () => void runExport());
    copyJsonBtn.addEventListener('click', () => void runCopyJson());
  }

  async function runExport(): Promise<void> {
    const store = getActiveStore();
    const aw = activeWorld();
    if (!store || !aw) return;
    const checked = Array.from(exportMount.querySelectorAll<HTMLInputElement>('.atlas-import-type-row input'))
      .filter(c => c.checked).map(c => c.value as ElementType);
    const all = exportMount.querySelectorAll('.atlas-import-type-row input').length;
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
    const checked = Array.from(exportMount.querySelectorAll<HTMLInputElement>('.atlas-import-type-row input'))
      .filter(c => c.checked).map(c => c.value as ElementType);
    const all = exportMount.querySelectorAll('.atlas-import-type-row input').length;
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

  // Paste box grows with content; live validation runs on a 400ms debounce.
  let liveTimer: number | undefined;
  pasteEl.addEventListener('input', () => {
    autoGrow();
    window.clearTimeout(liveTimer);
    liveTimer = window.setTimeout(liveValidate, 400);
  });

  // IE7: example JSON as copy or download — doubles as format documentation.
  root.querySelector<HTMLButtonElement>('[data-action="example-copy"]')!.addEventListener('click', () => {
    void navigator.clipboard.writeText(EXAMPLE_JSON)
      .then(() => { toasts.success('Example JSON copied'); completeWaypoint('import'); })
      .catch(() => toasts.error('Could not copy to clipboard'));
  });
  root.querySelector<HTMLButtonElement>('[data-action="example-download"]')!.addEventListener('click', () => {
    downloadText(EXAMPLE_JSON, 'onlyworlds_example.json');
    completeWaypoint('import');
  });

  // D8: the convert-my-notes prompt for an AI assistant.
  root.querySelector<HTMLButtonElement>('[data-action="convert-prompt"]')!.addEventListener('click', () => {
    void navigator.clipboard.writeText(buildConvertNotesPrompt())
      .then(() => toasts.success('Convert-notes prompt copied'))
      .catch(() => toasts.error('Could not copy to clipboard'));
  });

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
  downloadText(JSON.stringify(data, null, 2), filename);
}

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
