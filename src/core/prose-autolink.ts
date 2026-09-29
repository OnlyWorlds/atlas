/**
 * Prose autolink kernel — pure functions for linking element mentions in
 * narrative prose, shared by the live editor plugin (decoration scan) and the
 * bulk link/unlink operations (S265: the link-all icon, selection linking,
 * tree-level "link mentions in all scenes").
 *
 * Two representations, transformed IN TANDEM for closed narratives:
 *   - `story` markdown — the portable OW field (`[label](ow://type/uuid)`)
 *   - `atlas_richtext_json` — the TipTap sidecar. The editor prefers the
 *     sidecar unconditionally, so a bulk edit that touched only `story`
 *     would be invisible in atlas (the story-shadowing trap). Every bulk
 *     write goes through BOTH transforms or neither.
 *
 * Matching rules mirror the live autolink plugin exactly (its scan calls
 * into the same index): case-sensitive word-boundary match on name ∪
 * atlas_aliases, min 3 chars, ambiguous names skipped, first mention only
 * per document, existing links respected.
 */

import type { Element } from './types';
import { createOwLinkScanner } from './ow-links';

export const MIN_NAME_CHARS = 3;
/** Cap alternation size to keep regex compile fast. */
const MAX_KEYS_IN_INDEX = 2000;

export interface AutolinkCandidate {
  id: string;
  type: string;
  displayName: string;
}

export interface AutolinkIndex {
  /** Map from match key (case-sensitive name or alias) to its candidate(s). */
  byName: Map<string, AutolinkCandidate[]>;
  /** Pre-compiled combined regex (case-sensitive, word-bounded alternation). */
  scanner: RegExp | null;
}

/**
 * Build the autolink index from a snapshot of the world's elements. Includes
 * both `name` and `atlas_aliases` as match keys. Narratives + spatial
 * artifacts excluded — writers aren't linking pins or maps in body text.
 *
 * CASE-INSENSITIVE since S307 (Captain's ask). Keys are folded to lowercase
 * and the scanner carries the `i` flag, so prose that writes "the consul"
 * mid-sentence links to the element named "Consul" without anyone having to
 * register a lowercase alias for it. Word boundaries still apply, so
 * "drizzling" does not match "Drizzle".
 *
 * This is SAFE ONLY BECAUSE the label rule below keeps the writer's own text
 * (see `promotionLabel`). Folding case without that would have turned every
 * lowercase mention into a silent capitalization edit of the prose — the two
 * changes are one decision and must not be separated.
 *
 * Folding can also create NEW ambiguity (an element "Echo" and another
 * "echo" now share a key). That resolves the correct way by itself: 2+
 * candidates for a key is already suppressed entirely, so an ambiguous pair
 * links to neither rather than guessing.
 */
export function buildAutolinkIndex(elements: Element[]): AutolinkIndex {
  const byName = new Map<string, AutolinkCandidate[]>();
  for (const el of elements) {
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
  // Longest first so multi-word names win over their sub-words.
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
  // Folded key — the surface form the writer typed is recovered at promotion
  // time from the matched text, never from this key.
  const folded = trimmed.toLowerCase();
  const existing = map.get(folded);
  if (existing) {
    if (!existing.some(c => c.id === candidate.id)) existing.push(candidate);
  } else {
    map.set(folded, [candidate]);
  }
}

/**
 * THE WRITER'S OWN TEXT IS THE LABEL — for EVERY match kind (Captain's
 * ruling, S309: "creating a link should NEVER change the text in a writing
 * room; never"). Supersedes the S307 half-rule that kept the writer's text
 * only for case variants while a genuinely different alias still snapped to
 * the canonical name — which is how link-all rewrote the tour's own sentence
 * into "The Hegemony The Consul sat on the Spaceship Balcony…".
 *
 * A link is a relationship, not a spelling correction. The `id` carries
 * identity; the label is presentation, and in a writing room the writer's
 * presentation always wins — an alias exists precisely so the prose can call
 * something what the prose calls it. The chip still RESOLVES to the canonical
 * element; only the visible text is sacred.
 *
 * Exported: the live Tab handler (writing-workspace-autolink) delegates here
 * so the two promotion engines cannot drift (paired functions share code).
 * Falls back to the canonical name only for an empty match, which should not
 * happen but must never produce a blank chip.
 */
export function promotionLabel(matched: string, cand: AutolinkCandidate): string {
  const typed = matched.trim();
  return typed.length === 0 ? cand.displayName : typed;
}

/**
 * Is this chip label a legitimate surface form for the element — its name or
 * any alias, compared CASE-INSENSITIVELY? Used by the editors' chip-label
 * rename sync: only a label that fails this check is a stale pre-rename name
 * and gets updated. Case-folding matters (S309): autolink matches
 * case-insensitively and labels keep the writer's casing, so "the duchess",
 * "The Duchess" and "aralia" are all valid labels the sync must not clobber.
 */
export function isValidChipLabel(label: unknown, surface: { name: string; aliases: string[] }): boolean {
  if (typeof label !== 'string' || label.length === 0) return false;
  // Trimmed on BOTH sides of the comparison (S355): a label carrying stray
  // whitespace must not read as "stale" and get rewritten to the name.
  const folded = label.trim().toLowerCase();
  if (folded === surface.name.trim().toLowerCase()) return true;
  return surface.aliases.some(a => typeof a === 'string' && a.trim().toLowerCase() === folded);
}

function escapeRegexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCombinedRegex(keys: string[]): RegExp | null {
  if (keys.length === 0) return null;
  const pattern = `\\b(?:${keys.map(escapeRegexLiteral).join('|')})\\b`;
  try {
    // `i` pairs with the folded index keys (S307).
    return new RegExp(pattern, 'gi');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Markdown transforms
// ---------------------------------------------------------------------------

export interface MarkdownAutolinkResult {
  story: string;
  linked: AutolinkCandidate[];
}

/**
 * Chip the first mention of every unambiguous candidate in a markdown story.
 * Existing markdown links (label AND url halves) are protected spans; ids
 * already linked anywhere in the story count as mentioned. The inserted
 * label is the WRITER'S MATCHED TEXT verbatim (`promotionLabel`, S309) —
 * mirrors the live Tab handler, which delegates to the same rule.
 */
export function autolinkMarkdown(story: string, index: AutolinkIndex): MarkdownAutolinkResult {
  if (!story || !index.scanner) return { story, linked: [] };

  // Protected spans: any markdown link `[label](url)` in full.
  const protectedSpans: Array<[number, number]> = [];
  const linkRe = /\[[^\]]*\]\([^)]*\)/g;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(story)) !== null) {
    protectedSpans.push([lm.index, lm.index + lm[0].length]);
  }
  const isProtected = (a: number, b: number): boolean =>
    protectedSpans.some(([s, e]) => a < e && b > s);

  // Already-linked ids anywhere in the story (first-mention rule).
  const already = new Set<string>();
  const ows = createOwLinkScanner();
  let om: RegExpExecArray | null;
  while ((om = ows.exec(story)) !== null) already.add(om[2]);

  // Flags come FROM the scanner, never restated — a hardcoded 'g' here
  // would silently drop the case-insensitivity the index depends on.
  const re = new RegExp(index.scanner.source, index.scanner.flags);
  const replacements: Array<{ from: number; to: number; cand: AutolinkCandidate }> = [];
  const proposed = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(story)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    const from = m.index;
    const to = m.index + m[0].length;
    if (isProtected(from, to)) continue;
    const cands = index.byName.get(m[0].toLowerCase());
    if (!cands || cands.length !== 1) continue; // unknown or ambiguous
    const cand = cands[0];
    if (already.has(cand.id) || proposed.has(cand.id)) continue;
    proposed.add(cand.id);
    replacements.push({ from, to, cand });
  }
  if (replacements.length === 0) return { story, linked: [] };

  let out = story;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    out = out.slice(0, r.from)
      + `[${promotionLabel(story.slice(r.from, r.to), r.cand)}](ow://${r.cand.type}/${r.cand.id})`
      + out.slice(r.to);
  }
  return { story: out, linked: replacements.map(r => r.cand) };
}

/** Replace every `[label](ow://…)` link with its bare label. */
export function unlinkMarkdown(story: string): { story: string; unlinked: number } {
  if (!story) return { story, unlinked: 0 };
  const re = /\[([^\]]*)\]\(ow:\/\/[a-z_]+\/[\w-]+\)/gi;
  let n = 0;
  const out = story.replace(re, (_all, label: string) => { n++; return label; });
  return { story: out, unlinked: n };
}

// ---------------------------------------------------------------------------
// Richtext (TipTap JSON) transforms — the sidecar's half of every bulk write
// ---------------------------------------------------------------------------

interface RtNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: RtNode[];
  marks?: unknown[];
}

export interface RichtextAutolinkResult {
  doc: unknown;
  linked: AutolinkCandidate[];
}

/**
 * The richtext mirror of {@link autolinkMarkdown}: walk the TipTap JSON in
 * document order, split text nodes around first mentions, insert elementChip
 * nodes. Marks on a split text node carry to its text halves (a bolded name
 * becomes an unbolded chip — same as the live Tab conversion). Returns a new
 * doc; the input is never mutated.
 */
export function autolinkRichtext(doc: unknown, index: AutolinkIndex): RichtextAutolinkResult {
  if (!doc || typeof doc !== 'object' || !index.scanner) return { doc, linked: [] };
  const root = structuredClone(doc) as RtNode;

  const already = new Set<string>();
  const collect = (n: RtNode): void => {
    if (n.type === 'elementChip' && typeof n.attrs?.id === 'string') already.add(n.attrs.id as string);
    n.content?.forEach(collect);
  };
  collect(root);

  const linked: AutolinkCandidate[] = [];
  const proposed = new Set<string>();

  const transform = (n: RtNode): void => {
    if (!Array.isArray(n.content)) return;
    const next: RtNode[] = [];
    for (const child of n.content) {
      if (child.type === 'text' && typeof child.text === 'string' && child.text.length > 0 && !inWebLink(child)) {
        next.push(...splitTextNode(child, index, already, proposed, linked));
      } else {
        transform(child);
        next.push(child);
      }
    }
    n.content = next;
  };
  transform(root);

  return { doc: root, linked };
}

/**
 * Text already inside a web link is left alone, as the markdown side leaves
 * `[text](url)` spans alone: splitting it made the two halves of a scene
 * disagree, and the sidecar rule then read Atlas's own write as an outside
 * edit (S365 gate lens A H3).
 */
function inWebLink(node: RtNode): boolean {
  return Array.isArray(node.marks) && node.marks.some(m => (m as { type?: string } | null)?.type === 'link');
}

function splitTextNode(
  node: RtNode,
  index: AutolinkIndex,
  already: Set<string>,
  proposed: Set<string>,
  linked: AutolinkCandidate[],
): RtNode[] {
  const text = node.text!;
  const re = new RegExp(index.scanner!.source, index.scanner!.flags);
  const parts: RtNode[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    const cands = index.byName.get(m[0].toLowerCase());
    if (!cands || cands.length !== 1) continue;
    const cand = cands[0];
    if (already.has(cand.id) || proposed.has(cand.id)) continue;
    proposed.add(cand.id);
    linked.push(cand);
    if (m.index > cursor) parts.push({ ...node, text: text.slice(cursor, m.index) });
    parts.push({
      type: 'elementChip',
      attrs: { id: cand.id, type: cand.type, label: promotionLabel(m[0], cand) },
    });
    cursor = m.index + m[0].length;
  }
  if (parts.length === 0) return [node];
  if (cursor < text.length) parts.push({ ...node, text: text.slice(cursor) });
  return parts;
}

/** Replace every elementChip node with a plain text node carrying its label. */
export function unlinkRichtext(doc: unknown): { doc: unknown; unlinked: number } {
  if (!doc || typeof doc !== 'object') return { doc, unlinked: 0 };
  const root = structuredClone(doc) as RtNode;
  let n = 0;
  const transform = (node: RtNode): void => {
    if (!Array.isArray(node.content)) return;
    const next: RtNode[] = [];
    for (const child of node.content) {
      if (child.type === 'elementChip') {
        n++;
        const label = String(child.attrs?.label ?? '');
        // An empty label would be an invalid PM text node — drop the chip.
        if (label) next.push({ type: 'text', text: label });
        continue;
      }
      transform(child);
      next.push(child);
    }
    node.content = next;
  };
  transform(root);
  return { doc: root, unlinked: n };
}

// ---------------------------------------------------------------------------
// Term linking (S355) — every match of ONE chosen word → ONE chosen element
// ---------------------------------------------------------------------------
//
// The find bar's "Link to element" verb. Unlike the autolink transforms above
// this is NOT first-mention: the writer typed the word and picked the target,
// so every occurrence links (a Discord request, 2026-09-03: "search narrative
// text, kinda like a ctrl f, and link all of them to a specific element").
// The automatic link-all stays sparse; the deliberate gesture goes dense.
//
// Matching mirrors the find bar exactly (substring by default, optional
// case-sensitive and whole-word) so what the bar highlights is what links.
// Text already inside a link or chip is never touched. The label is the
// writer's matched text verbatim (THE LABEL LAW, convention #49b).

export interface TermMatchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface TermLinkTarget {
  id: string;
  type: string;
}

/**
 * Shrink a match to its non-whitespace core (S355, Captain: a trailing space
 * in the search term was becoming part of the chip label). The surrounding
 * whitespace stays prose; an all-whitespace match links nothing.
 */
export function trimMatchSpan(text: string, from: number, to: number): [number, number] | null {
  let a = from;
  let b = to;
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  return a < b ? [a, b] : null;
}

/**
 * Same scanner the find plugin builds — one shape, two homes kept in step by
 * tests. Accepts several terms (an element's name ∪ aliases): longest first,
 * so "Orc Chief" wins over "orc" where both could match.
 */
export function buildTermScanner(term: string | readonly string[], opts: TermMatchOptions = {}): RegExp | null {
  const terms = (typeof term === 'string' ? [term] : [...term]).filter(t => t.length > 0);
  if (terms.length === 0) return null;
  terms.sort((a, b) => b.length - a.length);
  const escaped = terms.map(escapeRegexLiteral).join('|');
  const pattern = opts.wholeWord ? `\\b(?:${escaped})\\b` : `(?:${escaped})`;
  try {
    return new RegExp(pattern, opts.caseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
}

export interface TermLinkMarkdownResult {
  story: string;
  linked: number;
}

/**
 * Every unprotected, whitespace-trimmed match of `term` in a markdown story,
 * as [from, to) offsets. Existing links are protected. The one span finder
 * behind {@link linkTermMarkdown} and the unlinked-mentions count, so the
 * number the pane shows is the number the link writes.
 */
export function findTermSpansMarkdown(
  story: string,
  term: string | readonly string[],
  opts: TermMatchOptions = {},
): Array<[number, number]> {
  const scanner = buildTermScanner(term, opts);
  if (!story || !scanner) return [];

  const protectedSpans: Array<[number, number]> = [];
  const linkRe = /\[[^\]]*\]\([^)]*\)/g;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(story)) !== null) {
    protectedSpans.push([lm.index, lm.index + lm[0].length]);
  }
  const isProtected = (a: number, b: number): boolean =>
    protectedSpans.some(([s, e]) => a < e && b > s);

  const spans: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = scanner.exec(story)) !== null) {
    if (m[0].length === 0) { scanner.lastIndex++; continue; }
    const span = trimMatchSpan(story, m.index, m.index + m[0].length);
    if (!span || isProtected(span[0], span[1])) continue;
    spans.push(span);
  }
  return spans;
}

/** Chip EVERY unprotected match of `term` in a markdown story to `target`. */
export function linkTermMarkdown(
  story: string,
  term: string | readonly string[],
  target: TermLinkTarget,
  opts: TermMatchOptions = {},
): TermLinkMarkdownResult {
  const spans = findTermSpansMarkdown(story, term, opts);
  if (spans.length === 0) return { story, linked: 0 };

  let out = story;
  for (let i = spans.length - 1; i >= 0; i--) {
    const [from, to] = spans[i];
    out = out.slice(0, from)
      + `[${story.slice(from, to)}](ow://${target.type}/${target.id})`
      + out.slice(to);
  }
  return { story: out, linked: spans.length };
}

export interface TermLinkRichtextResult {
  doc: unknown;
  linked: number;
}

/**
 * The sidecar half of {@link linkTermMarkdown}: every match inside a text
 * node becomes an elementChip; chips already in the doc are atoms and are
 * never entered. Returns a new doc; the input is never mutated.
 */
export function linkTermRichtext(
  doc: unknown,
  term: string | readonly string[],
  target: TermLinkTarget,
  opts: TermMatchOptions = {},
): TermLinkRichtextResult {
  const scanner = buildTermScanner(term, opts);
  if (!doc || typeof doc !== 'object' || !scanner) return { doc, linked: 0 };
  const root = structuredClone(doc) as RtNode;
  let linked = 0;

  const splitOne = (node: RtNode): RtNode[] => {
    const text = node.text!;
    const re = new RegExp(scanner.source, scanner.flags);
    const parts: RtNode[] = [];
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const span = trimMatchSpan(text, m.index, m.index + m[0].length);
      if (!span) continue;
      const [from, to] = span;
      if (from > cursor) parts.push({ ...node, text: text.slice(cursor, from) });
      parts.push({ type: 'elementChip', attrs: { id: target.id, type: target.type, label: text.slice(from, to) } });
      linked++;
      cursor = to;
    }
    if (parts.length === 0) return [node];
    if (cursor < text.length) parts.push({ ...node, text: text.slice(cursor) });
    return parts;
  };

  const transform = (n: RtNode): void => {
    if (!Array.isArray(n.content)) return;
    const next: RtNode[] = [];
    for (const child of n.content) {
      if (child.type === 'text' && typeof child.text === 'string' && child.text.length > 0 && !inWebLink(child)) {
        next.push(...splitOne(child));
      } else {
        transform(child);
        next.push(child);
      }
    }
    n.content = next;
  };
  transform(root);
  return { doc: root, linked };
}
