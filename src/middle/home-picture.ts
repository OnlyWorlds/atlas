/**
 * The world's picture on Home (onboarding step 2, #840's C3): the right
 * pane's Web, mounted small, centred on the world's best-linked element, for
 * a world with one worth drawing.
 *
 *   Who may be the centre is the SDK's (`worldGraph`'s nodes for the owner:
 *   the room, proposed and hidden elements, map space (Maps, Pins, Markers; a
 *   Zone is a node, as the Web draws it, since SDK 4.111.0) and the reading
 *   aids are out); how linked it is, is the Web's own count (its ring one,
 *   less the switched-off types), so a link the Web leaves undrawn
 *   (`parent_narrative`) never ranks a centre the Web then draws bare. The
 *   most linked with at least three around it is the centre, a tie to the
 *   first by id. None: no picture.
 *
 *   Ranked once per world, what its elements say, the lore's switches and the
 *   Web's switched-off types: never on an idle sync round or a loading tick.
 *
 *   A press on the centre, or See <name>'s world, opens the Web on it.
 */

import { worldGraph } from '@onlyworlds/sdk';
import type { Element, ElementType } from '../core/types';
import { getState } from '../core/state';
import { currentLore, loreSwitches } from '../core/parlor-room';
import { buildWebLinks, mountContextGraph, ringOneOf, type GraphHandle } from '../tabs/right/context-pane-graph';
import { openWebOn } from '../ui/open-web';
import { typeName } from '../core/type-words';

/** How many of the best-linked are tried, and how many the Web must draw around one. */
const AROUND = 3;
/** Ring one's cap on Home: the picture is a glance, the Web is the room. */
const HOME_RING_CAP = 12;

let memoKey: string | null = null;
let memoSaid: string | null = null;
let memoCentre: string | null = null;
let ranks = 0;

/** Test seam: how many times the centre was ranked (the memo's misses). */
export function homePictureRanks(): number { return ranks; }

function filtersOf(worldId: string): string[] {
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  return [...(entry?.context_filters_off ?? [])].sort();
}

/**
 * The picture's centre, or null. `said` is Home's own serialisation of the
 * elements, so a fresh array that says the same thing ranks nothing again.
 */
export function homeCentre(worldId: string, said: string): string | null {
  const filters = filtersOf(worldId);
  // The world's words compared as they are, never copied into the key (the code gate's C9).
  const key = JSON.stringify([worldId, loreSwitches(), filters]);
  if (key === memoKey && said === memoSaid) return memoCentre;
  memoKey = key;
  memoSaid = said;
  ranks++;
  memoCentre = rankCentre(getState().data.elements, new Set(filters));
  return memoCentre;
}

function rankCentre(all: readonly Element[], hidden: ReadonlySet<string>): string | null {
  let nodes: string[];
  try {
    nodes = worldGraph({ elements: all }, { rung: 'owner' }).nodes.map(n => n.id);
  } catch {
    return null;
  }
  const lore = currentLore();
  const byId = new Map(lore.map(e => [e.id, e] as const));
  // One build serves every candidate: none is a pin or a marker, the only centres that change it.
  const links = buildWebLinks(lore, '');
  let best: string | null = null;
  let bestCount = AROUND - 1;
  // The graph's own order (by id), so a tie keeps the first and the centre never flickers.
  for (const id of nodes) {
    const el = byId.get(id);
    if (!el || hidden.has(el.type)) continue;
    const { cast, back } = ringOneOf(links, id);
    let around = 0;
    for (const other of [...cast, ...back]) {
      const t = byId.get(other)?.type;
      if (t && !hidden.has(t)) around++;
    }
    if (around > bestCount) { best = id; bestCount = around; }
  }
  return best;
}

export interface HomePicture {
  section: HTMLElement;
  /** Draw the Web, once the section is in the document. */
  mount(): void;
  destroy(): void;
}

/** The section and its graph, or null when the world has no centre worth drawing. */
export function buildHomePicture(worldId: string, said: string): HomePicture | null {
  const centreId = homeCentre(worldId, said);
  const centre = centreId ? getState().data.elements.find(e => e.id === centreId) : undefined;
  if (!centre) return null;
  // An unnamed centre reads as its type, as the guide's notes do (the code gate's C10).
  const named = typeof centre.name === 'string' && centre.name.trim() ? centre.name.trim() : null;
  const name = named ?? `this ${typeName(centre.type)}`;

  const section = document.createElement('section');
  section.className = 'atlas-home-picture';
  section.setAttribute('data-role', 'home-picture');
  const head = document.createElement('div');
  head.className = 'atlas-home-picture-head';
  const title = document.createElement('h3');
  title.className = 'atlas-home-section-title atlas-home-picture-title';
  title.textContent = named ? `${named} and what it touches` : `This ${typeName(centre.type)} and what it touches`;
  const see = document.createElement('button');
  see.type = 'button';
  see.className = 'atlas-btn-link atlas-home-picture-see';
  see.setAttribute('data-action', 'home-picture-see');
  see.setAttribute('role', 'link');
  see.textContent = `See ${name}'s world`;
  see.addEventListener('click', () => openWebOn(worldId, centre.id));
  head.append(title, see);
  const host = document.createElement('div');
  host.className = 'atlas-context-pane-graph atlas-home-picture-graph';
  section.append(head, host);

  let handle: GraphHandle | null = null;
  return {
    section,
    mount(): void {
      if (handle || !section.isConnected) return;
      handle = mountContextGraph({
        host,
        subject: centre,
        onSelect: () => {},
        hiddenTypes: new Set(filtersOf(worldId)) as ReadonlySet<ElementType>,
        hopDepth: 1,
        onCenterPress: id => openWebOn(worldId, id),
        wheelZoom: false,
        ringCap: HOME_RING_CAP,
        contextMenu: false,
      });
    },
    destroy(): void {
      handle?.destroy();
      handle = null;
    },
  };
}

/** Test seam: forget the ranked centre. */
export function resetHomePictureForTests(): void {
  memoKey = null;
  memoSaid = null;
  memoCentre = null;
  ranks = 0;
}
