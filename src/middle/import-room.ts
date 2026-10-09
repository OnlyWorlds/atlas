/**
 * Import & export room (DESIGN_IMPORT.md). One scrolling panel, two halves:
 *
 *   Bring in  — drop / paste / pick OnlyWorlds JSON → live review (format,
 *               counts, target world, validation + copy-fix-prompt, conflicts)
 *               → import. Full-world JSON defaults to a NEW world; loose lists
 *               (or "merge" mode) reconcile into the current world.
 *   Take out  — export the current world (or a by-type subset) as the
 *               onlyworlds.com world export (the keel envelope, S354).
 *
 * The reconcile core (parse → validate → reconcile → ImportPlan) is pure and
 * lives in src/import/; this room is its surface. Mode A writes a new world
 * folder; Mode B merges into the active world (convention #81-85).
 */

import { isAtlasOnlyStorage } from '../core/browser-worlds';
import { getActiveStore } from '../core/active-store';
import { ELEMENT_ICONS, ELEMENT_LABELS, SPATIAL_TYPES } from '../core/constants';
import { escapeText } from '../core/dom-utils';
import { getState, patchSlice, subscribe } from '../core/state';
import { hasFolderMode } from '../core/capabilities';
import { requestPersistOnFirstBrowserWorld } from '../setup/world-parent';
import { parseHash } from '../core/router';
import { ALL_ELEMENT_TYPES, type Element, type ElementType, type PerElementFailure } from '../core/types';
import { completeWaypoint } from '../core/waypoints';
import { sectionsFor } from '../editor/field-schema';
import { buildWorldExport } from '../import/export-world';
import { parsePayload } from '../import/parse';
import { reconcile } from '../import/reconcile';
import type { ImportPlan, ParseResult, ValidationIssue } from '../import/types';
import { generateFixPrompt, validatePayload } from '../import/validate';
import { findWorldByOwIdentity, saveRegistry, updateWorldEntry } from '../registry/registry';
import {
  createWorldFromImportedData,
  importIntoActiveWorld,
} from '../setup/atlas-root-flow';
import { activateWorld } from '../sidebar/worlds-sidebar';
import { ToastManager } from '../ui/toast-manager';
import { detailsContext, showProblem } from '../ui/problem-fixes';
import { buildFailureDetails } from '../core/problems';
import { PlainError } from '../core/plain-error';
import { isWorldFile, openWorldFileFrom } from '../ui/open-world-file';
import { downloadWorldFromClick } from '../ui/download-world';
import { filesWhereOf } from '../core/browser-worlds';

type Mode = 'new' | 'merge';

/**
 * Where the ways to convert notes with an AI are written up (1.20: the
 * Captain asked for the AI docs page, not the toolkit repo; h20 #2081).
 */
const OW_AI_DOCS_URL = 'https://onlyworlds.github.io';

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
    '- Convert only what the notes say: add no people, places, events or details that are not in them.',
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

/**
 * Where a JSON.parse failure sits, as " near line 3, column 14", or "" when
 * the browser did not say (S369). Only the position is read out of the
 * engine's message (V8: "at position N", newer V8 also "(line L column C)";
 * Firefox: "at line L column C"); the message itself is never shown, since
 * its wording differs by browser and quotes the user's text.
 */
export function jsonErrorWhere(text: string, err: unknown): string {
  const raw = err instanceof SyntaxError ? err.message : '';
  const lc = /line (\d+) column (\d+)/i.exec(raw);
  if (lc) return ` near line ${lc[1]}, column ${lc[2]}`;
  const p = /position (\d+)/i.exec(raw);
  if (!p) return '';
  const pos = Math.min(Number(p[1]), text.length);
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const column = pos - before.lastIndexOf('\n');
  return ` near line ${line}, column ${column}`;
}

/** The clipboard refused a write (no focus, or the permission is off). */
export const CLIPBOARD_BLOCKED = 'The browser did not let Atlas use the clipboard. Click in the page, then try again.';

/** Rough token estimate for the size hint (chars/4 is close enough for UI). */
function estimateTokens(s: string): number {
  return Math.round(s.length / 4);
}

/**
 * A loaded payload carried across a WORLD switch (S364 gate lens C C5). Since
 * S364 the room remounts per world (DESIGN conv. 109); "load a file, then
 * click the world to merge it into" is the flow the S256 room-stable switch
 * kept on purpose, so the payload rides across and the review re-renders for
 * the new world. Leaving for another ROOM still drops it, as it always did.
 */
let carriedPayload: { text: string; sourceLabel: string; pasted: boolean } | null = null;

export function mountImportRoom(target: HTMLElement, toasts: ToastManager): () => void {
  // The folder half of the AI story (S365): only where it is true, a real
  // folder (not a world in browser storage, which no other program can reach).
  const activeId = getState().active?.worldId;
  const inBrowser = isAtlasOnlyStorage(getState().registry.worlds.find(w => w.id === activeId));
  const agentLine = hasFolderMode() && !inBrowser
    ? '<p class="atlas-import-ai-note">Or let an AI assistant edit this world\'s folder directly: Atlas shows its changes when you come back to this window.</p>'
    : '';
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-import-room';
  target.appendChild(root);

  root.innerHTML = `
    <header class="atlas-room-header">
      <h1>Data</h1>
      <p class="atlas-room-subtitle">Take your world out as an OnlyWorlds file, or bring in anything in the OnlyWorlds format, whatever made it.</p>
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
        <p class="atlas-import-lead">Anything in the OnlyWorlds format comes in here: a world from onlyworlds.com, a world file Atlas saved (.zip), loose elements, or JSON an AI assistant made from your notes. Drop it or paste it; you review it before it lands.</p>
        <div class="atlas-import-ai">
          <p class="atlas-import-ai-lead">Notes not in the format yet? <button type="button" class="atlas-btn-link" data-action="convert-prompt">Copy our prompt</button> and give it to an AI assistant with your notes, then paste the JSON it returns below. The prompt carries every field (~${Math.max(1, Math.round(estimateTokens(buildConvertNotesPrompt()) / 1000))}k tokens) and asks the assistant to add nothing your notes do not say. <a class="atlas-btn-link" href="${OW_AI_DOCS_URL}" target="_blank" rel="noopener">More ways to convert</a>.</p>
          ${agentLine}
        </div>
        <div class="atlas-import-drop" data-role="drop" tabindex="0" title="drop or click to choose a .json file, or a world file Atlas saved (.zip)">
          <span class="material-symbols-outlined">place_item</span>
          <p>drop a world or elements <b>.json</b>, or a world file <b>.zip</b>, here</p>
          <span class="atlas-import-drop-sub">or click to choose a file</span>
          <input type="file" accept="application/json,.json,.zip,application/zip" data-role="file" hidden />
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

  let lastIngest: { text: string; sourceLabel: string; pasted: boolean } | null = null;
  function ingest(text: string, sourceLabel: string): void {
    lastIngest = { text, sourceLabel, pasted: sourceLabel === 'The pasted text' };
    errorEl.hidden = true;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      showError(`${sourceLabel} isn't valid JSON${jsonErrorWhere(text, err)}. Check for a missing comma, quote, or bracket.`);
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
    lastIngest = null;
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
      setLive('invalid', `Not valid JSON${jsonErrorWhere(text, err)}. Check for a missing comma, quote, or bracket.`);
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
    const sameWorld = mode === 'merge' && !!activeWorld() && idMatchWorld()?.id === activeWorld()!.worldId;
    const plan = reconcile(parsed!, existing, { onConflict: conflict, matchByName: true, sameWorld });
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
          <p class="atlas-import-subnote is-warn"><span class="material-symbols-outlined">visibility</span> ${escapeText(mergeTargetName)} is view-only. Nothing can be written into it, so import as a separate copy instead.</p>
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
      // Clipboard failures never go through showProblem: a clipboard
      // NotAllowedError would read as a folder permission problem.
      void navigator.clipboard.writeText(generateFixPrompt(issues))
        .then(() => toasts.success('Fix prompt copied'))
        .catch(() => toasts.error(CLIPBOARD_BLOCKED));
    });
    reviewMount.querySelector<HTMLButtonElement>('[data-action="import"]')?.addEventListener('click', () => void runImport());
  }

  async function runImport(): Promise<void> {
    if (!parsed || importing) return;
    // Import as new asks where the world lives first, as its own small step
    // (1.17, conv. 129; lens C R2-d): before `importing` is set, so a Cancel
    // leaves the review as it was.
    let where: 'folder' | 'browser' = 'browser';
    if (mode === 'new') {
      // Without the folder picker the answer is this browser: ask the browser
      // to keep worlds before the first await (contract §2.3; S376 gate B6).
      if (!hasFolderMode()) requestPersistOnFirstBrowserWorld(line => toasts.info(line, 10_000));
      const { askWhere } = await import('../ui/where-choice');
      const asked = await askWhere({
        title: 'Import as a new world',
        action: 'Import',
        purpose: 'Importing as a new world makes a new world folder.',
        toasts,
      });
      if (!asked || !parsed || importing) return;
      where = asked;
    }
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
        const { applied } = await createWorldFromImportedData(plan, { name: worldName, onProgress, adoptWorldId, where });
        toasts.success(`Created "${plan.worldMeta?.name ?? 'world'}" · ${applied.created} element${applied.created === 1 ? '' : 's'}`);
        reportFailures(applied.failures, plan.report.droppedLinks.length);
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
        if (!targetId) throw new PlainError('No world is open to import into. Open one from the sidebar, or import as a new world.');
        const targetName = idMatch?.name ?? activeWorld()?.meta?.name ?? 'world';
        // Fail fast on a view-only target (the UI disables the button, but the
        // room can be driven by keyboard/state races — one clear message beats
        // N per-element write failures).
        const targetEntry = getState().registry.worlds.find(w => w.id === targetId);
        if (targetEntry?.api?.read_only === true) {
          throw new PlainError(`"${targetName}" is view-only. Import as a separate copy instead.`);
        }
        if (targetId !== activeWorld()?.worldId) {
          const ok = await activateWorld(targetId, toasts);
          if (!ok) throw new PlainError(`Atlas could not open "${targetName}", so nothing was imported.`);
        }
        const plan = buildPlan(); // existing = the now-active target's elements
        const applied = await importIntoActiveWorld(plan, { onProgress });
        const bits = [`${applied.created} created`];
        if (applied.updated) bits.push(`${applied.updated} updated`);
        if (plan.report.skipped) bits.push(`${plan.report.skipped} skipped`);
        toasts.success(`Merged into ${targetName} · ${bits.join(', ')}`);
        reportFailures(applied.failures, plan.report.droppedLinks.length);
        if (reviewMount.isConnected && stillMine()) { clearLoaded(); renderExport(); }
      }
      // Waypoint (hookmap wp7): the import BUTTON gesture is the waypoint —
      // ungated (portability class). The imported DATA completes nothing.
      completeWaypoint('import');
    } catch (err) {
      console.error('[import] failed', err);
      // No retry button: a half-finished import run again could duplicate.
      showProblem(err, { doing: 'importing', toasts });
    } finally {
      importing = false;
      if (parsed) renderReview();
    }
  }

  function reportFailures(failures: readonly PerElementFailure[], droppedLinks: number): void {
    const n = failures.length;
    if (n > 0) {
      // The per-element reasons ride in the Details block (scrubbed: no names).
      toasts.show(
        `${n} element${n === 1 ? '' : 's'} could not be saved to the world, so ${n === 1 ? 'it was' : 'they were'} left out. The rest were imported.`,
        'error',
        8000,
        { details: buildFailureDetails(failures, { ...detailsContext(), doing: 'importing' }) },
      );
    } else if (droppedLinks > 0) toasts.info(`${droppedLinks} unresolved link${droppedLinks === 1 ? '' : 's'} dropped`);
  }

  // ---------------------------------------------------------------------------
  // Take out (export)
  // ---------------------------------------------------------------------------

  // No API key in an export (S362). The box that offered it was on by default
  // and said the key was "needed to re-upload to onlyworlds.com": keel's import
  // never reads it and atlas's import drops it, while a prefixed write key reads
  // a private world with no PIN, so a shared file or a pasted "Copy JSON" was a
  // read pass for the whole world. Linking goes through Make Online.
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

    // Where the world's files are decides what "the full copy" is (1.17,
    // contract §5.1): the folder, or the one-file download of a browser world.
    const outEntry = getState().registry.worlds.find(w => w.id === aw.worldId);
    const outInBrowser = filesWhereOf(outEntry) === 'browser';
    const outWholeFile = outInBrowser && outEntry?.demo !== true;
    exportMount.innerHTML = `
      <p class="atlas-share-section-hint">Download <b>${escapeText(aw.meta?.name ?? 'this world')}</b> as an onlyworlds.com world export, the same file the site downloads. Untick types to export a subset.</p>
      <p class="atlas-share-section-hint">${outInBrowser
        ? (outWholeFile
          ? "The file holds the world's elements. Pages, aliases, saved charts, notes, writing formatting and images stay in this browser. Download the whole world keeps all of it in one file."
          // The tour world has no whole-world download (S376 lens C C15).
          : "The file holds the world's elements. Pages, aliases, saved charts, notes, writing formatting and images stay with the tour world. Keep it at the end of the tour to download it whole.")
        : "The file holds the world's elements. Pages, aliases, saved charts, notes, writing formatting and images kept in the folder stay in your world folder, which is the full copy of your world."}</p>
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
      <div class="atlas-import-export-actions">
        <button type="button" class="atlas-btn-primary" data-action="export">Save to file</button>
        <button type="button" class="atlas-btn-ghost" data-action="copy-json">Copy JSON</button>
        ${outWholeFile ? '<button type="button" class="atlas-btn-ghost" data-action="download-whole">Download the whole world</button>' : ''}
      </div>
    `;
    const wholeBtn = exportMount.querySelector<HTMLButtonElement>('[data-action="download-whole"]');
    wholeBtn?.addEventListener('click', () => {
      const w = getState().registry.worlds.find(x => x.id === aw.worldId);
      if (w) void downloadWorldFromClick(w, toasts, on => { wholeBtn.disabled = on; wholeBtn.textContent = on ? 'Saving…' : 'Download the whole world'; });
    });

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
                types: checked.length === all ? undefined : new Set(checked),
      });
      const slug = (aw.meta?.name ?? 'world').replace(/[^a-z0-9]+/gi, '_').toLowerCase().replace(/^_+|_+$/g, '') || 'world';
      const date = new Date().toISOString().slice(0, 10);
      downloadJson(data, `onlyworlds_${slug}_${date}.json`);
      // A whole-world export is a copy of its elements outside this browser:
      // the keep-safe card goes to its reduced form (1.17, contract §6.1).
      if (checked.length === all) {
        const next = updateWorldEntry(getState().registry, aw.worldId, { kept_export_at: new Date().toISOString() });
        saveRegistry(next);
        patchSlice('registry', next);
        completeWaypoint('keep-copy', { toast: 'Your world has a copy of its own.' });
      }
      const n = checked.reduce((sum, t) => sum + (activeElements().filter(e => e.type === t).length), 0);
      toasts.success(`Exported ${n} element${n === 1 ? '' : 's'}`);
    } catch (err) {
      console.error('[export] failed', err);
      // Safe to run again: it only reads the world and offers the file.
      showProblem(err, { doing: 'exporting this world', retry: () => runExport(), toasts });
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
    // Reading the world and writing the clipboard fail for different reasons,
    // and a clipboard refusal must not be worded as a folder problem.
    let data: Awaited<ReturnType<typeof buildWorldExport>>;
    try {
      data = await buildWorldExport(store, {
                types: checked.length === all ? undefined : new Set(checked),
      });
    } catch (err) {
      console.error('[export] copy failed', err);
      showProblem(err, { doing: 'exporting this world', retry: () => runCopyJson(), toasts });
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[export] copy failed', err);
      toasts.error(CLIPBOARD_BLOCKED);
      return;
    }
    const n = checked.reduce((sum, t) => sum + (activeElements().filter(e => e.type === t).length), 0);
    toasts.success(`Copied ${n} element${n === 1 ? '' : 's'} as JSON`);
  }

  // ---- wire static controls -------------------------------------------------

  dropEl.addEventListener('dragover', e => { e.preventDefault(); dropEl.classList.add('is-over'); });
  dropEl.addEventListener('dragleave', () => dropEl.classList.remove('is-over'));
  dropEl.addEventListener('drop', e => {
    e.preventDefault();
    dropEl.classList.remove('is-over');
    const file = e.dataTransfer?.files?.[0];
    // A world file opens as its own world (1.17, contract §5.2), never merged in.
    if (file && isWorldFile(file)) { requestPersistOnFirstBrowserWorld(line => toasts.info(line, 10_000)); void openWorldFileFrom(file, toasts); return; }
    if (file) void file.text().then(t => ingest(t, 'The dropped file'), err => { console.error('[import] file read failed', err); showProblem(err, { doing: 'reading the dropped file', folder: 'picked', toasts }); });
  });
  dropEl.addEventListener('click', () => fileInput.click());
  dropEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file && isWorldFile(file)) { requestPersistOnFirstBrowserWorld(line => toasts.info(line, 10_000)); void openWorldFileFrom(file, toasts); fileInput.value = ''; return; }
    if (file) void file.text().then(t => ingest(t, 'The chosen file'), err => { console.error('[import] file read failed', err); showProblem(err, { doing: 'reading the chosen file', folder: 'picked', toasts }); });
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
      .catch(() => toasts.error(CLIPBOARD_BLOCKED));
  });
  root.querySelector<HTMLButtonElement>('[data-action="example-download"]')!.addEventListener('click', () => {
    downloadText(EXAMPLE_JSON, 'onlyworlds_example.json');
    completeWaypoint('import');
  });

  // D8: the convert-my-notes prompt for an AI assistant.
  root.querySelector<HTMLButtonElement>('[data-action="convert-prompt"]')!.addEventListener('click', () => {
    void navigator.clipboard.writeText(buildConvertNotesPrompt())
      .then(() => toasts.success('Convert-notes prompt copied'))
      .catch(() => toasts.error(CLIPBOARD_BLOCKED));
  });

  // ---- react to element changes (a world switch remounts the room since S364, conv. 109; the payload is carried) ----
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

  if (carriedPayload) {
    const c = carriedPayload;
    carriedPayload = null;
    if (c.pasted) { pasteEl.value = c.text; autoGrow(); }
    ingest(c.text, c.sourceLabel);
  }

  return () => {
    unsub();
    // Still on the Data room's route = a world switch: carry the payload.
    carriedPayload = parsed && lastIngest && !importing && parseHash(window.location.hash).mode === 'import'
      ? lastIngest
      : null;
  };
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
