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

/** Newest release first. */
export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '1.1',
    date: '2026-07-24',
    theme: 'working in daylight',
    entries: [
      {
        id: 'light-mode',
        title: 'Light mode',
        body: 'A full daylight theme across the whole app. Pick it in Settings, General, and atlas remembers your choice.',
        tags: ['appearance'],
      },
      {
        id: 'import-world-export',
        title: 'Import reads OnlyWorlds exports directly',
        body: 'Drop or paste a world exported from onlyworlds.com and atlas adopts it whole, keeping fields it does not yet know about.',
        tags: ['import'],
      },
      {
        id: 'autolink-reliable',
        title: 'Linking words in your prose, made reliable',
        body: 'Click a highlighted word to link it to an element, or hover a word and press Tab. Creating a link never rewrites your text.',
        tags: ['writing'],
      },
      {
        id: 'zone-labels-below',
        title: 'Zone labels sit below the zone',
        body: 'Labels hang under their zone by default instead of hiding beneath the shape and its markers.',
        tags: ['maps'],
      },
      {
        id: 'chart-eras',
        title: 'Chart eras read at a glance',
        body: 'Each era carries its own tint, so the pivots in your timeline are visible without reading every date.',
        tags: ['charts'],
      },
      {
        id: 'general-settings',
        title: 'A General settings tab',
        body: 'Home to the theme toggle and an About panel with version and links.',
        tags: ['settings'],
      },
    ],
  },
  {
    version: '1.0',
    date: '2026-07-19',
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
    ],
  },
];
