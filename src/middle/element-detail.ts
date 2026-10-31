/**
 * Middle pane — element detail view (schema-driven editor).
 *
 * Reads schema sections from `field-schema.ts` (SDK FIELD_SCHEMA + ELEMENT_SECTIONS).
 * Each field renders by widget:
 *   - text-short / text-long / number → click value → popover edit
 *   - single-link → chip + pick button (opens picker modal)
 *   - multi-link → chips + add button
 *
 * Reads element data from `state.data.elements` (cached from FolderStore).
 * Writes go through `FolderStore.updateElement` then refresh the cache with
 * a new array reference (force-rerender; convention #2).
 *
 * "Referenced By" section at the bottom: scans `data.elements` for any
 * element whose fields point back at this element's id — SDK-shape-agnostic
 * (scan all array fields whose items have `id` + all scalar id-like fields).
 */

import { getState, subscribe, patchSlice } from '../core/state';
import { worldIsViewOnly } from '../core/view-only';
import { isKnownOf } from '../sync/known-of';
import { onHashChange, parseHash, worldHash } from '../core/router';
import type { Element } from '../core/types';
import { getEditorSettings, setEditorSettings, saveRegistry } from '../registry/registry';
import { toastManager } from '../ui/toast-manager';
import { sectionsFor } from '../editor/field-schema';
import { isTourFlagActive } from '../tour/tour-flag';
import { buildZoneSections } from './element-detail-zone-sections';
import { buildCustomFieldsSection, pendingCustomFieldEdit } from './element-detail-custom-fields';
import { buildMapLocalImageRow } from './element-detail-map-image';
import { buildMapStyleRow } from './element-detail-map-style';
import { buildPictureUploadRow, buildPictureLaterRow, pictureLaterWorld, pictureWorld } from './element-detail-picture';
import { buildFilesSection, filesWorld } from './element-detail-files';
import { renderReferencedBy } from './element-detail-refs';
import { buildMessageParties } from './element-detail-message';
import { buildWorkPacket } from './element-detail-packet';
import { buildWarRecordSection } from './element-detail-war-record';
import { renderSection } from './element-detail-fields';
import { filledSections, isFieldFilled } from './filled-fields';
import { renderHeader, isEditingIn, pendingInlineNameEdit } from './element-detail-header';
import { focusWaymark, waymarkHasFocus, waymarkOpenIn, waymarkSlot, type WaymarkSlot } from './waymark-slot';
import { keptSetOf } from '../sync/sync-attach';
import { renderElementImage } from '../ui/element-image';
import { renderGate } from '../ui/render-gate';
import { escapeText, relativeTime } from '../core/dom-utils';
import { proposedNoteFor } from './element-agent-mark';
import { hiddenMarkLine } from '../core/hidden-mark';
import { doorTrail, type TrailStep } from '../core/door-trail';
import { buildCharterMarkOffer } from './element-detail-charter-mark';
import { buildPageStrandOffer } from './strand-offer';

/**
 * Per-element scroll position memory. Survives re-renders (field edits, link
 * toggles, picker resolves all cause re-renders that would otherwise reset
 * scroll to 0) and back-navigation (A → B → back to A returns to A's saved
 * scrollTop).
 *
 * Key = element id. Cleared lazily on world switch via `resetElementDetailScrollMemory()`.
 * See atlas-deprecated/src/middle/element-detail.ts and craft #104 for rationale.
 */
const scrollMemory = new Map<string, number>();

/** Drop scroll memory — call on world switch so stale ids don't accumulate. */
export function resetElementDetailScrollMemory(): void {
  scrollMemory.clear();
}

/** Re-export from header so callers (zone-create) can still import from here. */
export { requestInlineNameEditOnNextRender } from './element-detail-header';

export function mountElementDetail(target: HTMLElement): () => void {
  target.innerHTML = '';

  function getSelectedElement(): Element | null {
    const state = getState();
    const route = parseHash(window.location.hash);
    // Writing room derives its active element from the URL hierarchy
    // (book/chapter/scene), NOT from state.ui.selectedElementId — that lets
    // the global selection persist across writing-room visits (the room-nav
    // chip keeps pointing at whatever was selected before you opened
    // writing). Without this branch, writing.ts would have to mirror the
    // active narrative into selectedElementId on every navigation, which
    // clobbers the user's prior selection.
    const writingId = route.mode === 'writing'
      ? (route.narrativeId ?? null)
      : null;
    const id = writingId ?? route.elementId ?? state.ui.selectedElementId;
    if (!id) return null;
    return state.data.elements.find(e => e.id === id) ?? null;
  }

  /**
   * Capture the current body's scrollTop BEFORE we wipe target.innerHTML.
   * Without this, every re-render (field edit, link toggle) would lose the
   * scroll position before the live listener has a chance to save it.
   */
  function captureScrollBeforeRender(): void {
    const prevBody = target.querySelector<HTMLElement>('.atlas-middle-body');
    if (!prevBody) return;
    const prevId = prevBody.dataset.elementId;
    if (prevId && prevBody.scrollTop > 0) {
      scrollMemory.set(prevId, prevBody.scrollTop);
    }
  }

  // A background tick (a sync publish, a list refresh) during an inline rename or field edit
  // is deferred, not dropped: it runs once focus leaves the input, after the
  // blur has read the value it commits.
  let renderDeferred = false;
  const onFocusOut = (e?: FocusEvent): void => {
    if (!renderDeferred) return;
    // Focus leaving the mark's fan-out is the press that closes it: the slot runs the redraw once that press lands.
    if (e?.target instanceof HTMLElement && e.target.closest('.ow-waymark')) return;
    renderDeferred = false;
    queueMicrotask(render);
  };
  target.addEventListener('focusout', onFocusOut);
  // The OnlyWorlds mark beside the name: held open, a redraw waits for its fan-out to close (Waymark R7).
  let mark: WaymarkSlot | null = null;
  let markHadFocus = false;
  let drawnHash = '';
  const dropMark = (): void => { mark?.dispose(); mark = null; };

  // Rebuilt only when an input moved (conv. 146): a rebuild between a
  // press and its release loses the click, and the page subscribes to every
  // store patch (each sync step patches `sync`, which nothing here reads).
  // The parts are every slice the page and its builders read, the route, the
  // tour's two switches and the two pending edit requests.
  const gate = renderGate();

  function render(): void {
    // An open fan-out holds a redraw, but never a route change: the page follows the address.
    if (isEditingIn(target) || (waymarkOpenIn(target) && window.location.hash === drawnHash)) { renderDeferred = true; return; }
    drawnHash = window.location.hash;
    const s = getState();
    const touring = isTourFlagActive();
    if (!gate.changed([window.location.hash, s.active, s.data, s.ui, s.registry, s.styles, touring,
      touring && document.body.classList.contains('atlas-tour-basefull'),
      pendingInlineNameEdit(), pendingCustomFieldEdit(), s.active ? keptSetOf(s.active.worldId) : undefined])) return;
    captureScrollBeforeRender();
    markHadFocus = waymarkHasFocus(mark);
    dropMark();
    target.innerHTML = '';
    const state = getState();
    const route = parseHash(window.location.hash);
    const el = getSelectedElement();

    if (!state.active) {
      target.innerHTML = `<div class="atlas-pane-empty">No world open. Pick one from the sidebar.</div>`;
      return;
    }
    if (!el) {
      // THE INSTRUCTION HAS TO BE TRUE. "Pick one from the elements
      // sidebar" was false on an EMPTY world: that list deliberately renders
      // nothing (the pulsing + and the home tiles carry the
      // teaching), so this pane sent people to a blank pane. Two correct
      // decisions, one lie where they met.
      const isEmptyWorld = getState().data.elements.length === 0;
      const worldId = state.active.worldId;
      const msg = route.elementId
        ? 'This element is not in this world.'
        : isEmptyWorld
          ? 'This world has no elements yet. Create the first one with the <b>+</b> above the element list.'
          : 'No element selected. Pick one from the <b>elements</b> sidebar.';
      // A not-found id used to be a text cul-de-sac with no way out. The share
      // room already solves this with a drill-in back affordance; this is the
      // same move.
      const back = route.elementId
        ? `<div class="atlas-pane-empty-action"><a href="${escapeText(worldHash(worldId))}">Back to ${escapeText(state.active.meta.name || 'this world')}</a></div>`
        : '';
      target.innerHTML = `<div class="atlas-pane-empty">${msg}${back}</div>`;
      return;
    }
    renderDetail(el);
  }

  function renderDetail(el: Element): void {
    const header = renderHeader(el, { hiddenNote: true });
    target.appendChild(header);
    // The mark sits after the name, never inside it (the name is click-to-rename); mounted here, not in
    // renderHeader, which the writing workspace shares.
    const name = header.querySelector('[data-role="element-name"]');
    const worldId = getState().active?.worldId;
    if (name && worldId) {
      mark = waymarkSlot(worldId, el, onFocusOut);
      name.after(mark.el);
      // A redraw held while the fan-out was open runs as it closes: focus stays on the mark it came back to.
      if (markHadFocus) focusWaymark(mark);
      markHadFocus = false;
    }

    const body = document.createElement('div');
    body.className = 'atlas-middle-body';
    body.dataset.elementId = el.id;
    target.appendChild(body);

    // Live-track scroll position so even partial scrolls survive re-renders.
    body.addEventListener(
      'scroll',
      () => { scrollMemory.set(el.id, body.scrollTop); },
      { passive: true }
    );

    const detail = document.createElement('div');
    detail.className = 'atlas-detail';

    // Proposed, not yet reviewed (conv. 168): said in a sentence under the name, not only
    // in the header word's label (Seethe's read of 1.84.0, 2026-10-23).
    const proposed = proposedNoteFor(el);
    if (proposed) {
      const note = document.createElement('p');
      note.className = 'atlas-proposed-note';
      note.dataset.role = 'proposed-note';
      note.textContent = proposed;
      detail.appendChild(note);
    }
    // Hidden (conv. 170): said in a sentence under the name too, so a hidden-only page has
    // more than a glyph (Seethe's read of 1.86.0, 2026-10-23); the header leaves the glyph out.
    const st = getState();
    const hiddenLine = hiddenMarkLine(el, st.registry.worlds.find(w => w.id === st.active?.worldId)?.state);
    if (hiddenLine) {
      const note = document.createElement('p');
      note.className = 'atlas-hidden-note';
      note.dataset.role = 'hidden-note';
      note.textContent = hiddenLine;
      detail.appendChild(note);
    }
    // An unmarked Charter: the keeper's one write that makes it the world's (the charter profile, 1.100).
    const activeId = st.active?.worldId;
    if (activeId) {
      const offer = buildCharterMarkOffer(el, st.registry.worlds.find(w => w.id === activeId), st.active?.meta, activeId, st.data.elements);
      if (offer) detail.appendChild(offer);
      // A story Narrative: the keeper's Make this the world's strand, or the line that it is (S7).
      const strand = buildPageStrandOffer(el, activeId);
      if (strand) detail.appendChild(strand);
    }
    body.appendChild(detail);

    // The element's image, above the field sections — gated on the
    // show_element_images setting. The banner's × flips the setting OFF in
    // place; the header's type icon becomes a clickable thumbnail that flips
    // it back ON.
    if (getEditorSettings(getState().registry).show_element_images) {
      const image = renderElementImage(el, 'banner');
      if (image) {
        const wrap = document.createElement('div');
        wrap.className = 'atlas-element-image-wrap';
        wrap.appendChild(image);
        image.addEventListener('error', () => wrap.remove(), { once: true });
        const hide = document.createElement('button');
        hide.type = 'button';
        hide.className = 'atlas-element-image-hide';
        // An eye, not a ×: it hides every element's picture (a view setting), and a × read as
        // "remove this picture" (Seethe's phone pass, 2026-10-14).
        hide.title = 'Hide element images';
        hide.setAttribute('aria-label', 'Hide element images');
        const glyph = document.createElement('span');
        glyph.className = 'material-symbols-outlined';
        glyph.textContent = 'visibility_off';
        hide.appendChild(glyph);
        hide.addEventListener('click', () => {
          const next = setEditorSettings(getState().registry, { show_element_images: false });
          saveRegistry(next);
          patchSlice('registry', next);
          toastManager.info('Element images hidden. Click the type icon (or Settings → Elements) to show them again');
        });
        wrap.appendChild(hide);
        detail.appendChild(wrap);
      }
    }

    // A message says who it is from and to, above its text (#526).
    const parties = buildMessageParties(el);
    if (parties) detail.appendChild(parties);

    // A Work item's packet: its elements and reasons, stepped through with the packet bar.
    const packet = buildWorkPacket(el);
    if (packet) detail.appendChild(packet);

    // keel's stub (conv. 155, I6): the name, the picture and the description, a line
    // saying it is known of, and the fields keel shares on it (PR 117) as read-only
    // rows. Its other fields are unknown, not empty, so they never show, toggle or not.
    if (isKnownOf(el)) {
      const note = document.createElement('p');
      note.className = 'atlas-known-of-note';
      note.dataset.role = 'known-of';
      const named = typeof el.name === 'string' && el.name.trim() ? el.name.trim() : 'this one';
      note.textContent = `Known of: you know only what anyone could see of ${named}.`;
      detail.appendChild(note);
      const description = typeof el.description === 'string' ? el.description.trim() : '';
      if (description) {
        const text = document.createElement('p');
        text.className = 'atlas-known-of-description';
        text.textContent = description;
        detail.appendChild(text);
      }
      // Only filled rows, never filledSections' fallback of a whole first section.
      const shown = new Set(['name', 'description', 'image_url']);
      const shared = sectionsFor(el.type)
        .map(section => ({ ...section, fields: section.fields.filter(f => !shown.has(f.name) && isFieldFilled(el, f.name)) }))
        .filter(section => section.fields.length > 0);
      for (const section of shared) {
        const sectionEl = renderSection(section, el, false);
        if (sectionEl) detail.appendChild(sectionEl);
      }
      const knownRefs = renderReferencedBy(el);
      if (knownRefs) detail.appendChild(knownRefs);
      detail.appendChild(renderFooter(el));
      return;
    }

    // The element NAME is the header's click-to-edit title (convention #80) — so
    // drop the duplicate "Name" field from the schema-rendered Base section.
    let sections = sectionsFor(el.type)
      .map(section => ({ ...section, fields: section.fields.filter(f => f.name !== 'name') }))
      .filter(section => section.fields.length > 0);
    // During the tour, all-empty sections HIDE (not collapse — a tester's
    // round): a beginner's first element pages show only sections that
    // carry content. If nothing is populated, the first section stays so the
    // page never renders fieldless.
    // Then (Titus): empty FIELDS hide too, not just empty sections — a
    // beginner's element pages show only rows that carry content. A later
    // refinement (Titus): Base shows its FULL field set only on the
    // consul step, where the copy teaches "a set of shared base fields" —
    // the tour-bar stamps `atlas-tour-basefull` for exactly that step.
    // Every later step hides Base's empty rows like any other section.
    // Outside the tour the same rule is the "Hide empty fields" setting (#24).
    const touring = isTourFlagActive();
    const hideEmpty = touring || getEditorSettings(getState().registry).hide_empty_fields;
    let hiddenCount = 0;
    const allFieldCount = sections.reduce((n, s) => n + s.fields.length, 0);
    if (hideEmpty) {
      const baseFull = touring && document.body.classList.contains('atlas-tour-basefull');
      const filled = filledSections(sections, el, { keepFirstWhole: baseFull });
      sections = filled.sections;
      hiddenCount = filled.hidden;
    }
    sections.forEach((section) => {
      // Base collapses like every other section (Titus — it was the
      // one hardcoded always-expanded section, in tour and tool alike).
      const sectionEl = renderSection(section, el, false);
      if (sectionEl) detail.appendChild(sectionEl);
    });
    // The setting's own switch, where the rows are (#24). Not in the tour.
    if (!touring) {
      const emptyCount = hideEmpty ? hiddenCount
        : sections.reduce((n, s) => n + s.fields.filter(f => !isFieldFilled(el, f.name)).length, 0);
      if (emptyCount > 0) detail.appendChild(buildEmptyFieldsToggle(hideEmpty, emptyCount));
    }

    // Map-specific: the "Local image" row, directly under the image_url row
    // (folder-stored file as map background).
    if (el.type === 'map') {
      // A view-only world keeps no picture of its own in a folder (conv. 149).
      const row = worldIsViewOnly() ? null : buildMapLocalImageRow(el as import('../core/types').WorldMap, toastManager);
      const urlRow = detail.querySelector('[data-field="image_url"]');
      if (row && urlRow) urlRow.insertAdjacentElement('afterend', row);
      else if (row) detail.querySelector('.atlas-detail-section-body')?.appendChild(row);
      // "Map style" goes under the Background colour it can stand in for.
      const styleRow = buildMapStyleRow(el as import('../core/types').WorldMap, toastManager);
      const bgRow = detail.querySelector('[data-field="background_color"]');
      if (bgRow) bgRow.insertAdjacentElement('afterend', styleRow);
      else if (row) row.insertAdjacentElement('afterend', styleRow);
      else detail.querySelector('.atlas-detail-section-body')?.appendChild(styleRow);
    }

    // "Upload picture" (#154): under the image_url row, only in an online
    // world this browser can write to (a local world has no host for it).
    // A local world says when it could (#282), with Make online at hand: a
    // word about the image URL row, so it shows only where that row does
    // (Hide empty fields hides an empty one, and the word with it).
    const pictureEntry = pictureWorld();
    if (!isTourFlagActive()) {
      const urlRow = detail.querySelector('[data-field="image_url"]');
      if (pictureEntry) {
        const row = buildPictureUploadRow(el, pictureEntry, toastManager);
        if (urlRow) urlRow.insertAdjacentElement('afterend', row);
        else detail.querySelector('.atlas-detail-section-body')?.appendChild(row);
      } else if (urlRow && pictureLaterWorld()) {
        urlRow.insertAdjacentElement('afterend', buildPictureLaterRow(toastManager));
      }
    }

    // Zone-specific sections (visuals + markers) — DESIGN_ZONES.md §4.4.
    if (el.type === 'zone') {
      for (const node of buildZoneSections(el as import('../core/types').Zone, toastManager)) {
        detail.appendChild(node);
      }
    }

    // Custom fields (D9): user-defined x_/shadow_ extension fields — render
    // what's there, let the user add more. Always present (the add row is
    // the feature's discoverability) — EXCEPT during the tour: a beginner's
    // first pages should not offer schema extension (precision audit #2,
    // Titus-blessed 2026-07-20). A view-only world shows only the rows it has.
    const customFields = isTourFlagActive() ? null : buildCustomFieldsSection(el);
    if (customFields) detail.appendChild(customFields);

    // Files: kept on OnlyWorlds with the element, so an online
    // world only. The card reads and repaints itself (element-detail-files).
    const filesEntry = filesWorld();
    if (filesEntry && !isTourFlagActive()) detail.appendChild(buildFilesSection(el, filesEntry, toastManager));

    // Character war record (2026-07-19): recorded battles as a curated strip,
    // above the exhaustive reverse-reference scan.
    const warRecord = buildWarRecordSection(el);
    if (warRecord) detail.appendChild(warRecord);

    const refs = renderReferencedBy(el);
    if (refs) detail.appendChild(refs);

    detail.appendChild(renderFooter(el));

    // Restore previous scrollTop after the body has laid out. scrollTop set on
    // an empty/unrendered body is silently dropped, hence queueMicrotask.
    const restoreTop = scrollMemory.get(el.id);
    if (typeof restoreTop === 'number' && restoreTop > 0) {
      queueMicrotask(() => { body.scrollTop = restoreTop; });
    }
  }


  /**
   * "12 empty fields hidden · Show them", or "Hide the 12 empty fields": the
   * Hide empty fields setting (#24), flipped where the rows are. The same
   * switch sits in Settings, Elements.
   */
  function buildEmptyFieldsToggle(hiding: boolean, count: number): HTMLElement {
    const line = document.createElement('div');
    line.className = 'atlas-empty-fields-toggle';
    const fields = `${count} empty field${count === 1 ? '' : 's'}`;
    if (hiding) {
      const note = document.createElement('span');
      note.textContent = `${fields} hidden`;
      line.append(note, document.createTextNode(' · '));
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-btn-ghost';
    btn.dataset.action = hiding ? 'show-empty-fields' : 'hide-empty-fields';
    btn.textContent = hiding ? (count === 1 ? 'Show it' : 'Show them')
      : count === 1 ? 'Hide the empty field' : `Hide the ${fields}`;
    btn.addEventListener('click', () => {
      const next = setEditorSettings(getState().registry, { hide_empty_fields: !hiding });
      saveRegistry(next);
      patchSlice('registry', next);
    });
    line.appendChild(btn);
    return line;
  }

  // ====== Footer ======

  function renderFooter(el: Element): HTMLElement {
    const meta = document.createElement('div');
    meta.className = 'atlas-detail-meta';
    // relativeTime: the same element read "2d ago" on home and a raw
    // locale dump here. Tooltip keeps the exact stamp; empty/invalid fall back.
    const updatedRel = relativeTime(el.local_updated_at);
    const updated = updatedRel
      ? `<span title="${escapeText(new Date(el.local_updated_at!).toLocaleString())}">${escapeText(updatedRel)}</span>`
      : '—';
    const syncedRel = relativeTime(el.server_updated_at);
    const synced = syncedRel
      ? `<span title="${escapeText(new Date(el.server_updated_at!).toLocaleString())}">${escapeText(syncedRel)}</span>`
      : 'Not synced';
    meta.innerHTML = `
      <div>ID: <code>${escapeText(el.id)}</code></div>
      <div>Updated locally: ${updated}</div>
      <div>Server: ${synced}</div>
    `;
    const trail = trailLines(el);
    if (trail) meta.append(...trail);
    return meta;
  }

  /**
   * Where it has been on OnlyWorlds (#760): the newest door, then the rest. A synced world
   * only, as the agent mark: a folder can carry keel's fields from another time. An element
   * with no baseline is not on OnlyWorlds yet (never sent, or its baseline cleared), whatever
   * old fields it carries. A keel stub says nothing of the element's own writes.
   */
  function trailLines(el: Element): HTMLElement[] | null {
    const state = getState();
    const entry = state.registry.worlds.find(w => w.id === state.active?.worldId);
    if (entry?.state !== 'api-linked' || !el.server_updated_at || isKnownOf(el)) return null;
    const steps = doorTrail(el);
    if (steps.length === 0) return null;
    const step = (s: TrailStep) => {
      const when = relativeTime(s.at);
      return when
        ? `${escapeText(s.where)}, <span title="${escapeText(new Date(s.at).toLocaleString())}">${escapeText(when)}</span>`
        : escapeText(s.where);
    };
    const last = document.createElement('div');
    last.dataset.role = 'door-trail';
    last.innerHTML = `On OnlyWorlds: last shaped ${step(steps[0])}`;
    if (steps.length === 1) return [last];
    const before = document.createElement('div');
    before.dataset.role = 'door-trail-before';
    before.innerHTML = `Before that: ${steps.slice(1).map(step).join(' · ')}`;
    return [last, before];
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();
  return () => {
    unsubState();
    unsubHash();
    renderDeferred = false;
    target.removeEventListener('focusout', onFocusOut);
    dropMark();
  };
}


