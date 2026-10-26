/**
 * The browser tab title follows the route (lane A A11): an element,
 * the room, the world, then "Atlas". Before this every tab and every Back
 * history entry read "Atlas · OnlyWorlds", so two atlas tabs side by side
 * could not be told apart. Recomputed on hash changes and on state ticks
 * (names load after the route flips); written only when it changes.
 */
import { getState, subscribe } from '../core/state';
import { parseHash, onHashChange } from '../core/router';

const ROOM_LABELS: Partial<Record<string, string>> = {
  writing: 'Writing',
  knowledge: 'Knowledge',
  timeline: 'Charts',
  share: 'Pages',
  import: 'Import',
  settings: 'Settings',
  demo: 'Example page',
};

export function computeDocumentTitle(): string {
  const route = parseHash(window.location.hash);
  const st = getState();
  const world = route.worldId ? st.registry.worlds.find(w => w.id === route.worldId)?.name : undefined;
  const subjectId = route.elementId ?? route.narrativeId;
  const subject = subjectId ? st.data.elements.find(e => e.id === subjectId)?.name : undefined;
  const room = ROOM_LABELS[route.mode];
  const parts = [typeof subject === 'string' ? subject : undefined, subject ? undefined : room, world, 'Atlas'];
  return parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(' · ');
}

export function installDocumentTitle(): void {
  const apply = (): void => {
    const next = computeDocumentTitle();
    if (document.title !== next) document.title = next;
  };
  onHashChange(apply);
  subscribe(apply);
  apply();
}
