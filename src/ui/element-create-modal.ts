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
import { getActiveStore } from './create-world-modal';
import { CONTENT_ELEMENT_TYPES, type ElementType } from '../core/types';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import { requestPushIfLinked } from '../sync/sync-attach';
import { createMapDialog } from './map-create-modal';

/** Types offered in the create modal — matches legacy: all 22 except pin/marker. */
const CREATE_TYPES: ElementType[] = [...CONTENT_ELEMENT_TYPES, 'map', 'zone'];

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
}

export class ElementCreateModal extends BaseModal {
  private toasts: ToastManager;
  private opts: ElementCreateOptions;
  private selected: ElementType;
  private typeButtons = new Map<ElementType, HTMLButtonElement>();
  private typeInput!: HTMLInputElement;
  private ghostTyped!: HTMLSpanElement;
  private ghostSuffix!: HTMLSpanElement;

  constructor(toasts: ToastManager, opts: ElementCreateOptions = {}) {
    super();
    this.toasts = toasts;
    this.opts = opts;
    this.selected = opts.initialType ?? 'character';
  }

  /** Types this modal instance offers — CREATE_TYPES minus opts.excludeTypes. */
  private effectiveTypes(): ElementType[] {
    if (!this.opts.excludeTypes?.length) return CREATE_TYPES;
    const excluded = new Set(this.opts.excludeTypes);
    return CREATE_TYPES.filter(t => !excluded.has(t));
  }

  open(): void {
    if (!getState().active) {
      this.toasts.error('no active world');
      return;
    }
    if (!getActiveStore()) {
      this.toasts.error('active store not open');
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
    const { overlay, body } = this.buildModalShell({
      title: 'New element',
      dataModal: 'create-element',
    });

    body.innerHTML = `
      <form data-form="create-element">
        <label class="atlas-modal-field">
          <span>Name</span>
          <input class="atlas-input" type="text" name="element-name" placeholder="element name" autocomplete="off" value="${escapeAttr(this.opts.initialName ?? '')}" />
        </label>
        <div class="atlas-modal-field">
          <span>category</span>
          <div class="atlas-input-ghost-wrap">
            <span class="atlas-input-ghost"><span class="ghost-typed"></span><span class="ghost-suffix"></span></span>
            <input class="atlas-input" type="text" name="element-type" placeholder="type to filter (e.g. 'char')" autocomplete="off" />
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

    // Render the type grid + initial input value + initial ghost state.
    const grid = body.querySelector<HTMLElement>('[data-role="type-grid"]')!;
    this.renderTypeGrid(grid);
    this.typeInput.value = ELEMENT_LABELS[this.selected].singular;
    this.updateGhost();

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

    const form = body.querySelector<HTMLFormElement>('form')!;
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const submitBtn = body.querySelector<HTMLButtonElement>('[data-action="create"]')!;

    cancelBtn.addEventListener('click', (e) => { e.preventDefault(); this.hide(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      const nameInput = form.querySelector<HTMLInputElement>('input[name="element-name"]')!;
      const name = nameInput.value.trim();
      if (!name) {
        errorBox.textContent = 'name is required';
        errorBox.hidden = false;
        nameInput.focus();
        return;
      }
      if (!this.effectiveTypes().includes(this.selected)) {
        errorBox.textContent = 'pick a category';
        errorBox.hidden = false;
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
          const worldId = getState().active?.worldId;
          patchSlice('ui', { ...getState().ui, selectedElementId: result.map.id });
          if (worldId) navigate(elementHash(worldId, result.map.id));
          return;
        }

        const store = getActiveStore()!;
        const el = await store.createElement(this.selected, { name });
        const elements = await store.listElements();
        patchSlice('data', { elements });
        patchSlice('ui', { ...getState().ui, selectedElementId: el.id });
        this.toasts.success(`created ${this.selected}: ${el.name}`);
        this.hide();
        this.opts.onCreated?.(el.id, this.selected);
        requestPushIfLinked();

        const worldId = getState().active?.worldId;
        if (worldId) navigate(elementHash(worldId, el.id));
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

  private setType(type: ElementType): void {
    this.selected = type;
    this.typeButtons.forEach((btn, t) => btn.classList.toggle('active', t === type));
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

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
