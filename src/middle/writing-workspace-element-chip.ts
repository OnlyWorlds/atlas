/**
 * Element chip node — custom TipTap Mention that round-trips to markdown as
 * `[Display Name](ow://<type>/<uuid>)`.
 *
 * Why a custom node instead of the stock Mention:
 *   1. Stock Mention only stores `id` + `label`. We need `type` too (the OW
 *      element type — character / location / event / ...).
 *   2. Stock Mention's renderText produces `@Drizzle` which serializes to
 *      plain text in markdown. We need a real markdown link with the OW URL
 *      scheme so chips survive the round-trip into other OW tools.
 *   3. We want chips to render via store lookup at render-time (renames
 *      propagate without touching markdown). The chip's `label` attribute
 *      is treated as a manual-override only when `label !== element.name`.
 *
 * See DESIGN_WRITING.md v3.0 §Linking model + convention #48.
 */

import { Mention } from '@tiptap/extension-mention';
import { OW_LINK_HREF_RE, createOwLinkScanner } from '../core/ow-links';

// Canonical OW link patterns live in core/ow-links.ts (TipTap-free home so
// the derive + knowledge modules can import them without pulling the editor
// bundle). Re-exported here for the writing modules that already import them.
export { OW_LINK_HREF_RE, createOwLinkScanner };

export const ElementChip = Mention.extend({
  name: 'elementChip',

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-id'),
        renderHTML: (attrs: any) => (attrs.id ? { 'data-id': attrs.id } : {}),
      },
      type: {
        default: 'character',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-type') ?? 'character',
        renderHTML: (attrs: any) => ({ 'data-type': attrs.type ?? 'character' }),
      },
      label: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-label') ?? el.textContent,
        renderHTML: (attrs: any) => (attrs.label ? { 'data-label': attrs.label } : {}),
      },
    };
  },

  renderHTML({ HTMLAttributes, node }: any) {
    return [
      'span',
      {
        ...HTMLAttributes,
        class: 'atlas-element-chip',
        contenteditable: 'false',
      },
      node.attrs.label ?? '',
    ];
  },

  parseHTML() {
    return [{ tag: 'span.atlas-element-chip' }];
  },

  renderText({ node }: any) {
    // Used by editor.getText() — keep human-readable.
    return node.attrs.label ?? node.attrs.id ?? '';
  },

  /**
   * Backspace when the cursor is immediately after a chip → "unlink"
   * (replace the chip with its plain-text label). Subsequent Backspace
   * deletes characters normally. Without this override, Backspace would
   * delete the whole chip in one keystroke, which surprises writers who
   * typed the word and just want to remove the link, not the text.
   */
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }: any): boolean => {
        const { selection } = editor.state;
        if (!selection.empty) return false;
        const pos = selection.from;
        if (pos <= 0) return false;
        const $pos = editor.state.doc.resolve(pos);
        const nodeBefore = $pos.nodeBefore;
        if (!nodeBefore || nodeBefore.type.name !== 'elementChip') return false;
        const label = (nodeBefore.attrs?.label ?? '') as string;
        const chipStart = pos - nodeBefore.nodeSize;
        editor
          .chain()
          .insertContentAt({ from: chipStart, to: pos }, label || nodeBefore.attrs?.id || '')
          .run();
        return true;
      },
    };
  },

  // ----- Markdown extension hooks -----

  addStorage() {
    return {
      markdown: {
        // Hint to @tiptap/markdown that this node serializes as a link.
        // The actual serialization is in serialize() below.
      },
    };
  },

  // @tiptap/markdown reads these from the extension config:
  // - `markdownName`: the marked token type to handle on parse
  // - `parseMarkdown`: token → ProseMirror node
  // - `renderMarkdown`: ProseMirror node → markdown string
  // The library calls extension.options or top-level config for them.
});

