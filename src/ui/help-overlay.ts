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
import { isCoarsePointer } from '../core/pointer';
import { lanternLineHtml } from '../core/ow-site';
import { getState } from '../core/state';

/** True while the right pane's active tab is a map (its address stays the room's). */
function rightPaneShowsMap(): boolean {
  const ui = getState().ui;
  return ui.rightTabs[ui.rightActiveIndex]?.kind === 'map';
}

class HelpOverlay extends BaseModal {
  open(roomMode?: string): void {
    const mode = roomMode ?? parseHash(window.location.hash).mode ?? '';
    const help = helpForRoom(mode);

    const { overlay, body } = this.buildModalShell({
      title: help ? `${help.name} · help` : 'Help',
      dataModal: 'help-overlay',
      // The content outgrew the viewport once the shortcut reference filled in:
      // the panel caps its height and the BODY scrolls, so the title
      // stays put and neither end is ever clipped.
      panelClass: 'atlas-help-panel',
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

      // A map open in the right pane leaves the address on the room, so its
      // help would never show there: the map's lines follow the room's (Titus,
      // 2026-10-15).
      const mapHelp = mode !== 'map' && rightPaneShowsMap() ? helpForRoom('map') : null;
      if (mapHelp) {
        const mapHead = document.createElement('h3');
        mapHead.className = 'atlas-help-can-head';
        mapHead.textContent = 'On the open map';
        body.appendChild(mapHead);
        const mapList = document.createElement('ul');
        mapList.className = 'atlas-help-can';
        mapList.setAttribute('data-role', 'help-open-map');
        for (const line of mapHelp.can) {
          const li = document.createElement('li');
          li.textContent = line;
          mapList.appendChild(li);
        }
        body.appendChild(mapList);
      }

      const divider = document.createElement('div');
      divider.className = 'atlas-help-divider';
      body.appendChild(divider);
    }

    // A touch screen gets no key or right-click reference (#279): it could
    // use none of it. It hears of Lantern instead, the app made for a phone.
    if (isCoarsePointer()) {
      const touchHead = document.createElement('h3');
      touchHead.className = 'atlas-help-can-head';
      touchHead.textContent = 'On a touch screen';
      body.appendChild(touchHead);
      const touch = document.createElement('p');
      touch.className = 'atlas-help-purpose';
      touch.textContent = 'Tap to open and edit, and pinch to zoom a map. Shortcuts need a keyboard.';
      body.appendChild(touch);
      const lantern = document.createElement('p');
      lantern.className = 'atlas-help-purpose atlas-help-lantern';
      lantern.innerHTML = lanternLineHtml();
      body.appendChild(lantern);
    } else {
      const shortcutsHead = document.createElement('h3');
      shortcutsHead.className = 'atlas-help-can-head';
      shortcutsHead.textContent = 'Keyboard and mouse';
      body.appendChild(shortcutsHead);
      body.appendChild(buildShortcutsContent());
    }

    this.modal = overlay;
    this.show();
  }
}

export function openHelpOverlay(roomMode?: string): void {
  new HelpOverlay().open(roomMode);
}
