/**
 * ElementCreateModal — name + type, creates via the active FolderStore.
 *
 * Layout (matches legacy):
 *   - Name field (autofocused)
 *   - Category autocomplete input with ghost-text suffix completion,
 *     plus icon grid below (20 types: all 22 except pin/marker which are
 *     placed by interacting with maps)
 *   - Tab / Right-Arrow at end of typed input accepts the ghost suggestion
 *   - Click a grid icon to set the type and fill the input
 *   - Submit → FolderStore.createElement → refresh data.elements → navigate
 *     to the new element's detail
 */

import { BaseModal } from './modal-base';
import { ToastManager } from './toast-manager';
import { getState, patchSlice } from '../core/state';
import { navigate, elementHash } from '../core/router';
import { getActiveStore } from '../core/active-store';
import { completeWaypoint } from '../core/waypoints';
import { CONTENT_ELEMENT_TYPES, type Element, type ElementType } from '../core/types';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import { requestPushIfLinked } from '../sync/sync-attach';
import { setSidebarModePref } from '../core/ui-prefs';
import { createMapDialog } from './map-create-modal';
import { findExistingNameMatch } from './element-name-match';
import { escapeAttr } from '../core/dom-utils';
import { loadUiPrefs } from '../core/ui-prefs';
import { TEMPORAL_TYPE_FIELDS } from '../visualization/timeline/temporal-fields';

/**
 * Types offered in the create modal.
 *
 * Zones are deliberately omitted: they're constructed only by placing
 * markers on a map, never as standalone elements via the create grid.
 * Marker-driven zone creation arrives with the zoner port. Pins and
 * markers are also omitted — both are placed via map interactions.
 */
const CREATE_TYPES: ElementType[] = [...CONTENT_ELEMENT_TYPES, 'map'];

export interface ElementCreateOptions {
  /** Pre-select a type (otherwise defaults to 'character'). */
  initialType?: ElementType;
  /** Pre-fill the name field. */
  initialName?: string;
  /**
   * Hide these types from the grid (and reject in matchCategory). Used by
   * the contextual right-click-on-map flow to drop 'map' — pins don't target
   * maps in atlas (DESIGN_MAPS.md §1.4).
   */
  excludeTypes?: ElementType[];
  /**
   * Called after the element is created. Receives both the new id AND the
   * resolved element type — callers like the contextual pin-drop in map-tab
   * need the type to construct a valid pin body (server requires
   * `element_type` when `element_id` is set).
   */
  onCreated?: (id: string, type: ElementType) => void;
  /**
   * Also called after a successful create, but — unlike `onCreated` — has NO
   * effect on the map inline-create delegation check. For side effects like
   * the elements-sidebar clearing its search after a prefilled create (S255v4).
   */
  afterCreate?: (id: string, type: ElementType) => void;
  /**
   * NPM mode (DESIGN_MAPS.md §3.7). When set, the name field gets ghost-line
   * autocomplete against existing elements of the currently-selected category;
   * TAB at end of input accepts the suggestion and flips the submit button
   * to `Place`, which calls `onPlaceExisting(id, type)` instead of creating a
   * new element. Multi-match tiebreaker = latest `local_updated_at`.
   */
  enablePlaceExisting?: boolean;
  /**
   * Called when the user submits a Place — drop a pin pointing at an existing
   * element. Receives the existing element's id and type.
   */
  onPlaceExisting?: (id: string, type: ElementType) => void;
  /** Override the modal title. Default: 'New element'. */
  title?: string;
  /**
   * Extra fields merged into the created element body — e.g. the knowledge
   * room's "+ new circle" passes `{ subtype: 'circle' }` so the tag lands in
   * the same write as the create (no follow-up patch). The user-typed name
   * wins over any collision. Ignored by the inline map-create delegate flow.
   */
  extraData?: Record<string, unknown>;
  /**
   * Skip the post-create `navigate(elementHash(...))` jump. Used by flows
   * that want to stay in their current view after creation — e.g. the writing
   * workspace's inline element creation, which replaces selected prose with
   * an ow:// chip and shouldn't navigate the user out of the room.
   */
  suppressNavigate?: boolean;
  /**
   * Charts-context create (S263). The chart can only show DATED elements, so
   * a bare create silently never appears — the vanish class the drag-to-date
   * gate killed. With this set: (a) types without a start-date field render
   * greyed-out in the grid (visible but disabled — teaches the difference)
   * and are excluded from category matching; (b) a Date field appears under
   * Name, prefilled with `defaultDate` and labeled with the selected type's
   * real start field; (c) the date is REQUIRED and merged into the create
   * body, so the new element lands on the chart immediately.
   */
  temporalContext?: { defaultDate: number };
}

export class ElementCreateModal extends BaseModal {
  private toasts: ToastManager;
  private opts: ElementCreateOptions;
  private selected: ElementType;
  private typeButtons = new Map<ElementType, HTMLButtonElement>();
  private typeInput!: HTMLInputElement;
  private ghostTyped!: HTMLSpanElement;
  private ghostSuffix!: HTMLSpanElement;
  // NPM (DESIGN_MAPS.md §3.7) — when an existing-name autocomplete is accepted
  // via TAB, the submit button flips to "Place" and we remember which element
  // to point the new pin at. Cleared when the user edits the name back to
  // something that no longer matches the accepted suggestion.
  private placingExistingId: string | null = null;
  private nameInput!: HTMLInputElement;
  private nameGhostTyped!: HTMLSpanElement;
  private nameGhostSuffix!: HTMLSpanElement;
  private modeChip!: HTMLSpanElement;
  private submitBtn!: HTMLButtonElement;

  constructor(toasts: ToastManager, opts: ElementCreateOptions = {}) {
    super();
    this.toasts = toasts;
    this.opts = opts;
    // Explicit caller type wins; otherwise fall back to the user's default
    // create type (settings → Editing). buildModal re-validates against the
    // effective (post-exclude) type set so an excluded default can't stick.
    this.selected = opts.initialType ?? loadUiPrefs().defaultCreateType;
  }

  /** Types this modal instance offers — CREATE_TYPES minus opts.excludeTypes.
   *  Under temporalContext, dateless types stay VISIBLE in the grid (greyed)
   *  but are not selectable — so they're excluded here, and renderTypeGrid
   *  draws them disabled separately. */
  private effectiveTypes(): ElementType[] {
    let types = CREATE_TYPES;
    if (this.opts.excludeTypes?.length) {
      const excluded = new Set(this.opts.excludeTypes);
      types = types.filter(t => !excluded.has(t));
    }
    if (this.opts.temporalContext) {
      types = types.filter(t => !!TEMPORAL_TYPE_FIELDS[t]);
    }
    return types;
  }

  /** The selected type's start-date field name (temporalContext only). */
  private startFieldOf(type: ElementType): string | null {
    return TEMPORAL_TYPE_FIELDS[type]?.start ?? null;
  }

  open(): void {
    if (!getState().active) {
      this.toasts.error('No active world');
      return;
    }
    if (!getActiveStore()) {
      this.toasts.error('Active store not open');
      return;
    }
    this.modal = this.buildModal();
    this.show();
    queueMicrotask(() => {
      const input = this.modal?.querySelector<HTMLInputElement>('input[name="element-name"]');
      input?.focus();
      input?.select();
    });
  }

  private buildModal(): HTMLElement {
    const placeMode = !!this.opts.enablePlaceExisting;
    const { overlay, body, panel } = this.buildModalShell({
      title: this.opts.title ?? 'New element',
      dataModal: 'create-element',
    });

    // Mode chip — visible only after a TAB-accept in NPM mode. Appended next
    // to the title for inline placement signal ("placing existing · char").
    this.modeChip = document.createElement('span');
    this.modeChip.className = 'atlas-modal-title-chip';
    this.modeChip.setAttribute('data-role', 'mode-chip');
    this.modeChip.hidden = true;
    const titleEl = panel.querySelector<HTMLElement>('.atlas-modal-title');
    if (titleEl) titleEl.appendChild(this.modeChip);

    const nameFieldHtml = placeMode
      ? `<label class="atlas-modal-field">
          <span>Name</span>
          <div class="atlas-input-ghost-wrap">
            <span class="atlas-input-ghost"><span class="name-ghost-typed"></span><span class="name-ghost-suffix"></span></span>
            <input class="atlas-input" type="text" name="element-name" placeholder="Element name (TAB to place existing)" autocomplete="off" value="${escapeAttr(this.opts.initialName ?? '')}" />
          </div>
        </label>`
      : `<label class="atlas-modal-field">
          <span>Name</span>
          <input class="atlas-input" type="text" name="element-name" placeholder="Element name" autocomplete="off" value="${escapeAttr(this.opts.initialName ?? '')}" />
        </label>`;

    // Charts-context (S263): the Date row, prefilled; its label names the
    // selected type's REAL start field and re-labels on type change.
    const dateFieldHtml = this.opts.temporalContext
      ? `<label class="atlas-modal-field" data-role="date-field">
          <span data-role="date-label">Date</span>
          <input class="atlas-input" type="number" name="element-date" autocomplete="off" value="${escapeAttr(String(this.opts.temporalContext.defaultDate))}" />
        </label>`
      : '';

    body.innerHTML = `
      <form data-form="create-element">
        ${nameFieldHtml}
        ${dateFieldHtml}
        <div class="atlas-modal-field">
          <span>Type</span>
          <div class="atlas-input-ghost-wrap">
            <span class="atlas-input-ghost"><span class="ghost-typed"></span><span class="ghost-suffix"></span></span>
            <input class="atlas-input" type="text" name="element-type" placeholder="Type to filter (e.g. 'char')" autocomplete="off" />
          </div>
          <div class="atlas-create-type-grid" data-role="type-grid"></div>
        </div>
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="create">Create</button>
        </div>
      </form>
    `;

    // Capture the category input + ghost spans.
    this.typeInput = body.querySelector<HTMLInputElement>('input[name="element-type"]')!;
    this.ghostTyped = body.querySelector<HTMLSpanElement>('.ghost-typed')!;
    this.ghostSuffix = body.querySelector<HTMLSpanElement>('.ghost-suffix')!;

    // Guard: if the preselected type (from opts or the user default) isn't in
    // the effective set — e.g. default is 'map' but this contextual flow
    // excludes it — fall back to the first offered type so the grid + input
    // always reflect a real, selectable category.
    const effectiveForInit = this.effectiveTypes();
    if (!effectiveForInit.includes(this.selected)) {
      this.selected = effectiveForInit[0] ?? 'character';
    }

    // Render the type grid + initial input value + initial ghost state.
    const grid = body.querySelector<HTMLElement>('[data-role="type-grid"]')!;
    this.renderTypeGrid(grid);
    this.typeInput.value = ELEMENT_LABELS[this.selected].singular;
    this.updateGhost();
    this.updateDateLabel(body);

    // Type filtering: best-match category from the typed text → highlight + ghost.
    const effective = this.effectiveTypes();
    this.typeInput.addEventListener('input', () => {
      const matched = matchCategory(this.typeInput.value, effective);
      if (matched) this.setType(matched);
      this.updateGhost();
    });

    // Tab or Right-Arrow-at-end accepts the ghost suggestion.
    this.typeInput.addEventListener('keydown', (e) => {
      const ghostVisible = !!this.ghostSuffix.textContent;
      if (!ghostVisible) return;
      const atEnd = this.typeInput.selectionStart === this.typeInput.value.length;
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        this.typeInput.value = ELEMENT_LABELS[this.selected].singular;
        this.updateGhost();
        this.typeInput.setSelectionRange(this.typeInput.value.length, this.typeInput.value.length);
      } else if (e.key === 'ArrowRight' && atEnd) {
        e.preventDefault();
        this.typeInput.value = ELEMENT_LABELS[this.selected].singular;
        this.updateGhost();
      }
    });

    // Capture name field + its ghost spans (only present in NPM mode).
    this.nameInput = body.querySelector<HTMLInputElement>('input[name="element-name"]')!;
    if (placeMode) {
      this.nameGhostTyped = body.querySelector<HTMLSpanElement>('.name-ghost-typed')!;
      this.nameGhostSuffix = body.querySelector<HTMLSpanElement>('.name-ghost-suffix')!;
      this.wireNameAutocomplete();
    }

    const form = body.querySelector<HTMLFormElement>('form')!;
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const submitBtn = body.querySelector<HTMLButtonElement>('[data-action="create"]')!;
    this.submitBtn = submitBtn;

    cancelBtn.addEventListener('click', (e) => { e.preventDefault(); this.hide(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      const nameInput = form.querySelector<HTMLInputElement>('input[name="element-name"]')!;
      const name = nameInput.value.trim();
      if (!name) {
        errorBox.textContent = 'Name is required';
        errorBox.hidden = false;
        nameInput.focus();
        return;
      }
      if (!this.effectiveTypes().includes(this.selected)) {
        errorBox.textContent = 'Pick a category';
        errorBox.hidden = false;
        return;
      }

      // Charts-context: the date is required — an undated create can't appear
      // on the chart, and a write that succeeds invisibly is the vanish class.
      let temporalDate: number | null = null;
      if (this.opts.temporalContext) {
        const dateInput = form.querySelector<HTMLInputElement>('input[name="element-date"]')!;
        const parsed = dateInput.value.trim() === '' ? NaN : Number(dateInput.value);
        if (!Number.isFinite(parsed)) {
          errorBox.textContent = 'A date is required to place it on the chart';
          errorBox.hidden = false;
          dateInput.focus();
          return;
        }
        temporalDate = parsed;
      }

      // NPM Place mode — short-circuit the create path. Drop a pin at the
      // existing element and exit. No createElement, no state.data refresh.
      // The caller's onPlaceExisting handles the pin write.
      if (this.placingExistingId) {
        const targetId = this.placingExistingId;
        const targetEl = getState().data.elements.find(e => e.id === targetId);
        if (!targetEl) {
          errorBox.textContent = 'Existing element no longer exists';
          errorBox.hidden = false;
          this.clearPlaceExisting();
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Placing…';
        cancelBtn.hidden = true;
        try {
          this.hide();
          this.opts.onPlaceExisting?.(targetEl.id, targetEl.type);
        } catch (err) {
          console.error('[element-create] place existing failed:', err);
          errorBox.textContent = err instanceof Error ? err.message : String(err);
          errorBox.hidden = false;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Place';
          cancelBtn.hidden = false;
        }
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating…';
      cancelBtn.hidden = true;
      try {
        // Type=map gets a different flow: don't create a bare element first
        // and then configure. Instead delegate to createMapDialog which
        // gathers all the map's info (name, location, image, advanced
        // fields) and creates a fully-formed map on submit. Cancel = nothing
        // is created. Eliminates the "bare empty map left behind on cancel"
        // wart the post-create-configure flow had. The element-create grid
        // serves as the entry point; the proper map modal owns the data.
        const willCreateMapInline = this.selected === 'map' && !this.opts.onCreated;
        if (willCreateMapInline) {
          this.hide();
          const result = await createMapDialog(this.toasts, { initialName: name });
          if (!result) return; // user cancelled — no element created
          // Waypoint: this early-return path bypasses the hook below — a
          // first element that's a Map still counts (hookmap wp2).
          completeWaypoint('first-element');
          // afterCreate must fire on this path too (it clears the sidebar
          // search takeover) — only onCreated is deliberately skipped here,
          // since its absence is what routed us to the inline map flow.
          this.opts.afterCreate?.(result.map.id, 'map');
          const worldId = getState().active?.worldId;
          patchSlice('ui', { ...getState().ui, selectedElementId: result.map.id });
          if (worldId) navigate(elementHash(worldId, result.map.id));
          return;
        }

        const store = getActiveStore()!;
        const startField = this.opts.temporalContext ? this.startFieldOf(this.selected) : null;
        const temporalData = startField && temporalDate != null ? { [startField]: temporalDate } : {};
        const el = await store.createElement(this.selected, { ...this.opts.extraData, ...temporalData, name } as Partial<Element>);
        completeWaypoint('first-element');
        const elements = await store.listElements();
        patchSlice('data', { elements });
        // Creating an element flips the sidebar to elements mode so the new
        // row is visible (mirrors the create-world flip, S255v3). Persisted
        // as the user's preference, same as the world flow.
        if (getState().ui.sidebarMode !== 'elements') {
          patchSlice('ui', { ...getState().ui, sidebarMode: 'elements', selectedElementId: el.id });
          setSidebarModePref('elements');
        } else {
          patchSlice('ui', { ...getState().ui, selectedElementId: el.id });
        }
        // Charts-context callers toast their own, more specific confirmation
        // ("Created X at 60" + peek) — a second generic toast here doubles it.
        if (!this.opts.temporalContext) {
          this.toasts.success(`Created ${this.selected}: ${el.name}`);
        }
        this.hide();
        this.opts.onCreated?.(el.id, this.selected);
        this.opts.afterCreate?.(el.id, this.selected);
        requestPushIfLinked();

        if (!this.opts.suppressNavigate) {
          const worldId = getState().active?.worldId;
          if (worldId) navigate(elementHash(worldId, el.id));
        }
      } catch (err) {
        console.error('[element-create] failed:', err);
        errorBox.textContent = err instanceof Error ? err.message : String(err);
        errorBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create';
        cancelBtn.hidden = false;
      }
    });

    return overlay;
  }

  /** Re-label the charts-context Date row with the selected type's real
   *  start field ("Date · grant_date") so the user learns which field this is. */
  private updateDateLabel(scope?: HTMLElement): void {
    if (!this.opts.temporalContext) return;
    const root = scope ?? this.modal;
    const label = root?.querySelector<HTMLElement>('[data-role="date-label"]');
    const field = this.startFieldOf(this.selected);
    if (label && field) label.textContent = `Date · ${field}`;
  }

  private setType(type: ElementType): void {
    this.selected = type;
    this.typeButtons.forEach((btn, t) => btn.classList.toggle('active', t === type));
    this.updateDateLabel();
    // Category change invalidates any accepted place-existing selection — the
    // selected element belonged to the prior category. Drop back to Create.
    if (this.placingExistingId) this.clearPlaceExisting();
    // Refresh the name-field ghost against the new category's candidates.
    if (this.opts.enablePlaceExisting) this.updateNameGhost();
  }

  /**
   * Wire ghost-line autocomplete on the name field (NPM mode, DESIGN_MAPS.md
   * §3.7). On every keystroke, compute the best candidate name and render the
   * ghost suffix. TAB at end of typed input accepts → place mode.
   */
  private wireNameAutocomplete(): void {
    this.nameInput.addEventListener('input', () => {
      // User editing → ghost may stale; recompute. Also bail out of place mode
      // if the typed text no longer matches the chosen suggestion exactly.
      if (this.placingExistingId) {
        const target = getState().data.elements.find(e => e.id === this.placingExistingId);
        if (!target || this.nameInput.value.trim() !== (target.name ?? '').trim()) {
          this.clearPlaceExisting();
        }
      }
      this.updateNameGhost();
    });

    this.nameInput.addEventListener('keydown', (e) => {
      const ghostVisible = !!this.nameGhostSuffix.textContent;
      if (!ghostVisible) return;
      const atEnd = this.nameInput.selectionStart === this.nameInput.value.length;
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        this.acceptNameGhost();
      } else if (e.key === 'ArrowRight' && atEnd) {
        e.preventDefault();
        this.acceptNameGhost();
      }
    });
  }

  private updateNameGhost(): void {
    if (!this.opts.enablePlaceExisting) return;
    const typed = this.nameInput.value;
    if (!typed) {
      this.nameGhostTyped.textContent = '';
      this.nameGhostSuffix.textContent = '';
      return;
    }
    const match = findExistingNameMatch(typed, this.selected, getState().data.elements);
    if (!match) {
      this.nameGhostTyped.textContent = '';
      this.nameGhostSuffix.textContent = '';
      return;
    }
    this.nameGhostTyped.textContent = typed;
    this.nameGhostSuffix.textContent = match.name.slice(typed.length);
  }

  private acceptNameGhost(): void {
    const match = findExistingNameMatch(this.nameInput.value, this.selected, getState().data.elements);
    if (!match) return;
    this.nameInput.value = match.name;
    this.placingExistingId = match.id;
    this.nameGhostTyped.textContent = '';
    this.nameGhostSuffix.textContent = '';
    this.modeChip.hidden = false;
    this.modeChip.textContent = `placing existing · ${ELEMENT_LABELS[match.type].singular}`;
    this.submitBtn.textContent = 'Place';
    this.nameInput.setSelectionRange(match.name.length, match.name.length);
  }

  private clearPlaceExisting(): void {
    this.placingExistingId = null;
    this.modeChip.hidden = true;
    this.modeChip.textContent = '';
    this.submitBtn.textContent = 'Create';
  }

  private updateGhost(): void {
    const typed = this.typeInput.value;
    if (!typed) {
      this.ghostTyped.textContent = '';
      this.ghostSuffix.textContent = '';
      return;
    }
    const matchedName = ELEMENT_LABELS[this.selected].singular;
    if (matchedName.toLowerCase().startsWith(typed.toLowerCase()) && typed.length < matchedName.length) {
      // Ghost only shows when typed text is a true prefix of the suggestion.
      this.ghostTyped.textContent = typed;
      this.ghostSuffix.textContent = matchedName.slice(typed.length);
    } else {
      this.ghostTyped.textContent = '';
      this.ghostSuffix.textContent = '';
    }
  }

  private renderTypeGrid(grid: HTMLElement): void {
    grid.innerHTML = '';
    this.typeButtons.clear();
    this.effectiveTypes().forEach(type => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'atlas-create-type-btn' + (type === this.selected ? ' active' : '');
      btn.setAttribute('data-type', type);
      btn.title = ELEMENT_LABELS[type].singular;
      btn.innerHTML = `
        <span class="material-symbols-outlined">${ELEMENT_ICONS[type]}</span>
        <span>${ELEMENT_LABELS[type].singular}</span>
      `;
      btn.addEventListener('click', () => {
        this.setType(type);
        this.typeInput.value = ELEMENT_LABELS[type].singular;
        this.updateGhost();
      });
      this.typeButtons.set(type, btn);
      grid.appendChild(btn);
    });

    // Charts-context: the dateless types stay VISIBLE but disabled — showing
    // the difference teaches it (Captain, S263). They're created from the
    // elements sidebar, where undated is a normal state.
    if (this.opts.temporalContext) {
      const excluded = new Set(this.opts.excludeTypes ?? []);
      const dateless = CREATE_TYPES.filter(t => !excluded.has(t) && !TEMPORAL_TYPE_FIELDS[t]);
      for (const type of dateless) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.disabled = true;
        btn.className = 'atlas-create-type-btn atlas-create-type-btn-dateless';
        btn.setAttribute('data-type', type);
        btn.title = `${ELEMENT_LABELS[type].singular} has no date fields — create it from the elements sidebar`;
        btn.innerHTML = `
          <span class="material-symbols-outlined">${ELEMENT_ICONS[type]}</span>
          <span>${ELEMENT_LABELS[type].singular}</span>
        `;
        grid.appendChild(btn);
      }
    }
  }
}

/**
 * Best-match a partial category string against the supplied candidate types.
 * Strategy: exact match → startsWith → includes → null.
 */
function matchCategory(input: string, candidates: ElementType[] = CREATE_TYPES): ElementType | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  let exact: ElementType | null = null;
  let starts: ElementType | null = null;
  let contains: ElementType | null = null;
  for (const t of candidates) {
    const name = ELEMENT_LABELS[t].singular.toLowerCase();
    if (name === q) { exact = t; break; }
    if (!starts && name.startsWith(q)) starts = t;
    if (!contains && name.includes(q)) contains = t;
  }
  return exact ?? starts ?? contains;
}


