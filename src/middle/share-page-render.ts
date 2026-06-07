/**
 * Portable page renderer — turns a page's block stack into display DOM
 * (DESIGN_SHARING.md, S2b).
 *
 * DELIBERATELY STORE-FREE: every function takes resolved data (an elements
 * Map), never reads app state, and never wires edit affordances. The share
 * room uses it for static block rendering + the visitor preview; the Track C
 * viewer tool will lift this module (plus `renderProseFragment`) more or
 * less verbatim — keep it that way: no imports from state/store/sync.
 *
 * The snapshot payload the viewer renders is exactly this module's input
 * shape: blocks + resolved element data (see SHARING_CONTRACT.md).
 */

import type { Element } from '../core/types';
import type { PageBlock, ElementCardBlock } from '../core/sharing';
import { renderProseFragment } from './writing-compiled';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import { humanizeFieldName } from './element-detail-fields';
import { escapeText } from '../core/dom-utils';

/**
 * Field names that never belong on a card: identity/meta, sync stamps, and
 * the whole atlas-local extension family (presentation/config, not content).
 */
const CARD_SKIP_FIELDS = new Set([
  'id', 'type', 'name', 'local_updated_at', 'server_updated_at',
  'image_url', // rendered as the card image, not as a field row
]);

function isCardSkipField(name: string): boolean {
  return CARD_SKIP_FIELDS.has(name) || name.startsWith('atlas_') || name === 'image_media_id';
}

/** Does this value carry displayable content? */
function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return true;
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

/**
 * The element's populated, card-eligible field names (disk order). The field
 * checklist in the builder offers exactly these; the card renders the chosen
 * subset that is still populated.
 */
export function populatedCardFields(el: Element): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(el)) {
    if (isCardSkipField(key)) continue;
    if (isPopulated(value)) out.push(key);
  }
  return out;
}

/** Render one field value: ids resolve to element names; arrays join as chips. */
function renderFieldValue(value: unknown, elements: Map<string, Element>): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-share-card-field-value';
  if (typeof value === 'string') {
    const linked = elements.get(value);
    if (linked) {
      wrap.appendChild(nameChip(linked));
    } else {
      wrap.textContent = value;
    }
    return wrap;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    wrap.textContent = String(value);
    return wrap;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const linked = elements.get(item);
      if (linked) wrap.appendChild(nameChip(linked));
      else {
        const span = document.createElement('span');
        span.textContent = item;
        wrap.appendChild(span);
      }
    }
    return wrap;
  }
  return wrap;
}

function nameChip(el: Element): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'atlas-share-card-chip';
  chip.innerHTML = `<span class="material-symbols-outlined">${ELEMENT_ICONS[el.type] ?? 'category'}</span>${escapeText(el.name || '(unnamed)')}`;
  return chip;
}

/**
 * Render an element-card block. `compact` = identity row only; `full` adds
 * the block's chosen fields (those still populated on the element).
 * A missing element renders an honest placeholder, never throws.
 */
export function renderElementCard(block: ElementCardBlock, elements: Map<string, Element>): HTMLElement {
  const card = document.createElement('div');
  card.className = `atlas-share-card is-${block.variant}`;
  const el = elements.get(block.elementId);

  if (!el) {
    card.classList.add('is-missing');
    card.innerHTML = `
      <div class="atlas-share-card-head">
        <span class="material-symbols-outlined">help</span>
        <span class="atlas-share-card-name">(missing element)</span>
      </div>
    `;
    return card;
  }

  const head = document.createElement('div');
  head.className = 'atlas-share-card-head';
  head.innerHTML = `
    <span class="material-symbols-outlined atlas-share-card-icon">${ELEMENT_ICONS[el.type] ?? 'category'}</span>
    <span class="atlas-share-card-name">${escapeText(el.name || '(unnamed)')}</span>
    <span class="atlas-share-card-type">${escapeText(ELEMENT_LABELS[el.type]?.singular ?? el.type)}</span>
  `;
  card.appendChild(head);

  const imageUrl = (el as Record<string, unknown>).image_url;
  if (typeof imageUrl === 'string' && imageUrl.trim().length > 0) {
    const img = document.createElement('img');
    img.className = 'atlas-share-card-image';
    img.src = imageUrl;
    img.alt = el.name || '';
    img.loading = 'lazy';
    card.appendChild(img);
  }

  if (block.variant === 'full' && block.fields.length > 0) {
    const fieldsWrap = document.createElement('div');
    fieldsWrap.className = 'atlas-share-card-fields';
    for (const field of block.fields) {
      const value = (el as Record<string, unknown>)[field];
      if (isCardSkipField(field) || !isPopulated(value)) continue;
      const row = document.createElement('div');
      row.className = 'atlas-share-card-field';
      const label = document.createElement('div');
      label.className = 'atlas-share-card-field-label';
      label.textContent = humanizeFieldName(field);
      row.appendChild(label);
      row.appendChild(renderFieldValue(value, elements));
      fieldsWrap.appendChild(row);
    }
    card.appendChild(fieldsWrap);
  }

  return card;
}

/** Render one block in display form (no edit affordances). */
export function renderBlockView(block: PageBlock, elements: Map<string, Element>): HTMLElement {
  switch (block.kind) {
    case 'heading': {
      const h = document.createElement(block.level === 2 ? 'h3' : 'h2');
      h.className = 'atlas-share-block-heading';
      h.textContent = block.text;
      return h;
    }
    case 'prose':
      return renderProseFragment(block.markdown, elements);
    case 'element-card':
      return renderElementCard(block, elements);
  }
}

export interface PageViewOptions {
  title: string;
  blocks: readonly PageBlock[];
  elements: Map<string, Element>;
}

/**
 * Render the whole page as a visitor sees it — title + the block stack.
 * This IS the preview, and (re-hosted) the viewer tool's render path.
 */
export function renderPageView(opts: PageViewOptions): HTMLElement {
  const view = document.createElement('article');
  view.className = 'atlas-share-page-view';
  const title = document.createElement('h1');
  title.className = 'atlas-share-page-view-title';
  title.textContent = opts.title;
  view.appendChild(title);
  for (const block of opts.blocks) {
    const node = renderBlockView(block, opts.elements);
    node.classList.add('atlas-share-page-view-block');
    view.appendChild(node);
  }
  if (opts.blocks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'atlas-share-hint';
    empty.textContent = 'This page has no content yet.';
    view.appendChild(empty);
  }
  return view;
}
