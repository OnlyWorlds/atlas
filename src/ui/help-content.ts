/**
 * Per-room help content (Bout HELP, workplan D8) — ALL the strings in one
 * file, cheap to maintain. Voice: Part 3 rules — one-sentence purpose,
 * verb-first "you can" lines, no model-speak, no em-dash appositives.
 *
 * Consumed by `help-overlay.ts` (the `?` overlay). Room keys mirror the
 * router's middle modes.
 */

export interface RoomHelp {
  /** Sentence-case room name for the overlay title. */
  name: string;
  /** ONE sentence: what this room is for. */
  purpose: string;
  /** 3-4 verb-first "you can…" lines. */
  can: string[];
}

export const HELP_CONTENT: Record<string, RoomHelp> = {
  home: {
    name: 'Home',
    purpose: 'Your world at a glance, and the fastest way back into it.',
    can: [
      'edit the world name and description by clicking them',
      'set a protagonist or home from any character or location header',
      'jump to any element type from the stat line',
      'pick up where you left off from the Continue list',
    ],
  },
  element: {
    name: 'Element',
    purpose: 'Every field of one element, in the shared OnlyWorlds shape.',
    can: [
      'edit any field by clicking its value',
      'link elements through the link fields',
      'label it your way with supertype and subtype',
      'add your own fields in the Custom fields section',
      'place it on a map from the header pin button',
    ],
  },
  writing: {
    name: 'Writing',
    purpose: 'Write your world in a nested tree of books, chapters, and scenes.',
    can: [
      'rename the tiers to fit your project',
      'type @ to mention an element and link it',
      'keep loose drafts beside the tree',
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
    purpose: 'Your world along a time axis.',
    can: [
      'click any element to focus on what it touches',
      'set the world\'s current moment and drag undated elements onto the axis',
      'focus a title or character to see its tenure or life drawn to the now',
      'filter by type and zoom into a period (no types picked = the cast and essentials, not everything)',
      'save a chart and reload it from the gallery',
      'drop a saved chart onto a share page',
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
      'drop or paste JSON and review before anything lands',
      'merge into the current world or create a new one',
      'export the whole world or a subset by type',
      'turn freeform notes into importable JSON with any AI assistant',
    ],
  },
  settings: {
    name: 'Settings',
    purpose: 'Atlas-wide preferences and per-world configuration.',
    can: [
      'connect your OnlyWorlds account for sync and publishing',
      'choose how sync behaves, or keep a world fully local',
      'rename the writing tiers',
      'tune editing and context-pane behavior',
    ],
  },
};

/** Resolve help for a router middle-mode; null = no help surface (welcome). */
export function helpForRoom(mode: string): RoomHelp | null {
  return HELP_CONTENT[mode] ?? null;
}
