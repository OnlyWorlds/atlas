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

const OW_LINK_RE = /^ow:\/\/([a-z_]+)\/([\w-]+)$/i;

export function convertLinkMarksToChips(doc: JSONContent): JSONContent {
  return walk(doc);
}

function walk(node: JSONContent): JSONContent {
  if (!node) return node;
  if (Array.isArray(node.content)) {
    const newContent: JSONContent[] = [];
    for (const child of node.content) {
      // If this text node has a link mark with an ow:// href, replace it
      // with an elementChip node.
      if (
        child.type === 'text' &&
        Array.isArray(child.marks) &&
        child.marks.some(m => m.type === 'link' && isOwLink(m.attrs?.href))
      ) {
        const linkMark = child.marks.find(m => m.type === 'link');
        const href = linkMark?.attrs?.href as string;
        const match = OW_LINK_RE.exec(href);
        if (match) {
          newContent.push({
            type: 'elementChip',
            attrs: {
              id: match[2],
              type: match[1].toLowerCase(),
              label: child.text ?? '',
            },
            // Carry over any other marks (bold/italic) onto the chip so
            // styling round-trips.
            marks: child.marks.filter(m => m.type !== 'link'),
          });
          continue;
        }
      }
      newContent.push(walk(child));
    }
    return { ...node, content: newContent };
  }
  return node;
}

function isOwLink(href: unknown): boolean {
  return typeof href === 'string' && OW_LINK_RE.test(href);
}
