/**
 * Find inside the COMPILED view. The compiled view is a read-only
 * rendering of a parent narrative plus every descendant, with no editor
 * behind it, so the find bar's usual controller (a ProseMirror plugin) has
 * nothing to drive there. This controller searches the rendered DOM instead:
 * it wraps every match in a `<mark class="atlas-search-match">`, steps the
 * current one, and unwraps on clear.
 *
 * It exists so the find bar's "Link to element" works at chapter and book
 * level (a Discord request, 2026-09-03). The bar is the same bar; only the
 * surface under it differs. Replace is refused here because the rendering is
 * not the source: replacing in it would change nothing on disk. Linking is
 * the workspace's job (it runs the term transforms over the subtree on disk
 * and the view re-renders); this controller only answers what the bar asks.
 *
 * Search runs per text node, like the editor plugin, and never enters a chip
 * (`.atlas-element-chip`) because chip labels are already links.
 */

import { buildTermScanner } from '../core/prose-autolink';
import type { SearchController, SearchMatchInfo } from './writing-workspace-editor';
import type { SearchSetOptions } from './writing-workspace-search';

const MARK_CLASS = 'atlas-search-match';

export interface CompiledSearchController extends SearchController {
  /** Re-run the current query after the host re-rendered (marks were lost). */
  reapply(): void;
}

export function createCompiledSearch(getHost: () => HTMLElement | null): CompiledSearchController {
  let query = '';
  let caseSensitive = false;
  let wholeWord = false;
  let marks: HTMLElement[] = [];
  let currentIndex = -1;

  function unwrapAll(): void {
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
      parent.normalize();
    }
    marks = [];
    currentIndex = -1;
  }

  function textNodesUnder(host: HTMLElement): Text[] {
    const out: Text[] = [];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = (node as Text).parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        // Chips are links already; section markers are chrome, not prose.
        if (parent.closest('.atlas-element-chip, .atlas-writing-compiled-marker')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n: Node | null;
    while ((n = walker.nextNode()) !== null) out.push(n as Text);
    return out;
  }

  function scan(): void {
    unwrapAll();
    const host = getHost();
    const scanner = buildTermScanner(query, { caseSensitive, wholeWord });
    if (!host || !scanner) return;
    for (const textNode of textNodesUnder(host)) {
      const text = textNode.data;
      const spans: Array<[number, number]> = [];
      let m: RegExpExecArray | null;
      scanner.lastIndex = 0;
      while ((m = scanner.exec(text)) !== null) {
        if (m[0].length === 0) { scanner.lastIndex++; continue; }
        spans.push([m.index, m.index + m[0].length]);
      }
      if (spans.length === 0) continue;
      // Split from the END so earlier offsets stay valid within this node;
      // the node's marks are gathered in document order and appended after
      // the nodes before it (an unshift here once put the last
      // scene's match first, so "1 of 9" lit the wrong word).
      const nodeMarks: HTMLElement[] = [];
      let tail: Text = textNode;
      for (let i = spans.length - 1; i >= 0; i--) {
        const [from, to] = spans[i];
        tail.splitText(to);
        const hit = tail.splitText(from);
        const mark = document.createElement('mark');
        mark.className = MARK_CLASS;
        hit.parentNode!.replaceChild(mark, hit);
        mark.appendChild(hit);
        nodeMarks.unshift(mark);
      }
      marks.push(...nodeMarks);
    }
    currentIndex = marks.length > 0 ? 0 : -1;
    paintCurrent(true);
  }

  function paintCurrent(scroll: boolean): void {
    marks.forEach((mark, i) => mark.classList.toggle('is-current', i === currentIndex));
    if (scroll && currentIndex >= 0) {
      marks[currentIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function step(delta: 1 | -1): void {
    if (marks.length === 0) return;
    currentIndex = (currentIndex + delta + marks.length) % marks.length;
    paintCurrent(true);
  }

  const info = (): SearchMatchInfo => ({
    total: marks.length,
    currentIndex: marks.length > 0 ? currentIndex + 1 : 0,
    query,
    caseSensitive,
    wholeWord,
  });

  return {
    setQuery(opts: SearchSetOptions) {
      query = opts.query ?? query;
      caseSensitive = opts.caseSensitive ?? caseSensitive;
      wholeWord = opts.wholeWord ?? wholeWord;
      scan();
    },
    next: () => step(1),
    prev: () => step(-1),
    // The rendering is not the source; nothing to replace here.
    replaceCurrent: () => false,
    replaceAll: () => 0,
    // Linking a compiled view is a subtree write the workspace performs;
    // this controller only reports. See writing-workspace's link flow.
    linkAllMatches: () => 0,
    clear() {
      query = '';
      unwrapAll();
    },
    getInfo: info,
    reapply: scan,
  };
}
