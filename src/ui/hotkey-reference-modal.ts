/**
 * Hotkey reference modal — `?` keyboard binding lists all shortcuts + gestures.
 *
 * Content is built by `buildShortcutsContent()` (shared with the sidebar
 * footer's `?` icon popover) so adding a binding to `core/hotkeys.ts` surfaces
 * it in both places automatically.
 */

import { BaseModal } from './modal-base';
import { buildShortcutsContent } from './shortcuts-content';

class HotkeyReferenceModal extends BaseModal {
  open(): void {
    const { overlay, body } = this.buildModalShell({
      title: 'Keyboard shortcuts',
      dataModal: 'hotkey-reference',
    });
    body.appendChild(buildShortcutsContent());
    this.modal = overlay;
    this.show();
  }
}

export function openHotkeyReferenceModal(): void {
  new HotkeyReferenceModal().open();
}
