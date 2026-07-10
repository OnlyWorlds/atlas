/**
 * World Home — the default landing room for an active world.
 *
 * Bout H rebuild (workplan D2, session 248): a COVER PAGE with a STUDY-DESK
 * spine. The world as a book you just opened — identity hero (cover image
 * when set, name, description), quiet text-links, the cast slot (D2b
 * protagonist + home), one woven stat line — then re-entry: a "Continue"
 * strip (last writing / last map / last edit) and a tight Recent list whose
 * rows route to the room the element actually lives in.
 *
 * Killed from the pre-D2 layout (deliberate, see workplan H2-H6):
 * the local-only/api-linked + count chips, the 18-tile count-card grid,
 * the compact timeline-mini (revisit after the charts sitdown), and the
 * boxed quick-action buttons.
 */

import { getState, patchSlice, subscribe } from '../core/state';
import { setSidebarModePref } from '../core/ui-prefs';
import { ToastManager } from '../ui/toast-manager';
import {
  navigate, writingHash, elementHash, importHash, knowledgeHash, shareHash, mapHash,
} from '../core/router';
import { ElementCreateModal } from '../ui/element-create-modal';
import { openFieldEditPopover } from '../ui/field-edit-popover';
import { getActiveStore } from '../core/active-store';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import type { Element, ElementType } from '../core/types';
import { narrativeKindOf } from '../core/narrative-kind';
import { isWritingNarrative } from './writing-helpers';
import { escapeText, relativeTime } from '../core/dom-utils';
import { setWorldFavoriteElement, saveRegistry } from '../registry/registry';
import { toastManager } from '../ui/toast-manager';

const CONTENT_ELEMENT_TYPES: ElementType[] = [
  'character', 'location', 'institution', 'object', 'event', 'narrative',
  'family', 'collective', 'species', 'creature', 'phenomenon', 'language',
  'law', 'ability', 'trait', 'title', 'construct', 'relation', 'map',
];

/** Room an element "lives in" — for Recent routing + labels. */
function roomOf(el: Element, worldId: string): { hash: string; label: string } {
  if (el.type === 'narrative') {
    const kind = narrativeKindOf(el);
    if (kind === 'knowledge') return { hash: knowledgeHash(worldId, el.id), label: 'knowledge' };
    if (kind === 'page') return { hash: shareHash(worldId, el.id), label: 'share' };
    if (isWritingNarrative(el, worldId)) return { hash: writingHash(worldId, el.id), label: 'writing' };
  }
  if (el.type === 'map') return { hash: mapHash(worldId, el.id), label: 'map' };
  return { hash: elementHash(worldId, el.id), label: '' };
}

export function mountWorldHome(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-world-home';
  target.appendChild(root);

  function render(): void {
    const active = getState().active;
    if (!active) {
      root.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
      return;
    }
    const elements = getState().data.elements;
    const meta = active.meta;
    const worldId = active.worldId;

    const counts = new Map<string, number>();
    for (const el of elements) {
      if (el.type === 'pin' || el.type === 'marker' || el.type === 'zone') continue;
      counts.set(el.type, (counts.get(el.type) ?? 0) + 1);
    }
    const totalElements = Array.from(counts.values()).reduce((a, b) => a + b, 0);

    root.innerHTML = '';
    root.appendChild(buildCover(meta, worldId, totalElements, counts, toasts));
    if (totalElements === 0) {
      // Empty and still-loading are different truths: during activation the
      // cache is primed async from disk, and showing onboarding meanwhile
      // reads as "your world is empty" (misleading-empty, 2026-07-10).
      if (getState().data.loading) {
        const loadingEl = document.createElement('section');
        loadingEl.className = 'atlas-home-loading';
        loadingEl.innerHTML = `<p class="atlas-home-loading-copy">Opening world…</p>`;
        root.appendChild(loadingEl);
        return;
      }
      root.appendChild(buildOnboarding(toasts));
      return;
    }
    const desk = buildDesk(elements, worldId);
    if (desk) root.appendChild(desk);
  }

  const unsub = subscribe(render);
  render();
  return () => { unsub(); };
}

// ---- The cover -------------------------------------------------------------

function buildCover(
  meta: NonNullable<ReturnType<typeof getState>['active']>['meta'],
  worldId: string,
  totalElements: number,
  counts: Map<string, number>,
  toasts: ToastManager,
): HTMLElement {
  const cover = document.createElement('section');
  cover.className = 'atlas-home-identity';

  // Cover image (T-H7) — only when the world has one; never a placeholder box.
  const imageUrl = (meta as { image_url?: string }).image_url;
  if (imageUrl) {
    const banner = document.createElement('div');
    banner.className = 'atlas-home-cover';
    banner.style.backgroundImage = `url(${JSON.stringify(imageUrl)})`;
    cover.appendChild(banner);
  }

  const identity = document.createElement('div');
  const descriptionMarkup = meta.description
    ? `<p class="atlas-home-world-description atlas-home-clickable" data-edit="description">${escapeText(meta.description)}</p>`
    : `<p class="atlas-home-world-description atlas-home-clickable atlas-home-placeholder" data-edit="description">add a description…</p>`;
  identity.innerHTML = `
    <h1 class="atlas-home-world-name atlas-home-clickable" data-edit="name" title="click to rename">${escapeText(meta.name)}</h1>
    ${descriptionMarkup}
  `;
  cover.appendChild(identity);

  const nameEl = identity.querySelector<HTMLElement>('[data-edit="name"]')!;
  const descEl = identity.querySelector<HTMLElement>('[data-edit="description"]')!;
  nameEl.addEventListener('click', () => openIdentityEdit('name', meta.name, nameEl, toasts));
  descEl.addEventListener('click', () => openIdentityEdit('description', meta.description ?? '', descEl, toasts));

  // Quiet text-links (H6) — the old boxed quick actions, folded into the cover.
  const links = document.createElement('div');
  links.className = 'atlas-home-links';
  const link = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-home-link';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };
  links.appendChild(link('new element', () => new ElementCreateModal(toasts).open()));
  links.appendChild(link('open writing', () => navigate(writingHash(worldId))));
  links.appendChild(link('import', () => navigate(importHash(worldId))));
  cover.appendChild(links);

  // Cast slot (D2b) — renders only when a favorite is set; assignment lives
  // on the element-detail header (char + loc).
  const cast = buildCastSlot(worldId);
  if (cast) cover.appendChild(cast);

  // The woven stat line (replaces the count-card grid + the meta chips).
  if (totalElements > 0) {
    const statline = document.createElement('div');
    statline.className = 'atlas-home-statline';
    let first = true;
    for (const type of CONTENT_ELEMENT_TYPES) {
      const count = counts.get(type) ?? 0;
      if (count === 0) continue;
      if (!first) {
        const sep = document.createElement('span');
        sep.className = 'atlas-home-statline-sep';
        sep.textContent = '·';
        statline.appendChild(sep);
      }
      first = false;
      const seg = document.createElement('button');
      seg.type = 'button';
      seg.className = 'atlas-home-statline-seg';
      seg.title = `Show ${type}s in the sidebar`;
      seg.innerHTML = `<b>${count}</b> ${escapeText((count === 1
        ? ELEMENT_LABELS[type]?.singular
        : ELEMENT_LABELS[type]?.plural) ?? type)}`;
      seg.addEventListener('click', () => {
        const ui = getState().ui;
        if (ui.sidebarMode !== 'elements') {
          patchSlice('ui', { ...ui, sidebarMode: 'elements', elementFilters: new Set([type]) });
          setSidebarModePref('elements');
        } else {
          patchSlice('ui', { ...ui, elementFilters: new Set([type]) });
        }
      });
      statline.appendChild(seg);
    }
    cover.appendChild(statline);
  }

  return cover;
}

/**
 * Ghost cast card shown while no favorite is set — the setter lives on the
 * element-detail header, which Captain couldn't find from home (2026-07-10).
 * Clicking filters the sidebar to characters so the path is one hop.
 */
function buildCastHint(_worldId: string): HTMLElement | null {
  const elements = getState().data.elements;
  if (getState().data.loading) return null;
  if (!elements.some(e => e.type === 'character')) return null;
  const slot = document.createElement('div');
  slot.className = 'atlas-home-cast';
  const ghost = document.createElement('button');
  ghost.type = 'button';
  ghost.className = 'atlas-home-cast-card atlas-home-cast-ghost';
  ghost.title = 'Open a character and click the person pin in its header to set your protagonist';
  ghost.innerHTML = `
    <span class="material-symbols-outlined atlas-home-cast-icon">person_pin</span>
    <span class="atlas-home-cast-text">
      <span class="atlas-home-cast-name">choose a protagonist</span>
      <span class="atlas-home-cast-role">shows here on the cover</span>
    </span>
  `;
  ghost.addEventListener('click', () => {
    const ui = getState().ui;
    patchSlice('ui', { ...ui, sidebarMode: 'elements', elementFilters: new Set(['character' as const]) });
    setSidebarModePref('elements');
  });
  slot.appendChild(ghost);
  return slot;
}

/** The cast slot: protagonist + home cards, only those that are set. */
function buildCastSlot(worldId: string): HTMLElement | null {
  const reg = getState().registry;
  const favorites = reg.worlds.find(w => w.id === worldId)?.favorites;
  if (!favorites) return buildCastHint(worldId);
  const elements = getState().data.elements;
  const entries: { el: Element; role: string; icon: string; kind: 'protagonist' | 'nexus' }[] = [];
  const protagonist = favorites.protagonist_id ? elements.find(e => e.id === favorites.protagonist_id) : undefined;
  const nexus = favorites.nexus_id ? elements.find(e => e.id === favorites.nexus_id) : undefined;
  if (protagonist) entries.push({ el: protagonist, role: 'protagonist', icon: 'person_pin', kind: 'protagonist' });
  if (nexus) entries.push({ el: nexus, role: 'home', icon: 'home_pin', kind: 'nexus' });
  if (entries.length === 0) return buildCastHint(worldId);

  const slot = document.createElement('div');
  slot.className = 'atlas-home-cast';
  for (const { el, role, icon, kind } of entries) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'atlas-home-cast-card';
    const image = (el as { image_url?: string }).image_url;
    if (image) {
      const face = document.createElement('span');
      face.className = 'atlas-home-cast-face';
      face.style.backgroundImage = `url(${JSON.stringify(image)})`;
      card.appendChild(face);
    } else {
      const face = document.createElement('span');
      face.className = 'material-symbols-outlined atlas-home-cast-icon';
      face.textContent = ELEMENT_ICONS[el.type] ?? 'category';
      card.appendChild(face);
    }
    const text = document.createElement('span');
    text.className = 'atlas-home-cast-text';
    text.innerHTML = `
      <span class="atlas-home-cast-name">${escapeText(el.name || '(unnamed)')}</span>
      <span class="atlas-home-cast-role"><span class="material-symbols-outlined">${icon}</span>${role}</span>
    `;
    card.appendChild(text);
    card.addEventListener('click', () => navigate(elementHash(worldId, el.id)));
    // Unset affordance (sitdown pile, S5 discoverability): the setter lives on
    // the element header, but the UNSET must be reachable from where the
    // assignment is visible. A span, not a button — buttons don't nest.
    const unset = document.createElement('span');
    unset.className = 'atlas-home-cast-unset material-symbols-outlined';
    unset.setAttribute('role', 'button');
    unset.setAttribute('aria-label', `Unset ${role}`);
    unset.title = `Unset ${role}`;
    unset.textContent = 'close';
    unset.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const next = setWorldFavoriteElement(getState().registry, worldId, kind, null);
      saveRegistry(next);
      patchSlice('registry', next);
      toastManager.info(`No longer the world's ${role}`);
    });
    card.appendChild(unset);
    slot.appendChild(card);
  }
  return slot;
}

// ---- The desk (continue + recent) ------------------------------------------

function buildDesk(elements: readonly Element[], worldId: string): HTMLElement | null {
  const content = elements.filter(el => el.type !== 'pin' && el.type !== 'marker' && el.type !== 'zone');
  const byRecency = [...content]
    .sort((a, b) => (b.local_updated_at ?? '').localeCompare(a.local_updated_at ?? ''));

  const desk = document.createElement('div');
  desk.className = 'atlas-home-desk';

  // Continue strip — step back into the world where you left it.
  const lastWriting = byRecency.find(el => el.type === 'narrative' && isWritingNarrative(el, worldId));
  const lastMap = byRecency.find(el => el.type === 'map');
  const lastEdited = byRecency.find(el => el !== lastWriting && el !== lastMap);
  const continueRows: { icon: string; verb: string; el: Element; hash: string }[] = [];
  if (lastWriting) continueRows.push({ icon: 'edit_note', verb: 'Continue writing', el: lastWriting, hash: writingHash(worldId, lastWriting.id) });
  if (lastMap) continueRows.push({ icon: 'map', verb: 'Continue mapping', el: lastMap, hash: mapHash(worldId, lastMap.id) });
  if (lastEdited) continueRows.push({ icon: ELEMENT_ICONS[lastEdited.type] ?? 'category', verb: 'Continue editing', el: lastEdited, hash: roomOf(lastEdited, worldId).hash });

  if (continueRows.length > 0) {
    const section = document.createElement('section');
    section.className = 'atlas-home-continue';
    const title = document.createElement('h2');
    title.className = 'atlas-home-section-title';
    title.textContent = 'Continue';
    section.appendChild(title);
    for (const row of continueRows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'atlas-home-continue-row';
      btn.innerHTML = `
        <span class="material-symbols-outlined">${row.icon}</span>
        <span class="atlas-home-continue-verb">${row.verb}</span>
        <span class="atlas-home-continue-name">${escapeText(row.el.name || '(unnamed)')}</span>
        <span class="atlas-home-continue-time">${relativeTime(row.el.local_updated_at)}</span>
      `;
      btn.addEventListener('click', () => navigate(row.hash));
      section.appendChild(btn);
    }
    desk.appendChild(section);
  }

  // Recent — tight rows; each routes to the room the element lives in (H5).
  const continueIds = new Set(continueRows.map(r => r.el.id));
  const recent = byRecency.filter(el => !continueIds.has(el.id)).slice(0, 5);
  if (recent.length > 0) {
    const section = document.createElement('section');
    section.className = 'atlas-home-recent';
    const title = document.createElement('h2');
    title.className = 'atlas-home-section-title';
    // Truthful label: rows sort on local_updated_at, so this is edit recency,
    // not view recency.
    title.textContent = 'Recently edited';
    section.appendChild(title);
    const list = document.createElement('div');
    list.className = 'atlas-home-recent-list';
    for (const el of recent) {
      const room = roomOf(el, worldId);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'atlas-home-recent-row';
      row.innerHTML = `
        <span class="material-symbols-outlined atlas-home-recent-icon">${ELEMENT_ICONS[el.type] ?? 'category'}</span>
        <span class="atlas-home-recent-name">${escapeText(el.name || '(unnamed)')}</span>
        ${room.label ? `<span class="atlas-home-recent-room">${room.label}</span>` : ''}
        <span class="atlas-home-recent-type">${el.type}</span>
        <span class="atlas-home-recent-time">${relativeTime(el.local_updated_at)}</span>
      `;
      row.addEventListener('click', () => navigate(room.hash));
      list.appendChild(row);
    }
    section.appendChild(list);
    desk.appendChild(section);
  }

  return desk.childElementCount > 0 ? desk : null;
}

// ---- Empty-world onboarding (unchanged behavior) ----------------------------

function buildOnboarding(toasts: ToastManager): HTMLElement {
  const onboarding = document.createElement('section');
  onboarding.className = 'atlas-home-onboarding';
  onboarding.innerHTML = `
    <h2 class="atlas-home-section-title">Your world is empty</h2>
    <p class="atlas-home-onboarding-copy">
      Start with a few characters, locations, or events.
    </p>
    <div class="atlas-home-onboarding-grid">
      <button class="atlas-home-onboarding-tile" data-create-type="character">
        <span class="material-symbols-outlined">${ELEMENT_ICONS['character'] ?? 'person'}</span>
        <span>character</span>
      </button>
      <button class="atlas-home-onboarding-tile" data-create-type="location">
        <span class="material-symbols-outlined">${ELEMENT_ICONS['location'] ?? 'place'}</span>
        <span>location</span>
      </button>
      <button class="atlas-home-onboarding-tile" data-create-type="event">
        <span class="material-symbols-outlined">${ELEMENT_ICONS['event'] ?? 'event'}</span>
        <span>event</span>
      </button>
      <button class="atlas-home-onboarding-tile" data-create-type="narrative">
        <span class="material-symbols-outlined">${ELEMENT_ICONS['narrative'] ?? 'menu_book'}</span>
        <span>narrative</span>
      </button>
    </div>
    <p class="atlas-home-onboarding-hint">
      Or pick any of the 22 element types via the + button in the elements sidebar.
    </p>
  `;
  onboarding.querySelectorAll<HTMLButtonElement>('[data-create-type]').forEach((btn) => {
    const initialType = btn.dataset.createType as ElementType;
    btn.addEventListener('click', () => {
      new ElementCreateModal(toasts, { initialType }).open();
    });
  });
  return onboarding;
}

/**
 * Open the field-edit popover anchored to the identity strip's name or
 * description element. Persists via FolderStore.writeWorldMeta + mirrors the
 * change in state.active.meta so the home re-renders with the new value.
 */
function openIdentityEdit(
  field: 'name' | 'description',
  current: string,
  anchor: HTMLElement,
  toasts: ToastManager,
): void {
  openFieldEditPopover({
    anchor,
    label: field === 'name' ? 'world name' : 'world description',
    value: current,
    widget: field === 'name' ? 'text-short' : 'text-long',
    onSave: async (next: unknown) => {
      const value = String(next ?? '').trim();
      if (field === 'name' && !value) {
        throw new Error('name is required');
      }
      const store = getActiveStore();
      const active = getState().active;
      if (!store || !active) {
        throw new Error('No active world');
      }
      await store.writeWorldMeta({ [field]: value });
      patchSlice('active', {
        ...active,
        meta: { ...active.meta, [field]: value },
      });
      toasts.info(`World ${field} saved`);
    },
  });
}
