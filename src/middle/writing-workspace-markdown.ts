/**
 * JSON → markdown serializer for the writing workspace.
 *
 * We use @tiptap/markdown to PARSE markdown into TipTap JSON on initial load.
 * We write our own SERIALIZER (JSON → markdown) because we need precise control
 * over our custom `elementChip` node — it must serialize as a markdown link
 * with the OW URL scheme: `[Display Name](ow://<type>/<uuid>)`.
 *
 * Supported nodes (matches what StarterKit ships + our chip):
 *   - doc, paragraph, heading, blockquote, bulletList, orderedList, listItem,
 *     horizontalRule, hardBreak, text, codeBlock, elementChip
 *
 * Supported marks: bold, italic, strike, code (StarterKit defaults).
 *
 * See DESIGN_WRITING.md v3.0 §Storage model + convention #48.
 */

import type { JSONContent } from '@tiptap/core';

interface SerializeContext {
  /** Track nested list depth for indentation. */
  listDepth: number;
  /** When inside an ordered list, the running counter for that level. */
  orderedCounters: number[];
  /** Buffer for the final markdown string. */
  out: string[];
}

export function serializeDocToMarkdown(doc: JSONContent): string {
  const ctx: SerializeContext = { listDepth: 0, orderedCounters: [], out: [] };
  if (doc.type === 'doc' && Array.isArray(doc.content)) {
    for (let i = 0; i < doc.content.length; i++) {
      serializeBlock(doc.content[i], ctx);
      // Separate top-level blocks with a blank line, except after the last.
      if (i < doc.content.length - 1) ctx.out.push('\n\n');
    }
  } else {
    serializeBlock(doc, ctx);
  }
  return ctx.out.join('').replace(/[ \t]+\n/g, '\n').trimEnd();
}

function serializeBlock(node: JSONContent, ctx: SerializeContext): void {
  switch (node.type) {
    case 'paragraph': {
      serializeInline(node.content, ctx);
      break;
    }
    case 'heading': {
      const level = Math.max(1, Math.min(6, node.attrs?.level ?? 1));
      ctx.out.push('#'.repeat(level) + ' ');
      serializeInline(node.content, ctx);
      break;
    }
    case 'blockquote': {
      const sub = withFreshSub(ctx);
      if (Array.isArray(node.content)) {
        node.content.forEach((child, i) => {
          serializeBlock(child, sub);
          if (i < node.content!.length - 1) sub.out.push('\n\n');
        });
      }
      const text = sub.out.join('');
      ctx.out.push(text.split('\n').map(line => (line.length ? '> ' + line : '>')).join('\n'));
      break;
    }
    case 'bulletList': {
      serializeList(node, ctx, false);
      break;
    }
    case 'orderedList': {
      serializeList(node, ctx, true);
      break;
    }
    case 'listItem': {
      // listItem is handled by serializeList; if we reach it here it's a stray.
      if (Array.isArray(node.content)) {
        node.content.forEach((child, i) => {
          serializeBlock(child, ctx);
          if (i < node.content!.length - 1) ctx.out.push('\n');
        });
      }
      break;
    }
    case 'horizontalRule': {
      ctx.out.push('---');
      break;
    }
    case 'codeBlock': {
      const lang = node.attrs?.language ?? '';
      ctx.out.push('```' + lang + '\n');
      if (Array.isArray(node.content)) {
        for (const text of node.content) {
          if (text.type === 'text') ctx.out.push(text.text ?? '');
        }
      }
      ctx.out.push('\n```');
      break;
    }
    // Inline nodes appearing at block level shouldn't happen, but be defensive.
    case 'text':
    case 'elementChip':
    case 'hardBreak':
    case 'mention':
      serializeInline([node], ctx);
      break;
    default:
      // Unknown block type — fall through and try inline serialization.
      if (Array.isArray(node.content)) {
        serializeInline(node.content, ctx);
      }
  }
}

function serializeList(node: JSONContent, ctx: SerializeContext, ordered: boolean): void {
  if (!Array.isArray(node.content)) return;
  const indent = '  '.repeat(ctx.listDepth);
  let counter = ordered ? (node.attrs?.start ?? 1) : 0;

  node.content.forEach((item, idx) => {
    if (item.type !== 'listItem') return;
    const marker = ordered ? `${counter++}.` : '-';
    ctx.out.push(indent + marker + ' ');

    if (Array.isArray(item.content)) {
      // First block of a listItem renders inline on the same line as the marker.
      const innerCtx: SerializeContext = {
        listDepth: ctx.listDepth + 1,
        orderedCounters: ctx.orderedCounters,
        out: [],
      };
      item.content.forEach((child, ci) => {
        serializeBlock(child, innerCtx);
        if (ci < item.content!.length - 1) innerCtx.out.push('\n');
      });
      // Add the inner content with continuation indentation for wrapped lines.
      const innerText = innerCtx.out.join('');
      // For multi-block list items, subsequent blocks need indentation prefix.
      const lines = innerText.split('\n');
      ctx.out.push(lines[0]);
      for (let li = 1; li < lines.length; li++) {
        ctx.out.push('\n' + indent + '  ' + lines[li]);
      }
    }
    if (idx < node.content!.length - 1) ctx.out.push('\n');
  });
}

function serializeInline(nodes: JSONContent[] | undefined, ctx: SerializeContext): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (node.type === 'text') {
      const text = node.text ?? '';
      ctx.out.push(applyMarks(escapeInline(text), node.marks));
    } else if (node.type === 'elementChip' || node.type === 'mention') {
      const attrs = node.attrs ?? {};
      const id = attrs.id ?? '';
      const type = attrs.type ?? 'character';
      const label = (attrs.label ?? id) as string;
      if (id) {
        const safeLabel = String(label).replace(/\]/g, '\\]');
        ctx.out.push(applyMarks(`[${safeLabel}](ow://${type}/${id})`, node.marks));
      } else {
        ctx.out.push(applyMarks(String(label), node.marks));
      }
    } else if (node.type === 'hardBreak') {
      ctx.out.push('  \n');
    } else if (Array.isArray(node.content)) {
      serializeInline(node.content, ctx);
    }
  }
}

function applyMarks(text: string, marks: any[] | undefined): string {
  if (!Array.isArray(marks) || marks.length === 0) return text;
  // Apply marks innermost → outermost. Order matters for nesting; we follow
  // the order TipTap provides (priority-stable).
  let out = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        out = `**${out}**`;
        break;
      case 'italic':
        out = `*${out}*`;
        break;
      case 'strike':
        out = `~~${out}~~`;
        break;
      case 'code':
        out = '`' + out + '`';
        break;
      // 'link' marks: serialize as [text](href). atlas elements use chips
      // (their own node) so a stock link mark is a non-atlas plain link.
      case 'link': {
        const href = mark.attrs?.href ?? '';
        if (href) out = `[${out}](${href})`;
        break;
      }
      default:
        // Unknown mark — emit text as-is.
        break;
    }
  }
  return out;
}

function escapeInline(text: string): string {
  // Conservative escaping: only characters that would otherwise start
  // markdown syntax mid-paragraph. Avoid over-escaping which makes round-
  // trips visually noisy.
  return text.replace(/([\\`*_])/g, '\\$1');
}

function withFreshSub(ctx: SerializeContext): SerializeContext {
  return {
    listDepth: ctx.listDepth,
    orderedCounters: ctx.orderedCounters,
    out: [],
  };
}
