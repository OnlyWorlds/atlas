/**
 * Compiled view — assembles a parent narrative + all its descendants into a
 * single read-only rendering.
 *
 * Recursive structure: parent's own `story` first (if non-empty), then each
 * child's compiled rendering in order. Between children, a clickable section
 * marker shows the child's name + tier and navigates to that child's writing
 * room when clicked (the actual edit happens in This-Level view at that
 * narrative).
 *
 * The compiled view is read-only in v1. v2 will explore editable-compiled
 * where edits route back to the right source narrative based on character
 * range tracking — significant lift, deferred.
 *
 * Markdown rendering is intentionally minimal: paragraphs, bold/italic,
 * headings, lists, blockquotes, code, and `ow://` chip links. Anything more
 * exotic (tables, embedded images beyond `![]()`) shows as escaped source
 * text in v1.
 */

import type { Element } from '../core/types';
import { ELEMENT_ICONS } from '../core/constants';
import { getState } from '../core/state';
import { navigate, writingHash } from '../core/router';
import { escapeText } from '../core/dom-utils';
import { getTierForNarrative, getWritingLabels, iconForTier } from './writing-helpers';

export interface CompiledSection {
  el: Element;
  prose: string;
  children: CompiledSection[];
}

/**
 * Per-narrative collapsed state for compiled-view sections. Keyed by the
 * section narrative id (not the root). Ephemeral — resets on world switch
 * via resetCompiledCollapseState (called from writing-workspace's reset).
 */
const collapsedSections = new Set<string>();

export function resetCompiledCollapseState(): void {
  collapsedSections.clear();
}

/**
 * Walk the narrative tree from `root` and assemble a CompiledSection. Child
 * order honors the `order` field; ties broken by name for stability. Exported
 * for unit tests; mountCompiledView is the production entry point.
 */
export function buildCompiledTree(root: Element, allElements: readonly Element[]): CompiledSection {
  const kids = allElements
    .filter(e => e.type === 'narrative' && (e as Element & { parent_narrative?: string }).parent_narrative === root.id)
    .slice()
    .sort((a, b) => {
      const ao = (a as Element & { order?: number }).order ?? 0;
      const bo = (b as Element & { order?: number }).order ?? 0;
      if (ao !== bo) return ao - bo;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
  return {
    el: root,
    prose: typeof root.story === 'string' ? root.story : '',
    children: kids.map(child => buildCompiledTree(child, allElements)),
  };
}

/** Does this narrative have any narrative children? */
export function narrativeHasChildren(narrative: Element, allElements: readonly Element[]): boolean {
  return allElements.some(e =>
    e.type === 'narrative'
    && (e as Element & { parent_narrative?: string }).parent_narrative === narrative.id,
  );
}

/**
 * Render a compiled view for `narrative` into `host`. Returns a teardown.
 *
 * The host is replaced wholesale (innerHTML cleared on every render). Caller
 * is responsible for re-invoking when the underlying elements change.
 */
export function mountCompiledView(host: HTMLElement, narrative: Element): () => void {
  const state = getState();
  const elements = state.data.elements;
  const worldId = state.active!.worldId;

  host.innerHTML = '';
  host.className = 'atlas-writing-compiled';

  const tree = buildCompiledTree(narrative, elements);
  // Resolve the element map ONCE so chip rendering can look up display names.
  const elementMap = new Map<string, Element>();
  for (const e of elements) elementMap.set(e.id, e);
  const renderProseFn = (markdown: string): HTMLElement => renderProseFragment(markdown, elementMap);

  // Don't show a self-marker for the root — it's already named by the
  // element header above the workspace.
  renderSection(host, tree, /* depth */ 0, worldId, renderProseFn, /* showSelfMarker */ false);

  return () => {
    host.innerHTML = '';
  };
}

function renderSection(
  host: HTMLElement,
  section: CompiledSection,
  depth: number,
  worldId: string,
  renderProseFn: (markdown: string) => HTMLElement,
  showSelfMarker: boolean,
): void {
  const wrap = document.createElement('section');
  wrap.className = 'atlas-writing-compiled-section';
  wrap.dataset.depth = String(depth);
  wrap.dataset.elementId = section.el.id;

  const isCollapsed = showSelfMarker && collapsedSections.has(section.el.id);

  if (showSelfMarker) {
    wrap.appendChild(buildSectionMarker(section.el, worldId, isCollapsed, () => {
      // Toggle and re-render this section's content. Cheapest approach:
      // toggle the set + class, hide/show children.
      if (collapsedSections.has(section.el.id)) {
        collapsedSections.delete(section.el.id);
        wrap.classList.remove('is-collapsed');
      } else {
        collapsedSections.add(section.el.id);
        wrap.classList.add('is-collapsed');
      }
    }));
  }

  if (isCollapsed) wrap.classList.add('is-collapsed');

  // Body wrapper — gets hidden when section is collapsed.
  const body = document.createElement('div');
  body.className = 'atlas-writing-compiled-section-body';
  wrap.appendChild(body);

  if (section.prose.trim().length > 0) {
    body.appendChild(renderProseFn(section.prose));
  } else if (section.children.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'atlas-writing-compiled-empty';
    empty.textContent = '(empty · click the section heading to edit)';
    body.appendChild(empty);
  }

  for (const child of section.children) {
    renderSection(body, child, depth + 1, worldId, renderProseFn, /* showSelfMarker */ true);
  }

  host.appendChild(wrap);
}

function buildSectionMarker(
  el: Element,
  worldId: string,
  initiallyCollapsed: boolean,
  onToggleFold: () => void,
): HTMLElement {
  const marker = document.createElement('div');
  marker.className = 'atlas-writing-compiled-marker';

  // Chevron — clickable; toggles fold/unfold. CSS rotates it based on the
  // parent .atlas-writing-compiled-section.is-collapsed class so visual
  // state mirrors the data state without manual class management here.
  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.className = 'atlas-writing-compiled-marker-chevron';
  chevron.title = 'Fold/unfold this section';
  chevron.setAttribute('aria-expanded', initiallyCollapsed ? 'false' : 'true');
  chevron.innerHTML = '<span class="atlas-writing-compiled-marker-arrow">▾</span>';
  chevron.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggleFold();
    const nextCollapsed = chevron.getAttribute('aria-expanded') === 'true';
    chevron.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
  });
  marker.appendChild(chevron);

  // Title region — separate button; clicking navigates to this section's
  // writing room. The chevron above is its own button (stop-propagation),
  // so chevron clicks don't trigger navigation.
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'atlas-writing-compiled-marker-title';
  title.title = 'Open this section to edit it';

  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined atlas-writing-compiled-marker-icon';
  // Tier-specific icon when available (book/article/short_text/edit_note);
  // fall back to the generic element-type icon for non-tiered narratives.
  const tier = getTierForNarrative(el, worldId);
  icon.textContent = tier ? iconForTier(tier) : (ELEMENT_ICONS[el.type] ?? 'edit_note');
  title.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'atlas-writing-compiled-marker-name';
  name.textContent = el.name || '(unnamed)';
  title.appendChild(name);

  // Tier label badge — "scene" / "chapter" / etc.
  if (tier) {
    const labels = getWritingLabels(worldId);
    const tierLabel =
      tier === 'l1' ? labels.l1
      : tier === 'l2' ? labels.l2
      : tier === 'l3' ? labels.l3
      : labels.l4;
    const tierEl = document.createElement('span');
    tierEl.className = 'atlas-writing-compiled-marker-tier';
    tierEl.textContent = tierLabel.toLowerCase();
    title.appendChild(tierEl);
  }

  title.addEventListener('click', () => {
    navigate(writingHash(worldId, el.id));
  });
  marker.appendChild(title);

  return marker;
}

/**
 * Minimal markdown → HTML renderer focused on narrative prose. Handles:
 *   - Paragraphs (blank-line-separated)
 *   - Headings (#, ##, ###, ####)
 *   - Unordered lists (- / *)
 *   - Ordered lists (1.)
 *   - Blockquotes (>)
 *   - Inline bold (**), italic (*), code (`)
 *   - Links: standard [text](url) AND ow:// chip rendering
 *   - Hard rules (---)
 *
 * Returns a single wrapping <div class="atlas-writing-compiled-prose">.
 * Anything not recognized falls through as escaped text — safe but visible.
 */
export interface ProseRenderOptions {
  /**
   * How to render an ow:// link whose target ISN'T in the elements map.
   *   - 'chip' (default): label-fallback chip — the writing compiled view,
   *     where a missing target means deleted-but-still-referenced.
   *   - 'text': plain escaped text, no chip styling, no data-id — sharing
   *     surfaces, where a missing target means NOT DISCLOSED (contract §5.1:
   *     non-disclosure must leak nothing, not even styling).
   */
  unresolved?: 'chip' | 'text';
}

export function renderProseFragment(
  markdown: string,
  elements: Map<string, Element>,
  opts: ProseRenderOptions = {},
): HTMLElement {
  const unresolved = opts.unresolved ?? 'chip';
  const wrap = document.createElement('div');
  wrap.className = 'atlas-writing-compiled-prose';
  if (markdown.trim().length === 0) return wrap;

  // Split into blocks on blank lines (one or more empty lines).
  const blocks = markdown.split(/\r?\n\r?\n+/);
  for (const rawBlock of blocks) {
    const block = rawBlock.replace(/^[\r\n]+|[\r\n]+$/g, '');
    if (block.length === 0) continue;

    // Heading
    const heading = /^(#{1,4})\s+(.+)$/.exec(block);
    if (heading) {
      const level = heading[1].length;
      const hTag = `h${level}`;
      const el = document.createElement(hTag);
      el.innerHTML = renderInline(heading[2], elements, unresolved);
      wrap.appendChild(el);
      continue;
    }

    // Horizontal rule
    if (/^-{3,}\s*$/.test(block)) {
      wrap.appendChild(document.createElement('hr'));
      continue;
    }

    // Blockquote — one or more `> ` lines (only handle contiguous lines).
    if (block.startsWith('>')) {
      const bq = document.createElement('blockquote');
      const lines = block.split(/\r?\n/).map(l => l.replace(/^>\s?/, ''));
      bq.innerHTML = renderInline(lines.join(' '), elements, unresolved);
      wrap.appendChild(bq);
      continue;
    }

    // Unordered list
    if (/^([-*+])\s+/.test(block)) {
      const ul = document.createElement('ul');
      const items = block.split(/\r?\n/).filter(l => /^([-*+])\s+/.test(l));
      for (const line of items) {
        const li = document.createElement('li');
        li.innerHTML = renderInline(line.replace(/^([-*+])\s+/, ''), elements, unresolved);
        ul.appendChild(li);
      }
      wrap.appendChild(ul);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(block)) {
      const ol = document.createElement('ol');
      const items = block.split(/\r?\n/).filter(l => /^\d+\.\s+/.test(l));
      for (const line of items) {
        const li = document.createElement('li');
        li.innerHTML = renderInline(line.replace(/^\d+\.\s+/, ''), elements, unresolved);
        ol.appendChild(li);
      }
      wrap.appendChild(ol);
      continue;
    }

    // Paragraph — collapse internal newlines into spaces for prose flow.
    const p = document.createElement('p');
    p.innerHTML = renderInline(block.replace(/\r?\n/g, ' '), elements, unresolved);
    wrap.appendChild(p);
  }

  return wrap;
}

/**
 * Inline renderer — handles bold/italic/code/links inside a block's text.
 * Escapes HTML first, then converts markdown tokens to HTML tags. Order
 * matters: ow:// links matched BEFORE generic links so chips render with the
 * .atlas-element-chip styling instead of as plain anchors.
 */
function renderInline(
  raw: string,
  elements: Map<string, Element>,
  unresolved: 'chip' | 'text' = 'chip',
): string {
  let s = escapeText(raw);

  // ow:// chip links: [Label](ow://type/uuid). Unresolved targets render per
  // the caller's mode: 'chip' keeps a label-fallback chip (writing compiled
  // view — missing = deleted-but-referenced); 'text' renders plain text with
  // no styling and no data-id (sharing — missing = NOT DISCLOSED, contract
  // §5.1: non-disclosure must leak nothing).
  s = s.replace(/\[([^\]]+?)\]\(ow:\/\/([a-z-]+)\/([\w-]+)\)/gi, (_, label, type, id) => {
    const el = elements.get(id);
    // `label` was captured from the already-escaped string — return as-is.
    if (!el && unresolved === 'text') return label;
    const displayLabel = el?.name ?? label;
    return `<span class="atlas-element-chip" data-id="${escapeAttr(id)}" data-type="${escapeAttr(type)}">${escapeText(displayLabel)}</span>`;
  });

  // Standard links: [text](url) — non-ow:// only (the above already consumed
  // ow:// matches, so the remaining pattern matches plain URLs). Scheme
  // allowlist: markdown reaches public visitors via published payloads, so a
  // javascript:/data: href would be click-to-execute XSS. Unsafe scheme →
  // plain text (`text` was captured from the already-escaped string).
  s = s.replace(/\[([^\]]+?)\]\(([^)\s]+?)\)/g, (_, text, url) => {
    if (!SAFE_LINK_HREF_RE.test(url)) return text;
    return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Inline code (backticks) — done before bold/italic so backticks don't
  // collide with surrounding emphasis.
  s = s.replace(/`([^`\n]+?)`/g, (_, code) => `<code>${escapeText(code)}</code>`);

  // Bold: **text**
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');

  // Italic: *text* (avoid swallowing list bullets — we've already split lines
  // when handling lists). Standalone `*` followed by space is harmless here
  // because we work line-by-line at the block boundary.
  s = s.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');

  return s;
}

/** Renderable link schemes — anything else renders as plain text. */
const SAFE_LINK_HREF_RE = /^(https?:\/\/|mailto:|#)/i;

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
