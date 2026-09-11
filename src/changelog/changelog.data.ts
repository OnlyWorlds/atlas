/**
 * Atlas public changelog — the single edit surface.
 *
 * This typed data drives the static `changelog.html` (emitted by
 * `scripts/build-changelog.mts` via `render-changelog.ts`). The workflow law:
 * every user-visible change lands its entry HERE in the same commit as the
 * fix, then `npm run changelog` regenerates the page.
 *
 * GROUNDING RULE: entries describe what actually shipped; credits name only
 * real, confirmed contributors. Reddit/community credits carry a `threadUrl`
 * that links the REQUEST THREAD, never a person's profile. AI-collaborator and
 * broader credits are Captain's call to add (design Q3 left open) — seeded
 * conservatively below.
 */

export type CreditPlatform = 'reddit' | 'discord' | 'collaborator' | 'onlyworlds';

export interface ChangelogCredit {
  /** Display handle, e.g. "u/someone" or "Freek". */
  handle: string;
  platform: CreditPlatform;
  /** Links the request/discussion thread — the context, never a profile. */
  threadUrl?: string;
}

export interface ChangelogEntry {
  /** Stable slug — the `:target` anchor. Never renumber; it is a permalink. */
  id: string;
  title: string;
  /** One or two plain sentences. No em-dashes in user copy (voice law). */
  body?: string;
  /** Category tags rendered as palette pills. */
  tags: string[];
  /** Present when the change was requested or shaped by someone. */
  credit?: ChangelogCredit;
}

export interface ChangelogRelease {
  /** Semver-ish drop number, e.g. "1.0", "1.1". */
  version: string;
  /** ISO date the drop shipped. */
  date: string;
  /** One-line release theme (Raycast/Linear style). */
  theme: string;
  entries: ChangelogEntry[];
}

/**
 * Newest release first.
 *
 * v1 RESET (Captain, S318 launch day): the page opens as ONE clean v1.0
 * block — the launch state, dated launch day — ready to changelog on top of.
 * The pre-launch drops (the old 1.0 of 2026-07-19 and the 1.1 polish set)
 * were folded in: nothing had shipped publicly yet, so a history of drops
 * nobody could have used was noise wearing a version number.
 */
export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '1.5',
    date: '2026-09-11',
    theme: 'a map with two hundred places on it is still a map',
    entries: [
      {
        id: 'map-labels-fit',
        title: 'Map labels show every name that has room, and pins make room for each other',
        body: 'A map with hundreds of pins and zones used to draw every label on top of every other. Labels now claim their space in order of how much the world points at them: the names that fit are shown, a name that has no room below its pin tries beside or above it, and the rest appear as you zoom in. Pins on a crowded map shrink so they stop covering each other and grow back as you zoom. The old "always" mode is one click away in the map settings.',
        tags: ['maps'],
      },
      {
        id: 'sidebar-muted-types',
        title: 'Right-click a type in the sidebar to keep it out of the full list',
        body: 'A world with thousands of pins and markers should still read as its places. Pins and markers now sit in the last two filter slots, greyed: they stay out of the list when you show everything and appear when you click their filter. Right-click any type to mute or unmute it; the choice is remembered per world.',
        tags: ['sidebar'],
      },
      {
        id: 'colour-picker-and-toolbar',
        title: 'A colour picker that belongs, and fit-to-image beside the map door',
        body: 'Picking a colour for a kind of zone opens a small atlas panel with presets, a hex field and an Apply button instead of the browser dialog, which committed every drag and drew a stray white box. On the map toolbar the fit-to-image button moved to the right, next to the map element button, with the view toggles and the draw tools on the left.',
        tags: ['maps'],
      },
      {
        id: 'zone-panel-and-world-styles',
        title: 'Colour zones by kind: rivers blue, roads dashed, one click each, saved with the world',
        body: 'The zones button on a map now opens a panel that groups zones by kind (a supertype and subtype pair, like Line and River). Each kind has a colour swatch, an eye to hide it on this map, and a tune button for fill, line weight, dashed or dotted strokes, and "label first" so its names stay on at any zoom. Rows open to the zones, and hovering a row lights that zone on the map. A search box finds a zone by name. The rules live in .atlas/styles.json inside the world folder, so they travel with it. The colour of a kind also shows as a small swatch beside the type on element pages and in the sidebar.',
        tags: ['maps'],
      },
      {
        id: 'zone-hover-highlight',
        title: 'Hovering a zone lights the whole road, river or region',
        body: 'You no longer have to click to see where a zone runs. The outline brightens and thickens under the cursor and its name shows even when the map is too crowded to label it.',
        tags: ['maps'],
      },
      {
        id: 'zone-page-inherits',
        title: 'The zone page says where its colour comes from, and long point lists fold away',
        body: 'The visuals section shows the colour the map actually draws and names the kind rule it inherits, with one click to go back to it after an override. Point lists longer than eight fold behind the map row, which gained a pan-to-zone button. The section also stopped claiming those fields were local only; they sync with the world.',
        tags: ['maps', 'fix'],
      },
      {
        id: 'zone-lines-from-other-tools',
        title: 'Rivers and roads written by other tools draw as lines',
        body: 'A zone whose shape was written as "Line" by another OnlyWorlds tool drew as a filled polygon, because atlas only recognised the lowercase spelling it wrote itself. Any spelling of line is a line now.',
        tags: ['maps', 'fix'],
      },
    ],
  },
  {
    version: '1.4',
    date: '2026-09-04',
    theme: 'find a word, link every one of them',
    entries: [
      {
        id: 'find-bar-link-to-element',
        title: 'The find bar links every match to an element you pick',
        body: 'Ctrl+F in the writing room now has a "Link to element" button. Type a word, pick the element, and every match in the scene becomes a link in one undoable step. The word is saved as an alias so later scenes recognise it too. Your text is never changed, only linked.',
        tags: ['writing'],
        credit: { handle: 'mika', platform: 'discord' },
      },
      {
        id: 'compiled-view-find-and-link',
        title: 'Find works on chapters and books, and links across every scene inside',
        body: 'The compiled view of a chapter or book had no find at all. It now searches the whole assembled text, and "Link to element" links every match in every scene underneath, written straight to the files.',
        tags: ['writing'],
        credit: { handle: 'mika', platform: 'discord' },
      },
      {
        id: 'unlinked-mentions-link-all',
        title: 'An element shows where it is mentioned but not linked, with one button to link them all',
        body: 'The element preview in the Web tab now lists every scene that mentions the element by name or alias as plain text, and "Link all" turns every one into a link. Creating an element whose name already sits in your prose says so in the confirmation.',
        tags: ['writing', 'web'],
        credit: { handle: 'mika', platform: 'discord' },
      },
      {
        id: 'compiled-view-keeps-your-words',
        title: 'Chapters and books show a link by the words you wrote, not the element name',
        body: 'A scene that read "only an orc already linked" compiled as "only an Orc Chief already linked". The compiled view, the share preview and the published page now all show the label you wrote. Links never change your text.',
        tags: ['writing', 'fix'],
      },
      {
        id: 'compiled-view-stays-current',
        title: 'The compiled view redraws when its scenes change',
        body: 'Linking from the Web tab or a sync pull used to leave an open chapter showing old text until you left and came back. It follows every change now.',
        tags: ['writing', 'fix'],
      },
      {
        id: 'find-bar-below-the-crumb',
        title: 'The find bar no longer covers the date pill',
        tags: ['writing', 'fix'],
      },
      {
        id: 'find-bar-after-scene-switch',
        title: 'Ctrl+F opens after switching scenes',
        body: 'Moving between scenes without leaving the writing room left the find bar detached, so the shortcut did nothing until you left and came back. Fixed.',
        tags: ['writing', 'fix'],
      },
    ],
  },
  {
    version: '1.3',
    date: '2026-09-02',
    theme: 'the web shows who links here',
    entries: [
      {
        id: 'web-backlinks',
        title: 'The web shows every element that links to the one you are on',
        body: 'An element that was only ever pointed at, a regime named by its titles and houses, used to show an empty web. Those links now appear as muted nodes below the center, each with an arrow pointing in, alongside the links the element makes itself.',
        tags: ['web'],
      },
      {
        id: 'pins-under-the-format-spelling',
        title: 'Pins and markers written by other tools show on their maps',
        body: 'The folder format names a pin\'s map as "map" and atlas has always written "map_id". A folder from another tool opened with every pin missing and the map count reading zero. Atlas now reads both names and writes each file back the way it found it.',
        tags: ['folders', 'maps', 'fix'],
      },
      {
        id: 'recover-offers-a-new-folder',
        title: 'After a browser storage clear you can set up a different folder',
        body: 'The welcome screen offered only the re-link of the old folder. It now also offers a fresh setup, the same two doors Settings already had. Worlds you opened in place outside the atlas folder come back with the re-link too.',
        tags: ['folders', 'fix'],
      },
      {
        id: 'folder-picker-says-when-refused',
        title: 'A refused or cancelled folder pick says so',
        body: 'Chrome will not open the top of Desktop, Documents or Downloads, and the refusal used to look like the button doing nothing. Change folder and open folder now say when no folder was chosen and suggest a subfolder.',
        tags: ['folders'],
      },
      {
        id: 'landing-doors-one-shape',
        title: 'The two landing buttons share one shape in every browser',
        tags: ['layout', 'fix'],
      },
      {
        id: 'non-chromium-splash-offers-the-tour',
        title: 'On browsers without folder access the splash offers the tour only',
        body: 'The example-page button is gone from that splash. It still appears on Chromium after the tour.',
        tags: ['layout'],
      },
      {
        id: 'change-folder-knows-a-world',
        title: 'Pointing Change folder at a world opens the world',
        body: 'Set up and Change folder expect a place to keep worlds. Given a folder that is itself a world, they used to nest an empty atlas folder inside it. Now they recognise the world and open it in place, or say which button does that on a first launch.',
        tags: ['folders', 'fix'],
      },
      {
        id: 'map-chips-one-rule-light',
        title: 'Every label over the map keeps the same dark chip in light mode',
        body: 'Pin labels went dark in light mode weeks ago and zone labels stayed white beside them. Zone labels, the placement banner and the pin tooltip\'s small print all follow the same rule now. The chart plot keeps its dark panel and gains a frame on the light page.',
        tags: ['lightmode', 'maps', 'fix'],
      },
      {
        id: 'web-preview-linked-from',
        title: 'The web preview lists everything that links to an element',
        body: 'It used to name only the narratives an element appears in. It now names every element that links to it, narratives first, with the count.',
        tags: ['web'],
      },
      {
        id: 'export-writes-the-onlyworlds-envelope',
        title: 'Export writes the same file onlyworlds.com exports',
        body: 'Atlas used to write an older shape with capitalised type names and no world id. It now writes the onlyworlds.com world export exactly, world id included, so a file can travel between the two and back without loss. Older files still import.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.2',
    date: '2026-07-28',
    theme: 'worlds from other tools',
    entries: [
      {
        id: 'union-read-foreign-worlds',
        title: 'Worlds written by other tools open completely',
        body: 'Atlas kept maps, pins, zones and markers in their own folder, and every other OnlyWorlds tool keeps them beside the rest of the elements. Opening one of those worlds showed all the characters and locations with none of the maps, and said nothing about it. Atlas now reads both arrangements, so a world made anywhere opens whole.',
        tags: ['folders', 'fix'],
      },
      {
        id: 'new-worlds-one-folder-shape',
        title: 'New worlds use one folder shape for everything',
        body: 'A world atlas creates now keeps all twenty two element types under elements, maps included. Worlds you already have keep the shape they have, and both open the same way.',
        tags: ['folders'],
      },
    ],
  },
  {
    version: '1.1',
    date: '2026-07-26',
    theme: 'the first sweep after launch',
    entries: [
      {
        id: 'writing-save-on-leaving-room',
        title: 'Writing no longer loses the last thing you typed',
        body: 'Leaving the writing room within a second of typing could discard those words, because the save was addressed to whatever the page was showing rather than to the text you wrote. It now goes to the right narrative every time.',
        tags: ['writing', 'fix'],
      },
      {
        id: 'light-mode-map-labels',
        title: 'Map pin labels are readable in light mode',
        body: 'Pin labels and their hover tooltips were white text on a white chip. They now keep a dark chip in both themes, the way map chrome should.',
        tags: ['maps', 'light mode', 'fix'],
      },
      {
        id: 'light-mode-page-preview',
        title: 'Page previews show what a visitor will actually see',
        body: 'A dark page previewed as a light page while the app was in light mode, so the preview and the published page disagreed. The page now keeps its own look regardless of your theme.',
        tags: ['sharing', 'light mode', 'fix'],
      },
      {
        id: 'header-long-names',
        title: 'Long element names no longer push the delete button off screen',
        body: 'A long name filled the header and clipped the controls beside it. The name shortens with an ellipsis instead.',
        tags: ['elements', 'fix'],
      },
      {
        id: 'pane-divider-clamp',
        title: 'Dragging a pane divider keeps the third pane on screen',
        body: 'Widening the middle pane far enough used to push the right pane past the window edge, taking the map controls with it, and the layout was remembered. It now stops at the point where all three panes still fit.',
        tags: ['layout', 'fix'],
      },
      {
        id: 'delete-confirm-unknown',
        title: 'Deletes always ask when atlas cannot tell what else would go',
        body: 'If the check for dependent elements failed, a delete could proceed silently and still cascade. It now confirms and says the check did not complete.',
        tags: ['elements', 'safety'],
      },
      {
        id: 'world-open-failure-keeps-entry',
        title: 'A failed world open no longer removes the world from your list',
        body: 'Any error naming a missing file was read as the whole folder being gone, which dropped the world and its saved access. Atlas now checks the folder itself before removing anything.',
        tags: ['worlds', 'safety'],
      },
      {
        id: 'sync-pill-unsticks',
        title: 'The sync indicator no longer sticks on Saving',
        body: 'A disk error during a sync round could leave the indicator reading Saving for the rest of the session, which also blocked the refresh button. It returns to idle now.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'first-load-lighter',
        title: 'Lighter first load',
        body: 'The OnlyWorlds mark shipped at 4748 pixels square to draw a 15 pixel icon, and the social card image was cached for offline use though the app never asks for it. Together that is about half a megabyte off a first visit.',
        tags: ['performance'],
      },
      {
        id: 'narrow-window-layer',
        title: 'Atlas works in a narrow window',
        body: 'The three panes needed about 700 pixels of width, and below that the side panes went off screen with no way to reach them. On a narrow window or a phone they now become drawers you open from the top bar, and the middle pane keeps the whole width.',
        tags: ['layout'],
      },
      {
        id: 'tour-on-a-phone',
        title: 'The guided tour is readable on a phone',
        body: 'On a narrow screen the tour panel could not grow to fit its own text, so the sentence and the step notes printed on top of each other. The panel now sizes to its content and scrolls.',
        tags: ['tour', 'fix'],
      },
      {
        id: 'honest-browser-copy',
        title: 'Clearer wording about which browsers can open folders',
        body: 'The landing told phone visitors on Chrome that they needed Chrome. It now names the real requirement, a desktop Chromium browser, and offers the tour and an example page to everyone else.',
        tags: ['copy'],
      },
    ],
  },
  {
    version: '1.0',
    date: '2026-07-24',
    theme: 'the folder is the world',
    entries: [
      {
        id: 'launch',
        title: 'Atlas is live',
        body: 'A local-first OnlyWorlds editor. Your world is a folder of files on your own disk, yours to keep, and syncing with onlyworlds.com is optional.',
        tags: ['milestone'],
      },
      {
        id: 'maps-and-zones',
        title: 'Maps, zones, and pins',
        body: 'Give a map an image background, draw zones over it, and drop your elements as pins.',
        tags: ['maps'],
      },
      {
        id: 'writing-room',
        title: 'A writing room',
        body: 'Write prose with your world’s elements one keystroke away, linked as you go.',
        tags: ['writing'],
      },
      {
        id: 'charts',
        title: 'Charts',
        body: 'See your world arranged in time, on the calendar your world keeps.',
        tags: ['charts'],
      },
      {
        id: 'sharing',
        title: 'Shareable pages',
        body: 'Build a page from your world’s elements and publish it for anyone to read.',
        tags: ['sharing'],
      },
      {
        id: 'optional-sync',
        title: 'Optional sync',
        body: 'Keep working locally and push to onlyworlds.com when you want. Your folder stays the source of truth.',
        tags: ['sync'],
      },
      {
        id: 'guided-tour',
        title: 'A guided tour',
        body: 'A walkthrough that builds a tiny world one sentence at a time, so a first look teaches the whole shape of the tool.',
        tags: ['tour'],
        credit: { handle: 'Freek', platform: 'collaborator' },
      },
      {
        id: 'light-mode',
        title: 'Light and dark',
        body: 'A full daylight theme across the whole app. Pick it in Settings, General, and atlas remembers your choice.',
        tags: ['appearance'],
      },
    ],
  },
];
