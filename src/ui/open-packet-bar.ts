/**
 * The work packet bar (OW Parlor #487): a link that names several elements
 * (a parlor work item, the doctor's list) opens the first and shows this bar,
 * "2 of 7", with Previous and Next, until it is closed or another world opens.
 * It only moves between elements; it never edits or marks anything.
 */
import { getState, subscribe } from '../core/state';
import { elementHash, navigate } from '../core/router';

let bar: HTMLElement | null = null;
let unsub: (() => void) | null = null;

export function closePacketBar(): void {
  unsub?.();
  unsub = null;
  bar?.remove();
  bar = null;
}

/** `reasons`: a work packet's reason for each element (a Work item's packet, `core/work-packet.ts`), shown as the bar reaches it. */
export function openPacketBar(localWorldId: string, ids: readonly string[], missing: number, reasons?: ReadonlyMap<string, string>): void {
  closePacketBar();
  if (ids.length < 2) return;
  let index = 0;
  const el = document.createElement('div');
  el.className = 'atlas-packet-bar';
  el.dataset.role = 'packet-bar';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Elements from a link');

  const label = document.createElement('span');
  label.className = 'atlas-packet-bar-count';
  label.setAttribute('aria-live', 'polite');
  const prev = button('Previous', 'packet-prev');
  const next = button('Next', 'packet-next');
  const close = button('Close', 'packet-close');
  el.append(label, prev, next, close);
  if (missing > 0) {
    const note = document.createElement('span');
    note.className = 'atlas-packet-bar-note';
    note.textContent = `${missing} not in this world`;
    el.insertBefore(note, prev);
  }

  const reason = document.createElement('span');
  reason.className = 'atlas-packet-bar-reason';
  reason.dataset.role = 'packet-reason';
  if (reasons) el.appendChild(reason);

  const show = (): void => {
    label.textContent = `${index + 1} of ${ids.length}`;
    const why = reasons?.get(ids[index]) ?? '';
    reason.textContent = why;
    reason.hidden = !why;
    prev.disabled = index === 0;
    next.disabled = index === ids.length - 1;
    navigate(elementHash(localWorldId, ids[index]));
  };
  prev.addEventListener('click', () => { if (index > 0) { index--; show(); } });
  next.addEventListener('click', () => { if (index < ids.length - 1) { index++; show(); } });
  close.addEventListener('click', closePacketBar);

  document.body.appendChild(el);
  bar = el;
  // Another world opened, or this one closed: the packet was about this world.
  unsub = subscribe(() => {
    if (getState().active?.worldId !== localWorldId) closePacketBar();
  });
  show();
}

function button(text: string, role: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'atlas-btn-ghost';
  b.dataset.role = role;
  b.textContent = text;
  return b;
}
