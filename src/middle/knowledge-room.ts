/**
 * Knowledge room — author + manage knowledge entries (Narratives, subtype
 * 'knowledge') and inspect knowers (DESIGN_KNOWLEDGE.md, Track A).
 *
 * Views (URL is the source of truth; tab within the home view is ephemeral):
 *   - home   (`/knowledge`)             — [Entries | Knowers] tabs
 *   - draft  (`/knowledge/new`)         — a NEW entry; NOTHING persists to the
 *                                         world until "Create". Survives
 *                                         navigation via a per-world
 *                                         localStorage stash.
 *   - editor (`/knowledge/<id>`)        — edit a saved entry in place.
 *   - knower (`/knowledge/knower/<id>`) — the known-view: the world as a
 *                                         Character or Circle knows it.
 *
 * Prose is the embedded writing editor (K3): TipTap + @-mentions + chips +
 * autolink, lazy-loaded via `import('./knowledge-editor')` so TipTap stays
 * code-split. Mentions auto-populate the about-fields on save — with
 * `collectives` EXCLUDED (mention ≠ holdership, convention #68); the room
 * toasts once when a mentioned circle is dropped from the derive.
 *
 * Re-render discipline: views build once; same-view state ticks refresh only
 * chips + title + editor decorations — never the name input or editor mount
 * (focus/typing survive background sync).
 */

import { getState, subscribe } from '../core/state';
import { navigate, elementHash, knowledgeHash, knowledgeKnowerHash, parseHash, onHashChange } from '../core/router';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { escapeText } from '../core/dom-utils';
import {
  KNOWLEDGE_SUBTYPE, CIRCLE_SUBTYPE, listKnowledgeEntries, heldByOf, aboutIdsOf,
  ABOUT_FIELDS, aboutFieldFor, isKnowerType, listKnowers, knowledgeHeldBy, elementsKnownAboutBy,
  circleMembers,
} from '../core/knowledge';
import { computeRelationPatch, extractProseLinks } from './writing-workspace-derive';
import { ELEMENT_ICONS, ELEMENT_LABELS, KNOWLEDGE_DRAFT_STASH_PREFIX } from '../core/constants';
import { pickElement } from '../ui/element-picker-modal';
import { ElementCreateModal } from '../ui/element-create-modal';
import type { Element } from '../core/types';
import { ToastManager } from '../ui/toast-manager';
import type { JSONContent } from '@tiptap/core';
import type { KnowledgeEditorHandle } from './knowledge-editor';

/** Sentinel knowledgeId for the unsaved draft editor (`/knowledge/new`). */
const NEW = 'new';

interface Draft {
  name: string;
  story: string;
  richtextJson: JSONContent | null;
  narrator: string | null;
  collectives: string[];
  aboutIds: string[];
}

interface EditorCtx {
  heldBy(): { narrator: string | null; collectives: string[] };
  setNarrator(id: string | null): void;
  addCircle(id: string): void;
  removeCircle(id: string): void;
  aboutIds(): string[];
  addAbout(id: string): void;
  removeAbout(id: string): void;
}

// ---- draft persistence ------------------------------------------------------
// The unsaved draft survives navigation + reload via a per-world localStorage
// stash (same idiom as ui-prefs). Cleared on create or explicit cancel.

function draftStashKey(worldId: string): string {
  return `${KNOWLEDGE_DRAFT_STASH_PREFIX}${worldId}`;
}

function loadDraftStash(worldId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftStashKey(worldId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Draft>;
    return {
      name: typeof p.name === 'string' ? p.name : '',
      story: typeof p.story === 'string' ? p.story : '',
      richtextJson: p.richtextJson && typeof p.richtextJson === 'object' ? p.richtextJson : null,
      narrator: typeof p.narrator === 'string' ? p.narrator : null,
      collectives: Array.isArray(p.collectives)
        ? p.collectives.filter((x): x is string => typeof x === 'string') : [],
      aboutIds: Array.isArray(p.aboutIds)
        ? p.aboutIds.filter((x): x is string => typeof x === 'string') : [],
    };
  } catch {
    return null; // corrupted stash — start fresh
  }
}

function saveDraftStash(worldId: string, draft: Draft): void {
  try {
    localStorage.setItem(draftStashKey(worldId), JSON.stringify(draft));
  } catch {
    /* ignore quota */
  }
}

function clearDraftStash(worldId: string): void {
  try {
    localStorage.removeItem(draftStashKey(worldId));
  } catch {
    /* ignore */
  }
}

/**
 * Element ids derived from prose `ow://` links that are valid ABOUT subjects.
 * Excludes `collectives` (held-by channel) and non-subject types — same rule
 * the saved-entry derive applies (convention #68).
 */
function derivedAboutIds(markdown: string): string[] {
  if (!markdown) return [];
  const byType = extractProseLinks(markdown);
  const out: string[] = [];
  for (const [type, ids] of Object.entries(byType)) {
    if (!aboutFieldFor(type)) continue;
    out.push(...ids);
  }
  return out;
}

/** True iff the prose mentions at least one collective (for the holder toast). */
function proseMentionsCollective(markdown: string): boolean {
  if (!markdown) return false;
  return 'collective' in extractProseLinks(markdown);
}

export function mountKnowledgeRoom(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-knowledge-room';
  target.appendChild(root);

  let mountedView: string | null = null;       // 'list' | NEW | 'knower:<id>' | '<entryId>' | null
  let roomTab: 'entries' | 'knowers' = 'entries'; // ephemeral home-view tab
  let draft: Draft | null = null;
  let heldByMount: HTMLElement | null = null;
  let aboutMount: HTMLElement | null = null;

  // ---- prose editor session (K3) --------------------------------------------
  let editorMount: KnowledgeEditorHandle | null = null;
  let editorForId: string | null = null;       // entry id, or NEW for the draft
  let editorMountToken = 0;                    // staleness guard across the async import
  let lastSavedMarkdown: string | null = null;
  let pendingSaveTimer: number | null = null;
  let pendingSnapshot: { markdown: string; json: JSONContent } | null = null;
  let collectiveToastShown = false;            // once per editor session
  let lastDerivedKey = '';                     // draft about-chips refresh diff

  const wid = () => getState().active?.worldId ?? null;
  const elOf = (id: string): Element | undefined => getState().data.elements.find(e => e.id === id);
  /** Persist the in-memory draft to its per-world stash (no-op without world/draft). */
  const persistDraft = () => {
    const w = wid();
    if (w && draft) saveDraftStash(w, draft);
  };

  function maybeToastDroppedCollective(): void {
    if (collectiveToastShown) return;
    collectiveToastShown = true;
    toasts.info('Mentioning a circle doesn\'t make it a holder — add it under "Held by".');
  }

  // ---- writes ---------------------------------------------------------------

  async function patchEntry(id: string, patch: Record<string, unknown>): Promise<void> {
    const folder = getActiveStore();
    if (!folder) return;
    try {
      await folder.updateElement(id, patch as Partial<Element>);
      await refreshElementsAfterWrite(folder);
      requestPushIfLinked();
    } catch (err) {
      console.error('[knowledge-room] update failed', err);
      toasts.error('Could not update knowledge entry');
    }
  }

  /** Debounce window matches inline field edits (registry pref, default 1s). */
  function getSaveDebounceMs(): number {
    const ms = getState().registry.sync_debounce_ms;
    return typeof ms === 'number' && ms >= 200 ? ms : 1000;
  }

  function scheduleEditorSave(snap: { markdown: string; json: JSONContent }): void {
    pendingSnapshot = snap;
    if (pendingSaveTimer !== null) window.clearTimeout(pendingSaveTimer);
    pendingSaveTimer = window.setTimeout(() => {
      pendingSaveTimer = null;
      const s = pendingSnapshot;
      pendingSnapshot = null;
      if (s) void persistEditorSnapshot(s);
    }, getSaveDebounceMs());
  }

  async function flushPendingSave(): Promise<void> {
    if (pendingSaveTimer !== null) {
      window.clearTimeout(pendingSaveTimer);
      pendingSaveTimer = null;
    }
    if (pendingSnapshot) {
      const s = pendingSnapshot;
      pendingSnapshot = null;
      await persistEditorSnapshot(s);
    }
  }

  /**
   * Saved-entry prose save: story (markdown) + atlas_richtext_json + the
   * mention-derived about-fields — with `collectives` EXCLUDED (convention
   * #68: holders are wired only via the Held-by editor).
   */
  async function persistEditorSnapshot(snap: { markdown: string; json: JSONContent }): Promise<void> {
    const entryId = editorForId;
    if (!entryId || entryId === NEW) return;
    if (lastSavedMarkdown !== null && snap.markdown === lastSavedMarkdown) return;
    const el = elOf(entryId);
    if (!el) return;
    const relationPatch = computeRelationPatch(el, snap.markdown) as Record<string, unknown>;
    if ('collectives' in relationPatch) {
      delete relationPatch.collectives;
      maybeToastDroppedCollective();
    }
    await patchEntry(entryId, {
      story: snap.markdown,
      atlas_richtext_json: snap.json,
      ...relationPatch,
    });
    lastSavedMarkdown = snap.markdown;
  }

  function destroyEditorSession(): void {
    // Flush is async; initiate before teardown (persistEditorSnapshot reads
    // its inputs before the first await, so the in-flight write completes).
    void flushPendingSave();
    editorMount?.destroy();
    editorMount = null;
    editorForId = null;
    lastSavedMarkdown = null;
    collectiveToastShown = false;
    lastDerivedKey = '';
    editorMountToken++;
  }

  const onPageHide = (): void => {
    if (editorMount && editorForId && editorForId !== NEW && !pendingSnapshot) {
      const markdown = editorMount.getMarkdown();
      if (lastSavedMarkdown !== null && markdown !== lastSavedMarkdown) {
        pendingSnapshot = { markdown, json: editorMount.getJson() };
      }
    }
    void flushPendingSave();
  };
  window.addEventListener('pagehide', onPageHide);

  async function createFromDraft(nameEl: HTMLInputElement): Promise<void> {
    const worldId = wid();
    const folder = getActiveStore();
    if (!worldId || !folder || !draft) return;
    const data: Record<string, unknown> = {
      name: nameEl.value.trim() || 'untitled knowledge',
      subtype: KNOWLEDGE_SUBTYPE,
      story: draft.story,
      narrator: draft.narrator,
      collectives: draft.collectives,
    };
    if (draft.richtextJson) data.atlas_richtext_json = draft.richtextJson;
    // Subjects = manual picks ∪ prose-derived (collectives excluded), grouped
    // into their matching Involves fields.
    const allAbout = new Set<string>([...draft.aboutIds, ...derivedAboutIds(draft.story)]);
    for (const id of allAbout) {
      const t = elOf(id)?.type;
      const f = t ? aboutFieldFor(t) : null;
      if (!f) continue;
      (data[f] as string[] | undefined) ? (data[f] as string[]).push(id) : (data[f] = [id]);
    }
    try {
      const created = await folder.createElement('narrative', data as Partial<Element>);
      await refreshElementsAfterWrite(folder);
      requestPushIfLinked();
      draft = null;
      clearDraftStash(worldId);
      navigate(knowledgeHash(worldId, created.id));
    } catch (err) {
      console.error('[knowledge-room] create failed', err);
      toasts.error('Could not create knowledge entry');
    }
  }

  // ---- chips ----------------------------------------------------------------

  function elementChip(id: string, onRemove?: () => void, derived?: boolean): HTMLElement {
    const el = elOf(id);
    const worldId = wid();
    const chip = document.createElement('span');
    chip.className = 'atlas-knowledge-chip' + (derived ? ' is-derived' : '');
    const icon = el ? (ELEMENT_ICONS[el.type] ?? 'category') : 'help';
    const name = el?.name || '(unknown)';
    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'atlas-knowledge-chip-body';
    body.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span>${escapeText(name)}</span>`;
    if (el && worldId) {
      body.title = derived ? `${name} — mentioned in the text` : `Open ${name}`;
      body.addEventListener('click', () => navigate(elementHash(worldId, el.id)));
    } else {
      body.disabled = true;
    }
    chip.appendChild(body);
    if (onRemove) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'atlas-knowledge-chip-remove';
      rm.title = 'Remove';
      rm.innerHTML = `<span class="material-symbols-outlined">close</span>`;
      rm.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
      chip.appendChild(rm);
    }
    return chip;
  }

  function holderRow(
    label: string, hint: string, ids: string[], single: boolean, term: string,
    onAdd: () => void, onRemove?: (id: string) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'atlas-knowledge-holder-row';
    const head = document.createElement('div');
    head.className = 'atlas-knowledge-holder-head';
    head.innerHTML = `<span class="atlas-knowledge-holder-label">${escapeText(label)}</span>
      <span class="atlas-knowledge-holder-hint">${escapeText(hint)}</span>`;
    row.appendChild(head);
    const chips = document.createElement('div');
    chips.className = 'atlas-knowledge-chips';
    for (const id of ids) chips.appendChild(elementChip(id, onRemove ? () => onRemove(id) : undefined));
    if (!(single && ids.length > 0)) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'atlas-knowledge-add';
      add.textContent = single ? `+ set ${term}` : `+ add ${term}`;
      add.addEventListener('click', onAdd);
      chips.appendChild(add);
    }
    row.appendChild(chips);
    return row;
  }

  function renderHeldBy(container: HTMLElement, ctx: EditorCtx): void {
    container.innerHTML = '';
    const held = ctx.heldBy();
    container.appendChild(holderRow(
      'Character', 'one character who holds it', held.narrator ? [held.narrator] : [], true, 'character',
      async () => {
        const p = await pickElement({ restrictToType: 'character', title: 'Who knows this?' });
        if (p) ctx.setNarrator(p.id);
      },
      () => ctx.setNarrator(null),
    ));
    container.appendChild(holderRow(
      'Circles', 'groups whose members inherit it', held.collectives, false, 'circle',
      async () => {
        const p = await pickElement({ restrictToType: 'collective', excludeIds: held.collectives, title: 'Add a circle' });
        if (p) ctx.addCircle(p.id);
      },
      (id) => ctx.removeCircle(id),
    ));
  }

  /**
   * About chips. Manual subjects are removable; in DRAFT mode, prose-derived
   * ids that aren't manual yet render as non-removable "from the text" chips
   * (they merge into the fields at create). For saved entries the derive has
   * already unioned prose mentions into the fields, so `ctx.aboutIds()` covers
   * everything.
   */
  function renderAbout(container: HTMLElement, ctx: EditorCtx, derivedExtra?: string[]): void {
    container.innerHTML = '';
    const ids = ctx.aboutIds();
    const chips = document.createElement('div');
    chips.className = 'atlas-knowledge-chips';
    for (const id of ids) chips.appendChild(elementChip(id, () => ctx.removeAbout(id)));
    if (derivedExtra) {
      for (const id of derivedExtra) {
        if (ids.includes(id)) continue;
        chips.appendChild(elementChip(id, undefined, true));
      }
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'atlas-knowledge-add';
    add.textContent = '+ add subject';
    add.addEventListener('click', async () => {
      const p = await pickElement({ title: 'What is this knowledge about?', excludeIds: ctx.aboutIds() });
      if (!p) return;
      if (p.type === 'collective') { toasts.info('Circles are holders — add them under "Circles".'); return; }
      if (!aboutFieldFor(p.type)) { toasts.info('That element type can\'t be a subject.'); return; }
      ctx.addAbout(p.id);
    });
    chips.appendChild(add);
    container.appendChild(chips);
  }

  // ---- home view (Entries | Knowers tabs) ------------------------------------

  function buildHome(): void {
    const worldId = wid()!;
    root.innerHTML = '';
    heldByMount = aboutMount = null;

    const header = document.createElement('header');
    header.className = 'atlas-room-header';
    header.innerHTML = `
      <h1>Knowledge</h1>
      <p class="atlas-room-subtitle">
        What the characters and circles of your world know. Each entry is a piece
        of information — its text is the knowledge; its holders are the knowers.
      </p>
    `;
    root.appendChild(header);

    // [Entries | Knowers] tabs + per-tab action on the right.
    const tabsRow = document.createElement('div');
    tabsRow.className = 'atlas-knowledge-tabs';
    const entriesBtn = document.createElement('button');
    entriesBtn.type = 'button';
    entriesBtn.className = 'atlas-knowledge-tab' + (roomTab === 'entries' ? ' is-active' : '');
    entriesBtn.textContent = 'entries';
    entriesBtn.addEventListener('click', () => { if (roomTab !== 'entries') { roomTab = 'entries'; buildHome(); } });
    const knowersBtn = document.createElement('button');
    knowersBtn.type = 'button';
    knowersBtn.className = 'atlas-knowledge-tab' + (roomTab === 'knowers' ? ' is-active' : '');
    knowersBtn.textContent = 'knowers';
    knowersBtn.addEventListener('click', () => { if (roomTab !== 'knowers') { roomTab = 'knowers'; buildHome(); } });
    tabsRow.appendChild(entriesBtn);
    tabsRow.appendChild(knowersBtn);
    const spacer = document.createElement('span');
    spacer.className = 'atlas-knowledge-tabs-spacer';
    tabsRow.appendChild(spacer);
    if (roomTab === 'entries') {
      const newBtn = document.createElement('button');
      newBtn.type = 'button';
      newBtn.className = 'atlas-btn-ghost atlas-knowledge-new';
      newBtn.title = 'Create a new knowledge entry';
      newBtn.textContent = '+ new knowledge entry';
      newBtn.addEventListener('click', () => navigate(knowledgeHash(worldId, NEW)));
      tabsRow.appendChild(newBtn);
    } else {
      const viewAs = document.createElement('button');
      viewAs.type = 'button';
      viewAs.className = 'atlas-btn-ghost atlas-knowledge-viewas';
      viewAs.title = 'See the world as any character knows it';
      viewAs.textContent = 'view as…';
      viewAs.addEventListener('click', async () => {
        const p = await pickElement({ restrictToType: 'character', title: 'View the world as…' });
        if (p) navigate(knowledgeKnowerHash(worldId, p.id));
      });
      tabsRow.appendChild(viewAs);
      const newCircle = document.createElement('button');
      newCircle.type = 'button';
      newCircle.className = 'atlas-btn-ghost atlas-knowledge-newcircle';
      newCircle.title = 'Create a circle (a collective acting as a knower-group)';
      newCircle.textContent = '+ new circle';
      newCircle.addEventListener('click', () => {
        new ElementCreateModal(toasts, {
          initialType: 'collective',
          suppressNavigate: true,
          title: 'New circle',
          onCreated: (id, type) => {
            // Tag as a circle (organizational only — convention #72) so it
            // surfaces in this list even before holding anything.
            if (type === 'collective') void patchEntry(id, { subtype: CIRCLE_SUBTYPE });
          },
        }).open();
      });
      tabsRow.appendChild(newCircle);
    }
    root.appendChild(tabsRow);

    if (roomTab === 'entries') buildEntriesList(worldId);
    else buildKnowersList(worldId);
  }

  function buildEntriesList(worldId: string): void {
    const entries = listKnowledgeEntries(getState().data.elements)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'atlas-knowledge-empty';
      empty.innerHTML = `
        <p class="atlas-knowledge-empty-title">No knowledge entries yet.</p>
        <p class="atlas-knowledge-hint">
          Create one to record something known in your world — a secret, a rumor,
          a fact — then assign who holds it (a character, or a circle).
        </p>
      `;
      root.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'atlas-knowledge-list';
    for (const entry of entries) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'atlas-knowledge-row';
      row.innerHTML = `
        <span class="material-symbols-outlined atlas-knowledge-row-icon">menu_book</span>
        <span class="atlas-knowledge-row-main">
          <span class="atlas-knowledge-row-name">${escapeText(entry.name || '(untitled)')}</span>
          <span class="atlas-knowledge-row-meta">${escapeText(holderSummary(entry))}</span>
        </span>
      `;
      row.addEventListener('click', () => navigate(knowledgeHash(worldId, entry.id)));
      list.appendChild(row);
    }
    root.appendChild(list);
  }

  /** "held by Ireena", "held by the party +2", or "no holders yet". */
  function holderSummary(entry: Element): string {
    const held = heldByOf(entry);
    const ids = [...(held.narrator ? [held.narrator] : []), ...held.collectives];
    if (ids.length === 0) return 'no holders yet';
    const first = elOf(ids[0])?.name || '(unnamed)';
    return ids.length === 1 ? `held by ${first}` : `held by ${first} +${ids.length - 1}`;
  }

  function buildKnowersList(worldId: string): void {
    const elements = getState().data.elements;
    const knowers = listKnowers(elements);

    if (knowers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'atlas-knowledge-empty';
      empty.innerHTML = `
        <p class="atlas-knowledge-empty-title">No knowers yet.</p>
        <p class="atlas-knowledge-hint">
          Assign a character or circle in an entry's "Held by" — or create a
          circle here to set one up before it holds anything.
        </p>
      `;
      root.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'atlas-knowledge-list';
    for (const k of knowers) {
      const held = knowledgeHeldBy(k.id, elements);
      const knownCount = elementsKnownAboutBy(k.id, elements).length;
      const isCircle = k.type === 'collective';
      const meta: string[] = [];
      if (isCircle) meta.push(`${circleMembers(k.id, elements).length} member${circleMembers(k.id, elements).length === 1 ? '' : 's'}`);
      meta.push(`holds ${held.length} ${held.length === 1 ? 'entry' : 'entries'}`);
      if (knownCount > 0) meta.push(`knows about ${knownCount}`);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'atlas-knowledge-row';
      row.innerHTML = `
        <span class="material-symbols-outlined atlas-knowledge-row-icon">${isCircle ? 'groups' : (ELEMENT_ICONS[k.type] ?? 'person')}</span>
        <span class="atlas-knowledge-row-main">
          <span class="atlas-knowledge-row-name">${escapeText(k.name || '(unnamed)')}</span>
          <span class="atlas-knowledge-row-meta">${escapeText(meta.join(' · '))}</span>
        </span>
      `;
      row.addEventListener('click', () => navigate(knowledgeKnowerHash(worldId, k.id)));
      list.appendChild(row);
    }
    root.appendChild(list);
  }

  // ---- known-view (K4) --------------------------------------------------------

  function buildKnower(knowerId: string): void {
    const worldId = wid()!;
    const elements = getState().data.elements;
    const knower = elOf(knowerId);
    if (!knower || !isKnowerType(knower.type)) {
      roomTab = 'knowers';
      mountedView = 'list';
      buildHome();
      return;
    }
    root.innerHTML = '';
    heldByMount = aboutMount = null;

    const isCircle = knower.type === 'collective';
    const held = knowledgeHeldBy(knowerId, elements);
    const knownIds = elementsKnownAboutBy(knowerId, elements);

    const header = document.createElement('header');
    header.className = 'atlas-room-header atlas-knowledge-detail-header';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'atlas-btn-ghost atlas-knowledge-back';
    back.innerHTML = `<span class="material-symbols-outlined">arrow_back</span> all knowers`;
    back.addEventListener('click', () => { roomTab = 'knowers'; navigate(knowledgeHash(worldId)); });
    header.appendChild(back);

    const titleRow = document.createElement('div');
    titleRow.className = 'atlas-knowledge-detail-titlerow';
    const metaBits: string[] = [];
    if (isCircle) {
      const members = circleMembers(knowerId, elements).length;
      metaBits.push(`circle · ${members} member${members === 1 ? '' : 's'}`);
    }
    metaBits.push(`holds ${held.length} ${held.length === 1 ? 'entry' : 'entries'}`);
    if (knownIds.length > 0) metaBits.push(`knows about ${knownIds.length} element${knownIds.length === 1 ? '' : 's'}`);
    titleRow.innerHTML = `
      <h1><span class="material-symbols-outlined atlas-knowledge-knower-icon">${isCircle ? 'groups' : (ELEMENT_ICONS[knower.type] ?? 'person')}</span>${escapeText(knower.name || '(unnamed)')}</h1>
      <span class="atlas-knowledge-knower-meta">${escapeText(metaBits.join(' · '))}</span>
    `;
    const openEl = document.createElement('button');
    openEl.type = 'button';
    openEl.className = 'atlas-knowledge-allfields';
    openEl.title = 'Open in the full element editor';
    openEl.textContent = 'open element →';
    openEl.addEventListener('click', () => navigate(elementHash(worldId, knower.id)));
    titleRow.appendChild(openEl);
    header.appendChild(titleRow);
    root.appendChild(header);

    const body = document.createElement('div');
    body.className = 'atlas-knowledge-detail';
    root.appendChild(body);

    // Held knowledge — the entries themselves.
    const heldSection = document.createElement('section');
    heldSection.className = 'atlas-knowledge-section';
    heldSection.innerHTML = `<h2 class="atlas-knowledge-section-title">Held knowledge</h2>
      <p class="atlas-knowledge-section-hint">The entries this ${isCircle ? 'circle' : 'character'} holds${isCircle ? '' : ' (directly, or via circle membership)'}.</p>`;
    if (held.length === 0) {
      const none = document.createElement('p');
      none.className = 'atlas-knowledge-none';
      none.textContent = 'Holds no knowledge yet — assign it in an entry\'s "Held by".';
      heldSection.appendChild(none);
    } else {
      const list = document.createElement('div');
      list.className = 'atlas-knowledge-list';
      for (const entry of held.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'atlas-knowledge-row';
        row.innerHTML = `
          <span class="material-symbols-outlined atlas-knowledge-row-icon">menu_book</span>
          <span class="atlas-knowledge-row-main">
            <span class="atlas-knowledge-row-name">${escapeText(entry.name || '(untitled)')}</span>
          </span>
        `;
        row.addEventListener('click', () => navigate(knowledgeHash(worldId, entry.id)));
        list.appendChild(row);
      }
      heldSection.appendChild(list);
    }
    body.appendChild(heldSection);

    // Known world — one card per known-about element, compiled from the held
    // entry texts that mention it (never the canonical record — convention #70).
    const knownSection = document.createElement('section');
    knownSection.className = 'atlas-knowledge-section';
    knownSection.innerHTML = `<h2 class="atlas-knowledge-section-title">Known world</h2>
      <p class="atlas-knowledge-section-hint">The world as ${escapeText(knower.name || 'they')} knows it — compiled from held entries, not the canonical records.</p>`;
    if (knownIds.length === 0) {
      const none = document.createElement('p');
      none.className = 'atlas-knowledge-none';
      none.textContent = held.length === 0
        ? 'Nothing known yet.'
        : 'Held entries have no subjects yet — mention elements in their text, or add subjects.';
      knownSection.appendChild(none);
    } else {
      const known = knownIds
        .map(id => elOf(id))
        .filter((e): e is Element => Boolean(e))
        .sort((a, b) => (a.type === b.type ? (a.name || '').localeCompare(b.name || '') : a.type.localeCompare(b.type)));
      for (const el of known) {
        const card = document.createElement('div');
        card.className = 'atlas-knowledge-known-card';
        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'atlas-knowledge-known-head';
        head.title = `Open ${el.name || el.type}`;
        head.innerHTML = `
          <span class="material-symbols-outlined">${ELEMENT_ICONS[el.type] ?? 'category'}</span>
          <span class="atlas-knowledge-known-name">${escapeText(el.name || '(unnamed)')}</span>
          <span class="atlas-knowledge-known-type">${escapeText(ELEMENT_LABELS[el.type]?.singular ?? el.type)}</span>
        `;
        head.addEventListener('click', () => navigate(elementHash(worldId, el.id)));
        card.appendChild(head);
        for (const entry of held) {
          if (!aboutIdsOf(entry).includes(el.id)) continue;
          const quote = document.createElement('div');
          quote.className = 'atlas-knowledge-known-quote';
          const story = typeof (entry as Record<string, unknown>).story === 'string'
            ? (entry as Record<string, unknown>).story as string : '';
          const text = document.createElement('div');
          text.className = 'atlas-knowledge-known-text';
          text.textContent = story.trim() || '(no text — the entry only references it)';
          quote.appendChild(text);
          const src = document.createElement('button');
          src.type = 'button';
          src.className = 'atlas-knowledge-known-src';
          src.textContent = `— ${entry.name || '(untitled)'}`;
          src.title = 'Open this entry';
          src.addEventListener('click', () => navigate(knowledgeHash(worldId, entry.id)));
          quote.appendChild(src);
          card.appendChild(quote);
        }
        knownSection.appendChild(card);
      }
    }
    body.appendChild(knownSection);
  }

  // ---- entry editor view ------------------------------------------------------

  function makeCtx(entryId: string | null): EditorCtx {
    if (entryId === null) {
      const ctx: EditorCtx = {
        heldBy: () => ({ narrator: draft!.narrator, collectives: draft!.collectives }),
        setNarrator: (id) => { draft!.narrator = id; persistDraft(); renderHeldBy(heldByMount!, ctx); },
        addCircle: (id) => { draft!.collectives = [...draft!.collectives, id]; persistDraft(); renderHeldBy(heldByMount!, ctx); },
        removeCircle: (id) => { draft!.collectives = draft!.collectives.filter(c => c !== id); persistDraft(); renderHeldBy(heldByMount!, ctx); },
        aboutIds: () => draft!.aboutIds,
        addAbout: (id) => { if (!draft!.aboutIds.includes(id)) draft!.aboutIds = [...draft!.aboutIds, id]; persistDraft(); refreshDraftAbout(ctx); },
        removeAbout: (id) => { draft!.aboutIds = draft!.aboutIds.filter(x => x !== id); persistDraft(); refreshDraftAbout(ctx); },
      };
      return ctx;
    }
    const cur = () => elOf(entryId) ?? ({ id: entryId } as Element);
    return {
      heldBy: () => heldByOf(cur()),
      setNarrator: (id) => { void patchEntry(entryId, { narrator: id }); },
      addCircle: (id) => { void patchEntry(entryId, { collectives: [...heldByOf(cur()).collectives, id] }); },
      removeCircle: (id) => { void patchEntry(entryId, { collectives: heldByOf(cur()).collectives.filter(c => c !== id) }); },
      aboutIds: () => aboutIdsOf(cur()),
      addAbout: (id) => {
        const t = elOf(id)?.type;
        const f = t ? aboutFieldFor(t) : null;
        if (!f) return;
        const arr = (cur() as Record<string, unknown>)[f];
        const list = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
        if (!list.includes(id)) void patchEntry(entryId, { [f]: [...list, id] });
      },
      removeAbout: (id) => {
        const e = cur() as Record<string, unknown>;
        for (const f of ABOUT_FIELDS) {
          const arr = e[f];
          if (Array.isArray(arr) && arr.includes(id)) {
            void patchEntry(entryId, { [f]: (arr as string[]).filter(x => x !== id) });
            return;
          }
        }
      },
    };
  }

  /** Draft About refresh — manual chips + non-removable prose-derived extras. */
  function refreshDraftAbout(ctx: EditorCtx): void {
    if (!aboutMount || !draft) return;
    const derived = derivedAboutIds(draft.story);
    lastDerivedKey = derived.slice().sort().join(',');
    renderAbout(aboutMount, ctx, derived);
  }

  function buildEditor(entryId: string | null): void {
    const worldId = wid()!;
    const isDraft = entryId === null;
    const entry = isDraft ? null : elOf(entryId!);
    if (!isDraft && (!entry || entry.type !== 'narrative')) {
      mountedView = 'list';
      buildHome();
      return;
    }
    if (isDraft && !draft) {
      // Restore an abandoned draft from the per-world stash; fresh otherwise.
      draft = loadDraftStash(worldId)
        ?? { name: '', story: '', richtextJson: null, narrator: null, collectives: [], aboutIds: [] };
    }

    root.innerHTML = '';

    const header = document.createElement('header');
    header.className = 'atlas-room-header atlas-knowledge-detail-header';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'atlas-btn-ghost atlas-knowledge-back';
    back.innerHTML = `<span class="material-symbols-outlined">arrow_back</span> all knowledge`;
    back.addEventListener('click', () => navigate(knowledgeHash(worldId)));
    header.appendChild(back);
    const titleRow = document.createElement('div');
    titleRow.className = 'atlas-knowledge-detail-titlerow';
    titleRow.innerHTML = `<h1>${isDraft ? 'New knowledge entry' : escapeText(entry!.name || '(untitled)')}</h1>`;
    if (!isDraft) {
      const allFields = document.createElement('button');
      allFields.type = 'button';
      allFields.className = 'atlas-knowledge-allfields';
      allFields.title = 'Open in the full element editor (all fields)';
      allFields.textContent = 'all fields →';
      allFields.addEventListener('click', () => navigate(elementHash(worldId, entry!.id)));
      titleRow.appendChild(allFields);
    }
    header.appendChild(titleRow);
    root.appendChild(header);

    const body = document.createElement('div');
    body.className = 'atlas-knowledge-detail';
    root.appendChild(body);

    // Name
    const nameField = document.createElement('div');
    nameField.className = 'atlas-knowledge-field';
    nameField.innerHTML = `<label class="atlas-knowledge-field-label">Name</label>`;
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'atlas-input atlas-knowledge-name';
    nameInput.placeholder = 'what is known…';
    nameInput.value = isDraft ? draft!.name : (entry!.name || '');
    if (isDraft) {
      nameInput.addEventListener('input', () => { draft!.name = nameInput.value; persistDraft(); });
    } else {
      nameInput.addEventListener('blur', () => {
        const v = nameInput.value.trim();
        // Compare against CURRENT state, not the build-time snapshot — after a
        // blur-save, the build-time value is stale and reverting to it would
        // silently skip the write.
        const current = elOf(entryId!)?.name || '';
        if (v && v !== current) void patchEntry(entryId!, { name: v });
      });
    }
    nameField.appendChild(nameInput);
    body.appendChild(nameField);

    const ctx = makeCtx(entryId);

    // Held by
    const heldSection = document.createElement('section');
    heldSection.className = 'atlas-knowledge-section';
    heldSection.innerHTML = `<h2 class="atlas-knowledge-section-title">Held by</h2>
      <p class="atlas-knowledge-section-hint">Who knows this. Members of a circle inherit it.</p>`;
    heldByMount = document.createElement('div');
    heldSection.appendChild(heldByMount);
    body.appendChild(heldSection);
    renderHeldBy(heldByMount, ctx);

    // About
    const aboutSection = document.createElement('section');
    aboutSection.className = 'atlas-knowledge-section';
    aboutSection.innerHTML = `<h2 class="atlas-knowledge-section-title">About</h2>
      <p class="atlas-knowledge-section-hint">The elements this knowledge concerns. @-mentions in the text link up automatically.</p>`;
    aboutMount = document.createElement('div');
    aboutSection.appendChild(aboutMount);
    body.appendChild(aboutSection);
    if (isDraft) refreshDraftAbout(ctx);
    else renderAbout(aboutMount, ctx);

    // Knowledge (prose) — the embedded writing editor (K3), lazy-loaded.
    const proseSection = document.createElement('section');
    proseSection.className = 'atlas-knowledge-section';
    proseSection.innerHTML = `<h2 class="atlas-knowledge-section-title">Knowledge</h2>
      <p class="atlas-knowledge-section-hint">The text is the knowledge — what's known. Type @ to mention an element.</p>`;
    const proseHost = document.createElement('div');
    // Reuses the writing prose CSS (typography, chips, autolink hints) — the
    // writing-room :has() chrome rules key off .atlas-writing-workspace, which
    // has no ancestor here, so none of that leaks.
    proseHost.className = 'atlas-writing-workspace-prose atlas-knowledge-prose-rich';
    proseHost.innerHTML = '<div class="atlas-knowledge-prose-loading">loading editor…</div>';
    proseSection.appendChild(proseHost);
    body.appendChild(proseSection);

    void mountProseEditor(proseHost, isDraft ? NEW : entryId!, ctx);

    // Draft actions
    if (isDraft) {
      const actions = document.createElement('div');
      actions.className = 'atlas-knowledge-draft-actions';
      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'atlas-btn-primary';
      create.textContent = 'create';
      create.addEventListener('click', () => { void createFromDraft(nameInput); });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'atlas-btn-ghost';
      cancel.textContent = 'cancel';
      cancel.addEventListener('click', () => {
        draft = null;
        clearDraftStash(worldId);
        navigate(knowledgeHash(worldId));
      });
      actions.appendChild(create);
      actions.appendChild(cancel);
      body.appendChild(actions);
    }
  }

  /**
   * Mount the TipTap knowledge editor into the prose host. Async (dynamic
   * import keeps TipTap code-split); the token guards against the view
   * changing while the chunk loads.
   */
  async function mountProseEditor(host: HTMLElement, forId: string, ctx: EditorCtx): Promise<void> {
    const token = ++editorMountToken;
    let mod: typeof import('./knowledge-editor');
    try {
      mod = await import('./knowledge-editor');
    } catch (err) {
      console.error('[knowledge-room] editor chunk failed to load', err);
      host.innerHTML = '<div class="atlas-knowledge-prose-loading">editor failed to load — reload to retry</div>';
      return;
    }
    if (token !== editorMountToken || !root.contains(host)) return; // view moved on
    host.innerHTML = '';

    const isDraft = forId === NEW;
    const entryEl = isDraft ? null : elOf(forId);
    const initialMarkdown = isDraft
      ? (draft?.story ?? '')
      : (typeof (entryEl as Record<string, unknown> | undefined)?.story === 'string'
        ? (entryEl as Record<string, unknown>).story as string : '');
    const initialJson = isDraft
      ? (draft?.richtextJson ?? null)
      : parseRichtextJson((entryEl as Record<string, unknown> | undefined)?.atlas_richtext_json);

    editorForId = forId;
    lastSavedMarkdown = isDraft ? null : initialMarkdown;

    editorMount = mod.mountKnowledgeEditor({
      host,
      roomRoot: root,
      initialJson,
      initialMarkdown,
      toasts,
      getEntry: () => (isDraft ? null : elOf(forId) ?? null),
      onSnapshot: (snap) => {
        if (isDraft) {
          if (!draft) return;
          draft.story = snap.markdown;
          draft.richtextJson = snap.json;
          persistDraft();
          // Refresh the About chips only when the derived set actually changed.
          const key = derivedAboutIds(snap.markdown).slice().sort().join(',');
          if (key !== lastDerivedKey) {
            if (proseMentionsCollective(snap.markdown)) maybeToastDroppedCollective();
            refreshDraftAbout(ctx);
          }
        } else {
          scheduleEditorSave(snap);
        }
      },
    });
  }

  /** Same-view tick (saved editor): refresh chips + title + editor decorations; leave inputs alone. */
  function refreshEditorData(entryId: string): void {
    const el = elOf(entryId);
    if (!el) { mountedView = 'list'; buildHome(); return; }
    // Title is plain text (not an input) — safe to sync after renames/pulls.
    const h1 = root.querySelector('.atlas-knowledge-detail-titlerow h1');
    const title = el.name || '(untitled)';
    if (h1 && h1.textContent !== title) h1.textContent = title;
    const ctx = makeCtx(entryId);
    if (heldByMount) renderHeldBy(heldByMount, ctx);
    if (aboutMount) renderAbout(aboutMount, ctx);
    editorMount?.refresh(getState().data.elements);
  }

  /** Same-view tick (draft): chips can re-render (element renames); inputs + editor stay. */
  function refreshDraftData(): void {
    if (!draft) return;
    const ctx = makeCtx(null);
    if (heldByMount) renderHeldBy(heldByMount, ctx);
    refreshDraftAbout(ctx);
    editorMount?.refresh(getState().data.elements);
  }

  // ---- render dispatch ------------------------------------------------------

  function render(): void {
    if (!wid()) {
      root.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
      destroyEditorSession();
      mountedView = null;
      return;
    }
    const route = parseHash(window.location.hash);
    const kid = route.mode === 'knowledge' ? route.knowledgeId : undefined;
    const knowerId = route.mode === 'knowledge' ? route.knowerId : undefined;
    const tgt = knowerId ? `knower:${knowerId}` : (!kid ? 'list' : kid);

    if (tgt === mountedView) {
      if (tgt === 'list') buildHome();
      else if (tgt.startsWith('knower:')) buildKnower(knowerId!);
      else if (tgt === NEW) refreshDraftData();
      else refreshEditorData(tgt);
      return;
    }

    // View switch — tear down any live editor session (flushes pending save).
    destroyEditorSession();
    mountedView = tgt;
    if (tgt === 'list') { draft = null; buildHome(); }
    else if (tgt.startsWith('knower:')) { draft = null; buildKnower(knowerId!); }
    else if (tgt === NEW) { buildEditor(null); }
    else { draft = null; buildEditor(tgt); }
  }

  function parseRichtextJson(raw: unknown): JSONContent | null {
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as JSONContent;
      } catch {
        return null;
      }
    }
    if (typeof raw === 'object') return raw as JSONContent;
    return null;
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  return () => {
    destroyEditorSession();
    window.removeEventListener('pagehide', onPageHide);
    unsubState();
    unsubHash();
  };
}
