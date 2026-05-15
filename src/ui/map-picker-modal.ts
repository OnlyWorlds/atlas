/**
 * MapPickerModal — lightweight overlay for the "element has 2+ maps" case
 * from DESIGN_MAPS.md §3.6. Lists the candidate maps; user clicks to pick;
 * Esc or outside-click cancels (resolves null).
 *
 * Default highlight on the first row (caller pre-sorts by hierarchy DESC).
 * Up/Down arrows navigate; Enter picks the highlighted row.
 */

import { BaseModal } from './modal-base';
import type { WorldMap } from '../core/types';

export interface MapPickerResult {
  map: WorldMap;
}

export function pickMapForElement(
  maps: WorldMap[],
  elementName: string,
): Promise<MapPickerResult | null> {
  return new Promise((resolve) => {
    const modal = new MapPickerModal(maps, elementName, (r) => resolve(r));
    modal.open();
  });
}

class MapPickerModal extends BaseModal {
  private maps: WorldMap[];
  private elementName: string;
  private onDone: (result: MapPickerResult | null) => void;
  private resolved = false;
  private highlightIndex = 0;
  private rows: HTMLElement[] = [];

  constructor(maps: WorldMap[], elementName: string, onDone: (result: MapPickerResult | null) => void) {
    super();
    this.maps = maps;
    this.elementName = elementName;
    this.onDone = onDone;
  }

  open(): void {
    const { overlay, body } = this.buildModalShell({
      title: `Open which map?`,
      panelClass: 'atlas-map-picker-panel',
      dataModal: 'map-picker',
    });

    const sub = document.createElement('div');
    sub.className = 'atlas-modal-hint';
    sub.style.margin = '0 0 8px';
    sub.textContent = `${this.elementName} has ${this.maps.length} maps. Pick one to open, or press Esc to stay in the current view.`;
    body.appendChild(sub);

    const list = document.createElement('div');
    list.className = 'atlas-list atlas-map-picker-list';
    this.rows = [];
    this.maps.forEach((m, idx) => {
      const row = document.createElement('div');
      row.className = 'atlas-row atlas-map-picker-row' + (idx === this.highlightIndex ? ' selected' : '');
      row.setAttribute('role', 'button');
      row.tabIndex = 0;

      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined';
      icon.textContent = 'map';
      row.appendChild(icon);

      const main = document.createElement('span');
      main.className = 'atlas-row-main';
      main.textContent = m.name || '(untitled map)';
      row.appendChild(main);

      if (typeof m.hierarchy === 'number') {
        const meta = document.createElement('span');
        meta.className = 'atlas-row-meta';
        meta.style.marginLeft = 'auto';
        meta.textContent = `h${m.hierarchy}`;
        row.appendChild(meta);
      }

      row.addEventListener('click', () => this.pick(idx));
      row.addEventListener('mouseenter', () => this.setHighlight(idx));
      list.appendChild(row);
      this.rows.push(row);
    });
    body.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'atlas-modal-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'atlas-btn-ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.cancel());
    actions.appendChild(cancelBtn);
    body.appendChild(actions);

    this.modal = overlay;
    this.show();

    // Custom Esc + arrow-key navigation. Layer over BaseModal's own Esc
    // handler — call hide via cancel() so we emit a null result.
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.cancel();
        document.removeEventListener('keydown', keyHandler);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.setHighlight(Math.min(this.highlightIndex + 1, this.maps.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.setHighlight(Math.max(this.highlightIndex - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.pick(this.highlightIndex);
      }
    };
    document.addEventListener('keydown', keyHandler);

    // Outside-click cancels (BaseModal's listener hides without resolving;
    // wrap to emit null first).
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.cancel();
        document.removeEventListener('keydown', keyHandler);
      }
    });
  }

  private setHighlight(idx: number): void {
    this.highlightIndex = idx;
    this.rows.forEach((row, i) => row.classList.toggle('selected', i === idx));
  }

  private pick(idx: number): void {
    if (this.resolved) return;
    this.resolved = true;
    this.onDone({ map: this.maps[idx] });
    this.hide();
  }

  private cancel(): void {
    if (this.resolved) return;
    this.resolved = true;
    this.onDone(null);
    this.hide();
  }
}
