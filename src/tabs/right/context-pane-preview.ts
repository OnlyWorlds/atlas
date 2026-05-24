/**
 * Element preview slide-in for the context pane.
 *
 * Shows a compact card with the element's type icon, name, description excerpt,
 * backlinks ("Appears in: …"), and action buttons. Used in two modes:
 *
 *   - **Writing mode** (subject is a narrative): preview slides in OVER the
 *     Cast + Potentials lists when the writer picks an element (graph node,
 *     list row, or in-prose chip click). Lists hide; preview takes the slot.
 *     Footer shows "+ add to story" for elements that are NOT yet Featured
 *     (where Featured = in the field AND in prose).
 *
 *   - **Element mode** (subject is the focused element): preview is the
 *     primary content of the details slot — always visible. Shows the subject
 *     by default; swaps to whichever node the user clicks in the graph. The
 *     "open in detail" action hides when the previewed element IS the subject
 *     (the user is already on its detail page in the middle pane).
 *
 * Dismissal: × button, Esc key. The `onClose` callback's behavior depends on
 * caller — in writing mode it hides the preview; in element mode it reverts
 * to showing the subject.
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

export type ContextPreviewMode = 'writing' | 'element';

export interface ContextPreviewOpts {
  host: HTMLElement;
  /**
   * The pane's subject element — drives Featured/add-to-story logic (writing
   * mode) and "is this the focus we're already viewing" logic (element mode).
   */
  subject: Element;
  /** Which renderer mode the orchestrator is in. */
  mode: ContextPreviewMode;
  onClose: () => void;
}

export function mountContextPreview(opts: ContextPreviewOpts): ContextPreviewHandle {
  const { host, subject, mode, onClose } = opts;
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
      host.appendChild(buildPreview(el, subject, mode, onClose));
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

// Compute whether this element is Featured in the writing-room narrative —
// meaning the narrative's prose contains a chip (or text mention via alias)
// for it. Only meaningful in writing mode; callers gate on mode.
//
// Match rule: scan narrative.story for either an ow:// chip link with this
// id OR a word-boundary text match of the element's name / any alias.
function isElementFeatured(el: Element, narrative: Element): boolean {
  const story = typeof narrative.story === 'string' ? narrative.story : '';
  if (story.length === 0) return false;
  const chipTail = '/' + el.id + ')';
  if (story.indexOf(chipTail) !== -1) return true;
  const candidates: string[] = [];
  if (el.name) candidates.push(el.name);
  if (Array.isArray(el.atlas_aliases)) {
    for (const a of el.atlas_aliases) {
      if (typeof a === 'string') candidates.push(a);
    }
  }
  for (const cand of candidates) {
    if (cand.length < 2) continue;
    const escaped = escapeRegex(cand);
    const re = new RegExp('\\b' + escaped + '\\b');
    if (re.test(story)) return true;
  }
  return false;
}

function buildPreview(
  el: Element,
  subject: Element,
  mode: ContextPreviewMode,
  onClose: () => void,
): HTMLElement {
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

  // Body — description + backlinks.
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

  // Footer — action buttons.
  const footer = document.createElement('div');
  footer.className = 'atlas-context-preview-actions';

  const isSubject = el.id === subject.id;
  const isWriting = mode === 'writing';
  // Featured only meaningful in writing mode (subject is a narrative).
  const featured = !isSubject && isWriting && isElementFeatured(el, subject);

  // "open in detail" hides when in element mode AND previewing the subject —
  // the user is already on this element's detail page in the middle pane.
  const hideOpenInDetail = mode === 'element' && isSubject;
  if (!hideOpenInDetail) {
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'atlas-btn-secondary';
    openBtn.textContent = 'open in detail';
    openBtn.addEventListener('click', () => {
      const worldId = getState().active?.worldId;
      if (worldId) navigate(elementHash(worldId, el.id));
    });
    footer.appendChild(openBtn);
  }

  // "+ add to story" only in writing mode, only for non-subject + non-featured.
  if (isWriting && !isSubject && !featured) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'atlas-btn-primary';
    addBtn.textContent = '+ add to story';
    addBtn.title = 'Insert at cursor, or wrap selected prose as a chip';
    addBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('atlas:context-add-to-cast', {
        detail: { id: el.id, type: el.type, name: el.name ?? '' },
      }));
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
