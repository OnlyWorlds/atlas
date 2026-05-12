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

export interface PickElementOptions {
  restrictToType?: ElementType;
  excludeIds?: string[];
  title?: string;
}

const ROW_CAP = 200;

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
    super('atlas-modal-overlay');
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
    const overlay = document.createElement('div');
    overlay.className = 'atlas-modal-overlay';

    const panel = document.createElement('div');
    panel.className = 'atlas-modal-panel atlas-picker-panel';
    panel.setAttribute('data-modal', 'pick-element');

    const titleText = this.opts.title
      ?? (this.opts.restrictToType
        ? `pick a ${ELEMENT_LABELS[this.opts.restrictToType].singular}`
        : 'pick an element');

    panel.innerHTML = `
      <div class="atlas-picker-title-row">
        <div class="atlas-modal-title">${escapeText(titleText)}</div>
        <div class="atlas-picker-count" data-role="count">0 elements</div>
      </div>
      <input type="text" class="ow-input atlas-picker-search" data-role="picker-search" placeholder="search by name..." autocomplete="off" />
      <div class="atlas-picker-strip" data-role="type-strip"></div>
      <div class="atlas-picker-list" data-role="picker-list"></div>
    `;

    overlay.appendChild(panel);

    this.countEl = panel.querySelector<HTMLElement>('[data-role="count"]')!;
    this.listEl = panel.querySelector<HTMLElement>('[data-role="picker-list"]')!;
    this.stripEl = panel.querySelector<HTMLElement>('[data-role="type-strip"]')!;

    const search = panel.querySelector<HTMLInputElement>('[data-role="picker-search"]')!;
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
    this.stripEl.appendChild(this.typeChip('all', null, null));
    ALL_ELEMENT_TYPES.forEach(t => {
      // Skip pin/marker/zone in the picker — those aren't normally picked.
      if (t === 'pin' || t === 'marker' || t === 'zone') return;
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

    const items = all.filter(el => {
      if (exclude.has(el.id)) return false;
      if (this.typeFilter && el.type !== this.typeFilter) return false;
      if (this.search && !(el.name ?? '').toLowerCase().includes(this.search)) return false;
      return true;
    }).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    const total = items.length;
    const capped = items.slice(0, ROW_CAP);
    this.countEl.textContent = total > ROW_CAP
      ? `showing ${ROW_CAP} of ${total}`
      : `${total} ${total === 1 ? 'element' : 'elements'}`;

    this.listEl.innerHTML = '';
    if (capped.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'atlas-picker-empty';
      empty.textContent = 'no matching elements';
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

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
