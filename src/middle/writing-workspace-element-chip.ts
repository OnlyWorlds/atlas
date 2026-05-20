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

const OW_LINK_RE = /^ow:\/\/([a-z_]+)\/([\w-]+)$/i;

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

/**
 * Markdown serializer for the element chip node. Registered via the
 * MarkdownManager's extension lookup (the editor wires this up by passing
 * the chip extension into the manager's extensions list).
 *
 * Output: `[Display Name](ow://<type>/<uuid>)`. If `label` is absent or
 * matches the element's current name, we keep it as the display text;
 * if the user manually overrode the label, it serializes as-is.
 */
export function serializeElementChipToMarkdown(node: any): string {
  const id = node.attrs?.id ?? '';
  const type = node.attrs?.type ?? 'character';
  const label = node.attrs?.label ?? id;
  if (!id) return label || '';
  // Escape any closing `)` in label so the link doesn't break.
  const safeLabel = String(label).replace(/\]/g, '\\]');
  return `[${safeLabel}](ow://${type}/${id})`;
}

/**
 * Parse a markdown link token and detect if it's an OW URL. If so, return
 * the chip node spec; if not, return null (caller falls back to standard
 * link parsing).
 */
export function tryParseElementChipFromLink(href: string, text: string): {
  type: string;
  id: string;
  label: string;
} | null {
  const m = OW_LINK_RE.exec(href);
  if (!m) return null;
  return {
    type: m[1].toLowerCase(),
    id: m[2],
    label: text,
  };
}
