/**
 * Cast + Suggested lists for the writing-context pane.
 *
 * Side-by-side vertical lists below the graph.
 *   - Cast (60% default): linked elements in the narrative, with mention-count
 *     badges from the prose (story field).
 *   - Suggested (40% default): adjacent elements via 1-hop relations + elements
 *     mentioned in sibling/parent narratives, with a "why" tag per row.
 *
 * Bidirectional selection: hovering/clicking a row emits onSelect; calling
 * highlight() emphasizes the matching row.
 *
 * Per-narrative dismissal (Suggested only): × on a row stores the dismissal
 * in `atlas_dismissed_suggestions` on the narrative. Dismissed rows hide
 * until manually re-shown via a "show N dismissed" footer link.
 *
 * Empty state: when both lists are empty, a single inline hint suggests
 * starting with `@` in prose. Hidden when the narrative is brand-new.
 */

import { getState } from '../../core/state';
import type { Element } from '../../core/types';
import { ELEMENT_ICONS } from '../../core/constants';
import { getActiveStore } from '../../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../../sync/sync-attach';
import { showProblem } from '../../ui/problem-fixes';
import { autolinkMarkdown, buildAutolinkIndex } from '../../core/prose-autolink';

export interface ContextListsHandle {
  /** Visually emphasize a row whose element id matches (or clear). */
  highlight(elementId: string | null): void;
  destroy(): void;
}

export interface ContextListsOpts {
  host: HTMLElement;
  narrative: Element;
  onSelect: (elementId: string | null) => void;
}

const MULTI_LINK_FIELDS = [
  'characters', 'locations', 'objects', 'events', 'creatures',
  'species', 'institutions', 'collectives', 'phenomena', 'languages',
  'titles', 'traits', 'abilities', 'constructs', 'laws', 'families',
  'narratives', 'relations',
] as const;

function readMultiLink(el: Element, field: string): string[] {
  const raw = (el as Record<string, unknown>)[field];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item === 'object' && typeof (item as { id?: string }).id === 'string') {
      out.push((item as { id: string }).id);
    }
  }
  return out;
}

function collectCastIds(narrative: Element): string[] {
  const seen = new Set<string>();
  for (const f of MULTI_LINK_FIELDS) {
    for (const id of readMultiLink(narrative, f)) {
      seen.add(id);
    }
  }
  return Array.from(seen);
}

/** Count ow:// mentions of each element in the narrative's story. */
function buildMentionCounts(story: string | undefined | null): Map<string, number> {
  const counts = new Map<string, number>();
  if (typeof story !== 'string' || story.length === 0) return counts;
  const re = /ow:\/\/[a-z-]+\/([\w-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(story)) !== null) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return counts;
}

interface SuggestedRow {
  el: Element;
  reason: string; // "friend of Drizzle" / "in ch2" / "shared with The Inn"
}

/**
 * Build suggested rows: 1-hop adjacent via cast members' relations + elements
 * mentioned in sibling/parent narratives in this narrative's book.
 *
 * Heuristic only — refine after Captain's real-world usage. For v1 we surface:
 *   - For each cast member, every element they reference that ISN'T already
 *     in the cast. Reason = "linked to {castMember.name}".
 *   - Elements mentioned in narratives sharing the same `parent_narrative` or
 *     ancestor (book root). Reason = "in {sibling.name}".
 */
function buildSuggested(narrative: Element, dismissed: Set<string>): SuggestedRow[] {
  const elements = getState().data.elements;
  const byId = new Map<string, Element>();
  for (const e of elements) byId.set(e.id, e);

  const castIds = new Set(collectCastIds(narrative));
  const out: SuggestedRow[] = [];
  const seen = new Set<string>(castIds); // skip cast members from suggested
  seen.add(narrative.id);

  // Source 1: cast members' relations.
  for (const cid of castIds) {
    const c = byId.get(cid);
    if (!c) continue;
    for (const f of MULTI_LINK_FIELDS) {
      for (const adjId of readMultiLink(c, f)) {
        if (seen.has(adjId) || dismissed.has(adjId)) continue;
        const adj = byId.get(adjId);
        if (!adj) continue;
        seen.add(adjId);
        out.push({
          el: adj,
          reason: `via ${c.name || '(unnamed)'}`,
        });
      }
    }
  }

  // Source 2: sibling-narrative cast members. Find narratives that share the
  // ancestor chain with this one, collect their casts, surface elements not
  // already in cast or suggested.
  const ancestorChain = new Set<string>();
  let cursor: Element | null = narrative;
  while (cursor) {
    const parentId: string | undefined = (cursor as Element & { parent_narrative?: string }).parent_narrative;
    // A parent cycle in world data would loop forever; stop at the first
    // repeat (S367 critic C1).
    if (!parentId || parentId === narrative.id || ancestorChain.has(parentId)) break;
    ancestorChain.add(parentId);
    cursor = byId.get(parentId) ?? null;
  }
  const siblingNarratives = elements.filter(e => {
    if (e.type !== 'narrative') return false;
    if (e.id === narrative.id) return false;
    const ep = (e as Element & { parent_narrative?: string }).parent_narrative;
    if (!ep) return false;
    return ancestorChain.has(ep) || ep === (narrative as Element & { parent_narrative?: string }).parent_narrative;
  });
  for (const s of siblingNarratives) {
    for (const f of MULTI_LINK_FIELDS) {
      for (const sid of readMultiLink(s, f)) {
        if (seen.has(sid) || dismissed.has(sid)) continue;
        const sEl = byId.get(sid);
        if (!sEl) continue;
        seen.add(sid);
        out.push({
          el: sEl,
          reason: `in ${s.name || '(unnamed)'}`,
        });
      }
    }
  }

  // Cap to keep the list readable.
  return out.slice(0, 40);
}

export function mountContextLists(opts: ContextListsOpts): ContextListsHandle {
  const { host, narrative, onSelect } = opts;
  host.innerHTML = '';

  const rowEls = new Map<string, HTMLElement>();

  const dismissedRaw = (narrative as Element & { atlas_dismissed_suggestions?: string[] }).atlas_dismissed_suggestions;
  const dismissed = new Set<string>(Array.isArray(dismissedRaw) ? dismissedRaw : []);

  const root = document.createElement('div');
  root.className = 'atlas-context-pane-lists';
  host.appendChild(root);

  // ---- Cast column ----
  const castCol = document.createElement('div');
  castCol.className = 'atlas-context-pane-list atlas-context-pane-list-cast';
  const castHeader = document.createElement('div');
  castHeader.className = 'atlas-context-pane-list-header';
  castHeader.textContent = 'Cast';
  castCol.appendChild(castHeader);

  const castBody = document.createElement('div');
  castBody.className = 'atlas-context-pane-list-body';
  castCol.appendChild(castBody);

  const elements = getState().data.elements;
  const byId = new Map<string, Element>();
  for (const e of elements) byId.set(e.id, e);

  const castIds = collectCastIds(narrative);
  const mentionCounts = buildMentionCounts(narrative.story);
  const castEntries = castIds
    .map(id => byId.get(id))
    .filter((e): e is Element => Boolean(e))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  if (castEntries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'atlas-context-pane-empty';
    empty.textContent = 'No linked elements yet.';
    castBody.appendChild(empty);
  } else {
    // Sort Featured rows above Planned for at-a-glance prioritization,
    // then alphabetical within each group.
    const sorted = castEntries.slice().sort((a, b) => {
      const aFeatured = (mentionCounts.get(a.id) ?? 0) > 0;
      const bFeatured = (mentionCounts.get(b.id) ?? 0) > 0;
      if (aFeatured !== bFeatured) return aFeatured ? -1 : 1;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
    for (const el of sorted) {
      const count = mentionCounts.get(el.id) ?? 0;
      const status: CastStatus = count > 0 ? 'featured' : 'planned';
      const row = buildRow(el, {
        countBadge: count,
        status,
        onClick: () => onSelect(el.id),
      });
      castBody.appendChild(row);
      rowEls.set(el.id, row);
    }
  }
  root.appendChild(castCol);

  // ---- Suggested column ----
  const sugCol = document.createElement('div');
  sugCol.className = 'atlas-context-pane-list atlas-context-pane-list-suggested';
  const sugHeader = document.createElement('div');
  sugHeader.className = 'atlas-context-pane-list-header';
  // "Potentials" reads more openly than "Suggested" — these aren't system
  // recommendations, they're elements the writer might pull into the scene.
  sugHeader.textContent = 'Potentials';
  // Two kinds (#24): elements the text NAMES but does not link yet (the
  // dotted mentions in the prose, first), then elements linked to the cast
  // or to nearby narratives' casts. Before #24 only the second kind showed,
  // and "No potentials" beside dotted names read as a contradiction (S369).
  sugHeader.title = 'Elements the text names but does not link yet, then elements linked to your cast or to nearby parts of the story';
  sugCol.appendChild(sugHeader);

  const sugBody = document.createElement('div');
  sugBody.className = 'atlas-context-pane-list-body';
  sugCol.appendChild(sugBody);

  const named = namedInText(narrative, getState().data.elements);
  for (const el of named) {
    const row = buildRow(el, {
      reason: 'in the text',
      onClick: () => onSelect(el.id),
      onLink: () => linkNamed(narrative.id, el.id, row),
    });
    row.dataset.named = '';
    sugBody.appendChild(row);
    rowEls.set(el.id, row);
  }

  const namedIds = new Set(named.map(e => e.id));
  const suggested = buildSuggested(narrative, dismissed).filter(s => !namedIds.has(s.el.id));
  if (suggested.length === 0 && named.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'atlas-context-pane-empty';
    empty.textContent = 'No potentials yet.';
    sugBody.appendChild(empty);
  } else {
    for (const s of suggested) {
      const row = buildRow(s.el, {
        reason: s.reason,
        onClick: () => onSelect(s.el.id),
        onDismiss: () => dismissSuggestion(narrative.id, s.el.id),
      });
      sugBody.appendChild(row);
      rowEls.set(s.el.id, row);
    }
  }
  root.appendChild(sugCol);

  return {
    highlight(elementId: string | null): void {
      rowEls.forEach((el, id) => {
        el.classList.toggle('is-highlighted', id === elementId);
      });
    },
    destroy(): void {
      host.innerHTML = '';
    },
  };
}

/**
 * Cast row status:
 *   featured = element appears in the current prose (ow:// chip)
 *   planned  = element is in the narrative's link field but NOT in prose
 * Suggested rows don't carry a status (they're not in the field at all).
 */
export type CastStatus = 'featured' | 'planned';

interface RowOpts {
  countBadge?: number;
  reason?: string;
  status?: CastStatus;
  onClick: () => void;
  onDismiss?: () => void;
  /** "Named in the text" rows (#24): link the element where the text names it. */
  onLink?: () => void;
}

function buildRow(el: Element, opts: RowOpts): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'atlas-context-pane-row';
  if (opts.status) row.classList.add(`is-${opts.status}`);
  row.dataset.elementId = el.id;
  row.dataset.elementType = el.type;

  // Status badge — Featured = filled cyan dot, Planned = outlined cyan ring.
  // Sits before the icon so it reads as a row-level marker, not a glyph
  // modifier. Suggested rows omit it (status is undefined).
  if (opts.status) {
    const dot = document.createElement('span');
    dot.className = `atlas-context-pane-row-status atlas-context-pane-row-status-${opts.status}`;
    dot.title = opts.status === 'featured'
      ? 'Featured · appears in the prose'
      : 'Planned · in the cast but not yet written into the prose';
    row.appendChild(dot);
  }

  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined atlas-context-pane-row-icon';
  icon.textContent = ELEMENT_ICONS[el.type] ?? 'category';
  row.appendChild(icon);

  const nameEl = document.createElement('span');
  nameEl.className = 'atlas-context-pane-row-name';
  nameEl.textContent = el.name || '(unnamed)';
  row.appendChild(nameEl);

  if (opts.countBadge !== undefined && opts.countBadge > 0) {
    const badge = document.createElement('span');
    badge.className = 'atlas-context-pane-row-count';
    badge.textContent = String(opts.countBadge);
    badge.title = `${opts.countBadge} mention${opts.countBadge === 1 ? '' : 's'} in prose`;
    row.appendChild(badge);
  }

  if (opts.reason) {
    const reasonEl = document.createElement('span');
    reasonEl.className = 'atlas-context-pane-row-reason';
    reasonEl.textContent = opts.reason;
    row.appendChild(reasonEl);
  }

  row.addEventListener('click', opts.onClick);

  if (opts.onLink) {
    const linkBtn = document.createElement('span');
    linkBtn.className = 'atlas-context-pane-row-link';
    linkBtn.setAttribute('role', 'button');
    linkBtn.dataset.action = 'link-named';
    linkBtn.title = `Link ${el.name || 'it'} where the text names it`;
    linkBtn.textContent = 'Link';
    linkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onLink?.();
    });
    row.appendChild(linkBtn);
  }

  if (opts.onDismiss) {
    const dismissBtn = document.createElement('span');
    dismissBtn.className = 'atlas-context-pane-row-dismiss';
    dismissBtn.setAttribute('role', 'button');
    dismissBtn.title = 'Dismiss suggestion for this narrative';
    dismissBtn.textContent = '×';
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onDismiss?.();
    });
    row.appendChild(dismissBtn);
  }

  return row;
}

const namedCache = new WeakMap<readonly Element[], Map<string, Element[]>>();

/**
 * The elements a narrative's text names but does not link (#24): the
 * autolink kernel's own first-mention pass over the stored story, so the list
 * agrees with what "Link all" would chip. Unambiguous names only; an element
 * already linked anywhere in the text is not named here. Cached per elements
 * array: the pane redraws often and the index walks the whole world.
 */
export function namedInText(narrative: Element, elements: readonly Element[]): Element[] {
  const story = typeof narrative.story === 'string' ? narrative.story : '';
  if (!story) return [];
  let perArray = namedCache.get(elements);
  if (!perArray) { perArray = new Map(); namedCache.set(elements, perArray); }
  const key = `${narrative.id}\u0000${story}`;
  const hit = perArray.get(key);
  if (hit) return hit;
  const byId = new Map(elements.map(e => [e.id, e]));
  const { linked } = autolinkMarkdown(story, buildAutolinkIndex(elements as Element[]));
  const out = linked
    .map(c => byId.get(c.id))
    .filter((e): e is Element => !!e && e.id !== narrative.id);
  perArray.set(key, out);
  return out;
}

async function linkNamed(narrativeId: string, elementId: string, row: HTMLElement): Promise<void> {
  try {
    const { bulkLinkNarratives } = await import('../../middle/writing-bulk-link');
    const { count } = await bulkLinkNarratives([narrativeId], 'link', elementId);
    if (count > 0) row.remove();
  } catch (err) {
    console.error('[context-lists] link named failed', err);
    showProblem(err, { doing: 'linking the name', retry: () => linkNamed(narrativeId, elementId, row) });
  }
}

async function dismissSuggestion(narrativeId: string, suggestedId: string): Promise<void> {
  const store = getActiveStore();
  if (!store) return;
  const state = getState();
  const narrative = state.data.elements.find(e => e.id === narrativeId);
  if (!narrative) return;
  const existing = (narrative as Element & { atlas_dismissed_suggestions?: string[] }).atlas_dismissed_suggestions;
  const list = new Set<string>(Array.isArray(existing) ? existing : []);
  if (list.has(suggestedId)) return;
  list.add(suggestedId);
  try {
    await store.updateElement(narrativeId, {
      atlas_dismissed_suggestions: Array.from(list),
    } as Partial<Element>);
    await refreshElementsAfterWrite(store);
    requestPushIfLinked();
  } catch (err) {
    console.error('[context-lists] dismiss failed', err);
    // Safe to run again: it re-reads the list and adds the one id.
    showProblem(err, { doing: 'dismissing the suggestion', retry: () => dismissSuggestion(narrativeId, suggestedId) });
  }
}
