/**
 * The `?` help overlay (Bout HELP, workplan D8) — ONE shape for every room:
 * what this room is for, a few "you can…" lines, then the full keyboard +
 * gesture reference (unified with the old hotkey modal, which this replaces).
 *
 * Room-aware: derives the current room from the URL when opened via the `?`
 * hotkey. Content strings live in `help-content.ts`; the shortcut list stays
 * auto-generated from the hotkeys dispatcher via `buildShortcutsContent()`.
 */

import { BaseModal } from './modal-base';
import { buildShortcutsContent } from './shortcuts-content';
import { helpForRoom } from './help-content';
import { parseHash } from '../core/router';

class HelpOverlay extends BaseModal {
  open(roomMode?: string): void {
    const mode = roomMode ?? parseHash(window.location.hash).mode ?? '';
    const help = helpForRoom(mode);

    const { overlay, body } = this.buildModalShell({
      title: help ? `${help.name} — help` : 'Help',
      dataModal: 'help-overlay',
    });

    if (help) {
      const purpose = document.createElement('p');
      purpose.className = 'atlas-help-purpose';
      purpose.textContent = help.purpose;
      body.appendChild(purpose);

      const canHead = document.createElement('h3');
      canHead.className = 'atlas-help-can-head';
      canHead.textContent = 'You can';
      body.appendChild(canHead);

      const list = document.createElement('ul');
      list.className = 'atlas-help-can';
      for (const line of help.can) {
        const li = document.createElement('li');
        li.textContent = line;
        list.appendChild(li);
      }
      body.appendChild(list);

      const divider = document.createElement('div');
      divider.className = 'atlas-help-divider';
      body.appendChild(divider);
    }

    const shortcutsHead = document.createElement('h3');
    shortcutsHead.className = 'atlas-help-can-head';
    shortcutsHead.textContent = 'Keyboard and mouse';
    body.appendChild(shortcutsHead);
    body.appendChild(buildShortcutsContent());

    this.modal = overlay;
    this.show();
  }
}

export function openHelpOverlay(roomMode?: string): void {
  new HelpOverlay().open(roomMode);
}
