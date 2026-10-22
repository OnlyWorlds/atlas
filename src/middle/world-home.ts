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
import { worldIsViewOnly } from '../core/view-only';
import { buildLooseThreads } from './home-loose-threads';
import { setSidebarModePref } from '../core/ui-prefs';
import { ToastManager } from '../ui/toast-manager';
import { PlainError } from '../core/plain-error';
import {
  navigate, writingHash, elementHash, importHash, knowledgeHash, shareHash, settingsHash,
} from '../core/router';
import { ElementCreateModal } from '../ui/element-create-modal';
import { openMapTab } from '../tabs/right/map-index-tab';
import { openFieldEditPopover } from '../ui/field-edit-popover';
import { getActiveStore } from '../core/active-store';
import { requestPushIfLinked } from '../sync/sync-attach';
import { ELEMENT_ICONS } from '../core/constants';
import { typeName, aTypeName } from '../core/type-words';
import type { Element, ElementType, WorldMap } from '../core/types';
import { isWritingNarrative } from './writing-helpers';
import { escapeText, relativeTime } from '../core/dom-utils';
import { setWorldFavoriteElement, dismissTourCard, saveRegistry, updateWorldEntry } from '../registry/registry';
import { keepSafeCard, snoozeUntil } from './home-keepsafe';
import { downloadWorldFromClick } from '../ui/download-world';
import { hasFolderMode } from '../core/capabilities';
import { computeHomeCards, type CardDef, type HomeCard, type TourRoom } from './home-tour';
import { isNewcomerAnswered } from '../core/newcomer';
import { addHomeReceipts, clearHomeReceipts } from '../core/waypoints';
import { showProblem } from '../ui/problem-fixes';
import { isCodeLoadError } from '../core/reload-offer';
import { isTourFlagActive } from '../tour/tour-flag';
import { toastManager } from '../ui/toast-manager';
import { timelineHash } from '../core/router';
import { charterLead, findCharter, rosterRoles, type RosterRoles } from '../core/charter';
import { rosterFor, rosterNow } from '../sync/world-roster';
import { tableauScope } from '../visualization/timeline/chart-recipe';
import { roomOf, openElementTarget } from '../core/element-room';
import { resolveCalendarLens } from '../core/calendar-lens';
import { extractTemporalNodes } from '../visualization/timeline/data-normalizer';
import { freezeChartBlock } from '../visualization/timeline/chart-freeze';
import { renderChartView } from '../visualization/timeline/chart-static';
import type { ChartConfig } from '../visualization/timeline/types';
import { downloadLabel, isPartialSlice, partialSliceNote } from '../core/provenance';
import { currentLore, roomCount } from '../core/parlor-room';

const CONTENT_ELEMENT_TYPES: ElementType[] = [
  'character', 'location', 'institution', 'object', 'event', 'narrative',
  'family', 'collective', 'species', 'creature', 'phenomenon', 'language',
  'law', 'ability', 'trait', 'title', 'construct', 'relation', 'map',
];

// `roomOf` + the desk click-through moved to `core/element-room.ts` (S306):
// the command palette had re-implemented the jump WITHOUT them and dropped
// every room-owning element into the generic editor. Shared so the two
// surfaces cannot answer the same question differently again.

/** The desk row's verb, derived from the room the row actually opens, so the
 *  label can never promise a room the click does not go to. */
function verbFor(el: Element, worldId: string): string {
  const label = roomOf(el, worldId).label;
  // A view-only world's rooms open to read (conv. 149).
  if (worldIsViewOnly(worldId)) return label === 'writing' ? 'Read' : label === 'map' ? 'Map' : 'Open';
  return label === 'writing' ? 'Write' : label === 'map' ? 'Map' : 'Edit';
}

/** Matching icon, same rule. */
function verbIconFor(el: Element, worldId: string): string {
  const label = roomOf(el, worldId).label;
  if (label === 'writing') return 'edit_note';
  if (label === 'map') return 'map';
  return ELEMENT_ICONS[el.type] ?? 'category';
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

  // Home rebuilds only when something it draws from moved (S362): it used to
  // rebuild the cover, cast, chart strip, desk and loose threads on every
  // state notify, ~80 ms a time at Sikelia's size, for sync ticks, toasts and
  // clicks in other panes. A new input the home reads must join this list.
  let lastInputs: unknown[] | null = null;

  function render(): void {
    const s = getState();
    // The lore (core/parlor-room.ts): the world without the parlor's room while
    // it is hidden; its identity moves with the elements and with the switch.
    const lore = currentLore();
    const inputs = [s.active, s.data.elements, lore, s.data.loading, s.data.loadingProgress?.done, s.registry,
      s.ui.castAssign?.kind, savedCharts, isTourFlagActive(), waypointsVersion, rosterVersion];
    if (lastInputs && inputs.every((v, i) => v === lastInputs![i])) return;
    lastInputs = inputs;
    const active = s.active;
    if (!active) {
      root.innerHTML = '<div class="atlas-pane-empty">No world open. Pick one from the sidebar.</div>';
      return;
    }
    const elements = lore;
    const meta = active.meta;
    const worldId = active.worldId;
    if (worldId !== receiptsWorldId) {
      clearHomeReceipts();
      receiptsWorldId = worldId;
    }

    const counts = new Map<string, number>();
    for (const el of elements) {
      if (el.type === 'pin' || el.type === 'marker' || el.type === 'zone') continue;
      counts.set(el.type, (counts.get(el.type) ?? 0) + 1);
    }
    const totalElements = Array.from(counts.values()).reduce((a, b) => a + b, 0);

    root.innerHTML = '';
    root.appendChild(buildCover(meta, worldId, totalElements, counts, toasts, charterRoles(worldId)));
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
    // The keep-safe card (1.17, contract §6.1): after the intro cards, in
    // their chrome; a world kept only in this browser asks for a copy.
    const keep = buildKeepSafe(worldId, elements, toasts);
    if (keep) root.appendChild(keep);
    if (totalElements === 0) return;
    // The chart strip (S15: the "starred chart") — the shape of the world's
    // history between the cover and the desk (timeline-mini's old slot, now
    // the real chart pipeline: first saved chart, else the recipe default).
    const chartStrip = buildChartStrip(elements, worldId, savedCharts ?? []);
    if (chartStrip) root.appendChild(chartStrip);
    const desk = buildDesk(elements, worldId);
    if (desk) root.appendChild(desk);
    // Loose threads (2026-07-24) — a quiet band of the world's cheap gaps
    // (unmapped locations, undated events, unlinked characters), each expanding
    // to the exact flagged elements. Sits at the very bottom of home (Captain's
    // placement call); renders nothing when the world is fully woven.
    const threads = buildLooseThreads(elements, worldId);
    if (threads) root.appendChild(threads);
  }

  const onChartsChanged = (): void => refreshSavedCharts();
  window.addEventListener('atlas:charts-changed', onChartsChanged);
  // The next-steps list reads the waypoints (#127): a step done anywhere
  // leaves the list the next time home draws.
  let waypointsVersion = 0;
  // The charter counts a co-builder's Law only once the roster says so (D152):
  // a synced world asks the roster once, and its answer draws Home again.
  let rosterVersion = 0;
  let rosterAsked: string | null = null;
  function charterRoles(worldId: string): RosterRoles {
    const entry = getState().registry.worlds.find(w => w.id === worldId);
    if (!entry || entry.state !== 'api-linked') return null;
    const rows = rosterNow(entry);
    if (!rows && rosterAsked !== worldId) {
      rosterAsked = worldId;
      void rosterFor(entry).then(got => { if (got) { rosterVersion++; render(); } else rosterAsked = null; });
    }
    return rosterRoles(rows);
  }
  let receiptsWorldId: string | null = null;
  const onWaypointsChanged = (): void => { waypointsVersion++; render(); };
  document.addEventListener('atlas:waypoints-changed', onWaypointsChanged);
  refreshSavedCharts();
  const unsub = subscribe(render);
  render();
  return () => {
    window.removeEventListener('atlas:charts-changed', onChartsChanged);
    document.removeEventListener('atlas:waypoints-changed', onWaypointsChanged);
    clearHomeReceipts();
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
  // The strip must SPEAK THE SAME CALENDAR as the room it previews. The freeze
  // resolves a chart's own `calendarId` strictly (correct there: a saved chart
  // must not adopt a calendar minted after it was saved), so a synthetic chart
  // with no id froze to bare numbers while the Charts room — which resolves the
  // world's active lens with `fallbackToOnly` — showed era words. Same world,
  // two answers, one screen apart, and first-run visible on any world holding
  // exactly one calendar. Resolving it here keeps "home is the zoomed-out
  // truth, the room is the same picture with controls" actually true.
  const activeCalendarId = getState().registry.worlds.find(w => w.id === worldId)?.active_calendar_id;
  const homeLens = resolveCalendarLens([...elements], activeCalendarId, { fallbackToOnly: true });
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
    ...(homeLens ? { calendarId: homeLens.id } : {}),
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
  roles: RosterRoles,
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
  // The name and an existing description read plainly there too (conv. 149).
  const viewOnly = worldIsViewOnly(worldId);
  const descriptionMarkup = meta.description
    ? viewOnly
      ? `<p class="atlas-home-world-description">${escapeText(meta.description)}</p>`
      : `<p class="atlas-home-world-description atlas-home-clickable" data-edit="description">${escapeText(meta.description)}</p>`
    : viewOnly
      ? ''
      : `<p class="atlas-home-world-description atlas-home-clickable atlas-home-placeholder" data-edit="description">Describe your world…</p>`;
  identity.innerHTML = viewOnly ? `
    <h1 class="atlas-home-world-name">${escapeText(meta.name)}</h1>
    ${descriptionMarkup}
  ` : `
    <h1 class="atlas-home-world-name atlas-home-clickable" data-edit="name" title="Click to rename (here only; the online name is in Settings)">${escapeText(meta.name)}</h1>
    ${descriptionMarkup}
  `;
  // A copy that is one Character's view, or the public one (folder spec §4.2, R1).
  const sliceNote = partialSliceNote(meta);
  if (sliceNote) identity.insertAdjacentHTML('beforeend', `<p class="atlas-home-slice-note" data-role="slice-note">${escapeText(sliceNote)}</p>`);
  // The world's charter, first (#526): its name links to it, its opening reads here.
  // world.json's `charter` names it when a folder says which (§4.6 (a)).
  const charter = findCharter(getState().data.elements, (meta as unknown as Record<string, unknown> | null | undefined)?.charter, roles);
  if (charter) {
    const lead = charterLead(charter);
    const name = typeof charter.name === 'string' && charter.name.trim() ? charter.name.trim() : 'Charter';
    identity.insertAdjacentHTML('beforeend', `
      <div class="atlas-home-charter" data-role="charter">
        <span class="atlas-home-charter-label">This world's charter</span>
        <a class="atlas-home-charter-link" href="${escapeText(elementHash(worldId, charter.id))}">${escapeText(name)}</a>
        ${lead ? `<p class="atlas-home-charter-lead">${escapeText(lead)}</p>` : ''}
      </div>`);
  }
  cover.appendChild(identity);

  const nameEl = identity.querySelector<HTMLElement>('[data-edit="name"]');
  const descEl = identity.querySelector<HTMLElement>('[data-edit="description"]');
  if (nameEl) nameEl.addEventListener('click', () => openIdentityEdit('name', meta.name, nameEl, toasts));
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
    // S316 (Captain): ordered by COUNT descending (schema order said nothing
    // about this world), ties keeping schema order; and the long tail of
    // one-of types folds into a single trailing "1 each:" segment so a rich
    // world's line leads with what the world is actually made of. The
    // grouped segment filters the sidebar to the WHOLE singleton set —
    // elementFilters is a Set, so the multi-filter comes free.
    const present = CONTENT_ELEMENT_TYPES
      .map(type => ({ type, count: counts.get(type) ?? 0 }))
      .filter(e => e.count > 0)
      .sort((a, b) => b.count - a.count);
    const singles = present.filter(e => e.count === 1);
    const grouped = singles.length >= 2;
    const listed = grouped ? present.filter(e => e.count > 1) : present;
    const filterSidebarTo = (types: ElementType[]) => {
      const ui = getState().ui;
      if (ui.sidebarMode !== 'elements') {
        patchSlice('ui', { ...ui, sidebarMode: 'elements', elementFilters: new Set(types) });
        setSidebarModePref('elements');
      } else {
        patchSlice('ui', { ...ui, elementFilters: new Set(types) });
      }
    };
    const addSep = () => {
      const sep = document.createElement('span');
      sep.className = 'atlas-home-statline-sep';
      sep.textContent = '·';
      statline.appendChild(sep);
    };
    let first = true;
    for (const { type, count } of listed) {
      if (!first) addSep();
      first = false;
      const seg = document.createElement('button');
      seg.type = 'button';
      seg.className = 'atlas-home-statline-seg';
      seg.title = `Show ${typeName(type, { many: true })} in the sidebar`;
      seg.innerHTML = `<b>${count}</b> ${escapeText(typeName(type, { many: count !== 1 }))}`;
      seg.addEventListener('click', () => filterSidebarTo([type]));
      statline.appendChild(seg);
    }
    if (grouped && singles.length > 0) {
      if (!first) addSep();
      const seg = document.createElement('button');
      seg.type = 'button';
      seg.className = 'atlas-home-statline-seg';
      seg.title = 'Show these in the sidebar';
      const names = singles.map(e => escapeText(typeName(e.type))).join(', ');
      seg.innerHTML = `<b>1</b> each: ${names}`;
      seg.addEventListener('click', () => filterSidebarTo(singles.map(e => e.type)));
      statline.appendChild(seg);
    }
    cover.appendChild(statline);
  }
  // The parlor's room (OW Parlor #543): said where the counts are, one click
  // shows it in every whole view or hides it again (the list's chip is the
  // same switch, `ui.hideRoom`).
  const room = roomCount(getState().data.elements);
  if (room > 0) {
    const hidden = getState().ui.hideRoom;
    const roomLine = document.createElement('button');
    roomLine.type = 'button';
    roomLine.className = 'atlas-home-statline-seg atlas-home-room';
    roomLine.setAttribute('data-action', 'home-room');
    roomLine.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    roomLine.title = hidden
      ? "Show the parlor's room (its messages, board entries, work items, specs, hearts, votes, sittings and member cards) in the lists, Charts and Search"
      : "Hide the parlor's room from the lists, Charts and Search";
    roomLine.innerHTML = hidden
      ? `The parlor's room, <b>${room}</b>, is hidden · Show it`
      : `The parlor's room, <b>${room}</b>, is shown · Hide it`;
    roomLine.addEventListener('click', () => {
      const ui = getState().ui;
      patchSlice('ui', { ...ui, hideRoom: !ui.hideRoom });
    });
    cover.appendChild(roomLine);
  }

  return cover;
}

/** The per-kind cast configuration — card + ghost share it. */
const CAST_KINDS = [
  {
    kind: 'protagonist' as const, role: 'protagonist', icon: 'person_pin',
    elementType: 'character' as const, ghostName: 'Choose a protagonist',
    ghostTitle: 'Open a character and click the person pin in its header to set your protagonist',
  },
  {
    kind: 'nexus' as const, role: 'home', icon: 'home_pin',
    elementType: 'location' as const, ghostName: 'Choose a home',
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
  // `hash` was dropped from the row (S306): rows now open through
  // `openElementTarget(el, worldId)`, which resolves the destination itself,
  // so a stored hash was written three times per render and read nowhere.
  const continueRows: { icon: string; verb: string; el: Element }[] = [];
  // The verb comes from `roomOf` here too, NOT from which finder matched.
  // `isWritingNarrative` tests SUPERTYPE while the knowledge/page predicates
  // test SUBTYPE, and subtype is free user text — so a narrative can be both
  // writing-shaped and subtype 'knowledge'. `roomOf` gives knowledge/page
  // precedence, so the pinned row's hardcoded "Write" could label a row that
  // opens the knowledge room (close gate, S306).
  if (lastWriting) continueRows.push({ icon: verbIconFor(lastWriting, worldId), verb: verbFor(lastWriting, worldId), el: lastWriting });
  if (lastMap) continueRows.push({ icon: 'map', verb: 'Map', el: lastMap });
  if (lastEdited) continueRows.push({ icon: ELEMENT_ICONS[lastEdited.type] ?? 'category', verb: verbFor(lastEdited, worldId), el: lastEdited });

  // The remaining recent elements join the SAME list in the SAME row style
  // (S265, Captain's sshot: the old element rows beside the verb rows read as
  // two competing designs under one heading). The verb comes from the room
  // the row opens — Write for tree narratives, Map for maps, Edit otherwise —
  // so every row speaks the identical language.
  const continueIds = new Set(continueRows.map(r => r.el.id));
  for (const el of byRecency.filter(e => !continueIds.has(e.id)).slice(0, 5)) {
    continueRows.push({ icon: ELEMENT_ICONS[el.type] ?? 'category', verb: verbFor(el, worldId), el });
  }

  // A row whose element was never touched since birth says Created, not Edit
  // ("it says edit when I only created" — Captain, 2026-07-19). Local creates
  // stamp created_at === local_updated_at from one instant; any edit breaks
  // the equality. Server-born elements carry the server's created_at, which
  // never equals a local stamp — they correctly stay on their room verb.
  for (const row of continueRows) {
    const rec = row.el as Record<string, unknown>;
    if (row.verb === 'Edit' && rec.created_at && rec.created_at === row.el.local_updated_at) {
      row.verb = 'Created';
    }
  }
  // Newest first, ALWAYS — the pinned Write/Map/Edit picks used to outrank a
  // brand-new element, which read as stale ordering on fresh worlds.
  continueRows.sort((a, b) =>
    (b.el.local_updated_at ?? '').localeCompare(a.el.local_updated_at ?? ''));

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
        <span class="atlas-home-continue-kind">${escapeText(typeName(row.el.type, { supertype: row.el.supertype }))}</span>
        <span class="atlas-home-continue-time">${isFirst ? 'your first element · click to keep shaping it' : relativeTime(row.el.local_updated_at)}</span>
      `;
      btn.addEventListener('click', () => openElementTarget(row.el, worldId));
      // Drag-onto-map (S300): recent rows carry the same payload as sidebar
      // rows, so they drop onto any open map tab as a pin. Maps/zones are
      // excluded (not pinnable — the sidebar's rule, DESIGN_MAPS.md §1.4;
      // the drop site double-checks).
      // A view-only world places no pin, so its rows do not drag (conv. 149).
      if (row.el.type !== 'map' && row.el.type !== 'zone' && !worldIsViewOnly(worldId)) {
        btn.draggable = true;
        btn.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData('application/x-atlas-element', JSON.stringify({ id: row.el.id, type: row.el.type }));
          e.dataTransfer?.setData('text/plain', row.el.id);
          e.dataTransfer!.effectAllowed = 'copy';
          btn.classList.add('atlas-row-dragging');
        });
        btn.addEventListener('dragend', () => btn.classList.remove('atlas-row-dragging'));
      }
      section.appendChild(btn);
    }
    desk.appendChild(section);
  }

  return desk.childElementCount > 0 ? desk : null;
}

// ---- The home onboarding (S264 cards; #127 the question; 1.20 cards kept, done) ----

function persistDismiss(worldId: string, cardId: string): void {
  const next = dismissTourCard(getState().registry, worldId, cardId);
  saveRegistry(next);
  patchSlice('registry', next);
}

/** The keep-safe band (contract §6.1): what `keepSafeCard` answers, with its three ways out and ×. */
function buildKeepSafe(worldId: string, elements: Element[], toasts: ToastManager): HTMLElement | null {
  const s = getState();
  const entry = s.registry.worlds.find(w => w.id === worldId);
  const card = keepSafeCard({ entry, elements, loading: !!s.data.loading, now: Date.now() });
  if (!card || !entry) return null;
  const line = card.reduced
    ? `${card.reduced === 'online' ? 'Your OnlyWorlds account holds' : 'Your JSON file holds'} this world's elements, but not its pages, aliases, notes, writing formatting, saved charts or images kept in Atlas. A download holds all of it.`
    : hasFolderMode()
      ? 'If the browser clears its storage, the world goes with it. Download a copy, or move it to a folder on your drive.'
      : 'If the browser clears its storage, the world goes with it. Download a copy you can open again anywhere.';
  const section = document.createElement('section');
  section.className = 'atlas-home-onboarding atlas-home-keepsafe';
  section.setAttribute('data-role', 'keepsafe');
  section.innerHTML = `
    <div class="atlas-home-keepsafe-head">
      <h2 class="atlas-home-section-title">${card.reduced ? 'Part of this world lives only in this browser' : 'This world lives only in this browser'}</h2>
      <button type="button" class="atlas-icon-btn-sm" data-action="keepsafe-hide" title="Hide for a week" aria-label="Hide for a week">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </div>
    <p class="atlas-home-onboarding-copy"></p>
    <div class="atlas-home-keepsafe-actions">
      <button type="button" class="atlas-btn-primary" data-action="keepsafe-download">${downloadLabel(getState().active?.meta)}</button>
      ${hasFolderMode() ? '<button type="button" class="atlas-btn-ghost" data-action="keepsafe-move">Move to a folder</button>' : ''}
      ${entry.state !== 'api-linked' && !isPartialSlice(getState().active?.meta) ? '<button type="button" class="atlas-btn-ghost" data-action="keepsafe-online">Make online</button>' : ''}
    </div>`;
  section.querySelector<HTMLElement>('.atlas-home-onboarding-copy')!.textContent = line;
  section.querySelector<HTMLButtonElement>('[data-action="keepsafe-hide"]')!.addEventListener('click', () => {
    // A gesture, never a render, sets the week (contract §6.1).
    const next = updateWorldEntry(getState().registry, worldId, { keep_nudge_snoozed_until: snoozeUntil(Date.now()) });
    saveRegistry(next);
    patchSlice('registry', next);
  });
  const download = section.querySelector<HTMLButtonElement>('[data-action="keepsafe-download"]')!;
  download.addEventListener('click', () => {
    const now = getState().registry.worlds.find(w => w.id === worldId);
    if (now) void downloadWorldFromClick(now, toasts, on => { download.disabled = on; download.textContent = on ? 'Saving…' : downloadLabel(getState().active?.meta); });
  });
  section.querySelector<HTMLButtonElement>('[data-action="keepsafe-move"]')?.addEventListener('click', async () => {
    const now = getState().registry.worlds.find(w => w.id === worldId);
    if (!now) return;
    const { MoveBrowserWorldModal } = await import('../ui/move-browser-world-modal');
    new MoveBrowserWorldModal(now, toasts).open();
  });
  section.querySelector<HTMLButtonElement>('[data-action="keepsafe-online"]')?.addEventListener('click', async () => {
    const { MakeOnlineModal } = await import('../ui/make-online-modal');
    new MakeOnlineModal(toasts).open();
  });
  return section;
}

function buildTour(
  counts: Map<string, number>,
  totalElements: number,
  worldId: string,
  toasts: ToastManager,
): HTMLElement | null {
  // While the GUIDED tour is running, the home onboarding stays silent: two
  // onboardings talking at once (the S264 intersection class). Read the
  // persisted flag directly: cheap, and no tour-engine import here.
  if (isTourFlagActive()) return null;
  const home = computeHomeCards(counts);
  if (!home) return null;

  const grid = document.createElement('div');
  grid.className = 'atlas-home-onboarding-grid';
  for (const card of home.cards) grid.appendChild(cardTile(card, worldId, toasts));

  const section = document.createElement('section');
  section.className = 'atlas-home-onboarding atlas-home-have';

  if (home.phase === 'grow') {
    const reg = getState().registry.worlds.find(w => w.id === worldId);
    if (reg?.tour_dismissed?.includes('home-cards')) return null;
    section.innerHTML = `
      <div class="atlas-home-have-head">
        <h2 class="atlas-home-have-title">Grow your world</h2>
        <button type="button" class="atlas-home-have-dismiss" data-action="cards-dismiss"
          title="Hide these for this world" aria-label="Hide these for this world"><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
      </div>
      <p class="atlas-home-have-lead">Each of these opens a room of its own.</p>
    `;
    section.appendChild(grid);
    section.querySelector('[data-action="cards-dismiss"]')!.addEventListener('click', () => persistDismiss(worldId, 'home-cards'));
    return section;
  }

  // The core phase: what the home shows here is first-world's and
  // first-element's receipt, so their toasts stay away (#127).
  addHomeReceipts(['first-world', 'first-element']);
  // "anything else" rides the core phase; hovering it pulses the sidebar +,
  // the permanent home of creating.
  const anyTile = document.createElement('button');
  anyTile.className = 'atlas-home-onboarding-tile';
  anyTile.setAttribute('data-create-any', '');
  anyTile.innerHTML = `
    <span class="material-symbols-outlined">add</span>
    <span>Anything else</span>
  `;
  anyTile.addEventListener('click', () => new ElementCreateModal(toasts, { suppressNavigate: true }).open());
  const sidebarCreate = (): HTMLElement | null => document.querySelector('[data-action="create-element"]');
  anyTile.addEventListener('mouseenter', () => sidebarCreate()?.classList.add('atlas-create-pulse'));
  anyTile.addEventListener('mouseleave', () => sidebarCreate()?.classList.remove('atlas-create-pulse'));
  grid.appendChild(anyTile);

  const row = (have: string, label: string, body: string): HTMLElement => {
    const r = document.createElement('div');
    r.className = 'atlas-home-have-row';
    r.setAttribute('data-have', have);
    r.innerHTML = `<span class="atlas-home-have-label">${label}</span><span class="atlas-home-have-line">${body}</span>`;
    section.appendChild(r);
    return r;
  };

  // A world started from a Start-page link was answered on onlyworlds.com:
  // it gets the first answer alone, under no question.
  if (isNewcomerAnswered(worldId) && totalElements === 0) {
    row('nothing', 'Start here', 'A character and a location: someone, somewhere.').appendChild(grid);
    return section;
  }

  // "What do you have?" (#127, the Captain's Q1: optional, never blocking).
  // It stays, with its finished cards checked, until the core pair exists,
  // so the block does not change shape under the first create (h20 #2081).
  section.insertAdjacentHTML('beforeend', '<h2 class="atlas-home-have-title">What do you have?</h2>');
  row('nothing', 'Nothing yet', 'Start with a character and a location.').appendChild(grid);
  const act = (action: string, label: string): string =>
    `<button type="button" class="atlas-btn-link atlas-home-have-act" data-have-action="${action}">${label}</button>`;
  // A button is one box even when inline: the closing one keeps its full
  // stop beside it, or a wrap leaves the stop alone on the next line.
  const last = (action: string, label: string): string =>
    `<span class="atlas-home-have-end">${act(action, label)}.</span>`;
  const elsewhere = row('elsewhere', 'A world somewhere else',
    `${act('bring-in', 'Bring it in')}: a world file, OnlyWorlds JSON, or notes an AI assistant converts. `
    + (hasFolderMode()
      ? `Or ${act('open-folder', 'open a world folder')} where it is, or ${last('download', 'download one from OnlyWorlds')}`
      : `Or ${last('download', 'download one from OnlyWorlds')}`));
  const looking = row('looking', 'Just looking',
    `${act('try-demo', 'Explore Moppetopia')}, a demo world you can change, or ${last('tour', 'take the tour')}`);
  elsewhere.querySelector('[data-have-action="bring-in"]')?.addEventListener('click', () => navigate(importHash(worldId)));
  elsewhere.querySelector('[data-have-action="open-folder"]')?.addEventListener('click', () => {
    void import('../setup/world-doors').then(m => m.pickAndOpenWorldFolder(toasts));
  });
  elsewhere.querySelector('[data-have-action="download"]')?.addEventListener('click', () => {
    void import('../setup/world-doors').then(m => m.runAddWorldAction('link-api', toasts));
  });
  looking.querySelector('[data-have-action="try-demo"]')?.addEventListener('click', () => {
    void import('../setup/world-doors').then(m => m.runAddWorldAction('try-demo', toasts));
  });
  const tourBtn = looking.querySelector<HTMLButtonElement>('[data-have-action="tour"]');
  tourBtn?.addEventListener('click', async () => {
    tourBtn.disabled = true;
    try {
      const engine = await import('../tour/tour-engine');
      await engine.launchTour();
    } catch (err) {
      if (!isCodeLoadError(err)) {
        console.warn('[home] tour launch failed:', err);
        showProblem(err, { doing: 'starting the tour' });
      }
      tourBtn.disabled = false;
    }
  });
  return section;
}

const ROOM_NAMES: Record<TourRoom, string> = {
  element: 'it', timeline: 'Charts', writing: 'Writing', map: 'the map', knowledge: 'Knowledge',
};

/**
 * One card. Not yet in the world: it creates one (staying on home, S264).
 * Done: it stays in place, greyed and checked, and opens the room its type
 * introduces (the Captain, h20 #2081).
 */
function cardTile(card: HomeCard, worldId: string, toasts: ToastManager): HTMLButtonElement {
  const { def, done } = card;
  const label = typeName(def.type);
  const core = def.room === 'element';
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'atlas-home-onboarding-tile'
    + (core && !done ? ' atlas-home-tile-core' : '')
    + (done ? ' atlas-home-tile-done' : '');
  tile.setAttribute(done ? 'data-done-type' : 'data-create-type', def.type);
  tile.title = done ? `Open ${ROOM_NAMES[def.room]}` : `Create ${aTypeName(def.type)}`;
  tile.innerHTML = `
    <span class="material-symbols-outlined">${ELEMENT_ICONS[def.type] ?? 'category'}</span>
    <span>${escapeText(label)}</span>
    ${core ? '' : `<span class="atlas-home-tile-line">${escapeText(def.line)}</span>`}
    ${done ? '<span class="material-symbols-outlined atlas-home-tile-check" aria-hidden="true">check_circle</span>' : ''}
  `;
  tile.addEventListener('click', () => {
    if (!done) {
      // Stay on home (Captain, S264): the sidebar flip + the first-element
      // Recent highlight carry "where did it go", no jarring room jump.
      new ElementCreateModal(toasts, { initialType: def.type, suppressNavigate: true }).open();
      return;
    }
    openCardRoom(def, worldId);
  });
  return tile;
}

function openCardRoom(def: CardDef, worldId: string): void {
  const elements = getState().data.elements;
  switch (def.room) {
    case 'element': {
      const el = elements.find(e => e.type === def.type);
      if (el) navigate(elementHash(worldId, el.id));
      return;
    }
    case 'map': {
      // The map room is a right-pane tab: openMapTab activates an open one
      // and gives an imageless map its flat canvas (S265, S300).
      const map = elements.find((e): e is WorldMap => e.type === 'map');
      if (map) openMapTab(map);
      return;
    }
    case 'timeline': navigate(timelineHash(worldId)); return;
    case 'writing': navigate(writingHash(worldId)); return;
    case 'knowledge': navigate(knowledgeHash(worldId)); return;
  }
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
    label: field === 'name' ? 'World name' : 'World description',
    value: current,
    widget: field === 'name' ? 'text-short' : 'text-long',
    onSave: async (next: unknown) => {
      const value = String(next ?? '').trim();
      // Refusals are PlainErrors: the popover shows them as they are, where a
      // plain Error would be worded as an unexpected problem (S369).
      if (field === 'name' && !value) {
        throw new PlainError('A world needs a name.');
      }
      const store = getActiveStore();
      const active = getState().active;
      if (!store || !active) {
        throw new PlainError('This world is not open. Open it from the sidebar, then try again.');
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
