/**
 * Prose autolink kernel — pure functions for linking element mentions in
 * narrative prose, shared by the live editor plugin (decoration scan) and the
 * bulk link/unlink operations (the link-all icon, selection linking,
 * tree-level "link mentions in all scenes").
 *
 * Two representations, transformed IN TANDEM for closed narratives:
 *   - `story` markdown — the portable OW field (`[label](ow://type/uuid)`)
 *   - `atlas_richtext_json` — the TipTap sidecar. The editor prefers the
 *     sidecar unconditionally, so a bulk edit that touched only `story`
 *     would be invisible in atlas (the story-shadowing trap). Every bulk
 *     write goes through BOTH transforms or neither.
 *
 * Names are found by the SDK's `nameFinder` (conv. 197), the one reader of
 * element names in prose for the hints and every "link the mentions" path:
 * a whole name only (no letter, combining mark, decimal digit or underscore
 * stands on either side of it, in any script), case compared by simple case
 * folding, the longest name where several start together, a shared name never
 * answered, nothing read inside a link or an address. Atlas keeps around it:
 * first mention only per document, existing links respected, `only`, and the
 * writer's own text as the label.
 */

import { nameFinder, trimAndFold } from '@onlyworlds/sdk';
import type { Element } from './types';
import { findOwLinks, isChipLink, namedId, owLinkHref, readOwHref } from './ow-links';

/**
 * The shortest name or alias the MENTIONS path counts (`mentionTermsFor`,
 * the context pane's "Mentioned, unlinked"). The hints and link-all take the
 * SDK finder's own minimum, three code points after its trim (conv. 197).
 */
export const MIN_NAME_CHARS = 3;
/**
 * A name or alias longer than this many code points (after the SDK's trim)
 * is not looked for. The finder's work is the text's length times the longest
 * name's, so one pasted name of thousands of characters slowed every
 * keystroke; a name that long is not a mention.
 */
export const MAX_NAME_CODE_POINTS = 200;
/** The SDK finder's own minimum, restated only to tell which elements it holds (`ids`). */
const FINDER_MIN_CODE_POINTS = 3;

export interface AutolinkCandidate {
  id: string;
  type: string;
  displayName: string;
}

export interface AutolinkFound {
  start: number;
  end: number;
  candidate: AutolinkCandidate;
}

export interface AutolinkIndex {
  /** Every whole name in a text, in order, none overlapping; a shared name is never answered. */
  find(text: string): AutolinkFound[];
  /** The ids of every scanned element that holds at least one name the finder keeps, made once with the index. */
  ids: ReadonlySet<string>;
}

/** Narratives and spatial artifacts are not looked for: writers aren't linking pins or maps in body text. */
const UNSCANNED_TYPES = new Set(['narrative', 'pin', 'marker', 'map']);

const codePoints = (text: string): number => {
  let n = 0;
  for (const _ of text) n++;
  return n;
};

/** A printable ASCII character: never white space by the SDK's trim (whose every member is below `!` or above `~`). */
const printableAscii = (unit: number): boolean => unit > 0x20 && unit < 0x7f;

/**
 * A name's length in code points after the SDK's own trim. The fold never
 * changes a count, so `trimAndFold` is asked only of a name that could have
 * white space at an edge (most names are skipped past it: it is the slow part
 * of a build).
 */
function trimmedCodePoints(name: string): number {
  if (name.length > 0 && printableAscii(name.charCodeAt(0)) && printableAscii(name.charCodeAt(name.length - 1))) {
    return codePoints(name);
  }
  return codePoints(trimAndFold(name));
}

/**
 * The ids of the index's elements: the world a chip's or an address's id is
 * named against. Held on the index, never rebuilt (asked on every keystroke).
 */
export function candidateIds(index: AutolinkIndex): ReadonlySet<string> {
  return index.ids;
}

/** The index made for each elements array (see {@link buildAutolinkIndex}). */
const indexes = new WeakMap<readonly Element[], AutolinkIndex>();

/**
 * Build the autolink index from a snapshot of the world's elements: the SDK's
 * `nameFinder` over every element that is not a narrative, pin, marker or map
 * and has a string id, found by its `name` and each string in
 * `atlas_aliases`. A name that is not a string, or is longer than
 * {@link MAX_NAME_CODE_POINTS}, is passed over.
 *
 * CASE-INSENSITIVE, by simple case folding (the SDK's
 * `'folded'`), so prose that writes "the consul" mid-sentence links to the
 * element named "Consul" without anyone having to register a lowercase alias
 * for it. Word edges still apply, so "drizzling" does not match "Drizzle".
 *
 * This is SAFE ONLY BECAUSE the label rule below keeps the writer's own text
 * (see `promotionLabel`). Folding case without that would have turned every
 * lowercase mention into a silent capitalization edit of the prose — the two
 * changes are one decision and must not be separated.
 *
 * Folding can also create NEW ambiguity (an element "Echo" and another
 * "echo" fold to one name). That resolves the correct way by itself: a name
 * two elements share is never answered, so an ambiguous pair links to
 * neither rather than guessing.
 *
 * ONE INDEX FOR EACH ELEMENTS ARRAY: the same array gives the same index
 * object, so the editor's plugin, Named in the text and bulk link, each handed
 * the same lore array on a save, share one build (on a big world the build is
 * the costly part). It rests on the rule `core/strand.ts` states: an elements
 * array, and every element in it, is never changed in place; a change is a
 * new array (`listElements` hands out fresh copies), so a new index.
 */
export function buildAutolinkIndex(elements: readonly Element[]): AutolinkIndex {
  const hit = indexes.get(elements);
  if (hit) return hit;
  const index = makeAutolinkIndex(elements);
  indexes.set(elements, index);
  return index;
}

function makeAutolinkIndex(elements: readonly Element[]): AutolinkIndex {
  const scanned: Element[] = [];
  const namesOf = new Map<Element, string[]>();
  const ids = new Set<string>();
  for (const el of elements) {
    if (!el || typeof el.id !== 'string' || el.id === '' || UNSCANNED_TYPES.has(el.type)) continue;
    const names: string[] = [];
    let holds = false;
    const add = (value: unknown): void => {
      if (typeof value !== 'string') return;
      const length = trimmedCodePoints(value);
      if (length > MAX_NAME_CODE_POINTS) return;
      names.push(value);
      if (length >= FINDER_MIN_CODE_POINTS) holds = true;
    };
    add(el.name);
    if (Array.isArray(el.atlas_aliases)) for (const alias of el.atlas_aliases) add(alias);
    scanned.push(el);
    namesOf.set(el, names);
    if (holds) ids.add(el.id);
  }
  if (ids.size === 0) return { find: () => [], ids };

  const finder = nameFinder(scanned, { case: 'folded', names: el => namesOf.get(el) ?? [] });
  return {
    ids,
    find(text: string): AutolinkFound[] {
      return finder(text).map(f => ({
        start: f.start,
        end: f.end,
        candidate: {
          id: f.element.id,
          type: f.element.type,
          displayName: typeof f.element.name === 'string' && f.element.name.trim() !== ''
            ? f.element.name
            : text.slice(f.start, f.end),
        },
      }));
    },
  };
}

/**
 * THE WRITER'S OWN TEXT IS THE LABEL — for EVERY match kind (Titus's
 * ruling: "creating a link should NEVER change the text in a writing
 * room; never"). Supersedes the earlier half-rule that kept the writer's text
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
 * The label is the span as found, byte for byte, never trimmed again: the
 * finder's span has no white space at its edges by the SDK's own reading, and
 * JavaScript's `trim()` reads white space differently (it strips a byte order
 * mark the SDK keeps), so a second trim could drop a character from the prose.
 *
 * Exported: the live Tab handler (writing-workspace-autolink) delegates here
 * so the two promotion engines cannot drift (paired functions share code).
 * Falls back to the canonical name only for an empty match, which a finder's
 * span never is but must never produce a blank chip.
 */
export function promotionLabel(matched: string, cand: AutolinkCandidate): string {
  return matched.length === 0 ? cand.displayName : matched;
}

/**
 * Is this chip label a legitimate surface form for the element — its name or
 * any alias, compared CASE-INSENSITIVELY? Used by the editors' chip-label
 * rename sync: only a label that fails this check is a stale pre-rename name
 * and gets updated. Case-folding matters: autolink matches
 * case-insensitively and labels keep the writer's casing, so "the duchess",
 * "The Duchess" and "aralia" are all valid labels the sync must not clobber.
 */
export function isValidChipLabel(label: unknown, surface: { name: string; aliases: string[] }): boolean {
  if (typeof label !== 'string' || label.length === 0) return false;
  // Trimmed on BOTH sides of the comparison: a label carrying stray
  // whitespace must not read as "stale" and get rewritten to the name.
  const folded = label.trim().toLowerCase();
  if (folded === surface.name.trim().toLowerCase()) return true;
  return surface.aliases.some(a => typeof a === 'string' && a.trim().toLowerCase() === folded);
}

function escapeRegexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Markdown transforms
// ---------------------------------------------------------------------------

/** A label the markdown link form cannot carry and give back unescaped. */
const MARKDOWN_UNSAFE_LABEL = /[[\]\\]/;

export interface MarkdownAutolinkResult {
  story: string;
  linked: AutolinkCandidate[];
}

/**
 * Chip the first mention of every unambiguous candidate in a markdown story.
 * Existing markdown links (label AND url halves) and bare addresses are
 * never read by the finder; ids already linked anywhere in the story count
 * as mentioned. The inserted label is the WRITER'S MATCHED TEXT verbatim
 * (`promotionLabel`) — mirrors the live Tab handler, which delegates to the
 * same rule.
 *
 * `only` (#24, "Named in the text"): chip that one element alone. The full
 * index still scans, so a longer name still wins its match ("Strahd" never
 * chips inside "Strahd von Zarovich").
 */
export function autolinkMarkdown(story: string, index: AutolinkIndex, only?: string): MarkdownAutolinkResult {
  if (!story || index.ids.size === 0) return { story, linked: [] };

  // Already-linked ids anywhere in the story (first-mention rule).
  // An address names the element `namedId` gives (as written, then lowercase).
  const already = new Set<string>();
  const held = index.ids;
  for (const l of findOwLinks(story)) {
    const id = namedId(l, x => held.has(x));
    if (id !== null) already.add(id);
  }

  const replacements: Array<{ from: number; to: number; cand: AutolinkCandidate; label: string }> = [];
  const proposed = new Set<string>();
  for (const { start, end, candidate: cand } of index.find(story)) {
    if (only && cand.id !== only) continue;
    if (already.has(cand.id) || proposed.has(cand.id)) continue;
    const label = promotionLabel(story.slice(start, end), cand);
    // A label holding `[`, `]` or a backslash is written into a link that
    // `unlinkMarkdown` cannot read back (and a trailing backslash escapes the
    // closing bracket), so this markdown path passes such a mention over and
    // leaves its text as it was. The open editor links it through rich text.
    if (MARKDOWN_UNSAFE_LABEL.test(label)) continue;
    proposed.add(cand.id);
    replacements.push({ from: start, to: end, cand, label });
  }
  if (replacements.length === 0) return { story, linked: [] };

  let out = story;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    out = out.slice(0, r.from)
      + `[${r.label}](${owLinkHref(r.cand.type, r.cand.id)})`
      + out.slice(r.to);
  }
  return { story: out, linked: replacements.map(r => r.cand) };
}

/**
 * Replace every chip link `[label](ow://<type>/<id>)` with its bare label: the
 * links the editor holds as chips (an element address with no moment and no
 * lens, read by the SDK), the same set `unlinkRichtext` turns back to text.
 */
export function unlinkMarkdown(story: string): { story: string; unlinked: number } {
  if (!story) return { story, unlinked: 0 };
  // A label holds no bracket (`autolinkMarkdown` writes none), so an unmatched `[` earlier in the text is never
  // read as the start of the link and stays where it was.
  const re = /\[([^[\]]*)\]\(([^)\s]*)\)/g;
  let n = 0;
  const out = story.replace(re, (all, label: string, href: string) => {
    const link = readOwHref(href);
    if (!link || !isChipLink(link)) return all;
    n++;
    return label;
  });
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
 * doc; the input is never mutated. `only`: as in {@link autolinkMarkdown}.
 */
export function autolinkRichtext(doc: unknown, index: AutolinkIndex, only?: string): RichtextAutolinkResult {
  if (!doc || typeof doc !== 'object' || index.ids.size === 0) return { doc, linked: [] };
  const root = structuredClone(doc) as RtNode;

  const already = new Set<string>();
  const held = index.ids;
  const collect = (n: RtNode): void => {
    if (n.type === 'elementChip' && typeof n.attrs?.id === 'string') {
      const chipId = n.attrs.id as string;
      already.add(namedId({ idAsWritten: chipId, id: chipId.toLowerCase() }, x => held.has(x)) ?? chipId);
    }
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
        next.push(...splitTextNode(child, index, already, proposed, linked, only));
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
 * edit.
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
  only?: string,
): RtNode[] {
  const text = node.text!;
  const parts: RtNode[] = [];
  let cursor = 0;
  for (const { start, end, candidate: cand } of index.find(text)) {
    if (only && cand.id !== only) continue;
    if (already.has(cand.id) || proposed.has(cand.id)) continue;
    proposed.add(cand.id);
    linked.push(cand);
    if (start > cursor) parts.push({ ...node, text: text.slice(cursor, start) });
    parts.push({
      type: 'elementChip',
      attrs: { id: cand.id, type: cand.type, label: promotionLabel(text.slice(start, end), cand) },
    });
    cursor = end;
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
// Term linking — every match of ONE chosen word → ONE chosen element
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
 * Shrink a match to its non-whitespace core (Titus: a trailing space
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
      + `[${story.slice(from, to)}](${owLinkHref(target.type, target.id)})`
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
