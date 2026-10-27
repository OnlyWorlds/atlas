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
 * broader credits are Titus's call to add — seeded
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
 * v1 RESET (Titus, launch day): the page opens as ONE clean v1.0
 * block — the launch state, dated launch day — ready to changelog on top of.
 * The pre-launch drops (the old 1.0 of 2026-07-19 and the 1.1 polish set)
 * were folded in: nothing had shipped publicly yet, so a history of drops
 * nobody could have used was noise wearing a version number.
 */
export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '1.97.2',
    date: '2026-10-27',
    theme: 'Fewer words',
    entries: [
      {
        id: 'signed-in-no-email',
        title: 'Signed in, Settings no longer asks for your email',
        body: 'The email field only filled in the sign-in of Make online, which a signed-in account skips. It shows again when you sign out.',
        tags: ['settings'],
      },
      {
        id: 'waypoints-plainer',
        title: 'The waypoints say what they are, plainly',
        body: 'Several waypoint lines in Settings are shorter and less like an advert, and "Label it your way" is now "Your own labels".',
        tags: ['copy'],
      },
    ],
  },
  {
    version: '1.97.1',
    date: '2026-10-27',
    theme: 'A message read in part',
    entries: [
      {
        id: 'served-trimmed-not-sent',
        title: 'A message you were shown in part syncs your edits again',
        body: "When OnlyWorlds shows you a message with some of its recipients left out, because your seat may not see them, it marks which lists it shortened. Atlas keeps that mark in the file and no longer sends it back, so an edit to such a message is no longer refused on sync. The recipients you cannot see stay on the message online, and the mark no longer shows among your own fields.",
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.97.0',
    date: '2026-10-27',
    theme: 'A link from OnlyWorlds, pasted',
    entries: [
      {
        id: 'paste-onlyworlds-address',
        title: 'Paste a link to a world or an element from OnlyWorlds',
        body: "Paste an OnlyWorlds address for a world or an element (www.onlyworlds.com/w/ followed by the world's id, or ow:// text) anywhere in Atlas outside a text field, or into Search, and Atlas opens it the way Open in Atlas does: a world already here opens at that element, a world from your account after you say Open. These are the addresses onlyworlds.com's Copy link will hand out. A link that names the world by its page name is not read.",
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.96.0',
    date: '2026-10-27',
    theme: 'The way back to the site',
    entries: [
      {
        id: 'make-online-site-page',
        title: "A world made online links to its page on onlyworlds.com",
        body: "When Make online has put a world on OnlyWorlds, its message carries Open on onlyworlds.com, which opens the world's own page there, where its members, keys and invites are.",
        tags: ['sync'],
      },
      {
        id: 'sign-out-keeps-world-keys',
        title: 'Signing out keeps your worlds working',
        body: 'The keys Atlas makes for your worlds are now kept on OnlyWorlds when you sign out, so a world here goes on syncing with its own key. Signing out lets go of your account only.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.95.1',
    date: '2026-10-26',
    theme: 'How a battle was decided',
    entries: [
      {
        id: 'tangle-battle-verdict',
        title: "A Tangle battle's card says how it was decided",
        body: 'A battle Tactical Tangle awarded when time ran out now reads "held the field when time ran out, with no army broken", and one that ended when an army left in order names the side that withdrew. Before, both read as an ordinary victory.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.95.0',
    date: '2026-10-26',
    theme: 'Said as it is known',
    entries: [
      {
        id: 'message-sender-claimed',
        title: 'A message says who it claims to be from until OnlyWorlds proves it',
        body: "A message's line now reads \"From\" only when OnlyWorlds' member list shows its writer plays the sender. Otherwise it says \"Claims to be from\", and when another member's key wrote it, it names that key. A message with no recipients reads \"To everyone\", or \"To everyone, or someone hidden from you\" on a key that does not see the whole world, and a recipient Atlas cannot show is counted rather than dropped.",
        tags: ['writing', 'safety'],
      },
      {
        id: 'graph-proposed-hidden',
        title: 'The graph marks proposed and hidden elements',
        body: 'In the Context graph, an element waiting for review or hidden on OnlyWorlds gets a dotted ring and the word beside its name, with what it means on hover, as in the element list.',
        tags: ['graph'],
      },
      {
        id: 'spine-keys-kept',
        title: "The spine profile's keys are kept for it",
        body: 'Custom field names that start with x_spine_ are kept for the spine profile other tools read: shown read only, never typed as a custom field. When a world gets new ids, a spine row\'s dependencies and a parlor\'s links to its sittings and work items now follow them.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.94.0',
    date: '2026-10-26',
    theme: 'One token at a time',
    entries: [
      {
        id: 'replaced-token-revoked',
        title: 'Signing in again takes back the token it replaces',
        body: "When you sign in while Atlas already holds a token it made for you, for example after signing in from another tab, Atlas now revokes the older token on OnlyWorlds once the new one is kept, so it no longer works. A token you pasted in is never revoked.",
        tags: ['safety', 'settings'],
      },
    ],
  },
  {
    version: '1.93.1',
    date: '2026-10-25',
    theme: 'A finger-sized remove for aliases',
    entries: [
      {
        id: 'aliases-remove-phone-size',
        title: "On a phone, removing an alias is a finger's size",
        body: "In an element's Aliases dialog, the button that removes an alias is now as big as Atlas's other buttons on a phone. Before, it stayed a small cross beside each name.",
        tags: ['fix', 'layout'],
      },
    ],
  },
  {
    version: '1.93.0',
    date: '2026-10-25',
    theme: 'Signing out takes the sign-in with it',
    entries: [
      {
        id: 'forget-revokes-atlas-token',
        title: "Signing out revokes Atlas's sign-in on onlyworlds.com",
        body: "When you sign in with OnlyWorlds or with your email and password, onlyworlds.com makes a sign-in token for Atlas. Forget in Settings, and Forget everything, now revoke that token on onlyworlds.com, so it stops working and leaves your account's list. Atlas says if onlyworlds.com could not be reached, and where to remove it. A token you pasted yourself is only forgotten here, since you may use it elsewhere. Worlds you opened keep their own keys.",
        tags: ['sync'],
      },
      {
        id: 'held-row-long-name-wraps',
        title: 'A long world name not downloaded yet shows whole',
        body: 'A world not downloaded yet with a long name now wraps to a second line in your list of worlds, instead of ending in "...".',
        tags: ['fix', 'world'],
      },
      {
        id: 'calendar-countdown-era-order',
        title: 'A countdown era no longer hides the era after it',
        body: 'An era counting down to a moment (like years before a founding) and an era starting at that moment now read right in either order. Before, listing the later era first left its dates with no era name and a year short.',
        tags: ['fix', 'charts'],
      },
      {
        id: 'calendar-leap-exceptions',
        title: 'Calendars with leap years like ours read their dates',
        body: 'A calendar can now say a leap day comes every 4 years, but not every 100, yet every 400, as the Gregorian calendar does, and count years from 1. Such calendars, like the ones a LegendKeeper timeline brings in, show their dates in Atlas instead of plain numbers, and editing one in the calendar builder keeps its leap rule.',
        tags: ['charts'],
      },
    ],
  },
  {
    version: '1.92.2',
    date: '2026-10-25',
    theme: 'The whole name of a world not downloaded yet',
    entries: [
      {
        id: 'held-row-whole-name',
        title: 'A world not downloaded yet shows its whole name',
        body: 'In your list of worlds, a world a link left not downloaded yet says so on a small line under its name. Before, a label beside the name took half the row and cut the name to a few letters.',
        tags: ['fix', 'world'],
      },
    ],
  },
  {
    version: '1.92.1',
    date: '2026-10-25',
    theme: "A parlor's takes stay in its room",
    entries: [
      {
        id: 'parlor-take-in-room',
        title: "A parlor's take on a work item counts as part of its room",
        body: "When someone takes a work item in a parlor, that take is saved in the world as a Relation. Atlas now counts it with the parlor's other room records, so Hide the room hides it too, and the world's own lore never shows it. A Relation called Take that no parlor made stays in view.",
        tags: ['fix', 'data'],
      },
    ],
  },
  {
    version: '1.92.0',
    date: '2026-10-25',
    theme: 'Home for a world at work',
    entries: [
      {
        id: 'charter-no-protagonist-prompt',
        title: 'A world with a charter no longer asks you to choose a protagonist',
        body: "Home's Choose a protagonist and Choose a home are prompts for a story. A world with a charter, the house rules a world set up for work keeps, no longer shows them. A protagonist or home you set from an element's own page still shows on Home.",
        tags: ['world'],
      },
      {
        id: 'phone-map-tools-finger-size',
        title: "On a phone, a map's tools are a finger's size",
        body: "The drawing tools above a map grow to the size of the page's other buttons on a phone screen. On a map inside another map, the way back up keeps its row and the whole name of where it goes.",
        tags: ['maps'],
      },
    ],
  },
  {
    version: '1.91.1',
    date: '2026-10-25',
    theme: 'A link keeps its place',
    entries: [
      {
        id: 'held-row-no-start-here',
        title: 'A world waiting to download no longer sits under the Start here tag',
        body: 'With nothing in your list but a world from a link still to download, the Start here tag covered its name. The tag now shows only when the list is truly empty.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.91.0',
    date: '2026-10-25',
    theme: 'A link keeps its place',
    entries: [
      {
        id: 'join-link-keeps-its-seat',
        title: 'A world from a link you did not finish downloading stays in your list',
        body: 'A link to open a world works once. If its download was cancelled, closed or cut off by a reload, the link was used up and the world was gone from Atlas. Now the world stays in your list of worlds as not downloaded yet: select it to download it when you want it, with nothing more spent, or remove it.',
        tags: ['new', 'sharing'],
      },
    ],
  },
  {
    version: '1.90.0',
    date: '2026-10-25',
    theme: 'Yesterday beside today',
    entries: [
      {
        id: 'world-file-copy-beside',
        title: 'A world file of a world you already have opens beside it, as a copy to read',
        body: 'Opening a world file of a world that is already in Atlas used to stop at "already in Atlas". Now it also offers Open a copy beside it: the file opens as a separate copy you can read but not change, named in your list with the day the file was made when it says one, so you can look at last week\'s world next to today\'s. The world itself is left as it is, and a copy never goes online.',
        tags: ['new', 'folder'],
      },
      {
        id: 'writable-false-is-view-only',
        title: 'A world folder marked as not writable opens view only',
        body: 'A world whose world.json says writable: false, as a frozen copy of a world does, now opens to read in Atlas, and nothing offers to edit it.',
        tags: ['folder'],
      },
    ],
  },
  {
    version: '1.89.0',
    date: '2026-10-25',
    theme: 'A damaged file is said',
    entries: [
      {
        id: 'unreadable-files-said-at-open',
        title: 'A file Atlas cannot read is named when the world opens',
        body: 'A world folder with an element file that is damaged or has no id used to open one element short, with no word. The element list now says how many files cannot be read, and pointing at it names them. Atlas still leaves those files as they are, so fixing one brings its element back.',
        tags: ['fix', 'folder'],
      },
      {
        id: 'home-what-do-you-have-says-whats-missing',
        title: 'Home names what a world still lacks, instead of saying it has nothing',
        body: 'The What do you have? card said "Nothing yet. Start with a character and a location." until a world had both, even under a count of its elements. It now says that only in an empty world; otherwise it names what is missing, such as "Add a location."',
        tags: ['fix', 'home'],
      },
    ],
  },
  {
    version: '1.88.3',
    date: '2026-10-24',
    theme: 'A world file by any name',
    entries: [
      {
        id: 'owworld-opens',
        title: 'A world file named .owworld opens',
        body: 'The standard names a world file .owworld, and other tools write it that way. Atlas used to open only the .zip it saves itself: an .owworld dropped in Data was read as JSON and refused, and Open a world file did not list it. Both open it now, and a world file renamed to anything opens by what it holds.',
        tags: ['fix', 'world file', 'import'],
      },
    ],
  },
  {
    version: '1.88.2',
    date: '2026-10-24',
    theme: 'The tour stays in view',
    entries: [
      {
        id: 'tour-page-never-scrolls-sideways',
        title: 'In a narrow window, the tour no longer slides the page sideways',
        body: 'During the guided tour in a narrow window, the whole page could shift left by a few hundred pixels, leaving the open element list mostly off screen while the tour pointed at it. The page now stays put.',
        tags: ['fix', 'tour', 'layout'],
      },
      {
        id: 'settings-sign-in-label-once',
        title: 'Sign in says it once in Settings',
        body: 'Settings, OnlyWorlds no longer shows "Sign in to OnlyWorlds" right above the Sign in with OnlyWorlds button.',
        tags: ['settings'],
      },
    ],
  },
  {
    version: '1.88.1',
    date: '2026-10-24',
    theme: 'A damaged world file is refused',
    entries: [
      {
        id: 'world-file-early-stream-end',
        title: 'A world file with a damaged entry is refused, not half read',
        body: 'A world file where one entry\'s packed data stops short of the size the file declares, with stray bytes after it, used to open as if nothing were wrong. Atlas now refuses it, as the folder standard asks, and says it is not a world Atlas can open. Files that are whole open as before.',
        tags: ['fix', 'import'],
      },
    ],
  },
  {
    version: '1.88.0',
    date: '2026-10-24',
    theme: 'Hidden here, hidden there',
    entries: [
      {
        id: 'hidden-mark-sent-online',
        title: 'A mark added after an element went online now hides it on OnlyWorlds too',
        body: 'When you own the world or build it with its owner, an element marked hidden in its file after it went online is now hidden on OnlyWorlds as well, before your edit is sent, so members never see the change. An element that said Hidden here only is hidden the next time Atlas syncs the world. Taking the mark out of a file never shows an element again: unhide it on onlyworlds.com. For other members it stays as before: hidden here only.',
        tags: ['sync', 'sharing'],
      },
    ],
  },
  {
    version: '1.87.1',
    date: '2026-10-24',
    theme: 'Buttons that stay where they are',
    entries: [
      {
        id: 'icons-hold-their-place',
        title: 'Buttons no longer move while Atlas loads its icons',
        body: 'On a first visit, or a slow connection, the icon buttons were wider until their icons arrived and then shrank, which moved the rows under them: a click in that moment could land beside what you aimed at. Each icon now holds its final size from the start.',
        tags: ['fix', 'layout'],
      },
    ],
  },
  {
    version: '1.87.0',
    date: '2026-10-24',
    theme: 'Sign in with OnlyWorlds',
    entries: [
      {
        id: 'sign-in-with-onlyworlds',
        title: 'Sign in with OnlyWorlds, no password typed into Atlas',
        body: 'Settings, OnlyWorlds now starts with Sign in with OnlyWorlds, and so do Make online and New world on OnlyWorlds when you are signed out. Atlas saves what you were doing, onlyworlds.com asks once whether Atlas may sign in as you (after that it is a moment\'s redirect), and you come back where you were, signed in, with the dialog you left open. Atlas keeps a token for this browser, listed on your account page where you can take it back. The email and password and the account token still work as before.',
        tags: ['sync', 'settings'],
      },
    ],
  },
  {
    version: '1.86.3',
    date: '2026-10-24',
    theme: 'File names read the same in every browser',
    entries: [
      {
        id: 'world-file-names-unicode-15-1',
        title: 'A world file reads its file names the same in every browser',
        body: 'When a world file is opened or made, two of its file names count as one by the rule every OnlyWorlds tool shares, never by the browser\'s own. Before, a newer browser could refuse a file holding two different names written in one of four recently added scripts (Todhri, Tulu-Tigalari, Gurung Khema and Kirat Rai), saying they differ only in accents.',
        tags: ['fix', 'data'],
      },
    ],
  },
  {
    version: '1.86.2',
    date: '2026-10-24',
    theme: 'Hidden here only, said when it is',
    entries: [
      {
        id: 'hidden-here-only',
        title: 'An element hidden after it went online says OnlyWorlds still shows it',
        body: 'OnlyWorlds takes the hidden mark only when an element is first put online. When an element is marked hidden in its folder after that, its page says it is hidden here only and that OnlyWorlds still shows it once Atlas sends its next change, where it used to say only its keepers could see it.',
        tags: ['fix', 'sync'],
      },
    ],
  },
  {
    version: '1.86.1',
    date: '2026-10-23',
    theme: 'A hidden element says it in a sentence',
    entries: [
      {
        id: 'hidden-said-on-the-page',
        title: 'A hidden element\'s page says so under its name',
        body: 'The page of an element a world hides now says in a sentence who can see it, under its name, where a proposed element says what proposed means. The small eye in the header is gone from that page, so on a phone a long name keeps its room beside a location\'s map buttons.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.86.0',
    date: '2026-10-23',
    theme: 'What a world hides stays hidden',
    entries: [
      {
        id: 'hidden-in-a-folder',
        title: 'An element a world hides says so, in every world',
        body: 'A world file or an import can mark an element hidden: a secret a converter brought over, or one hidden on onlyworlds.com. Atlas now keeps the mark when it imports, and shows the element to you with the word Hidden in the element list, on Home and on its page, in a world on your disk or in this browser too, not only one linked to onlyworlds.com.',
        tags: ['world'],
      },
      {
        id: 'hidden-left-off-the-page',
        title: 'A published page leaves hidden elements out',
        body: 'Publishing a page leaves out what the world hides, from every block, as it leaves out what an agent proposed, and the page builder says how many and which. A hidden page is not published. Downloading the world keeps them: a world file is your own copy.',
        tags: ['pages'],
      },
      {
        id: 'hidden-goes-up-hidden',
        title: 'A hidden element goes online hidden, or not at all',
        body: 'Making a world online, or syncing a new element, sends a hidden element as hidden, so only the owner, co-builders and whoever made it see it there. onlyworlds.com lets only the owner and co-builders make one hidden, so with another key it stays here, with anything placed on it, and Atlas says so once. A hidden element that onlyworlds.com shows under the same id is left as it is until it is hidden there.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.85.0',
    date: '2026-10-23',
    theme: 'A world\'s public page, one tap away',
    entries: [
      {
        id: 'public-page-link',
        title: 'Settings links to a world\'s public page',
        body: 'When the owner of a world on onlyworlds.com has turned its public page on, the OnlyWorlds tab in Settings says so and offers View its public page. Atlas reads this from onlyworlds.com each time the tab opens; the page itself is turned on or off on the world\'s page there.',
        tags: ['world'],
      },
      {
        id: 'units-in-a-row',
        title: 'Two of a world\'s settings saved in a row both stay shown',
        body: 'Setting the length unit and then the mass unit in quick succession could leave the length field empty, and heights without their unit, until the world was opened again, although both were saved. The world\'s image and its clock had the same gap. Each now shows what was saved.',
        tags: ['world'],
      },
      {
        id: 'proposed-read-again',
        title: 'A proposed element\'s page says it in fewer words',
        body: 'Its sentence says once that it is not part of the world, or its counts, until a keeper accepts it, and that a change made here is saved, or sent when the world is linked to onlyworlds.com. A lapsed proposal\'s word in the header is Lapsed, and on a phone the header leaves the word to the sentence so the name keeps its room.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.84.1',
    date: '2026-10-23',
    theme: 'A proposed element says what it means',
    entries: [
      {
        id: 'proposed-says-why',
        title: 'A proposed element\'s page says what proposed means',
        body: 'Under its name, a sentence says who proposed it, that it is not counted with the world\'s own, and that a keeper accepts or declines it on onlyworlds.com, while a change made in Atlas is sent as any other.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.84.0',
    date: '2026-10-23',
    theme: 'Proposed, not yet reviewed',
    entries: [
      {
        id: 'proposed-not-yet-reviewed',
        title: 'An element an AI seat proposed says so, and is not counted as the world\'s own',
        body: 'On a world whose keeper reviews what AI seats write, a new element from a seat stays proposed until a keeper accepts it on onlyworlds.com. Atlas now shows the word Proposed on it in the list, in Search, in Recent and on its page, leaves it out of the counts, and says on Home how many wait. The list\'s Proposed chip shows only them.',
        tags: ['world', 'sync'],
      },
      {
        id: 'proposed-left-off-pages',
        title: 'A published page leaves proposed elements out',
        body: 'A page you publish shows only what the world holds as settled: an element still proposed, or a piece of knowledge an AI seat proposed, is left off until a keeper accepts it, and the page\'s editor says which.',
        tags: ['sharing'],
      },
    ],
  },
  {
    version: '1.83.1',
    date: '2026-10-23',
    theme: 'Make online on the shared library',
    entries: [
      {
        id: 'make-online-sdk-create',
        title: 'Make online creates the world through the OnlyWorlds library',
        body: 'Atlas now makes a new world on your account with the same code other OnlyWorlds tools use, instead of a copy of its own. Nothing changes in what you see.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.83.0',
    date: '2026-10-23',
    theme: "A world online keeps its own words and where it came from",
    entries: [
      {
        id: 'online-world-own-words',
        title: "A world on onlyworlds.com shows its own words for the types",
        body: "When a world online names its own words (Employee for Character, Team for Institution), Atlas now brings them down with the world's settings and shows them. A world opened from a file with its own words takes them online the same way. If both sides changed them, the conflicts to review list them with the other world settings.",
        tags: ['world', 'sync'],
      },
      {
        id: 'make-online-says-maker',
        title: 'A world made online says which tool made it',
        body: "Make online now tells onlyworlds.com where the world's folder came from, so the site can say it was made in Atlas, or in the tool that made the folder. A world linked from onlyworlds.com keeps that answer in its folder too.",
        tags: ['sync', 'folders'],
      },
    ],
  },
  {
    version: '1.82.2',
    date: '2026-10-23',
    theme: "A supertype said once, in the world's word",
    entries: [
      {
        id: 'supertype-word-once',
        title: "A world's word for a supertype is said once, and on its filter too",
        body: 'In a world with its own words, search no longer reads "AI agent · Agent": the world\'s word for the supertype is enough. The supertype filter under a type now shows that same word.',
        tags: ['world', 'fix'],
      },
      {
        id: 'rest-api-link',
        title: "Settings' REST API link opens the API's page again",
        body: 'The link under Settings, OnlyWorlds pointed at an address onlyworlds.com no longer serves.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.82.1',
    date: '2026-10-23',
    theme: 'A shorter question for worlds on OnlyWorlds',
    entries: [
      {
        id: 'where-one-line-online',
        title: 'Download and View say where a world lives in one line',
        body: 'A world you download or view from OnlyWorlds stays there too, so these two dialogs now say "Kept in this browser; the world stays on onlyworlds.com too." with a link to choose a folder instead. A new world made in Atlas still asks the whole question.',
        tags: ['layout', 'sharing'],
      },
    ],
  },
  {
    version: '1.82.0',
    date: '2026-10-23',
    theme: "A tool's private records stay with you",
    entries: [
      {
        id: 'private-records-left-out',
        title: 'A world file leaves private records out unless you ask',
        body: "Some tools keep their own records inside a world and mark them private. When you download such a world, Atlas now says so and leaves those records out unless you choose to include them, so a tool's own notes stay with you when the world is shared.",
        tags: ['folders', 'sharing'],
      },
    ],
  },
  {
    version: '1.81.1',
    date: '2026-10-23',
    theme: 'A downloaded world keeps its now',
    entries: [
      {
        id: 'download-keeps-now',
        title: 'A world downloaded from onlyworlds.com opens with its now',
        body: "The world file onlyworlds.com gives you now carries the world's settings, its now among them. Atlas reads that now when it opens the file, so the charts' now line and the world clock start where the world was.",
        tags: ['folders', 'fix'],
      },
      {
        id: 'home-first-steps-words',
        title: "Home's first steps use a world's own words",
        body: 'A new world with its own words for the types now says "Start with an Employee and a location" where it named the types by the standard words.',
        tags: ['world', 'fix'],
      },
    ],
  },
  {
    version: '1.81.0',
    date: '2026-10-22',
    theme: "A world's own words",
    entries: [
      {
        id: 'world-type-words',
        title: 'A world can call its types by its own words',
        body: "A world whose world.json names its own words for the types (OnlyWorlds' names profile: Employee for Character, Team for Institution) shows those words wherever Atlas names a type: lists, counts, pickers, the element page, an invite. Folders, links and the API keep the standard's names. A world without its own words looks exactly as before.",
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.80.0',
    date: '2026-10-22',
    theme: "The keeper's charter",
    entries: [
      {
        id: 'charter-by-keepers',
        title: "Home shows the charter the world's keepers wrote",
        body: "A world's charter on Home is now the one OnlyWorlds names: a Law with supertype Charter made by the owner or a co-builder, the newest one first. A Charter a guest or an AI seat writes is never shown as the world's, and editing an older Charter no longer moves it to the front.",
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.79.0',
    date: '2026-10-22',
    theme: 'Your PIN, only where it counts',
    entries: [
      {
        id: 'pin-on-changes-only',
        title: 'Atlas sends your PIN only when it changes something',
        body: "Reading a world on OnlyWorlds needs only its key, so Atlas now sends your PIN when it changes the world, and once when you link a world or check its key, where a wrong PIN is still caught. An older ten-digit key sends it every time, as before.",
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.78.1',
    date: '2026-10-22',
    theme: 'Links kept',
    entries: [
      {
        id: 'refused-delete-keeps-links',
        title: 'A delete the keeper keeps also keeps its links',
        body: "Deleting an element removes the links other elements had to it. When the keeper keeps that delete for themselves, Atlas now also takes back the link changes it had sent for review, and puts the links back here, so the keeper is never asked to cut links to something still in the world.",
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.78.0',
    date: '2026-10-22',
    theme: 'Sent for review',
    entries: [
      {
        id: 'seat-edits-for-review',
        title: "An AI seat's changes wait for the keeper",
        body: "On a world whose keeper reviews changes from AI seats, an edit made in Atlas with a seat's key goes to the keeper as a proposal, and Atlas says so. Your edit stays in your copy until they decide: accepted, it is the world's; declined, it waits in the review with their reason, to send again or drop. A delete the keeper keeps for themselves puts the element back.",
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.77.1',
    date: '2026-10-22',
    theme: "A world's checks kept",
    entries: [
      {
        id: 'checks-name-kept',
        title: "A world's checks are kept for the tools that read them",
        body: "A work world's Charter can carry its rules as checks that other tools read. Atlas shows them read-only, and a custom field can no longer take their name.",
        tags: ['elements'],
      },
    ],
  },
  {
    version: '1.77.0',
    date: '2026-10-22',
    theme: 'Said where it came from',
    entries: [
      {
        id: 'zone-shape-written',
        title: 'A zone you draw says its shape',
        body: "A zone you draw in Atlas now records whether it is an area or a line in OnlyWorlds' own shape field, so every other tool draws it the same way. A zone's page shows Shape in its Scope section, beside Role.",
        tags: ['maps'],
      },
      {
        id: 'writes-name-atlas',
        title: 'OnlyWorlds knows a change came through Atlas',
        body: "Every change Atlas sends to OnlyWorlds now says it came through Atlas, so the world's recent changes on onlyworlds.com can say which app each one came from.",
        tags: ['sync'],
      },
      {
        id: 'pin-rows-say-why',
        title: 'A PIN field says what it takes, and why',
        body: "Where a world's own seat secret works in place of your PIN (Download a world, Link to existing), the field's label says so. New world and Make online say why they ask for your PIN under the field, before you sign in.",
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.76.0',
    date: '2026-10-22',
    theme: 'Your lore, without the room',
    entries: [
      {
        id: 'parlor-room-hidden',
        title: "A world's parlor stays out of its lore",
        body: "A parlor keeps its messages, votes and work items inside the world it is about, each marked as the room's. Atlas now leaves them out of the element list and its counts, Home, an element's references, Charts, Search, the link picker and the names that link themselves in a story, so your characters and stories read as they did. A message of your own world's, a letter in a novel, has no mark and stays. Home says how many the room holds, and one click shows them again.",
        tags: ['elements'],
      },
      {
        id: 'dialog-keeps-keyboard',
        title: 'An open dialog keeps the keyboard',
        body: 'Tab used to walk out of an open dialog into the page behind it, where Enter could open a second dialog on top. Now the page waits behind the dialog until it closes, and the keyboard goes back where it was.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.75.0',
    date: '2026-10-22',
    theme: 'A line another tool drew',
    entries: [
      {
        id: 'zone-shape-standard',
        title: 'A zone says whether it is an area or a line',
        body: "OnlyWorlds zones now have a shape field: polygon for an area, line for a path such as a river or a road. Atlas reads it first, so a line made in another tool draws as a line here, whatever its supertype says.",
        tags: ['maps'],
      },
    ],
  },
  {
    version: '1.74.0',
    date: '2026-10-22',
    theme: 'The charter a folder names',
    entries: [
      {
        id: 'charter-named',
        title: "A world folder can name its charter",
        body: "Home leads with a world's charter, the Law with supertype Charter. When a world folder's world.json names a Law as its charter, Home now leads with that one, which settles a world that holds two.",
        tags: ['folders'],
      },
    ],
  },
  {
    version: '1.73.1',
    date: '2026-10-22',
    theme: 'Typing that stays',
    entries: [
      {
        id: 'typing-survives-redraw',
        title: 'What you type stays where you type it',
        body: "In Settings, typing in one field just after another saved could lose the text and the cursor; the second unit of a world's units was the usual victim. The Writing and Maps searches lost the cursor when a sync landed, so the next keys went to Atlas's shortcuts. Now Settings waits until you leave the field, and the searches keep your cursor.",
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.73.0',
    date: '2026-10-22',
    theme: 'Hidden, said',
    entries: [
      {
        id: 'hidden-mark-shown',
        title: 'An element hidden on OnlyWorlds says so',
        body: 'In a world on OnlyWorlds, an element its owner hid shows a small crossed-out eye after its name, on its page, in Knowledge and in Pages. Point at it or tap it: only the owner, co-builders and whoever made it can see the element.',
        tags: ['sharing'],
      },
    ],
  },
  {
    version: '1.72.1',
    date: '2026-10-22',
    theme: 'Ready for the app name',
    entries: [
      {
        id: 'changed-client-kept',
        title: 'Which app made a change is kept as OnlyWorlds says it',
        body: "OnlyWorlds will soon note which app made each change to an element. Atlas keeps that note as OnlyWorlds' word: it never counts as a change in a review, never goes back up, and an edit you make in Atlas clears it until OnlyWorlds says it again.",
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.72.0',
    date: '2026-10-22',
    theme: 'Who made this world',
    entries: [
      {
        id: 'producer-line',
        title: 'A world Atlas makes says it was made in Atlas, and from what',
        body: "A new world's world.json now records that Atlas made it, which version, and what from: an empty start, a JSON import, or a download from OnlyWorlds. A world made by another tool keeps that tool's own line, and a copy of a world keeps the line it was born with.",
        tags: ['folders'],
      },
    ],
  },
  {
    version: '1.71.0',
    date: '2026-10-22',
    theme: 'One world file for every tool',
    entries: [
      {
        id: 'world-file-archive',
        title: 'A world file follows the shared OnlyWorlds archive rules',
        body: "Atlas now writes a world file the way every OnlyWorlds tool reads one: the same world gives the same file, and the file holds only the world's own parts (its elements, pictures and maps, and Atlas's settings), so other files kept in a world folder stay behind. Opening one, Atlas reads files up to 2 GB and says plainly why it refuses one it cannot open.",
        tags: ['folders'],
      },
    ],
  },
  {
    version: '1.70.1',
    date: '2026-10-22',
    theme: 'Hidden, said and not counted',
    entries: [
      {
        id: 'hidden-mark-kept',
        title: 'An element hidden on OnlyWorlds no longer reads as changed',
        body: "OnlyWorlds now tells the owner, a co-builder and its maker that an element is hidden. Atlas keeps that as OnlyWorlds' word: it never counts as a change in a review, never goes back up, and leaves the copy when the element is shown again.",
        tags: ['sync', 'fix'],
      },
      {
        id: 'input-focus-visible',
        title: 'A text field in focus shows it plainly',
        body: 'The search field and every other text field now draw their focus in the full accent colour, readable against their resting edge in light and dark.',
        tags: ['lightmode', 'fix'],
      },
    ],
  },
  {
    version: '1.70.0',
    date: '2026-10-22',
    theme: 'Who made it',
    entries: [
      {
        id: 'made-by-filter',
        title: 'The element list shows what people made, or what agents made',
        body: 'In a world on OnlyWorlds where an AI agent has made elements, a Made by row under the search lets you list only what people made, or only what agents made, each with its count. It reads who made each element first; who changed it last is still on its page.',
        tags: ['sidebar', 'sharing'],
      },
      {
        id: 'packet-missing-type',
        title: "A packet's missing element names its type as the page does",
        body: 'Not in this world (Character), capitalised like every other type on the page.',
        tags: ['fix'],
      },
      {
        id: 'hide-the-room',
        title: "Hide the room: a parlor's messages leave the list",
        body: "A world that holds a parlor's room (its messages, board entries, work items, specs, hearts, votes, sittings and member cards) offers Hide the room, so the list shows the world itself. The charter stays. Picking one of those kinds by its own chip still shows it.",
        tags: ['sidebar'],
      },
    ],
  },
  {
    version: '1.69.0',
    date: '2026-10-22',
    theme: 'A work packet, one element at a time',
    entries: [
      {
        id: 'work-packet-list',
        title: "A work item's packet lists its elements, each with its reason",
        body: 'A work item that carries a packet (a list of elements to look at, with a reason for each, made by a person, an AI or the world check) shows that list on its page, in its order, with who made it. Step through opens the first and moves with Previous and Next, the reason for each shown in the bar. An element the world does not hold is named as not in this world.',
        tags: ['editor'],
      },
      {
        id: 'review-keys-kept',
        title: "A review mark's keys are kept for it",
        body: 'Custom field names that start with x_review_ are kept for the review mark other tools read (whether a new element is proposed, and when it was last checked), as x_identity_ and x_packet_ are: shown read only, never typed as a custom field.',
        tags: ['editor'],
      },
    ],
  },
  {
    version: '1.68.2',
    date: '2026-10-21',
    theme: 'What a world file leaves behind',
    entries: [
      {
        id: 'world-file-leaves-git-env',
        title: "A world file leaves a folder's .git and .env behind",
        body: 'When a world\'s folder is also a git repository, or keeps .env files beside it, the world file Atlas makes now leaves them out: a repository\'s history and an env file can hold keys, and a world file is made to be sent. A template such as .env.example still travels. A world file someone sends you is read the same way.',
        tags: ['folders'],
      },
      {
        id: 'agent-mark-waits-for-members',
        title: 'The agent mark waits for the world\'s members before it decides',
        body: 'Since 1.68.1 the mark reads who made a change from the world\'s members. On an element opened before Atlas had read them, an agent\'s change through a door other than its own seat showed no mark. It now shows once the members are read, and a person\'s change through MCP loses the mark at the same moment.',
        tags: ['fix'],
      },
      {
        id: 'packet-bar-opaque',
        title: 'The bar for a link to several elements is solid, and fits a phone',
        body: 'The Previous, Next and Close bar is now on a solid surface, so the page no longer shows through it, and on a phone its buttons stay in one row.',
        tags: ['fix'],
      },
      {
        id: 'view-chip-contrast',
        title: 'The view-only mark on a shared world reads clearly',
        body: 'The small "view" mark beside a world you can only view is a step brighter, so it reads clearly on the open world\'s row.',
        tags: ['fix'],
      },
      {
        id: 'packet-keys-kept',
        title: "A work packet's keys are kept for it",
        body: 'Custom field names that start with x_packet_ are kept for the work packet other tools read, as x_identity_ is for the identity key: shown read only, never typed as a custom field.',
        tags: ['editor'],
      },
    ],
  },
  {
    version: '1.68.1',
    date: '2026-10-21',
    theme: 'The agent mark follows who made a change',
    entries: [
      {
        id: 'agent-mark-by-seat',
        title: 'The agent mark follows who made a change, not how it came in',
        body: 'The quiet "Last changed by an agent" mark now reads who made the change from the world\'s members: a person writing through MCP with their own key is no longer marked as an agent, and an agent writing through the API now is. How the change came in is said beside it, as "through MCP" or "through the API".',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.68.0',
    date: '2026-10-21',
    theme: 'Worlds that hold messages and rules',
    entries: [
      {
        id: 'message-from-to',
        title: 'A message says who it is from and to',
        body: 'A narrative with the supertype Message now shows "From" and "To" above its text: the sender is its narrator, the recipients its characters. Each name opens that character.',
        tags: ['world'],
      },
      {
        id: 'charter-on-home',
        title: "A world's charter comes first on Home",
        body: "When a world has a law with the supertype Charter (what the world is for, who is in it, its house rules), Home shows it under the world's description, with its opening lines and a link to the whole of it.",
        tags: ['world'],
      },
      {
        id: 'open-link-element',
        title: 'A link can open a world at an element',
        body: 'A link from onlyworlds.com or another tool can name an element as well as a world: Atlas opens the world, then that element. A link that names several elements opens the first, with Previous and Next to step through the rest.',
        tags: ['sharing'],
      },
    ],
  },
  {
    version: '1.67.2',
    date: '2026-10-21',
    theme: 'A date its era does not hold',
    entries: [
      {
        id: 'era-date-refused',
        title: 'A typed date its era does not hold is refused',
        body: 'When you type a date with an era on the timeline, and that era does not hold the date (a day after a counting-down era has ended, or its year 0), Atlas now says it is not a date in that era and changes nothing. Before, it moved the element to a day somewhere else. Dates Atlas shows still type back to the same day.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.67.1',
    date: '2026-10-21',
    theme: 'A counted-down year that starts partway',
    entries: [
      {
        id: 'down-era-midyear',
        title: 'A counted-down era has no year zero',
        body: 'In a calendar whose counting-down era ends partway through a year, the days just before the turn showed year 0. They now show year 1, and every year before them one higher. A date you type on the timeline still lands on the day it names. Calendars that turn on a year\'s first day are unchanged.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.67.0',
    date: '2026-10-20',
    theme: 'A copy says where it came from',
    entries: [
      {
        id: 'world-file-provenance',
        title: 'A world file says where it came from, and whose view it is',
        body: 'Downloading a world that is on OnlyWorlds now writes into the file where it came from and when, and which part of the world it holds: the whole world for its owner, a member\'s copy, or one character\'s view for a player. Atlas asks OnlyWorlds at the moment you download; offline, the file says only where it came from. Opened again, the world says so in Settings, and a player\'s view says on its Home that it is not the whole world. One character\'s view can\'t be put online as a world of its own, so Make online is not offered there.',
        tags: ['world', 'sync'],
      },
    ],
  },
  {
    version: '1.66.1',
    date: '2026-10-20',
    theme: 'A story is dated by its telling',
    entries: [
      {
        id: 'narrative-dates-told',
        title: 'A Narrative\'s dates say when it is told',
        body: 'The help on a Narrative\'s two dates follows the OnlyWorlds standard: the start date is when the story is first told or recorded, and the end date is when it stops being told, empty while it still is. The span a story recounts lives on its events. Nothing moves on your timeline.',
        tags: ['world'],
      },
      {
        id: 'front-door-links',
        title: 'The first screen\'s links are easier to see',
        body: 'The line of links under the two doors on the first screen is a little heavier, like links elsewhere in the OnlyWorlds tools.',
        tags: ['layout'],
      },
    ],
  },
  {
    version: '1.66.0',
    date: '2026-10-20',
    theme: 'Light mode you can read, and one being in two worlds',
    entries: [
      {
        id: 'light-text',
        title: 'Light mode reads as clearly as dark',
        body: 'In light mode, the quiet text that read well on black was too pale on white: setting names, counts, field labels and hints. It now uses the same quiet grey as the rest, and links and button words take a deeper blue that stays readable on their own tint. Empty fields on an element are quieter by colour, not by fading.',
        tags: ['layout'],
      },
      {
        id: 'control-font',
        title: 'Buttons and tabs in the same typeface as the page',
        body: 'Some buttons, tabs and chips, such as the Settings tabs, the chart filters and the counts on the type filters, were drawn in the browser\'s default typeface. They now use Open Sans like the rest of Atlas.',
        tags: ['layout'],
      },
      {
        id: 'identity-key',
        title: 'An identity key is shown, never changed',
        body: 'Some tools mark two elements, in one world or in two, as the same being with an identity key. Atlas shows that key on the element, where you can read it but not change or remove it, and keeps it as it is when it gives elements new ids. A custom field can no longer be named Identity key.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.65.0',
    date: '2026-10-20',
    theme: 'Quiet text you can read',
    entries: [
      {
        id: 'faint-text',
        title: 'The quietest text is easier to read',
        body: 'Hints, counts, labels and small icon buttons that Atlas drew in its faintest grey now use the quiet grey that stays readable on every background, in dark and light mode. Toggles that are on also fill their icon or turn bold, so on and off differ by more than colour.',
        tags: ['layout'],
      },
    ],
  },
  {
    version: '1.64.1',
    date: '2026-10-20',
    theme: 'What anyone could see',
    entries: [
      {
        id: 'known-of-shared',
        title: 'Someone you only know of shows what anyone could see',
        body: "OnlyWorlds now shares a little more of a Character you only know of: what anyone could see of them, such as how they look and their reputation. Atlas shows those on the page, where you can read them but not change them, under a line that says you know only what anyone could see. Before, Atlas left them out.",
        tags: ['world', 'sync'],
      },
    ],
  },
  {
    version: '1.64.0',
    date: '2026-10-20',
    theme: 'What your Character knows of',
    entries: [
      {
        id: 'known-of',
        title: 'Someone your Character only knows of shows as known of',
        body: 'Playing a Character, you now see the people, places and things your Character points to, one step out. Those you only know of show their name, picture and description, with a line that says so, rather than a page of empty fields. Atlas never changes or sends one back, and when you come to know one fully, its whole page arrives.',
        tags: ['world', 'sync'],
      },
    ],
  },
  {
    version: '1.63.0',
    date: '2026-10-20',
    theme: 'One link for the whole table',
    entries: [
      {
        id: 'party-link-pick',
        title: 'A link for a whole table: each player picks who they are',
        body: 'A game master can now make one player link that works for several people. Opened in Atlas, it says how many places are left and lists the Characters the game master chose; taken ones are greyed at the bottom. Pick one and Atlas opens the world as that Character, with no account. If someone took it a moment before you, Atlas shows the list again and nothing is used up. A link with no list asks your name and makes a Character for you.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.62.1',
    date: '2026-10-20',
    theme: 'An agent link says so',
    entries: [
      {
        id: 'agent-link-says-so',
        title: 'A link for an AI agent says what it makes before you open it',
        body: 'Opening a link made for an AI agent now asks "Open this world as an AI agent?" and says that Atlas joins as a seat the link\'s maker answers for, not as you. To join a world as yourself, ask for an invite link for a person.',
        tags: ['world', 'fix'],
      },
    ],
  },
  {
    version: '1.62.0',
    date: '2026-10-20',
    theme: 'Buttons by what they do',
    entries: [
      {
        id: 'button-ladder',
        title: 'The main button stands out, and deleting looks like deleting',
        body: 'Atlas now draws its buttons the way every OnlyWorlds tool will: one solid button where you begin (Start a world on the first screen), an everyday button for saving and creating, a quiet one for Cancel and Back, and a link. On the first screen, Start a world and Explore Moppetopia no longer look alike. Buttons that delete or forget, in Settings and in their dialogs, are red, and Forget everything is no longer a plain grey button.',
        tags: ['layout'],
      },
    ],
  },
  {
    version: '1.61.0',
    date: '2026-10-20',
    theme: 'What the owner hides leaves your copy',
    entries: [
      {
        id: 'hidden-leaves-the-copy',
        title: 'An element the owner hides from you leaves your copy quietly',
        body: 'When the owner of a world shared with you hides an element, OnlyWorlds tells Atlas, and Atlas now takes it out of your copy without asking. Before, it opened the "deleted on OnlyWorlds" review and offered to keep it. If you had changed it here, your change stays here and stops syncing. Your own elements keep their links to it, and when the owner shows it again, it comes back. As a guest, the same holds when OnlyWorlds says your view of the world changed: what you can no longer see leaves your copy, unless you changed it here.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.60.2',
    date: '2026-10-20',
    theme: 'Field names read the same in every OnlyWorlds tool',
    entries: [
      {
        id: 'field-names-one-rule',
        title: 'A field name written in capitals stays as written',
        body: 'Field names now come from the rule every OnlyWorlds tool shares, so Atlas and Lantern name a field the same way. A custom field written in capitals keeps them: a stat block\'s STR reads STR, not Str, and "max_HP" reads Max HP. The Writing room\'s line about your book, chapter and scene names now reads "Labels: ... · Edit".',
        tags: ['layout'],
      },
    ],
  },
  {
    version: '1.60.1',
    date: '2026-10-20',
    theme: 'Your new role, said when Atlas first meets it',
    entries: [
      {
        id: 'role-said-at-first-meeting',
        title: 'Settings names your new role as soon as Atlas finds it',
        body: 'When your edit is the first thing to meet a role change (the owner made you a guest, and you changed something you no longer see), Atlas now says so at once, and Settings, This world names your new role and the kept count straight away. Before, Settings kept the old role until Atlas next read the world from OnlyWorlds.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.60.0',
    date: '2026-10-20',
    theme: 'Your copy stays yours when your role changes',
    entries: [
      {
        id: 'role-change-keeps-the-copy',
        title: 'When the owner changes your role, your copy keeps everything',
        body: 'If the owner of a world shared with you makes you a guest, Atlas keeps everything you had and says so once. What you no longer see online stays here as it is and stops syncing, and changes you make to it stay here too. Before, editing such an element offered to delete it as if someone had removed it online. When the owner gives you a bigger role again, those elements sync again. Settings, This world names your role and how many elements are kept from before.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.59.1',
    date: '2026-10-20',
    theme: 'One way of writing labels',
    entries: [
      {
        id: 'sentence-case-house-rule',
        title: 'Labels read in sentence case everywhere',
        body: 'The first screen\'s doors and the room names along the top now start with a capital, and field names take one only on their first word ("Birth date", "Image URL"): the house rule for every OnlyWorlds tool. A few messages say "cannot" where they said "can\'t", and a pane with no world open now says what to do: pick one from the sidebar.',
        tags: ['layout'],
      },
    ],
  },
  {
    version: '1.59.0',
    date: '2026-10-20',
    theme: 'A shared world asks before it overwrites',
    entries: [
      {
        id: 'shared-world-pause-and-review',
        title: 'In a world shared with others, Atlas asks before it overwrites',
        body: 'When others can change a world with you (people you invited, or an agent you gave a seat), Atlas no longer lets your copy replace their newer words. An element changed both here and online is held, marked ⚠, and you choose which version stays. A shared world also pulls the latest changes when it opens. Working alone, nothing changes. Settings, This world shows the rule for a shared world and can turn it off there.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.58.3',
    date: '2026-10-20',
    theme: 'A dim line made readable',
    entries: [
      {
        id: 'waypoint-rider-muted',
        title: 'The small print on the tip card is easier to read',
        body: 'On the OnlyWorlds tip card, the small "These are optional." before See all and Turn off was too faint to read comfortably, in both themes. It now matches the two links beside it.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.58.2',
    date: '2026-10-19',
    theme: 'Two more dark cards in light mode',
    entries: [
      {
        id: 'dark-cards-light',
        title: 'The OnlyWorlds tips and the map\'s placing hint read in light mode',
        body: 'In light mode, the dark card that names an OnlyWorlds idea (such as "One world, many tools") showed its second line and its See all and Turn off row dark on dark, and the hint over a map while placing a pin did the same with its Cancel. Both now keep light text on their dark card.',
        tags: ['maps', 'fix'],
      },
    ],
  },
  {
    version: '1.58.1',
    date: '2026-10-19',
    theme: 'The drawing strip in light mode',
    entries: [
      {
        id: 'draft-strip-light',
        title: 'The drawing strip reads in light mode',
        body: 'While drawing a zone on a map in light mode, the strip at the top (Trace, Finish, Cancel and the hints) was dark text on a dark floor and close to invisible. It now keeps its dark floor with light text in both themes, like the rest of the controls over a map.',
        tags: ['maps', 'fix'],
      },
    ],
  },
  {
    version: '1.58.0',
    date: '2026-10-19',
    theme: 'Agent-made knowledge and pages, marked quietly',
    entries: [
      {
        id: 'agent-mark-knowledge-pages',
        title: 'The agent mark in Knowledge and Pages',
        body: 'In a synced world, a knowledge entry or a page an agent changed last now carries the same small mark after its name as an element page does. Point at it or tap it for who made the change. A person\'s change carries none, and your own edit takes it away.',
        tags: ['sync', 'world'],
      },
    ],
  },
  {
    version: '1.57.2',
    date: '2026-10-19',
    theme: 'A page made elsewhere reads here',
    entries: [
      {
        id: 'page-reads-its-story',
        title: 'A page made on another device shows its text',
        body: 'A page keeps its layout on the computer that built it, and OnlyWorlds holds its text. Opened anywhere else (a world you view, a shared world, your own world on a second device), the page said it had no content yet. It now shows that text, and adding to it there keeps the text instead of starting over.',
        tags: ['pages', 'sync', 'fix'],
      },
    ],
  },
  {
    version: '1.57.1',
    date: '2026-10-19',
    theme: 'A view-only world names what it does',
    entries: [
      {
        id: 'view-only-words',
        title: 'Words that match a view-only world',
        body: 'On a world you can only view, Home\'s recent rows said Edit and could be dragged, and the Charts list of undated elements said to drag them onto the timeline. Home now says Open (or Read for a story) and its rows stay put, the undated list says to click one to open it, and a chart card\'s Edit is Open.',
        tags: ['editor', 'fix'],
      },
    ],
  },
  {
    version: '1.57.0',
    date: '2026-10-19',
    theme: 'A world you can only view reads as one',
    entries: [
      {
        id: 'view-only-reads',
        title: 'A view-only world offers nothing it would refuse',
        body: 'A world opened with a read key, or from a player link, still showed what Atlas would then refuse: fields to click and edit, link pickers, Add aliases, + buttons, the writing editor, map drawing, chart dragging. Now everything reads. Element pages show their values plainly, writing and knowledge open as text to read, pages open as their visitors see them, maps and charts move and zoom with nothing to drag into place, and no + appears anywhere. Search, Find, opening and your own view settings work as before.',
        tags: ['editor', 'sync'],
      },
    ],
  },
  {
    version: '1.56.2',
    date: '2026-10-19',
    theme: 'A view-only world offers no edits it would refuse',
    entries: [
      {
        id: 'view-only-custom-fields',
        title: 'Custom fields on a view-only world are for reading',
        body: 'A world you can only view showed "+ Add field" and a remove button on each custom field, and then refused the change. Its custom fields now show as they are, with nothing to add or remove, and an element with none shows no Custom fields section.',
        tags: ['editor', 'fix'],
      },
    ],
  },
  {
    version: '1.56.1',
    date: '2026-10-19',
    theme: 'The files total keeps up',
    entries: [
      {
        id: 'files-total-in-step',
        title: 'A new file and the world\'s total arrive together',
        body: 'Right after a file was added, the Files section could show it beside the world\'s old total for a moment. The file now stays as Adding until the new total is in, and a removed file leaves together with its share of the total.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.56.0',
    date: '2026-10-19',
    theme: 'Files on an element',
    entries: [
      {
        id: 'element-files',
        title: 'Keep files with an element',
        body: 'In an online world, an element\'s page has a Files section: add a pdf, a text file or a world\'s own bundle, up to 25 MB each, with a label that says what it is for. Each file shows who added it and when, and an agent\'s is marked. Download fetches it fresh; Remove takes it off OnlyWorlds for everyone. The header shows how much of the world\'s 250 MB is used. Files live on OnlyWorlds only, never in your copy of the world or its world file.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.55.2',
    date: '2026-10-19',
    theme: 'Invite someone lands at Access',
    entries: [
      {
        id: 'access-link-after-sign-in',
        title: 'The link to Access survives signing in',
        body: 'Signed out of Atlas, Invite someone opens your world on onlyworlds.com at Access. If the site asked you to sign in first, it then opened the world\'s overview instead. It now opens at Access either way.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.55.1',
    date: '2026-10-19',
    theme: 'A wrong PIN is called a wrong PIN',
    entries: [
      {
        id: 'wrong-pin-said',
        title: 'A wrong PIN is called a wrong PIN',
        body: 'Downloading a world with its key and a mistyped PIN said OnlyWorlds did not accept the key, which sent you to check the wrong thing. It now says the PIN was not accepted.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.55.0',
    date: '2026-10-19',
    theme: 'A player needs no account',
    entries: [
      {
        id: 'player-link-no-account',
        title: 'Invite a player with no account',
        body: 'In Invite someone, A player now makes a link that needs no account: your friend opens it in Lantern and reads the world as one Character, seeing only what that Character knows. Pick which Character they play, or let the link make a new one for them. A player who wants their own account is one choice down, as A player with an account.',
        tags: ['sync'],
      },
      {
        id: 'player-link-opens',
        title: 'Atlas opens a player\'s link',
        body: 'A player\'s link opened in Atlas used to say it was of a kind Atlas did not know. It now opens the world to read, as the Character the link gives you, with no account and no PIN. You can give the name the game master sees.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.54.0',
    date: '2026-10-19',
    theme: 'Make online signs you in',
    entries: [
      {
        id: 'make-online-signs-in',
        title: 'Making a world online signs you in to OnlyWorlds',
        body: 'Signed out, Make online and New world on OnlyWorlds now ask for your email or username and password, sign you in, and make the world on your account, as they do when you are already signed in. They used to take an email and a PIN through the older OnlyWorlds API. Atlas keeps a token for this browser, never your password.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.53.3',
    date: '2026-10-19',
    theme: 'The now in a shared world',
    entries: [
      {
        id: 'co-builder-now-goes-through',
        title: 'A co-builder\'s change to the now goes through',
        body: 'A co-builder may move a shared world\'s now on OnlyWorlds, though not its other details. When you changed the now together with the description, both stayed in your copy. Now the now is sent on its own and lands, and only the description stays behind.',
        tags: ['fix', 'sync'],
      },
    ],
  },
  {
    version: '1.53.2',
    date: '2026-10-18',
    theme: 'World details in a shared world',
    entries: [
      {
        id: 'world-details-told-once',
        title: 'In a world you share, a change to its details is told once',
        body: 'Only a world\'s owner can change its own details on OnlyWorlds, such as its description and its calendar. When you change them in a world someone shared with you, Atlas says once that the change stays in your copy, and no longer sends it again and repeats itself with every save. Change them again and Atlas tries once more.',
        tags: ['fix', 'sync'],
      },
    ],
  },
  {
    version: '1.53.1',
    date: '2026-10-18',
    theme: 'Make online, signed in',
    entries: [
      {
        id: 'make-online-signed-in',
        title: 'Signed in, Make online asks only for your PIN',
        body: 'Signed in to OnlyWorlds, Make online makes the new world on your account and says so, so it no longer asks for your email. Your PIN still goes with it, once, so Atlas can upload the world\'s contents.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.53.0',
    date: '2026-10-18',
    theme: 'A map drawn from its own zones',
    entries: [
      {
        id: 'map-styles',
        title: 'A map can draw its zones as a coast, a forest or a river',
        body: 'On a map\'s page, Map style offers Ink on parchment, Modern atlas and Hatched. A zone whose subtype names its kind (Landmass, Sea, Lake, Range, Forest, Marsh, Desert, Territory, River, Road, Wall, Border, Coast; a Route or a Path draws as a Road) is drawn as one: a coast with its shore, a range hatched, a river that ends at the sea with its name along it. Only the look changes: your zones stay exactly as they are, and Plain brings back the usual map. On a map with a picture, the zones take the style\'s lines and names and the picture stays the ground.',
        tags: ['maps'],
      },
      {
        id: 'zone-trace',
        title: 'Trace a zone by dragging',
        body: 'While drawing a zone, turn on Trace and drag along a coast or a river. Atlas keeps the few points that carry its shape, so the zone stays light to store and to edit. A click still places one point.',
        tags: ['maps'],
      },
    ],
  },
  {
    version: '1.52.1',
    date: '2026-10-18',
    theme: 'A new zone says its shape',
    entries: [
      {
        id: 'zone-shape-word',
        title: 'A new zone with no supertype gets polygon or line there',
        body: 'Other OnlyWorlds tools cannot yet tell an area from a line by anything a zone carries, so when you leave a new zone\'s supertype empty, Atlas writes its shape there, polygon or line. A supertype you type is kept as you typed it.',
        tags: ['maps'],
      },
    ],
  },
  {
    version: '1.52.0',
    date: '2026-10-18',
    theme: 'Sign in with your email and password',
    entries: [
      {
        id: 'password-sign-in',
        title: 'Sign in to OnlyWorlds with your email or username and password',
        body: 'Settings, OnlyWorlds, Account now asks for the email or username and password of your onlyworlds.com account, as Lantern does. Atlas keeps a token of its own for this browser, named for it on your Account tokens page, and never your password. If you already made an account token, "I have an account token" under the form still takes it.',
        tags: ['settings'],
      },
    ],
  },
  {
    version: '1.51.6',
    date: '2026-10-17',
    theme: 'A click that lands, in the lists and the chart',
    entries: [
      {
        id: 'list-click-kept',
        title: 'A click on the type strip, the writing tree, the map list or the chart\'s controls is no longer lost',
        body: 'The row of element types above the elements list, the tree of books in the writing sidebar, the list of maps and the bar above the chart were redrawn whenever anything changed, and a click that fell across a redraw did nothing. They now redraw only when what they show changes.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.51.5',
    date: '2026-10-17',
    theme: 'A click that lands, on the page and in Settings',
    entries: [
      {
        id: 'page-click-kept',
        title: 'A click on an element\'s page, in Settings or on the right pane\'s tabs is no longer lost',
        body: 'These were redrawn whenever anything changed, even a sync step that changed nothing they show, and a click that fell across a redraw did nothing. They now redraw only when what they show changes.',
        tags: ['fix'],
      },
      {
        id: 'sync-badge-click-kept',
        title: 'A click on a sync badge opens what it says',
        body: 'A click on the conflicts or not-syncing badge on the sync pill could land on the pill instead and refresh from OnlyWorlds. It now opens the review, or Settings.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.51.4',
    date: '2026-10-17',
    theme: 'A click that lands, along the top',
    entries: [
      {
        id: 'room-strip-click-kept',
        title: 'A click on a room or the sidebar\'s two tabs is no longer lost',
        body: 'The row of rooms along the top and the Worlds and world tabs above the sidebar were redrawn whenever anything changed, as the Worlds list was until 1.51.3, and a click that fell across a redraw did nothing. They now redraw only when what they show changes.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.51.3',
    date: '2026-10-17',
    theme: 'A click that lands',
    entries: [
      {
        id: 'worlds-list-click-kept',
        title: 'A click in the Worlds list is no longer lost',
        body: 'The Worlds list and its Start a world buttons were redrawn whenever anything changed, and a click that fell across a redraw did nothing. They now redraw only when what they show changes.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.51.2',
    date: '2026-10-17',
    theme: 'One element, one file',
    entries: [
      {
        id: 'new-maps-in-elements-folder',
        title: 'New maps, pins, zones and markers go in elements/',
        body: 'In a world folder from an older Atlas that keeps its maps in spatial/, a new map, pin, zone or marker is now written to elements/, as the folder format asks. The old files stay where they are and still open, and an edit to one is saved in its own file.',
        tags: ['folder', 'fix'],
      },
      {
        id: 'elements-copy-served',
        title: 'One element in two places opens from elements/',
        body: 'When a folder holds the same element in both elements/ and spatial/, Atlas opens the one in elements/, as every other OnlyWorlds tool now does. Neither file is changed.',
        tags: ['folder', 'fix'],
      },
    ],
  },
  {
    version: '1.51.1',
    date: '2026-10-16',
    theme: 'Said once, said true',
    entries: [
      {
        id: 'refresh-up-to-date-only-when-true',
        title: 'Refresh says up to date only when it is',
        body: 'A refresh that met a refused key, a busy or unreachable OnlyWorlds, or a change that did not send now says only that, and no longer also that everything is up to date.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'key-line-says-refused',
        title: 'A refused key\'s line says so',
        body: 'In Settings, This world, a key OnlyWorlds no longer takes is no longer described as one that reads and writes.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.51.0',
    date: '2026-10-16',
    theme: 'A new key, in place',
    entries: [
      {
        id: 'new-key-in-place',
        title: 'An online world takes a new key without unlinking',
        body: 'When OnlyWorlds stops taking a world\'s key, Settings, This world now takes a new one in its place: paste it from the world\'s page, or, signed in, Atlas makes one from your account by itself. Everything in the world stays as it is, edits not yet sent included.',
        tags: ['sync'],
      },
      {
        id: 'key-refusal-says-why',
        title: 'A refused key says why',
        body: 'Sync now tells a revoked key, a key OnlyWorlds no longer knows (the world was deleted there, or you were removed from it), a read key and a wrong PIN apart, and says where each is fixed.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.50.2',
    date: '2026-10-16',
    theme: 'No PIN, no question',
    entries: [
      {
        id: 'member-no-pin-not-asked',
        title: 'Joining a world without a PIN asks for none',
        body: 'Someone who joins a world shared with them, on an account that has no PIN yet, now opens it to read straight away, with a line on where to set one. Atlas asks for the PIN only when the account has one.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.50.1',
    date: '2026-10-16',
    theme: 'Asked once',
    entries: [
      {
        id: 'sign-in-ask-goes',
        title: 'The ask to sign in goes once you have',
        body: 'A link that waits for you to sign in, to open a world or to accept an invitation, now takes its message down the moment the sign-in lands, instead of leaving it on screen through the next question.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.50.0',
    date: '2026-10-16',
    theme: 'Pins keep their own time',
    entries: [
      {
        id: 'pins-by-their-dates',
        title: 'A map shows its pins as of a date, by their element\'s dates',
        body: 'The date bar under a map now moves pins too: a character\'s pin from their birth on, a place\'s from its founding, an event\'s only while it lasts. Pins without dates always show, and so does the one you have selected. All dates shows every pin.',
        tags: ['maps'],
      },
    ],
  },
  {
    version: '1.49.1',
    date: '2026-10-16',
    theme: 'A link asks before it moves you',
    entries: [
      {
        id: 'open-link-asks-in-another-world',
        title: 'A link to a world never takes you out of the one you are in without asking',
        body: 'While another world is open, a link to a world you already have asks "Open it here?" and waits for your click, so you never keep working in a world you did not choose.',
        tags: ['worlds', 'fix'],
      },
    ],
  },
  {
    version: '1.49.0',
    date: '2026-10-16',
    theme: 'Open in Atlas, from the world itself',
    entries: [
      {
        id: 'open-in-atlas-link',
        title: 'A link to one of your worlds opens it in Atlas',
        body: 'Atlas now answers a link that names one of your worlds on OnlyWorlds, the kind the world\'s own page there can give. Signed in, it asks once and opens the world, or opens the copy you already have. Signed out, it asks you to sign in first and then opens it in the same tab.',
        tags: ['sync', 'worlds'],
      },
    ],
  },
  {
    version: '1.48.0',
    date: '2026-10-16',
    theme: 'Made by an agent, said quietly',
    entries: [
      {
        id: 'agent-mark',
        title: 'An element an agent changed last carries a quiet mark',
        body: 'In a synced world, when an agent made the last change to an element (an agent\'s own seat, MCP, or a tool that says it is an agent), a small mark sits after its name. Point at it or tap it to read who: "Last changed by Skeld, an agent". A person\'s change carries none, and your own edit takes the mark away.',
        tags: ['sync', 'worlds'],
      },
    ],
  },
  {
    version: '1.47.1',
    date: '2026-10-16',
    theme: 'Who wrote it is not a change',
    entries: [
      {
        id: 'author-fields-not-a-change',
        title: 'Who last changed an element no longer reads as a change',
        body: 'OnlyWorlds now records who last changed each element and how. Atlas keeps that as it arrives and never sends it back: a conflict lists only the fields someone changed, importing a world file from a synced world does not flag it as unknown, and a world imported from another world drops it, since it names people in the world it came from.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.47.0',
    date: '2026-10-16',
    theme: 'Invite someone, made here',
    entries: [
      {
        id: 'invite-made-in-atlas',
        title: 'Invite someone makes the link in Atlas',
        body: 'Signed in with your account token, Settings, This world, Invite someone now makes the invite link here, as Lantern does: choose a contributor or a player, sign it with your name, and the link appears once, with Copy and a QR code (and Send it where your system can share). It works once, for 7 days. Seeing and taking back links stays on the world\'s page on onlyworlds.com. Signed out, Invite someone still opens that page.',
        tags: ['sync', 'worlds'],
      },
    ],
  },
  {
    version: '1.46.0',
    date: '2026-10-16',
    theme: 'Your worlds on the first screen',
    entries: [
      {
        id: 'first-screen-account-worlds',
        title: 'Signed in, the first screen lists your worlds on OnlyWorlds',
        body: 'Before you had a world in Atlas, the first screen showed only its two doors, even when you were signed in with your account token: your worlds on OnlyWorlds, your own and those shared with you, were offered nowhere. Now they are listed under the doors, and one click opens a world. Signing in from Settings on a browser with no world says where to find them.',
        tags: ['sync', 'worlds'],
      },
    ],
  },
  {
    version: '1.45.0',
    date: '2026-10-15',
    theme: 'An invitation for a person opens in Atlas',
    entries: [
      {
        id: 'person-invite-door',
        title: 'Open in Atlas on an invitation joins you with your own account',
        body: 'An invite link opened in Atlas used to work only for an AI agent. An invitation made for a person now asks you to join with your OnlyWorlds account, says what your role lets you do, and then opens the world on a key made for you. Not signed in yet, Atlas takes you to sign in with your account token and the invitation comes back after.',
        tags: ['sync', 'worlds'],
      },
    ],
  },
  {
    version: '1.44.0',
    date: '2026-10-15',
    theme: 'A world shared with you opens with one click',
    entries: [
      {
        id: 'shared-world-opens',
        title: 'A world shared with you opens like one you own',
        body: 'Signed in with your account token, a world you were invited into used to send you to onlyworlds.com to make a key and paste it back. Now its row under On OnlyWorlds opens it, with a key made for you. A co-builder or contributor edits with their own PIN, a guest opens it to read, and a member whose account has no PIN yet opens it to read and is told where to set one.',
        tags: ['sync', 'worlds'],
      },
    ],
  },
  {
    version: '1.43.4',
    date: '2026-10-15',
    theme: 'Moppetopia from Settings, help beside an open map',
    entries: [
      {
        id: 'demo-in-settings',
        title: 'Explore Moppetopia from Settings, once you have a world',
        body: 'The demo world could only be opened from the first screen or an empty world, so it was gone once you had a world of your own. Settings now has Explore Moppetopia above Replay the tour, and it opens your copy if you already have one.',
        tags: ['onboarding'],
      },
      {
        id: 'help-open-map',
        title: 'Help covers the map you have open',
        body: 'With a map open in the right pane, the help panel now adds what you can do on a map under the room\'s own lines. Before, it showed only the room you were in.',
        tags: ['maps'],
      },
    ],
  },
  {
    version: '1.43.3',
    date: '2026-10-15',
    theme: 'Maps inside maps, said',
    entries: [
      {
        id: 'nested-maps-said',
        title: 'Going down into a location\'s own map is explained where you meet it',
        body: 'A location can have its own map, and its pin on a bigger map leads into it. Now the map badge on that pin says so when you hover it, help on a map has a line on how to make one and go down and back up, and the Location and Parent Map fields on a map\'s page say in plain words what each does.',
        tags: ['maps'],
      },
    ],
  },
  {
    version: '1.43.2',
    date: '2026-10-15',
    theme: 'An imported world opens whole',
    entries: [
      {
        id: 'import-opens-whole',
        title: 'A world brought in as a new world opens with its own details',
        body: 'After Data, Import as a new world, the world opened with only its name until a reload: Home asked you to describe a world that already had a description, and the map had no Now for its dated zones. It now opens with its description, its dates and the rest, and the address and the world tab name the new world, so a reload keeps you there.',
        tags: ['import', 'fix'],
      },
    ],
  },
  {
    version: '1.43.1',
    date: '2026-10-15',
    theme: 'Refresh says it once',
    entries: [
      {
        id: 'refresh-says-once',
        title: 'Refresh from OnlyWorlds says what came down once',
        body: 'A refresh that brought changes showed two messages with the same count in different words. Now one says how many are new or updated, and a refresh with nothing new still says it is up to date.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.43.0',
    date: '2026-10-15',
    theme: 'The chart by finger',
    entries: [
      {
        id: 'touch-chart',
        title: 'Pinch, slide and re-date on a phone\'s chart',
        body: 'On a touch screen, two fingers zoom the chart from eras down to days, and one finger slides it through time or moves the band in the strip below it. Tap a dot, then slide it along the axis to give it a new date, or slide a range by its end; the now-line slides too. Sliding across a dot you have not tapped moves the chart, so a crowded chart still travels. Up and down still scroll the page.',
        tags: ['charts'],
      },
    ],
  },
  {
    version: '1.42.0',
    date: '2026-10-15',
    theme: 'Hide types on a touch screen',
    entries: [
      {
        id: 'touch-hide-types',
        title: 'Hide a type from the list on a phone',
        body: 'On a touch screen the type strip in the sidebar ends with Hide types. Tap it, then tap a type to keep it out of the full list, or tap a hidden one to bring it back, and tap Done. With a mouse, a right-click on a type still does it.',
        tags: ['layout'],
      },
    ],
  },
  {
    version: '1.41.0',
    date: '2026-10-15',
    theme: 'Dates to check',
    entries: [
      {
        id: 'home-date-conflicts',
        title: 'Home points out dates worth a second look',
        body: 'Loose threads at the bottom of a world\'s home now lead with dates to check: a title revoked before it was granted, an event set off by one that began later, a character linked to a battle that ended before they were born. Each shows both dates in your world\'s calendar, and both names open the element. Some can be right, like a historian of an old war, so Atlas only points and never changes anything.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.40.0',
    date: '2026-10-15',
    theme: 'Borders that move with time',
    entries: [
      {
        id: 'map-zones-by-date',
        title: 'A map shows its zones as of a date',
        body: 'When zones on a map have a start or end date, a bar along the bottom of the map shows them as of the world\'s now. Slide it to watch a border change, or choose All dates to see every era at once. A zone without dates always shows, and dates read in your world\'s calendar.',
        tags: ['maps'],
      },
      {
        id: 'hidden-zones-ignore-clicks',
        title: 'A hidden zone no longer catches clicks',
        body: 'A zone you hid with its eye in the zones list, or that the date hides, could still be clicked where it would have been drawn. Now a click lands on what you can see.',
        tags: ['maps', 'fix'],
      },
    ],
  },
  {
    version: '1.39.0',
    date: '2026-10-15',
    theme: 'Find on a touch screen',
    entries: [
      {
        id: 'touch-find-in-writing',
        title: 'A Find button in Writing on a touch screen',
        body: 'On a phone or tablet, the bar over a text has a search button that opens find, where Ctrl+F was the only way in. Link to element works from there too. With a mouse, nothing changes.',
        tags: ['writing'],
      },
    ],
  },
  {
    version: '1.38.0',
    date: '2026-10-15',
    theme: 'Signing in, said plainly',
    entries: [
      {
        id: 'account-one-sign-in',
        title: 'One way to sign in, and where your PIN comes from',
        body: 'Settings, OnlyWorlds, Account opens with the account token, the one way to sign in. Below it, the PIN says it is one for all your worlds and that you set it on onlyworlds.com, in Account settings under World PIN, and the email says Make online uses it.',
        tags: ['sync', 'copy'],
      },
      {
        id: 'picture-once-online',
        title: 'A local world says when pictures can upload',
        body: 'An element in a world that is not online now shows an Upload picture row that says pictures upload once the world is online, with Make online beside it. Until then, an image URL can still show a picture from any address.',
        tags: ['editor'],
      },
    ],
  },
  {
    version: '1.37.2',
    date: '2026-10-15',
    theme: 'Tighter rules for your browser',
    entries: [
      {
        id: 'security-headers',
        title: 'Atlas tells your browser what it may load',
        body: 'Atlas now asks your browser to reach it only over a secure connection, and to load scripts only from Atlas itself and send your world only to onlyworlds.com. Your keys and PIN stay safer even if a world file carries something it should not. Pictures still load from any address.',
        tags: ['safety'],
      },
    ],
  },
  {
    version: '1.37.1',
    date: '2026-10-15',
    theme: 'The worlds list on a phone',
    entries: [
      {
        id: 'world-row-name-button',
        title: 'A world\'s name is its button',
        body: 'In the worlds list, a world\'s name is now the button that opens it, beside its star and sync buttons rather than around them. Screen readers no longer meet a button inside a button, and Tab moves from a world\'s name to its star. A click anywhere on the row still opens the world.',
        tags: ['fix'],
      },
      {
        id: 'update-banner-over-drawer',
        title: 'The update message clears the side panel\'s bottom row',
        body: 'On a phone with the side panel open, "A new version of Atlas is ready" covered the row of buttons at the panel\'s foot. It now sits above them.',
        tags: ['fix', 'layout'],
      },
    ],
  },
  {
    version: '1.37.0',
    date: '2026-10-15',
    theme: 'A phone hears touch, and of Lantern',
    entries: [
      {
        id: 'touch-help-and-tour',
        title: 'Help and the tour speak touch',
        body: 'On a touch screen, help and the tour say tap where they said click, right-click, drag or a key, and leave out what only a mouse or keyboard can do. Help shows a short touch section in place of the keyboard list. With a mouse, nothing changes.',
        tags: ['layout'],
      },
      {
        id: 'touch-messages',
        title: 'Messages without keys on a touch screen',
        body: 'Linking every mention no longer says Ctrl+Z undoes it on a touch screen, search says tap one to jump, and Charts says to tap an undated element to give it a date on its page, since dragging onto the chart needs a mouse.',
        tags: ['layout'],
      },
      {
        id: 'writing-plus-on-touch',
        title: 'The + on a writing row shows on a touch screen',
        body: 'A book or chapter in the writing list makes a chapter or scene from its +. With a mouse it shows when you point at the row; a touch screen cannot point, so there it now always shows.',
        tags: ['fix'],
      },
      {
        id: 'lantern-on-a-phone',
        title: 'A phone hears of Lantern',
        body: 'On a phone, the first screen and help point to Lantern, the OnlyWorlds app made for a phone: it catches notes at the table and keeps your world offline.',
        tags: ['layout'],
      },
    ],
  },
  {
    version: '1.36.1',
    date: '2026-10-15',
    theme: 'Opening a world counts its files',
    entries: [
      {
        id: 'opening-counts',
        title: 'Opening a world counts its files',
        body: 'Opening Moppetopia now shows how many of its files are in place. In Firefox it took about twenty seconds on one quiet line; it still takes a while there, and now says how far it has got. Moppetopia and world files also write several files at once, so in Chrome they open faster.',
        tags: ['world', 'performance'],
      },
    ],
  },
  {
    version: '1.36.0',
    date: '2026-10-15',
    theme: 'Invite someone, and where an account comes from',
    entries: [
      {
        id: 'invite-someone',
        title: 'Invite someone to an online world',
        body: 'Settings, This world, has an Invite someone link for a world you own online. It opens the world on onlyworlds.com at Access, where you make an invite link to send. The person you invite needs a free account.',
        tags: ['sync', 'world'],
      },
      {
        id: 'no-account-yet',
        title: 'No account yet? The way to one',
        body: 'Make online and New world on OnlyWorlds ask for an email and a PIN. Both now say where to make a free account on onlyworlds.com and where to set its PIN.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.35.3',
    date: '2026-10-14',
    theme: 'A world that will not open says so',
    entries: [
      {
        id: 'open-failure-said',
        title: 'A world that will not open says so',
        body: 'When a world could not be opened from a message, a retry or the list, Atlas could report it as a problem with work in the background. It now says it could not open the world.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.35.2',
    date: '2026-10-14',
    theme: 'Moppetopia says it all the way',
    entries: [
      {
        id: 'demo-opening-said',
        title: 'Moppetopia says it is opening',
        body: 'After the download, Atlas still says what it is doing while it sets up your copy, until Moppetopia is open. Before, the last seconds showed the front page with nothing on it.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.35.1',
    date: '2026-10-14',
    theme: 'Moppetopia on a weak line',
    entries: [
      {
        id: 'demo-download-weak-line',
        title: 'Moppetopia says how its download is going',
        body: 'While Moppetopia comes down, Atlas shows that it is downloading until it opens. On a connection that stops answering, it gives up after 30 seconds and says to check your connection, instead of waiting in silence.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.35.0',
    date: '2026-10-14',
    theme: 'a phone, second pass',
    entries: [
      {
        id: 'phone-type-tiles',
        title: 'Type icons you can tap on a phone',
        body: 'On a phone the type icons in the side panel are tiles big enough for a finger, each with its count under the icon, and the page behind the open panel is dimmed further.',
        tags: ['layout'],
      },
      {
        id: 'toast-tap-closes',
        title: 'A tap closes a message',
        body: 'On a touch screen a tap on a message at the bottom of the screen closes it. Before, a tap kept it there until you tapped somewhere else.',
        tags: ['fix'],
      },
      {
        id: 'image-hide-eye',
        title: 'The hide button on a picture is an eye',
        body: 'The button in the corner of an element\'s picture hides every element\'s picture, so it now shows a crossed-out eye instead of an ×. On a touch screen it is gone; Settings, Elements has the same switch.',
        tags: ['editor'],
      },
      {
        id: 'touch-words',
        title: 'Words for a touch screen',
        body: 'On a touch screen the edit box no longer names keyboard keys, and the Data room asks you to tap to choose a file instead of dropping or clicking.',
        tags: ['layout'],
      },
    ],
  },
  {
    version: '1.34.0',
    date: '2026-10-14',
    theme: 'names on the type row',
    entries: [
      {
        id: 'type-strip-names',
        title: 'Names on the row of type icons',
        body: 'Settings, Elements, Type names in the sidebar: keep the icons on their own (as before), name the types your world has with their counts, or name every type.',
        tags: ['sidebar', 'settings'],
      },
    ],
  },
  {
    version: '1.33.0',
    date: '2026-10-14',
    theme: 'Atlas on a phone',
    entries: [
      {
        id: 'phone-room-strip',
        title: 'A top bar for a thumb',
        body: 'On a phone the bar along the top keeps Home and Writing, puts Knowledge, Charts, Pages and Data under More, and every button in it is big enough to tap. Atlas is still built for a bigger screen; on a phone it now holds together.',
        tags: ['layout'],
      },
      {
        id: 'phone-visible-height',
        title: 'The top bar stays in reach on a phone',
        body: 'Atlas now sizes itself to the part of a phone\'s screen you can see, address bar and keyboard included, to keep the top bar in reach while you write.',
        tags: ['layout', 'fix'],
      },
      {
        id: 'phone-rooms-fit',
        title: 'Rooms that fit a phone',
        body: 'An element\'s fields put each name above its value, so the value gets the whole width. A chart\'s side panel sits under the chart. The small buttons in each room are big enough to tap.',
        tags: ['layout'],
      },
    ],
  },
  {
    version: '1.32.2',
    date: '2026-10-11',
    theme: 'one reader for world files',
    entries: [
      {
        id: 'world-file-sdk-reader',
        title: 'World files read the same everywhere',
        body: 'Atlas now opens and makes world files with the OnlyWorlds SDK\'s own reader and writer, the same ones other OnlyWorlds tools use, so a world file made in one opens in the others. Files Atlas made before open as they always did.',
        tags: ['data'],
      },
    ],
  },
  {
    version: '1.32.1',
    date: '2026-10-11',
    theme: 'the Web settings in plain words',
    entries: [
      {
        id: 'web-settings-plain',
        title: 'The Web settings in plain words',
        body: 'Settings, Web spoke of hop depth, tier-derived defaults and per-ring caps. It now says Graph reach, explains Auto in one sentence, and calls the two switches by what they do: keep the graph still, and colour each line by type. The graph\'s own buttons say the same.',
        tags: ['web', 'fix'],
      },
    ],
  },
  {
    version: '1.32.0',
    date: '2026-10-11',
    theme: 'capitals everywhere else',
    entries: [
      {
        id: 'sentence-case-everywhere',
        title: 'Capitals on the rest of the buttons',
        body: 'The last lowercase labels now start with a capital too: the command palette, Settings, the colour picker, the zone line styles, the chart menu, the calendar checks, the Worlds list and the tour\'s last page. The landing\'s doors and small status tags stay as they were. A world made without a name is now called Untitled world.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.31.0',
    date: '2026-10-11',
    theme: 'names in the text, capitals on the buttons',
    entries: [
      {
        id: 'sentence-case-rooms',
        title: 'Capitals on the buttons',
        body: 'The Sharing room, the knowledge room, the calendar builder, the world clock and the new chapter dialog spoke in lowercase: publish, done, cancel. Their buttons, titles and labels now start with a capital, like the rest of Atlas. Small status tags such as live or not published stay as they were. A new page is called New page.',
        tags: ['fix'],
      },
      {
        id: 'pause-sync-name',
        title: 'Stay offline is now Pause sync',
        body: 'The switch that stops one world syncing was called Stay offline, which read like a lost connection. It is now Pause sync (this world), beside Pause all sync.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'type-not-category',
        title: 'One word for the kinds of element',
        body: 'Atlas called them both categories and types. It now says type everywhere. The landing\'s line reads Worldbuilding on OnlyWorlds.',
        tags: ['fix'],
      },
      {
        id: 'potentials-named-in-text',
        title: 'Potentials list the names in your text',
        body: 'When a scene names an element without linking it, the name gets a dotted underline, but Potentials beside it said there were none. Potentials now lists those elements first, marked "in the text", each with a Link button that links it where the text names it. Your text does not change.',
        tags: ['writing', 'context'],
      },
    ],
  },
  {
    version: '1.30.1',
    date: '2026-10-11',
    theme: 'a world comes back without the PIN',
    entries: [
      {
        id: 'bring-down-without-pin',
        title: 'Downloading a cleared world again needs no PIN',
        body: 'When this browser cleared an online world, downloading it again asked for your PIN first. OnlyWorlds lets a key read without it, so the world now comes back either way, and its sync starts once your PIN is in Settings, under OnlyWorlds. An older ten-digit key still asks first.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.30.0',
    date: '2026-10-11',
    theme: 'plainer words',
    entries: [
      {
        id: 'copy-pass-plain-words',
        title: 'Plainer words across Atlas',
        body: 'Four readers went through every line Atlas shows. Engine words like pull, push, slug and API gave way to what the screen calls things: Refresh from OnlyWorlds, the page URL, onlyworlds.com. Every delete confirm now says it cannot be undone.',
        tags: ['fix'],
      },
      {
        id: 'copy-pass-true-remedies',
        title: 'Error lines point at a step that works',
        body: 'A few lines sent you somewhere that could not help: reopening a world that was still linked, or asking a shared world\'s owner for their key. A revoked or read key now points at Unlink, then Make online with a new key, and a member of a shared world is told to make their own key on onlyworlds.com.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'share-read-key-refusal',
        title: 'A read key says why it cannot publish',
        body: 'Publishing with a read key, such as the demo world\'s, said authentication failed. It now says the key can only read. A page URL with a doubled hyphen is refused right away, as OnlyWorlds would refuse it.',
        tags: ['sharing', 'fix'],
      },
      {
        id: 'web-legend-plural',
        title: 'The web legend counts right',
        body: 'The Web tab\'s legend read "1 links here" and "2 link here". It now agrees with its number.',
        tags: ['web', 'fix'],
      },
    ],
  },
  {
    version: '1.29.0',
    date: '2026-10-11',
    theme: 'one step, not a hundred',
    entries: [
      {
        id: 'server-deletes-all-at-once',
        title: 'Clear server deletes in one step',
        body: 'When elements are deleted on onlyworlds.com, Atlas asks what to do with each local copy, one click at a time: 114 deletes took 114 clicks. Delete all locally now clears them in one confirmed step. A copy you edited here since the last sync is listed first and kept unless you tick it.',
        tags: ['sync'],
      },
      {
        id: 'zone-pentagon-icon',
        title: 'Zones get their own icon',
        body: 'A zone showed a drafting compass. It now shows a pentagon, the shape a zone draws on a map.',
        tags: ['maps'],
      },
    ],
  },
  {
    version: '1.28.1',
    date: '2026-10-10',
    theme: 'numbers stay numbers',
    entries: [
      {
        id: 'time-equivalents-numbers',
        title: 'Time units keep their numbers',
        body: 'OnlyWorlds now stores a world\'s time unit equivalents as numbers (a week is 7 days), as the standard types them. Atlas read only words in that list, so a world saved that way arrived with the list empty and no calendar to offer. Atlas now keeps numbers and words both, exactly as they are.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.28.0',
    date: '2026-10-10',
    theme: 'places, not pins',
    entries: [
      {
        id: 'web-places-and-zones',
        title: 'A map\'s web shows places and zones',
        body: 'The Web tab drew every pin and every marker as a dot of its own, so a map\'s web was a knot: Moppetopia\'s Space Map drew 73 dots, 67 of them pins and markers. A pin now shows as the place it marks, and a zone\'s markers as the zone, with how many in its tooltip. On a place\'s own web, its pin shows as the map it sits on.',
        tags: ['context', 'maps'],
      },
    ],
  },
  {
    version: '1.27.1',
    date: '2026-10-10',
    theme: 'dollar signs',
    entries: [
      {
        id: 'notes-dollar-signs',
        title: 'Notes keep their dollar signs',
        body: 'When a world\'s notes changed in another tab while you were typing in them, Atlas merged the two, and a "$\'" or "$&" in what you typed was swapped for other text. Typed notes now go in exactly as written.',
        tags: ['world', 'fix'],
      },
    ],
  },
  {
    version: '1.27.0',
    date: '2026-10-10',
    theme: 'only what is there',
    entries: [
      {
        id: 'hide-empty-fields',
        title: 'Hide empty fields',
        body: 'An element page can show only the fields that hold something: a new character was a wall of 38 empty rows. Switch it under the fields ("Hide the 21 empty fields", "Show them") or in Settings, Elements. An element with nothing filled in still shows its first section, so there is always somewhere to start.',
        tags: ['editor'],
      },
    ],
  },
  {
    version: '1.26.5',
    date: '2026-10-10',
    theme: 'whole names',
    entries: [
      {
        id: 'collection-whole-names',
        title: 'A collection shows whole names',
        body: 'On a page, a collection cut most names short to fit the type beside them. The type now sits under the name, and a long name wraps instead of being cut, in Atlas and on the published page. A published page\'s link preview also carries its own opening text and its first picture.',
        tags: ['pages', 'fix'],
      },
    ],
  },
  {
    version: '1.26.4',
    date: '2026-10-10',
    theme: 'letting go',
    entries: [
      {
        id: 'clear-selection-sticks',
        title: 'Clearing the selection on an element page sticks',
        body: 'On an element page, the × on the selected element and the Escape key cleared the selection, and it came straight back. Both now go to the world\'s home with nothing selected.',
        tags: ['layout', 'fix'],
      },
      {
        id: 'pins-named-for-screen-readers',
        title: 'A screen reader names each pin',
        body: 'Every pin on a map was announced as "Marker". Each pin now carries the name of the element it marks, and keeps it through a rename.',
        tags: ['maps', 'fix'],
      },
    ],
  },
  {
    version: '1.26.3',
    date: '2026-10-10',
    theme: 'pins and markers do not vote',
    entries: [
      {
        id: 'backlinks-pins-markers',
        title: 'A map lists its pins by place and its markers by zone',
        body: 'On a map, the Web tab and the element page listed every pin and marker as "(unnamed)": Moppetopia\'s Space Map was linked from 118 things. Now "Linked from" counts what the story links, each pin reads as the element it marks, and markers fold into one entry per zone ("Crumblefields: 16 markers"). In the web itself an unnamed pin is named the same way, and a marker shows its zone when you point at it.',
        tags: ['maps', 'fix'],
      },
    ],
  },
  {
    version: '1.26.2',
    date: '2026-10-10',
    theme: 'no promise too far',
    entries: [
      {
        id: 'remove-picture-wording',
        title: 'Remove picture says what it cannot do',
        body: 'Removing a picture takes it off OnlyWorlds at once, but copies already cached on the way can keep showing at its link for days. The question before a removal now says so, instead of promising the link stops working.',
        tags: ['world', 'fix'],
      },
    ],
  },
  {
    version: '1.26.1',
    date: '2026-10-10',
    theme: 'no edit left behind',
    entries: [
      {
        id: 'edit-after-sync-clock',
        title: 'An edit made just after a sync now always uploads',
        body: 'When this computer\'s clock ran a little behind OnlyWorlds, a change made in the seconds after a sync could look older than the copy on the server, and Atlas kept it here without uploading it. Every change now counts as newer than the last sync, whatever the clock says.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.26',
    date: '2026-10-10',
    theme: 'and take it back',
    entries: [
      {
        id: 'remove-picture',
        title: 'Remove a picture you uploaded',
        body: 'An element whose picture you uploaded through Atlas has Remove picture beside Choose a picture. It deletes the picture from OnlyWorlds for good, after asking, and clears the image URL of every element here that showed it. The uploader and the world\'s owner can remove a picture.',
        tags: ['world', 'sync'],
      },
    ],
  },
  {
    version: '1.25.1',
    date: '2026-10-10',
    theme: 'a quicker first look',
    entries: [
      {
        id: 'demo-faster-firefox',
        title: 'Moppetopia opens faster, most of all in Firefox',
        body: 'Exploring Moppetopia wrote every element to this browser twice: once to build the copy, once to keep it. It now builds the copy in memory and writes it once, so it opens in about half the time, in Firefox (where each write is slow) and in Chrome alike.',
        tags: ['performance'],
      },
    ],
  },
  {
    version: '1.25',
    date: '2026-10-10',
    theme: 'one level down',
    entries: [
      {
        id: 'submap-door',
        title: 'Step into a place\'s own map, and back up',
        body: 'Click a pin whose place has a map of its own (the pin wears a small map badge) and an Open button appears beside it, which shows that map in the same tab. A map that sits inside another shows the way back at the start of its toolbar.',
        tags: ['maps'],
      },
    ],
  },
  {
    version: '1.24.1',
    date: '2026-10-10',
    theme: 'room to read',
    entries: [
      {
        id: 'web-tab-knot',
        title: 'A busy element\'s web no longer knots',
        body: 'An element with many links drew its neighbours in one pile with their names printed over each other. The web now spreads them out, and each name takes the first free side of its circle or shows when you point at it, so no name covers another.',
        tags: ['context', 'fix'],
      },
    ],
  },
  {
    version: '1.24',
    date: '2026-10-10',
    theme: 'a clean slate',
    entries: [
      {
        id: 'forget-browser',
        title: 'Forget everything in this browser',
        body: 'Settings, Storage has a button that removes everything Atlas keeps in this browser: the worlds kept here, your PIN and sign-in, the folders it remembers and every setting. It names any world that exists only here before you confirm, and asks you to type forget. Folders on your drive and worlds on onlyworlds.com stay. Afterwards Atlas opens as on a first visit.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.23',
    date: '2026-10-10',
    theme: 'a picture of its own',
    entries: [
      {
        id: 'upload-picture',
        title: 'Upload a picture for an element',
        body: 'In a world that is online, an element has an Upload picture row under its image URL. Choose a WebP, PNG, JPEG or AVIF file and Atlas puts it on OnlyWorlds and sets it as the image URL, so it shows on the element here and on onlyworlds.com. Anyone with its link can see an uploaded picture, even in a private world.',
        tags: ['world', 'sync'],
      },
    ],
  },
  {
    version: '1.22.1',
    date: '2026-10-10',
    theme: 'the file as it is',
    entries: [
      {
        id: 'tidy-reads-disk',
        title: 'Renaming a file keeps an outside edit',
        body: 'When a world opens, Atlas gives hand-named element files their standard name in the background. It now reads each file just before renaming it, so an edit another program made a moment earlier is kept, and a file with unresolved git conflict marks is left where it is.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.22',
    date: '2026-10-10',
    theme: 'a seat of its own',
    entries: [
      // The #/join/ door ships in this release too, unannounced: no page can
      // make its link until keel's Open in Atlas button is live (Skeld,
      // 2026-10-10). Its entry lands with that button.
      {
        id: 'seat-worlds',
        title: 'A world on a seat keeps its own secret',
        body: 'A world linked with a seat\'s key and secret (ow_s_) now keeps that secret for itself: it no longer takes the place of your account PIN, and your PIN is never sent for it. Where a seat may change only what it made, a change to someone else\'s element stays in Atlas and is listed under Not syncing, and the rest of the world keeps syncing. The PIN asked for when you open an account world takes four digits only.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.21',
    date: '2026-10-09',
    theme: 'units',
    entries: [
      {
        id: 'world-units',
        title: 'Units for a world\'s numbers',
        body: 'Settings, This world now names the units a world counts in: length for heights, mass for weights, distance for range, speed and elevation. Each one shows after its number in the element view, as written, so "hands" and "leagues" work too. Nothing converts. An online world keeps them in sync with OnlyWorlds, where every tool can read them.',
        tags: ['world', 'sync'],
      },
    ],
  },
  {
    version: '1.20.1',
    date: '2026-10-09',
    theme: 'the right page',
    entries: [
      {
        id: 'ai-docs-link',
        title: 'More ways to convert opens the AI docs',
        body: 'In the Data room, the link to more ways to convert now opens the OnlyWorlds docs page on working with AI, which covers every way in, instead of the toolkit\'s front page.',
        tags: ['data'],
      },
    ],
  },
  {
    version: '1.20',
    date: '2026-10-09',
    theme: 'the first hour, steadier',
    entries: [
      {
        id: 'cards-stay-done',
        title: 'Cards that stay where they are',
        body: 'On a young world\'s Home, the character and location cards stay in place once made, greyed with a check, and the question above them stays until both exist, so the block no longer changes shape under your first element.',
        tags: ['world'],
      },
      {
        id: 'grow-your-world',
        title: 'Grow your world',
        body: 'After a character and a location, the Home suggests an event, a narrative, a map and a collective, each opening its own room: Charts, Writing, the map and Knowledge. A made one stays, checked, and opens that room. The waypoints are achievements in Settings, OnlyWorlds, not the route.',
        tags: ['world'],
      },
      {
        id: 'what-do-you-have-clearer',
        title: 'One clear question on a new world',
        body: 'It is a clear heading over its three answers, and the answers line up in one column.',
        tags: ['world'],
      },
      {
        id: 'data-room-one-flow',
        title: 'The Data room says it in one place',
        body: 'Bring in takes anything in the OnlyWorlds format, whatever made it, and says right under that how to convert notes that are not in the format yet, with a link to more ways.',
        tags: ['data'],
      },
      {
        id: 'moppetopia-opens-elements',
        title: 'Moppetopia opens onto its elements',
        body: 'Exploring Moppetopia shows its elements in the sidebar, not the worlds list.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.19',
    date: '2026-10-09',
    theme: 'the first hour',
    entries: [
      {
        id: 'landing-two-doors',
        title: 'Two doors on the first screen',
        body: 'The first screen leads with start a world and Moppetopia. The tour, a world folder and the other ways in sit on one line under them.',
        tags: ['world'],
      },
      {
        id: 'what-do-you-have',
        title: 'A new world asks what you have',
        body: 'An empty world\'s Home asks one quiet question with three answers: start with a character and a location, bring in a world you have somewhere else, or look around Moppetopia or the tour. Nothing has to be answered.',
        tags: ['world'],
      },
      {
        id: 'next-steps',
        title: 'One list of next steps',
        body: 'Once a world has a character and a location, its Home shows the next three steps in the order a world tends to grow, each opening the place where it is done. A step leaves when you have done it, or when the world already has it. See all opens the whole list in Settings, OnlyWorlds, where telling a story and who knows what are now steps too.',
        tags: ['world'],
      },
      {
        id: 'start-links',
        title: 'A link for each way in',
        body: 'atlas.onlyworlds.com/#/start starts a world, and #/bring-in starts one and opens its Data room, beside #/try-demo for Moppetopia. A world started from one of these links is not asked again.',
        tags: ['world'],
      },
      {
        id: 'convert-prompt-plainly',
        title: 'The notes prompt, said plainly',
        body: 'The Data room says what the prompt is for: give it and your notes to an AI assistant, then paste the JSON it returns, which you review before it lands. The prompt now asks the assistant to convert only what your notes say.',
        tags: ['data'],
      },
      {
        id: 'one-name-each',
        title: 'One name for each way in',
        body: 'Start a world, explore Moppetopia and download a world from OnlyWorlds now read the same on the first screen, in add a world and in their dialogs, and the dialog for a new world on OnlyWorlds no longer says API world.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.18',
    date: '2026-10-09',
    theme: 'the demo world',
    entries: [
      {
        id: 'try-the-demo-world',
        title: 'Try the demo world',
        body: 'The first screen, and add a world, offer Moppetopia: a small world downloaded from OnlyWorlds as your own copy in this browser. Change anything in it; nothing goes back to OnlyWorlds. Trying it again opens the copy you have.',
        tags: ['world'],
      },
      {
        id: 'view-only-no-delete',
        title: 'A view-only world offers no Delete',
        body: 'In a world you view with a read key, an element no longer shows a Delete button that could only be refused.',
        tags: ['world'],
      },
      {
        id: 'map-labels-never-clash',
        title: 'Map labels no longer sit on pins or each other',
        body: 'A pin\'s name takes the first clear side of its pin; when no side is clear, hover the pin to read it. A zone and a pin with the same name show it once. The same holds in a page\'s map preview, which now matches the published page.',
        tags: ['maps', 'pages'],
      },
      {
        id: 'home-chart-labels',
        title: 'Names on the Home chart stay readable',
        body: 'On the chart on a world\'s Home, names no longer print over each other or over another element, and a timespan\'s line passes behind a name instead of through it.',
        tags: ['charts'],
      },
      {
        id: 'download-wording',
        title: 'One word for getting a world from OnlyWorlds',
        body: 'Every button, title and message that copies a world from OnlyWorlds to you now says download.',
        tags: ['world'],
      },
      {
        id: 'try-demo-link',
        title: 'A link straight into the demo world',
        body: 'atlas.onlyworlds.com/#/try-demo opens Moppetopia as your own copy, the same as the button on the first screen. If you already have the copy, it opens that one.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.17',
    date: '2026-10-09',
    theme: 'worlds in your browser',
    entries: [
      {
        id: 'worlds-in-your-browser',
        title: 'A world can live in your browser',
        body: 'On Firefox a world now lives in the browser\'s own storage, and that is a full home: start a world, bring one down from OnlyWorlds, import one, or open a world file. On Chrome, Edge and Brave every new world asks where it should live: in a folder on your drive, where your AI and other tools can work on it, or in this browser.',
        tags: ['world'],
      },
      {
        id: 'move-to-a-folder',
        title: 'Move a world from the browser to a folder',
        body: 'On Chrome, Edge and Brave, Settings, under This world, moves a browser world into your folder: Atlas copies it, checks the copy, then removes it from the browser. Sync carries on from the folder.',
        tags: ['world', 'folder'],
      },
      {
        id: 'world-file',
        title: 'Download the whole world as one file',
        body: 'One .zip holds the world: elements, pages, notes, charts and images. Atlas 1.17 or later opens it on any browser, as a world of its own. The file leaves out the OnlyWorlds link and its key.',
        tags: ['world', 'safety'],
      },
      {
        id: 'seat-secret',
        title: 'Link a world with an agent seat',
        body: 'Bring down a world from OnlyWorlds takes a seat\'s secret (ow_s_…) where it asks for the PIN, so a seat someone invited you to works in Atlas, with its own key and without the account PIN.',
        tags: ['world'],
      },
      {
        id: 'cleared-world-keeps-its-row',
        title: 'A cleared world keeps its place',
        body: 'If the browser clears its storage but keeps Atlas\'s list, the world\'s row says "Cleared by this browser" and keeps its link: bring it down again from OnlyWorlds, or open the file you downloaded. Clearing the site\'s data removes the list too, so the download is the way back.',
        tags: ['world', 'safety'],
      },
      {
        id: 'keep-safe-card',
        title: 'A card asks for a copy before it matters',
        body: 'Once a browser world holds 25 elements, a written scene or a map image, its home shows "This world lives only in this browser" with Download, Move to a folder and Take it online. The × hides it for a week; a download hides it until the world has changed and a week has passed.',
        tags: ['world', 'safety'],
      },
      {
        id: 'keep-the-tour-world',
        title: 'Keep the tour world',
        body: 'At the end of the tour: Keep this world, Save it to a folder (Chrome, Edge and Brave), or Start fresh. A kept Hyperion gets its own ids, so it can go online and sit beside a later tour.',
        tags: ['tour'],
      },
      {
        id: 'link-dialog-busy-buttons',
        title: 'Fixed: the link dialog\'s busy buttons',
        body: '"Cancel link" and "Stop and keep what\'s here" showed from the moment the dialog opened. They now show only while a link is running. Elements that do not download now say that Refresh from API brings them, instead of promising a retry that never came.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.16',
    date: '2026-10-04',
    theme: 'errors that help',
    entries: [
      {
        id: 'every-error-in-plain-words',
        title: 'Every error now says what happened, in plain words',
        body: 'The rest of Atlas follows what 1.15 started: opening, linking and creating worlds, elements, maps, zones, pins, calendars, writing, knowledge, pages, charts and the Data room all say what went wrong and what you can do, instead of passing on the browser\'s own error text, with Retry where running the step again is safe.',
        tags: ['editor'],
      },
      {
        id: 'not-syncing-list',
        title: 'See what is not syncing, and why',
        body: 'When elements keep failing to sync, the sync pill shows a ⚠ with how many, and Settings, under This world, lists each one with the reason and the fix: give it a new id, shorten a custom field, or try again. A sync error on the pill now opens that list too.',
        tags: ['sync'],
      },
      {
        id: 'error-details-fields-only',
        title: 'Error details carry no names, paths or text',
        body: 'The details you can copy or send as feedback are now built from fixed facts only: the kind of error, its code and the field it names. An unexpected error still includes its own message, with capitalised names, file and folder paths, keys and email addresses taken out. A name typed in lowercase can still show, and you see the whole text on the feedback page before you send it.',
        tags: ['editor'],
      },
      {
        id: 'held-files-pull',
        title: 'Refreshing waits out OneDrive and antivirus too',
        body: 'A file another program held could still stop a refresh from OnlyWorlds, report your own new element as a conflict, or quietly stop the lock that keeps two tabs apart. A refresh now saves everything else and says which copy to try again, your own element is recognised, and the lock keeps going.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'quiet-failures-said',
        title: 'Saves that failed without a word now say so',
        body: 'A failed pin move, zone colour, chart save, alias edit, link removal or world list save used to fail silently. Each now says so, and a problem nothing else caught shows once, with details you can send.',
        tags: ['editor', 'fix'],
      },
      {
        id: 'cmdk-create-as',
        title: 'Ctrl+K can create what it cannot find',
        body: 'When nothing matches what you typed, the palette offers Create "…" as…, which opens the new element dialog with the name filled in.',
        tags: ['editor'],
      },
      {
        id: 'dates-in-your-calendar',
        title: 'Element pages show dates in your calendar',
        body: 'With a calendar set up, every date field on an element page also shows the date as your calendar says it, under the number. The stored number does not change.',
        tags: ['editor', 'charts'],
      },
      {
        id: 'filter-strip-in-words',
        title: 'The type filter says what it shows',
        body: 'A line under the search box says in words which types the filter strip is showing, and the add-world icons now have names a screen reader can read.',
        tags: ['editor'],
      },
      {
        id: 'new-page-name-first',
        title: 'A new page asks for its name',
        body: 'Making a page now opens it with its name ready to type, so it does not sit in your element list as "new page".',
        tags: ['pages'],
      },
      {
        id: 'json-error-line',
        title: 'Pasted JSON says where it broke',
        body: 'When pasted or dropped JSON does not parse, the Data room now names the line and column to look at, when the browser reports where it stopped.',
        tags: ['data'],
      },
      {
        id: 'no-second-map-or-calendar',
        title: 'Trying again no longer makes a second map, calendar or world folder',
        body: 'Pressing Create again after an error used to make a second map or calendar, or a second local folder when making a world on OnlyWorlds. It now finishes the first one.',
        tags: ['maps', 'fix'],
      },
    ],
  },
  {
    version: '1.15',
    date: '2026-10-04',
    theme: 'errors you can read',
    entries: [
      {
        id: 'errors-in-plain-words',
        title: 'Errors say what happened and what you can do',
        body: 'When saving, opening a world or syncing fails, Atlas now says why in plain words instead of passing on the browser\'s or server\'s own message, and offers the fix where it has one: Retry now, Allow access to the folder again, or Give new ids.',
        tags: ['editor', 'sync'],
        credit: { handle: 'a Discord user', platform: 'discord' },
      },
      {
        id: 'error-details-feedback',
        title: 'Copy the details of an error, or send them as feedback',
        body: 'Errors worth reporting have a Details part with Copy details and Send feedback. The details name the Atlas version, the browser and the kind of error, and are built to leave out your world\'s names, text, keys and file names. Feedback opens the OnlyWorlds feedback page, where you can read and edit everything before you send it.',
        tags: ['editor'],
      },
      {
        id: 'held-files-sync-later',
        title: 'Syncing waits out OneDrive, Dropbox and antivirus',
        body: 'When another program had a file in your world folder open at the wrong moment, often a cloud sync app or antivirus, a change could fail to sync with a message nobody could read, and it only synced after your next edit. Atlas now waits a moment and tries again on its own, keeps the rest of the sync going, and if a file stays busy it says so in plain words. Your change was always safe on disk.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'no-more-tmp-files',
        title: 'No more stray .tmp files in your world folder',
        body: 'Atlas saved every file twice, through a temporary copy, and a busy file could leave that copy behind. It now saves each file once and checks it afterwards.',
        tags: ['folder', 'fix'],
      },
      {
        id: 'link-existing-maps-with-pins',
        title: 'Linking keeps two maps apart when both have pins',
        body: 'When linking to an existing online world, a map or zone with the same name on both sides is matched as before, unless both have their own pins or markers on it. Then each stays its own element, so no map ends up with two pins for one place and no zone outline mixes two sets of points. The message after linking names them.',
        tags: ['sync', 'maps'],
      },
      {
        id: 'keep-online-pages',
        title: 'Keeping the online version of a page keeps all of it',
        body: 'Choosing to keep the online version while linking now replaces a page\'s local blocks too, so the next save no longer puts your local page back over the online one.',
        tags: ['sync', 'pages'],
      },
      {
        id: 'create-type-no-guess',
        title: 'The type field no longer picks a type you did not mean',
        body: 'Typing a word that is not a type, like "plan", kept the last match (Phenomenon) and created one. Now nothing is picked until you choose a type, and the window says so.',
        tags: ['editor', 'fix'],
      },
      {
        id: 'readable-modal-errors',
        title: 'Error lines in windows are readable in the light theme',
        body: 'Lines like "Name is required" were pale pink on pink in the light theme. They now read in both themes and go away once you fix the field. A zone with no name says so too.',
        tags: ['editor', 'fix'],
      },
      {
        id: 'tour-show-button',
        title: 'The hidden tour comes back from a button that says so',
        body: 'With the tour panel hidden, its round + button sat over the map\'s zoom-out and the writing word count. It is now a "Show the tour" button below the app.',
        tags: ['tour', 'fix'],
      },
      {
        id: 'tour-says-world-goes',
        title: 'The tour says that ending it deletes the tour world',
        body: 'Leaving or finishing the tour deletes the tour world and everything made in it, and now the tour says so before you do. "More information" in a step also closes with Escape.',
        tags: ['tour'],
      },
      {
        id: 'help-and-feedback',
        title: 'Help and feedback in Settings',
        body: 'Settings, General, has a Help and feedback group: send feedback, Discord, what is new, and email. The version at the foot of Settings opens this page.',
        tags: ['settings'],
      },
      {
        id: 'example-page-off-landing',
        title: 'The example page is off the landing for now',
        body: 'The example page is being rebuilt from a better world. Its old link still opens it.',
        tags: ['pages'],
      },
      {
        id: 'two-typos',
        title: 'Two typos fixed',
        body: 'In the Data room and the tour\'s writing step.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.14',
    date: '2026-09-29',
    theme: 'linking keeps everything',
    entries: [
      {
        id: 'link-existing-keeps-every-link',
        title: 'Linking to an existing online world keeps every link',
        body: 'When Make online matched one of your elements to an element of the same name already online, links written in your text, scene mentions, page text and the element\'s own images stayed pointing at the old copy. Every link and file now moves to the online element before anything uploads, and if linking stops part way it finishes cleanly the next time, without making duplicates online.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'link-existing-same-names',
        title: 'Two elements with the same name are no longer merged by guess',
        body: 'If two of your elements, or two online, share a name, linking now keeps each one as its own element and says which names it left alone, instead of picking one.',
        tags: ['sync'],
      },
      {
        id: 'bad-number-keeps-old-value',
        title: 'A mistyped number no longer clears the field',
        body: 'Typing something that is not a number, like 12,5, and pressing Enter used to empty the field, and on a custom number field it removed the field. Atlas now keeps the old value and asks you to fix the entry.',
        tags: ['editor', 'fix'],
      },
      {
        id: 'structured-fields-read-only',
        title: 'Fields holding lists or structured data stay safe',
        body: 'A text field that another tool filled with a list or structured data showed as [object Object], and clicking it could save that text over the data. It now shows read-only.',
        tags: ['editor', 'fix'],
      },
      {
        id: 'looping-parents-no-freeze',
        title: 'A scene whose parent chain loops no longer freezes Atlas',
        body: 'If a scene ended up as its own parent, for example after an edit outside Atlas, opening it in Writing froze the tab. It now opens normally.',
        tags: ['writing', 'fix'],
      },
      {
        id: 'broken-calendar-no-freeze',
        title: 'A broken calendar no longer freezes Atlas',
        body: 'A calendar with impossible month or year lengths could freeze the tab as soon as a date was shown. Atlas now ignores such a calendar and shows plain numbers.',
        tags: ['charts', 'fix'],
      },
      {
        id: 'calendar-edit-keeps-structure',
        title: 'Editing a calendar keeps everything it had',
        body: 'Saving a calendar after the world clock\'s unit changed could delete its months, weeks and festival days, because the form was not showing them. Saving now keeps what the form does not show, and the calendar\'s own time unit.',
        tags: ['charts', 'fix'],
      },
      {
        id: 'chart-date-enter-no-move',
        title: 'Pressing Enter on an unchanged chart date no longer moves it',
        body: 'A date shown rounded, or as a month of a calendar, could snap to a new value when you pressed Enter without typing.',
        tags: ['charts', 'fix'],
      },
      {
        id: 'charts-axis-wide-spans',
        title: 'Long histories get a readable time axis',
        body: 'A world spanning thousands or millions of years now gets evenly spaced labels instead of a smear, and a calendar axis labels the whole range, not just its start.',
        tags: ['charts', 'fix'],
      },
      {
        id: 'charts-single-date-centred',
        title: 'A shared chart where everything shares one date sits in the middle',
        body: 'A published or previewed chart whose elements all have the same date drew them against the left edge.',
        tags: ['charts', 'pages', 'fix'],
      },
      {
        id: 'charts-reach-now',
        title: 'You can pan to a now outside your recorded history',
        body: 'If the world\'s now falls before or after every dated element, the chart can now reach it.',
        tags: ['charts', 'fix'],
      },
      {
        id: 'shortcuts-any-keyboard-layout',
        title: 'Shortcuts work on Cyrillic and Greek keyboard layouts',
        body: 'Ctrl+S, Ctrl+E, Ctrl+K and the other letter shortcuts did nothing on a non-Latin layout.',
        tags: ['editor', 'fix'],
      },
      {
        id: 'shortcut-help-chips',
        title: 'The shortcuts list shows every key as a chip',
        body: 'On a Mac the combos ran together as plain text, and Escape never got a key chip.',
        tags: ['help', 'fix'],
      },
      {
        id: 'context-graph-big-maps',
        title: 'Big maps open quickly in the context graph',
        body: 'The graph now shows the 60 most connected direct links and says how many more there are, and an edit that changes no links no longer recomputes the layout.',
        tags: ['context', 'performance'],
      },
      {
        id: 'pause-all-respects-offline',
        title: 'Pause all no longer overrides Stay offline',
        body: 'Turning Pause all off used to resume a world you had set to stay offline. Each switch now keeps the other in force.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'import-keeps-prose-links',
        title: 'Imported writing keeps its links',
        body: 'When an import merged elements with ones you already had, or gave an element a new id, links inside stories and descriptions kept the old id. They now follow.',
        tags: ['data', 'fix'],
      },
      {
        id: 'pages-world-switch',
        title: 'Switching worlds in Pages no longer forgets published pages',
        body: 'Switching worlds while Pages was checking publish state could mark the new world\'s pages as never published, while they stayed live online.',
        tags: ['pages', 'fix'],
      },
      {
        id: 'pages-edited-reminder',
        title: 'The reminder that a page changed since publishing stays on',
        body: 'Coming back to Pages after publishing showed a refresh message and switched the reminder off. It no longer does.',
        tags: ['pages', 'fix'],
      },
      {
        id: 'pages-no-hidden-ids',
        title: 'Published pages no longer carry ids of elements they do not show',
        body: 'Links inside card fields, like a chapter\'s story, now publish as plain names, and a knowledge block no longer carries its knower\'s id unless the knower is on the page.',
        tags: ['pages', 'privacy', 'fix'],
      },
      {
        id: 'zone-esc-stays-on-map',
        title: 'Esc while drawing a zone stays on the map',
        body: 'Esc cancels the zone you are drawing or reshaping, and no longer also clears the selection and jumps to the world home.',
        tags: ['maps', 'fix'],
      },
      {
        id: 'focus-mode-not-find',
        title: 'The focus mode shortcut no longer opens Find',
        body: 'Ctrl+Shift+F in Writing turned on focus mode and also opened the find bar, so the next words went into the search box.',
        tags: ['writing', 'fix'],
      },
      {
        id: 'marker-icon-not-a-pin',
        title: 'Map markers no longer share the pins icon',
        body: 'Since 1.13 a marker showed the same icon as the show and hide pins button on the map. A marker is a point on a zone\'s outline, and its icon now draws one.',
        tags: ['maps', 'fix'],
      },
      {
        id: 'settings-shows-the-version',
        title: 'Settings shows the version you are running',
        body: 'The foot of Settings said v1.0.0 through every release since launch. It now matches this changelog.',
        tags: ['settings', 'fix'],
      },
    ],
  },
  {
    version: '1.13',
    date: '2026-09-29',
    theme: 'nobody gets stuck',
    entries: [
      {
        id: 'tour-in-narrow-windows',
        title: 'The guided tour works in narrow windows',
        body: 'Below about 1100 pixels wide, Atlas folds its side panels away, and the tour pointed at controls inside them and could not go on: on phones at the first step, on smaller laptop windows at the map. The tour now opens the panel each step needs, and the panel buttons stay on screen if you close one.',
        tags: ['tour', 'layout', 'fix'],
      },
      {
        id: 'pin-opens-the-map',
        title: 'Placing a pin in a narrow window opens the map',
        body: 'Clicking + pin while the map was folded away left the next click nowhere to go. The map now opens, ready for the click.',
        tags: ['maps', 'layout', 'fix'],
      },
      {
        id: 'narrow-no-world',
        title: 'A narrow window with no world open shows the Worlds list',
        body: 'With no world open, a narrow window showed an empty page that pointed at a list you could not see. It now opens the Worlds panel, and the panel button is there to bring it back.',
        tags: ['layout', 'fix'],
      },
      {
        id: 'private-window-says-why',
        title: 'A private window says why the tour cannot run',
        body: 'Firefox private windows do not allow the browser storage the tour keeps its world in. Atlas now says so on the first screen, instead of stopping at the tour\'s first step with a technical error.',
        tags: ['tour', 'fix'],
      },
      {
        id: 'reload-after-update',
        title: 'A tab left open through an update picks up the new version cleanly',
        body: 'After an update, a tab that was already open could fail to open rooms and editors. It now offers one Reload, and every reload after an update saves your unsaved text first, in every open tab.',
        tags: ['safety', 'fix'],
      },
      {
        id: 'quick-return-stays-quick',
        title: 'Going back to a world you just left no longer reopens it from scratch',
        body: 'Atlas keeps a world you leave ready for a quick return. Two saves of the same small file could collide and throw that away, so the world reopened slowly; each file now takes its saves one at a time.',
        tags: ['performance', 'fix'],
      },
      {
        id: 'make-online-own-failures',
        title: 'Taking a world online no longer asks about its own failed uploads',
        body: 'When some uploads failed while taking a world online, Atlas then asked whether to upload a batch of changes found on disk: the same elements. It now retries them and says which failed.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.12',
    date: '2026-09-29',
    theme: 'open what your AI made',
    entries: [
      {
        id: 'open-a-world-folder-first',
        title: 'Open a world folder on your first visit',
        body: 'The first screen now has "open a world folder": pick a folder your AI or another tool made and it opens where it is, with nothing copied. Atlas asks where to keep new worlds only when you first make one, and "set up a folder" pointed at a world folder opens that world too.',
        tags: ['folders'],
      },
      {
        id: 'add-a-world-button',
        title: 'Add a world: one button that says every way in, in words',
        body: 'Under the icons at the top of the Worlds list, "add a world" lists each way to start, open, bring down or view a world, with a line on each. Ctrl+K finds it too, and Settings, then General can hide the icon row.',
        tags: ['sidebar'],
      },
      {
        id: 'scene-edited-while-closed',
        title: 'A scene edited while Atlas was closed opens with the new text',
        body: 'When another tool changed the text of a scene or knowledge entry while Atlas was closed, Atlas opened its own older copy, and its next save wrote over the change. It now opens the new text and says so once.',
        tags: ['writing', 'folders', 'fix'],
      },
      {
        id: 'big-batch-at-open',
        title: 'A big batch of outside edits asks before it uploads when a world opens',
        body: 'When more than 50 elements are waiting to upload as a linked world opens, for example after an AI rewrote the folder overnight, sync waits until you choose Upload them or Stay offline, as it already did with Atlas open.',
        tags: ['sync', 'folders'],
      },
      {
        id: 'delete-world-stays-home',
        title: 'Deleting a world only ever deletes that world\'s own folder',
        body: 'Delete world and folder now checks that the world\'s folder sits inside your OnlyWorlds folder before anything happens. A world opened from elsewhere is left alone and Atlas says how to remove it; before, it could delete a different world with the same folder name.',
        tags: ['worlds', 'safety', 'fix'],
      },
      {
        id: 'quick-return-still-checks',
        title: 'An edit made seconds after you left Atlas still shows',
        body: 'Atlas checks the folder at most once every 5 seconds when you come back to its window. Coming back sooner now checks again once the 5 seconds pass, so the edit shows without switching windows again.',
        tags: ['folders', 'fix'],
      },
      {
        id: 'tour-tab-leaves-live-folder',
        title: 'A tour in another tab no longer stops Atlas noticing outside edits',
        body: 'Running the guided tour in one tab stopped every other Atlas tab from picking up changes to its world folder. Only the tour world itself is skipped now.',
        tags: ['folders', 'fix'],
      },
      {
        id: 'two-tabs-keep-settings',
        title: 'Two Atlas tabs no longer undo each other\'s world changes',
        body: 'Notes typed in one tab, or a world taken online there, could go back to the old version when the other tab opened that world. Each tab now saves only what it changed, and picks up what the other tab saved.',
        tags: ['worlds', 'safety'],
      },
      {
        id: 'world-notes-merge-while-open',
        title: 'World notes changed on another computer survive while the world is open',
        body: 'If a world\'s notes or cast changed through Dropbox, OneDrive or git while you had it open, your next change no longer writes over them, and when both sides changed the notes, both are kept. Notes on a view-only world no longer repeat at each open.',
        tags: ['folders', 'fix'],
      },
      {
        id: 'folder-of-worlds-says-so',
        title: 'Picking a folder that holds several worlds says so',
        body: '"Open a world folder" pointed at a folder of world folders now says how many worlds it found and to pick one of them, instead of "no world.json".',
        tags: ['folders'],
      },
      {
        id: 'link-all-keeps-clear',
        title: 'The link-all button no longer covers the first line of text',
        body: 'The corner button that links every mention sat over the last words of the first line. Scenes and knowledge entries now keep room for it.',
        tags: ['writing', 'layout', 'fix'],
      },
      {
        id: 'tour-maps-offline',
        title: 'The tour\'s maps show offline after one run online',
        body: 'Map pictures are kept once they have loaded, so the tour and the example page show them offline afterwards.',
        tags: ['tour', 'fix'],
      },
    ],
  },
  {
    version: '1.11',
    date: '2026-09-29',
    theme: 'what you wrote stays yours',
    entries: [
      {
        id: 'live-folder',
        title: 'Keep Atlas open while another tool writes your world',
        body: 'When an AI assistant, a text editor or git changes the element files in your world folder, Atlas picks up the changes when you come back to its window: the elements update, the list marks what changed, and an open scene or knowledge entry reloads. Reload from disk in Ctrl+K checks every file. If you are typing in the same scene at that moment, your text is kept and Atlas says so. A file removed by another program leaves the list, and the list says so; it is never deleted from your OnlyWorlds account.',
        tags: ['folders'],
      },
      {
        id: 'outside-edits-online',
        title: 'Outside edits on an online world upload when they say they are new',
        body: 'An edit that sets a new local_updated_at, as the OnlyWorlds toolkit tells tools to, uploads like your own edits, and a sync no longer writes over it. An edit without one is marked "not synced". When more than 50 elements change at once, sync waits until you choose to upload them or stay offline.',
        tags: ['sync', 'folders'],
      },
      {
        id: 'pull-stops-at-broken-file',
        title: 'A sync stops at a file it cannot read instead of writing over it',
        body: 'If an element file will not open (for example git conflict markers), a sync that would update it now pauses and names the file, as uploads already did. Fix or remove the file and sync carries on.',
        tags: ['sync', 'safety'],
      },
      {
        id: 'notes-in-the-folder',
        title: 'World notes, your cast and writing labels now live in the world folder',
        body: 'They were kept only in this browser, so copying the folder, opening it on another computer or clearing site data lost them. They are now written to the folder too, and a folder opened elsewhere brings them along.',
        tags: ['folders'],
      },
      {
        id: 'charts-stay-with-their-world',
        title: 'Switching worlds in Charts no longer replaces the other world\'s charts',
        body: 'With Charts open, clicking another world kept showing the first world\'s saved charts, and saving one there replaced that world\'s charts with them. Each world now shows and keeps its own. Published pages in the second world no longer lose their chart blocks either.',
        tags: ['charts', 'fix'],
      },
      {
        id: 'deleted-stays-deleted',
        title: 'A deleted element stays out of the scenes that mentioned it',
        body: 'Opening a scene that mentioned a deleted character put the character back in the scene\'s links, so the scene would not upload. The mention stays in your text; the link does not come back.',
        tags: ['writing', 'fix'],
      },
      {
        id: 'rename-not-cut-short',
        title: 'Renaming no longer saves half a name',
        body: 'A sync or an autosave landing while you typed a new name could save what you had so far and drop the rest. The name now saves when you finish.',
        tags: ['fix'],
      },
      {
        id: 'knowledge-retries-save',
        title: 'Knowledge text that failed to save is saved when you leave the entry',
        body: 'After a failed save, leaving the entry used to drop the text on screen. Atlas now tries again on the way out.',
        tags: ['knowledge', 'fix'],
      },
      {
        id: 'page-text-keeps-focus',
        title: 'A page\'s text block keeps your typing when charts refresh',
        body: 'A chart refresh could rebuild the page under an open text block and lose the last second of typing.',
        tags: ['pages', 'fix'],
      },
      {
        id: 'new-type-icons',
        title: 'Institutions and map markers have new icons',
        body: 'They now match the icons OnlyWorlds uses for these types.',
        tags: ['layout'],
      },
    ],
  },
  {
    version: '1.10',
    date: '2026-09-29',
    theme: 'new ids for copied worlds',
    entries: [
      {
        id: 'give-new-ids',
        title: 'Elements whose ids belong to another world can get new ones',
        body: 'A copied or imported folder, or a world taken online a second time, carries ids that another OnlyWorlds world already holds, and those elements never uploaded. Settings, then your world, now offers to give them new ids: every link, mention and page block follows, and then they upload.',
        tags: ['sync', 'folders'],
      },
      {
        id: 'id-update-finishes',
        title: 'An id update that was interrupted finishes when the world opens',
        body: 'If the tab closes while elements are getting new ids, the world does not sync until the update is done, and the next time it opens Atlas finishes it before showing anything.',
        tags: ['sync'],
      },
      {
        id: 'make-online-keeps-page',
        title: 'Make online keeps you on the page you had open',
        body: 'When Make online matched a local element to one already online, an open timeline, writing or map page for it jumped to another page or showed nothing. It now follows the element, and Back no longer leads to its old address.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.9',
    date: '2026-09-28',
    theme: 'deletes that tidy up',
    entries: [
      {
        id: 'delete-removes-links',
        title: 'Deleting an element removes it from everything that linked to it',
        body: 'A deleted location used to stay in its characters\' location field as a bare id, and when the world went online OnlyWorlds refused those characters, so they never uploaded. Atlas now removes the link, the same way onlyworlds.com does.',
        tags: ['folders', 'fix'],
      },
      {
        id: 'remove-broken-links',
        title: 'A local world can remove links to elements that are gone',
        body: 'Settings, then your world, shows how many elements still link to something deleted earlier or left out of an import, with one button to remove those links before the world goes online.',
        tags: ['folders'],
      },
      {
        id: 'export-without-key',
        title: 'Exports no longer carry your API key',
        body: 'The export offered to include the world\'s API key and had it ticked by default, for both the file and Copy JSON. Anyone holding that file could read the whole world. The key is never exported now; to connect a world, use Make online.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'import-keeps-renamed',
        title: 'Merging your own export back in no longer duplicates renamed elements',
        body: 'An element renamed since the export came back as a second copy, and new links in the file pointed at the copy. When the file is this world\'s own export, Atlas now treats the same id as the same element whatever its name.',
        tags: ['folders', 'fix'],
      },
      {
        id: 'zone-styles-by-role',
        title: 'Zone styles can follow a zone\'s role',
        body: 'The zones panel now splits a kind by role when its zones share roles, so rivers can be major rivers, rivers and streams, each with its own colour and line. Road segments that carry their road\'s name group under it.',
        tags: ['maps'],
      },
      {
        id: 'linked-zones-listed',
        title: 'A zone made of other zones shows up in the zones panel',
        body: 'Some worlds describe a road as one zone that links its segments and has no outline of its own. Atlas used to leave these out entirely. The zones panel now lists them with the number of parts, and hovering one lights every part on the map.',
        tags: ['maps'],
      },
      {
        id: 'big-world-list-speed',
        title: 'Big worlds stay responsive while you click around',
        body: 'The element list and the home page used to redraw completely on every small change, which on a world of twelve thousand elements cost a noticeable pause on each click. They now redraw only when something they show has changed.',
        tags: ['layout', 'fix'],
      },
    ],
  },
  {
    version: '1.8',
    date: '2026-09-28',
    theme: 'north is up',
    entries: [
      {
        id: 'maps-north-up',
        title: 'Maps read positions the way every other OnlyWorlds tool writes them',
        body: 'Pin and zone positions now count from the bottom-left corner of the map, as the OnlyWorlds standard says, so worlds made by other tools and converters show the right way up. A map you placed in an earlier Atlas may now show upside down: open the gear on that map and press Flip pins and zones. Press it again to undo.',
        tags: ['maps', 'fix'],
      },
      {
        id: 'cancel-link-keeps-world',
        title: 'Cancelling a link leaves you in the world you were in',
        body: 'After cancelling a world that was still downloading, Atlas kept showing your previous world but could no longer save it: text typed in the writing room was lost and edits said there was no active world. The world you were in now stays open and working, whether the link finishes, stops or fails.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'damaged-files-stop-sync',
        title: 'A damaged world file can no longer blank your world settings online',
        body: 'If world.json could not be read, for example after a git merge conflict, the next sync could send empty world settings to OnlyWorlds. Sync now stops and names the file to fix. A damaged element file or sync file is treated the same way: Atlas leaves it untouched and tells you which one it is.',
        tags: ['sync', 'folders', 'fix'],
      },
      {
        id: 'lost-response-edit-kept',
        title: 'An edit is no longer lost when a connection drops during a first upload',
        body: 'If an element was edited while it was first being sent to OnlyWorlds and the reply never arrived, Atlas could treat the older copy on the server as current. It now compares the two and sends your newer text.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'busy-server-waits',
        title: 'A busy or unreachable OnlyWorlds no longer ties up sync',
        body: 'When OnlyWorlds is busy, limiting requests or out of reach, Atlas now stops after the first try instead of waiting out every pending change in turn, says so in one line, and tries again on its own a little later. Your changes stay saved in the folder the whole time.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'merge-keeps-atlas-fields',
        title: 'Linking a local world to an existing one keeps your writing and pages',
        body: 'When a local element matched one already online by name, linking the two kept the online copy but dropped what only Atlas stores: the formatted text of your writing, page layouts and their publish link, aliases and a map\'s local image. Those now carry over.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'one-refused-not-all',
        title: 'One element OnlyWorlds refuses no longer holds back the rest',
        body: 'If OnlyWorlds refused one new element in an upload, other new elements that linked to it could make the whole upload fail again every time. Those are now held back on their own and everything else goes through. Pulled changes also can no longer overwrite an edit you make at the same moment.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'pin-prompt-plain-text',
        title: 'The PIN prompt shows world names as plain text',
        body: 'A world name from your OnlyWorlds account is always shown as text in the prompt that asks for your PIN, so an oddly named world cannot change where the PIN is sent.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'scrollbars-and-motion',
        title: 'One quiet scrollbar everywhere, and less motion when you ask for it',
        body: 'Windows, the search palette and popovers now use the same thin scrollbar as the rest of Atlas, in both themes. If your system is set to reduce motion, the pulsing hints and sync dots hold still and transitions are instant.',
        tags: ['layout'],
      },
      {
        id: 'dialogs-keyboard',
        title: 'Windows behave better from the keyboard',
        body: 'Every window is announced to screen readers as a dialog with its title, and closing one puts the keyboard focus back where it was. In the small field editor, pressing Enter while Cancel is selected now cancels instead of saving.',
        tags: ['layout', 'fix'],
      },
      {
        id: 'show-folder',
        title: 'Settings can show you the world folder',
        body: 'Settings, World now has a Show folder button. A web page cannot open your file explorer, so it opens the folder picker inside the world folder, where you can see its files. Close it when you are done.',
        tags: ['folders'],
      },
      {
        id: 'tour-world-stays-local',
        title: 'The tour world says why it stays offline',
        body: 'The world the guided tour builds is a sandbox that is removed when the tour ends, so it can no longer be taken online, where it could only fail to upload and then disappear. Settings says so plainly. Create your own world to take it online.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'reload-saves-first',
        title: 'Reloading for a new version saves what you were typing',
        body: 'Pressing Reload on the new version note now saves text that was still waiting to be written in the writing, knowledge or pages room before the page reloads.',
        tags: ['writing', 'fix'],
      },
    ],
  },
  {
    version: '1.7',
    date: '2026-09-28',
    theme: 'a world from anywhere is safe to open',
    entries: [
      {
        id: 'untrusted-folders-safe',
        title: 'Opening a world folder from someone else can no longer run code in Atlas',
        body: 'Names, colours and map points from a world file are now always shown as plain text and plain values, and Atlas refuses to run any script that did not come from Atlas itself. This matters because Atlas keeps your OnlyWorlds keys, and worlds now arrive from public repositories, converters and AI assistants.',
        tags: ['folders', 'fix'],
      },
      {
        id: 'link-stop-or-cancel',
        title: 'A world that is still downloading can be stopped, kept or cancelled',
        body: 'Linking a large world from OnlyWorlds now shows two buttons while it downloads: stop and keep what has arrived (Refresh from API brings the rest later), or cancel and remove the new folder. A stray click outside the window or the Escape key no longer closes it halfway, and the same holds while a world uploads.',
        tags: ['sync'],
      },
      {
        id: 'edit-during-sync-kept',
        title: 'An edit made while Atlas is uploading is no longer lost',
        body: 'If you changed an element in the second or so while its previous change was being sent to OnlyWorlds, Atlas could mark it as synced and never send the newer text. It now notices and sends it on the next round.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'world-switch-saves-prose',
        title: 'Switching worlds saves the text you just typed',
        body: 'Text typed in the writing, knowledge or pages room in the moment before switching to another world could be dropped. Atlas now saves it before it leaves the world.',
        tags: ['writing', 'fix'],
      },
      {
        id: 'foreign-files-kept',
        title: 'Files from other tools are read more generously and never discarded',
        body: 'A name written as a number, map points written as text, a link written as a single id instead of a list, and a pin with no position no longer break the element list or the map. A second file that shares an element id with another is moved to .atlas/quarantine instead of being deleted, and a world file Atlas cannot read (for example after a git merge conflict) is left alone rather than overwritten.',
        tags: ['folders', 'fix'],
      },
      {
        id: 'sync-errors-say-why',
        title: 'Sync errors say what went wrong',
        body: 'When elements cannot upload, Atlas now names the reason, such as ids that already belong to another OnlyWorlds world or custom fields larger than OnlyWorlds accepts, instead of suggesting a connection test.',
        tags: ['sync'],
      },
      {
        id: 'update-offer-not-reload',
        title: 'A new version of Atlas asks before it reloads',
        body: 'After an update, Atlas used to reload itself under you the first time you opened it. It now shows a small note with a Reload button and waits.',
        tags: ['layout', 'fix'],
      },
      {
        id: 'craft-pass-1',
        title: 'Small things that make Atlas nicer to use',
        body: 'The browser tab names the world and the element you are on. Double-clicking a button or row no longer highlights its text, and copying text never picks up icon names. Keyboard focus shows a clear ring, buttons that only appear on hover also appear when you tab to them, a disabled button looks disabled, error messages stay longer and are read out by screen readers, and a name cut short by its column shows in full when you rest the pointer on it.',
        tags: ['layout'],
      },
      {
        id: 'compiled-link-ampersand',
        title: 'Links with more than one query value work in the compiled view',
        body: 'A web link like example.com/?a=1&b=2 in your prose opened a broken address from the compiled view and from published pages. It opens the right one now.',
        tags: ['writing', 'fix'],
      },
    ],
  },
  {
    version: '1.6',
    date: '2026-09-28',
    theme: 'your folder, shared with other tools',
    entries: [
      {
        id: 'outside-edits-kept',
        title: 'Edits another tool makes to a world file are kept when Atlas saves',
        body: 'If a text editor, a script or an AI assistant changes an element file while Atlas has the world open, Atlas now saves its own change on top of what is on disk instead of over it. Atlas still shows the outside change only after you reopen the world, so close the Atlas tab before editing files by hand.',
        tags: ['folders'],
      },
      {
        id: 'born-bare-links',
        title: 'New worlds write map links the way every other tool reads them',
        body: 'Pins and markers in a new world store their map and zone under the standard names, so other OnlyWorlds tools read them without a translation step. Worlds that already use the older spelling keep it.',
        tags: ['folders'],
      },
    ],
  },
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
