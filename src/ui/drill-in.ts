/**
 * Drill-in prefix band (workplan D1) — the back affordance for entities you
 * fell into from a room list. A muted, clickable room-name prefix
 * (`‹ Knowledge`) opens the entity's `.atlas-middle-header`, BEFORE the kind
 * icon + title: back gets a name, and the room label never disappears.
 *
 * Call sites: knowledge entries + knowers, share pages. The ELEMENT room is
 * exempt (elements aren't a room you fell into) and the writing workspace
 * keeps its breadcrumb (already does this job).
 *
 * Styling in atlas.css under `.atlas-drillin-prefix`.
 */

export function makeDrillInPrefix(roomLabel: string, onBack: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-drillin-prefix';
  btn.title = `Back to ${roomLabel.toLowerCase()}`;
  const chevron = document.createElement('span');
  chevron.className = 'atlas-drillin-chevron';
  chevron.textContent = '‹';
  btn.appendChild(chevron);
  btn.appendChild(document.createTextNode(roomLabel));
  btn.addEventListener('click', onBack);
  return btn;
}
