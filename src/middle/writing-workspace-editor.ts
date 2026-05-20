/**
 * Writing workspace editor — TipTap wrapper isolated from layout concerns.
 *
 * Mounts a TipTap editor with StarterKit + Markdown + Mention (Phase E adds
 * the @ picker). Owns the markdown round-trip:
 *   - Load: parse markdown (or read existing TipTap JSON when available)
 *   - Save: serialize to markdown + emit JSON snapshot
 *
 * The workspace module orchestrates persistence (write to Narrative element);
 * this module only deals with editor lifecycle + content conversion.
 */

import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { renderMentionSuggestion, type MentionSuggestionItem } from './writing-workspace-mention';
import { ElementChip } from './writing-workspace-element-chip';
import { serializeDocToMarkdown } from './writing-workspace-markdown';
import { convertLinkMarksToChips } from './writing-workspace-load';
import {
  createSearchPlugin,
  setSearchQuery,
  stepSearch,
  clearSearch,
  getSearchState,
  type SearchSetOptions,
} from './writing-workspace-search';
import {
  createAutolinkPlugin,
  buildAutolinkIndex,
  refreshAutolinkIndex,
  type AutolinkIndex,
} from './writing-workspace-autolink';
import type { Element } from '../core/types';
import type { JSONContent } from '@tiptap/core';

export interface WorkspaceEditorOptions {
  /** Mount target — the editor takes over this element's contents. */
  target: HTMLElement;
  /** Initial JSON document (preferred when available). */
  initialJson?: JSONContent | null;
  /** Initial markdown (fallback when no JSON exists yet — e.g. legacy narratives). */
  initialMarkdown?: string;
  /**
   * Fired after every content change, debounced upstream by the workspace.
   * Provides both markdown + JSON snapshots so the workspace can persist both
   * the canonical `story` field (markdown) and `atlas_richtext_json` (JSON).
   */
  onUpdate: (snapshot: { markdown: string; json: JSONContent; wordCount: number }) => void;
  /**
   * Hook for the @ picker — returns matching items for the current query.
   * Workspace provides this with access to the world's element list +
   * `atlas_aliases` field. Phase E feature; Phase C ships with an empty
   * provider so the editor mounts cleanly without mentions.
   */
  mentionItems?: (query: string) => MentionSuggestionItem[];
  /** Called when a chip is hovered (mouseenter). Workspace shows preview card. */
  onChipHover?: (chip: HTMLElement, id: string, type: string) => void;
  /** Called when the chip is left (mouseleave). Workspace hides preview card. */
  onChipUnhover?: () => void;
  /** Called when a chip is clicked. Workspace opens preview in sticky mode. */
  onChipClick?: (chip: HTMLElement, id: string, type: string) => void;
  /** Called when the @ picker commits a new chip. Workspace pushes to recents. */
  onMentionInserted?: (id: string, type: string) => void;
  /**
   * Initial seed for the autolink plugin's name+alias index. When provided,
   * autolink hints render immediately on mount; otherwise the editor starts
   * with an empty index and the workspace can {@link WorkspaceEditorHandle.refreshAutolink}
   * to populate it.
   */
  autolinkSeed?: AutolinkSeed;
}

export interface SearchMatchInfo {
  total: number;
  currentIndex: number; // 1-based for display; 0 when nothing matched.
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface SearchController {
  /** Set/update the search query + flags. Empty query clears the highlight. */
  setQuery(opts: SearchSetOptions): void;
  /** Move to the next match (wraps). No-op when zero matches. */
  next(): void;
  /** Move to the previous match (wraps). No-op when zero matches. */
  prev(): void;
  /** Replace the currently-highlighted match with `text`. Returns true if a match was replaced. */
  replaceCurrent(text: string): boolean;
  /** Replace every match with `text`. Returns the number of replacements. */
  replaceAll(text: string): number;
  /** Drop the highlight + clear plugin state. */
  clear(): void;
  /** Current snapshot of match counts for UI display. */
  getInfo(): SearchMatchInfo;
}

export interface WorkspaceEditorHandle {
  /** Underlying TipTap instance — call `.destroy()` on unmount. */
  editor: Editor;
  /** Current markdown serialization. */
  getMarkdown: () => string;
  /** Current JSON document. */
  getJson: () => JSONContent;
  /** Replace contents — used when the active narrative changes. */
  setContent: (json: JSONContent | null, markdown: string) => void;
  /** Approximate live word count (whitespace-split, ignores chip labels). */
  getWordCount: () => number;
  /**
   * Walk the editor doc, update any elementChip's `label` attr whose live
   * element name has changed (rename propagation, convention #48). Returns
   * the count of nodes updated so callers can skip the save when nothing
   * changed. Called on every state.data.elements change.
   */
  syncChipLabels: (lookupName: (id: string) => string | null) => number;
  /** Find/replace controller — see {@link SearchController}. */
  search: SearchController;
  /** Rebuild the autolink name+alias index from a fresh elements list. */
  refreshAutolink: (elements: Element[]) => void;
  /** Tear down the editor and detach DOM listeners. */
  destroy: () => void;
}

/**
 * Optional initial autolink seed. Workspace caller passes the world's elements
 * so the editor can decorate already-present matches on mount.
 */
export interface AutolinkSeed {
  elements: Element[];
}

/**
 * Build a configured TipTap instance for the writing workspace.
 *
 * Initial content rule: prefer `initialJson` (high-fidelity richtext from
 * atlas_richtext_json); fall back to parsing `initialMarkdown` via the
 * Markdown extension's parser; empty doc if neither is present.
 */
export function mountWorkspaceEditor(opts: WorkspaceEditorOptions): WorkspaceEditorHandle {
  const { target, initialJson, initialMarkdown, onUpdate, mentionItems, onChipHover, onChipUnhover, onChipClick, onMentionInserted } = opts;

  // Pick initial content: JSON wins if non-empty, else parse markdown via
  // @tiptap/markdown then convert ow:// link marks to chip nodes, else empty.
  let initial: JSONContent | string;
  if (initialJson && !isEmptyJsonDoc(initialJson)) {
    initial = initialJson;
  } else if (initialMarkdown && initialMarkdown.trim().length > 0) {
    initial = initialMarkdown; // Markdown extension parses on input.
  } else {
    initial = '';
  }

  const editor = new Editor({
    element: target,
    extensions: [
      StarterKit.configure({
        // Keep the standard Link extension for non-OW URLs (https://, etc.).
        // ow:// links get converted to chips post-parse so the link mark
        // only carries genuine outbound URLs.
      }) as any,
      Markdown,
      // Search/find-replace plugin — exposed through editorHandle.search.
      Extension.create({
        name: 'atlasSearch',
        addProseMirrorPlugins: () => [createSearchPlugin()],
      }) as any,
      // Autolink plugin — Tab-to-link hints over name/alias matches.
      Extension.create({
        name: 'atlasAutolink',
        addProseMirrorPlugins: () => {
          const initialIndex: AutolinkIndex = opts.autolinkSeed
            ? buildAutolinkIndex(opts.autolinkSeed.elements)
            : { byName: new Map(), scanner: null };
          return [createAutolinkPlugin(initialIndex)];
        },
      }) as any,
      ElementChip.configure({
        HTMLAttributes: {
          class: 'atlas-element-chip',
        },
        suggestion: {
          char: '@',
          items: ({ query }) => (mentionItems ? mentionItems(query).slice(0, 8) : []),
          render: renderMentionSuggestion,
          command: ({ editor, range, props }) => {
            // Replace the trigger + query with an elementChip node carrying
            // id, type, label. TipTap's default Mention command works for
            // {id, label}; we extend it to also carry `type`.
            const id = (props as any).id;
            const type = (props as any).type ?? 'character';
            const label = (props as any).label;
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                {
                  type: 'elementChip',
                  attrs: { id, type, label },
                },
                { type: 'text', text: ' ' },
              ])
              .run();
            // Notify upstream so the workspace can update its picker-recents
            // tracker. Runs after the transaction so the chip is real DOM.
            if (id) onMentionInserted?.(id, type);
          },
        },
      }) as any,
    ],
    content: initial,
    autofocus: false,
    editable: true,
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      // Use our custom serializer so element chips become ow:// markdown links.
      const markdown = serializeDocToMarkdown(json);
      const wordCount = computeWordCount(editor.getText());
      onUpdate({ markdown, json, wordCount });
    },
    onCreate: ({ editor }) => {
      // Wire chip hover + click via event delegation. The Mention extension
      // renders chips as `span.atlas-element-chip` with `data-id` / `data-type`
      // attrs; we listen on the editor's contenteditable container.
      const dom = editor.view.dom;
      dom.addEventListener('mouseenter', (e) => {
        const target = e.target as HTMLElement | null;
        if (!target?.closest) return;
        const chip = target.closest<HTMLElement>('.atlas-element-chip');
        if (!chip) return;
        const id = chip.dataset.id;
        if (!id || !onChipHover) return;
        onChipHover(chip, id, chip.dataset.type ?? 'character');
      }, true);
      dom.addEventListener('mouseleave', (e) => {
        const target = e.target as HTMLElement | null;
        if (!target?.closest) return;
        const chip = target.closest<HTMLElement>('.atlas-element-chip');
        if (!chip) return;
        onChipUnhover?.();
      }, true);
      dom.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const chip = target.closest<HTMLElement>('.atlas-element-chip');
        if (!chip) return;
        const id = chip.dataset.id;
        const type = chip.dataset.type ?? 'character';
        if (!id) return;
        e.preventDefault();
        onChipClick?.(chip, id, type);
      });
    },
  });

  // Post-process initial content if it came from markdown: convert link marks
  // pointing at ow:// URLs into elementChip nodes. The MarkdownExtension's
  // parse handles standard markdown links; we then walk the resulting JSON
  // and replace ow:// link marks with chips.
  if (typeof initial === 'string' && initial.trim().length > 0) {
    const parsed = editor.getJSON();
    const converted = convertLinkMarksToChips(parsed);
    if (converted !== parsed) {
      editor.commands.setContent(converted, { emitUpdate: false });
    }
  }

  const search: SearchController = {
    setQuery(opts) {
      setSearchQuery(editor.view, opts);
    },
    next() {
      stepSearch(editor.view, 1);
    },
    prev() {
      stepSearch(editor.view, -1);
    },
    replaceCurrent(text) {
      const s = getSearchState(editor.state);
      if (!s || s.currentIndex < 0 || s.matches.length === 0) return false;
      const match = s.matches[s.currentIndex];
      editor.chain().focus().insertContentAt({ from: match.from, to: match.to }, text).run();
      // After the replacement, the plugin's `apply` runs against the post-doc
      // transaction and rebuilds matches. The current index maps forward.
      return true;
    },
    replaceAll(text) {
      const s = getSearchState(editor.state);
      if (!s || s.matches.length === 0) return 0;
      // Replace from end → start to keep earlier offsets stable.
      const ordered = [...s.matches].sort((a, b) => b.from - a.from);
      const tr = editor.state.tr;
      for (const m of ordered) {
        tr.insertText(text, m.from, m.to);
      }
      editor.view.dispatch(tr);
      return ordered.length;
    },
    clear() {
      clearSearch(editor.view);
    },
    getInfo() {
      const s = getSearchState(editor.state);
      if (!s) {
        return { total: 0, currentIndex: 0, query: '', caseSensitive: false, wholeWord: false };
      }
      return {
        total: s.matches.length,
        currentIndex: s.matches.length > 0 ? s.currentIndex + 1 : 0,
        query: s.query,
        caseSensitive: s.caseSensitive,
        wholeWord: s.wholeWord,
      };
    },
  };

  return {
    editor,
    getMarkdown: () => serializeDocToMarkdown(editor.getJSON()),
    getJson: () => editor.getJSON(),
    setContent: (json, markdown) => {
      if (json && !isEmptyJsonDoc(json)) {
        editor.commands.setContent(json, { emitUpdate: false });
      } else if (markdown && markdown.trim().length > 0) {
        editor.commands.setContent(markdown, { emitUpdate: false });
        // Convert ow:// link marks → chips after markdown parse.
        const converted = convertLinkMarksToChips(editor.getJSON());
        editor.commands.setContent(converted, { emitUpdate: false });
      } else {
        editor.commands.setContent('', { emitUpdate: false });
      }
    },
    getWordCount: () => computeWordCount(editor.getText()),
    syncChipLabels: (lookupName) => syncChipLabelsImpl(editor, lookupName),
    search,
    refreshAutolink: (elements) => refreshAutolinkIndex(editor.view, elements),
    destroy: () => editor.destroy(),
  };
}

/**
 * Walks the editor doc, finds elementChip nodes whose stored label is stale
 * relative to the live element name, and rewrites them via a single
 * transaction. Returns the count of updated nodes.
 *
 * No-op when nothing changed — important because this function is called on
 * every state subscription tick and any transaction triggers `onUpdate` which
 * triggers a debounced save. A truly empty round = no chained save loop.
 */
function syncChipLabelsImpl(
  editor: Editor,
  lookupName: (id: string) => string | null,
): number {
  const updates: Array<{ pos: number; newLabel: string }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'elementChip') return;
    const id = node.attrs.id as string | null;
    if (!id) return;
    const liveName = lookupName(id);
    if (!liveName) return; // Element deleted — leave the stale label; chip still serializes correctly.
    if (node.attrs.label === liveName) return;
    updates.push({ pos, newLabel: liveName });
  });

  if (updates.length === 0) return 0;

  const tr = editor.state.tr;
  for (const { pos, newLabel } of updates) {
    const node = tr.doc.nodeAt(pos);
    if (!node || node.type.name !== 'elementChip') continue;
    tr.setNodeAttribute(pos, 'label', newLabel);
  }
  // Mark the transaction so the workspace can distinguish "internal sync"
  // from "user edit" if needed (currently both trigger the same save path,
  // and that's fine — saving with the fresh label is the durable correction).
  tr.setMeta('atlas-chip-sync', true);
  editor.view.dispatch(tr);
  return updates.length;
}

function isEmptyJsonDoc(json: JSONContent | null | undefined): boolean {
  if (!json) return true;
  const content = json.content;
  if (!Array.isArray(content) || content.length === 0) return true;
  // Single empty paragraph is considered empty.
  if (content.length === 1) {
    const only = content[0];
    if (only.type === 'paragraph' && (!only.content || only.content.length === 0)) return true;
  }
  return false;
}

function computeWordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
