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
import { buildAutolinkIndex, promotionLabel } from '../core/prose-autolink';
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
    const re = new RegExp(index.scanner!.source, index.scanner!.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const matched = m[0];
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const candidates = index.byName.get(matched.toLowerCase());
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

/**
 * The label a promoted chip should carry: THE WRITER'S OWN TEXT, verbatim,
 * for every match kind (Captain's ruling, S309: creating a link NEVER changes
 * the text in a writing room). Delegates to the kernel's `promotionLabel` so
 * the live Tab handler and the bulk link-all engines cannot drift — the S308
 * tour walk caught exactly that drift rewriting the flagship sentence.
 */
function labelForPromotion(view: EditorView, from: number, to: number, candidate: AutolinkCandidate): string {
  return promotionLabel(view.state.doc.textBetween(from, to, '', ''), candidate);
}

/**
 * Promote a hint range into an ElementChip. The single write path shared by
 * Tab (cursor + hover + walk), click-to-link and the context menu — so the
 * label rule (S309, the writer's own text via `promotionLabel`) and the
 * replace semantics can never drift between gestures.
 */
function promoteHint(view: EditorView, from: number, to: number, candidate: AutolinkCandidate): boolean {
  const chipType = view.state.schema.nodes.elementChip;
  if (!chipType) return false;
  const chip = chipType.create({
    id: candidate.id,
    type: candidate.type,
    label: labelForPromotion(view, from, to, candidate),
  });
  view.dispatch(view.state.tr.replaceWith(from, to, chip));
  return true;
}

/**
 * The doc position under the mouse while it rests on a dotted hint (Captain,
 * S313). Set on mouseover, cleared on mouseout. Makes Tab HOVER-AUTHORITATIVE:
 * hovering a word and pressing Tab links THAT word, which is the model the copy
 * always described and the fix for "no matter which I hover it links the first
 * unlinked one". Re-resolved fresh in the handler, never trusted as a range, so
 * an edit since mouseover cannot promote stale positions.
 *
 * TAGGED WITH ITS VIEW: this is a module singleton shared by every autolink
 * editor (writing / knowledge / share). A hover in one editor followed by a
 * switch to another without a mouseout (unmount, blur) would otherwise let the
 * new editor's Tab honour the old position and promote the wrong word — so the
 * Tab handler only trusts a hint tagged to the SAME view, and blur clears it.
 */
let lastHint: { view: EditorView; pos: number } | null = null;

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
      // CLICK A DOTTED WORD TO LINK IT (Captain, S313). The most reliable
      // gesture — one click focuses the editor and promotes in the same motion,
      // so it works "even if the page isn't selected" (the reliability ask that
      // Tab, which needs the editor already focused, could not meet). Only a
      // plain left-click ON the hint span promotes; a click in adjacent
      // whitespace resolves off the span and places the cursor as normal.
      handleClick(view: EditorView, pos: number, event: MouseEvent): boolean {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return false;
        }
        const target = event.target as HTMLElement | null;
        if (!target?.closest?.('.atlas-autolink-hint')) return false;
        const hit = findAutolinkCandidateAt(view, pos);
        if (!hit) return false;
        if (!promoteHint(view, hit.from, hit.to, hit.candidate)) return false;
        lastHint = null;
        event.preventDefault();
        return true;
      },
      handleDOMEvents: {
        // Track the hint under the mouse so Tab can be hover-authoritative.
        mouseover(view: EditorView, event: Event): boolean {
          const me = event as MouseEvent;
          const t = me.target as HTMLElement | null;
          if (t?.closest?.('.atlas-autolink-hint')) {
            const probe = view.posAtCoords({ left: me.clientX, top: me.clientY });
            lastHint = probe ? { view, pos: probe.pos } : null;
          }
          return false;
        },
        mouseout(_view: EditorView, event: Event): boolean {
          const t = (event as MouseEvent).target as HTMLElement | null;
          if (t?.closest?.('.atlas-autolink-hint')) lastHint = null;
          return false;
        },
        // The hint is a singleton across editors; drop it when this editor
        // loses focus so a later Tab elsewhere can never honour a stale hover.
        blur(): boolean {
          lastHint = null;
          return false;
        },
      },
      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        if (event.key !== 'Tab' || event.shiftKey) return false;
        // Suppress while the mention picker has its own Tab handling.
        if (mentionPickerVisible()) return false;

        // 1) HOVER WINS (Captain, S313). If the mouse is resting on a dotted
        // word, Tab links THAT word — the "hover a dotted word and press Tab"
        // model, and the fix for "no matter which I hover it links the first".
        // Re-resolve the candidate at the hovered position so a doc edit since
        // mouseover can never promote a stale range.
        if (lastHint && lastHint.view === view) {
          const hovered = findAutolinkCandidateAt(view, lastHint.pos);
          if (hovered && promoteHint(view, hovered.from, hovered.to, hovered.candidate)) {
            event.preventDefault();
            return true;
          }
        }

        // 2) CURSOR. A decoration containing or immediately adjacent to the
        // caret (end of word, inside it, or just before it).
        const sel = view.state.selection;
        if (!sel.empty) return false;
        const pos = sel.from;
        const decos = AUTOLINK_PLUGIN_KEY.getState(view.state)?.decorations;
        if (!decos) return false;
        const candidates = decos.find(Math.max(0, pos - 1), pos + 1);
        let found: typeof candidates[0] | undefined;
        for (const d of candidates) {
          if (pos >= d.from && pos <= d.to) { found = d; break; }
        }
        if (found) {
          const candidate = (found.spec as { candidate?: AutolinkCandidate }).candidate;
          if (candidate && promoteHint(view, found.from, found.to, candidate)) {
            event.preventDefault();
            return true;
          }
          return false;
        }

        // 3) WALK. Cursor off any hint: promote the next dotted word after it
        // (wrapping to the first). Repeated Tab walks the chapter linking each
        // in turn — and TAB MUST NOT ESCAPE while there is linking to do (S307:
        // returning false hands Tab to the browser, which lands focus on the
        // link-all corner button and reads as "Tab did something random").
        // Only an empty hint set lets Tab move focus, which is then correct.
        const hints = findHints(view).sort((a, b) => a.from - b.from);
        if (hints.length === 0) return false;
        const next = hints.find(h => h.from > pos) ?? hints[0];
        if (promoteHint(view, next.from, next.to, next.candidate)) {
          event.preventDefault();
          return true;
        }
        return false;
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
    label: labelForPromotion(view, hit.from, hit.to, hit.candidate),
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
 * (S265, the link-all affordance). Returns the number converted. `only`: one
 * element's hints alone (#24, "Named in the text" under Potentials).
 */
export function convertAllAutolinks(view: EditorView, range?: { from: number; to: number }, only?: string): number {
  const hints = findHints(view, range)
    .filter(h => !only || h.candidate.id === only)
    .sort((a, b) => a.from - b.from);
  if (hints.length === 0) return 0;
  const chipType = view.state.schema.nodes.elementChip;
  if (!chipType) return 0;
  // Labels are read from the ORIGINAL doc, before any replacement shifts
  // positions — reading them inside the loop would sample a document the
  // earlier replacements have already rewritten.
  const labels = hints.map(h => labelForPromotion(view, h.from, h.to, h.candidate));
  let tr = view.state.tr;
  hints.forEach((h, i) => {
    const from = tr.mapping.map(h.from);
    const to = tr.mapping.map(h.to);
    tr = tr.replaceWith(from, to, chipType.create({
      id: h.candidate.id,
      type: h.candidate.type,
      label: labels[i],
    }));
  });
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
