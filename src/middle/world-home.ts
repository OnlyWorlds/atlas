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
import { openMapTab } from '../tabs/right/map-index-tab';
import { openFieldEditPopover } from '../ui/field-edit-popover';
import { getActiveStore } from '../core/active-store';
import { requestPushIfLinked } from '../sync/sync-attach';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import type { Element, ElementType, WorldMap } from '../core/types';
import { narrativeKindOf } from '../core/narrative-kind';
import { isWritingNarrative } from './writing-helpers';
import { escapeText, relativeTime } from '../core/dom-utils';
import { setWorldFavoriteElement, dismissTourCard, saveRegistry } from '../registry/registry';
import { computeTourCards, type TourWaveEntry } from './home-tour';
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

/**
 * Desk/recent/CTA click-through. Maps go through openMapTab, not navigation —
 * navigate(mapHash) alone can't activate an already-open background tab
 * (ensureMapTabOpen early-returns on exists), and imageless maps need the
 * toast + divert-to-element feedback instead of a silent dead click (S265,
 * Captain's find: "recent map does nothing").
 */
function openDeskTarget(el: Element, hash: string): void {
  if (el.type === 'map') { openMapTab(el as WorldMap); return; }
  navigate(hash);
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
    if (totalElements === 0 && getState().data.loading) {
      // Empty and still-loading are different truths: during activation the
      // cache is primed async from disk, and showing onboarding meanwhile
      // reads as "your world is empty" (misleading-empty, 2026-07-10).
      const progress = getState().data.loadingProgress;
      const copy = progress
        ? `Opening world… ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`
        : 'Opening world…';
      const loadingEl = document.createElement('section');
      loadingEl.className = 'atlas-home-loading';
      loadingEl.innerHTML = `<p class="atlas-home-loading-copy">${copy}</p>`;
      root.appendChild(loadingEl);
      return;
    }
    // The tour (S264): tutorial-state cards computed from world contents —
    // the core create pair, then the next wave / room CTAs. Renders nothing
    // for a built-out (or dismissed-out) world — and never on a VIEW-ONLY
    // world (inviting creates that can only toast is noise, not teaching).
    const viewOnly = !!getState().registry.worlds.find(w => w.id === worldId)?.api?.read_only;
    if (!viewOnly) {
      const tour = buildTour(counts, totalElements, worldId, toasts);
      if (tour) root.appendChild(tour);
    }
    if (totalElements === 0) return;
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
  // View-only worlds (S264): the empty-description INVITE is withheld (the
  // write would only toast); an existing description still renders plainly.
  const viewOnly = !!getState().registry.worlds.find(w => w.id === worldId)?.api?.read_only;
  const descriptionMarkup = meta.description
    ? `<p class="atlas-home-world-description atlas-home-clickable" data-edit="description">${escapeText(meta.description)}</p>`
    : viewOnly
      ? ''
      : `<p class="atlas-home-world-description atlas-home-clickable atlas-home-placeholder" data-edit="description">describe your world…</p>`;
  identity.innerHTML = `
    <h1 class="atlas-home-world-name atlas-home-clickable" data-edit="name" title="click to rename (a local name — the OnlyWorlds world name lives in settings)">${escapeText(meta.name)}</h1>
    ${descriptionMarkup}
  `;
  cover.appendChild(identity);

  const nameEl = identity.querySelector<HTMLElement>('[data-edit="name"]')!;
  const descEl = identity.querySelector<HTMLElement>('[data-edit="description"]');
  nameEl.addEventListener('click', () => openIdentityEdit('name', meta.name, nameEl, toasts));
  descEl?.addEventListener('click', () => openIdentityEdit('description', meta.description ?? '', descEl, toasts));

  // (The old quick text-links — new element / open writing / import — were
  // removed S255v3: the room nav + onboarding tiles cover every one of them.)

  // Cast slot (D2b) — renders only when a favorite is set; assignment lives
  // on the element-detail header (char + loc).
  const cast = buildCastSlot(worldId);
  if (cast) cover.appendChild(cast);

  // The woven stat line (replaces the count-card grid + the meta chips).
  // ALWAYS rendered — empty at zero elements, with a reserved min-height, so
  // the first element's "1 character" doesn't shift everything below (S265).
  {
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
  const assigning = getState().ui.castAssign?.kind === spec.kind;
  ghost.className = 'atlas-home-cast-card atlas-home-cast-ghost'
    + (assigning ? ' atlas-home-cast-assigning' : '');
  ghost.title = spec.ghostTitle;
  // Quiet by default (S265: the "shows here on the cover" line was noise);
  // in assignment mode the role line becomes the instruction. The line is
  // ALWAYS rendered (nbsp when idle) so the card never changes height and
  // the layout never shifts on click.
  ghost.innerHTML = `
    <span class="material-symbols-outlined atlas-home-cast-icon">${spec.icon}</span>
    <span class="atlas-home-cast-text">
      <span class="atlas-home-cast-name">${spec.ghostName}</span>
      <span class="atlas-home-cast-role">${assigning ? 'in the left sidebar' : ' '}</span>
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
    if (favId && !el && elements.length > 0) {
      // Stale favorite: the element was deleted (locally or via pull) and the
      // registry id dangles. Self-heal lazily — every delete path lands on a
      // home render eventually, and the loading guard above means an absent
      // element is genuinely absent, not not-yet-loaded. Deferred: patching
      // registry mid-render is the recursive-render class (conv #112).
      const staleKind = spec.kind;
      queueMicrotask(() => {
        const next = setWorldFavoriteElement(getState().registry, worldId, staleKind, null);
        saveRegistry(next);
        patchSlice('registry', next);
      });
    }
    if (el) {
      slot.appendChild(buildCastCard(el, spec, worldId));
      rendered++;
    } else if (elements.some(e => e.type === spec.elementType)) {
      // Ghost only when the world HAS candidates of that type.
      slot.appendChild(buildCastGhost(spec));
      rendered++;
    }
  }
  // Always return the slot — empty it reserves its row via CSS min-height, so
  // the first character/location's ghost doesn't shift the page below (S265,
  // Captain: "the cards jumped down").
  void rendered;
  return slot;
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
  // Verbs are plain (S264, Captain: "Continue editing" implied a prior
  // session that may not exist — "Edit X" is always true).
  const continueRows: { icon: string; verb: string; el: Element; hash: string }[] = [];
  if (lastWriting) continueRows.push({ icon: 'edit_note', verb: 'Write', el: lastWriting, hash: writingHash(worldId, lastWriting.id) });
  if (lastMap) continueRows.push({ icon: 'map', verb: 'Map', el: lastMap, hash: mapHash(worldId, lastMap.id) });
  if (lastEdited) continueRows.push({ icon: ELEMENT_ICONS[lastEdited.type] ?? 'category', verb: 'Edit', el: lastEdited, hash: roomOf(lastEdited, worldId).hash });

  // The remaining recent elements join the SAME list in the SAME row style
  // (S265, Captain's sshot: the old element rows beside the verb rows read as
  // two competing designs under one heading). The verb comes from the room
  // the row opens — Write for tree narratives, Map for maps, Edit otherwise —
  // so every row speaks the identical language.
  const continueIds = new Set(continueRows.map(r => r.el.id));
  for (const el of byRecency.filter(e => !continueIds.has(e.id)).slice(0, 5)) {
    const room = roomOf(el, worldId);
    const verb = room.label === 'writing' ? 'Write' : room.label === 'map' ? 'Map' : 'Edit';
    continueRows.push({ icon: ELEMENT_ICONS[el.type] ?? 'category', verb, el, hash: room.hash });
  }

  // The first element gets a standing highlight (S264): with exactly one
  // content element, its row IS the tour's next step — make it unmissable.
  const firstElement = content.length === 1 ? content[0] : null;

  if (continueRows.length > 0) {
    const section = document.createElement('section');
    section.className = 'atlas-home-continue';
    const title = document.createElement('h2');
    title.className = 'atlas-home-section-title';
    title.textContent = 'Recent';
    section.appendChild(title);
    for (const row of continueRows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isFirst = firstElement != null && row.el.id === firstElement.id;
      btn.className = 'atlas-home-continue-row' + (isFirst ? ' atlas-home-first-element' : '');
      btn.innerHTML = `
        <span class="material-symbols-outlined">${row.icon}</span>
        <span class="atlas-home-continue-verb">${row.verb}</span>
        <span class="atlas-home-continue-name">${escapeText(row.el.name || '(unnamed)')}</span>
        <span class="atlas-home-continue-kind">${escapeText(row.el.type)}</span>
        <span class="atlas-home-continue-time">${isFirst ? 'your first element · click to keep shaping it' : relativeTime(row.el.local_updated_at)}</span>
      `;
      btn.addEventListener('click', () => openDeskTarget(row.el, row.hash));
      section.appendChild(btn);
    }
    desk.appendChild(section);
  }

  return desk.childElementCount > 0 ? desk : null;
}

// ---- The home tour (S264 — tutorial-state cards) -----------------------------

/** The room CTA's click target. The map room is a map TAB — resolve the first
 *  map element at click time. */
function tourRoomHash(entry: TourWaveEntry, worldId: string): string | null {
  switch (entry.room) {
    case 'timeline': return timelineHash(worldId);
    case 'writing': return writingHash(worldId);
    case 'knowledge': return knowledgeHash(worldId);
    case 'share': return shareHash(worldId);
    case 'import': return importHash(worldId);
    case 'map': {
      const map = getState().data.elements.find(e => e.type === 'map');
      return map ? mapHash(worldId, map.id) : null;
    }
  }
}

function persistDismiss(worldId: string, cardId: string): void {
  const next = dismissTourCard(getState().registry, worldId, cardId);
  saveRegistry(next);
  patchSlice('registry', next);
}

function buildTour(
  counts: Map<string, number>,
  totalElements: number,
  worldId: string,
  toasts: ToastManager,
): HTMLElement | null {
  const reg = getState().registry.worlds.find(w => w.id === worldId);
  const dismissed = new Set(reg?.tour_dismissed ?? []);
  const cards = computeTourCards(counts, dismissed);
  if (cards.length === 0) return null;

  const corePhase = cards.some(c => c.kind === 'create' && c.highlighted);
  const section = document.createElement('section');
  section.className = 'atlas-home-onboarding';
  if (totalElements === 0) {
    section.innerHTML = `
      <h2 class="atlas-home-section-title">Your world is empty</h2>
      <p class="atlas-home-onboarding-copy">Create something new.</p>
    `;
  } else if (corePhase) {
    section.innerHTML = `<p class="atlas-home-onboarding-copy">Every world starts with someone, somewhere.</p>`;
  } else {
    section.innerHTML = `<p class="atlas-home-onboarding-copy atlas-home-tour-label">build your world and explore atlas rooms</p>`;
  }

  const grid = document.createElement('div');
  grid.className = 'atlas-home-onboarding-grid';
  section.appendChild(grid);

  const attachDismiss = (tile: HTMLElement, cardId: string): void => {
    const x = document.createElement('span');
    x.className = 'material-symbols-outlined atlas-home-tile-dismiss';
    x.setAttribute('role', 'button');
    x.title = "Don't show this again";
    x.textContent = 'close';
    x.addEventListener('click', (ev) => {
      ev.stopPropagation();
      persistDismiss(worldId, cardId);
    });
    tile.appendChild(x);
  };

  for (const card of cards) {
    if (card.kind === 'create') {
      const tile = document.createElement('button');
      tile.className = 'atlas-home-onboarding-tile'
        + (card.highlighted ? ' atlas-home-tile-core' : '');
      tile.setAttribute('data-create-type', card.type);
      tile.innerHTML = `
        <span class="material-symbols-outlined">${ELEMENT_ICONS[card.type] ?? 'category'}</span>
        <span>${escapeText(ELEMENT_LABELS[card.type]?.singular ?? card.type)}</span>
      `;
      // Stay on home (Captain, S264): the sidebar flip + the first-element
      // Recent highlight carry "where did it go" — no jarring room jump.
      tile.addEventListener('click', () =>
        new ElementCreateModal(toasts, { initialType: card.type, suppressNavigate: true }).open());
      if (card.dismissible) attachDismiss(tile, card.id);
      grid.appendChild(tile);
    } else {
      const { entry } = card;
      const tile = document.createElement('button');
      tile.className = 'atlas-home-onboarding-tile atlas-home-tile-cta';
      tile.setAttribute('data-tour-cta', entry.type);
      tile.title = `Open ${entry.verb}`;
      tile.innerHTML = `
        <span class="material-symbols-outlined">${entry.icon}</span>
        <span class="atlas-home-tile-cta-verb">${escapeText(entry.verb)}</span>
        <span class="atlas-home-tile-cta-line">${escapeText(entry.line)}</span>
      `;
      tile.addEventListener('click', () => {
        // Visiting the room completes the card's job — it doesn't come back.
        persistDismiss(worldId, card.id);
        if (entry.room === 'map') {
          // The map room is a right-pane tab — go through openMapTab so an
          // already-open background tab activates and an imageless map gets
          // the toast + divert instead of a dead click (S265).
          const map = getState().data.elements.find((e): e is WorldMap => e.type === 'map');
          if (map) openMapTab(map);
          return;
        }
        const hash = tourRoomHash(entry, worldId);
        if (hash) navigate(hash);
      });
      attachDismiss(tile, card.id);
      grid.appendChild(tile);
    }
  }

  // The "anything else" tile rides the core phase only — by the next wave the
  // sidebar + is known (it spotlights it on hover, teaching the permanent home).
  if (corePhase) {
    const anyTile = document.createElement('button');
    anyTile.className = 'atlas-home-onboarding-tile';
    anyTile.setAttribute('data-create-any', '');
    anyTile.innerHTML = `
      <span class="material-symbols-outlined">add</span>
      <span>anything else</span>
    `;
    anyTile.addEventListener('click', () => new ElementCreateModal(toasts, { suppressNavigate: true }).open());
    const sidebarCreate = (): HTMLElement | null => document.querySelector('[data-action="create-element"]');
    anyTile.addEventListener('mouseenter', () => sidebarCreate()?.classList.add('atlas-create-pulse'));
    anyTile.addEventListener('mouseleave', () => sidebarCreate()?.classList.remove('atlas-create-pulse'));
    grid.appendChild(anyTile);
  }

  // Empty world: the room links that work from element zero (Captain's ask —
  // Write, Chart, Import are the actionables on an empty world).
  if (totalElements === 0) {
    const links = document.createElement('div');
    links.className = 'atlas-home-tour-links';
    const mk = (label: string, icon: string, hash: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'atlas-home-tour-link';
      b.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span>${label}</span>`;
      b.addEventListener('click', () => navigate(hash));
      return b;
    };
    links.appendChild(mk('Write', 'menu_book', writingHash(worldId)));
    links.appendChild(mk('Chart', 'insights', timelineHash(worldId)));
    links.appendChild(mk('Import', 'import_export', importHash(worldId)));
    section.appendChild(links);
  }

  return section;
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
      // Description syncs via the world-meta step (S262); name is deliberately
      // LOCAL-ONLY (D4 — the server world name is a separate identity, see
      // settings → World), so only description triggers a push.
      if (field === 'description') requestPushIfLinked();
      toasts.info(`World ${field} saved`);
    },
  });
}
