/**
 * Portable page renderer — turns a page's block stack into display DOM
 * (DESIGN_SHARING.md, S2b).
 *
 * DELIBERATELY STORE-FREE: every function takes resolved data, never reads
 * app state, and never wires edit affordances. The Track C viewer tool will
 * lift this module (plus `renderProseFragment` + `core/share-payload`) more
 * or less verbatim — keep it that way: no imports from state/store/sync.
 *
 * TWO render paths, one look:
 *   - WORLD-BACKED (`renderBlockView` / `renderElementCard` / `renderPageView`):
 *     takes a full elements Map — the BUILDER's static block rendering, where
 *     the author sees their world's data.
 *   - PAYLOAD-BACKED (`renderPayloadPage` / `renderPayloadCard`): takes a
 *     §5 publish payload (core/share-payload) — the VISITOR PREVIEW and the
 *     viewer tool's path. Disclosure-true: only included elements link/chip;
 *     everything else is plain text (contract §5.1). What authors preview is
 *     byte-identical to what the backend will serve.
 */

import type { Element } from '../core/types';
import type { PageBlock, ElementCardBlock, CollectionBlock, PageTheme } from '../core/sharing';
import { PAGE_THEME_FONTS } from '../core/sharing';
import {
  isCardSkipField, isPopulatedValue as isPopulated, freezeCircleBlock, freezeMapBlock,
  projectElementEntry, populatedFieldNames,
  type PagePayload, type PayloadElementEntry, type RelationToken,
  type PayloadCircleBlock, type PayloadMapBlock,
} from '../core/share-payload';
import type { ProseRenderOptions } from './writing-compiled';
import { renderProseFragment } from './writing-compiled';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import { humanizeFieldName } from './element-detail-fields';
import { escapeText } from '../core/dom-utils';

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
 * Compact-card avatar: swap the head's type icon for a small image (the
 * "identity row" form of the element's image). Falls back to the icon if the
 * image fails to load.
 */
function swapIconForAvatar(head: HTMLElement, url: string): void {
  const icon = head.querySelector('.atlas-share-card-icon');
  if (!icon) return;
  const avatar = document.createElement('img');
  avatar.className = 'atlas-share-card-avatar';
  avatar.src = url;
  avatar.alt = '';
  avatar.loading = 'lazy';
  avatar.addEventListener('error', () => avatar.replaceWith(icon), { once: true });
  icon.replaceWith(avatar);
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

  // Image per showImage (absent = on): banner on full, head avatar on compact.
  const rawImageUrl = (el as Record<string, unknown>).image_url;
  const imageUrl = typeof rawImageUrl === 'string' ? rawImageUrl.trim() : '';
  if (block.showImage !== false && imageUrl) {
    if (block.variant === 'full') {
      const img = document.createElement('img');
      img.className = 'atlas-share-card-image';
      img.src = imageUrl;
      img.alt = el.name || '';
      img.loading = 'lazy';
      card.appendChild(img);
    } else {
      swapIconForAvatar(head, imageUrl);
    }
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

/**
 * Collection grid — identity mini-cards (avatar/icon + name + type label).
 * One DOM shape for both sources: world elements (builder) and payload
 * entries (preview/viewer); the resolver closure hides the difference.
 */
export function renderCollectionView(
  block: CollectionBlock,
  resolve: (id: string) => { name: string; type: string; image_url?: string } | null,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-share-collection';
  const members = block.elementIds
    .map(id => ({ id, entry: resolve(id) }))
    .filter((m): m is { id: string; entry: NonNullable<ReturnType<typeof resolve>> } => m.entry !== null);
  if (members.length === 0) {
    const none = document.createElement('p');
    none.className = 'atlas-share-hint';
    none.textContent = 'Empty collection — add elements in the editor.';
    wrap.appendChild(none);
    return wrap;
  }
  for (const { entry } of members) {
    const cell = document.createElement('div');
    cell.className = 'atlas-share-collection-cell';
    if (entry.image_url && /^https?:\/\//i.test(entry.image_url)) {
      const img = document.createElement('img');
      img.className = 'atlas-share-collection-avatar';
      img.src = entry.image_url;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        img.replaceWith(collectionIcon(entry.type));
      }, { once: true });
      cell.appendChild(img);
    } else {
      cell.appendChild(collectionIcon(entry.type));
    }
    const name = document.createElement('span');
    name.className = 'atlas-share-collection-name';
    name.textContent = entry.name || '(unnamed)';
    cell.appendChild(name);
    const type = document.createElement('span');
    type.className = 'atlas-share-collection-type';
    type.textContent = ELEMENT_LABELS[entry.type as keyof typeof ELEMENT_LABELS]?.singular ?? entry.type;
    cell.appendChild(type);
    wrap.appendChild(cell);
  }
  return wrap;
}

/**
 * Pin-click modal — a small element card overlay: image, identity, description,
 * then the remaining populated field rows (payload-entry form; relations
 * follow the disclosure rule). Self-contained lifecycle: overlay click / × /
 * Esc remove it. Mirrored in tools/show/render.ts.
 */
export function openPinModal(
  entry: PayloadElementEntry,
  entries: Record<string, PayloadElementEntry>,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'atlas-share-pin-modal-overlay';
  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const modal = document.createElement('div');
  modal.className = 'atlas-share-pin-modal';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'atlas-share-pin-modal-close';
  closeBtn.title = 'Close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', close);
  modal.appendChild(closeBtn);

  if (entry.image_url) {
    const img = document.createElement('img');
    img.className = 'atlas-share-pin-modal-image';
    img.src = entry.image_url;
    img.alt = entry.name;
    img.addEventListener('error', () => img.remove(), { once: true });
    modal.appendChild(img);
  }

  const head = document.createElement('div');
  head.className = 'atlas-share-card-head';
  head.innerHTML = `
    <span class="material-symbols-outlined atlas-share-card-icon">${ELEMENT_ICONS[entry.type as keyof typeof ELEMENT_ICONS] ?? 'category'}</span>
    <span class="atlas-share-card-name">${escapeText(entry.name)}</span>
    <span class="atlas-share-card-type">${escapeText(ELEMENT_LABELS[entry.type as keyof typeof ELEMENT_LABELS]?.singular ?? entry.type)}</span>
  `;
  modal.appendChild(head);

  const description = entry.fields.description;
  if (typeof description === 'string' && description.trim().length > 0) {
    const desc = document.createElement('p');
    desc.className = 'atlas-share-pin-modal-desc';
    desc.textContent = description;
    modal.appendChild(desc);
  }

  const rest = Object.keys(entry.fields).filter(f => f !== 'description');
  if (rest.length > 0) {
    const fieldsWrap = document.createElement('div');
    fieldsWrap.className = 'atlas-share-card-fields';
    for (const field of rest) {
      const row = document.createElement('div');
      row.className = 'atlas-share-card-field';
      const label = document.createElement('div');
      label.className = 'atlas-share-card-field-label';
      label.textContent = humanizeFieldName(field);
      row.appendChild(label);
      row.appendChild(renderPayloadFieldValue(entry.fields[field], entries));
      fieldsWrap.appendChild(row);
    }
    modal.appendChild(fieldsWrap);
  }

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * Frozen-map view — image + %-positioned pin dots. Labels show by default
 * (`showLabels: false` → hover-only). Clicking a pin opens the element modal
 * when its entry resolves. One DOM shape for builder (live-frozen, entries
 * synthesized on the fly) and preview/viewer (payload entries). Returns an
 * honest hint when the block can't freeze (builder-only path — frozen nulls
 * never reach the payload).
 */
export function renderMapView(
  frozen: PayloadMapBlock | null,
  getEntry: (id: string) => PayloadElementEntry | null,
  entriesForModal: Record<string, PayloadElementEntry>,
): HTMLElement {
  if (!frozen) {
    const hint = document.createElement('p');
    hint.className = 'atlas-share-hint atlas-share-map-unpublishable';
    hint.textContent = 'This map can\'t publish yet — it needs a web image URL '
      + '(local files never leave your folder; host the image and set image_url '
      + 'on the map). Dimensions fill in automatically when the image loads in atlas.';
    return hint;
  }
  const showLabels = frozen.showLabels !== false;
  const wrap = document.createElement('figure');
  wrap.className = 'atlas-share-map';
  const frame = document.createElement('div');
  frame.className = 'atlas-share-map-frame';
  const img = document.createElement('img');
  img.className = 'atlas-share-map-image';
  img.src = frozen.image_url;
  img.alt = frozen.title;
  img.loading = 'lazy';
  frame.appendChild(img);
  for (const pin of frozen.pins) {
    const entry = pin.ref ? getEntry(pin.ref) : null;
    const dot = document.createElement('span');
    dot.className = 'atlas-share-map-pin' + (entry ? ' is-openable' : '');
    dot.style.left = `${pin.xPct}%`;
    dot.style.top = `${pin.yPct}%`;
    const label = document.createElement('span');
    label.className = 'atlas-share-map-pin-label' + (showLabels ? ' is-static' : '');
    label.textContent = pin.name;
    dot.appendChild(label);
    if (entry) {
      dot.setAttribute('role', 'button');
      dot.tabIndex = 0;
      const open = (): void => openPinModal(entry, entriesForModal);
      dot.addEventListener('click', open);
      dot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    }
    frame.appendChild(dot);
  }
  wrap.appendChild(frame);
  const caption = document.createElement('figcaption');
  caption.className = 'atlas-share-map-caption';
  caption.textContent = frozen.title;
  wrap.appendChild(caption);
  return wrap;
}

function collectionIcon(type: string): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined atlas-share-collection-icon';
  icon.textContent = ELEMENT_ICONS[type as keyof typeof ELEMENT_ICONS] ?? 'category';
  return icon;
}

/** World-backed resolver for the builder's collection rendering. */
function worldResolver(elements: Map<string, Element>) {
  return (id: string) => {
    const el = elements.get(id);
    if (!el) return null;
    const raw = (el as Record<string, unknown>).image_url;
    return {
      name: el.name || '(unnamed)',
      type: el.type,
      image_url: typeof raw === 'string' && raw.trim() ? raw.trim() : undefined,
    };
  };
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
    case 'collection':
      return renderCollectionView(block, worldResolver(elements));
    case 'map': {
      // Builder context: freeze live (every world element counts as
      // "included" so pins open in the builder; the PAYLOAD freeze applies
      // the real disclosure rule). Modal entries: identity map for chip
      // resolution + full projection for the clicked pin's element.
      const allIds = new Set(elements.keys());
      const identityEntries: Record<string, PayloadElementEntry> = {};
      for (const el of elements.values()) {
        identityEntries[el.id] = { name: el.name || '(unnamed)', type: el.type, fields: {} };
      }
      return renderMapView(
        freezeMapBlock(block, elements, allIds),
        (id) => {
          const el = elements.get(id);
          return el ? projectElementEntry(el, elements, allIds, populatedFieldNames(el), true) : null;
        },
        identityEntries,
      );
    }
    case 'circle':
      // Builder context: compile LIVE from world data, render through the
      // same view the payload path uses (chips resolve against the world).
      return renderCircleView(
        freezeCircleBlock(block, [...elements.values()], elements),
        elements,
        { unresolved: 'chip' },
      );
  }
}

/**
 * Shared circle-knowledge view — head (knower + count) + held entries with
 * full texts. One DOM shape for both sources: live compilation (builder) and
 * the frozen payload (preview/viewer).
 */
function renderCircleView(
  frozen: PayloadCircleBlock,
  proseElements: Map<string, Element>,
  proseOpts: ProseRenderOptions,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-share-circle';

  const head = document.createElement('div');
  head.className = 'atlas-share-circle-head';
  head.innerHTML = `
    <span class="material-symbols-outlined">${frozen.knowerType === 'collective' ? 'groups' : 'person'}</span>
    <span class="atlas-share-circle-name">${escapeText(frozen.title)}</span>
    <span class="atlas-share-circle-tag">${frozen.entries.length === 1 ? '1 entry' : `${frozen.entries.length} entries`} of knowledge</span>
  `;
  wrap.appendChild(head);

  if (frozen.entries.length === 0) {
    const none = document.createElement('p');
    none.className = 'atlas-share-hint';
    none.textContent = 'Holds no knowledge yet.';
    wrap.appendChild(none);
    return wrap;
  }

  for (const entry of frozen.entries) {
    const card = document.createElement('div');
    card.className = 'atlas-share-circle-entry';
    const title = document.createElement('div');
    title.className = 'atlas-share-circle-entry-title';
    title.textContent = entry.title;
    card.appendChild(title);
    if (entry.markdown.trim().length > 0) {
      card.appendChild(renderProseFragment(entry.markdown, proseElements, proseOpts));
    }
    wrap.appendChild(card);
  }
  return wrap;
}

export interface PageViewOptions {
  title: string;
  blocks: readonly PageBlock[];
  elements: Map<string, Element>;
}

/**
 * Render the whole page from WORLD data — the builder's static rendering.
 * For the visitor view, use `renderPayloadPage` (disclosure-true).
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

// ===========================================================================
// PAYLOAD-BACKED rendering — the visitor preview + the viewer tool's path.
// Input is a §5 publish payload; nothing here touches world data.
// ===========================================================================

/** Is this field value a relation-token array (projected at publish time)? */
function isTokenArray(value: unknown): value is RelationToken[] {
  return Array.isArray(value) && value.length > 0
    && value.every(v => v && typeof v === 'object' && typeof (v as RelationToken).text === 'string');
}

/**
 * Render one projected field value. Token arrays follow the disclosure rule:
 * a token WITH `ref` renders as a chip (target is included — linkable in the
 * viewer); a token WITHOUT `ref` renders as plain text (not disclosed).
 * Raw values render as text.
 */
function renderPayloadFieldValue(
  value: unknown,
  entries: Record<string, PayloadElementEntry>,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-share-card-field-value';
  if (isTokenArray(value)) {
    for (const token of value) {
      if (token.ref && entries[token.ref]) {
        const target = entries[token.ref];
        const chip = document.createElement('span');
        chip.className = 'atlas-share-card-chip';
        chip.dataset.ref = token.ref;
        chip.innerHTML = `<span class="material-symbols-outlined">${ELEMENT_ICONS[target.type as keyof typeof ELEMENT_ICONS] ?? 'category'}</span>${escapeText(token.text)}`;
        wrap.appendChild(chip);
      } else {
        const span = document.createElement('span');
        span.textContent = token.text;
        wrap.appendChild(span);
      }
    }
    return wrap;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    wrap.textContent = String(value);
    return wrap;
  }
  if (Array.isArray(value)) {
    wrap.textContent = value.filter(v => typeof v === 'string').join(', ');
    return wrap;
  }
  return wrap;
}

/** Render an element-card block from a payload entry. */
export function renderPayloadCard(
  block: ElementCardBlock,
  entries: Record<string, PayloadElementEntry>,
): HTMLElement {
  const card = document.createElement('div');
  card.className = `atlas-share-card is-${block.variant}`;
  const entry = entries[block.elementId];

  if (!entry) {
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
    <span class="material-symbols-outlined atlas-share-card-icon">${ELEMENT_ICONS[entry.type as keyof typeof ELEMENT_ICONS] ?? 'category'}</span>
    <span class="atlas-share-card-name">${escapeText(entry.name)}</span>
    <span class="atlas-share-card-type">${escapeText(ELEMENT_LABELS[entry.type as keyof typeof ELEMENT_LABELS]?.singular ?? entry.type)}</span>
  `;
  card.appendChild(head);

  // Image per showImage (default on; absent on old payloads = on): banner on
  // full, head avatar on compact. The builder only ships image_url when some
  // card wants it, so this stays payload-true.
  if (block.showImage !== false && entry.image_url) {
    if (block.variant === 'full') {
      const img = document.createElement('img');
      img.className = 'atlas-share-card-image';
      img.src = entry.image_url;
      img.alt = entry.name;
      img.loading = 'lazy';
      card.appendChild(img);
    } else {
      swapIconForAvatar(head, entry.image_url);
    }
  }

  if (block.variant === 'full') {
    const fieldNames = block.fields.filter(f => isPopulated(entry.fields[f]) || isTokenArray(entry.fields[f]));
    if (fieldNames.length > 0) {
      const fieldsWrap = document.createElement('div');
      fieldsWrap.className = 'atlas-share-card-fields';
      for (const field of fieldNames) {
        const row = document.createElement('div');
        row.className = 'atlas-share-card-field';
        const label = document.createElement('div');
        label.className = 'atlas-share-card-field-label';
        label.textContent = humanizeFieldName(field);
        row.appendChild(label);
        row.appendChild(renderPayloadFieldValue(entry.fields[field], entries));
        fieldsWrap.appendChild(row);
      }
      card.appendChild(fieldsWrap);
    }
  }

  return card;
}

/**
 * Apply validated theme tokens to a rendered page article: CSS vars + data
 * attributes (atlas.css / show styles key off them) + the cover banner.
 * Theme values are already allowlist-validated (parsePageTheme) — nothing
 * here interpolates free text into styles. Mirrored in tools/show/render.ts.
 */
export function applyPageTheme(view: HTMLElement, theme: PageTheme): void {
  if (theme.accent) view.style.setProperty('--page-accent', theme.accent);
  const pair = PAGE_THEME_FONTS.find(f => f.key === theme.font);
  if (pair) {
    view.style.setProperty('--page-font-heading', pair.heading);
    view.style.setProperty('--page-font-body', pair.body);
  }
  view.dataset.mode = theme.mode ?? 'dark';
  view.dataset.density = theme.density ?? 'cozy';
  view.dataset.width = theme.width ?? 'regular';
  if (theme.cover) {
    const cover = document.createElement('div');
    cover.className = 'atlas-share-page-cover';
    const img = document.createElement('img');
    img.src = theme.cover;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => cover.remove(), { once: true });
    cover.appendChild(img);
    view.prepend(cover);
  }
}

/**
 * Render a full page from a §5 publish payload — title + block stack,
 * disclosure-true. This IS the visitor preview, and (re-hosted) the viewer
 * tool's render path: what this shows is exactly what a link-holder gets.
 */
export function renderPayloadPage(payload: PagePayload): HTMLElement {
  // Minimal pseudo-elements for prose ow:// name resolution — membership in
  // this map is exactly the payload's included set, so the prose renderer's
  // 'text' mode implements the §5.1 rule (included → chip, else plain text).
  const proseMap = new Map<string, Element>();
  for (const [id, entry] of Object.entries(payload.elements)) {
    proseMap.set(id, { id, type: entry.type, name: entry.name } as Element);
  }

  const view = document.createElement('article');
  view.className = 'atlas-share-page-view';
  const title = document.createElement('h1');
  title.className = 'atlas-share-page-view-title';
  title.textContent = payload.title;
  view.appendChild(title);
  applyPageTheme(view, payload.theme ?? {});

  for (const block of payload.blocks) {
    let node: HTMLElement;
    switch (block.kind) {
      case 'heading': {
        node = document.createElement(block.level === 2 ? 'h3' : 'h2');
        node.className = 'atlas-share-block-heading';
        node.textContent = block.text;
        break;
      }
      case 'prose':
        node = renderProseFragment(block.markdown, proseMap, { unresolved: 'text' });
        break;
      case 'element-card':
        node = renderPayloadCard(block, payload.elements);
        break;
      case 'collection':
        node = renderCollectionView(block, (id) => payload.elements[id] ?? null);
        break;
      case 'map':
        node = renderMapView(block, (id) => payload.elements[id] ?? null, payload.elements);
        break;
      case 'circle':
        // Frozen at publish; entry prose follows the same disclosure rule.
        node = renderCircleView(block, proseMap, { unresolved: 'text' });
        break;
    }
    node.classList.add('atlas-share-page-view-block');
    view.appendChild(node);
  }

  if (payload.blocks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'atlas-share-hint';
    empty.textContent = 'This page has no content yet.';
    view.appendChild(empty);
  }
  return view;
}
