/**
 * ElementCreateModal — name + type, creates via the active FolderStore.
 *
 * Type grid: 19 content types (pin/marker excluded — those are map artifacts).
 * Submit → FolderStore.createElement → patch state.data.elements with a new
 * array reference (force-rerender) → navigate to the element detail.
 */

import { BaseModal } from './modal-base';
import { ToastManager } from './toast-manager';
import { getState, patchSlice } from '../core/state';
import { navigate, elementHash } from '../core/router';
import { getActiveStore } from './create-world-modal';
import { CONTENT_ELEMENT_TYPES, type ElementType } from '../core/types';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';

/** Types offered in the create modal (all 18 content types — spatial types are map-driven). */
const CREATE_TYPES: ElementType[] = [...CONTENT_ELEMENT_TYPES];

export interface ElementCreateOptions {
  /** Pre-select a type (otherwise defaults to 'character'). */
  initialType?: ElementType;
  /** Pre-fill the name field. */
  initialName?: string;
  /** Called after the element is created. */
  onCreated?: (id: string) => void;
}

export class ElementCreateModal extends BaseModal {
  private toasts: ToastManager;
  private opts: ElementCreateOptions;
  private selected: ElementType;

  constructor(toasts: ToastManager, opts: ElementCreateOptions = {}) {
    super('atlas-modal-overlay');
    this.toasts = toasts;
    this.opts = opts;
    this.selected = opts.initialType ?? 'character';
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
    const overlay = document.createElement('div');
    overlay.className = 'atlas-modal-overlay';

    const panel = document.createElement('div');
    panel.className = 'atlas-modal-panel';
    panel.setAttribute('data-modal', 'create-element');

    panel.innerHTML = `
      <div class="atlas-modal-title">new element</div>
      <form data-form="create-element">
        <label class="atlas-modal-field">
          <span>name</span>
          <input class="ow-input" type="text" name="element-name" placeholder="element name" autocomplete="off" value="${escapeAttr(this.opts.initialName ?? '')}" />
        </label>
        <label class="atlas-modal-field">
          <span>type</span>
          <div class="atlas-create-type-grid" data-role="type-grid"></div>
        </label>
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="ow-btn ow-btn-secondary" data-action="cancel">cancel</button>
          <button type="submit" class="ow-btn ow-btn-primary" data-action="create">create</button>
        </div>
      </form>
    `;

    overlay.appendChild(panel);

    const grid = panel.querySelector<HTMLElement>('[data-role="type-grid"]')!;
    this.renderTypeGrid(grid);

    const form = panel.querySelector<HTMLFormElement>('form')!;
    const errorBox = panel.querySelector<HTMLElement>('[data-role="error"]')!;
    const cancelBtn = panel.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const submitBtn = panel.querySelector<HTMLButtonElement>('[data-action="create"]')!;

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
      submitBtn.disabled = true;
      submitBtn.textContent = 'creating…';
      try {
        const store = getActiveStore()!;
        const el = await store.createElement(this.selected, { name });
        // Refresh the elements cache with a NEW array reference (force-rerender).
        const elements = await store.listElements();
        patchSlice('data', { elements });
        patchSlice('ui', { ...getState().ui, selectedElementId: el.id });
        this.toasts.success(`created ${this.selected}: ${el.name}`);
        this.hide();
        this.opts.onCreated?.(el.id);
        const worldId = getState().active?.worldId;
        if (worldId) navigate(elementHash(worldId, el.id));
      } catch (err) {
        console.error('[element-create] failed:', err);
        errorBox.textContent = err instanceof Error ? err.message : String(err);
        errorBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'create';
      }
    });

    return overlay;
  }

  private renderTypeGrid(grid: HTMLElement): void {
    grid.innerHTML = '';
    CREATE_TYPES.forEach(type => {
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
        this.selected = type;
        grid.querySelectorAll('.atlas-create-type-btn').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-type') === type);
        });
      });
      grid.appendChild(btn);
    });
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
