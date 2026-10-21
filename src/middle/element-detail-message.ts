/**
 * The From and To line on a message (#526; the rule is `src/core/message-parties.ts`).
 * Each name links to its Character; the line is a reading aid, never an editor,
 * so it is the same in a view-only world.
 */
import { getState } from '../core/state';
import { elementHash } from '../core/router';
import { messageParties, type MessageParty } from '../core/message-parties';
import type { Element } from '../core/types';

export function buildMessageParties(el: Element): HTMLElement | null {
  const state = getState();
  const worldId = state.active?.worldId;
  if (!worldId) return null;
  const parties = messageParties(el, state.data.elements);
  if (!parties) return null;

  const line = document.createElement('p');
  line.className = 'atlas-message-parties';
  line.dataset.role = 'message-parties';
  const link = (p: MessageParty): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.href = elementHash(worldId, p.id);
    a.textContent = p.name;
    return a;
  };
  const label = (text: string): HTMLElement => {
    const s = document.createElement('span');
    s.className = 'atlas-message-parties-label';
    s.textContent = text;
    return s;
  };
  if (parties.from) {
    line.append(label('From'), ' ', link(parties.from));
  }
  if (parties.to.length > 0) {
    if (parties.from) line.append(' · ');
    line.append(label('To'), ' ');
    parties.to.forEach((p, i) => {
      if (i > 0) line.append(', ');
      line.append(link(p));
    });
  }
  return line;
}
