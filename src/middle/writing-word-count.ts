/**
 * Word counting for the writing system — the ONE definition, shared by the
 * live editor (this-level view) and the compiled view.
 *
 * These two surfaces show the same widget over the same prose, so they must
 * not carry parallel implementations: a leaf narrative toggled between
 * "This level" and "Compiled" has to report the same number, and the only way
 * to guarantee that is one function. (Paired functions that must agree share
 * code — they never restate each other's rules.)
 *
 * The editor counts its own plain text; the compiled view has no editor, so it
 * counts the stored markdown reduced to what a reader actually sees. That
 * reduction is `markdownToPlainText` below: syntax out, chip and link LABELS
 * in, because a linked name is a word on the page.
 */

/**
 * Count words in already-plain text. Whitespace-delimited, empty is zero.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Reduce stored prose markdown to reader-visible text.
 *
 * Mirrors the token set `renderProseFragment` / `renderInline` understand
 * (writing-compiled.ts) — links, inline code, bold, italic, headings, lists,
 * blockquotes, horizontal rules. Link and chip labels SURVIVE (they are read
 * as words); the surrounding syntax does not.
 */
export function markdownToPlainText(markdown: string): string {
  if (!markdown) return '';
  let s = markdown;

  // Links, ow:// chips included — keep the label, drop the target. Matched
  // before anything else, for the same reason renderInline matches them first:
  // a target can contain characters the emphasis rules would otherwise chew.
  s = s.replace(/\[([^\]]+?)\]\([^)\s]*?\)/g, '$1');

  // Inline code — keep the code text, drop the backticks.
  s = s.replace(/`([^`\n]+?)`/g, '$1');

  // Emphasis markers. Bold before italic, as in the renderer.
  s = s.replace(/\*\*([^*]+?)\*\*/g, '$1');
  s = s.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '$1');

  // Line-level syntax.
  const lines = s.split(/\r?\n/).map((line) => {
    if (/^-{3,}\s*$/.test(line.trim())) return '';        // horizontal rule
    return line
      .replace(/^\s*#{1,6}\s+/, '')                        // heading marker
      .replace(/^\s*>\s?/, '')                             // blockquote marker
      .replace(/^\s*([-*+])\s+/, '')                       // bullet marker
      .replace(/^\s*\d+\.\s+/, '');                        // ordered marker
  });

  return lines.join('\n');
}

/** Count words in stored prose markdown, as a reader sees it. */
export function countMarkdownWords(markdown: string): number {
  return countWords(markdownToPlainText(markdown));
}
