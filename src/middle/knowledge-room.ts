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

import { getState, subscribe, patchSlice } from '../core/state';
import { navigate, elementHash, knowledgeHash, knowledgeKnowerHash, shareHash, parseHash, onHashChange } from '../core/router';
import { PAGE_SUBTYPE, blocksOf, listPages, newBlockId, pageBlocksPatch, type PageBlock } from '../core/sharing';
import { getActiveStore } from '../core/active-store';
import { worldIsViewOnly } from '../core/view-only';
import { getEditorSettings } from '../registry/registry';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { completeWaypoint } from '../core/waypoints';
import { escapeText } from '../core/dom-utils';
import {
  KNOWLEDGE_SUBTYPE, CIRCLE_SUBTYPE, listKnowledgeEntries, heldByOf, aboutIdsOf,
  ABOUT_FIELDS, aboutFieldFor, isKnowerType, listKnowers, knowledgeHeldBy, elementsKnownAboutBy,
  circleMembers,
} from '../core/knowledge';
import { computeRelationPatch, extractProseLinks, linkTargetsIn } from './writing-workspace-derive';
import { diskChangeFor, storyChangedAlone } from '../core/live-folder';
import { renderProseFragment } from './writing-compiled';
import { ELEMENT_ICONS, ELEMENT_LABELS, KNOWLEDGE_DRAFT_STASH_PREFIX } from '../core/constants';
import { pickElement } from '../ui/element-picker-modal';
import { ElementCreateModal } from '../ui/element-create-modal';
import type { Element } from '../core/types';
import { ToastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import type { JSONContent } from '@tiptap/core';
import type { KnowledgeEditorHandle } from './knowledge-editor';
import { makeEditableTitle, type EditableTitleHandle } from './editable-title';
import { isEditingIn } from './element-detail-header';
import { makeRoomTabs } from '../ui/room-tabs';
import { makeDrillInPrefix } from '../ui/drill-in';
import { onLeaveWorld } from '../core/leave-flush';
import { rekeyOwLinks, rekeySidecar } from '../store/rekey-body';
import { mountAgentMarkSlot } from './element-agent-mark';

/** Sentinel knowledgeId for the unsaved draft editor (`/knowledge/new`). */
const NEW = 'new';

// Home-view [Entries | Knowers] tab is ephemeral UI state, not URL-encoded
// (see file header). The context pane (context-tab.ts) needs to know which
// tab is active to pick the right empty-state copy for the home view (T-K11),
// so we mirror it at module scope.
let lastRoomTab: 'entries' | 'knowers' = 'entries';

/** Which home-view tab (Entries/Knowers) is currently showing. */
export function getKnowledgeRoomTab(): 'entries' | 'knowers' {
  return lastRoomTab;
}

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

/**
 * The re-key (S363) moves ids; stored state follows. Id fields by equality,
 * prose and rich text through the shared re-key helpers. Writes only on change.
 */
export function remapDraftStash(worldId: string, map: ReadonlyMap<string, string>): void {
  const d = loadDraftStash(worldId);
  if (!d) return;
  const one = (id: string): string => map.get(id) ?? id;
  const next: Draft = {
    ...d,
    story: rekeyOwLinks(d.story, map),
    richtextJson: d.richtextJson ? (rekeySidecar(d.richtextJson, map) as JSONContent) : null,
    narrator: d.narrator === null ? null : one(d.narrator),
    collectives: d.collectives.map(one),
    aboutIds: d.aboutIds.map(one),
  };
  if (JSON.stringify(next) === JSON.stringify(d)) return;
  saveDraftStash(worldId, next);
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
  let entryTitleHandle: EditableTitleHandle | null = null;  // editor header title (sync on tick)
  let entryAgentMark: ReturnType<typeof mountAgentMarkSlot> | null = null;  // the quiet agent mark (sync on tick)
  let knowerTitleHandle: EditableTitleHandle | null = null;  // knower header title (sync on tick)
  // Whether the mounted view actually found its target. False = not-found
  // interim (deep URL before elements load, id-swap transient, deleted entry)
  // — same-view ticks retry a full build instead of a surgical refresh.
  let mountedResolved = true;
  // Elements ref at last list/knower build — same-view ticks skip the full
  // rebuild when nothing in the data actually changed (hash-echo renders,
  // ui-slice patches), so scroll position survives idle ticks.
  let lastBuiltElementsRef: readonly Element[] | null = null;
  // A view-only world reads its knowledge and offers no write: no new entry
  // or circle, no rename, no holder or subject edits, prose read-only, no
  // delete, no page (conv. 149). Rooms remount per world, so one read holds.
  const viewOnly = worldIsViewOnly();

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
    toasts.info('Mentioning a circle in the text doesn\'t add it as a holder. To share with the circle, add it under "Who knows this".');
  }

  // ---- writes ---------------------------------------------------------------

  /** True when the write landed (the prose save advances its baseline on it). */
  async function patchEntry(id: string, patch: Record<string, unknown>): Promise<boolean> {
    const folder = getActiveStore();
    if (!folder || viewOnly) return false;
    try {
      await folder.updateElement(id, patch as Partial<Element>);
      await refreshElementsAfterWrite(folder);
      requestPushIfLinked();
      return true;
    } catch (err) {
      console.error('[knowledge-room] update failed', err);
      // No retry button: a failed prose save is captured again on the way out,
      // and a stale patch must not land over newer typing.
      showProblem(err, { doing: 'saving this knowledge entry', toasts });
      return false;
    }
  }

  /** Debounce window matches inline field edits (registry pref, default 1s). */
  function getSaveDebounceMs(): number {
    const ms = getState().registry.sync_debounce_ms;
    return typeof ms === 'number' && ms >= 200 ? ms : 1000;
  }

  function scheduleEditorSave(snap: { markdown: string; json: JSONContent }): void {
    // The chip-label sync's transaction lands here too; nothing saves (conv. 149).
    if (viewOnly) return;
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

  /** Drop any debounced prose save without writing it (delete flow). */
  function cancelPendingSave(): void {
    if (pendingSaveTimer !== null) {
      window.clearTimeout(pendingSaveTimer);
      pendingSaveTimer = null;
    }
    pendingSnapshot = null;
  }

  /**
   * Delete a saved entry. Confirm is gated by the Editing setting (same as
   * element-detail); pending prose saves are cancelled (moot once deleted);
   * navigate to the list BEFORE the data tick so the editor never renders a
   * not-found state for its own deletion.
   */
  async function deleteEntry(id: string): Promise<void> {
    const folder = getActiveStore();
    const worldId = wid();
    if (!folder || !worldId || viewOnly) return;
    const el = elOf(id);
    if (getEditorSettings(getState().registry).confirm_before_delete) {
      let dependentCount = 0;
      try {
        dependentCount = (await folder.findDependents(id)).length;
      } catch { /* fall through with 0 */ }
      const extra = dependentCount > 0
        ? ` This also deletes ${dependentCount} element${dependentCount === 1 ? '' : 's'} filed under it.`
        : '';
      if (!window.confirm(`Delete "${el?.name || 'this knowledge entry'}"?${extra} This cannot be undone.`)) return;
    }
    cancelPendingSave();
    // The teardown capture (A4) must not write the text back to the entry being
    // deleted (S364 gate, lens C C1): no baseline, nothing to capture.
    lastSavedMarkdown = null;
    navigate(knowledgeHash(worldId));
    try {
      await folder.deleteElement(id);
      await refreshElementsAfterWrite(folder);
      requestPushIfLinked();
      toasts.success(`Deleted ${el?.name || 'knowledge entry'}`);
    } catch (err) {
      console.error('[knowledge-room] delete failed', err);
      showProblem(err, { doing: 'deleting the knowledge entry', toasts });
    }
  }

  /**
   * Saved-entry prose save: story (markdown) + atlas_richtext_json + the
   * mention-derived about-fields — with `collectives` EXCLUDED (convention
   * #68: holders are wired only via the Held-by editor).
   */
  async function persistEditorSnapshot(snap: { markdown: string; json: JSONContent }): Promise<void> {
    const entryId = editorForId;
    if (!entryId || entryId === NEW || viewOnly) return;
    if (lastSavedMarkdown !== null && snap.markdown === lastSavedMarkdown) return;
    const el = elOf(entryId);
    if (!el) return;
    const relationPatch = computeRelationPatch(el, snap.markdown, linkTargetsIn(getState().data.elements)) as Record<string, unknown>;
    if ('collectives' in relationPatch) {
      delete relationPatch.collectives;
      maybeToastDroppedCollective();
    }
    const saved = await patchEntry(entryId, {
      story: snap.markdown,
      atlas_richtext_json: snap.json,
      ...relationPatch,
    });
    // Advance the baseline only for a write that LANDED, and only while this
    // entry is still the one open (S364 lane A4): a failed save marked as
    // saved made the leave/pagehide capture find nothing to retry, and a late
    // write from a closed session set the next entry's baseline.
    if (saved && editorForId === entryId) lastSavedMarkdown = snap.markdown;
  }

  /**
   * Queue the editor's text when it differs from the last write that landed,
   * so a save that FAILED (or never got its debounce) is retried on the way
   * out. The writing room's unmount capture does the same (S364 lane A4).
   * A vanished entry is safe: persistEditorSnapshot writes nothing for it;
   * the in-room delete clears the baseline first, so nothing is captured for
   * the entry being deleted (S364 gate lens C C1).
   */
  function captureUnsaved(): void {
    if (editorMount && editorForId && editorForId !== NEW && !pendingSnapshot) {
      const markdown = editorMount.getMarkdown();
      if (lastSavedMarkdown !== null && markdown !== lastSavedMarkdown) {
        pendingSnapshot = { markdown, json: editorMount.getJson() };
      }
    }
  }

  function destroyEditorSession(): void {
    // Flush is async; initiate before teardown (persistEditorSnapshot reads
    // its inputs before the first await, so the in-flight write completes).
    captureUnsaved();
    void flushPendingSave();
    editorMount?.destroy();
    editorMount = null;
    editorForId = null;
    lastSavedMarkdown = null;
    collectiveToastShown = false;
    lastDerivedKey = '';
    editorMountToken++;
  }

  const onPageHide = (): Promise<void> => {
    captureUnsaved();
    return flushPendingSave();
  };

  /**
   * THE LIVE FOLDER (S364): another tool changed the open entry on disk. The
   * pass flushed this room first; a clean editor rebuilds from the new body,
   * typing that landed during the pass wins and the room says so.
   */
  let preferStoryFor: string | null = null;
  function onDiskChanges(ev: Event): void {
    const entryId = editorForId;
    if (!entryId || entryId === NEW || !editorMount) return;
    const change = diskChangeFor(ev, entryId);
    if (!change) return;
    const dirty = pendingSnapshot !== null
      || (lastSavedMarkdown !== null && editorMount.getMarkdown() !== lastSavedMarkdown);
    if (dirty) {
      toasts.info('This entry also changed on disk. Your version is kept.');
      return;
    }
    const el = elOf(entryId);
    if (!el) return;
    if (storyChangedAlone(change.before, el, 'atlas_richtext_json')) preferStoryFor = entryId;
    destroyEditorSession();
    mountedView = null;
    render();
  }
  document.addEventListener('atlas:disk-changes', onDiskChanges);

  let knowerRebuildDeferred = false;
  const onRootFocusOut = (): void => {
    if (!knowerRebuildDeferred) return;
    knowerRebuildDeferred = false;
    queueMicrotask(render);
  };
  root.addEventListener('focusout', onRootFocusOut);
  window.addEventListener('pagehide', onPageHide);
  // Same flush before a world switch empties the elements this save needs (S360).
  const unLeaveWorld = onLeaveWorld(onPageHide);

  async function createFromDraft(): Promise<void> {
    const worldId = wid();
    const folder = getActiveStore();
    if (!worldId || !folder || !draft || viewOnly) return;
    const data: Record<string, unknown> = {
      name: (draft.name || '').trim() || 'Unnamed knowledge',
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
      // Waypoint: entry creation is a gesture path that bypasses the
      // element-create modal (hookmap wp2).
      completeWaypoint('first-element');
      completeWaypoint('knowledge');
      await refreshElementsAfterWrite(folder);
      requestPushIfLinked();
      draft = null;
      clearDraftStash(worldId);
      // ONLY navigate if the user is still on the draft: this function is
      // async, and its tail used to fire navigate(created) after a quick
      // back-click had already returned to the list — a stale navigation
      // yanking the user into the entry (S268: the knowledge:94 "flake" was
      // this race, reproduced 3/3 with a hash logger). The refresh stays
      // BEFORE the navigate so the entry route never renders not-found.
      const route = parseHash(window.location.hash);
      if (route.mode === 'knowledge' && route.knowledgeId === NEW) {
        navigate(knowledgeHash(worldId, created.id));
      }
    } catch (err) {
      console.error('[knowledge-room] create failed', err);
      showProblem(err, { doing: 'creating the knowledge entry', toasts });
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
      body.title = derived ? `${name} · mentioned in the text` : `Open ${name}`;
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

  /** A quiet line in a chips band, for a view-only world's empty zone. */
  function noneLine(text: string): HTMLElement {
    const none = document.createElement('span');
    none.className = 'atlas-knowledge-none';
    none.textContent = text;
    return none;
  }

  function addAffordance(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'atlas-knowledge-add';
    add.textContent = label;
    add.title = title;
    add.addEventListener('click', onClick);
    return add;
  }

  /**
   * The WHO zone band (D4): character + circle chips in ONE row — the chip
   * icons (person vs groups) carry the distinction, no sub-labels. Inline
   * affordances: + character (when unset), + add circle, + new circle (K9).
   */
  function renderHeldBy(container: HTMLElement, ctx: EditorCtx): void {
    container.innerHTML = '';
    const held = ctx.heldBy();
    const chips = document.createElement('div');
    chips.className = 'atlas-knowledge-chips';
    // A view-only world shows the holders, without remove or add (conv. 149).
    if (held.narrator) chips.appendChild(elementChip(held.narrator, viewOnly ? undefined : () => ctx.setNarrator(null)));
    for (const id of held.collectives) chips.appendChild(elementChip(id, viewOnly ? undefined : () => ctx.removeCircle(id)));
    if (viewOnly) {
      if (!held.narrator && held.collectives.length === 0) chips.appendChild(noneLine('No one holds this yet.'));
      container.appendChild(chips);
      return;
    }
    if (!held.narrator) {
      chips.appendChild(addAffordance('+ Character', 'One character who holds this knowledge', async () => {
        const p = await pickElement({ restrictToType: 'character', title: 'Who knows this?' });
        if (p) ctx.setNarrator(p.id);
      }));
    } else {
      // A second individual knower can't be stored (narrator is single-link,
      // by design — two+ knowers ARE a circle). Offer the promotion instead
      // of dead-ending (S265, Susie's find).
      chips.appendChild(addAffordance('+ Character', 'Add a second knower: two individuals become a circle', async () => {
        const first = ctx.heldBy().narrator;
        if (!first) return;
        const p = await pickElement({
          restrictToType: 'character', excludeIds: [first], title: 'Add a second knower',
        });
        if (p) openPromoteToCircle(first, p.id, ctx);
      }));
    }
    chips.appendChild(addAffordance('+ Existing circle', 'A group whose members inherit this knowledge', async () => {
      const p = await pickElement({ restrictToType: 'collective', excludeIds: ctx.heldBy().collectives, title: 'Add a circle' });
      if (p) ctx.addCircle(p.id);
    }));
    // K9: mint a circle without leaving the entry — it joins the holders.
    chips.appendChild(addAffordance('+ New circle', 'Create a circle and add it as a holder', () => {
      openNewCircle((id) => ctx.addCircle(id));
    }));
    container.appendChild(chips);
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
    for (const id of ids) chips.appendChild(elementChip(id, viewOnly ? undefined : () => ctx.removeAbout(id)));
    if (derivedExtra) {
      for (const id of derivedExtra) {
        if (ids.includes(id)) continue;
        chips.appendChild(elementChip(id, undefined, true));
      }
    }
    // A view-only world lists the subjects, with no add or remove (conv. 149).
    if (viewOnly) {
      if (ids.length === 0) chips.appendChild(noneLine('No subjects.'));
      container.appendChild(chips);
      return;
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'atlas-knowledge-add';
    add.textContent = '+ Add subject';
    add.addEventListener('click', async () => {
      const p = await pickElement({ title: 'What is this knowledge about?', excludeIds: ctx.aboutIds() });
      if (!p) return;
      if (p.type === 'collective') { toasts.info('Circles are holders; add them under "Who knows this".'); return; }
      if (!aboutFieldFor(p.type)) { toasts.info('That element type can\'t be a subject.'); return; }
      ctx.addAbout(p.id);
    });
    chips.appendChild(add);
    container.appendChild(chips);
  }

  /**
   * Honest interim when a view's target id isn't in the element cache —
   * deep URL before elements load, an id-swap transient, or a genuinely
   * deleted element. No navigation (the URL stays truthful), no per-tick
   * teardown churn: `mountedResolved = false` makes the next data tick retry
   * a full build, which resolves the transient cases automatically.
   */
  function renderNotFound(kind: 'entry' | 'knower'): void {
    const worldId = wid()!;
    root.innerHTML = '';
    heldByMount = aboutMount = null;
    mountedResolved = false;
    const header = document.createElement('header');
    // Compact entity band, matching the resolved detail views (conv #80: a
    // single named entity gets .atlas-middle-header, not the room landing h1).
    header.className = 'atlas-middle-header atlas-knowledge-detail-header';
    // D1 drill-in prefix — same affordance as the entity headers.
    header.appendChild(makeDrillInPrefix('Knowledge', () => {
      if (kind === 'knower') roomTab = 'knowers';
      navigate(knowledgeHash(worldId));
    }));
    root.appendChild(header);
    const empty = document.createElement('div');
    empty.className = 'atlas-knowledge-empty';
    empty.innerHTML = `
      <p class="atlas-knowledge-empty-title">${kind === 'knower' ? 'Knower not found.' : 'Knowledge entry not found.'}</p>
      <p class="atlas-knowledge-hint">It may still be loading, or it no longer exists in this world.</p>
    `;
    root.appendChild(empty);
  }

  /**
   * Promote two individual knowers to a circle (S265). The create modal IS
   * the confirm: it opens titled with the question, name prefilled from both
   * characters, members already wired via extraData. Cancel = nothing
   * changes; Create = the circle becomes the holder and narrator clears.
   */
  function openPromoteToCircle(firstId: string, secondId: string, ctx: EditorCtx): void {
    const nameOf = (id: string): string =>
      getState().data.elements.find(e => e.id === id)?.name || '(unnamed)';
    new ElementCreateModal(toasts, {
      initialType: 'collective',
      initialName: `${nameOf(firstId)} & ${nameOf(secondId)}`,
      suppressNavigate: true,
      title: 'Two knowers make a circle',
      extraData: { subtype: CIRCLE_SUBTYPE, characters: [firstId, secondId] },
      onCreated: (id, type) => {
        if (type !== 'collective') {
          // User flipped the category — the promote intent is void; strip the
          // circle machinery the extraData planted (same guard as openNewCircle).
          void patchEntry(id, { subtype: '', characters: [] });
          return;
        }
        ctx.addCircle(id);
        ctx.setNarrator(null);
        toasts.info('Both knowers now hold this through the circle.');
      },
    }).open();
  }

  /** Open the "new circle" create modal (collective + circle tag). Shared by
   *  the knowers-tab action, the empty-state CTA, and the entry WHO zone
   *  (K9 — pass onCircle to adopt the fresh circle as a holder). */
  function openNewCircle(onCircle?: (id: string) => void): void {
    new ElementCreateModal(toasts, {
      initialType: 'collective',
      suppressNavigate: true,
      title: 'New circle',
      // Circle tag (organizational only — convention #72) lands in the same
      // write as the create, so it surfaces in this list even before holding
      // anything. Guarded: a user who flips the category in the modal
      // shouldn't mint e.g. a circle-subtyped location.
      extraData: { subtype: CIRCLE_SUBTYPE },
      onCreated: (id, type) => {
        if (type !== 'collective') void patchEntry(id, { subtype: '' });
        else onCircle?.(id);
      },
    }).open();
  }

  // ---- home view (Entries | Knowers tabs) ------------------------------------

  function buildHome(): void {
    const worldId = wid()!;
    root.innerHTML = '';
    heldByMount = aboutMount = null;
    mountedResolved = true;
    lastBuiltElementsRef = getState().data.elements;

    const header = document.createElement('header');
    header.className = 'atlas-room-header';
    header.innerHTML = `
      <h1>Knowledge</h1>
      <p class="atlas-room-subtitle">
        What your characters and collectives know about each other and the world.
      </p>
    `;
    root.appendChild(header);

    // [Entries | Knowers] room-section tabs (the shared D1 pattern) + per-tab
    // action on the right. Switching tabs swaps only the action slot + the
    // list body — the header and tab row are built once, so there's no flash
    // or focus loss (audit 239 #18).
    const actionSlot = document.createElement('span');
    actionSlot.className = 'atlas-room-tabs-action';
    const tabs = makeRoomTabs(
      [
        { key: 'entries', label: 'Entries', icon: 'article' },
        { key: 'knowers', label: 'Knowers', icon: 'groups' },
      ],
      roomTab,
      (key) => { roomTab = key as 'entries' | 'knowers'; lastRoomTab = roomTab; renderBody(); },
      { trailing: actionSlot },
    );
    root.appendChild(tabs.el);

    const listContainer = document.createElement('div');
    listContainer.className = 'atlas-knowledge-home-body';
    root.appendChild(listContainer);

    const renderBody = (): void => {
      tabs.set(roomTab);
      actionSlot.innerHTML = '';
      listContainer.innerHTML = '';
      if (roomTab === 'entries') {
        const newBtn = document.createElement('button');
        newBtn.type = 'button';
        newBtn.className = 'atlas-btn-ghost atlas-knowledge-new';
        newBtn.title = 'Create a new knowledge entry';
        newBtn.textContent = '+ New knowledge entry';
        newBtn.addEventListener('click', () => navigate(knowledgeHash(worldId, NEW)));
        // No "New" actions on a view-only world (conv. 149); "Open known world" reads.
        if (!viewOnly) actionSlot.appendChild(newBtn);
        buildEntriesList(worldId, listContainer);
      } else {
        const viewAs = document.createElement('button');
        viewAs.type = 'button';
        viewAs.className = 'atlas-btn-ghost atlas-knowledge-viewas';
        viewAs.title = 'See the world as any character knows it';
        viewAs.textContent = 'Open known world →';
        viewAs.addEventListener('click', async () => {
          const p = await pickElement({ restrictToType: 'character', title: 'View the world as…' });
          if (p) navigate(knowledgeKnowerHash(worldId, p.id));
        });
        const newCircle = document.createElement('button');
        newCircle.type = 'button';
        newCircle.className = 'atlas-btn-ghost atlas-knowledge-newcircle';
        newCircle.title = 'Create a circle (a collective acting as a knower-group)';
        newCircle.textContent = '+ New circle';
        newCircle.addEventListener('click', () => openNewCircle());
        actionSlot.append(viewAs);
        if (!viewOnly) actionSlot.append(newCircle);
        buildKnowersList(worldId, listContainer);
      }
    };

    lastRoomTab = roomTab;
    renderBody();
  }

  function buildEntriesList(worldId: string, container: HTMLElement): void {
    const entries = listKnowledgeEntries(getState().data.elements)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'atlas-knowledge-empty';
      if (viewOnly) {
        empty.innerHTML = '<p class="atlas-knowledge-empty-title">No knowledge entries in this world.</p>';
        container.appendChild(empty);
        return;
      }
      empty.innerHTML = `
        <p class="atlas-knowledge-empty-title">No knowledge entries yet.</p>
        <p class="atlas-knowledge-hint">
          Create one to record something known in your world: a secret, a rumor,
          a fact. Then assign who holds it, a character or a circle.
        </p>
      `;
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'atlas-btn-ghost atlas-knowledge-empty-cta';
      cta.textContent = '+ New knowledge entry';
      cta.addEventListener('click', () => navigate(knowledgeHash(worldId, NEW)));
      empty.appendChild(cta);
      container.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'atlas-knowledge-list';
    for (const entry of entries) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'atlas-knowledge-row';
      row.title = `Open ${entry.name || 'this entry'}`;
      row.innerHTML = `
        <span class="material-symbols-outlined atlas-knowledge-row-icon">menu_book</span>
        <span class="atlas-knowledge-row-main">
          <span class="atlas-knowledge-row-name">${escapeText(entry.name || '(unnamed)')}</span>
          <span class="atlas-knowledge-row-meta">${escapeText(holderSummary(entry))}</span>
        </span>
      `;
      row.addEventListener('click', () => navigate(knowledgeHash(worldId, entry.id)));
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  /** "held by Ireena", "held by the party +2", or "no holders yet". */
  function holderSummary(entry: Element): string {
    const held = heldByOf(entry);
    const ids = [...(held.narrator ? [held.narrator] : []), ...held.collectives];
    if (ids.length === 0) return 'No holders yet';
    const first = elOf(ids[0])?.name || '(unnamed)';
    return ids.length === 1 ? `Held by ${first}` : `Held by ${first} +${ids.length - 1}`;
  }

  function buildKnowersList(worldId: string, container: HTMLElement): void {
    const elements = getState().data.elements;
    const knowers = listKnowers(elements);

    if (knowers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'atlas-knowledge-empty';
      if (viewOnly) {
        empty.innerHTML = '<p class="atlas-knowledge-empty-title">No knowers in this world.</p>';
        container.appendChild(empty);
        return;
      }
      empty.innerHTML = `
        <p class="atlas-knowledge-empty-title">No knowers yet.</p>
        <p class="atlas-knowledge-hint">
          Assign a character or circle in an entry's "Who knows this", or create a
          circle here to set one up before it holds anything.
        </p>
      `;
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'atlas-btn-ghost atlas-knowledge-empty-cta';
      cta.textContent = '+ New circle';
      cta.addEventListener('click', () => openNewCircle());
      empty.appendChild(cta);
      container.appendChild(empty);
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
      if (knownCount > 0) meta.push(`knows about ${knownCount} element${knownCount === 1 ? '' : 's'}`);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'atlas-knowledge-row';
      row.title = `Open the known world of ${k.name || 'this knower'}`;
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
    container.appendChild(list);
  }

  // ---- known-view (K4) --------------------------------------------------------

  function buildKnower(knowerId: string): void {
    const worldId = wid()!;
    const elements = getState().data.elements;
    const knower = elOf(knowerId);
    if (!knower || !isKnowerType(knower.type)) {
      renderNotFound('knower');
      return;
    }
    root.innerHTML = '';
    heldByMount = aboutMount = null;
    mountedResolved = true;
    lastBuiltElementsRef = elements;

    const isCircle = knower.type === 'collective';
    const held = knowledgeHeldBy(knowerId, elements);
    const knownIds = elementsKnownAboutBy(knowerId, elements);

    const header = document.createElement('div');
    header.className = 'atlas-middle-header atlas-knowledge-knower-header';
    // D1 drill-in: the clickable room-name prefix IS the back affordance.
    header.appendChild(makeDrillInPrefix('Knowledge', () => {
      roomTab = 'knowers';
      navigate(knowledgeHash(worldId));
    }));

    const kicon = document.createElement('span');
    kicon.className = 'material-symbols-outlined atlas-knowledge-knower-icon';
    kicon.textContent = isCircle ? 'groups' : (ELEMENT_ICONS[knower.type] ?? 'person');
    header.appendChild(kicon);

    knowerTitleHandle = makeEditableTitle({
      initial: knower.name || '',
      placeholder: '(unnamed)',
      ariaLabel: 'Knower name',
      readOnly: viewOnly,
      onCommit: (next) => {
        const current = elOf(knowerId)?.name || '';
        if (next && next !== current) void patchEntry(knowerId, { name: next });
      },
    });
    header.appendChild(knowerTitleHandle.el);

    const metaBits: string[] = [];
    if (isCircle) {
      const members = circleMembers(knowerId, elements).length;
      metaBits.push(`circle · ${members} member${members === 1 ? '' : 's'}`);
    }
    metaBits.push(`holds ${held.length} ${held.length === 1 ? 'entry' : 'entries'}`);
    if (knownIds.length > 0) metaBits.push(`knows about ${knownIds.length} element${knownIds.length === 1 ? '' : 's'}`);
    const meta = document.createElement('span');
    meta.className = 'atlas-knowledge-knower-meta';
    meta.textContent = metaBits.join(' · ');
    header.appendChild(meta);

    const spacer = document.createElement('div');
    spacer.className = 'atlas-middle-spacer';
    header.appendChild(spacer);
    // Lens toggle — dims everything this knower doesn't know in the elements
    // sidebar (DESIGN_KNOWLEDGE.md "Known-view lens"). Persists across rooms;
    // the sidebar banner carries the always-visible exit. Active-state class
    // is also updated locally because a ui-only patch doesn't rebuild this
    // view (the same-elements tick guard skips it).
    const lensActive = () => getState().ui.knowledgeLens?.knowerId === knowerId;
    const lensBtn = document.createElement('button');
    lensBtn.type = 'button';
    lensBtn.className = 'atlas-knowledge-lens-toggle' + (lensActive() ? ' is-active' : '');
    lensBtn.title = 'Dim everything this knower doesn\'t know (elements sidebar)';
    lensBtn.setAttribute('aria-pressed', String(lensActive()));
    lensBtn.innerHTML = `<span class="material-symbols-outlined">visibility</span> Lens`;
    lensBtn.addEventListener('click', () => {
      const next = lensActive() ? null : { knowerId };
      patchSlice('ui', { ...getState().ui, knowledgeLens: next });
      lensBtn.classList.toggle('is-active', next !== null);
      lensBtn.setAttribute('aria-pressed', String(next !== null));
    });
    header.appendChild(lensBtn);

    // The Knowledge→Sharing bridge (DESIGN_SHARING "Knowledge Integration"):
    // mint a page pre-filled with this knower's circle block, land in the
    // share room ready to publish. The DM's core flow.
    const makePage = document.createElement('button');
    makePage.type = 'button';
    makePage.className = 'atlas-knowledge-allfields';
    makePage.title = 'Create a sharing page from this knowledge (a circle block, ready to publish)';
    makePage.textContent = 'Create page →';
    makePage.addEventListener('click', () => {
      void (async () => {
        const folder = getActiveStore();
        if (!folder) return;
        // A page carrying this knower's circle block may already exist —
        // open it instead of minting a duplicate every click (parked call
        // #2, settled 2026-07-03).
        const existing = listPages(getState().data.elements).find(p =>
          blocksOf(p).some(b => b.kind === 'circle' && b.knowerId === knower.id));
        if (existing) {
          toasts.info(`Opened the existing page for this circle: "${existing.name || '(unnamed)'}"`);
          navigate(shareHash(worldId, existing.id));
          return;
        }
        const blocks: PageBlock[] = [{ id: newBlockId(), kind: 'circle', knowerId: knower.id }];
        const resolveName = (id: string) => elOf(id)?.name || null;
        try {
          const created = await folder.createElement('narrative', {
            name: `What ${knower.name || 'they'} know${knower.type === 'character' ? 's' : ''}`,
            subtype: PAGE_SUBTYPE,
            atlas_page_intent: 'reference',
            ...pageBlocksPatch(blocks, resolveName),
          } as Partial<Element>);
          await refreshElementsAfterWrite(folder);
          requestPushIfLinked();
          navigate(shareHash(worldId, created.id));
        } catch (err) {
          console.error('[knowledge-room] create page failed', err);
          showProblem(err, { doing: 'creating the page', toasts });
        }
      })();
    });
    // Not on a view-only world: it creates a page (conv. 149).
    if (!viewOnly) header.appendChild(makePage);

    const openEl = document.createElement('button');
    openEl.type = 'button';
    openEl.className = 'atlas-knowledge-allfields';
    openEl.title = 'Open in the full element editor';
    openEl.textContent = 'Open element →';
    openEl.addEventListener('click', () => navigate(elementHash(worldId, knower.id)));
    header.appendChild(openEl);
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
      none.textContent = viewOnly
        ? 'Holds no knowledge yet.'
        : 'Holds no knowledge yet. Assign it in an entry\'s "Who knows this".';
      heldSection.appendChild(none);
    } else {
      const list = document.createElement('div');
      list.className = 'atlas-knowledge-list';
      for (const entry of held.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'atlas-knowledge-row';
        row.title = `Open ${entry.name || 'this entry'}`;
        row.innerHTML = `
          <span class="material-symbols-outlined atlas-knowledge-row-icon">menu_book</span>
          <span class="atlas-knowledge-row-main">
            <span class="atlas-knowledge-row-name">${escapeText(entry.name || '(unnamed)')}</span>
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
      <p class="atlas-knowledge-section-hint">The world as ${escapeText(knower.name || 'they')} knows it: compiled from held entries, not the canonical records.</p>`;
    if (knownIds.length === 0) {
      const none = document.createElement('p');
      none.className = 'atlas-knowledge-none';
      none.textContent = held.length === 0
        ? 'Nothing known yet.'
        : viewOnly
          ? 'Held entries have no subjects yet.'
          : 'Held entries have no subjects yet. Mention elements in their text, or add subjects.';
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
          // Entry text is markdown with ow:// mentions — render it (chips for
          // mentions), never the raw `[Name](ow://…)` source (audit 239 #1).
          if (story.trim()) {
            const text = renderProseFragment(story, new Map(getState().data.elements.map(e => [e.id, e])));
            text.classList.add('atlas-knowledge-known-text');
            quote.appendChild(text);
          } else {
            const text = document.createElement('div');
            text.className = 'atlas-knowledge-known-text';
            text.textContent = '(no text; the entry only references it)';
            quote.appendChild(text);
          }
          const src = document.createElement('button');
          src.type = 'button';
          src.className = 'atlas-knowledge-known-src';
          src.textContent = `From ${entry.name || '(unnamed)'}`;
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
    // Waypoint (hookmap wp4): the held-by/about ADD handlers are link-creating
    // gestures; removals and the shared patchEntry helper stay unhooked.
    return {
      heldBy: () => heldByOf(cur()),
      setNarrator: (id) => { void patchEntry(entryId, { narrator: id }); if (id) completeWaypoint('links'); },
      addCircle: (id) => { void patchEntry(entryId, { collectives: [...heldByOf(cur()).collectives, id] }); completeWaypoint('links'); },
      removeCircle: (id) => { void patchEntry(entryId, { collectives: heldByOf(cur()).collectives.filter(c => c !== id) }); },
      aboutIds: () => aboutIdsOf(cur()),
      addAbout: (id) => {
        const t = elOf(id)?.type;
        const f = t ? aboutFieldFor(t) : null;
        if (!f) return;
        const arr = (cur() as Record<string, unknown>)[f];
        const list = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
        if (!list.includes(id)) { void patchEntry(entryId, { [f]: [...list, id] }); completeWaypoint('links'); }
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
      renderNotFound('entry');
      return;
    }
    mountedResolved = true;
    let draftRestored = false;
    if (isDraft && !draft) {
      // Restore an abandoned draft from the per-world stash; fresh otherwise.
      const stashed = loadDraftStash(worldId);
      if (stashed && (stashed.name || stashed.story || stashed.narrator
        || stashed.collectives.length || stashed.aboutIds.length)) {
        draftRestored = true;
      }
      draft = stashed
        ?? { name: '', story: '', richtextJson: null, narrator: null, collectives: [], aboutIds: [] };
    }

    root.innerHTML = '';

    // Unified entity header (canon): compact band + click-to-edit title, no
    // separate Name field. Same `.atlas-middle-header` the element editor uses.
    const header = document.createElement('div');
    header.className = 'atlas-middle-header atlas-knowledge-entry-header';
    // D1 drill-in: the clickable room-name prefix IS the back affordance.
    header.appendChild(makeDrillInPrefix('Knowledge', () => navigate(knowledgeHash(worldId))));

    const kicon = document.createElement('span');
    kicon.className = 'material-symbols-outlined';
    kicon.textContent = 'menu_book';
    kicon.title = 'Knowledge entry';
    header.appendChild(kicon);

    entryTitleHandle = makeEditableTitle({
      initial: isDraft ? draft!.name : (entry!.name || ''),
      placeholder: 'What is known…',
      ariaLabel: 'Knowledge entry name',
      readOnly: viewOnly,
      onCommit: (next) => {
        if (isDraft) { draft!.name = next; persistDraft(); }
        else {
          // Compare against CURRENT state, not the build-time snapshot.
          const current = elOf(entryId!)?.name || '';
          if (next && next !== current) void patchEntry(entryId!, { name: next });
        }
      },
    });
    header.appendChild(entryTitleHandle.el);
    // Last changed by an agent, said quietly, as on the element page (#350).
    entryAgentMark = mountAgentMarkSlot();
    if (!isDraft) entryAgentMark.sync(entry!);
    header.appendChild(entryAgentMark.el);

    const spacer = document.createElement('div');
    spacer.className = 'atlas-middle-spacer';
    header.appendChild(spacer);

    if (!isDraft) {
      const allFields = document.createElement('button');
      allFields.type = 'button';
      allFields.className = 'atlas-knowledge-allfields';
      allFields.title = 'Open in the full element editor (all fields)';
      allFields.textContent = 'All fields →';
      allFields.addEventListener('click', () => navigate(elementHash(worldId, entry!.id)));
      header.appendChild(allFields);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'atlas-knowledge-delete';
      del.title = 'Delete this knowledge entry';
      del.innerHTML = `<span class="material-symbols-outlined">delete</span>`;
      del.addEventListener('click', () => { void deleteEntry(entry!.id); });
      // Not on a view-only world (conv. 149).
      if (!viewOnly) header.appendChild(del);
    }
    root.appendChild(header);

    const body = document.createElement('div');
    body.className = 'atlas-knowledge-detail';
    root.appendChild(body);

    // (Name lives in the header as the editable title — no separate field.)

    const ctx = makeCtx(entryId);

    // D4: three zones in reading order — WHO holds it, WHAT they know,
    // ABOUT whom. Short labels, no explainer paragraphs: the room subtitle
    // carries the model, the zones' shape tells the story.

    // WHO — one chips band (character + circles + inline add/create).
    const whoSection = document.createElement('section');
    whoSection.className = 'atlas-knowledge-section atlas-knowledge-zone-who';
    whoSection.innerHTML = `<h2 class="atlas-knowledge-section-title">Who knows this
      <span class="material-symbols-outlined atlas-section-hint" role="note" aria-label="One character can hold knowledge directly. Two or more knowers become a circle: any collective can hold knowledge, and its members inherit it." data-tip="One character can hold knowledge directly. Two or more knowers become a circle: any collective can hold knowledge, and its members inherit it.">help</span></h2>`;
    heldByMount = document.createElement('div');
    whoSection.appendChild(heldByMount);
    body.appendChild(whoSection);
    renderHeldBy(heldByMount, ctx);

    // WHAT — the text, dominant. The embedded writing editor (K3), lazy-loaded.
    const proseSection = document.createElement('section');
    proseSection.className = 'atlas-knowledge-section atlas-knowledge-zone-what';
    proseSection.innerHTML = `<h2 class="atlas-knowledge-section-title">What they know</h2>${viewOnly ? '' : `
      <p class="atlas-knowledge-section-hint">Type @ to mention an element.</p>`}`;
    const proseHost = document.createElement('div');
    // Reuses the writing prose CSS (typography, chips, autolink hints) — the
    // writing-room :has() chrome rules key off .atlas-writing-workspace, which
    // has no ancestor here, so none of that leaks.
    proseHost.className = 'atlas-writing-workspace-prose atlas-knowledge-prose-rich';
    proseHost.innerHTML = '<div class="atlas-knowledge-prose-loading">Loading editor…</div>';
    proseSection.appendChild(proseHost);
    body.appendChild(proseSection);

    // ABOUT — quiet derived/manual subject chips.
    const aboutSection = document.createElement('section');
    aboutSection.className = 'atlas-knowledge-section atlas-knowledge-zone-about';
    aboutSection.innerHTML = `<h2 class="atlas-knowledge-section-title">About</h2>`;
    aboutMount = document.createElement('div');
    aboutSection.appendChild(aboutMount);
    body.appendChild(aboutSection);
    if (isDraft) refreshDraftAbout(ctx);
    else renderAbout(aboutMount, ctx);

    void mountProseEditor(proseHost, isDraft ? NEW : entryId!, ctx);

    // Draft actions
    if (isDraft) {
      const actions = document.createElement('div');
      actions.className = 'atlas-knowledge-draft-actions';
      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'atlas-btn-primary';
      create.textContent = 'Create';
      create.addEventListener('click', () => { void createFromDraft(); });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'atlas-btn-ghost';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        draft = null;
        clearDraftStash(worldId);
        navigate(knowledgeHash(worldId));
      });
      actions.appendChild(create);
      actions.appendChild(cancel);
      body.appendChild(actions);
    }

    if (draftRestored) toasts.info('Restored your unsaved draft.');
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
      host.innerHTML = '';
      const fail = document.createElement('div');
      fail.className = 'atlas-knowledge-prose-loading';
      fail.append('Editor failed to load. ');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'atlas-knowledge-allfields';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => { void mountProseEditor(host, forId, ctx); });
      fail.appendChild(retry);
      host.appendChild(fail);
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
    // A reload after an outside `story` edit skips the stale rich-text copy (S364).
    const skipSidecar = !isDraft && preferStoryFor === forId;
    preferStoryFor = null;
    const initialJson = isDraft
      ? (draft?.richtextJson ?? null)
      : skipSidecar ? null
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
          // Holder toast is independent of the derived-key gate: a collective
          // never changes the derived set (excluded from about), so an
          // autolink-converted circle would otherwise miss the lesson.
          if (proseMentionsCollective(snap.markdown)) maybeToastDroppedCollective();
          // Refresh the About chips only when the derived set actually changed.
          const key = derivedAboutIds(snap.markdown).slice().sort().join(',');
          if (key !== lastDerivedKey) refreshDraftAbout(ctx);
        } else {
          scheduleEditorSave(snap);
        }
      },
    });
    // The baseline is the editor's own serialisation of what it loaded (S364
    // gate, lens B B1 / lens C C2): an untouched entry must never write.
    if (!isDraft) lastSavedMarkdown = editorMount.getMarkdown();
  }

  /** Same-view tick (saved editor): refresh chips + title + editor decorations; leave inputs alone. */
  function refreshEditorData(entryId: string): void {
    const el = elOf(entryId);
    if (!el) {
      // Entry vanished from the cache mid-view (server delete pulled in, or
      // an id-swap re-keyed it — the route migration follows momentarily).
      destroyEditorSession();
      renderNotFound('entry');
      return;
    }
    // Sync the header title (no-op while the user is editing it).
    entryTitleHandle?.sync(el.name || '');
    entryAgentMark?.sync(el);
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
      root.innerHTML = '<div class="atlas-pane-empty">No world open. Pick one from the sidebar.</div>';
      destroyEditorSession();
      mountedView = null;
      return;
    }
    const route = parseHash(window.location.hash);
    const kid = route.mode === 'knowledge' ? route.knowledgeId : undefined;
    const knowerId = route.mode === 'knowledge' ? route.knowerId : undefined;
    // A view-only world has no draft: a link to the new-entry route shows the list (conv. 149).
    const tgt = knowerId ? `knower:${knowerId}` : (!kid || (kid === NEW && viewOnly) ? 'list' : kid);

    if (tgt === mountedView) {
      if (!mountedResolved) {
        // Not-found interim — retry a full build (resolves once the element
        // cache catches up; stays on the interim otherwise).
        if (tgt === 'list') buildHome();
        else if (tgt.startsWith('knower:')) buildKnower(knowerId!);
        else if (tgt === NEW) buildEditor(null);
        else buildEditor(tgt);
        return;
      }
      if (tgt === 'list') {
        if (getState().data.elements !== lastBuiltElementsRef) rebuildPreservingScroll(buildHome);
      } else if (tgt.startsWith('knower:')) {
        // Never under a focused rename of the knower (S364 gate, lens C C4):
        // the rebuild blurs it and the blur commits half a name. Deferred to
        // the focusout below.
        if (getState().data.elements !== lastBuiltElementsRef && isEditingIn(root)) knowerRebuildDeferred = true;
        else if (getState().data.elements !== lastBuiltElementsRef) rebuildPreservingScroll(() => buildKnower(knowerId!));
        else {
          // ui-only tick (e.g. lens cleared via the sidebar banner ×) — keep
          // the toggle's active class honest without a rebuild.
          const btn = root.querySelector('.atlas-knowledge-lens-toggle');
          const lensOn = getState().ui.knowledgeLens?.knowerId === knowerId;
          btn?.classList.toggle('is-active', lensOn);
          btn?.setAttribute('aria-pressed', String(lensOn));
        }
      } else if (tgt === NEW) refreshDraftData();
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

  /**
   * Full rebuild that keeps the user's scroll position (the room root is the
   * scroll container — `.atlas-knowledge-room { overflow-y: auto }`). Used on
   * same-view data ticks; view SWITCHES rebuild without this so new content
   * starts at the top.
   */
  function rebuildPreservingScroll(build: () => void): void {
    const st = root.scrollTop;
    build();
    queueMicrotask(() => { root.scrollTop = st; });
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
    document.removeEventListener('atlas:disk-changes', onDiskChanges);
    root.removeEventListener('focusout', onRootFocusOut);
    unLeaveWorld();
    unsubState();
    unsubHash();
  };
}
