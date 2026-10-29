/**
 * Header strip for element-detail.
 *
 * Locked at 36px (convention #41) — `.atlas-middle-header`. Composition (left → right):
 *   [type icon] [name (inline-editable)] [spacer]
 *   [writing tier badge + child-create buttons] (narratives only)
 *   [existing maps cluster] [existing pins cluster] (Locations / Zones)
 *   [+map] [+pin] (creation cluster)
 *   [sync dot] [delete]
 *
 * Self-mapping case: Map elements show a pinned-elements strip + a self-open
 * affordance in place of the existing-maps + existing-pins clusters.
 *
 * Name renames via inline edit (`startInlineNameEdit`). Pending auto-edit
 * (used by zone-create) flows through `requestInlineNameEditOnNextRender`.
 *
 * Delete confirmation lives here too (`onDelete`) because the trash button is
 * a header affordance.
 */

import { getState, patchSlice } from '../core/state';
import { worldIsViewOnly } from '../core/view-only';
import { isKnownOf } from '../sync/known-of';
import { getEditorSettings, setEditorSettings, saveRegistry, setWorldFavoriteElement } from '../registry/registry';
import {
  parseHash, navigate, homeHash, elementHash, writingHash, mapHash,
} from '../core/router';
import {
  getTierForNarrative, getWritingLabels, supertypeForTier, writingHashForNarrative,
} from './writing-helpers';
import { WritingCreateModal } from '../ui/writing-create-modal';
import type { Element, WorldMap } from '../core/types';
import { ELEMENT_ICONS, SPATIAL_TYPES } from '../core/constants';
import { typeName } from '../core/type-words';
import { getActiveStore } from '../core/active-store';
import { toastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import { WORLD_NOT_OPEN } from './element-detail-fields';
import { pickElement } from '../ui/element-picker-modal';
import { isKeptHere, isProposedHere, refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { PROPOSAL_PENDING_TITLE } from '../sync/proposal-lines';
import { getAssociatedMaps } from '../tabs/right/auto-open-map';
import { openMapTab } from '../tabs/right/map-index-tab';
import { panMapTabTo } from '../tabs/right/map-tab';
import { revealPinsOnMap } from '../tabs/right/map-tab-pins';
import { createMapDialog } from '../ui/map-create-modal';
import { getMapsSettings } from '../registry/registry';
import { escapeText } from '../core/dom-utils';
import { decideDeleteConfirm } from '../core/delete-confirm';
import { filesWhereOf } from '../core/browser-worlds';
import { buildAgentMark, buildHiddenMark, buildProposedMark } from './element-agent-mark';
import { choosable } from '../core/web-lens';
import { openWebOn } from '../ui/open-web';

/**
 * Pending "auto-edit on next render" signal. When set to an element id, the
 * very next renderHeader for that element opens its name in inline edit mode
 * with the text selected — used by zone-create to drop the user straight into
 * naming (DESIGN_MAPS work pile B3). Consumed on use.
 */
let pendingAutoEditNameForId: string | null = null;

export function requestInlineNameEditOnNextRender(elementId: string): void {
  pendingAutoEditNameForId = elementId;
}

/** The pending signal, for the page's rebuild gate: a request is an input to the next render. */
export function pendingInlineNameEdit(): string | null {
  return pendingAutoEditNameForId;
}

// ====== Public API ======

function wireRename(title: HTMLElement, el: Element): void {
  title.title = 'Click to rename';
  title.tabIndex = 0;
  title.addEventListener('click', () => startInlineNameEdit(title, el));
  title.addEventListener('keydown', (e) => {
    // Only the title itself opens edit mode (the guard editable-title.ts has
    // always had, once missing here): while the rename input is mounted
    // INSIDE this h2, its keys bubble up — without this check every Space was
    // preventDefault'ed (unable to type a space; Titus pasted names instead)
    // and Enter committed then instantly reopened the editor with the stale
    // name, so Enter "did not work".
    if (e.target !== title) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      startInlineNameEdit(title, el);
    }
  });
}

/**
 * `hiddenNote`: the page says the hidden line in a sentence under the name, so the header
 * leaves its glyph out and the name keeps its room beside a Location's map controls on a
 * phone (Seethe's read of 1.86.0, 2026-10-23). The writing workspace keeps the glyph.
 */
export function renderHeader(el: Element, opts: { hiddenNote?: boolean } = {}): HTMLElement {
  const header = document.createElement('div');
  header.className = 'atlas-middle-header';

  // Type icon — or, when element images are hidden AND this element has one,
  // a mini-thumbnail of the image. Clicking the thumbnail re-enables element
  // images (the inverse of the detail banner's ×).
  const buildTypeIcon = (): HTMLElement => {
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.textContent = ELEMENT_ICONS[el.type] ?? 'category';
    icon.title = typeName(el.type, { supertype: el.supertype });
    return icon;
  };
  const rawImageUrl = (el as Record<string, unknown>).image_url;
  const imageUrl = typeof rawImageUrl === 'string' ? rawImageUrl.trim() : '';
  const imagesHidden = !getEditorSettings(getState().registry).show_element_images;
  if (imagesHidden && /^https?:\/\//i.test(imageUrl)) {
    const thumb = document.createElement('img');
    thumb.className = 'atlas-header-icon-thumb';
    thumb.src = imageUrl;
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.title = `${typeName(el.type, { supertype: el.supertype })} · click to show element images`;
    thumb.addEventListener('click', () => {
      const next = setEditorSettings(getState().registry, { show_element_images: true });
      saveRegistry(next);
      patchSlice('registry', next);
    });
    thumb.addEventListener('error', () => thumb.replaceWith(buildTypeIcon()), { once: true });
    header.appendChild(thumb);
  } else {
    header.appendChild(buildTypeIcon());
  }

  const title = document.createElement('h2');
  title.dataset.role = 'element-name';
  title.className = 'atlas-element-name';
  title.textContent = el.name || '(unnamed)';
  // A view-only world's name is not a door (conv. 149), nor keel's stub's (conv. 155).
  const viewOnly = worldIsViewOnly() || isKnownOf(el);
  if (!viewOnly) wireRename(title, el);
  header.appendChild(title);

  // Proposed, not yet reviewed: a word, since a keeper has to see it (conv. 168).
  const proposedMark = buildProposedMark(el);
  if (proposedMark) header.appendChild(proposedMark);
  // Last changed by an agent, said quietly (#347).
  const agentMark = buildAgentMark(el);
  if (agentMark) header.appendChild(agentMark);
  // Hidden on OnlyWorlds, said the same quiet way.
  const hiddenMark = opts.hiddenNote ? null : buildHiddenMark(el);
  if (hiddenMark) header.appendChild(hiddenMark);

  // B3: if zone-create (or another flow) signalled an auto-edit for this
  // element, drop the user straight into rename mode with the placeholder
  // text selected. One-shot — clear after consumption.
  if (pendingAutoEditNameForId === el.id) {
    pendingAutoEditNameForId = null;
    queueMicrotask(() => startInlineNameEdit(title, el));
  }

  const spacer = document.createElement('div');
  spacer.className = 'atlas-middle-spacer';
  header.appendChild(spacer);

  // Writing-tier badge + child-create buttons (the header unification).
  // For narratives that belong to the writing tree, show a small tier pill
  // (Book / Chapter / Scene / Draft) and the relevant "+ new child" buttons
  // here in the header — so the writing-mode editor uses the same header as
  // every other element room (no separate toolbar slot above element-detail).
  renderWritingTierActions(el, header);

  // Map/pin affordances cluster (DESIGN_MAPS.md §3.5). Replaces the M7
  // inline body widget. Visual ordering left → right:
  //   - For Locations: [map][map] | [pin][pin] | [+map] [+pin] [sync] [trash]
  //   - For others:                  [pin][pin] | [+pin]        [sync] [trash]
  // The clusters render only when they have items. Empty Locations still
  // get [+map] so the affordance to start is always visible.
  renderMapPinClusters(el, header);

  // Cast-favorite assignment (D2b): characters can be the world's
  // protagonist, locations its home. Renders on the home cover's cast slot.
  const favBtn = buildFavoriteAction(el);
  if (favBtn) header.appendChild(favBtn);

  // Read this lens (#841's P3): the Web reads the world through it, the phone's drawer included.
  const worldIdForLens = getState().active?.worldId;
  if (worldIdForLens && choosable(el)) {
    const readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.className = 'atlas-btn-ghost atlas-header-read-lens';
    readBtn.setAttribute('data-action', 'read-lens');
    readBtn.title = 'Show the world as this lens reads it, on the Web';
    readBtn.textContent = 'Read this lens';
    readBtn.addEventListener('click', () => openWebOn(worldIdForLens, el.id, { lens: el.id }));
    header.appendChild(readBtn);
  }

  // Per-element save/sync indicator. Local-only world = always "saved"
  // (synchronous disk write). Api-linked + local stamp > server stamp =
  // pending push (autosave debounce will fire soon).
  header.appendChild(buildSyncDot(el));

  // A view-only world offers no Delete: the store would refuse it after the
  // confirm.
  if (!viewOnly) {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'atlas-icon-btn-sm danger';
    delBtn.setAttribute('data-action', 'delete-element');
    delBtn.title = 'Delete element';
    delBtn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
    delBtn.addEventListener('click', () => onDelete(el));
    header.appendChild(delBtn);
  }

  return header;
}

// ====== Inline name edit ======

/**
 * Replace the name h2 in-place with an editable input. Enter commits, Escape
 * reverts, blur commits. Click-outside fires blur via the browser. The next
 * render will rebuild the h2 from `el.name` post-commit.
 *
 * One-field exception to the schema-driven popover pattern (B2). Name is
 * universally the primary identity field; making it edit-in-place removes a
 * click without disrupting the popover for everything else.
 */
/**
 * Is someone typing in a text control inside `root`? A render that replaces
 * a focused input removes it, Chromium fires `blur` on the removal, and the
 * blur COMMITS: a name saved half-typed ("Strahd von"), and
 * the inline field editors the same way. Every surface
 * that rebuilds on a background tick asks this first and defers the rebuild
 * until focus leaves (the commit re-renders anyway). Same rule as
 * editable-title's sync().
 */
export function isEditingIn(root: ParentNode): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !root.contains(active)) return false;
  return active.matches('input, textarea') || active.isContentEditable;
}

/**
 * "Retry now" on a failed rename: writes the same name again, but only
 * while the element still carries the name it had before, so a later rename
 * is never written over.
 */
async function retryRename(elementId: string, original: string, next: string): Promise<void> {
  const store = getActiveStore();
  if (!store) { toastManager.error(WORLD_NOT_OPEN); return; }
  const current = getState().data.elements.find(e => e.id === elementId);
  if (!current || (current.name || '') !== original) return;
  try {
    await store.updateElement(elementId, { name: next });
    await refreshElementsAfterWrite(store);
  } catch (err) {
    console.error('[element-detail] rename retry failed:', err);
    showProblem(err, { doing: 'renaming this element' });
  }
}

function startInlineNameEdit(host: HTMLElement, el: Element): void {
  if (host.querySelector('input')) return; // already editing

  const original = el.name || '';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'atlas-element-name-input';
  input.value = original;
  input.setAttribute('aria-label', 'Rename');

  host.innerHTML = '';
  host.appendChild(input);

  // Two-phase setup so the browser computes layout before focus + select.
  queueMicrotask(() => {
    input.focus();
    input.select();
  });

  let reverting = false;
  let committed = false;

  const commit = async () => {
    if (committed) return;
    committed = true;
    const next = input.value.trim();
    // Empty rename is a no-op rather than an unnamed element.
    if (!next || next === original) {
      host.textContent = original || '(unnamed)';
      return;
    }
    const store = getActiveStore();
    if (!store) {
      host.textContent = original || '(unnamed)';
      toastManager.error(WORLD_NOT_OPEN);
      return;
    }
    try {
      await store.updateElement(el.id, { name: next });
      const updated = await refreshElementsAfterWrite(store);
      // Re-render naturally repaints the header with the new name. Don't
      // overwrite host.textContent here — the subscribe will fire and the
      // full header rebuilds.
    } catch (err) {
      console.error('[element-detail] inline rename failed:', err);
      host.textContent = original || '(unnamed)';
      showProblem(err, { doing: 'renaming this element', retry: () => retryRename(el.id, original, next) });
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur(); // triggers commit via the blur listener
    } else if (e.key === 'Escape') {
      e.preventDefault();
      reverting = true;
      input.blur();
    }
  });
  // Ctrl/Cmd+S also commits — same effect as Enter, but routed through the
  // shared save-request event so the global hotkey works while the input
  // is focused.
  const saveRequestHandler = () => { input.blur(); };
  document.addEventListener('atlas:save-request', saveRequestHandler);
  input.addEventListener('blur', () => {
    document.removeEventListener('atlas:save-request', saveRequestHandler);
    if (reverting) {
      host.textContent = original || '(unnamed)';
      return;
    }
    void commit();
  });
}

// ====== Cast favorite (D2b) ======

/**
 * The protagonist / home assignment toggle. Characters → 'protagonist',
 * locations → 'nexus' (shown to users as "home"). Stored on the registry
 * entry (atlas-local); the home cover renders whoever holds the slot.
 */
function buildFavoriteAction(el: Element): HTMLElement | null {
  if (el.type !== 'character' && el.type !== 'location') return null;
  const worldId = getState().active?.worldId;
  if (!worldId) return null;
  const kind = el.type === 'character' ? 'protagonist' : 'nexus';
  const label = kind === 'protagonist' ? 'protagonist' : 'home';
  const icon = kind === 'protagonist' ? 'person_pin' : 'home_pin';
  const favorites = getState().registry.worlds.find(w => w.id === worldId)?.favorites;
  const currentId = kind === 'protagonist' ? favorites?.protagonist_id : favorites?.nexus_id;
  const isSet = currentId === el.id;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-icon-btn-sm atlas-header-favorite' + (isSet ? ' active' : '');
  btn.setAttribute('data-action', 'set-cast-favorite');
  btn.title = isSet
    ? `This is the world's ${label} · click to unset`
    : `Set as the world's ${label} (shows on the home page)`;
  btn.innerHTML = `<span class="material-symbols-outlined">${icon}</span>`;
  btn.addEventListener('click', () => {
    const next = setWorldFavoriteElement(getState().registry, worldId, kind, isSet ? null : el.id);
    saveRegistry(next);
    patchSlice('registry', next);
    toastManager.info(isSet
      ? `No longer the world's ${label}`
      : `${el.name || 'This element'} is now the world's ${label}`);
  });
  return btn;
}

// ====== Sync dot ======

function buildSyncDot(el: Element): HTMLElement {
  const dot = document.createElement('span');
  dot.className = 'atlas-element-sync-dot';
  dot.setAttribute('data-role', 'element-sync-dot');
  const activeId = getState().active?.worldId;
  const worldEntry = activeId
    ? getState().registry.worlds.find((w) => w.id === activeId)
    : undefined;
  const isApi = worldEntry?.state === 'api-linked';
  let icon: string;
  let title: string;
  let state: 'local' | 'synced' | 'dirty';
  if (!isApi) {
    icon = 'save';
    title = filesWhereOf(worldEntry) === 'browser' ? 'Saved in this browser' : 'Saved to folder';
    state = 'local';
  } else {
    const localStamp = el.local_updated_at ?? '';
    const serverStamp = el.server_updated_at ?? '';
    const dirty = !serverStamp || localStamp > serverStamp;
    if (activeId && isProposedHere(activeId, el.id)) {
      // keel holds this edit as a proposal for the world's keeper (conv. 163).
      icon = 'rate_review';
      title = PROPOSAL_PENDING_TITLE;
      state = 'dirty';
    } else if (activeId && isKeptHere(activeId, el.id)) {
      // Kept outside this key's view (conv. 151): it no longer syncs, edited or not.
      icon = 'cloud_off';
      title = 'Kept here: OnlyWorlds no longer shows this to you, so it no longer syncs';
      state = 'local';
    } else if (dirty) {
      icon = 'cloud_upload';
      title = 'Pending sync; autosave will push within a few seconds';
      state = 'dirty';
    } else {
      icon = 'cloud_done';
      title = 'Synced';
      state = 'synced';
    }
  }
  dot.dataset.state = state;
  dot.title = title;
  dot.innerHTML = `<span class="material-symbols-outlined">${icon}</span>`;
  return dot;
}

// ====== Writing tier badge + child create ======

/**
 * Render the writing-tier badge + "+ new child" buttons for narratives that
 * belong to the writing tree. No-op for non-writing elements. Defines the
 * tier-specific child-create rules:
 *   l1 (Book)    → + Chapter, + Draft
 *   l2 (Chapter) → + Scene, + Draft
 *   l3 (Scene)   → none (leaf — write inside it)
 *   l4 (Draft)   → none (drafts stand alone; no nesting)
 */
function renderWritingTierActions(el: Element, header: HTMLElement): void {
  if (el.type !== 'narrative') return;
  const active = getState().active;
  if (!active) return;
  const tier = getTierForNarrative(el, active.worldId);
  if (!tier) return;
  const labels = getWritingLabels(active.worldId);
  const tierLabel =
    tier === 'l1' ? labels.l1
    : tier === 'l2' ? labels.l2
    : tier === 'l3' ? labels.l3
    : labels.l4;

  const cluster = document.createElement('div');
  cluster.className = 'atlas-header-cluster atlas-header-writing';

  // The tier badge ("Book"/"Chapter" pill) was dropped (Titus): the
  // sidebar tree already names the tier, and the label diluted the create
  // buttons it sat beside. tierLabel still drives the button tooltips below.
  void tierLabel;

  const childTiers: Array<'l1' | 'l2' | 'l3' | 'l4'> = [];
  if (tier === 'l1') childTiers.push('l2', 'l4');
  else if (tier === 'l2') childTiers.push('l3', 'l4');
  // l3 + l4: no child creation; nor a view-only world (conv. 149).
  if (worldIsViewOnly()) childTiers.length = 0;

  for (const childTier of childTiers) {
    const childLabel = labels[childTier];
    // Icon-only buttons matching the existing header affordance style
    // (.atlas-icon-btn-sm) — same dimensions as the pin / delete buttons,
    // so the cluster lays out predictably with no overlap risk. The tier
    // pill on the left labels the current tier; tooltip on the button
    // names the child action.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-icon-btn-sm atlas-header-writing-create';
    btn.title = `New ${childLabel.toLowerCase()}`;
    const iconName = childTier === 'l4' ? 'edit_note' : 'add';
    btn.innerHTML = `<span class="material-symbols-outlined">${iconName}</span>`;
    btn.addEventListener('click', () => openWritingChildCreate(el, childTier, active.worldId));
    cluster.appendChild(btn);
  }

  header.appendChild(cluster);
}

/**
 * The writing tree's "+ new child" dialog for a narrative: the header's own
 * buttons, and the guide's Add a chapter, open the same one.
 */
export function openWritingChildCreate(el: Element, childTier: 'l1' | 'l2' | 'l3' | 'l4', worldId: string): void {
  const childLabel = getWritingLabels(worldId)[childTier];
  new WritingCreateModal({
    label: childLabel,
    parentId: el.id,
    onCreate: async (name) => {
      const store = getActiveStore();
      if (!store) return;
      const supertype = supertypeForTier(childTier, worldId);
      // Find next order under this parent.
      const siblings = getState().data.elements.filter(
        e => e.type === 'narrative' && (e as Element & { parent_narrative?: string }).parent_narrative === el.id,
      );
      let maxOrder = -1;
      for (const s of siblings) {
        const o = (s as Element & { order?: number }).order ?? 0;
        if (o > maxOrder) maxOrder = o;
      }
      const created = await store.createElement('narrative', {
        name,
        supertype,
        parent_narrative: el.id,
        order: maxOrder + 1,
      } as Partial<Element>);
      const all = await refreshElementsAfterWrite(store);
      // Navigate to the created narrative — stay in the current room.
      const currentRoute = parseHash(window.location.hash);
      if (currentRoute.mode === 'writing') {
        navigate(writingHashForNarrative(worldId, created.id, all));
      } else {
        navigate(elementHash(worldId, created.id));
      }
      toastManager.info(`${childLabel} created`);
    },
  }).open();
}

// ====== Map / Pin clusters (DESIGN_MAPS.md §3.5) ======

/**
 * Append the map/pin affordance clusters to the element-detail header. For
 * Locations: existing-maps cluster, existing-pins cluster, [+map] button,
 * [+pin] button. For non-Locations: existing-pins cluster, [+pin] button.
 * Dividers render only between non-empty clusters.
 */
function renderMapPinClusters(el: Element, header: HTMLElement): void {
  const state = getState();
  const elements = state.data.elements;
  const mapsSettings = getMapsSettings(state.registry);
  const showMapNames = mapsSettings.show_map_names_in_header;
  const showPinMapNames = mapsSettings.show_pin_map_names_in_header;
  const isLocation = el.type === 'location';
  const isMap = el.type === 'map';
  const isZone = el.type === 'zone';

  // Map detail gets a different cluster: a strip of category icons, one per
  // element pinned on this map, PLUS a single "open this map in a tab"
  // affordance. Click any pinned icon → navigate to that element while
  // keeping the map open in the right pane (via chained URL). Click the
  // open-tab icon → open this map's right-pane tab (or focus if already
  // open). DESIGN_MAPS.md §3.5 — Map case.
  if (isMap) {
    renderMapPinnedElementStrip(el, elements, header, mapsSettings.show_pinned_element_names_in_header);
    header.appendChild(buildSelfOpenMapAffordance(el as WorldMap));
    return;
  }

  // Pin / marker detail (Titus): surface the MAP this artifact lives on,
  // clickable to open (and pan to it). Before this a pin's own page showed no
  // way to reach its map. Pins and markers are spatial artifacts, not pin
  // TARGETS, so they get no existing-pins cluster and — critically — no +pin
  // button (you cannot pin a pin); we render the one affordance that matters
  // and return.
  if (el.type === 'pin' || el.type === 'marker') {
    const rec = el as Record<string, unknown>;
    const mapId = typeof rec.map_id === 'string' ? rec.map_id : undefined;
    const m = mapId ? elements.find((e): e is WorldMap => e.type === 'map' && e.id === mapId) : undefined;
    if (m) {
      const cluster = document.createElement('div');
      cluster.className = 'atlas-header-cluster atlas-header-existing';
      const x = typeof rec.x === 'number' ? rec.x : undefined;
      const y = typeof rec.y === 'number' ? rec.y : undefined;
      cluster.appendChild(buildOpenMapButton(m, el.id, x, y));
      header.appendChild(cluster);
    }
    return;
  }

  // Existing maps anchored to / hosting this element.
  //   - Location → maps with map.location === el.id
  //   - Zone     → distinct maps that hold any marker for this zone
  //   - other    → none here (their pins handle "where it is")
  const associatedMaps = (isLocation || isZone) ? getAssociatedMaps(el.id, elements) : [];
  // Existing pins targeting this element. Includes Locations too — a
  // Location can have pins (e.g. a city's flag pinned on a continent map).
  // Zones cannot be pin targets (DESIGN_MAPS.md §1.4) so they skip pins.
  const pinsForElement = isZone ? [] : elements.filter(
    (e): e is Element & { map_id: string; element_id: string; x: number; y: number } =>
      e.type === 'pin' && (e as { element_id?: string }).element_id === el.id,
  );

  const hasMaps = associatedMaps.length > 0;
  const hasPins = pinsForElement.length > 0;

  if (hasMaps || hasPins) {
    const cluster = document.createElement('div');
    cluster.className = 'atlas-header-cluster atlas-header-existing';

    if (hasMaps) {
      // Imageless maps render LEFT, has-image maps RIGHT. Reading
      // left-to-right, the eye lands on the bright cyan "ready to view"
      // ones last. Imageless ones group as muted background — present
      // for completeness but visually subordinate.
      const sortedMaps = [...associatedMaps].sort((a, b) => {
        const aHas = !!(a.image_url || a.image_media_id);
        const bHas = !!(b.image_url || b.image_media_id);
        if (aHas === bHas) return 0;
        return aHas ? 1 : -1; // imageless first
      });
      for (const m of sortedMaps) {
        cluster.appendChild(
          buildMapAffordance(m, showMapNames, el.id, isZone ? el.id : undefined),
        );
      }
    }

    if (hasMaps && hasPins) {
      cluster.appendChild(buildClusterDivider());
    }

    if (hasPins) {
      for (const pin of pinsForElement) {
        cluster.appendChild(buildPinAffordance(pin, elements, el.id, showPinMapNames));
      }
    }

    header.appendChild(cluster);
  }

  // Create buttons cluster — [+map] for Locations, [+pin] always (gated on
  // active map tab same as before).
  const createCluster = document.createElement('div');
  createCluster.className = 'atlas-header-cluster atlas-header-create';

  // A view-only world creates nothing: no +map, no +pin (conv. 149); nor does keel's stub's page (conv. 155).
  const viewOnly = worldIsViewOnly() || isKnownOf(el);
  if (isLocation && !viewOnly) {
    const addMapBtn = document.createElement('button');
    addMapBtn.type = 'button';
    addMapBtn.className = 'atlas-icon-btn-sm atlas-header-add-glyph';
    addMapBtn.setAttribute('data-action', 'add-map');
    addMapBtn.title = `Create a new map of ${el.name || 'this location'}`;
    // Two-glyph composition reads as "add map" — small + plus the action
    // glyph. Same shape as [+pin]; the two read as a coherent pair.
    addMapBtn.innerHTML =
      '<span class="material-symbols-outlined atlas-add-glyph-plus">add</span>' +
      '<span class="material-symbols-outlined atlas-add-glyph-main">map</span>';
    addMapBtn.addEventListener('click', async () => {
      const suggestedName = `Map of ${el.name || 'this location'}`;
      await createMapDialog(toastManager, {
        initialName: suggestedName,
        initialLocationId: el.id,
      });
    });
    createCluster.appendChild(addMapBtn);
  }

  // [+pin] retains its existing gating: only renders when a map tab is
  // active in the right pane. Without an active map there's nowhere to
  // drop the pin.
  const ui = state.ui;
  const active = ui.rightTabs[ui.rightActiveIndex];
  const activeMapId = active && active.kind === 'map' ? active.mapId : null;
  // Only PINNABLE elements get +pin: content types (incl. locations), never
  // spatial artifacts (maps/pins/markers/zones — they are not pin targets;
  // zones are constructed via markers, DESIGN_MAPS §1.4), and never once this
  // element already has a pin on the ACTIVE map. Double-pin is blocked at the
  // store (uniqueness is per element+map), so a second +pin would only error —
  // hiding it is the honest affordance (Titus). pinsForElement holds
  // this element's pins across every map.
  const alreadyPinnedHere = !!activeMapId
    && pinsForElement.some(p => (p as Record<string, unknown>).map_id === activeMapId);
  if (activeMapId && !SPATIAL_TYPES.has(el.type) && !alreadyPinnedHere && !viewOnly) {
    const placing = ui.pinPlacement?.elementId === el.id;
    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'atlas-icon-btn-sm atlas-header-add-glyph' + (placing ? ' active' : '');
    pinBtn.setAttribute('data-action', 'pin-element');
    pinBtn.title = placing ? 'Cancel pin placement' : 'Place pin on active map';
    // Two-glyph composition matches `[+map]` — small `add` + the action
    // glyph (push_pin). Reads "+pin" at a glance, parallel to "+map".
    pinBtn.innerHTML =
      '<span class="material-symbols-outlined atlas-add-glyph-plus">add</span>' +
      '<span class="material-symbols-outlined atlas-add-glyph-main">push_pin</span>';
    pinBtn.addEventListener('click', () => {
      const placement = getState().ui.pinPlacement;
      if (placement?.elementId === el.id) {
        patchSlice('ui', { ...getState().ui, pinPlacement: null });
      } else {
        patchSlice('ui', { ...getState().ui, pinPlacement: { elementId: el.id } });
        toastManager.info('Click on the map to place the pin');
      }
    });
    createCluster.appendChild(pinBtn);
  }

  if (createCluster.children.length > 0) {
    header.appendChild(createCluster);
  }
}

function buildClusterDivider(): HTMLElement {
  const div = document.createElement('span');
  div.className = 'atlas-header-cluster-divider';
  div.setAttribute('aria-hidden', 'true');
  return div;
}

/**
 * Render the strip of pinned-element category icons in a Map element's top
 * bar. First N visible; if more exist, a `+K more` chip opens an element
 * picker filtered to the remaining pinned-element ids.
 *
 * Clicking a single icon navigates to that element via the chained map URL
 * — keeps the current Map tab open in the right pane.
 */
function renderMapPinnedElementStrip(
  mapEl: Element,
  elements: readonly Element[],
  header: HTMLElement,
  showElementNames: boolean,
): void {
  const VISIBLE_CAP = 12;
  // Pins belonging to this map.
  const pinsOnMap = elements.filter(
    (e): e is Element & { map_id: string; element_id: string } =>
      e.type === 'pin' && (e as Record<string, unknown>).map_id === mapEl.id,
  );
  if (pinsOnMap.length === 0) return;
  // Dedupe element ids — multiple pins for the same element collapse to one
  // strip entry.
  const seenIds = new Set<string>();
  const uniqElementIds: string[] = [];
  for (const p of pinsOnMap) {
    if (seenIds.has(p.element_id)) continue;
    seenIds.add(p.element_id);
    uniqElementIds.push(p.element_id);
  }
  // Resolve to Element objects, drop any that no longer exist (broken pins).
  const pinnedEls: Element[] = [];
  for (const id of uniqElementIds) {
    const el = elements.find(e => e.id === id);
    if (el) pinnedEls.push(el);
  }
  if (pinnedEls.length === 0) return;
  pinnedEls.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  const cluster = document.createElement('div');
  cluster.className = 'atlas-header-cluster atlas-header-map-pinned-strip';

  const visible = pinnedEls.slice(0, VISIBLE_CAP);
  const overflow = pinnedEls.slice(VISIBLE_CAP);

  for (const pinnedEl of visible) {
    cluster.appendChild(buildPinnedElementIcon(mapEl, pinnedEl, showElementNames));
  }

  if (overflow.length > 0) {
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'atlas-icon-btn-sm atlas-header-pinned-more';
    moreBtn.setAttribute('data-action', 'pinned-more');
    moreBtn.title = `${overflow.length} more pinned element${overflow.length === 1 ? '' : 's'} · click to search all`;
    moreBtn.textContent = `+${overflow.length}`;
    moreBtn.addEventListener('click', async () => {
      // Picker filtered to the remaining ids. User can search by name +
      // filter by type; click any row → navigate to that element + keep
      // the map open via chained URL.
      const picked = await pickElement({
        title: `Pinned on ${mapEl.name || '(this map)'}`,
        restrictToIds: pinnedEls.map(e => e.id),
      });
      if (!picked) return;
      navigateToPinnedElement(mapEl, picked);
    });
    cluster.appendChild(moreBtn);
  }

  header.appendChild(cluster);
}

function buildPinnedElementIcon(mapEl: Element, pinnedEl: Element, showName: boolean): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-icon-btn-sm atlas-header-pinned-icon';
  btn.setAttribute('data-action', 'goto-pinned-element');
  btn.setAttribute('data-element-id', pinnedEl.id);
  btn.title = `${pinnedEl.name || '(unnamed)'} (${typeName(pinnedEl.type, { supertype: pinnedEl.supertype })})`;
  const iconHtml = `<span class="material-symbols-outlined">${ELEMENT_ICONS[pinnedEl.type] ?? 'category'}</span>`;
  if (showName) {
    btn.innerHTML = `${iconHtml}<span class="atlas-header-map-label">${escapeText(pinnedEl.name || '(unnamed)')}</span>`;
    // Reuse the labeled-affordance CSS pattern so width grows past the
    // 22×22 fixed square. atlas-header-map-affordance-labeled is the
    // semantic name but its rules apply equally here.
    btn.classList.add('atlas-header-map-affordance-labeled');
  } else {
    btn.innerHTML = iconHtml;
  }
  btn.addEventListener('click', () => navigateToPinnedElement(mapEl, pinnedEl));
  return btn;
}

function navigateToPinnedElement(mapEl: Element, pinnedEl: Element): void {
  const worldId = getState().active?.worldId;
  if (!worldId) return;
  // Chained URL: open the map AND select the pinned element. Keeps the map
  // open in the right pane while the middle flips to the pinned element.
  patchSlice('ui', { ...getState().ui, selectedElementId: pinnedEl.id });
  navigate(mapHash(worldId, mapEl.id, pinnedEl.id));
  // Also pan+zoom the map tab to one of this element's pins on this map.
  // Same zoom-and-center logic as the element-detail top-bar [pin] click,
  // so the user lands inside the pin's neighborhood rather than at the
  // tab's wide default view. Use the first pin found — multi-pin elements
  // on the same map are uncommon and "first match" is a reasonable default.
  const elements = getState().data.elements;
  const pin = elements.find(
    (e): e is Element & { map_id: string; element_id: string; x: number; y: number } =>
      e.type === 'pin'
      && (e as Record<string, unknown>).map_id === mapEl.id
      && (e as Record<string, unknown>).element_id === pinnedEl.id,
  );
  if (pin) {
    // A located pin shows, whatever the map's date.
    revealPinsOnMap(mapEl.id, pinnedEl.id);
    panMapTabTo(mapEl.id, pin.x, pin.y);
  }
}

/**
 * Self-open affordance for Map elements: a single icon button in the
 * map-detail top bar that opens (or focuses) this map's right-pane tab.
 * Distinct from the location-Map affordance: this one is for the map
 * element viewing its own detail.
 */
function buildSelfOpenMapAffordance(m: WorldMap): HTMLElement {
  const cluster = document.createElement('div');
  cluster.className = 'atlas-header-cluster atlas-header-create';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-icon-btn-sm atlas-header-map-affordance';
  btn.setAttribute('data-action', 'open-self-map');
  const hasImage = !!(m.image_url || m.image_media_id);
  if (hasImage) btn.classList.add('atlas-map-tree-icon-has-image');
  btn.title = 'Open this map in the right pane';
  btn.innerHTML = '<span class="material-symbols-outlined">map</span>';
  btn.addEventListener('click', () => openMapTab(m));
  cluster.appendChild(btn);
  return cluster;
}

function buildMapAffordance(
  m: WorldMap,
  showName: boolean,
  sourceElementId: string,
  panToZoneId?: string,
): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-icon-btn-sm atlas-header-map-affordance';
  btn.setAttribute('data-action', 'open-map');
  btn.setAttribute('data-map-id', m.id);
  const hasImage = !!(m.image_url || m.image_media_id);
  if (hasImage) btn.classList.add('atlas-map-tree-icon-has-image');
  const titleSuffix = panToZoneId ? ' (will pan to zone)' : '';
  btn.title = `Open map: ${m.name || '(unnamed)'}${titleSuffix}`;
  const iconHtml = '<span class="material-symbols-outlined">map</span>';
  if (showName) {
    btn.innerHTML = `${iconHtml}<span class="atlas-header-map-label">${escapeText(m.name || '(unnamed)')}</span>`;
    btn.classList.add('atlas-header-map-affordance-labeled');
  } else {
    btn.innerHTML = iconHtml;
  }
  // Preserve the current element selection in the URL so the middle pane
  // doesn't drop into the welcome-stat panel when the map opens. The
  // chained `/map/<mid>/element/<eid>` route keeps element-detail mounted.
  btn.addEventListener('click', () => {
    openMapTab(m, sourceElementId);
    // Zone case: pan to the zone's centroid (average of its markers on
    // this map). Titus's request: clicking a zone's map
    // icon should center-view the zone.
    if (panToZoneId) {
      const state = getState();
      const zoneMarkers = state.data.elements.filter(
        (e): e is import('../core/types').Marker =>
          e.type === 'marker' &&
          (e as import('../core/types').Marker).zone_id === panToZoneId &&
          (e as import('../core/types').Marker).map_id === m.id,
      );
      if (zoneMarkers.length > 0) {
        const cx = Math.round(
          zoneMarkers.reduce((s, mk) => s + mk.x, 0) / zoneMarkers.length,
        );
        const cy = Math.round(
          zoneMarkers.reduce((s, mk) => s + mk.y, 0) / zoneMarkers.length,
        );
        panMapTabTo(m.id, cx, cy);
      }
    }
  });
  return btn;
}

/**
 * "Open the map this pin/marker lives on" — used on a pin/marker's OWN detail
 * page. Opens the map in the right pane, chains the artifact's id so the
 * middle pane keeps element-detail mounted, and pans to the artifact's point.
 */
function buildOpenMapButton(
  m: WorldMap,
  sourceElementId: string,
  x?: number,
  y?: number,
): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-icon-btn-sm atlas-header-map-affordance atlas-header-map-affordance-labeled';
  if (m.image_url || m.image_media_id) btn.classList.add('atlas-map-tree-icon-has-image');
  btn.setAttribute('data-action', 'open-map');
  btn.setAttribute('data-map-id', m.id);
  btn.title = `Open map: ${m.name || '(unnamed)'}`;
  btn.innerHTML =
    '<span class="material-symbols-outlined">map</span>'
    + `<span class="atlas-header-map-label">${escapeText(m.name || '(unnamed)')}</span>`;
  btn.addEventListener('click', () => {
    openMapTab(m, sourceElementId);
    if (typeof x === 'number' && typeof y === 'number') panMapTabTo(m.id, x, y);
  });
  return btn;
}

function buildPinAffordance(
  pin: Element & { map_id: string; element_id: string; x: number; y: number },
  elements: readonly Element[],
  sourceElementId: string,
  showMapName: boolean,
): HTMLElement {
  const m = elements.find((e): e is WorldMap => e.type === 'map' && e.id === pin.map_id);
  const mapName = m?.name || '(unknown map)';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-icon-btn-sm atlas-header-pin-affordance';
  btn.setAttribute('data-action', 'goto-pin');
  btn.setAttribute('data-pin-id', pin.id);
  // Surface the right-click affordance in the tooltip — symmetric with
  // the drag-to-trash on the map canvas and the right-click-ghost prune.
  btn.title = worldIsViewOnly()
    ? `Pin on ${mapName} · click to open and center`
    : `Pin on ${mapName} · click to open and center, right-click to delete pin`;
  const iconHtml = '<span class="material-symbols-outlined">push_pin</span>';
  if (showMapName) {
    btn.innerHTML = `${iconHtml}<span class="atlas-header-map-label">${escapeText(mapName)}</span>`;
    btn.classList.add('atlas-header-map-affordance-labeled');
  } else {
    btn.innerHTML = iconHtml;
  }
  btn.addEventListener('click', () => {
    if (!m) return;
    // Open the map tab in the right pane. In writing mode, don't navigate
    // the URL — keep the user in writing. In other rooms, navigate to the
    // chained map+element URL so element selection is preserved.
    const currentRoute = parseHash(window.location.hash);
    const inWriting = currentRoute.mode === 'writing';
    if (inWriting) {
      openMapTab(m);
    } else {
      openMapTab(m, sourceElementId);
    }
    // panMapTabTo waits on entry.ready, so a freshly opened tab settles
    // before the camera moves. The pin shows whatever the map's date.
    if (pin.element_id) revealPinsOnMap(pin.map_id, pin.element_id);
    panMapTabTo(pin.map_id, pin.x, pin.y);
  });
  if (!worldIsViewOnly()) btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    void deletePinFromHeader(pin.id, mapName);
  });
  return btn;
}

/**
 * Delete a pin via the element-detail header's right-click affordance.
 * Symmetric with the drag-to-trash flow on the map canvas — same store
 * call, same autosave path. No confirmation modal: the action is mild
 * (re-place the pin if you change your mind) and a modal here would
 * dilute the gesture's lightness.
 */
async function deletePinFromHeader(pinId: string, mapName: string): Promise<void> {
  const store = getActiveStore();
  if (!store) return;
  try {
    await store.deletePin(pinId);
    const elements = await refreshElementsAfterWrite(store);
    toastManager.success(`Pin on ${mapName} deleted`);
  } catch (err) {
    console.error('[element-detail] deletePinFromHeader failed:', err);
    showProblem(err, { doing: 'deleting the pin' });
  }
}

// ====== Delete (the trash button in the header) ======

async function onDelete(el: Element): Promise<void> {
  const store = getActiveStore();
  if (!store) return;
  // Confirmation is gated by the Editing setting (default on) — EXCEPT when the
  // delete cascades, which always confirms. See `decideDeleteConfirm`:
  // the setting says "before deleting an element", singular, so a delete that
  // destroys a whole subtree was never inside its opt-out, and atlas has no
  // undo. Verified live: a Book delete with the preference off silently
  // destroyed 8 of 9 elements.
  //
  // Dependents are fetched UNCONDITIONALLY now (they used to be fetched only
  // inside the preference branch) because the cascade is what decides whether
  // we ask at all.
  let dependents: Element[] = [];
  let dependentsUnknown = false;
  try {
    dependents = await store.findDependents(el.id);
  } catch (probeErr) {
    // A failed probe must not BLOCK the delete, but it must not be read as
    // "nothing depends on this" either: an empty list switches off the
    // cascade confirm floor, so a thrown probe used to make a subtree delete
    // silent whenever the confirm preference was off.
    console.error('[element-detail-header] dependents probe failed', probeErr);
    dependentsUnknown = true;
  }
  const decision = decideDeleteConfirm({
    el,
    dependents,
    dependentsUnknown,
    allElements: getState().data.elements,
    labels: getWritingLabels(getState().active?.worldId ?? ''),
    confirmPref: getEditorSettings(getState().registry).confirm_before_delete,
  });
  if (decision.needed && !window.confirm(decision.message)) return;
  try {
    await store.deleteElement(el.id);
    const elements = await store.listElements();
    patchSlice('data', { elements });
    // Deleting a MAP has to take its right-pane tab with it (Titus):
    // the tab survived the delete and fell through to the stale card reading
    // "Map from another world", which is both wrong (it was this world's) and
    // unclosable-looking. Land on the map index instead — the room that lists
    // what is left — rather than an arbitrary neighbour.
    const uiNow = getState().ui;
    let nextUi = { ...uiNow, selectedElementId: null };
    if (el.type === 'map') {
      const doomed = uiNow.rightTabs.findIndex(t => t.kind === 'map' && t.mapId === el.id);
      if (doomed >= 0) {
        const rightTabs = uiNow.rightTabs.filter((_, i) => i !== doomed);
        // Prefer the map index; else clamp the old index into the shorter list.
        const indexTab = rightTabs.findIndex(t => t.kind === 'map-index');
        const rightActiveIndex = uiNow.rightActiveIndex === doomed
          ? (indexTab >= 0 ? indexTab : 0)
          : Math.max(0, Math.min(
            uiNow.rightActiveIndex > doomed ? uiNow.rightActiveIndex - 1 : uiNow.rightActiveIndex,
            rightTabs.length - 1,
          ));
        nextUi = { ...nextUi, rightTabs, rightActiveIndex };
      }
    }
    patchSlice('ui', nextUi);
    // Local delete + tombstones written — schedule a push to DELETE on server.
    requestPushIfLinked();
    toastManager.success(`Deleted ${el.name || 'element'}`);
    const worldId = getState().active?.worldId;
    if (worldId) {
      // If the delete happened from the writing room, stay there — drop the
      // narrative selection but keep the user in writing. Otherwise, go to
      // the world home as before.
      const currentRoute = parseHash(window.location.hash);
      if (currentRoute.mode === 'writing') {
        navigate(writingHash(worldId));
      } else {
        navigate(homeHash(worldId));
      }
    }
  } catch (err) {
    console.error('[element-detail] delete failed:', err);
    showProblem(err, { doing: 'deleting this element' });
  }
}
