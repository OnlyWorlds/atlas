/**
 * Per-room help content (Bout HELP, workplan D8) — ALL the strings in one
 * file, cheap to maintain. Voice: Part 3 rules — one-sentence purpose,
 * verb-first "you can" lines, no model-speak, no em-dash appositives.
 *
 * Consumed by `help-overlay.ts` (the `?` overlay). Room keys mirror the
 * router's middle modes.
 */

import { getState } from '../core/state';
import { hasFolderMode } from '../core/capabilities';
import { filesWhereOf } from '../core/browser-worlds';
import { isCoarsePointer } from '../core/pointer';

/**
 * A line that names a mouse or key gesture carries its touch line (#279):
 * `touch: null` leaves it out on a touch screen, where it is not true.
 */
export type HelpLine = string | { mouse: string; touch: string | null };

export interface RoomHelp {
  /** Sentence-case room name for the overlay title. */
  name: string;
  /** ONE sentence: what this room is for. */
  purpose: string;
  /** 3-4 verb-first "you can…" lines. */
  can: HelpLine[];
  /** Lines true only for a world kept in a folder; left out for a browser world or a browser without folders. */
  folderCan?: string[];
}

export const HELP_CONTENT: Record<string, RoomHelp> = {
  home: {
    name: 'Home',
    purpose: 'Your world at a glance, and the fastest way back into it.',
    can: [
      'edit the world name and description by clicking them',
      'set a protagonist or home from any character or location header',
      'jump to any element type from the stat line',
      'pick up where you left off from the Recent list',
      'answer "What do you have?" on an empty world, then grow it from the cards; each kind of element opens its room',
    ],
  },
  element: {
    name: 'Element',
    purpose: 'Every field of one element, in the shared OnlyWorlds shape.',
    can: [
      'edit any field by clicking its value',
      'link elements through the link fields',
      'create a missing element straight from an empty link field',
      'label it your way with supertype and subtype',
      'add your own fields in the Custom fields section',
      'place it on a map from the header pin button',
      { mouse: 'right-click a type in the sidebar strip to keep it out of the full list (pins and markers start that way)', touch: 'tap Hide types at the end of the sidebar strip, then tap a type to keep it out of the full list (pins and markers start that way)' },
      'see in the Web tab where it is mentioned but not linked, and link every mention with one click',
    ],
  },
  writing: {
    name: 'Writing',
    purpose: 'Write your world in a nested tree of books, chapters, and scenes.',
    can: [
      'rename the tiers to fit your project',
      'type @ to mention an element and link it',
      {
        mouse: 'link every unlinked mention at once from the corner link icon; right-click a selection or a tree row for the same',
        touch: 'link every unlinked mention at once from the corner link icon',
      },
      { mouse: 'find a word with Ctrl+F and link every match to one element; on a chapter or book this reaches every scene inside', touch: 'find a word with the search button over the text, and link every match to one element; on a chapter or book this reaches every scene inside' },
      { mouse: 'create a chapter or scene inside a row with its hover +', touch: 'create a chapter or scene inside a row with its +' },
      'split a long piece into siblings at the cursor',
    ],
  },
  knowledge: {
    name: 'Knowledge',
    purpose: 'What the characters and circles of your world know.',
    can: [
      'give knowledge to a character or a circle',
      'hold knowledge as one character directly; two or more knowers become a circle',
      'use any collective as a circle: its members inherit what it holds',
      'open anyone\'s known world to see through their eyes',
      'create a circle without leaving an entry',
      'type @ to mention the elements the knowledge concerns',
    ],
  },
  timeline: {
    name: 'Charts',
    purpose: 'Your world along a time axis, in your world\'s own words.',
    can: [
      'click any element to focus on what it touches',
      'set the world clock, then create a calendar: dates read as "12 Frostwane, Year 454" and you can type calendar words into any date field',
      {
        mouse: 'drag things into time: an undated element onto the axis, a dot to re-date it, a range\'s end cap to stretch it, the now-line to move the now',
        touch: 'give an element its date on its own page, and the chart places it',
      },
      'focus a title or character to see its tenure or life drawn to the now',
      {
        mouse: 'filter by type and zoom from eras down to days (no types picked = the cast and essentials, not everything)',
        touch: 'filter by type (no types picked = the cast and essentials, not everything)',
      },
      'switch to the document view and scroll through your history: eras section it, skipped time is named, the now is a seam you scroll across',
      { mouse: 'save a chart and reload it from the gallery, or drop it onto a share page', touch: 'save a chart and reload it from the gallery, or put it on a page with + chart in Pages' },
    ],
  },
  share: {
    name: 'Pages',
    purpose: 'Build pages from your world to share with a group or publish for anyone.',
    can: [
      'stack blocks: headings, text, cards, collections, maps, charts, circles',
      'preview exactly what a visitor will see',
      'publish to a public URL when the world is online',
      'copy any page as JSON to use elsewhere',
    ],
  },
  import: {
    name: 'Data',
    purpose: 'Bring OnlyWorlds data into atlas, or take your world out as a file.',
    can: [
      { mouse: 'drop or paste JSON and review before anything lands', touch: 'choose a .json or a world file .zip, or paste JSON, and review before anything lands' },
      'merge into the current world or create a new one',
      'export the whole world or a subset by type',
      'copy the AI prompt (it carries your world\'s exact fields) to turn freeform notes into importable JSON',
    ],
    folderCan: [
      'or let an AI assistant edit the world folder directly: Atlas shows its changes when you come back to its window',
    ],
  },
  settings: {
    name: 'Settings',
    purpose: 'Atlas-wide preferences and per-world configuration.',
    can: [
      'connect your OnlyWorlds account for sync and publishing',
      'choose how sync behaves, or keep a world fully local',
      'rename the writing tiers',
      'tune editing and web-pane behavior',
      'hide the row of add-world icons (General); "Add a world" stays',
    ],
  },
  // `map` is a real router mode (router.ts:207) and was the ONLY one with no
  // entry here, so `?` on a map resolved to null and opened nothing at all —
  // in the subsystem carrying the most concepts a user has to be taught.
  map: {
    name: 'Maps',
    purpose: 'Place your world in space: maps, the pins that put elements on them, and zones that give regions a shape.',
    can: [
      'create a map with no image at all and sketch on a blank canvas; attach a picture later and your pins and zones scale to fit it',
      {
        mouse: 'place an element with the + pin button on its header, then click the map (drag a pin to move it, and click one any time to travel back to the element)',
        touch: 'place an element with the + pin button on its header, then tap the map (slide a pin with your finger to move it, and tap one any time to travel back to the element)',
      },
      { mouse: 'draw a zone with the polygon or line tool, then double-click it to reshape it by its handles', touch: null },
      'nest maps under a parent map or a location, and switch between them from the map list',
      'tune what a map shows from its settings: pin style and labels, zone opacity, the grid',
      'colour zones by kind from the zones button: a swatch, an eye and a tune button per kind, saved with the world',
      {
        mouse: 'hover a zone to see all of it; on a crowded map the labels that fit are shown and the rest appear as you zoom in',
        touch: 'on a crowded map the labels that fit are shown and the rest appear as you pinch in',
      },
    ],
  },
};

/** Help as the overlay shows it: each line resolved for this pointer. */
export interface ResolvedHelp {
  name: string;
  purpose: string;
  can: string[];
}

function resolveLines(lines: readonly HelpLine[], touch: boolean): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const text = typeof line === 'string' ? line : touch ? line.touch : line.mouse;
    if (text !== null) out.push(text);
  }
  return out;
}

/** Resolve help for a router middle-mode; null = no help surface (welcome). */
export function helpForRoom(mode: string, touch: boolean = isCoarsePointer()): ResolvedHelp | null {
  const help = HELP_CONTENT[mode];
  if (!help) return null;
  const can = resolveLines(help.can, touch);
  if (!help.folderCan) return { name: help.name, purpose: help.purpose, can };
  // Folder-only lines need a browser with folders and an open world kept in one.
  const { registry, active } = getState();
  const entry = registry.worlds.find(w => w.id === active?.worldId);
  const inFolder = hasFolderMode() && filesWhereOf(entry) === 'folder';
  return { name: help.name, purpose: help.purpose, can: inFolder ? [...can, ...help.folderCan] : can };
}
