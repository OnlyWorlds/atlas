/**
 * Element preview slide-in for the writing-context pane.
 *
 * When the user clicks anywhere — graph node, cast row, suggested row, or a
 * chip in prose — the preview takes the lists' slot in the pane. Lists hide
 * temporarily; preview fits snug against the graph's bottom edge. No scroll
 * required to see the preview content.
 *
 * Content: type icon + name, 3-5 key fields (description excerpt, primary
 * image, one or two top relation summaries), "Appears in: …" (backlinks).
 * Two action buttons:
 *   - [open in detail] — navigates to element-detail (leaves writing room)
 *   - [+ add to cast] — inserts a chip at the editor cursor OR wraps the
 *     current selection (alias unification — see task #12 build).
 *
 * Dismissal: × button, Esc key, or clicking outside the preview restores
 * the lists.
 */

import type { Element } from '../../core/types';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../../core/constants';
import { getState } from '../../core/state';
import { navigate, elementHash } from '../../core/router';

export interface ContextPreviewHandle {
  show(el: Element): void;
  hide(): void;
  destroy(): void;
}

export interface ContextPreviewOpts {
  host: HTMLElement;
  /** The writing-room narrative — used to compute Featured/Planned state. */
  narrative: Element;
  onClose: () => void;
}

export function mountContextPreview(opts: ContextPreviewOpts): ContextPreviewHandle {
  const { host, narrative, onClose } = opts;
  host.innerHTML = '';

  let currentEl: Element | null = null;

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && currentEl) {
      e.preventDefault();
      onClose();
    }
  };
  document.addEventListener('keydown', onKey);

  return {
    show(el: Element): void {
      currentEl = el;
      host.innerHTML = '';
      host.dataset.state = 'visible';
      host.appendChild(buildPreview(el, narrative, onClose));
    },
    hide(): void {
      currentEl = null;
      host.innerHTML = '';
      host.dataset.state = 'hidden';
    },
    destroy(): void {
      document.removeEventListener('keydown', onKey);
      host.innerHTML = '';
      host.dataset.state = 'hidden';
    },
  };
}

// Compute whether this element is Featured in the narrative — meaning the
// narrative's prose contains a chip (or text mention via alias) for it.
//
// Used to hide the "+ add to story" button: Featured elements are already
// fully integrated, no action needed.
//
// Match rule: scan narrative.story for either an ow:// chip link with this
// id OR a word-boundary text match of the element's name / any alias.
function isElementFeatured(el: Element, narrative: Element): boolean {
  const story = typeof narrative.story === 'string' ? narrative.story : '';
  if (story.length === 0) return false;
  // Detect ow:// chip with this id present — look for the markdown link tail
  // ending in /uuid). Plain substring match.
  const chipTail = '/' + el.id + ')';
  if (story.indexOf(chipTail) !== -1) return true;
  // Text mention of name or alias (word-bounded, case-sensitive — matches
  // the autolink convention).
  const candidates: string[] = [];
  if (el.name) candidates.push(el.name);
  if (Array.isArray(el.atlas_aliases)) {
    for (const a of el.atlas_aliases) {
      if (typeof a === 'string') candidates.push(a);
    }
  }
  for (const cand of candidates) {
    if (cand.length < 2) continue;
    // Escape regex metacharacters so cand becomes a literal substring match.
    const escaped = escapeRegex(cand);
    const re = new RegExp('\\b' + escaped + '\\b');
    if (re.test(story)) return true;
  }
  return false;
}

function buildPreview(el: Element, narrative: Element, onClose: () => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'atlas-context-preview';

  // Header — icon, name, type label, close.
  const header = document.createElement('div');
  header.className = 'atlas-context-preview-header';

  const iconWrap = document.createElement('span');
  iconWrap.className = 'atlas-context-preview-icon';
  iconWrap.innerHTML = `<span class="material-symbols-outlined">${ELEMENT_ICONS[el.type] ?? 'category'}</span>`;
  header.appendChild(iconWrap);

  const titleWrap = document.createElement('div');
  titleWrap.className = 'atlas-context-preview-title';
  const name = document.createElement('div');
  name.className = 'atlas-context-preview-name';
  name.textContent = el.name || '(unnamed)';
  titleWrap.appendChild(name);
  const typeLabel = document.createElement('div');
  typeLabel.className = 'atlas-context-preview-type';
  typeLabel.textContent = ELEMENT_LABELS[el.type]?.singular ?? el.type;
  titleWrap.appendChild(typeLabel);
  header.appendChild(titleWrap);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'atlas-context-preview-close';
  closeBtn.title = 'Close preview';
  closeBtn.innerHTML = '×';
  closeBtn.addEventListener('click', onClose);
  header.appendChild(closeBtn);

  card.appendChild(header);

  // Body — description + image (when present) + key fields.
  const body = document.createElement('div');
  body.className = 'atlas-context-preview-body';

  const description = typeof el.description === 'string' ? el.description : null;
  if (description && description.trim().length > 0) {
    const descEl = document.createElement('p');
    descEl.className = 'atlas-context-preview-desc';
    descEl.textContent = description.length > 220 ? description.slice(0, 217) + '…' : description;
    body.appendChild(descEl);
  }

  // Element images intentionally not rendered here — they don't lay out well
  // at the preview's small width and crowded the action buttons against the
  // bottom. The "open in detail" path shows the full image at proper size.

  // Backlinks — narratives that reference this element. Folded summary.
  const backlinks = findBacklinkingNarratives(el.id);
  if (backlinks.length > 0) {
    const bl = document.createElement('div');
    bl.className = 'atlas-context-preview-backlinks';
    bl.innerHTML = `<span class="atlas-context-preview-backlinks-label">Appears in:</span> `;
    backlinks.slice(0, 5).forEach((n, i) => {
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = n.name || '(unnamed)';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const worldId = getState().active?.worldId;
        if (worldId) navigate(elementHash(worldId, n.id));
      });
      bl.appendChild(link);
      if (i < Math.min(backlinks.length, 5) - 1) {
        const sep = document.createTextNode(', ');
        bl.appendChild(sep);
      }
    });
    if (backlinks.length > 5) {
      const more = document.createTextNode(` +${backlinks.length - 5} more`);
      bl.appendChild(more);
    }
    body.appendChild(bl);
  }

  card.appendChild(body);

  // Footer — action buttons. The "+ add to story" button hides when the
  // element is already Featured (in field AND in prose / name-mentioned).
  // Featured elements are fully integrated; no add affordance needed.
  const footer = document.createElement('div');
  footer.className = 'atlas-context-preview-actions';

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'atlas-btn-secondary';
  openBtn.textContent = 'open in detail';
  openBtn.addEventListener('click', () => {
    const worldId = getState().active?.worldId;
    if (worldId) navigate(elementHash(worldId, el.id));
  });
  footer.appendChild(openBtn);

  // Self-preview (the narrative itself in graph center) — never useful to
  // "add to story" yourself.
  const isSelf = el.id === narrative.id;
  const featured = !isSelf && isElementFeatured(el, narrative);

  if (!isSelf && !featured) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'atlas-btn-primary';
    addBtn.textContent = '+ add to story';
    addBtn.title = 'Insert at cursor, or wrap selected prose as a chip';
    addBtn.addEventListener('click', () => {
      // Dispatched event consumed by writing-workspace.ts which has the editor
      // handle. Decoupling keeps the preview pane reusable in non-writing contexts.
      document.dispatchEvent(new CustomEvent('atlas:context-add-to-cast', {
        detail: { id: el.id, type: el.type, name: el.name ?? '' },
      }));
      // Close the preview so lists return to view — the writer should land
      // back in the chip-they-just-inserted's prose context, not stuck on
      // the preview card with no obvious next action.
      onClose();
    });
    footer.appendChild(addBtn);
  }

  card.appendChild(footer);

  return card;
}

function escapeRegex(s: string): string {
  return s.replace(/[\\^$.*+?()\[\]{}|]/g, '\\$&');
}

function findBacklinkingNarratives(elementId: string): Element[] {
  const elements = getState().data.elements;
  const out: Element[] = [];
  const MULTI_LINK_FIELDS = [
    'characters', 'locations', 'objects', 'events', 'creatures',
    'species', 'institutions', 'collectives', 'phenomena', 'languages',
    'titles', 'traits', 'abilities', 'constructs', 'laws', 'families',
    'narratives', 'relations',
  ];
  for (const e of elements) {
    if (e.type !== 'narrative') continue;
    let hit = false;
    for (const f of MULTI_LINK_FIELDS) {
      const raw = (e as Record<string, unknown>)[f];
      if (!Array.isArray(raw)) continue;
      for (const item of raw) {
        const id = typeof item === 'string' ? item : (item as { id?: string })?.id;
        if (id === elementId) { hit = true; break; }
      }
      if (hit) break;
    }
    if (hit) out.push(e);
  }
  return out;
}
