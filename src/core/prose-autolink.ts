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

const MIN_NAME_CHARS = 3;
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
 * (see `labelFromSource`). Folding case without that would have turned every
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
 * THE WRITER'S OWN TEXT IS THE LABEL (Captain, S307).
 *
 * Every promotion path used to stamp `cand.displayName` — the ELEMENT's name.
 * Matching is exact-case in both autolink engines, so a pure case variant
 * never matches at all; what actually rewrote prose was ALIASES. An alias is
 * indexed under its own key but carries `displayName: el.name`, so linking
 * "the duchess" silently replaced it with "Lyra", and linking a lowercase
 * styling of a name replaced it with the record's casing.
 *
 * A link is a relationship, not a spelling correction. The `id` carries
 * identity; the label is presentation, and in a writing room the writer's
 * presentation wins — an alias exists precisely so the prose can call
 * something what the prose calls it.
 */
function labelFromSource(matched: string, cand: AutolinkCandidate): string {
  const typed = matched.trim();
  if (typed.length === 0) return cand.displayName;
  // CASE ONLY, and this is now LOad-BEARING: matching folds case (S307), so
  // without this every lowercase mention would be silently recapitalised to
  // the record's spelling. Guarded by "THE GUARANTEE" in
  // prose-autolink.test.ts, which sweeps four casings through both engines.
  //
  // A GENUINELY different alias ("the duchess" for "Lyra") still resolves to
  // the canonical name — a deliberate, separately tested decision.
  const sameWordDifferentCase = typed.toLowerCase() === cand.displayName.trim().toLowerCase();
  return sameWordDifferentCase ? typed : cand.displayName;
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
 * label is the candidate's canonical display name — mirrors the live Tab
 * handler, which also replaces an alias with the element's name.
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
      + `[${labelFromSource(story.slice(r.from, r.to), r.cand)}](ow://${r.cand.type}/${r.cand.id})`
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
      if (child.type === 'text' && typeof child.text === 'string' && child.text.length > 0) {
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
      attrs: { id: cand.id, type: cand.type, label: labelFromSource(m[0], cand) },
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
