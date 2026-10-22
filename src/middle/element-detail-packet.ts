/**
 * A Work item's packet on its page (OW Parlor #487; the rule is `src/core/work-packet.ts`):
 * the elements it names in the producer's order, each with its reason, and one
 * button that steps through them with the packet bar. A reading aid, never an
 * editor, so it is the same in a view-only world.
 */
import { getState } from '../core/state';
import { elementHash, navigate } from '../core/router';
import { readPacket, packetHere } from '../core/work-packet';
import { openPacketBar } from '../ui/open-packet-bar';
import type { Element, ElementType } from '../core/types';
import { ELEMENT_LABELS } from '../core/constants';

export function buildWorkPacket(el: Element): HTMLElement | null {
  const state = getState();
  const worldId = state.active?.worldId;
  if (!worldId) return null;
  const packet = readPacket(el);
  if (!packet) return null;
  const byId = new Map(state.data.elements.map(e => [e.id, e]));
  const { found, missing } = packetHere(packet, id => byId.has(id));

  const box = document.createElement('section');
  box.className = 'atlas-work-packet';
  box.dataset.role = 'work-packet';
  const head = document.createElement('h3');
  head.className = 'atlas-work-packet-head';
  const n = packet.entries.length;
  head.textContent = `Work packet · ${n} element${n === 1 ? '' : 's'}`;
  box.appendChild(head);
  if (packet.producer) {
    const by = document.createElement('p');
    by.className = 'atlas-work-packet-meta';
    by.textContent = `Made by ${packet.producer}`;
    box.appendChild(by);
  }

  const list = document.createElement('ol');
  list.className = 'atlas-work-packet-list';
  for (const entry of packet.entries) {
    const li = document.createElement('li');
    const target = byId.get(entry.id);
    if (target) {
      const a = document.createElement('a');
      a.href = elementHash(worldId, entry.id);
      a.textContent = typeof target.name === 'string' && target.name.trim() ? target.name.trim() : 'Unnamed';
      li.appendChild(a);
    } else {
      const gone = document.createElement('span');
      gone.className = 'atlas-work-packet-missing';
      // The type as the rest of the page says it, capitalised (Seethe's read of 1.69.0, h20 #9806).
      const label = ELEMENT_LABELS[entry.type as ElementType]?.singular ?? entry.type;
      const typeWord = label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
      gone.textContent = `Not in this world${typeWord ? ` (${typeWord})` : ''}`;
      li.appendChild(gone);
    }
    if (entry.reason) {
      const why = document.createElement('span');
      why.className = 'atlas-work-packet-reason';
      why.textContent = entry.reason;
      li.append(' · ', why);
    }
    list.appendChild(li);
  }
  box.appendChild(list);

  if (found.length > 0) {
    const step = document.createElement('button');
    step.type = 'button';
    step.className = 'atlas-btn-ghost';
    step.dataset.role = 'work-packet-step';
    step.textContent = found.length === 1 ? 'Open it' : `Step through ${found.length === n ? 'them' : `the ${found.length} here`}`;
    step.addEventListener('click', () => {
      if (found.length === 1) { navigate(elementHash(worldId, found[0].id)); return; }
      const reasons = new Map(found.map(e => [e.id, e.reason]));
      openPacketBar(worldId, found.map(e => e.id), missing.length, reasons);
    });
    box.appendChild(step);
  }
  return box;
}
