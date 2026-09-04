/**
 * Find/replace plugin for the writing workspace editor.
 *
 * A ProseMirror plugin that:
 *   - tracks a search query + flags (case-sensitive, whole-word) in plugin state
 *   - scans the doc on every relevant transaction
 *   - decorates each match with `.atlas-search-match` (current = `.is-current`)
 *
 * The UI (`writing-workspace-find-bar`) calls into this plugin via `setMeta`
 * to update the query / step the current match / clear the highlight.
 *
 * Replacement is performed by the workspace itself (uses editor commands) —
 * this plugin only owns the decorations + match index.
 */

import { Plugin, PluginKey, EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import { buildTermScanner } from '../core/prose-autolink';

export interface SearchMatch {
  from: number;
  to: number;
}

export interface SearchPluginState {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  matches: SearchMatch[];
  currentIndex: number;
  decorations: DecorationSet;
}

export interface SearchSetOptions {
  query?: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /** If true, reset currentIndex to 0; else keep best-fit. */
  resetIndex?: boolean;
}

export interface SearchStepOptions {
  delta: 1 | -1;
}

export const SEARCH_PLUGIN_KEY = new PluginKey<SearchPluginState>('atlas-search');

const META_SET = 'atlas-search:set';
const META_STEP = 'atlas-search:step';
const META_CLEAR = 'atlas-search:clear';

function emptyState(doc: PmNode): SearchPluginState {
  return {
    query: '',
    caseSensitive: false,
    wholeWord: false,
    matches: [],
    currentIndex: -1,
    decorations: DecorationSet.empty,
  };
}

/**
 * One scanner, two homes: the kernel's `buildTermScanner` is the same regex
 * the find bar's "Link to element" transforms use on closed narratives, so
 * what the bar highlights is exactly what links (paired functions share code).
 */
function buildScanner(query: string | readonly string[], caseSensitive: boolean, wholeWord: boolean): RegExp | null {
  return buildTermScanner(query, { caseSensitive, wholeWord });
}

/**
 * Walk the doc and collect every match of the query as a {from, to} range
 * in absolute doc coordinates. Search runs against text nodes only.
 */
export function findAllMatches(
  doc: PmNode,
  query: string | readonly string[],
  caseSensitive: boolean,
  wholeWord: boolean,
): SearchMatch[] {
  const scanner = buildScanner(query, caseSensitive, wholeWord);
  if (!scanner) return [];
  const matches: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text ?? '';
    let m: RegExpExecArray | null;
    scanner.lastIndex = 0;
    while ((m = scanner.exec(text)) !== null) {
      if (m[0].length === 0) {
        scanner.lastIndex++;
        continue;
      }
      matches.push({ from: pos + m.index, to: pos + m.index + m[0].length });
    }
  });
  return matches;
}

// DecorationSet.create wants a doc — supply it from the caller.
function decorationsForDoc(doc: PmNode, matches: SearchMatch[], currentIndex: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: 'atlas-search-match' + (i === currentIndex ? ' is-current' : ''),
      }),
    ),
  );
}

export function createSearchPlugin(): Plugin<SearchPluginState> {
  return new Plugin<SearchPluginState>({
    key: SEARCH_PLUGIN_KEY,
    state: {
      init(_config, instance): SearchPluginState {
        return emptyState(instance.doc);
      },
      apply(tr: Transaction, prev: SearchPluginState, _oldState: EditorState, newState: EditorState): SearchPluginState {
        const setMeta = tr.getMeta(META_SET) as SearchSetOptions | undefined;
        const stepMeta = tr.getMeta(META_STEP) as SearchStepOptions | undefined;
        const clearMeta = tr.getMeta(META_CLEAR) as boolean | undefined;

        if (clearMeta) {
          return emptyState(newState.doc);
        }

        if (setMeta !== undefined) {
          const query = setMeta.query ?? prev.query;
          const caseSensitive = setMeta.caseSensitive ?? prev.caseSensitive;
          const wholeWord = setMeta.wholeWord ?? prev.wholeWord;
          if (!query) {
            return emptyState(newState.doc);
          }
          const matches = findAllMatches(newState.doc, query, caseSensitive, wholeWord);
          // Reset to first match by default; if not resetting and there was a
          // current match, find the closest match >= prev.currentIndex position.
          let currentIndex = matches.length > 0 ? 0 : -1;
          if (!setMeta.resetIndex && prev.matches.length > 0 && prev.currentIndex >= 0) {
            const prevFrom = prev.matches[prev.currentIndex]?.from ?? 0;
            const found = matches.findIndex(m => m.from >= prevFrom);
            currentIndex = found >= 0 ? found : 0;
          }
          return {
            query,
            caseSensitive,
            wholeWord,
            matches,
            currentIndex,
            decorations: decorationsForDoc(newState.doc, matches, currentIndex),
          };
        }

        if (stepMeta !== undefined && prev.matches.length > 0) {
          const next = (prev.currentIndex + stepMeta.delta + prev.matches.length) % prev.matches.length;
          return {
            ...prev,
            currentIndex: next,
            decorations: decorationsForDoc(newState.doc, prev.matches, next),
          };
        }

        // Doc changed (typing, replace, etc.) and we have an active query —
        // recompute matches against the new doc. Cheap: only fires when the
        // doc actually mutated.
        if (tr.docChanged && prev.query) {
          const matches = findAllMatches(newState.doc, prev.query, prev.caseSensitive, prev.wholeWord);
          // Try to preserve currentIndex by mapping the prior match's from.
          let currentIndex = matches.length > 0 ? 0 : -1;
          const priorFrom = prev.matches[prev.currentIndex]?.from;
          if (priorFrom != null && matches.length > 0) {
            const mapped = tr.mapping.map(priorFrom);
            const found = matches.findIndex(m => m.from >= mapped);
            currentIndex = found >= 0 ? found : Math.min(prev.currentIndex, matches.length - 1);
          }
          return {
            ...prev,
            matches,
            currentIndex,
            decorations: decorationsForDoc(newState.doc, matches, currentIndex),
          };
        }

        // Map existing decorations through the transaction if doc changed
        // (shouldn't usually happen here — handled above — but defensive).
        if (tr.docChanged) {
          return {
            ...prev,
            decorations: prev.decorations.map(tr.mapping, tr.doc),
          };
        }

        return prev;
      },
    },
    props: {
      decorations(state) {
        return SEARCH_PLUGIN_KEY.getState(state)?.decorations ?? null;
      },
    },
  });
}

// ---- Public helpers the workspace uses to drive the plugin ----

export function setSearchQuery(view: { state: EditorState; dispatch: (tr: Transaction) => void }, opts: SearchSetOptions): void {
  const tr = view.state.tr.setMeta(META_SET, opts);
  view.dispatch(tr);
}

export function stepSearch(view: { state: EditorState; dispatch: (tr: Transaction) => void }, delta: 1 | -1): void {
  const tr = view.state.tr.setMeta(META_STEP, { delta });
  view.dispatch(tr);
}

export function clearSearch(view: { state: EditorState; dispatch: (tr: Transaction) => void }): void {
  const tr = view.state.tr.setMeta(META_CLEAR, true);
  view.dispatch(tr);
}

export function getSearchState(state: EditorState): SearchPluginState | null {
  return SEARCH_PLUGIN_KEY.getState(state) ?? null;
}
