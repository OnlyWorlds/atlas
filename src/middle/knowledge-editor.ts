/**
 * Knowledge prose editor — the writing editor component embedded in the
 * knowledge room (DESIGN_KNOWLEDGE.md "Authoring", K3).
 *
 * LAZY-LOADED: knowledge-room reaches this module via dynamic `import()` only
 * when an editor view mounts, so TipTap stays in its code-split chunk (same
 * boundary as writing.ts → writing-workspace).
 *
 * Trimmed surface — TipTap + @-mentions + element chips + autolink + chip
 * hover preview + right-click (create-from-selection / link-autolink /
 * unlink-chip). Deliberately NOT taken from the writing room: sticky bar,
 * word count/goal, focus + reading modes, find bar, split, compiled view,
 * font picker — writing furniture; knowledge prose is a few paragraphs.
 *
 * Persistence stays in knowledge-room (same split as editor vs workspace):
 * this module emits `onSnapshot` per transaction; the room debounces + saves
 * (saved entries) or updates the draft + stash (draft mode).
 *
 * Holder-protection (convention #68): mentioning a Collective inserts a chip
 * (legitimate prose reference) but the room's save path never writes it to
 * `collectives` — and THIS module toasts once per mount when it happens, so
 * the writer learns where holdership actually lives. Unlink likewise never
 * touches the `collectives` field.
 */

import { getState } from '../core/state';
import { worldIsViewOnly } from '../core/view-only';
import { escapeText } from '../core/dom-utils';
import { aboutFieldFor } from '../core/knowledge';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { getActiveStore } from '../core/active-store';
import { mountWorkspaceEditor, type WorkspaceEditorHandle } from './writing-workspace-editor';
import { noteOpenedFromStory } from './story-notice';
import { buildMentionItems } from './writing-workspace-mention-items';
import { createChipPreview, type ChipPreviewController } from './writing-workspace-chip-preview';
import { createLinkAllCorner } from './prose-linkall-corner';
import { pushRecent } from './writing-workspace-recents';
import { findAutolinkCandidateAt, convertAutolinkAt } from './writing-workspace-autolink';
import { ElementCreateModal } from '../ui/element-create-modal';
import { showProblem } from '../ui/problem-fixes';
import type { ToastManager } from '../ui/toast-manager';
import type { Element } from '../core/types';
import type { JSONContent } from '@tiptap/core';
import { currentLore } from '../core/parlor-room';

export interface KnowledgeEditorOptions {
  /** Prose host — the editor takes over this element (already carries the prose CSS class). */
  host: HTMLElement;
  /** Knowledge room root — context-menu scope + chip-preview anchor. */
  roomRoot: HTMLElement;
  initialJson: JSONContent | null;
  initialMarkdown: string;
  /** Fired on every editor transaction. Debouncing is the caller's concern. */
  onSnapshot: (snap: { markdown: string; json: JSONContent }) => void;
  toasts: ToastManager;
  /** Saved entry accessor — null in draft mode (unlink skips field removal). */
  getEntry: () => Element | null;
}

export interface KnowledgeEditorHandle {
  /** Same-view tick refresh: chip-label rename sync + autolink index rebuild. */
  refresh(elements: Element[]): void;
  getMarkdown(): string;
  getJson(): JSONContent;
  /** Focus the prose surface. */
  focus(): void;
  destroy(): void;
}

export function mountKnowledgeEditor(opts: KnowledgeEditorOptions): KnowledgeEditorHandle {
  const { host, roomRoot, toasts, getEntry } = opts;

  const chipPreview: ChipPreviewController = createChipPreview(roomRoot);
  let collectiveMentionToasted = false;
  // A view-only world reads the entry: prose read-only, no right-click
  // writes, no link-all corner (conv. 149). The room remounts per world.
  const viewOnly = worldIsViewOnly();

  const editorHandle: WorkspaceEditorHandle = mountWorkspaceEditor({
    target: host,
    initialJson: opts.initialJson,
    initialMarkdown: opts.initialMarkdown,
    // Drafts are Atlas's own two halves; a saved entry's `story` can have
    // changed outside.
    storyOutranksStaleSidecar: opts.getEntry() !== null,
    editable: !viewOnly,
    autolinkSeed: { elements: currentLore() },
    onUpdate: (snap) => {
      opts.onSnapshot({ markdown: snap.markdown, json: snap.json });
    },
    mentionItems: (query) => buildMentionItems(query),
    onChipHover: (chip, id, type) => chipPreview.scheduleHoverShow(chip, id, type),
    onChipUnhover: () => chipPreview.scheduleHoverHide(),
    onChipClick: (_chip, id, _type) => {
      // Same gesture as the writing room: select in the context pane (the
      // knowledge entry routes are wired as context subjects).
      chipPreview.hideNow();
      document.dispatchEvent(new CustomEvent('atlas:context-select-element', {
        detail: { id },
      }));
    },
    onMentionInserted: (id, type) => {
      const worldId = getState().active?.worldId;
      if (worldId) pushRecent(worldId, id);
      if (type === 'collective' && !collectiveMentionToasted) {
        collectiveMentionToasted = true;
        toasts.info('Mentioning a circle in the text doesn\'t add it as a holder. To share with the circle, add it under "Who knows this".');
      }
    },
  });

  // Apply the per-world spellcheck pref (same as the writing room).
  applySpellcheck(editorHandle);

  // Mount-time chip-label sync — covers richtext stored before renames.
  syncLabels(editorHandle, getState().data.elements);

  // ---- right-click menu (trimmed knowledge variant) ---------------------------

  let activeMenu: HTMLElement | null = null;
  function dismissMenu(): void {
    if (!activeMenu) return;
    activeMenu.remove();
    activeMenu = null;
    document.removeEventListener('mousedown', onMenuOutside, true);
    document.removeEventListener('keydown', onMenuKey, true);
  }
  const onMenuOutside = (e: MouseEvent): void => {
    if (!activeMenu || activeMenu.contains(e.target as Node)) return;
    dismissMenu();
  };
  const onMenuKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') dismissMenu();
  };

  function openInlineCreate(): void {
    const editor = editorHandle.editor;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const selectedText = editor.state.doc.textBetween(from, to, ' ', ' ').trim();
    if (!selectedText) return;
    new ElementCreateModal(toasts, {
      initialName: selectedText,
      suppressNavigate: true,
      title: 'Create element from selection',
      onCreated: (id, type) => {
        editorHandle.editor
          .chain()
          .focus()
          .insertContentAt({ from, to }, [
            { type: 'elementChip', attrs: { id, type, label: selectedText } },
          ])
          .run();
      },
    }).open();
  }

  /**
   * Unlink a chip: replace it with its plain label. For SAVED entries, if no
   * other mention of the element remains in the prose, also remove the id from
   * the entry's matching about-field — EXCEPT collectives (holders are managed
   * only via the Held-by editor, never as a side effect of prose edits).
   */
  async function unlinkChip(chip: { id: string; label: string; from: number; to: number }): Promise<void> {
    if (viewOnly) return; // the menu never opens there (conv. 149)
    const editor = editorHandle.editor;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: chip.from, to: chip.to }, chip.label || '')
      .run();

    const entry = getEntry();
    if (!entry) return; // draft — derived about-set recomputes from prose automatically
    const targetEl = getState().data.elements.find(e => e.id === chip.id);
    if (!targetEl) return;
    const field = aboutFieldFor(targetEl.type);
    if (!field) return; // collective (holder) or non-subject type — leave fields alone

    // Any other mention left? Other chips with the same id, or word-bounded
    // name/alias text matches.
    const markdown = editorHandle.getMarkdown();
    if (markdown.includes('/' + chip.id + ')')) return;
    const plainText = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n');
    const surfaceForms: string[] = [];
    if (targetEl.name) surfaceForms.push(targetEl.name);
    if (Array.isArray(targetEl.atlas_aliases)) {
      for (const a of targetEl.atlas_aliases) if (typeof a === 'string') surfaceForms.push(a);
    }
    for (const form of surfaceForms) {
      if (form.length < 2) continue;
      const escaped = form.replace(/[\\^$.*+?()\[\]{}|]/g, '\\$&');
      if (new RegExp('\\b' + escaped + '\\b').test(plainText)) return;
    }

    const existing = (entry as Record<string, unknown>)[field];
    if (!Array.isArray(existing)) return;
    const filtered = existing.filter((v): v is string => typeof v === 'string' && v !== chip.id);
    if (filtered.length === existing.length) return;
    const folder = getActiveStore();
    if (!folder) return;
    try {
      await folder.updateElement(entry.id, { [field]: filtered } as Partial<Element>);
      await refreshElementsAfterWrite(folder);
      requestPushIfLinked();
    } catch (err) {
      console.error('[knowledge-editor] unlink: field write failed', err);
      // No retry: the entry may have changed since, and this writes the whole list.
      showProblem(err, { doing: 'removing the link', toasts });
    }
  }

  const onContextMenu = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.atlas-knowledge-prose-rich .ProseMirror')) return;
    const editor = editorHandle.editor;
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;

    // Autolink hint under the cursor → "Link to {name}".
    const onHint = target.closest('.atlas-autolink-hint') !== null;
    let autolinkHit: { name: string; docPos: number } | null = null;
    if (onHint) {
      const probe = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (probe) {
        const found = findAutolinkCandidateAt(editor.view, probe.pos);
        if (found) autolinkHit = { name: found.candidate.displayName, docPos: probe.pos };
      }
    }

    // Chip under the cursor → "Unlink {label}".
    const chipDom = target.closest<HTMLElement>('.atlas-element-chip');
    let chipHit: { id: string; label: string; from: number; to: number } | null = null;
    if (chipDom) {
      const probe = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (probe) {
        const $pos = editor.state.doc.resolve(probe.pos);
        const nodeAfter = $pos.nodeAfter;
        const nodeBefore = $pos.nodeBefore;
        let chipNode: any = null;
        let chipStart = -1;
        if (nodeAfter && nodeAfter.type.name === 'elementChip') {
          chipNode = nodeAfter;
          chipStart = probe.pos;
        } else if (nodeBefore && nodeBefore.type.name === 'elementChip') {
          chipNode = nodeBefore;
          chipStart = probe.pos - nodeBefore.nodeSize;
        }
        if (chipNode) {
          chipHit = {
            id: chipNode.attrs?.id as string,
            label: (chipNode.attrs?.label as string) || '',
            from: chipStart,
            to: chipStart + chipNode.nodeSize,
          };
        }
      }
    }

    if (!hasSelection && !autolinkHit && !chipHit) return; // native menu

    e.preventDefault();
    dismissMenu();

    const items: string[] = [];
    if (chipHit) {
      items.push(`
        <button type="button" class="atlas-prose-context-menu-item" data-role="unlink-chip">
          <span class="material-symbols-outlined">link_off</span>
          <span>Unlink ${escapeText(chipHit.label || 'chip')}</span>
        </button>
      `);
    }
    if (autolinkHit) {
      items.push(`
        <button type="button" class="atlas-prose-context-menu-item" data-role="link-autolink">
          <span class="material-symbols-outlined">link</span>
          <span>Link to ${escapeText(autolinkHit.name)}</span>
        </button>
      `);
    }
    if (hasSelection) {
      items.push(`
        <button type="button" class="atlas-prose-context-menu-item" data-role="create">
          <span class="material-symbols-outlined">add</span>
          <span>Create element from selection</span>
        </button>
      `);
    }

    const menu = document.createElement('div');
    menu.className = 'atlas-prose-context-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = items.join('');
    menu.style.position = 'fixed';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.style.zIndex = '1000';
    document.body.appendChild(menu);
    activeMenu = menu;

    menu.querySelector<HTMLElement>('[data-role="create"]')?.addEventListener('click', () => {
      dismissMenu();
      openInlineCreate();
    });
    menu.querySelector<HTMLElement>('[data-role="link-autolink"]')?.addEventListener('click', () => {
      dismissMenu();
      if (autolinkHit) convertAutolinkAt(editorHandle.editor.view, autolinkHit.docPos);
    });
    menu.querySelector<HTMLElement>('[data-role="unlink-chip"]')?.addEventListener('click', () => {
      dismissMenu();
      if (chipHit) void unlinkChip(chipHit);
    });
    queueMicrotask(() => {
      document.addEventListener('mousedown', onMenuOutside, true);
      document.addEventListener('keydown', onMenuKey, true);
    });
  };
  // Every item writes; a view-only world keeps the browser's menu (conv. 149).
  if (!viewOnly) roomRoot.addEventListener('contextmenu', onContextMenu);

  // ---- handle -----------------------------------------------------------------

  let lastSeenElementsRef: Element[] | null = getState().data.elements;

  // The link-all corner. The knowledge room mounts the same editor with
  // the same autolink plugin into a host that already carries the writing
  // prose class, so it earns the same one-click affordance the writing room
  // has always had — it was simply never lifted here (the
  // "decision applied to ONE surface" class).
  const openedEntry = opts.getEntry();
  if (editorHandle.openedFromStory && openedEntry) noteOpenedFromStory(openedEntry.id, 'entry');

  const linkAllCorner = createLinkAllCorner({
    getHost: () => host,
    getView: () => editorHandle.editor.view,
    toasts,
  });
  const refreshCorner = (): void => { if (!viewOnly) linkAllCorner.refresh(); };
  editorHandle.editor.on('transaction', refreshCorner);
  refreshCorner();

  return {
    refresh(elements: Element[]): void {
      syncLabels(editorHandle, elements);
      // The autolink index reads the lore (conv. 161); its identity moves with the room's switch too.
      const lore = currentLore();
      if (lore !== lastSeenElementsRef) {
        editorHandle.refreshAutolink(lore);
        lastSeenElementsRef = lore;
      }
      applySpellcheck(editorHandle);
      // A rebuilt autolink index changes the hint count, so the badge has to
      // recount here as well as on transactions.
      refreshCorner();
    },
    getMarkdown: () => editorHandle.getMarkdown(),
    getJson: () => editorHandle.getJson(),
    focus: () => editorHandle.editor.commands.focus(),
    destroy: () => {
      roomRoot.removeEventListener('contextmenu', onContextMenu);
      dismissMenu();
      chipPreview.destroy();
      linkAllCorner.destroy();
      editorHandle.destroy();
    },
  };
}

// ---- small shared helpers -----------------------------------------------------

function syncLabels(handle: WorkspaceEditorHandle, elements: Element[]): void {
  const byId = new Map<string, { name: string; aliases: string[] }>();
  for (const e of elements) {
    byId.set(e.id, {
      name: e.name || '',
      aliases: Array.isArray(e.atlas_aliases) ? e.atlas_aliases : [],
    });
  }
  handle.syncChipLabels((id) => byId.get(id) ?? null);
}

function applySpellcheck(handle: WorkspaceEditorHandle): void {
  const state = getState();
  const active = state.active;
  if (!active) return;
  const entry = state.registry.worlds.find(w => w.id === active.worldId);
  const enabled = entry?.writing_spellcheck !== false;
  handle.editor.view.dom.setAttribute('spellcheck', enabled ? 'true' : 'false');
}

