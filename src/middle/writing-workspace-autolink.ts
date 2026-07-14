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
import { buildAutolinkIndex } from '../core/prose-autolink';
import type { AutolinkCandidate, AutolinkIndex } from '../core/prose-autolink';

// Index construction moved to core/prose-autolink (S265) so the bulk
// link/unlink kernel shares one matching ruleset with this plugin.
// Re-exported for the existing import sites.
export { buildAutolinkIndex };
export type { AutolinkCandidate, AutolinkIndex };

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
        // spellcheck=false on the hint span keeps browser spellcheck from
        // underlining proper-noun element names with the red squiggle —
        // they're known words from the writer's world, not misspellings.
        {
          class: 'atlas-autolink-hint',
          title: `Tab to link as ${m.candidate.type}`,
          spellcheck: 'false',
        },
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

        // Replace the decorated text with an ElementChip node. No trailing
        // space inserted — the cursor naturally lands after the chip, and
        // the user already has whatever whitespace was after the original
        // word (autolink only matches up to the word boundary).
        const schema = view.state.schema;
        const chipType = schema.nodes.elementChip;
        if (!chipType) return false; // Editor schema doesn't include the chip — bail.
        const chip = chipType.create({
          id: candidate.id,
          type: candidate.type,
          label: candidate.displayName,
        });
        const tr = view.state.tr.replaceWith(found.from, found.to, chip);
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

/**
 * Find the autolink candidate at a given doc position. Used by the right-
 * click context menu to surface a "Link to X" action when the user clicks
 * on an autolink hint. Returns null when no hint decoration intersects.
 */
export function findAutolinkCandidateAt(
  view: EditorView,
  docPos: number,
): { candidate: AutolinkCandidate; from: number; to: number } | null {
  const decos = AUTOLINK_PLUGIN_KEY.getState(view.state)?.decorations;
  if (!decos) return null;
  const hits = decos.find(Math.max(0, docPos - 1), docPos + 1);
  for (const d of hits) {
    if (docPos >= d.from && docPos <= d.to) {
      const candidate = (d.spec as { candidate?: AutolinkCandidate }).candidate;
      if (candidate) return { candidate, from: d.from, to: d.to };
    }
  }
  return null;
}

/**
 * Convert an autolink hint at the given doc position into a chip. Returns
 * true if a conversion occurred. Mirrors the Tab handler's logic — used by
 * the right-click context menu's "Link to X" action.
 */
export function convertAutolinkAt(view: EditorView, docPos: number): boolean {
  const hit = findAutolinkCandidateAt(view, docPos);
  if (!hit) return false;
  const schema = view.state.schema;
  const chipType = schema.nodes.elementChip;
  if (!chipType) return false;
  const chip = chipType.create({
    id: hit.candidate.id,
    type: hit.candidate.type,
    label: hit.candidate.displayName,
  });
  const tr = view.state.tr.replaceWith(hit.from, hit.to, chip);
  view.dispatch(tr);
  return true;
}

/** Count the current autolink hints, optionally only those fully inside a range. */
export function countAutolinkHints(view: EditorView, range?: { from: number; to: number }): number {
  return findHints(view, range).length;
}

function findHints(
  view: EditorView,
  range?: { from: number; to: number },
): Array<{ from: number; to: number; candidate: AutolinkCandidate }> {
  const decos = AUTOLINK_PLUGIN_KEY.getState(view.state)?.decorations;
  if (!decos) return [];
  const found = range ? decos.find(range.from, range.to) : decos.find();
  const out: Array<{ from: number; to: number; candidate: AutolinkCandidate }> = [];
  for (const d of found) {
    if (range && (d.from < range.from || d.to > range.to)) continue; // partial overlap: out
    const candidate = (d.spec as { candidate?: AutolinkCandidate }).candidate;
    if (candidate) out.push({ from: d.from, to: d.to, candidate });
  }
  return out;
}

/**
 * Convert EVERY current autolink hint (or every hint fully inside `range`)
 * into a chip, in ONE transaction — a single Ctrl+Z undoes the whole batch
 * (S265, the link-all affordance). Returns the number converted.
 */
export function convertAllAutolinks(view: EditorView, range?: { from: number; to: number }): number {
  const hints = findHints(view, range).sort((a, b) => a.from - b.from);
  if (hints.length === 0) return 0;
  const chipType = view.state.schema.nodes.elementChip;
  if (!chipType) return 0;
  let tr = view.state.tr;
  for (const h of hints) {
    const from = tr.mapping.map(h.from);
    const to = tr.mapping.map(h.to);
    tr = tr.replaceWith(from, to, chipType.create({
      id: h.candidate.id,
      type: h.candidate.type,
      label: h.candidate.displayName,
    }));
  }
  view.dispatch(tr);
  return hints.length;
}

/** Count element chips, optionally only those inside a range. */
export function countChips(view: EditorView, range?: { from: number; to: number }): number {
  return findChips(view, range).length;
}

function findChips(
  view: EditorView,
  range?: { from: number; to: number },
): Array<{ from: number; to: number; label: string }> {
  const doc = view.state.doc;
  const from = range?.from ?? 0;
  const to = range?.to ?? doc.content.size;
  const chips: Array<{ from: number; to: number; label: string }> = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'elementChip') {
      chips.push({ from: pos, to: pos + node.nodeSize, label: String(node.attrs?.label ?? '') });
    }
  });
  return chips;
}

/**
 * Replace every chip (or every chip inside `range`) with its plain label
 * text, in ONE transaction — the mass-unlink mirror of convertAllAutolinks.
 * Unlike the single right-click unlink, this deliberately does NOT touch the
 * narrative's relation fields (the derive's union semantics never remove;
 * field removal stays the single-unlink's stronger explicit gesture).
 */
export function unlinkAllChips(view: EditorView, range?: { from: number; to: number }): number {
  const chips = findChips(view, range).sort((a, b) => a.from - b.from);
  if (chips.length === 0) return 0;
  let tr = view.state.tr;
  for (const c of chips) {
    const from = tr.mapping.map(c.from);
    const to = tr.mapping.map(c.to);
    tr = c.label
      ? tr.replaceWith(from, to, view.state.schema.text(c.label))
      : tr.delete(from, to);
  }
  view.dispatch(tr);
  return chips.length;
}
