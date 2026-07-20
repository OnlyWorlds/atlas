/**
 * Middle pane — element detail view (Bout B: schema-driven editor).
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
import { onHashChange, parseHash } from '../core/router';
import type { Element } from '../core/types';
import { getEditorSettings, setEditorSettings, saveRegistry } from '../registry/registry';
import { toastManager } from '../ui/toast-manager';
import { sectionsFor } from '../editor/field-schema';
import { isTourFlagActive } from '../tour/tour-flag';
import { buildZoneSections } from './element-detail-zone-sections';
import { buildCustomFieldsSection } from './element-detail-custom-fields';
import { buildMapLocalImageRow } from './element-detail-map-image';
import { renderReferencedBy } from './element-detail-refs';
import { buildWarRecordSection } from './element-detail-war-record';
import { renderSection } from './element-detail-fields';
import { renderHeader } from './element-detail-header';
import { renderElementImage } from '../ui/element-image';
import { escapeText } from '../core/dom-utils';

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

  function render(): void {
    captureScrollBeforeRender();
    target.innerHTML = '';
    const state = getState();
    const route = parseHash(window.location.hash);
    const el = getSelectedElement();

    if (!state.active) {
      target.innerHTML = `<div class="atlas-pane-empty">No active world.</div>`;
      return;
    }
    if (!el) {
      const msg = route.elementId
        ? `Element <code>${escapeText(route.elementId)}</code> not found in this world.`
        : 'No element selected. Pick one from the <b>elements</b> sidebar.';
      target.innerHTML = `<div class="atlas-pane-empty">${msg}</div>`;
      return;
    }
    renderDetail(el);
  }

  function renderDetail(el: Element): void {
    target.appendChild(renderHeader(el));

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
    body.appendChild(detail);

    // The element's image, above the field sections — gated on the
    // show_element_images setting. The banner's × flips the setting OFF in
    // place; the header's type icon becomes a clickable thumbnail that flips
    // it back ON (session 239).
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
        hide.title = 'Hide element images';
        hide.textContent = '×';
        hide.addEventListener('click', () => {
          const next = setEditorSettings(getState().registry, { show_element_images: false });
          saveRegistry(next);
          patchSlice('registry', next);
          toastManager.info('Element images hidden. Click the type icon (or Settings → Editing) to show them again');
        });
        wrap.appendChild(hide);
        detail.appendChild(wrap);
      }
    }

    // The element NAME is the header's click-to-edit title (convention #80) — so
    // drop the duplicate "Name" field from the schema-rendered Base section (F1).
    let sections = sectionsFor(el.type)
      .map(section => ({ ...section, fields: section.fields.filter(f => f.name !== 'name') }))
      .filter(section => section.fields.length > 0);
    // During the tour, all-empty sections HIDE (not collapse — the Freek
    // round, S299): a beginner's first element pages show only sections that
    // carry content. If nothing is populated, the first section stays so the
    // page never renders fieldless.
    if (isTourFlagActive()) {
      const rec = el as Record<string, unknown>;
      const populated = (name: string) => {
        const v = rec[name];
        if (v === null || v === undefined) return false;
        if (typeof v === 'string') return v.trim().length > 0;
        if (Array.isArray(v)) return v.length > 0;
        return true;
      };
      const kept = sections.filter(s => s.fields.some(f => populated(f.name)));
      sections = kept.length > 0 ? kept : sections.slice(0, 1);
    }
    sections.forEach((section, idx) => {
      const sectionEl = renderSection(section, el, idx === 0);
      if (sectionEl) detail.appendChild(sectionEl);
    });

    // Map-specific: the "Local image" row, directly under the image_url row
    // (folder-stored file as map background; session 253).
    if (el.type === 'map') {
      const row = buildMapLocalImageRow(el as import('../core/types').WorldMap, toastManager);
      const urlRow = detail.querySelector('[data-field="image_url"]');
      if (urlRow) urlRow.insertAdjacentElement('afterend', row);
      else detail.querySelector('.atlas-detail-section-body')?.appendChild(row);
    }

    // Zone-specific sections (visuals + markers) — DESIGN_ZONES.md §4.4.
    if (el.type === 'zone') {
      for (const node of buildZoneSections(el as import('../core/types').Zone, toastManager)) {
        detail.appendChild(node);
      }
    }

    // Custom fields (D9): user-defined x_/shadow_ extension fields — render
    // what's there, let the user add more. Always present (the add row is
    // the feature's discoverability).
    detail.appendChild(buildCustomFieldsSection(el));

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


  // ====== Footer ======

  function renderFooter(el: Element): HTMLElement {
    const meta = document.createElement('div');
    meta.className = 'atlas-detail-meta';
    const updated = el.local_updated_at ? new Date(el.local_updated_at).toLocaleString() : '—';
    const synced = el.server_updated_at ? new Date(el.server_updated_at).toLocaleString() : 'Not synced';
    meta.innerHTML = `
      <div>ID: <code>${escapeText(el.id)}</code></div>
      <div>Updated locally: ${escapeText(updated)}</div>
      <div>Server: ${escapeText(synced)}</div>
    `;
    return meta;
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();
  return () => { unsubState(); unsubHash(); };
}


