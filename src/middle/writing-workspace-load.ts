/**
 * Markdown load helper — converts standard link marks pointing at `ow://`
 * URLs into elementChip nodes after `@tiptap/markdown` has parsed the
 * markdown. This is the inverse of `serializeDocToMarkdown` (convention #48).
 *
 * Why this exists: the Markdown extension parses `[Drizzle](ow://character/uuid)`
 * into a text node with a `link` mark whose `href` is the OW URL. The editor
 * doesn't know that's a chip — it would render as a plain link. We walk the
 * parsed JSON once and convert any matching link marks into proper chip nodes.
 */

import type { JSONContent } from '@tiptap/core';
import { isChipLink, readOwHref, type OwLink } from '../core/ow-links';

export function convertLinkMarksToChips(doc: JSONContent): JSONContent {
  return walk(doc);
}

function walk(node: JSONContent): JSONContent {
  if (!node) return node;
  if (Array.isArray(node.content)) {
    const newContent: JSONContent[] = [];
    for (const child of node.content) {
      // A text node whose link mark is a chip address (an element in this
      // world, no moment and no lens) becomes an elementChip node. A link
      // with a moment or a lens stays a link mark, its href kept as written.
      const linkMark = child.type === 'text' && Array.isArray(child.marks)
        ? child.marks.find(m => m.type === 'link')
        : undefined;
      const link = linkMark ? chipLinkOf(linkMark.attrs?.href) : null;
      if (link && Array.isArray(child.marks)) {
        newContent.push({
          type: 'elementChip',
          attrs: {
            id: link.id,
            type: link.type,
            label: child.text ?? '',
          },
          // Carry over any other marks (bold/italic) onto the chip so
          // styling round-trips.
          marks: child.marks.filter(m => m.type !== 'link'),
        });
        continue;
      }
      newContent.push(walk(child));
    }
    return { ...node, content: newContent };
  }
  return node;
}

function chipLinkOf(href: unknown): OwLink | null {
  const link = readOwHref(href);
  return link && isChipLink(link) ? link : null;
}
