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
import { timelineHash } from '../core/router';
import { tableauScope } from '../visualization/timeline/chart-recipe';
import { extractTemporalNodes } from '../visualization/timeline/data-normalizer';
import { freezeChartBlock } from '../visualization/timeline/chart-freeze';
import { renderChartView } from '../visualization/timeline/chart-static';
import type { ChartConfig } from '../visualization/timeline/types';

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

  // Saved charts for the home chart strip (S15) — fetched once per mount,
  // refreshed on out-of-band changes (save/rename/delete in the Charts room,
  // id-swap migration). null = not loaded yet (strip falls back to the recipe
  // default meanwhile, which is also the no-saved-charts behavior).
  let savedCharts: ChartConfig[] | null = null;
  let chartFetchGen = 0;
  function refreshSavedCharts(): void {
    const gen = ++chartFetchGen;
    const store = getActiveStore();
    if (!store) { savedCharts = []; return; }
    void store.readCharts().then(charts => {
      if (gen !== chartFetchGen) return; // superseded fetch
      savedCharts = charts;
      render();
    }).catch(() => { savedCharts = []; });
  }

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
    // The chart strip (S15: the "starred chart") — the shape of the world's
    // history between the cover and the desk (timeline-mini's old slot, now
    // the real chart pipeline: first saved chart, else the recipe default).
    const chartStrip = buildChartStrip(elements, worldId, savedCharts ?? []);
    if (chartStrip) root.appendChild(chartStrip);
    const desk = buildDesk(elements, worldId);
    if (desk) root.appendChild(desk);
  }

  const onChartsChanged = (): void => refreshSavedCharts();
  window.addEventListener('atlas:charts-changed', onChartsChanged);
  refreshSavedCharts();
  const unsub = subscribe(render);
  render();
  return () => {
    window.removeEventListener('atlas:charts-changed', onChartsChanged);
    unsub();
  };
}

// ---- The chart strip (S15) --------------------------------------------------

/**
 * A static render of the world's chart on the cover: the FIRST saved chart
 * when one exists (saving a chart is the "starring" act for v1), else the
 * TABLEAU — the same default the Charts room lands on (Captain set a home
 * location and couldn't find it here: the old Story-recipe default could
 * never include a location). Cast rides into the freeze so protagonist/home
 * read cyan. Every node carries a ref, so a click lands in the Charts room
 * FOCUSED on that element. Hidden below 3 dated nodes.
 */
function buildChartStrip(elements: readonly Element[], worldId: string, savedCharts: ChartConfig[]): HTMLElement | null {
  const favorites = getState().registry.worlds.find(w => w.id === worldId)?.favorites;
  const cast = { protagonistId: favorites?.protagonist_id ?? null, nexusId: favorites?.nexus_id ?? null };
  // ALWAYS the tableau (S256, Captain: "home charts feel a bit random") — the
  // strip previews exactly what the Charts room opens to. One mental model:
  // home is the zoomed-out truth, the room is the same picture with controls.
  // Saved charts no longer hijack the strip (savedCharts[0] used to replace it
  // wholesale, so an old experiment silently owned the home); they ride below
  // as chips into the room's gallery.
  const chart: ChartConfig = {
    schema_version: 1,
    id: 'home-tableau',
    name: 'Tableau',
    axis: { kind: 'time', direction: 'both' },
    scope: tableauScope(
      extractTemporalNodes([...elements]),
      [cast.protagonistId, cast.nexusId].filter((x): x is string => !!x),
    ),
    render: '2d',
  };
  const frozen = freezeChartBlock(chart.id, 'home-chart-strip', [chart], [...elements], new Set(elements.map(e => e.id)), { cast });
  if (!frozen || frozen.nodes.length < 3) return null;

  const section = document.createElement('section');
  section.className = 'atlas-home-charts';
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'atlas-home-section-title atlas-home-charts-title';
  title.title = 'Open the Charts room';
  title.innerHTML = `Charts <span class="material-symbols-outlined">arrow_forward</span>`;
  title.addEventListener('click', () => navigate(timelineHash(worldId)));
  section.appendChild(title);

  const view = renderChartView(frozen, {
    height: 170,
    layout: 'strip',
    onRef: (ref) => navigate(timelineHash(worldId, ref)),
  });
  section.appendChild(view);

  if (savedCharts.length > 0) {
    const row = document.createElement('div');
    row.className = 'atlas-home-saved-charts';
    const label = document.createElement('span');
    label.className = 'atlas-home-saved-charts-label';
    label.textContent = 'Saved';
    row.appendChild(label);
    for (const saved of savedCharts) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'atlas-home-saved-chart-chip';
      chip.textContent = saved.name;
      chip.title = 'Open in the Charts room';
      chip.addEventListener('click', () => navigate(timelineHash(worldId)));
      row.appendChild(chip);
    }
    section.appendChild(row);
  }
  return section;
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

  // (The old quick text-links — new element / open writing / import — were
  // removed S255v3: the room nav + onboarding tiles cover every one of them.)

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

/** The per-kind cast configuration — card + ghost share it. */
const CAST_KINDS = [
  {
    kind: 'protagonist' as const, role: 'protagonist', icon: 'person_pin',
    elementType: 'character' as const, ghostName: 'choose a protagonist',
    ghostTitle: 'Open a character and click the person pin in its header to set your protagonist',
  },
  {
    kind: 'nexus' as const, role: 'home', icon: 'home_pin',
    elementType: 'location' as const, ghostName: 'choose a home',
    ghostTitle: 'Open a location and click the home pin in its header to set your home place',
  },
];

/**
 * Ghost cast card for an unset slot — the setter lives on the element-detail
 * header, which Captain couldn't find from home (2026-07-10). Clicking filters
 * the sidebar to the right type so the path is one hop. Both kinds get a
 * ghost side by side (nexus beside protagonist, Captain 2026-07-10).
 */
function buildCastGhost(spec: typeof CAST_KINDS[number]): HTMLElement {
  const ghost = document.createElement('button');
  ghost.type = 'button';
  ghost.className = 'atlas-home-cast-card atlas-home-cast-ghost';
  ghost.title = spec.ghostTitle;
  ghost.innerHTML = `
    <span class="material-symbols-outlined atlas-home-cast-icon">${spec.icon}</span>
    <span class="atlas-home-cast-text">
      <span class="atlas-home-cast-name">${spec.ghostName}</span>
      <span class="atlas-home-cast-role">shows here on the cover</span>
    </span>
  `;
  ghost.addEventListener('click', () => {
    const ui = getState().ui;
    // Assignment MODE (Captain, 2026-07-10): the ghost doesn't just filter —
    // the next click on a matching sidebar row assigns directly. One hop.
    patchSlice('ui', {
      ...ui,
      sidebarMode: 'elements',
      elementFilters: new Set([spec.elementType]),
      castAssign: { kind: spec.kind },
    });
    setSidebarModePref('elements');
  });
  return ghost;
}

/** The cast slot: a card per set favorite, a ghost per unset one. */
function buildCastSlot(worldId: string): HTMLElement | null {
  if (getState().data.loading) return null;
  const reg = getState().registry;
  const favorites = reg.worlds.find(w => w.id === worldId)?.favorites;
  const elements = getState().data.elements;

  const slot = document.createElement('div');
  slot.className = 'atlas-home-cast';
  let rendered = 0;
  for (const spec of CAST_KINDS) {
    const favId = spec.kind === 'protagonist' ? favorites?.protagonist_id : favorites?.nexus_id;
    const el = favId ? elements.find(e => e.id === favId) : undefined;
    if (el) {
      slot.appendChild(buildCastCard(el, spec, worldId));
      rendered++;
    } else if (elements.some(e => e.type === spec.elementType)) {
      // Ghost only when the world HAS candidates of that type.
      slot.appendChild(buildCastGhost(spec));
      rendered++;
    }
  }
  return rendered > 0 ? slot : null;
}

/** One set cast card: face, name, role, click-through, hover × unset. */
function buildCastCard(el: Element, spec: typeof CAST_KINDS[number], worldId: string): HTMLElement {
  const { role, icon, kind } = spec;
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
    return card;
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
      Create something new.
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
      <button class="atlas-home-onboarding-tile" data-create-any>
        <span class="material-symbols-outlined">add</span>
        <span>everything else</span>
      </button>
    </div>
  `;
  onboarding.querySelectorAll<HTMLButtonElement>('[data-create-type]').forEach((btn) => {
    const initialType = btn.dataset.createType as ElementType;
    btn.addEventListener('click', () => {
      new ElementCreateModal(toasts, { initialType }).open();
    });
  });
  // "everything else": opens the full type grid; hovering it spotlights the
  // sidebar's + button — teaching where creation lives permanently (S255v3).
  const anyTile = onboarding.querySelector<HTMLButtonElement>('[data-create-any]')!;
  anyTile.addEventListener('click', () => new ElementCreateModal(toasts).open());
  const sidebarCreate = (): HTMLElement | null => document.querySelector('[data-action="create-element"]');
  anyTile.addEventListener('mouseenter', () => sidebarCreate()?.classList.add('atlas-create-pulse'));
  anyTile.addEventListener('mouseleave', () => sidebarCreate()?.classList.remove('atlas-create-pulse'));
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
