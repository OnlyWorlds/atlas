/**
 * Hotkey reference modal — `?` lists every installed binding, grouped by scope.
 *
 * Content is auto-generated from `getInstalledBindings()`, so adding a binding
 * to the table in `core/hotkeys.ts` makes it discoverable here for free.
 */

import { BaseModal } from './modal-base';
import { formatCombo, getInstalledBindings, type HotkeyBinding } from '../core/hotkeys';

class HotkeyReferenceModal extends BaseModal {
  open(): void {
    const { overlay, body } = this.buildModalShell({
      title: 'keyboard shortcuts',
      dataModal: 'hotkey-reference',
    });
    body.appendChild(buildContent(getInstalledBindings()));
    this.modal = overlay;
    this.show();
  }
}

function buildContent(bindings: HotkeyBinding[]): HTMLElement {
  const root = document.createElement('div');
  root.className = 'atlas-hotkey-reference';

  // Group by scope; preserve declaration order within each group.
  const grouped = new Map<string, HotkeyBinding[]>();
  for (const b of bindings) {
    const list = grouped.get(b.scope);
    if (list) list.push(b);
    else grouped.set(b.scope, [b]);
  }

  // Order scopes deterministically.
  const scopeOrder = ['Global', 'Sidebar', 'Editor', 'Map'];
  const scopes = scopeOrder.filter(s => grouped.has(s));
  for (const [scope] of grouped) {
    if (!scopes.includes(scope)) scopes.push(scope);
  }

  for (const scope of scopes) {
    const section = document.createElement('div');
    section.className = 'atlas-hotkey-section';
    const header = document.createElement('div');
    header.className = 'atlas-hotkey-section-header';
    header.textContent = scope.toLowerCase();
    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'atlas-hotkey-list';
    for (const b of grouped.get(scope)!) {
      const row = document.createElement('div');
      row.className = 'atlas-hotkey-row';

      const combo = document.createElement('span');
      combo.className = 'atlas-hotkey-combo';
      combo.textContent = formatCombo(b);
      row.appendChild(combo);

      const desc = document.createElement('span');
      desc.className = 'atlas-hotkey-desc';
      desc.textContent = b.description.toLowerCase();
      row.appendChild(desc);

      list.appendChild(row);
    }
    section.appendChild(list);
    root.appendChild(section);
  }

  return root;
}

export function openHotkeyReferenceModal(): void {
  new HotkeyReferenceModal().open();
}
