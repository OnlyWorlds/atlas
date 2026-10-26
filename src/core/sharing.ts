/**
 * Sharing model helpers (see DESIGN_SHARING.md + SHARING_CONTRACT.md).
 *
 * A **page** is a Narrative with `subtype === 'page'` — the unit of sharing.
 * Its composition is an ordered single-column stack of **blocks** stored in
 * the atlas-local field `atlas_page_blocks` (never sent to the OW API). The
 * canonical `story` field carries a derived plain-markdown compilation of the
 * blocks so the page stays readable on other devices / in other OW tools
 * (one source of truth — the blocks; one honest derived mirror — story).
 *
 * Block model v1 (minimal-blocks, sharing call 2): heading / prose /
 * element-card. The set grows (map, collection, image, callout, divider,
 * circle) without migration because pages are block-shaped from day one.
 *
 * ## The refs mirror (id-swap correctness)
 *
 * The old flat id rewrite (`rewriteIdReferences`, retired) walked flat
 * string + string-array fields only — ids nested inside block OBJECTS would silently go stale when the OW
 * server assigns its own id on first push (the make-online journey: compose
 * pages locally → make online → every element id-swaps). Instead of teaching
 * the sync layer about block shapes, pages mirror every element-card's id
 * into the flat `atlas_page_refs: string[]` (in block order). The existing
 * rewrite contract handles that array automatically; `blocksOf()` heals each
 * element-card's nested id from the mirror at read time (positional pairing —
 * both are always written in the same save via `pageBlocksPatch`).
 */

import type { Element } from './types';

/** Narrative subtype that marks a page. Free-text subtype — no schema change. */
export const PAGE_SUBTYPE = 'page';

/** True iff the element is a page (a narrative tagged with the page subtype). */
export function isPageNarrative(el: Element | null | undefined): boolean {
  if (!el || el.type !== 'narrative') return false;
  const subtype = (el as Record<string, unknown>).subtype;
  return typeof subtype === 'string' && subtype.toLowerCase() === PAGE_SUBTYPE;
}

/** All pages among the given elements. */
export function listPages(elements: Element[]): Element[] {
  return elements.filter(isPageNarrative);
}

// ---------------------------------------------------------------------------
// Intent — the sharing axis (DESIGN_SHARING "three intents").
// ---------------------------------------------------------------------------

export type PageIntent = 'show' | 'reference' | 'publish';

export const PAGE_INTENTS: readonly PageIntent[] = ['show', 'reference', 'publish'];

/** A page's intent; defaults to 'show' when missing/unknown. */
export function pageIntentOf(el: Element): PageIntent {
  const raw = (el as Record<string, unknown>).atlas_page_intent;
  return typeof raw === 'string' && (PAGE_INTENTS as string[]).includes(raw)
    ? (raw as PageIntent)
    : 'show';
}

// ---------------------------------------------------------------------------
// Theme tokens (S3) — curated values only, no raw CSS (DESIGN_SHARING).
// Stored in `atlas_page_theme` (atlas-local), validated into the payload's
// `theme` slot at build, applied by the preview AND the viewer. Validation is
// allowlist-based: unknown keys/values DROP (a hand-edited theme can't inject
// styles — payloads render for arbitrary public visitors).
// ---------------------------------------------------------------------------

export interface PageTheme {
  /** Accent hex from PAGE_THEME_ACCENTS. Default: OW cyan. */
  accent?: string;
  /** Font pairing key from PAGE_THEME_FONTS. Default: 'clean'. */
  font?: string;
  mode?: 'dark' | 'light';
  density?: 'compact' | 'cozy' | 'airy';
  width?: 'narrow' | 'regular' | 'wide';
  /** Cover image URL (https) rendered as a banner above the title. */
  cover?: string;
}

/** Curated accent palette — name → hex (rendered as swatches in the builder). */
export const PAGE_THEME_ACCENTS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'cyan', hex: '#22d3ee' },     // the OnlyWorlds default
  { name: 'amber', hex: '#fbbf24' },
  { name: 'emerald', hex: '#34d399' },
  { name: 'violet', hex: '#a78bfa' },
  { name: 'rose', hex: '#fb7185' },
  { name: 'sky', hex: '#38bdf8' },
  { name: 'stone', hex: '#a8a29e' },
];

/**
 * Curated font pairings — system stacks only in v1 (no webfont loading: zero
 * FOUT, zero network dependency in the public viewer).
 */
export const PAGE_THEME_FONTS: ReadonlyArray<{ key: string; label: string; heading: string; body: string }> = [
  { key: 'clean', label: 'clean', heading: "system-ui, sans-serif", body: "system-ui, sans-serif" },
  { key: 'literary', label: 'literary', heading: "Georgia, 'Times New Roman', serif", body: "system-ui, sans-serif" },
  { key: 'archival', label: 'archival', heading: "Georgia, 'Times New Roman', serif", body: "Georgia, 'Times New Roman', serif" },
  { key: 'terminal', label: 'terminal', heading: "ui-monospace, 'Cascadia Mono', monospace", body: "system-ui, sans-serif" },
];

const THEME_MODES = new Set(['dark', 'light']);
const THEME_DENSITIES = new Set(['compact', 'cozy', 'airy']);
const THEME_WIDTHS = new Set(['narrow', 'regular', 'wide']);

/**
 * Validate a raw theme value into the curated token set. Unknown keys and
 * out-of-set values drop silently; an empty result means "all defaults".
 * Shared by the builder UI, the payload builder, and (as a copy) the viewer.
 */
export function parsePageTheme(raw: unknown): PageTheme {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const t = raw as Record<string, unknown>;
  const out: PageTheme = {};
  if (typeof t.accent === 'string' && PAGE_THEME_ACCENTS.some(a => a.hex === t.accent)) out.accent = t.accent;
  if (typeof t.font === 'string' && PAGE_THEME_FONTS.some(f => f.key === t.font)) out.font = t.font;
  if (typeof t.mode === 'string' && THEME_MODES.has(t.mode)) out.mode = t.mode as PageTheme['mode'];
  if (typeof t.density === 'string' && THEME_DENSITIES.has(t.density)) out.density = t.density as PageTheme['density'];
  if (typeof t.width === 'string' && THEME_WIDTHS.has(t.width)) out.width = t.width as PageTheme['width'];
  if (typeof t.cover === 'string' && /^https:\/\//i.test(t.cover.trim())) out.cover = t.cover.trim();
  return out;
}

/** The page's validated theme; {} = all defaults. */
export function pageThemeOf(el: Element): PageTheme {
  return parsePageTheme((el as Record<string, unknown>).atlas_page_theme);
}

// ---------------------------------------------------------------------------
// Block model v1.
// ---------------------------------------------------------------------------

export interface HeadingBlock {
  id: string;
  kind: 'heading';
  text: string;
  /** 1 = section, 2 = subsection. */
  level: 1 | 2;
}

export interface ProseBlock {
  id: string;
  kind: 'prose';
  /** Markdown is canonical for the block (mirrors the writing room's storage model). */
  markdown: string;
  /** TipTap JSON for high-fidelity editing; null until edited richly. */
  richtextJson?: unknown | null;
}

export interface ElementCardBlock {
  id: string;
  kind: 'element-card';
  /** The bound element. Healed from `atlas_page_refs` on read — see module doc. */
  elementId: string;
  variant: 'compact' | 'full';
  /** Field names chosen as visible on the card (the disclosure primitive). */
  fields: string[];
  /**
   * Render the element's image on this card — small avatar on compact,
   * banner on full. ABSENT = true (only an explicit false is stored, so
   * pre-existing pages and equality tests stay untouched); per-card opt-out.
   * When every card for an element opts out, its image_url
   * stays out of the payload too.
   */
  showImage?: boolean;
}

/**
 * S5 — the Knowledge bridge (DESIGN_SHARING "Knowledge Integration"). Renders
 * a knower's compiled knowledge: every entry they hold, full texts with
 * attribution. The knower id participates in the refs mirror exactly like a
 * card's element id (healed on id-swap). At publish the compilation FREEZES
 * into the payload (entries snapshot) — the circle is the disclosure
 * boundary; later knowledge edits never leak to link-holders.
 */
export interface CircleBlock {
  id: string;
  kind: 'circle';
  /** The knower — a Circle (Collective) or a Character. Healed from the refs mirror. */
  knowerId: string;
}

/**
 * S6 — a set of elements as an identity grid (compact mini-cards: avatar/icon
 * + name + type). Members join the payload identity-only, exactly like
 * compact cards. ALL member ids join the refs mirror (count-aware positional
 * pairing — see pageRefsFor/blocksOf).
 */
export interface CollectionBlock {
  id: string;
  kind: 'collection';
  elementIds: string[];
}

/**
 * S7 — a world map as a published image + chosen pins (D3 resolved session
 * 239: image_url-only — local media never leaves the folder; users host the
 * image themselves). `pinIds` is an INCLUDE-list initialized to all the map's
 * pins at block creation — new pins never auto-join a published page (chosen
 * content only). mapId + every pinId join the refs mirror (count-aware).
 * At publish the block FREEZES: image url + %-positioned pin tokens
 * (name/type; ref only when the pinned element is itself included).
 */
export interface MapBlock {
  id: string;
  kind: 'map';
  mapId: string;
  pinIds: string[];
  /** Always-visible pin labels. ABSENT = true (only explicit false stored). */
  showLabels?: boolean;
  /**
   * Zone overlays to render, as an INCLUDE-list mirroring `pinIds`.
   * ABSENT = all zones on the map (the friendly default + legacy blocks that
   * predate zones); PRESENT (even empty) = exactly these zones. Initialized
   * to all the map's zones at block creation, so new zones never auto-join a
   * curated map. Joins the refs mirror (healed on id-swap, count-aware).
   */
  zoneIds?: string[];
  /**
   * Pins opted INTO full-profile disclosure (B6, settled 2026-07-03 —
   * supersedes the earlier full-fields-by-default call): an included pin
   * ships its element as identity + description (+ image) only; pins listed
   * here ship every populated field. Subset of `pinIds`. NOT part of the refs
   * mirror — `blocksOf` rewrites entries alongside the paired `pinIds` heal,
   * and an entry that no longer matches any pinId simply reads as not-full
   * (fails toward LESS disclosure, never more).
   */
  fullPinIds?: string[];
}

/**
 * A saved chart embedded as a block. References a chart in `.atlas/charts.json`
 * by id — NOT an OW element (charts are atlas-local config). At publish the
 * chart FREEZES into the payload (resolved nodes + axis bounds; identity only,
 * ref when the element is otherwise carded) — see `freezeChartBlock`.
 *
 * Unlike every element-bearing block, a chart block contributes NOTHING to the
 * refs mirror: `chartId` is an atlas-local id, never an OW element id, so it
 * never id-swaps. The element ids INSIDE the referenced chart's scope are kept
 * correct at the charts.json layer (`rewriteChartScopeIds` on id-swap), and
 * frozen against the current elements at publish.
 */
export interface ChartBlock {
  id: string;
  kind: 'chart';
  chartId: string;
}

export type PageBlock = HeadingBlock | ProseBlock | ElementCardBlock | CircleBlock | CollectionBlock | MapBlock | ChartBlock;

export function newBlockId(): string {
  return crypto.randomUUID();
}

/**
 * Parse a raw `atlas_page_blocks` value defensively: accept well-formed
 * blocks, drop anything malformed (wrong kind, missing required fields).
 * Never throws — a corrupted blocks array degrades to the valid subset.
 */
export function parsePageBlocks(raw: unknown): PageBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: PageBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const b = item as Record<string, unknown>;
    if (typeof b.id !== 'string' || b.id.length === 0) continue;
    switch (b.kind) {
      case 'heading':
        if (typeof b.text !== 'string') continue;
        out.push({ id: b.id, kind: 'heading', text: b.text, level: b.level === 2 ? 2 : 1 });
        break;
      case 'prose':
        if (typeof b.markdown !== 'string') continue;
        out.push({
          id: b.id, kind: 'prose', markdown: b.markdown,
          richtextJson: b.richtextJson && typeof b.richtextJson === 'object' ? b.richtextJson : null,
        });
        break;
      case 'element-card': {
        if (typeof b.elementId !== 'string' || b.elementId.length === 0) continue;
        const card: ElementCardBlock = {
          id: b.id, kind: 'element-card', elementId: b.elementId,
          variant: b.variant === 'full' ? 'full' : 'compact',
          fields: Array.isArray(b.fields) ? b.fields.filter((f): f is string => typeof f === 'string') : [],
        };
        if (b.showImage === false) card.showImage = false; // absent = true
        out.push(card);
        break;
      }
      case 'circle':
        if (typeof b.knowerId !== 'string' || b.knowerId.length === 0) continue;
        out.push({ id: b.id, kind: 'circle', knowerId: b.knowerId });
        break;
      case 'collection':
        if (!Array.isArray(b.elementIds)) continue;
        out.push({
          id: b.id, kind: 'collection',
          elementIds: b.elementIds.filter((v): v is string => typeof v === 'string' && v.length > 0),
        });
        break;
      case 'map': {
        if (typeof b.mapId !== 'string' || b.mapId.length === 0) continue;
        const mapBlock: MapBlock = {
          id: b.id, kind: 'map', mapId: b.mapId,
          pinIds: Array.isArray(b.pinIds)
            ? b.pinIds.filter((v): v is string => typeof v === 'string' && v.length > 0) : [],
        };
        if (b.showLabels === false) mapBlock.showLabels = false; // absent = true
        if (Array.isArray(b.zoneIds)) {
          // Present (even empty) is meaningful — absent = all zones.
          mapBlock.zoneIds = b.zoneIds.filter((v): v is string => typeof v === 'string' && v.length > 0);
        }
        if (Array.isArray(b.fullPinIds)) {
          const full = b.fullPinIds.filter((v): v is string => typeof v === 'string' && v.length > 0);
          if (full.length > 0) mapBlock.fullPinIds = full;
        }
        out.push(mapBlock);
        break;
      }
      case 'chart':
        if (typeof b.chartId !== 'string' || b.chartId.length === 0) continue;
        out.push({ id: b.id, kind: 'chart', chartId: b.chartId });
        break;
      default:
        continue; // unknown kind — forward-compat drop
    }
  }
  return out;
}

/**
 * The page's blocks, with element-bearing ids HEALED from the
 * `atlas_page_refs` mirror. Pairing is positional and COUNT-AWARE: cards and
 * circles consume one ref each, collections consume elementIds.length refs —
 * blocks and refs are always written in the same save (pageBlocksPatch), so
 * the counts line up by construction; an id-swap rewrites VALUES in the flat
 * array, never its length. Falls back to the block's own ids when the mirror
 * is missing/short (out-of-band edits degrade gracefully).
 *
 * A page with no blocks here but a `story` is the server's or another
 * device's page (blocks are atlas-local, never synced): its story is the
 * page, read as one prose block (`pageBlocksFromStory`), so a reader of a
 * shared world sees the text and a first save keeps it rather than
 * compiling over it (Titus's A9 ruling for Make Online,
 * 2026-10-04). The block's id is fixed per page, so an edit finds it again.
 */
export function blocksOf(el: Element): PageBlock[] {
  const blocks = parsePageBlocks((el as Record<string, unknown>).atlas_page_blocks);
  if (blocks.length === 0) {
    return pageBlocksFromStory((el as Record<string, unknown>).story, `story-${el.id}`).atlas_page_blocks;
  }
  const rawRefs = (el as Record<string, unknown>).atlas_page_refs;
  const refs = Array.isArray(rawRefs)
    ? rawRefs.filter((v): v is string => typeof v === 'string')
    : [];
  let refIndex = 0;
  for (const b of blocks) {
    if (b.kind === 'element-card') {
      const mirrored = refs[refIndex];
      if (mirrored && mirrored !== b.elementId) b.elementId = mirrored;
      refIndex++;
    } else if (b.kind === 'circle') {
      const mirrored = refs[refIndex];
      if (mirrored && mirrored !== b.knowerId) b.knowerId = mirrored;
      refIndex++;
    } else if (b.kind === 'collection') {
      for (let i = 0; i < b.elementIds.length; i++) {
        const mirrored = refs[refIndex];
        if (mirrored && mirrored !== b.elementIds[i]) b.elementIds[i] = mirrored;
        refIndex++;
      }
    } else if (b.kind === 'map') {
      const mirroredMap = refs[refIndex];
      if (mirroredMap && mirroredMap !== b.mapId) b.mapId = mirroredMap;
      refIndex++;
      for (let i = 0; i < b.pinIds.length; i++) {
        const mirrored = refs[refIndex];
        if (mirrored && mirrored !== b.pinIds[i]) {
          // Keep the full-profile opt-in paired with its pin across id-swaps.
          // A missed rewrite fails toward LESS disclosure (entry stops
          // matching → pin reads as identity-only), never more.
          if (b.fullPinIds) {
            b.fullPinIds = b.fullPinIds.map(id => (id === b.pinIds[i] ? mirrored : id));
          }
          b.pinIds[i] = mirrored;
        }
        refIndex++;
      }
      // Zone include-list heals the same way, after the pins. Absent =
      // all zones, so it consumes zero refs — matching pageRefsFor.
      if (b.zoneIds) {
        for (let i = 0; i < b.zoneIds.length; i++) {
          const mirrored = refs[refIndex];
          if (mirrored && mirrored !== b.zoneIds[i]) b.zoneIds[i] = mirrored;
          refIndex++;
        }
      }
    }
  }
  return blocks;
}

/**
 * A page's blocks rebuilt from its `story`: one prose block holding it, so
 * the page shows that text and its next save compiles the same text back
 * (`compilePageStory` writes a prose block's markdown, trimmed). Cards and
 * other blocks the story only names come back as their text; that is the cost
 * of keeping the online version. An empty story gives no blocks.
 */
export function pageBlocksFromStory(
  story: unknown,
  id: string = newBlockId(),
): { atlas_page_blocks: PageBlock[]; atlas_page_refs: string[] } {
  const text = typeof story === 'string' ? story : '';
  return {
    atlas_page_blocks: text.trim() ? [{ id, kind: 'prose', markdown: text, richtextJson: null }] : [],
    atlas_page_refs: [],
  };
}

/**
 * The flat refs mirror for a block stack: every element-bearing id (cards +
 * circles + collection members) in block order, count-aware.
 */
export function pageRefsFor(blocks: readonly PageBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === 'element-card') out.push(b.elementId);
    else if (b.kind === 'circle') out.push(b.knowerId);
    else if (b.kind === 'collection') out.push(...b.elementIds);
    else if (b.kind === 'map') out.push(b.mapId, ...b.pinIds, ...(b.zoneIds ?? []));
  }
  return out;
}

/**
 * The write-side patch for a blocks change. ALWAYS save blocks through this
 * helper — it keeps the refs mirror and the derived story in lockstep with
 * the blocks (the positional-pairing invariant `blocksOf` heals from).
 */
export function pageBlocksPatch(
  blocks: readonly PageBlock[],
  resolveName: (elementId: string) => string | null,
): Record<string, unknown> {
  return {
    atlas_page_blocks: blocks,
    atlas_page_refs: pageRefsFor(blocks),
    story: compilePageStory(blocks, resolveName),
  };
}

/**
 * Derived `story` mirror: a plain-markdown compilation of the blocks. The
 * blocks are the source of truth (atlas-local); story is the synced, honest
 * derived copy other devices/tools can read. Regenerated whole on every save.
 */
export function compilePageStory(
  blocks: readonly PageBlock[],
  resolveName: (elementId: string) => string | null,
): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        parts.push(`${b.level === 2 ? '##' : '#'} ${b.text}`);
        break;
      case 'prose':
        if (b.markdown.trim()) parts.push(b.markdown.trim());
        break;
      case 'element-card':
        // NOT renamed with the UI label. This is the DERIVED STORY
        // mirror — persisted to the page's `story` field and pushed to the
        // server, not shown in the block builder. Renaming it would rewrite
        // every existing page's story on its next write for a cosmetic reason.
        // The user-facing label is "+ element"; this stays the wire wording.
        parts.push(`[ ${resolveName(b.elementId) ?? b.elementId} · element card ]`);
        break;
      case 'circle':
        parts.push(`[ ${resolveName(b.knowerId) ?? b.knowerId} · circle knowledge ]`);
        break;
      case 'collection':
        parts.push(`[ ${b.elementIds.map(id => resolveName(id) ?? id).join(', ')} · collection ]`);
        break;
      case 'map':
        parts.push(`[ ${resolveName(b.mapId) ?? b.mapId} · map ]`);
        break;
      case 'chart':
        parts.push('[ chart ]');
        break;
    }
  }
  return parts.join('\n\n');
}

/** "3 blocks", "1 block", or "empty" — list-row summary. */
export function blockSummary(blocks: readonly PageBlock[]): string {
  if (blocks.length === 0) return 'empty';
  return `${blocks.length} block${blocks.length === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Published-state mirror (S4) — `atlas_page_pub` display cache.
// The sharing API rows are the truth; this mirror lets the share room show
// "published at <url>" offline and survives sync (it's an atlas-local field:
// stripped on the worldapi wire, preserved on pull overlay).
// ---------------------------------------------------------------------------

export interface PagePubState {
  /** SharedPage row id on the sharing backend. */
  id: string;
  slug: string;
  published_at: string;
  updated_at: string;
  revoked: boolean;
  /** Content signature at last publish/republish — see pageContentSig. Absent on pre-B1 mirrors. */
  content_sig?: string;
}

/** Parse the page's `atlas_page_pub` mirror defensively; null = never published. */
export function pagePubOf(el: Element): PagePubState | null {
  const raw = (el as Record<string, unknown>).atlas_page_pub;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || typeof p.slug !== 'string') return null;
  const out: PagePubState = {
    id: p.id,
    slug: p.slug,
    published_at: typeof p.published_at === 'string' ? p.published_at : '',
    updated_at: typeof p.updated_at === 'string' ? p.updated_at : '',
    revoked: p.revoked === true,
  };
  if (typeof p.content_sig === 'string') out.content_sig = p.content_sig;
  return out;
}

/**
 * Cheap stable signature over a page's published-content-bearing fields
 * (name, blocks, theme, intent). Stored on the pub mirror at publish and
 * republish; the share room compares it against the live page to show the
 * "edited since publish" reminder (B1, settled 2026-07-03). Deliberately NOT
 * a timestamp comparison: writing the pub mirror itself bumps
 * `local_updated_at`, which would read as "edited" forever.
 */
export function pageContentSig(el: Element): string {
  const rec = el as Record<string, unknown>;
  const material = JSON.stringify({
    name: el.name ?? '',
    blocks: rec.atlas_page_blocks ?? null,
    theme: rec.atlas_page_theme ?? null,
    intent: rec.atlas_page_intent ?? null,
  });
  let h = 5381;
  for (let i = 0; i < material.length; i++) {
    h = ((h << 5) + h + material.charCodeAt(i)) | 0;
  }
  return `${(h >>> 0).toString(36)}-${material.length.toString(36)}`;
}

/** Unique default name for a new page: "New page", "New page (2)", ... (compared without case) */
export function findUniquePageName(elements: Element[]): string {
  const names = new Set(listPages(elements).map(p => (p.name || '').toLowerCase()));
  if (!names.has('new page')) return 'New page';
  for (let i = 2; ; i++) {
    if (!names.has(`new page (${i})`)) return `New page (${i})`;
  }
}
