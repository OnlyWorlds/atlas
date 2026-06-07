/**
 * ElementPickerModal — pick an existing element from the active world.
 *
 * Reusable across single-link fields, multi-link chip editors, and pin placement.
 *
 *   await pickElement({ restrictToType?, excludeIds?, title? })
 *     → Promise<Element | null>
 *
 * Reads from `state.data.elements` (already cached for the active world). The
 * list is capped at 200 rows to keep the DOM cheap; virtualization can come
 * later if real worlds hit the cap.
 */

import { BaseModal } from './modal-base';
import { getState } from '../core/state';
import type { Element, ElementType } from '../core/types';
import { ALL_ELEMENT_TYPES } from '../core/types';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import { escapeText } from '../core/dom-utils';

export interface PickElementOptions {
  restrictToType?: ElementType;
  excludeIds?: string[];
  title?: string;
  /**
   * Hard-restrict the candidate pool to these element ids. Useful for the
   * "pinned on this map" overflow picker (Map detail middle pane) — pass the
   * ids of pinned elements and the picker becomes a navigable search over
   * just those, not the whole world.
   */
  restrictToIds?: string[];
}

const ROW_CAP = 200;

/**
 * Map artifacts are never offered by the GENERIC picker — they're created by
 * drawing/placement, not picked (the type strip already skipped them; the
 * unfiltered "All" list now applies the same rule, so stray pins/markers
 * can't leak into e.g. an element-card or knowledge-subject pick). An
 * explicit `restrictToType: 'zone' | 'pin' | 'marker'` still works — schema
 * fields that target those types keep their pickers.
 */
const GENERIC_PICK_EXCLUDED = new Set<ElementType>(['pin', 'marker', 'zone']);

export function pickElement(opts: PickElementOptions = {}): Promise<Element | null> {
  return new Promise((resolve) => {
    const modal = new ElementPickerModal(opts, (el) => resolve(el));
    modal.open();
  });
}

class ElementPickerModal extends BaseModal {
  private onPick: (el: Element | null) => void;
  private opts: PickElementOptions;
  private resolved = false;

  private search = '';
  private typeFilter: ElementType | null = null;

  private listEl!: HTMLElement;
  private countEl!: HTMLElement;
  private stripEl: HTMLElement | null = null;

  constructor(opts: PickElementOptions, onPick: (el: Element | null) => void) {
    super();
    this.opts = opts;
    this.onPick = onPick;
    this.typeFilter = opts.restrictToType ?? null;
  }

  open(): void {
    this.modal = this.buildModal();
    this.show();
    queueMicrotask(() => {
      const search = this.modal?.querySelector<HTMLInputElement>('input[data-role="picker-search"]');
      search?.focus();
    });
    // Override the BaseModal close path so we resolve null on cancel.
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        this.cancel();
        document.removeEventListener('keydown', onEsc);
      }
    };
    document.addEventListener('keydown', onEsc);
    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.cancel();
        document.removeEventListener('keydown', onEsc);
      }
    });
  }

  private cancel(): void {
    if (!this.resolved) {
      this.resolved = true;
      this.onPick(null);
    }
    this.hide();
  }

  private buildModal(): HTMLElement {
    // Picker provides its own title row (title + count badge), so skip the
    // base shell's title slot.
    const { overlay, body } = this.buildModalShell({
      panelClass: 'atlas-picker-panel',
      dataModal: 'pick-element',
    });

    const titleText = this.opts.title
      ?? (this.opts.restrictToType
        ? `Pick a ${ELEMENT_LABELS[this.opts.restrictToType].singular}`
        : 'Pick an element');

    body.innerHTML = `
      <div class="atlas-picker-title-row">
        <div class="atlas-modal-title">${escapeText(titleText)}</div>
        <div class="atlas-picker-count" data-role="count">0 elements</div>
      </div>
      <input type="text" class="atlas-input atlas-picker-search" data-role="picker-search" placeholder="Search by name..." autocomplete="off" />
      <div class="atlas-picker-strip" data-role="type-strip"></div>
      <div class="atlas-picker-list" data-role="picker-list"></div>
    `;

    this.countEl = body.querySelector<HTMLElement>('[data-role="count"]')!;
    this.listEl = body.querySelector<HTMLElement>('[data-role="picker-list"]')!;
    this.stripEl = body.querySelector<HTMLElement>('[data-role="type-strip"]')!;

    const search = body.querySelector<HTMLInputElement>('[data-role="picker-search"]')!;
    search.addEventListener('input', () => {
      this.search = search.value.trim().toLowerCase();
      this.refreshList();
    });

    // Type strip — hidden if restrictToType is set.
    if (!this.opts.restrictToType) {
      this.renderTypeStrip();
    } else {
      this.stripEl.remove();
      this.stripEl = null;
    }

    this.refreshList();

    return overlay;
  }

  private renderTypeStrip(): void {
    if (!this.stripEl) return;
    this.stripEl.innerHTML = '';
    this.stripEl.appendChild(this.typeChip('All', null, null));
    ALL_ELEMENT_TYPES.forEach(t => {
      // Map artifacts aren't normally picked — same rule as the list filter.
      if (GENERIC_PICK_EXCLUDED.has(t)) return;
      this.stripEl!.appendChild(this.typeChip(ELEMENT_LABELS[t].singular, ELEMENT_ICONS[t], t));
    });
  }

  private typeChip(label: string, icon: string | null, type: ElementType | null): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-picker-chip' + (this.typeFilter === type ? ' is-active' : '');
    if (icon) {
      const ic = document.createElement('span');
      ic.className = 'material-symbols-outlined';
      ic.textContent = icon;
      btn.appendChild(ic);
    }
    const lab = document.createElement('span');
    lab.textContent = label;
    btn.appendChild(lab);
    btn.addEventListener('click', () => {
      this.typeFilter = type;
      this.renderTypeStrip();
      this.refreshList();
    });
    return btn;
  }

  private refreshList(): void {
    const all = getState().data.elements;
    const exclude = new Set(this.opts.excludeIds ?? []);
    const restrict = this.opts.restrictToIds ? new Set(this.opts.restrictToIds) : null;

    const items = all.filter(el => {
      if (exclude.has(el.id)) return false;
      if (restrict && !restrict.has(el.id)) return false;
      // Generic picks never surface map artifacts — explicit restrictToType
      // is the only door to them (mirrors the type strip).
      if (!this.opts.restrictToType && GENERIC_PICK_EXCLUDED.has(el.type)) return false;
      if (this.typeFilter && el.type !== this.typeFilter) return false;
      if (this.search && !(el.name ?? '').toLowerCase().includes(this.search)) return false;
      return true;
    }).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    const total = items.length;
    const capped = items.slice(0, ROW_CAP);
    this.countEl.textContent = total > ROW_CAP
      ? `Showing ${ROW_CAP} of ${total}`
      : `${total} ${total === 1 ? 'element' : 'elements'}`;

    this.listEl.innerHTML = '';
    if (capped.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'atlas-picker-empty';
      empty.textContent = 'No matching elements';
      this.listEl.appendChild(empty);
      return;
    }
    capped.forEach(el => this.listEl.appendChild(this.buildRow(el)));
  }

  private buildRow(el: Element): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'atlas-picker-row';
    row.setAttribute('data-element-id', el.id);
    row.innerHTML = `
      <span class="material-symbols-outlined atlas-picker-row-icon">${ELEMENT_ICONS[el.type]}</span>
      <span class="atlas-picker-row-name">${escapeText(el.name || '(unnamed)')}</span>
      <span class="atlas-picker-row-type">${escapeText(el.type)}</span>
    `;
    row.addEventListener('click', () => {
      this.resolved = true;
      this.onPick(el);
      this.hide();
    });
    return row;
  }
}


