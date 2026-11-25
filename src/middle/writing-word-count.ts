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

import { markdownLinkSpans, unescapeLinkLabel } from '../core/markdown-link-label';

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
  // A piece already read (a link's label, a code span, an unescaped
  // character) is held, so no later pass reads it, as in the renderer.
  const held: string[] = [];
  const hold = (text: string): string => `\uE000${held.push(text) - 1}\uE001`;
  // The two marks are private characters; one in the text is read as another character (never a space).
  let s = markdown.replace(/[\uE000\uE001]/g, '\uFFFD');

  // Links, ow:// chips included — keep the label, drop the target. Taken by
  // the grammar before anything else, as renderInline takes them (1.125.34): a
  // target can contain characters the emphasis rules would otherwise chew,
  // and the label is read unescaped.
  let linked = '';
  let last = 0;
  for (const l of markdownLinkSpans(s)) {
    linked += s.slice(last, l.start) + hold(unescapeLinkLabel(s.slice(l.labelStart, l.labelEnd)));
    last = l.end;
  }
  s = linked + s.slice(last);

  // Inline code — keep the code text, drop the backticks.
  s = s.replace(/`([^`\n]+?)`/g, (_, code: string) => hold(code));

  // `\[`, `\]`, `\(`, `\)`, `\<` and `\\` outside a link and a code span: their characters.
  s = s.replace(/\\([\\[\]()<])/g, (_, c: string) => hold(c));

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

  return lines.join('\n').replace(/\uE000(\d+)\uE001/g, (_, i: string) => held[Number(i)]);
}

/** Count words in stored prose markdown, as a reader sees it. */
export function countMarkdownWords(markdown: string): number {
  return countWords(markdownToPlainText(markdown));
}
