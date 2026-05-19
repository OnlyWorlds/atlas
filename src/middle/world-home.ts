/**
 * World Home — the default landing room for an active world.
 *
 * See DESIGN_HOME.md for full spec. Sections (top → bottom):
 *   1. Identity strip (name, description, world type)
 *   2. Onboarding tiles (empty world only) OR Stats spread
 *   3. Compact timeline (embedded timeline-bar, click dot → element)
 *   4. Recent activity (last 5 by local_updated_at)
 *   5. Quick actions row (+ new element, open writing, settings)
 *
 * Layout invariant: the timeline-bar mounts ONCE per home mount (it manages
 * its own canvas + ResizeObserver). Surrounding sections re-render in-place
 * into stable container slots — no innerHTML wipe of the timeline mount.
 */

import { getState, patchSlice, subscribe } from '../core/state';
import { setSidebarModePref } from '../core/ui-prefs';
import { ToastManager } from '../ui/toast-manager';
import { navigate, writingHash, settingsHash, elementHash, timelineHash } from '../core/router';
import { ElementCreateModal } from '../ui/element-create-modal';
import { openFieldEditPopover } from '../ui/field-edit-popover';
import { getActiveStore } from '../core/active-store';
import { ELEMENT_ICONS } from '../core/constants';
import type { ElementType } from '../core/types';
import { mountTimelineBar, type TimelineBarHandle } from '../visualization/timeline/timeline-bar';
import { escapeText, relativeTime } from '../core/dom-utils';

const CONTENT_ELEMENT_TYPES: ElementType[] = [
  'character', 'location', 'institution', 'object', 'event', 'narrative',
  'family', 'collective', 'species', 'creature', 'phenomenon', 'language',
  'law', 'ability', 'trait', 'title', 'construct', 'relation', 'map',
];

export function mountWorldHome(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-world-home';
  target.appendChild(root);

  // ---- Stable section slots (built once; populated on every render) ----
  const topSlot = document.createElement('div');
  topSlot.className = 'atlas-home-top-slot';
  root.appendChild(topSlot);

  // Timeline section is built ONCE and the bar inside it persists across
  // re-renders. Only setElements() is called on subsequent renders.
  const timelineSection = document.createElement('section');
  timelineSection.className = 'atlas-home-timeline-section';
  const titleRow = document.createElement('div');
  titleRow.className = 'atlas-home-timeline-titlerow';
  titleRow.innerHTML = `
    <h2 class="atlas-home-section-title" style="margin-bottom: 0;">Timeline</h2>
    <button class="atlas-btn-ghost atlas-home-timeline-expand" data-action="open-timeline">
      <span class="material-symbols-outlined">open_in_full</span>
      <span>Open full</span>
    </button>
  `;
  timelineSection.appendChild(titleRow);
  const barMount = document.createElement('div');
  barMount.className = 'atlas-home-timeline-mount';
  timelineSection.appendChild(barMount);
  root.appendChild(timelineSection);

  const bottomSlot = document.createElement('div');
  bottomSlot.className = 'atlas-home-bottom-slot';
  root.appendChild(bottomSlot);

  // Timeline-bar mounted once with the current world's worldId baked in. If
  // the active world changes (state.active swap), we tear down and remount
  // because the navigate callbacks close over the old worldId.
  let timelineBar: TimelineBarHandle | null = null;
  let mountedWorldId: string | null = null;

  function render(): void {
    const active = getState().active;
    if (!active) {
      // No world — show empty message, dispose any prior bar.
      topSlot.innerHTML = '<div class="atlas-pane-empty">No active world.</div>';
      timelineSection.style.display = 'none';
      bottomSlot.innerHTML = '';
      if (timelineBar) { timelineBar.destroy(); timelineBar = null; mountedWorldId = null; }
      return;
    }

    timelineSection.style.display = '';

    const elements = getState().data.elements;
    const meta = active.meta;
    const worldId = active.worldId;

    // Stats by type (exclude map artifacts pin/marker/zone).
    const counts = new Map<string, number>();
    for (const el of elements) {
      if (el.type === 'pin' || el.type === 'marker' || el.type === 'zone') continue;
      counts.set(el.type, (counts.get(el.type) ?? 0) + 1);
    }
    const totalElements = Array.from(counts.values()).reduce((a, b) => a + b, 0);

    // Recent activity — last 5 by local_updated_at.
    const recent = [...elements]
      .filter(el => el.type !== 'pin' && el.type !== 'marker' && el.type !== 'zone')
      .sort((a, b) => (b.local_updated_at ?? '').localeCompare(a.local_updated_at ?? ''))
      .slice(0, 5);

    renderTop(topSlot, active, totalElements, counts, meta, worldId, toasts);
    titleRow.querySelector<HTMLButtonElement>('[data-action="open-timeline"]')?.replaceWith(
      buildExpandButton(worldId),
    );
    renderBottom(bottomSlot, recent, worldId, toasts);

    // Mount the timeline-bar once per world activation. Re-renders only push
    // new element data into the existing bar — canvas, ResizeObserver, and
    // any caches the bar holds stay alive.
    if (!timelineBar || mountedWorldId !== worldId) {
      timelineBar?.destroy();
      timelineBar = mountTimelineBar(barMount, {
        mode: 'compact',
        onNavigate: (id) => navigate(elementHash(worldId, id)),
        onExpand: () => navigate(timelineHash(worldId)),
      });
      mountedWorldId = worldId;
    }
    timelineBar.setElements(elements);
  }

  const unsub = subscribe(render);
  render();

  return () => {
    unsub();
    timelineBar?.destroy();
    timelineBar = null;
    mountedWorldId = null;
  };
}

/** Build the "Open full" button anew so its click handler binds the current worldId. */
function buildExpandButton(worldId: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'atlas-btn-ghost atlas-home-timeline-expand';
  btn.setAttribute('data-action', 'open-timeline');
  btn.innerHTML = `
    <span class="material-symbols-outlined">open_in_full</span>
    <span>Open full</span>
  `;
  btn.addEventListener('click', () => navigate(timelineHash(worldId)));
  return btn;
}

function renderTop(
  slot: HTMLElement,
  active: ReturnType<typeof getState>['active'],
  totalElements: number,
  counts: Map<string, number>,
  meta: NonNullable<ReturnType<typeof getState>['active']>['meta'],
  worldId: string,
  toasts: ToastManager,
): void {
  slot.innerHTML = '';

  // --- Identity strip (click-to-edit name + description via popover) ---
  const identity = document.createElement('section');
  identity.className = 'atlas-home-identity';
  const stateBadge = active?.opened ? (meta.api ? 'api-linked' : 'local-only') : '';
  const descriptionMarkup = meta.description
    ? `<p class="atlas-home-world-description atlas-home-clickable" data-edit="description">${escapeText(meta.description)}</p>`
    : `<p class="atlas-home-world-description atlas-home-clickable atlas-home-placeholder" data-edit="description">add a description…</p>`;
  identity.innerHTML = `
    <h1 class="atlas-home-world-name atlas-home-clickable" data-edit="name" title="click to rename">${escapeText(meta.name)}</h1>
    ${descriptionMarkup}
    <div class="atlas-home-world-meta">
      ${stateBadge ? `<span class="atlas-home-tag">${stateBadge}</span>` : ''}
      <span class="atlas-home-tag">${totalElements} ${totalElements === 1 ? 'element' : 'elements'}</span>
    </div>
  `;
  slot.appendChild(identity);

  const nameEl = identity.querySelector<HTMLElement>('[data-edit="name"]')!;
  const descEl = identity.querySelector<HTMLElement>('[data-edit="description"]')!;
  nameEl.addEventListener('click', () => openIdentityEdit('name', meta.name, nameEl, toasts));
  descEl.addEventListener('click', () => openIdentityEdit('description', meta.description ?? '', descEl, toasts));

  // --- Empty-world onboarding (totalElements === 0) ---
  if (totalElements === 0) {
    const onboarding = document.createElement('section');
    onboarding.className = 'atlas-home-onboarding';
    onboarding.innerHTML = `
      <h2 class="atlas-home-section-title">Your world is empty</h2>
      <p class="atlas-home-onboarding-copy">
        Start by adding a few elements. Characters, locations, events — anything that lives in your world.
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
    slot.appendChild(onboarding);
    return;
  }

  // --- Stats spread ---
  const stats = document.createElement('section');
  stats.className = 'atlas-home-stats';
  const statsTitle = document.createElement('h2');
  statsTitle.className = 'atlas-home-section-title';
  statsTitle.textContent = 'Elements';
  stats.appendChild(statsTitle);

  const grid = document.createElement('div');
  grid.className = 'atlas-home-stats-grid';
  for (const type of CONTENT_ELEMENT_TYPES) {
    const count = counts.get(type) ?? 0;
    if (count === 0) continue;
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'atlas-home-stat-tile';
    tile.title = `${count} ${type}${count === 1 ? '' : 's'}`;
    tile.setAttribute('data-element-type', type);
    tile.innerHTML = `
      <span class="material-symbols-outlined">${ELEMENT_ICONS[type] ?? 'category'}</span>
      <span class="atlas-home-stat-count">${count}</span>
      <span class="atlas-home-stat-label">${type}</span>
    `;
    tile.addEventListener('click', () => {
      const ui = getState().ui;
      if (ui.sidebarMode !== 'elements') {
        patchSlice('ui', { ...ui, sidebarMode: 'elements', elementFilters: new Set([type]) });
        setSidebarModePref('elements');
      } else {
        patchSlice('ui', { ...ui, elementFilters: new Set([type]) });
      }
    });
    grid.appendChild(tile);
  }
  stats.appendChild(grid);
  slot.appendChild(stats);
}

function renderBottom(
  slot: HTMLElement,
  recent: ReturnType<typeof getState>['data']['elements'],
  worldId: string,
  toasts: ToastManager,
): void {
  slot.innerHTML = '';

  // --- Recent activity ---
  if (recent.length > 0) {
    const recentSection = document.createElement('section');
    recentSection.className = 'atlas-home-recent';
    const recentTitle = document.createElement('h2');
    recentTitle.className = 'atlas-home-section-title';
    recentTitle.textContent = 'Recent';
    recentSection.appendChild(recentTitle);

    const list = document.createElement('div');
    list.className = 'atlas-home-recent-list';
    for (const el of recent) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'atlas-home-recent-row';
      row.innerHTML = `
        <span class="material-symbols-outlined atlas-home-recent-icon">${ELEMENT_ICONS[el.type] ?? 'category'}</span>
        <span class="atlas-home-recent-name">${escapeText(el.name || '(unnamed)')}</span>
        <span class="atlas-home-recent-type">${el.type}</span>
        <span class="atlas-home-recent-time">${relativeTime(el.local_updated_at)}</span>
      `;
      row.addEventListener('click', () => {
        navigate(elementHash(worldId, el.id));
      });
      list.appendChild(row);
    }
    recentSection.appendChild(list);
    slot.appendChild(recentSection);
  }

  // --- Quick actions ---
  const actions = document.createElement('section');
  actions.className = 'atlas-home-actions';
  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'atlas-btn-primary';
  newBtn.innerHTML = '<span class="material-symbols-outlined">add</span><span>New element</span>';
  newBtn.addEventListener('click', () => new ElementCreateModal(toasts).open());
  actions.appendChild(newBtn);

  const writingBtn = document.createElement('button');
  writingBtn.type = 'button';
  writingBtn.className = 'atlas-btn-ghost';
  writingBtn.innerHTML = '<span class="material-symbols-outlined">edit_note</span><span>Open writing</span>';
  writingBtn.addEventListener('click', () => navigate(writingHash(worldId)));
  actions.appendChild(writingBtn);

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'atlas-btn-ghost';
  settingsBtn.innerHTML = '<span class="material-symbols-outlined">settings</span><span>Settings</span>';
  settingsBtn.addEventListener('click', () => navigate(settingsHash(worldId)));
  actions.appendChild(settingsBtn);

  slot.appendChild(actions);
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
