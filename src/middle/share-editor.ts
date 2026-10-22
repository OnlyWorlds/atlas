/**
 * Share-page prose editor — the writing editor component embedded in a page's
 * prose BLOCK (DESIGN_SHARING.md, S2).
 *
 * LAZY-LOADED: share-room reaches this module via dynamic `import()` only
 * when a prose block enters edit mode, so TipTap stays in its code-split
 * chunk (same boundary as writing.ts → writing-workspace and the knowledge
 * editor).
 *
 * Even more trimmed than the knowledge variant: TipTap + @-mentions + element
 * chips + chip hover preview + right-click (create-from-selection /
 * unlink-chip). Page prose is PRESENTATION — mentions render chips for
 * cross-reference, but deliberately NO relation-derive runs and NO element
 * fields are ever written from here (the page's element bindings live in its
 * element-card blocks; see core/sharing.ts). Unlink is purely prose-level.
 *
 * Persistence stays in share-room: this module emits `onSnapshot` per
 * transaction; the room debounces + folds the snapshot into the block stack
 * via `pageBlocksPatch`.
 */

import { getState } from '../core/state';
import { escapeText } from '../core/dom-utils';
import { mountWorkspaceEditor, type WorkspaceEditorHandle } from './writing-workspace-editor';
import { buildMentionItems } from './writing-workspace-mention-items';
import { createChipPreview, type ChipPreviewController } from './writing-workspace-chip-preview';
import { pushRecent } from './writing-workspace-recents';
import { linkSelectionToExisting } from './prose-link-existing';
import { mountSelectionBubble, type SelectionBubbleController } from './prose-selection-bubble';
import { ElementCreateModal } from '../ui/element-create-modal';
import type { ToastManager } from '../ui/toast-manager';
import type { Element } from '../core/types';
import type { JSONContent } from '@tiptap/core';
import { currentLore } from '../core/parlor-room';

export interface ShareEditorOptions {
  /** Prose host — the editor takes over this element (already carries the prose CSS class). */
  host: HTMLElement;
  /** Share room root — context-menu scope + chip-preview anchor. */
  roomRoot: HTMLElement;
  initialJson: JSONContent | null;
  initialMarkdown: string;
  /** Fired on every editor transaction. Debouncing is the caller's concern. */
  onSnapshot: (snap: { markdown: string; json: JSONContent }) => void;
  toasts: ToastManager;
}

export interface ShareEditorHandle {
  /** Same-view tick refresh: chip-label rename sync + autolink index rebuild. */
  refresh(elements: Element[]): void;
  getMarkdown(): string;
  getJson(): JSONContent;
  focus(): void;
  destroy(): void;
}

export function mountShareEditor(opts: ShareEditorOptions): ShareEditorHandle {
  const { host, roomRoot, toasts } = opts;

  const chipPreview: ChipPreviewController = createChipPreview(roomRoot);

  const editorHandle: WorkspaceEditorHandle = mountWorkspaceEditor({
    target: host,
    initialJson: opts.initialJson,
    initialMarkdown: opts.initialMarkdown,
    autolinkSeed: { elements: currentLore() },
    onUpdate: (snap) => {
      opts.onSnapshot({ markdown: snap.markdown, json: snap.json });
    },
    mentionItems: (query) => buildMentionItems(query),
    onChipHover: (chip, id, type) => chipPreview.scheduleHoverShow(chip, id, type),
    onChipUnhover: () => chipPreview.scheduleHoverHide(),
    onChipClick: (_chip, id, _type) => {
      chipPreview.hideNow();
      document.dispatchEvent(new CustomEvent('atlas:context-select-element', {
        detail: { id },
      }));
    },
    onMentionInserted: (id) => {
      const worldId = getState().active?.worldId;
      if (worldId) pushRecent(worldId, id);
    },
  });

  // ---- right-click menu (page-prose variant: unlink is prose-only) -----------

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

  function openLinkExisting(): void {
    void linkSelectionToExisting(() => editorHandle, {
      onLinked: (id) => {
        const worldId = getState().active?.worldId;
        if (worldId) pushRecent(worldId, id);
      },
    });
  }

  const onContextMenu = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.atlas-share-prose-rich .ProseMirror')) return;
    const editor = editorHandle.editor;
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;

    // Chip under the cursor → "Unlink {label}" (prose-level only — no field
    // writes; page prose never owns element relations).
    const chipDom = target.closest<HTMLElement>('.atlas-element-chip');
    let chipHit: { label: string; from: number; to: number } | null = null;
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
            label: (chipNode.attrs?.label as string) || '',
            from: chipStart,
            to: chipStart + chipNode.nodeSize,
          };
        }
      }
    }

    if (!hasSelection && !chipHit) return; // native menu

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
    if (hasSelection) {
      items.push(`
        <button type="button" class="atlas-prose-context-menu-item" data-role="link-existing">
          <span class="material-symbols-outlined">add_link</span>
          <span>Link to existing element…</span>
        </button>
      `);
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
    menu.querySelector<HTMLElement>('[data-role="link-existing"]')?.addEventListener('click', () => {
      dismissMenu();
      openLinkExisting();
    });
    menu.querySelector<HTMLElement>('[data-role="unlink-chip"]')?.addEventListener('click', () => {
      dismissMenu();
      if (chipHit) {
        editorHandle.editor
          .chain()
          .focus()
          .insertContentAt({ from: chipHit.from, to: chipHit.to }, chipHit.label || '')
          .run();
      }
    });
    queueMicrotask(() => {
      document.addEventListener('mousedown', onMenuOutside, true);
      document.addEventListener('keydown', onMenuKey, true);
    });
  };
  roomRoot.addEventListener('contextmenu', onContextMenu);

  // ---- selection bubble (B / I / link — the marks worked via Ctrl+B/I all
  // along; this makes them visible. Captain's ask, 2026-07-19) ----------------

  const bubble: SelectionBubbleController = mountSelectionBubble({
    getHandle: () => editorHandle,
    onLinkExisting: openLinkExisting,
  });

  // ---- handle -----------------------------------------------------------------

  let lastSeenElementsRef: Element[] | null = getState().data.elements;

  return {
    refresh(elements: Element[]): void {
      syncLabels(editorHandle, elements);
      // The autolink index reads the lore (conv. 161); its identity moves with the room's switch too.
      const lore = currentLore();
      if (lore !== lastSeenElementsRef) {
        editorHandle.refreshAutolink(lore);
        lastSeenElementsRef = lore;
      }
    },
    getMarkdown: () => editorHandle.getMarkdown(),
    getJson: () => editorHandle.getJson(),
    focus: () => editorHandle.editor.commands.focus(),
    destroy: () => {
      roomRoot.removeEventListener('contextmenu', onContextMenu);
      dismissMenu();
      bubble.destroy();
      chipPreview.destroy();
      editorHandle.destroy();
    },
  };
}

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

