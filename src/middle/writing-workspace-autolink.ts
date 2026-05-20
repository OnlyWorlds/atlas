/**
 * First-mention auto-link plugin for the writing workspace.
 *
 * Watches the prose. When a writer types an element name (or alias), atlas
 * shows a subtle dotted underline beneath the word with a "Tab to link" hint.
 * Pressing Tab promotes the text into an ElementChip; ignoring it lets the
 * suggestion fade as the writer keeps typing.
 *
 * Suppression rules (stacked to keep the feature un-annoying):
 *
 *   - Case-sensitive match (proper nouns are uppercase; common nouns aren't)
 *   - Min 3 chars per name/alias (kills "Al", "Bo")
 *   - First mention only per doc — once an element is chip-linked anywhere
 *     in this narrative, no more underlines for it
 *   - Ambiguous names suppressed entirely (2+ elements share the same name)
 *   - The `@` mention picker takes priority — when its popover is visible,
 *     we don't decorate (avoids competing affordances)
 *
 * The plugin recomputes decorations on every doc change. Cheap at OW scale
 * (worlds rarely top a few hundred elements), and one combined regex is the
 * hot loop. Optimization (Aho-Corasick / trie) is a future bout if needed.
 *
 * See DESIGN_WRITING.md §Autolink for the design rationale.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { Element } from '../core/types';

const MIN_NAME_CHARS = 3;
/** Tiptap reserves up to ~50 keys reasonable in alternations; we cap to keep regex compile fast. */
const MAX_KEYS_IN_INDEX = 2000;

export interface AutolinkCandidate {
  id: string;
  type: string;
  displayName: string;
}

export interface AutolinkIndex {
  /** Map from lowercase-or-case-sensitive name to its candidate(s). */
  byName: Map<string, AutolinkCandidate[]>;
  /** Pre-compiled combined regex (case-sensitive, word-bounded alternation). */
  scanner: RegExp | null;
}

/**
 * Build the autolink index from a snapshot of the world's elements. Includes
 * both `name` and `atlas_aliases` as match keys. Multi-word names live in
 * the same map. Match keys are case-sensitive so "Drizzle" matches "Drizzle"
 * in prose but not "drizzling" (also blocked by word-boundary regex).
 */
export function buildAutolinkIndex(elements: Element[]): AutolinkIndex {
  const byName = new Map<string, AutolinkCandidate[]>();
  for (const el of elements) {
    // Skip narratives / spatial entities — they're not the targets of
    // prose auto-link (writers aren't linking pins or maps in narrative
    // body text; the @ picker already excludes them).
    if (el.type === 'narrative' || el.type === 'pin' || el.type === 'marker' || el.type === 'map') {
      continue;
    }
    addEntry(byName, el.name, el);
    if (Array.isArray(el.atlas_aliases)) {
      for (const alias of el.atlas_aliases) {
        if (typeof alias === 'string') addEntry(byName, alias, el);
      }
    }
  }

  const keys = [...byName.keys()].slice(0, MAX_KEYS_IN_INDEX);
  // Sort longest first so multi-word names win over their sub-words in the
  // alternation regex (greedy left-to-right match).
  keys.sort((a, b) => b.length - a.length);
  const scanner = keys.length > 0 ? buildCombinedRegex(keys) : null;

  return { byName, scanner };
}

function addEntry(map: Map<string, AutolinkCandidate[]>, key: string | undefined, el: Element): void {
  if (!key) return;
  const trimmed = key.trim();
  if (trimmed.length < MIN_NAME_CHARS) return;
  const candidate: AutolinkCandidate = {
    id: el.id,
    type: el.type,
    displayName: el.name ?? trimmed,
  };
  const existing = map.get(trimmed);
  if (existing) {
    // De-duplicate per (id, key) — the same element registering multiple
    // aliases that happen to equal each other shouldn't pile up.
    if (!existing.some(c => c.id === candidate.id)) existing.push(candidate);
  } else {
    map.set(trimmed, [candidate]);
  }
}

function escapeRegexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCombinedRegex(keys: string[]): RegExp | null {
  if (keys.length === 0) return null;
  // Word-boundary on both sides — keeps "Drizzle" out of "drizzling".
  // Case-sensitive (no /i) — proper nouns vs common nouns separate naturally.
  // The `g` flag is essential for iterating matches via exec().
  const pattern = `\\b(?:${keys.map(escapeRegexLiteral).join('|')})\\b`;
  try {
    return new RegExp(pattern, 'g');
  } catch {
    return null;
  }
}

/** Walk the doc once to collect ids that are ALREADY chipped. */
function collectChippedIds(doc: PmNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'elementChip') {
      const id = node.attrs.id as string | null;
      if (id) ids.add(id);
    }
  });
  return ids;
}

interface ScanMatch {
  from: number;
  to: number;
  candidate: AutolinkCandidate;
}

/**
 * Scan every text node in the doc and produce a list of matches eligible
 * for decoration. Applies the suppression rules:
 *
 *   - skip text inside elementChip nodes (already linked)
 *   - skip when there are multiple candidates for the matched key (ambiguous)
 *   - skip when the candidate's id is already chipped elsewhere in the doc
 */
function scanDocForMatches(
  doc: PmNode,
  index: AutolinkIndex,
  alreadyChipped: Set<string>,
): ScanMatch[] {
  const matches: ScanMatch[] = [];
  if (!index.scanner) return matches;
  // Track ids we've already proposed in this scan — same element should only
  // be decorated once per doc even if mentioned multiple times.
  const proposedIds = new Set<string>();

  doc.descendants((node, pos, parent) => {
    if (!node.isText) return;
    // If the parent is an elementChip, skip — already linked.
    if (parent?.type.name === 'elementChip') return;
    const text = node.text ?? '';
    if (text.length === 0) return;

    // Fresh lastIndex per node — combined regex is /g but we don't share state.
    const re = new RegExp(index.scanner!.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const matched = m[0];
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const candidates = index.byName.get(matched);
      if (!candidates || candidates.length === 0) continue;
      // Ambiguity suppression — multiple elements share this exact key.
      if (candidates.length > 1) continue;
      const cand = candidates[0];
      // First-mention rule: skip if already chipped OR already proposed.
      if (alreadyChipped.has(cand.id) || proposedIds.has(cand.id)) continue;
      proposedIds.add(cand.id);
      matches.push({
        from: pos + m.index,
        to: pos + m.index + matched.length,
        candidate: cand,
      });
    }
  });

  return matches;
}

function buildDecorations(matches: ScanMatch[], doc: PmNode): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    matches.map(m =>
      Decoration.inline(
        m.from,
        m.to,
        { class: 'atlas-autolink-hint', title: `Tab to link as ${m.candidate.type}` },
        { candidate: m.candidate },
      ),
    ),
  );
}

interface AutolinkPluginState {
  decorations: DecorationSet;
  index: AutolinkIndex;
  alreadyChipped: Set<string>;
}

export const AUTOLINK_PLUGIN_KEY = new PluginKey<AutolinkPluginState>('atlas-autolink');
export const AUTOLINK_INDEX_META = 'atlas-autolink:set-index';

/** True iff the `@` mention picker is currently visible — gate Tab handling. */
function mentionPickerVisible(): boolean {
  return Boolean(document.querySelector('.atlas-mention-popover'));
}

export function createAutolinkPlugin(initialIndex: AutolinkIndex): Plugin<AutolinkPluginState> {
  return new Plugin<AutolinkPluginState>({
    key: AUTOLINK_PLUGIN_KEY,
    state: {
      init(_config, instance): AutolinkPluginState {
        const alreadyChipped = collectChippedIds(instance.doc);
        const matches = scanDocForMatches(instance.doc, initialIndex, alreadyChipped);
        return {
          index: initialIndex,
          alreadyChipped,
          decorations: buildDecorations(matches, instance.doc),
        };
      },
      apply(tr: Transaction, prev: AutolinkPluginState, _oldState: EditorState, newState: EditorState): AutolinkPluginState {
        // Index refresh via meta — fired from outside the editor when the
        // world's elements list changes.
        const newIndex = tr.getMeta(AUTOLINK_INDEX_META) as AutolinkIndex | undefined;
        if (newIndex) {
          const alreadyChipped = collectChippedIds(newState.doc);
          const matches = scanDocForMatches(newState.doc, newIndex, alreadyChipped);
          return {
            index: newIndex,
            alreadyChipped,
            decorations: buildDecorations(matches, newState.doc),
          };
        }
        if (tr.docChanged) {
          const alreadyChipped = collectChippedIds(newState.doc);
          const matches = scanDocForMatches(newState.doc, prev.index, alreadyChipped);
          return {
            ...prev,
            alreadyChipped,
            decorations: buildDecorations(matches, newState.doc),
          };
        }
        return {
          ...prev,
          decorations: prev.decorations.map(tr.mapping, tr.doc),
        };
      },
    },
    props: {
      decorations(state) {
        return AUTOLINK_PLUGIN_KEY.getState(state)?.decorations ?? null;
      },
      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        if (event.key !== 'Tab' || event.shiftKey) return false;
        // Suppress while the mention picker has its own Tab handling.
        if (mentionPickerVisible()) return false;
        // Find a decoration containing or immediately adjacent to the cursor.
        const sel = view.state.selection;
        if (!sel.empty) return false;
        const pos = sel.from;
        const decos = AUTOLINK_PLUGIN_KEY.getState(view.state)?.decorations;
        if (!decos) return false;
        // Iterate any decoration whose range touches or is one position away
        // from the cursor. Lets us catch cursor sitting at the end of the word
        // (pos === deco.to), inside the word, or just before it.
        const candidates = decos.find(Math.max(0, pos - 1), pos + 1);
        let found: typeof candidates[0] | undefined;
        for (const d of candidates) {
          if (pos >= d.from && pos <= d.to) {
            found = d;
            break;
          }
        }
        if (!found) return false;
        const candidate = (found.spec as { candidate?: AutolinkCandidate }).candidate;
        if (!candidate) return false;

        // Replace the decorated text with an ElementChip node + trailing space.
        const schema = view.state.schema;
        const chipType = schema.nodes.elementChip;
        if (!chipType) return false; // Editor schema doesn't include the chip — bail.
        const chip = chipType.create({
          id: candidate.id,
          type: candidate.type,
          label: candidate.displayName,
        });
        const space = schema.text(' ');
        const tr = view.state.tr.replaceWith(found.from, found.to, [chip, space]);
        view.dispatch(tr);
        event.preventDefault();
        return true;
      },
    },
  });
}

/**
 * Convenience helper: build a fresh index and dispatch it to a live editor's
 * autolink plugin. Used by the workspace when state.data.elements changes.
 */
export function refreshAutolinkIndex(view: EditorView, elements: Element[]): void {
  const index = buildAutolinkIndex(elements);
  const tr = view.state.tr.setMeta(AUTOLINK_INDEX_META, index);
  view.dispatch(tr);
}
