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
