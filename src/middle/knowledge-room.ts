/**
 * Knowledge room — author + manage knowledge entries (Narratives, subtype 'knowledge').
 *
 * Three views (Track A — see PROGRESS.md Build Map + DESIGN_KNOWLEDGE.md):
 *   - list   (`/knowledge`)        — entries + "new knowledge entry"
 *   - draft  (`/knowledge/new`)    — a NEW entry held in memory; NOTHING persists
 *                                    until "Create".
 *   - editor (`/knowledge/<id>`)   — edit a saved entry in place.
 *
 * In-room authoring surface: name, prose textarea (the text IS the knowledge),
 * the held-by editor (Character via `narrator`, Circles via `collectives` — two
 * channels), and the About editor (subjects → the matching Involves multi-link,
 * via `NARRATIVE_RELATION_FIELDS`; collectives excluded — they're holders).
 *
 * Re-render discipline: built once per view; same-view state ticks refresh only
 * the held-by + about chips, never the name/prose inputs (focus/typing survive).
 */

import { getState, subscribe } from '../core/state';
import { navigate, elementHash, knowledgeHash, parseHash, onHashChange } from '../core/router';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { escapeText } from '../core/dom-utils';
import {
  KNOWLEDGE_SUBTYPE, listKnowledgeEntries, heldByOf, heldByCount, aboutIdsOf, ABOUT_FIELDS,
} from '../core/knowledge';
import { NARRATIVE_RELATION_FIELDS } from './writing-workspace-derive';
import { ELEMENT_ICONS } from '../core/constants';
import { pickElement } from '../ui/element-picker-modal';
import type { Element, ElementType } from '../core/types';
import { ToastManager } from '../ui/toast-manager';

/** Sentinel knowledgeId for the unsaved draft editor (`/knowledge/new`). */
const NEW = 'new';

interface Draft {
  name: string;
  story: string;
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

/** Narrative field a subject of this type lands in. `null` = can't be a subject (collective = holder; map/pin/etc). */
function aboutFieldFor(type: string): string | null {
  if (type === 'collective') return null;
  return NARRATIVE_RELATION_FIELDS[type as ElementType] ?? null;
}

export function mountKnowledgeRoom(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-knowledge-room';
  target.appendChild(root);

  let mountedView: string | null = null;       // 'list' | NEW | '<entryId>' | null
  let draft: Draft | null = null;
  let heldByMount: HTMLElement | null = null;
  let aboutMount: HTMLElement | null = null;

  const wid = () => getState().active?.worldId ?? null;
  const elOf = (id: string): Element | undefined => getState().data.elements.find(e => e.id === id);

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

  async function createFromDraft(nameEl: HTMLInputElement, proseEl: HTMLTextAreaElement): Promise<void> {
    const worldId = wid();
    const folder = getActiveStore();
    if (!worldId || !folder || !draft) return;
    const data: Record<string, unknown> = {
      name: nameEl.value.trim() || 'untitled knowledge',
      subtype: KNOWLEDGE_SUBTYPE,
      story: proseEl.value,
      narrator: draft.narrator,
      collectives: draft.collectives,
    };
    // Group draft subjects into their matching Involves fields.
    for (const id of draft.aboutIds) {
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
      navigate(knowledgeHash(worldId, created.id));
    } catch (err) {
      console.error('[knowledge-room] create failed', err);
      toasts.error('Could not create knowledge entry');
    }
  }

  // ---- chips ----------------------------------------------------------------

  function elementChip(id: string, onRemove?: () => void): HTMLElement {
    const el = elOf(id);
    const worldId = wid();
    const chip = document.createElement('span');
    chip.className = 'atlas-knowledge-chip';
    const icon = el ? (ELEMENT_ICONS[el.type] ?? 'category') : 'help';
    const name = el?.name || '(unknown)';
    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'atlas-knowledge-chip-body';
    body.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span>${escapeText(name)}</span>`;
    if (el && worldId) {
      body.title = `Open ${name}`;
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

  function renderAbout(container: HTMLElement, ctx: EditorCtx): void {
    container.innerHTML = '';
    const ids = ctx.aboutIds();
    const chips = document.createElement('div');
    chips.className = 'atlas-knowledge-chips';
    for (const id of ids) chips.appendChild(elementChip(id, () => ctx.removeAbout(id)));
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

  // ---- list view ------------------------------------------------------------

  function buildList(): void {
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
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'atlas-btn-ghost atlas-knowledge-new';
    newBtn.title = 'Create a new knowledge entry';
    newBtn.textContent = '+ new knowledge entry';
    newBtn.addEventListener('click', () => navigate(knowledgeHash(worldId, NEW)));
    header.appendChild(newBtn);
    root.appendChild(header);

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
      const holders = heldByCount(entry);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'atlas-knowledge-row';
      row.innerHTML = `
        <span class="material-symbols-outlined atlas-knowledge-row-icon">menu_book</span>
        <span class="atlas-knowledge-row-main">
          <span class="atlas-knowledge-row-name">${escapeText(entry.name || '(untitled)')}</span>
          <span class="atlas-knowledge-row-meta">${holders === 0 ? 'no holders yet' : `held by ${holders}`}</span>
        </span>
      `;
      row.addEventListener('click', () => navigate(knowledgeHash(worldId, entry.id)));
      list.appendChild(row);
    }
    root.appendChild(list);
  }

  // ---- editor view ----------------------------------------------------------

  function makeCtx(entryId: string | null): EditorCtx {
    if (entryId === null) {
      const ctx: EditorCtx = {
        heldBy: () => ({ narrator: draft!.narrator, collectives: draft!.collectives }),
        setNarrator: (id) => { draft!.narrator = id; renderHeldBy(heldByMount!, ctx); },
        addCircle: (id) => { draft!.collectives = [...draft!.collectives, id]; renderHeldBy(heldByMount!, ctx); },
        removeCircle: (id) => { draft!.collectives = draft!.collectives.filter(c => c !== id); renderHeldBy(heldByMount!, ctx); },
        aboutIds: () => draft!.aboutIds,
        addAbout: (id) => { if (!draft!.aboutIds.includes(id)) draft!.aboutIds = [...draft!.aboutIds, id]; renderAbout(aboutMount!, ctx); },
        removeAbout: (id) => { draft!.aboutIds = draft!.aboutIds.filter(x => x !== id); renderAbout(aboutMount!, ctx); },
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

  function buildEditor(entryId: string | null): void {
    const worldId = wid()!;
    const isDraft = entryId === null;
    const entry = isDraft ? null : elOf(entryId!);
    if (!isDraft && (!entry || entry.type !== 'narrative')) {
      mountedView = 'list';
      buildList();
      return;
    }
    if (isDraft && !draft) draft = { name: '', story: '', narrator: null, collectives: [], aboutIds: [] };

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
      nameInput.addEventListener('input', () => { draft!.name = nameInput.value; });
    } else {
      nameInput.addEventListener('blur', () => {
        const v = nameInput.value.trim();
        if (v && v !== (entry!.name || '')) void patchEntry(entry!.id, { name: v });
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
      <p class="atlas-knowledge-section-hint">The elements this knowledge concerns.</p>`;
    aboutMount = document.createElement('div');
    aboutSection.appendChild(aboutMount);
    body.appendChild(aboutSection);
    renderAbout(aboutMount, ctx);

    // Knowledge (prose)
    const proseSection = document.createElement('section');
    proseSection.className = 'atlas-knowledge-section';
    proseSection.innerHTML = `<h2 class="atlas-knowledge-section-title">Knowledge</h2>
      <p class="atlas-knowledge-section-hint">The text is the knowledge — what's known.</p>`;
    const prose = document.createElement('textarea');
    prose.className = 'atlas-knowledge-prose';
    prose.placeholder = 'A masked woman named Aralia leads the rebellion…';
    prose.value = isDraft ? draft!.story : (typeof (entry as Record<string, unknown>).story === 'string' ? (entry as Record<string, unknown>).story as string : '');
    if (isDraft) {
      prose.addEventListener('input', () => { draft!.story = prose.value; });
    } else {
      const saved = prose.value;
      prose.addEventListener('blur', () => {
        if (prose.value !== saved) void patchEntry(entry!.id, { story: prose.value });
      });
    }
    proseSection.appendChild(prose);
    body.appendChild(proseSection);

    // Draft actions
    if (isDraft) {
      const actions = document.createElement('div');
      actions.className = 'atlas-knowledge-draft-actions';
      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'atlas-btn-primary';
      create.textContent = 'create';
      create.addEventListener('click', () => { void createFromDraft(nameInput, prose); });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'atlas-btn-ghost';
      cancel.textContent = 'cancel';
      cancel.addEventListener('click', () => { draft = null; navigate(knowledgeHash(worldId)); });
      actions.appendChild(create);
      actions.appendChild(cancel);
      body.appendChild(actions);
    }
  }

  /** Same-view tick (saved editor): refresh only the chip areas; leave inputs alone. */
  function refreshEditorData(entryId: string): void {
    if (!elOf(entryId)) { mountedView = 'list'; buildList(); return; }
    const ctx = makeCtx(entryId);
    if (heldByMount) renderHeldBy(heldByMount, ctx);
    if (aboutMount) renderAbout(aboutMount, ctx);
  }

  // ---- render dispatch ------------------------------------------------------

  function render(): void {
    if (!wid()) {
      root.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
      mountedView = null;
      return;
    }
    const route = parseHash(window.location.hash);
    const kid = route.mode === 'knowledge' ? route.knowledgeId : undefined;
    const tgt = !kid ? 'list' : kid;

    if (tgt === mountedView) {
      if (tgt === 'list') buildList();
      else if (tgt !== NEW) refreshEditorData(tgt);
      return;
    }

    mountedView = tgt;
    if (tgt === 'list') { draft = null; buildList(); }
    else if (tgt === NEW) { buildEditor(null); }
    else { draft = null; buildEditor(tgt); }
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  return () => {
    unsubState();
    unsubHash();
  };
}
