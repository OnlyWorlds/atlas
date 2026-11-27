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
    version: '1.125.46',
    date: '2026-11-27',
    theme: 'Full page says it is a preview in this tab only',
    entries: [
      {
        id: 'full-page-says-preview',
        title: 'Full page says its address cannot be sent',
        body: 'Full page opens a page in a tab of its own, at an address that only this tab can open. The tab now says so above the page, with Publish as the way to share it, and its title ends in "preview".',
        tags: ['sharing', 'fix'],
      },
    ],
  },
  {
    version: '1.125.45',
    date: '2026-11-27',
    theme: 'An element too large for OnlyWorlds says so',
    entries: [
      {
        id: 'element-over-limit-said',
        title: 'An element too large to sync says why and what to do',
        body: 'OnlyWorlds now takes at most 1 MB of text and links, or 5,000 links, in one element. An element past either limit stays as you wrote it here, and the sync message, Settings and the element\'s own mark now say which limit it passes and that shortening it or splitting it over more than one element lets it sync, instead of a plain "could not sync".',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.125.44',
    date: '2026-11-27',
    theme: 'A calendar too large to read can be opened again',
    entries: [
      {
        id: 'calendar-past-limits-opens',
        title: 'A calendar past the size limits is back in the calendar menu',
        body: 'A calendar past one of the size limits every OnlyWorlds tool shares shows its dates as numbers, and since 1.125.42 it had dropped out of the calendar menu with no word. Its row is back, naming the limit it passes, and opens it in the calendar builder with its own eras and months, so you can cut it down; the builder saves it once it fits.',
        tags: ['charts', 'fix'],
      },
      {
        id: 'download-folder-capitals',
        title: 'A download over a folder in other capitals says which one',
        body: 'If a world\'s folder gains Elements, World.json or Spatial in other capitals after it was opened, for example made in another app, Download now names that folder and asks you to rename it, instead of a sentence about unzipping a file.',
        tags: ['import', 'fix'],
      },
      {
        id: 'sign-in-older-page-cancel',
        title: 'A Cancel on an older sign-in page is not read as this one',
        body: 'If you pressed Sign in with OnlyWorlds twice and then cancelled on the first onlyworlds.com page, Atlas now says that sign-in was not started in this tab instead of calling it cancelled. Either way nothing changes, and you land where you were with any invitation or Open link you held still held.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.125.43',
    date: '2026-11-27',
    theme: 'Names inside code in the editor, too',
    entries: [
      {
        id: 'names-in-editor-code',
        title: 'In the scene editor, a name inside code is left as it is',
        body: 'A name you format as code in the scene editor, inline or as a code block, no longer gets the dotted mention hint, and Link all leaves it as text. 1.125.42 did this for a scene\'s Markdown text; the editor\'s own hints still offered it.',
        tags: ['writing', 'fix'],
      },
    ],
  },
  {
    version: '1.125.42',
    date: '2026-11-27',
    theme: 'Dates speak the calendar the world names',
    entries: [
      {
        id: 'world-names-its-calendar',
        title: 'Dates speak the calendar the world names',
        body: 'A world can name which of its calendars its dates are in, as other OnlyWorlds tools set it. Where you have not picked a calendar on this device, Atlas now words the dates in that one, also when the world holds several; a name that points at no calendar leaves the dates as numbers. Your own pick still comes first.',
        tags: ['charts', 'fix'],
      },
      {
        id: 'names-in-markup-stay-markup',
        title: 'A name inside code or markup is left as it is',
        body: 'In a scene\'s text, a name inside a code span, a code block, an HTML tag or comment, or a link reference line is no longer offered as a mention, counted, linked by Link all or read for Featured. Linking it there broke the markup around it.',
        tags: ['writing', 'fix'],
      },
      {
        id: 'calendar-standard-bounds',
        title: 'Calendars follow the standard\'s size limits',
        body: 'A calendar is now read by the size limits every OnlyWorlds tool shares, such as at most 256 eras and 64 months, in place of Atlas\'s own looser ones, so Atlas and the other tools show the same dates. A calendar past a limit shows its dates as numbers, and the calendar builder names the limit before you save.',
        tags: ['charts', 'fix'],
      },
      {
        id: 'world-file-unreadable-world-json',
        title: 'A world file with an unreadable world.json says so',
        body: 'Opening a world file whose world.json is there but cannot be read, because it is not valid JSON, now says that, instead of saying the file has no world.json.',
        tags: ['import', 'fix'],
      },
    ],
  },
  {
    version: '1.125.41',
    date: '2026-11-26',
    theme: 'A room button pressed right after making a world opens its room',
    entries: [
      {
        id: 'room-press-after-create',
        title: 'A room button pressed right after making a world opens its room',
        body: 'For about a second after a new world opened, the room buttons were still settling into place, and a press on one could be lost: the room stayed Home. A press now lands on the room it went down on, and the buttons hold still while it is held.',
        tags: ['layout', 'fix'],
      },
    ],
  },
  {
    version: '1.125.40',
    date: '2026-11-26',
    theme: 'A very long month keeps the timeline quick',
    entries: [
      {
        id: 'long-month-timeline',
        title: 'A very long month keeps the timeline quick',
        body: 'Zoomed in to days, the timeline counted through each visible month from its first day, so a calendar with months millions of days long slowed every redraw. It now counts only the days on screen.',
        tags: ['charts', 'fix'],
      },
    ],
  },
  {
    version: '1.125.39',
    date: '2026-11-26',
    theme: 'A new world says what its first boxes ask for',
    entries: [
      {
        id: 'born-says-what-number',
        title: 'Born, When and Founded say what number they take',
        body: 'In a world with no calendar, the date on a new Character, Event or Location in the strand now says it is a whole number in your world\'s own time, such as a year.',
        tags: ['home', 'fix'],
      },
      {
        id: 'strand-no-empty-band',
        title: 'No empty band under a finished card in the strand',
        body: 'When a card in the strand became its box, its row kept the card\'s height until the whole strand was done, leaving a wide empty band that looked like something failed to load. The row now closes up in the same press, and nothing moves while you are typing in a card.',
        tags: ['home', 'fix'],
      },
      {
        id: 'strand-whole-offers-the-picture',
        title: 'A finished strand offers its picture, not a tab you cannot see yet',
        body: 'When a strand is whole, its line now links the world\'s picture and the Web directly, instead of naming a Picture tab that only shows the next time you open Home.',
        tags: ['home', 'fix'],
      },
      {
        id: 'dates-as-numbers-one-name',
        title: 'A calendar shown as numbers says so in one name',
        body: 'The calendar menu\'s "None" and a calendar too large to word now both say "dates as numbers", its row explains why in plain words, and its bound is written 1,000 rather than 1000.',
        tags: ['charts', 'fix'],
      },
      {
        id: 'copy-page-json-words',
        title: 'Copy JSON says what it copies',
        body: 'The tooltip now reads "Copy this page\'s data as JSON", without naming a viewer you would not find anywhere in Atlas.',
        tags: ['sharing', 'fix'],
      },
    ],
  },
  {
    version: '1.125.38',
    date: '2026-11-26',
    theme: 'A calendar too large to read quickly shows its dates as numbers',
    entries: [
      {
        id: 'calendar-too-large',
        title: 'A very large calendar shows its dates as numbers instead of slowing the page',
        body: 'A calendar holding more than 256 eras, 256 months, 64 extra days or 256 weekdays, a leap rule with more than 8 exceptions, a date pattern over 1,000 characters or a name over 1,000 characters now shows its dates as plain numbers. Its row in the calendar menu says why and opens it to edit, and the calendar is kept as written. Before, a world file holding such a calendar could make the page stop answering.',
        tags: ['charts', 'fix'],
      },
      {
        id: 'too-deep-says-what-to-do',
        title: 'A world.json nested too deep says what to do next',
        body: 'When Atlas refuses a folder or a world file because its world.json is nested too deep, the message now says what to do: get a copy written with less nesting, then open that.',
        tags: ['import', 'fix'],
      },
    ],
  },
  {
    version: '1.125.37',
    date: '2026-11-25',
    theme: 'Link to element finds a name you unlinked',
    entries: [
      {
        id: 'find-unlinked-name-again',
        title: 'Link to element finds a name again after you unlink it',
        body: 'A name holding a bracket, a backslash or a "<", such as "Kira [the elder]" or "A < B", is now found by Link to element after you unlink it, and linked back as it was. Before, such a name could be missed until the scene was saved again in the editor.',
        tags: ['writing', 'fix'],
      },
    ],
  },
  {
    version: '1.125.36',
    date: '2026-11-25',
    theme: 'A link to an element named like a web link stays that element',
    entries: [
      {
        id: 'chip-named-like-a-link',
        title: 'A link to an element whose name looks like a web link reopens as that element',
        body: 'An element whose name holds something shaped like a web link, such as "[x](https://example.com)" or an address in angle brackets, is now saved in your text so it reopens as the link to that element, also in a scene opened on another device. Before, the editor could read the name\'s inner part as a web link. Unlinking such a name leaves its text as written.',
        tags: ['writing', 'fix'],
      },
    ],
  },
  {
    version: '1.125.35',
    date: '2026-11-25',
    theme: 'A world file nested too deep is refused before it lands',
    entries: [
      {
        id: 'world-file-too-deep',
        title: 'A world file whose world.json is nested too deep is refused at once',
        body: 'Opening a world file whose world.json is nested more than 200 levels deep now says so and adds nothing, as opening such a folder already did. Before, it was added to your list. Worlds Atlas writes now say they follow version 0.3.25 of the folder format.',
        tags: ['import', 'fix'],
      },
    ],
  },
  {
    version: '1.125.34',
    date: '2026-11-25',
    theme: 'A link whose name holds a bracket or a backslash comes back whole',
    entries: [
      {
        id: 'link-label-escape',
        title: 'A link named with a bracket or a backslash comes back whole',
        body: 'A link whose name holds a square bracket or a backslash, such as "Kira [the elder]", is now saved so it reopens as the same link and is drawn as its name in the compiled view, the knowledge room and on a published page. Link to element in the find bar writes such a name the same way, and no link is ever written inside another link.',
        tags: ['writing', 'fix'],
      },
      {
        id: 'backslash-drawn-once',
        title: 'A typed backslash or bracket is drawn once on a page',
        body: 'Text you typed with a backslash, such as C:\\Users, is drawn with one backslash in the compiled view and on a published page, as in the editor. A page published before this release that holds such a link draws it right once you publish it again.',
        tags: ['sharing', 'fix'],
      },
    ],
  },
  {
    version: '1.125.33',
    date: '2026-11-25',
    theme: 'A file nested too deep is left out; every tab row in one weight',
    entries: [
      {
        id: 'file-depth-bound',
        title: 'A file nested past 200 levels is left out and named',
        body: 'An element file whose values nest more than 200 levels deep is now left out of the world and counted in the element list with the files that cannot be read, as the folder format says. Before, a very deep file could stop the whole world from opening. A world.json that cannot be read now says so, for its depth or because it is not JSON, instead of saying the folder has none.',
        tags: ['fix'],
      },
      {
        id: 'tabs-one-weight',
        title: 'Every row of tabs in one weight',
        body: 'The tabs above the right pane (Web, Maps and the rest), Home\'s Picture and Strand, and the Settings tabs are bold now, as the Worlds tabs are, so tabs side by side never draw two weights.',
        tags: ['layout'],
      },
      {
        id: 'start-here-once',
        title: 'A reading aid\'s card says its name once',
        body: 'On Home, a card\'s small label (Start here, This world\'s charter) is left out when the aid\'s own name already says it.',
        tags: ['layout'],
      },
    ],
  },
  {
    version: '1.125.32',
    date: '2026-11-25',
    theme: 'Button words in bold',
    entries: [
      {
        id: 'lato-control-weights',
        title: 'Buttons, tabs and headings read in bold again',
        body: 'Bold again, as in the design Atlas was drawn to: the words on main buttons such as Explore, the small links under them, the Worlds tabs, the chips on a list\'s rows, section headings and bold words in a sentence. Element names in search, in the knowledge room and in a card\'s context stay regular, as do the labels beside a field.',
        tags: ['layout'],
      },
    ],
  },
  {
    version: '1.125.31',
    date: '2026-11-25',
    theme: 'A name right after ! stays as written',
    entries: [
      {
        id: 'name-after-bang',
        title: 'Linking never turns a name into a picture',
        body: 'A name written right after an exclamation mark, as in wow!Kira, is left as text when Atlas links names in a story kept as Markdown: its link there would read as a picture. The next mention of the same name is linked instead, and the editor still links it.',
        tags: ['writing', 'fix'],
      },
    ],
  },
  {
    version: '1.125.30',
    date: '2026-11-25',
    theme: 'Atlas in Lato',
    entries: [
      {
        id: 'house-font-lato',
        title: 'Atlas is set in Lato, the OnlyWorlds face',
        body: 'Every word in Atlas is now drawn in Lato, the face the OnlyWorlds site and tools share, in its regular, bold and black weights. Labels that were a little heavier than body text are now regular or bold. A published page and a map label keep the face they were given. On Home, a story card\'s title always holds two lines, so a card keeps its size as the next one comes in.',
        tags: ['layout'],
      },
    ],
  },
  {
    version: '1.125.29',
    date: '2026-11-25',
    theme: 'Mentioned and Link all read names as the hints do',
    entries: [
      {
        id: 'mentions-read-as-hints-read',
        title: 'A card counts and links the names the hints show',
        body: 'On a card, Mentioned, unlinked and its Link all, and the note after you create an element, now find a name as the writing hints do: Éowyn, Zoë and names in other scripts are counted and linked, and Link all links what the line counted. A name inside a longer word no longer counts (Ana in Anaïs). A name holding a bracket or a backslash is not counted, as autolink passes it over. In a scene open in the editor, Link all can be undone and leaves a web link alone.',
        tags: ['writing', 'fix'],
      },
    ],
  },
  {
    version: '1.125.28',
    date: '2026-11-25',
    theme: 'Names with accents count everywhere the hints count them',
    entries: [
      {
        id: 'names-read-as-hints-read',
        title: 'Featured, and Unlink, read a name as the writing hints do',
        body: 'A name that starts or ends with an accented letter, like Éowyn or Zoë, or is written in another script, now lights Featured on its card and keeps its link when one of its chips is unlinked while the name still stands in the text, as it already got a hint. A name in other capitals counts too. A name inside a longer word no longer counts (Ana in Anaïs), and neither does a name of one or two letters, which the hints never looked for.',
        tags: ['writing', 'fix'],
      },
    ],
  },
  {
    version: '1.125.27',
    date: '2026-11-25',
    theme: 'One world, one tab, even at the same moment',
    entries: [
      {
        id: 'two-tabs-one-claim',
        title: 'Two tabs opening one world at the same moment: one opens it, the other says why',
        body: 'A world is meant to be open in one tab at a time, so that two tabs do not write one folder. When two tabs opened a world at the same moment and neither found it in use (its last tab closed, or long quiet), both could open it; so could a tab coming back to a world another tab was taking just then. Now the tabs of a browser read and mark a world\'s use one at a time: the first opens it, the other says it is open in another tab.',
        tags: ['folder', 'safety'],
      },
    ],
  },
  {
    version: '1.125.26',
    date: '2026-11-25',
    theme: 'A folder named in other capitals is said, not read as empty',
    entries: [
      {
        id: 'folder-name-case',
        title: 'A world folder holding Elements/ instead of elements/ is refused, with the name to fix',
        body: 'The folder format names world.json, elements/ and spatial/ in small letters. A world folder that holds one of them only in other capitals, such as Elements/, is now refused when you open it, and Atlas says which name to change. Before, on a disk that tells capitals apart (Linux, ChromeOS, some Macs) Atlas read such a world as empty, and the first new element went into a second elements/ folder beside the old one. Nothing was deleted, but the old elements went unread.',
        tags: ['folder', 'safety'],
      },
    ],
  },
  {
    version: '1.125.25',
    date: '2026-11-25',
    theme: 'Publish says what comes first',
    entries: [
      {
        id: 'publish-says-why-first',
        title: 'Publish on a world that is not online says why, where it lands',
        body: 'A page publishes from a world on onlyworlds.com. On a world kept only in this browser or a folder, Publish now says so when you point at it, and pressing it takes you to that reason, set as a step rather than small print, with Make online ready to press. Before, it opened the page\'s theme settings and the reason sat under them in small grey text.',
        tags: ['pages', 'onboarding'],
      },
    ],
  },
  {
    version: '1.125.24',
    date: '2026-11-25',
    theme: 'The newest OnlyWorlds SDK',
    entries: [
      {
        id: 'sdk-4-203-1',
        title: 'Atlas reads and writes world files with the newest OnlyWorlds SDK',
        body: 'A world file holding a world.json inside a folder whose name starts with a dot now opens, as the folder format says: such a folder belongs to a tool and holds no second world. A world file you make still leaves out who and which tool wrote each element, from every element file it carries.',
        tags: ['world file', 'fix'],
      },
    ],
  },
  {
    version: '1.125.23',
    date: '2026-11-25',
    theme: 'Pages on a phone, and Full page draws its icons',
    entries: [
      {
        id: 'pin-it-readies-the-pin',
        title: 'Pin it on a map gets the pin ready, so the next press on the map places it',
        body: 'On Home\'s Strand tab, Pin it on a map opened the map beside the place\'s page and placed nothing; the way on was a small pin button by the place\'s name, which on a phone sits under the map. It now readies the pin as that button does: the map says "Click the map to place" and the place\'s name, and one press or tap on the map puts it there. Cancel or Esc stops it, and leaving the map lets it go.',
        tags: ['home', 'maps', 'onboarding'],
      },
      {
        id: 'page-actions-on-a-phone',
        title: 'On a phone, Publish and every other page action can be pressed',
        body: 'On a narrow screen the row above a page ran past the edge, so Publish and Delete could not be reached. Where the page has little room, as on a phone, its buttons now show their icons alone and keep their names for a screen reader and on hover, so the page\'s name has room too, and the buttons that add a block wrap onto more lines.',
        tags: ['pages', 'layout', 'fix'],
      },
      {
        id: 'full-page-icons',
        title: 'Full page shows a card\'s icon, and the page\'s own font',
        body: 'In Pages, Full page opens the page in a tab of its own. That tab could not find Atlas\'s icon and text fonts, so a card\'s person icon showed as the letters "pe" and the text fell back to another font. It now loads both, in every browser.',
        tags: ['pages', 'fix'],
      },
    ],
  },
  {
    version: '1.125.22',
    date: '2026-11-24',
    theme: 'The + says what it makes',
    entries: [
      {
        id: 'create-button-named',
        title: 'The + beside the element list says New, and New element says why a type is chosen',
        body: 'The + beside Search elements now shows the word New, and a screen reader hears what it makes: New element, or New location when the list shows only locations. When the list\'s filter chose the type, New element says so under the types ("A location, since the list shows only locations"), until you pick another.',
        tags: ['onboarding', 'accessibility'],
      },
    ],
  },
  {
    version: '1.125.21',
    date: '2026-11-24',
    theme: 'Signing in keeps what you typed',
    entries: [
      {
        id: 'sign-in-fields-kept',
        title: 'The sign-in keeps your email and password when you type the World PIN after them',
        body: 'In Settings, under OnlyWorlds, typing your email or username and password and then your World PIN emptied the two sign-in fields as soon as you left the PIN. They now keep what you typed until you sign in. A pasted account token is kept the same way, a sign-in under way stays under way, and a refused sign-in stays said. The line under the World PIN also says where the PIN comes from: it belongs to your onlyworlds.com account, chosen with your first world there and changed in Account settings.',
        tags: ['onboarding', 'fix'],
      },
    ],
  },
  {
    version: '1.125.20',
    date: '2026-11-24',
    theme: 'A new world on OnlyWorlds gets its address',
    entries: [
      {
        id: 'new-online-world-address',
        title: 'After New world on OnlyWorlds, the address names the new world',
        body: 'Making a world with New world on OnlyWorlds opened it, but the address in the browser stayed on the first screen\'s. Reloading the page then, or copying the address, did not lead back to the new world. The address now names the world as soon as it opens.',
        tags: ['world', 'fix'],
      },
    ],
  },
  {
    version: '1.125.19',
    date: '2026-11-24',
    theme: 'A pin from another tool shares one map',
    entries: [
      {
        id: 'pin-file-one-map',
        title: 'A pin or marker from another tool shares one map on a page, the one Atlas shows it on',
        body: 'A pin or marker file written by another tool can name its map twice, once under each spelling of the field, and a marker can name its zone twice. When the two named different maps or zones, a card on a page offered both and a Full pin shared both, so a published card could name a map Atlas never placed the pin on. A card and a Full pin now share only the map and zone Atlas reads.',
        tags: ['sharing', 'fix'],
      },
      {
        id: 'full-pin-hints-name-the-list',
        title: 'The hints about a Full pin name the list they point at',
        body: 'The hints beside a map\'s pins sent you to "the Publish list", which the page heads What this page shares, or What a republish shares once the page is live. They now say the list of what this page shares, and the Full switch\'s two hover texts end in a full stop.',
        tags: ['sharing', 'fix'],
      },
    ],
  },
  {
    version: '1.125.18',
    date: '2026-11-24',
    theme: 'The Full switch on a pin says what it shares',
    entries: [
      {
        id: 'full-pin-says-what-it-shares',
        title: 'A pin\'s Full switch on a page says what it shares',
        body: 'Turning on Full for a pin on a page shares more of that element than its name, type, description and image. The switch used to say it shared every field of the element. A Full pin leaves out when and by whom an element was written, the marks OnlyWorlds tools keep on it (such as reviews and reports) and Atlas\'s own working fields (such as alternate names). The Full switch and the Visible pins label say so when you hover them. Before you publish, the page lists every field it sends.',
        tags: ['sharing', 'fix'],
      },
    ],
  },
  {
    version: '1.125.17',
    date: '2026-11-24',
    theme: 'Names with accented and other letters are found in your text',
    entries: [
      {
        id: 'names-found-in-any-alphabet',
        title: 'The writing room finds a name that begins or ends with a letter outside English, and no longer stops after the first 2,000 names',
        body: 'As you write, Atlas puts a dotted underline under an element\'s name the first time it appears, and the link button in the editor\'s corner, Link mentions in the tree\'s menu and Link on a Potentials row turn such names into links. A name that began or ended with a letter outside English, such as Éowyn, Zoë or Οδυσσεύς, or with punctuation, such as C++, was never found, and now is. A name is now found only as a whole word, no longer where a letter, a digit or an underscore touches either end of it: Ana is not found inside Anaïs, .NET inside ASP.NET, or St. inside St.Kilda. A name that ends in a full stop, such as Co., is found when a space, punctuation or the end of the text follows it. A name with a square bracket or a backslash in it, such as Kira [the elder], is linked in the scene you have open. In some scenes that are not open, Link mentions leaves it unlinked, and a Potentials row may not show it as in the text: Atlas writes only the links that Unlink can remove again. Atlas used to look for only the first 2,000 names and aliases of a world; it now looks for all of them, except a name or alias longer than 200 characters. In a script written without spaces, such as Chinese or Japanese, a name is found only where a space, punctuation or an edge of the text stands on each side of it. The "Mentioned, unlinked" line in the Web tab, with its own Link all button, the Featured mark, and the check that keeps an element in a scene\'s cast after you unlink it still read names the old way.',
        tags: ['writing', 'fix'],
      },
    ],
  },
  {
    version: '1.125.16',
    date: '2026-11-23',
    theme: 'A page leaves out a link written with an id made by hand',
    entries: [
      {
        id: 'page-text-hand-id-link-left-out',
        title: 'A published page no longer keeps a link to an element it leaves out when that element\'s id was written by hand',
        body: 'Atlas and onlyworlds.com give every element an id in one form. A world folder written by hand, or by another tool, can hold an id of its own, such as "wren-the-traitor". When a page\'s text linked to such an element and the page left that element out, hidden or simply not shown, the link stayed in the page\'s data with the id in it, where a link to an element with an ordinary id has always been taken out. It is now taken out the same way: the link becomes its label. In a world that holds ids like these, a page\'s text keeps a link only when it is the plain link Atlas itself writes to an element the page shows, so a link written another way (a type in capitals, an onlyworlds.com address) becomes its label there too. And where one of those ids has a space or a closing round bracket in it, or ends in one of these marks: a full stop, comma, semicolon, colon, question mark, exclamation mark, straight quote mark (\' or "), closing square bracket or >, Atlas cannot tell where a link to it ends, so every link in that world\'s page text becomes its label. A world whose ids are all ordinary ones is published as before, with one case mended: a link to a hidden element whose id differs only in capitals from the id of an element the page shows is now taken out too.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.125.15',
    date: '2026-11-23',
    theme: 'Three sentences said one way',
    entries: [
      {
        id: 'nameless-world-no-quotes-part-lines-one-verb',
        title: 'A world with no name is not put in quotes, the Publish list ends each line the same way, and a refused seat has one verb',
        body: 'When another tab took the world you were on and Atlas had no name for it, the line read "The world you were on" in quotes, as if that were its name. It is now said without them. In the Publish section\'s list of what a page shares, every line now ends with a full stop, where only a collection\'s did. A seat OnlyWorlds refuses was said with "no longer accepts" in two places and "no longer takes" in a third: all three now say "no longer takes".',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.125.14',
    date: '2026-11-23',
    theme: 'A published page carries only what it draws',
    entries: [
      {
        id: 'full-pin-sends-no-server-record',
        title: 'A map pin set to Full no longer publishes when an element was made or who wrote it',
        body: 'A pin set to Full sends every filled field of its element. That included what OnlyWorlds records beside an element: when it was made and, in a world that syncs, the ids of the members who made it and last changed it, and the door and the software the last change came through. A file written by an older Atlas can also hold a change counter, and a world you read as a guest or player marks what you only know of. None of these is sent now, by a Full pin or by a card, and a card\'s field list no longer offers them. The same goes for the marks other OnlyWorlds tools keep on an element, such as the room an element belongs to or the work a report answers: some hold ids, and none is sent or offered now. A field you added in Atlas still is. A page already published keeps what it was published with until you press Republish: if one of your published pages has a pin set to Full, or a card with one of these ticked, republish it.',
        tags: ['pages', 'privacy', 'fix'],
      },
      {
        id: 'left-out-card-leaves-page-data',
        title: 'A card of a hidden or proposed element, or of one no longer in the world, no longer leaves its id in a published page\'s data',
        body: 'A published page already drew nothing for a card whose element is hidden, proposed and not yet reviewed, or no longer in the world. The page\'s data, which anyone with its address can read, still held that card: the element\'s id and the names of the fields ticked on it. The card now leaves the published data with its element, and a card that stays names only the fields it sends. A card of a pin or a marker sent the ids of its map and zone as plain text: it now names them as any link does, and names nothing of a hidden one. A page already published changes when you republish it.',
        tags: ['pages', 'privacy', 'fix'],
      },
    ],
  },
  {
    version: '1.125.13',
    date: '2026-11-23',
    theme: 'Before Publish, a page says what it shares',
    entries: [
      {
        id: 'publish-says-what-it-shares',
        title: 'Before you publish a page, it lists what it shares, and a pin the page does not draw sends nothing',
        body: 'The Publish section now lists each element the page sends more than a name for, with the fields and picture each card, map pin or collection sends and a button to that block, so a description a new card shows by default, or every field of a Full pin, is in plain sight before Publish or Republish. A pin on a map that is not drawn (no published image, a hidden map, or no place on its map) no longer sends its element or its picture, and a pin moved to another map no longer draws on the map it left or sends anything through it.',
        tags: ['pages', 'privacy', 'fix'],
      },
    ],
  },
  {
    version: '1.125.12',
    date: '2026-11-23',
    theme: 'A world another tab took is closed here',
    entries: [
      {
        id: 'failed-pick-other-tab-took-prior',
        title: 'When another tab takes the world you were on while a different world fails to open, Atlas closes it here and says so',
        body: 'If you picked a world that failed to open, and meanwhile another Atlas tab opened the world you had been on, that world stayed on screen here with an empty list, and anything you made in it went into the other tab\'s files. Atlas now closes it in this tab, goes back to your list of worlds and says another tab may have it open. Opening it again asks whether to take it over, as it does for any world open in another tab.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.125.11',
    date: '2026-11-23',
    theme: 'A key OnlyWorlds no longer takes says so',
    entries: [
      {
        id: 'refused-key-says-so',
        title: 'Downloading a cleared world again, or a shared world by its seat, says when OnlyWorlds no longer takes the key',
        body: 'When OnlyWorlds refused the key of a world this browser had cleared, Download it again said it was not allowed and asked for feedback, though trying again could never help. It now says the key was revoked, or that OnlyWorlds no longer knows it, and the ways back that fit the world: remove it from your list and open it again where it came from, or open a world file of it. A seat that OnlyWorlds stops taking while its world downloads now says so the way it does before a download, with Remove in place of Retry.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.125.10',
    date: '2026-11-23',
    theme: 'A download into a folder that fails keeps nothing',
    entries: [
      {
        id: 'failed-folder-download-keeps-nothing',
        title: 'A world download into your OnlyWorlds folder that fails leaves no half-made folder',
        body: 'When downloading a world into your OnlyWorlds folder failed for any reason but Cancel, such as a lost connection, the folder it had started stayed there, holding part of the world and on no list. It is now removed, as Cancel already did and as a download into this browser does, so a refused download of a shared world can say that nothing changed. Only a folder that download made and opened is removed; when it cannot be removed, such as while a cloud sync app holds a file in it, the line no longer says that nothing changed or that nothing was kept.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.125.9',
    date: '2026-11-23',
    theme: 'A world that fails to open leaves the one you were on as it was',
    entries: [
      {
        id: 'failed-pick-keeps-prior-world',
        title: 'A world that fails to open leaves the one you were on as it was',
        body: 'Choosing another world empties the list at once, so the switch feels quick. When that world then failed to open, for example when the browser was not allowed its folder, the world you were on came back with an empty list, and stayed so until the page was reloaded. It now comes back whole, with the element you had selected.',
        tags: ['fix'],
      },
      {
        id: 'unexpected-refusal-next-step',
        title: 'A refusal Atlas did not expect says what to do next, and the Data room says one thing one way',
        body: 'When OnlyWorlds refuses a step that sends no PIN, such as opening an invite, the demo world or a shared world\'s download, for a reason Atlas does not know, the line now says what to do if it keeps happening: tell us, with the details where Atlas offers them. In the Data room, a reply with code block marks Atlas cannot read past is met with the same words as a reply of several code blocks, Paste only the JSON, and the review\'s line for a link by id to an element of another type names the field as its neighbours do and reads as one line. A reply of very many code blocks no longer holds up typing in the box.',
        tags: ['sync', 'import', 'fix'],
      },
    ],
  },
  {
    version: '1.125.8',
    date: '2026-11-23',
    theme: 'Settings opened in the first moments after a reload stays open',
    entries: [
      {
        id: 'boot-leaves-you-where-you-went',
        title: 'Settings opened in the first moments after a reload stays open',
        body: 'Settings pressed after a reload, before the world in the address had finished opening, gave way to the world\'s Home a moment later. Settings now stays open when the world finishes opening.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.125.7',
    date: '2026-11-23',
    theme: 'The list of worlds survives a browser closed by force',
    entries: [
      {
        id: 'world-list-survives-a-kill',
        title: 'A world made or changed just before the browser was closed by force is still on the list',
        body: 'When the browser was killed or crashed within a few seconds of a change, Atlas could start without the world just made, or with the last change to the list gone. Atlas now keeps a second copy of the list of worlds in this browser and puts it back at the next start, so the world is on the list as you left it.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.125.6',
    date: '2026-11-23',
    theme: 'A refusal names only what was sent, and the Data room reads more replies',
    entries: [
      {
        id: 'refusals-name-what-was-sent',
        title: 'A refusal names only the World PIN or seat secret that was sent, the review says three more cases, and a reply of several code blocks loads',
        body: 'A refusal now names only what Atlas sent: World PINs or seat secrets when OnlyWorlds refuses too many wrong ones, and no PIN at all on a step that sends none, such as an invite, the demo world or a read key\'s download; the seat secret is spelled one way throughout, and the Pin one way in the review\'s note. In the Data room, the review says three more cases (a link by id to an element of another type, an unknown field\'s type, an element_type that names no type), and a reply in a ~~~ code block, or in several code blocks of which exactly one is JSON, loads.',
        tags: ['sync', 'import', 'fix'],
      },
    ],
  },
  {
    version: '1.125.5',
    date: '2026-11-22',
    theme: 'The World PIN or the seat secret by name, and the Data room\'s review in reading order',
    entries: [
      {
        id: 'world-pin-or-seat-secret',
        title: 'A refusal names the World PIN, the seat secret or both, an unsaved chart says so, and the review reads line first',
        body: 'Where Atlas cannot tell whose credential OnlyWorlds refused, the line now names both, the World PIN or seat secret, where it said this PIN or the PIN, and uploading or removing a picture, resolving a conflict, Make online\'s Create new, Bring down again and a seat\'s check before its download now name the one they sent. Lines say Check the World PIN, a seat\'s credential is spelled seat secret everywhere, and when OnlyWorlds refuses too many different seat secrets for a seat world\'s key, the line says seat secrets, not PINs. A chart not yet saved is called Unsaved chart, on the rail and as the card\'s name, where it said This chart. In the Data room\'s review, each row now leads with what is wrong and the path follows it; the note under the review says what Import does with a Pin\'s element, a link by name or by id to an element of another type and a Pin with no element_type; and a missing link\'s expected value writes its type capitalised, as in An existing Location, by name or id.',
        tags: ['sync', 'charts', 'import', 'fix'],
      },
    ],
  },
  {
    version: '1.125.4',
    date: '2026-11-22',
    theme: 'The Data room\'s AI instruction and its review agree',
    entries: [
      {
        id: 'ai-instruction-pin-and-fixes',
        title: 'A reply that follows the AI instruction keeps every link',
        body: 'The instruction the Data room copies for your AI listed a Pin\'s place as element, a key the review then dropped; it now asks for element_type and element_id, the two keys the import reads. When a reply names a group made as a Collective in an Event\'s characters, the review\'s fix now says to link it in collectives, where it used to ask for a Character of the same name. A key written with the list\'s own mark, such as #count, is read as count, and a field written on a type that lacks it names the types that have it. A reply pasted with its code block around it now loads as the JSON inside, where it used to be refused as not valid JSON.',
        tags: ['import', 'fix'],
      },
      {
        id: 'review-wrong-kind-words',
        title: 'The review names a field the way the editor does',
        body: 'A value of the wrong kind is said once with the field\'s own name, as in "Vera": Birth date takes a whole number; here it holds "the spring of 1899", and true or false in a text field is said as a yes or no. The note under the review now names every kind Import treats, a list of an unknown type and a link of the wrong shape among them. When OnlyWorlds refuses a seat\'s secret on a refresh or a push from the sync pill, the line now names the seat\'s secret where it said this PIN.',
        tags: ['import', 'sync', 'fix'],
      },
    ],
  },
  {
    version: '1.125.3',
    date: '2026-11-22',
    theme: 'The World PIN by one name, and the keyboard and phone notes',
    entries: [
      {
        id: 'world-pin-one-name',
        title: 'The World PIN has one name everywhere',
        body: 'Atlas called the four digits of your account the World PIN in some places, and your OnlyWorlds PIN, your PIN or the PIN in others. Every sentence, field and dialog that knows it is the account\'s now says World PIN, the name onlyworlds.com gives it in Account settings; the pill\'s Add PIN and the world list\'s no PIN stay short. A world opened on a seat sends its seat\'s secret, never the World PIN, so its lines name the seat\'s secret. When OnlyWorlds refuses it, the pill now says Put in the World PIN again in Settings, OnlyWorlds, which is where its press opens, and Settings no longer says a World PIN waiting on OnlyWorlds is kept here.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'owner-and-co-builders',
        title: 'Who may make a keeper\'s change is said one way',
        body: 'Where only some members may make a change, such as a world\'s Charter Laws, its strand, a review mark or its published pages, Atlas now always says the owner and co-builders, where it said the world\'s owner and co-builders in some places and the owner or a co-builder in others. A world\'s details still say only the world\'s owner can change them, since OnlyWorlds takes those from the owner alone.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'chart-card-named',
        title: 'The chart\'s card has a short name when it takes focus',
        body: 'Pressing a chip on the chart\'s card with Enter or Space moves focus to the card, and a screen reader read the whole card as its name, every chip included. It now hears Chart card and the selected element\'s name, or the chart\'s name when nothing is selected.',
        tags: ['accessibility', 'charts'],
      },
      {
        id: 'location-chip-focus-ring',
        title: 'A map\'s location chip shows the focus ring',
        body: 'In the Maps tab, a map\'s location chip reached with the keyboard drew only a faint border, too faint to see against the pane. It now draws the same focus ring as every other control, in dark and light mode.',
        tags: ['accessibility', 'maps'],
      },
      {
        id: 'open-link-cards-phone-and-focus',
        title: 'The cards of an Open in Atlas link read better on a phone and leave focus in place',
        body: 'On a phone, the buttons of the card an Open in Atlas link shows now draw their words at 14 px, up from 12, and stay a thumb tall. After Escape or Not now, focus goes back to what you were on, or to the first control of the page behind, instead of resting on nothing.',
        tags: ['accessibility', 'layout'],
      },
      {
        id: 'world-lock-says-tab',
        title: 'A world open in another tab is said in plain steps, and the wait says what it checks',
        body: 'When a world stays closed because another Atlas tab may have it open, the line now says tab, as the question before it does, and names what to do: close that tab and open the world again here, or open it again and choose to take it over. Opening a world that another tab may hold can take a few seconds while Atlas checks; after a second, a line now says Checking whether another tab has the world open, and it goes when the open ends.',
        tags: ['world', 'fix'],
      },
      {
        id: 'review-link-path-once',
        title: 'A missing name in a list of links is pointed at once',
        body: 'In the Data room\'s review, a name in a list of links that is not in the import or the world printed its place with the field twice, such as Character[1].rivals[1].rivals. It now reads Character[1].rivals[1], and so does the fix prompt for your AI.',
        tags: ['import', 'fix'],
      },
    ],
  },
  {
    version: '1.125.2',
    date: '2026-11-22',
    theme: 'The Data room says a field holding the wrong kind of value',
    entries: [
      {
        id: 'review-says-wrong-kind',
        title: 'A text or number field holding the wrong kind of value is said before you import',
        body: 'When the JSON you paste or open in the Data room puts words in a number field, such as a birth date of "the spring of 1899" or a height of "tall", or a group of fields or a list where text belongs, the review now says it, naming the element and the field, before anything is added. Numbers written as text, like "1899", are still taken as numbers, as onlyworlds.com writes them. The fix prompt for your AI carries the same lines, so it can correct the JSON for you.',
        tags: ['import', 'fix'],
      },
    ],
  },
  {
    version: '1.125.1',
    date: '2026-11-22',
    theme: 'A world closed with its tab opens again at once',
    entries: [
      {
        id: 'world-free-when-its-tab-closes',
        title: 'A world closed with its tab, or with the whole browser, opens again with no question',
        body: 'Closing the tab, or the whole browser, with a world open used to keep it locked for about a minute and a half: opening it again asked whether to take it over from another Atlas tab, when there was none. Now Atlas asks the browser whether the page that had the world open is still there, and when it is gone the world just opens. A world another Atlas page really has open still asks, after a moment of checking, and so does a duplicated tab, instead of opening the same world twice. If you answer Cancel, or a world you open from its address is open in another page, Atlas now says why it stayed closed. A world open in another browser or on another computer still asks, as before. And a world from onlyworlds.com whose download into your OnlyWorlds folder fails no longer keeps that folder held by this page until it closes.',
        tags: ['world', 'fix'],
      },
    ],
  },
  {
    version: '1.125.0',
    date: '2026-11-22',
    theme: 'Open in Atlas: one card, one question, and the World PIN when you first change the world',
    entries: [
      {
        id: 'arrival-from-onlyworlds',
        title: 'Open in Atlas from onlyworlds.com takes fewer steps',
        body: 'Signed out, the link now shows one card in the middle of the page: it says what the link does, and holds Sign in with OnlyWorlds and Email and password. Settings no longer opens by itself. Signed in, the world is named in the first and only question: with the folder picker that is where the world should live, and without it a card with Open. Your own world opens without asking for your PIN, as onlyworlds.com says it will. From the site to an empty world now takes 4 presses, down from 6, and no typed field.',
        tags: ['sync', 'world'],
      },
      {
        id: 'world-pin-in-the-world',
        title: 'Your world asks for its World PIN when you first change it',
        body: 'A world you opened from onlyworlds.com keeps your changes here until you give your World PIN. The pill at the bottom says Add PIN, your first change says so once, and pressing either opens a small World PIN dialog in the world: Atlas checks the four digits with OnlyWorlds before it keeps them, and then saves what waited. A PIN OnlyWorlds does not accept is said under the field and kept nowhere. Until then, Home and the world list say the world does not save to OnlyWorlds yet, never that it is online.',
        tags: ['sync'],
      },
      {
        id: 'pin-in-settings-asks-first',
        title: 'A PIN saved in Settings is checked before sync starts on it',
        body: 'Saving a PIN in Settings now asks OnlyWorlds about it first, then starts sync for the open world whatever the answer: a PIN OnlyWorlds refused starts sync paused, so a wrong PIN reaches OnlyWorlds once. Removing the PIN stops sync for that world, and a PIN saved in another tab starts it here too.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.124.35',
    date: '2026-11-21',
    theme: 'A PIN OnlyWorlds refused is never sent again by itself',
    entries: [
      {
        id: 'refused-pin-stays-unsent',
        title: 'A PIN OnlyWorlds refused is not sent again when you open the world',
        body: 'When OnlyWorlds has refused the PIN kept in Settings, Atlas no longer tries it again each time you open the world or reload the page. Sync stays paused as it did right after the refusal, and the sync pill says so. Pressing the pill opens Settings, under OnlyWorlds, where you put in the PIN again; saving a different PIN starts sync again at once, and so does a new PIN saved in another tab. Turning a pause off does not send the refused PIN either: it says the PIN is what stops sync. Upload them, for a big batch of changed files waiting at open, says the same and keeps the question for after the new PIN.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'wait-out-429',
        title: 'When OnlyWorlds asks Atlas to wait, Atlas sends nothing until the wait is over',
        body: 'OnlyWorlds sometimes asks Atlas to wait, for example after too many different PINs were tried for one world\'s key. Atlas used to send a new edit before the wait was over, which only met the same answer. Now everything you change during the wait, the world\'s own settings included, stays saved where the world keeps it and goes up once, when the wait ends. The sync pill says Waiting, and its tooltip how long, and Sync now and refresh say how long is left instead of sending; while sync is also paused, offline or waiting for your answer on changed files, they say that instead. A refresh Atlas would have made by itself during the wait comes with the try at its end. The wait holds when you switch worlds and back, or save a new PIN in Settings: a PIN saved during the wait is kept and not called wrong, and Settings says the wait. A page reload forgets the wait, and OnlyWorlds names it again at the first try.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'wait-words-by-cause',
        title: 'A wait for too many PINs is told apart from any other wait',
        body: 'When the wait is for too many different PINs, Atlas says: OnlyWorlds refused too many different PINs for this world\'s key, so it takes none for a while. Check your PIN in Settings; Atlas tries again in the time left. Any other wait says OnlyWorlds asked Atlas to wait, where your changes are saved, and when Atlas tries again. Before, every wait blamed wrong PINs. The same split holds for files on an element, pages, and every other place that can meet a wait.',
        tags: ['sync'],
      },
      {
        id: 'keeper-only-words',
        title: 'A change only the owner and co-builders can make says so',
        body: 'OnlyWorlds lets only a world\'s owner and co-builders change its Charter Laws and the Objects those Laws name. A change to one of them from anyone else now says that only the world\'s owner and co-builders can change that element, and to ask one of them; the change stays where the world keeps it. Before, it said this only of the charter mark. The other changes in the same sync still go up.',
        tags: ['sync'],
      },
      {
        id: 'sync-words-1124-35',
        title: 'Clearer words in Settings',
        body: 'A PIN not checked yet now says Not checked by OnlyWorlds yet. A refusal that may be the key or the PIN says this world\'s key or the PIN. When some ids are in use on OnlyWorlds and others are in another world, This world says it in the two lines\' own words, for example: 3 elements could not upload: 2 ids are already in use on OnlyWorlds and 1 is in another world. If OnlyWorlds ever answers a new element as if it had replaced a copy it held, Atlas says that, keeps the copy here unchanged, and sends it again with your next save.',
        tags: ['settings'],
      },
      {
        id: 'keyboard-rings-1124-35',
        title: 'Keyboard focus shows in full, and lands where a press opened something',
        body: 'The focus ring on a field section\'s header shows all four edges, and a scroll card\'s head shows its ring at full strength even when the card is faded toward the edge. Enter or Space on a map\'s name in the Maps tab puts focus on the map\'s tab it opened, and on a chip in a chart card puts it on that card, instead of the page. A mouse click still leaves no ring. In a map\'s zones list, each kind\'s look and eye buttons now have names of their own that say what they do and for which zones.',
        tags: ['accessibility'],
      },
    ],
  },
  {
    version: '1.124.34',
    date: '2026-11-21',
    theme: 'Sending many new elements never replaces one OnlyWorlds already holds',
    entries: [
      {
        id: 'bulk-create-only',
        title: 'A batch of new elements can no longer replace one already on OnlyWorlds',
        body: 'When Atlas sends several new elements at once, OnlyWorlds now takes them only as new. If one of them is already there, for example because another device or person sent it a moment earlier, OnlyWorlds keeps its own copy and Atlas compares the two: the same, it simply takes it; different, it waits in Review conflicts for you to choose, as a copy restored from a backup does. Before, a batch sent in that moment could replace the element there, a member\'s edits included, and Atlas could only tell you afterwards. The other elements of the batch are still sent in the same round. Atlas also no longer asks OnlyWorlds which elements it holds before each batch, and the note that one was replaced is gone, since that can no longer happen.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'id-in-use-new-id',
        title: 'An element whose id OnlyWorlds already uses can get a new one',
        body: 'Rarely, OnlyWorlds already uses an element\'s id for something that is not an element. Atlas used to say only that the change could not sync, every time it tried. It now says the id is already in use on OnlyWorlds, and Settings, under This world, can give the element a new id, as it does for an id that belongs to another world. Atlas now says the same whether the element was sent alone or with others.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'pin-words-again',
        title: 'The PIN field says what to do when OnlyWorlds refuses it',
        body: 'A PIN OnlyWorlds did not accept now says: OnlyWorlds did not accept this PIN. Check it and save it again. One not checked yet says Saved in this browser, not checked yet. When Atlas asked about it and got no answer, because you were offline or OnlyWorlds was busy, it asks again the next time you open Settings, still once each time, and never while its last question is still waiting for an answer, so a wrong PIN reaches OnlyWorlds once. Every other place that tells you OnlyWorlds refused your PIN now says it the same way, then what to do there.',
        tags: ['settings'],
      },
    ],
  },
  {
    version: '1.124.33',
    date: '2026-11-20',
    theme: 'Your PIN is saved once OnlyWorlds takes it',
    entries: [
      {
        id: 'pin-saved-when-accepted',
        title: 'The PIN in Settings says PIN saved only once OnlyWorlds has taken it',
        body: 'The PIN you type in Settings is still kept at once, and the field now says what OnlyWorlds said of it: PIN saved once OnlyWorlds has taken it with a key that can write, OnlyWorlds did not accept this PIN when it refused it, and Kept here, not checked yet until then. Atlas asks once when you save it, beside the open world\'s key that can write, and once when you open Settings with a PIN it has not checked yet. A change that syncs, Test connection, downloading or linking a world, a new key and a new world on OnlyWorlds also count. A PIN kept by an earlier Atlas reads as not checked yet until one of these happens. No PIN is ever sent beside a key that can only read.',
        tags: ['sync', 'settings'],
      },
      {
        id: 'read-key-one-phrase',
        title: 'A key that can only read is said one way',
        body: 'Test connection, the sync pill\'s tooltip and the This world tab now say This key can only read, where they said It reads only and This is a read key. When OnlyWorlds already held an element a batch sent, the note says it with its article: OnlyWorlds already held the character "Ada" and took this one in its place.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.124.32',
    date: '2026-11-20',
    theme: 'One word for a missing element, and one pair in Review conflicts',
    entries: [
      {
        id: 'missing-said-one-way',
        title: 'A missing element is said one way, and every delete names its type',
        body: 'An element that is not in the world at all is now said one way: a missing location inside a sentence, and (missing location) on a chip, a row or a label, in the type its field or pin names, or (missing element) where nothing names one. That replaces (unknown), (unknown map), (missing), (pin without element) and (missing knower) in the knowledge room\'s chips, the Web\'s names, its links to and its way back, the map a pin is on, the maps a zone is drawn on, the map dialog\'s place and parent map, and a page\'s pins, collections and circles. A published page\'s delete asks as the others do, Delete page "Arrival"? It is published at its address, and a world\'s two delete questions say world: Delete world "Harbour"?, or Delete this world? for a world with no name. An undated chip on a chart\'s card is named for what a press does, and its tooltip still says a drag dates it; a chip for an element with no name shows its unnamed form. Not changed: a link field\'s chip for an element not in the world still shows its id, a map tab whose map is gone keeps the name it was opened with, and a picture file that is gone is still (missing file).',
        tags: ['accessibility', 'editor'],
      },
      {
        id: 'review-one-pair',
        title: 'Review conflicts offers the same two choices on every row',
        body: 'Every row in Review conflicts now offers Keep this copy and Keep the OnlyWorlds copy, each with a tooltip saying what it does, where the older rows said Overwrite (mine wins) and Pull (theirs wins), and no row speaks of a server. In a view-only world every row offers only Keep the OnlyWorlds copy, since this copy cannot be sent from there. The note that an element restored without its record waits for you now carries its own Review conflicts button, which opens the review. When OnlyWorlds already held an element a batch sent as new, the note names it: OnlyWorlds already held character "Ada" and took this one in its place.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.124.31',
    date: '2026-11-20',
    theme: 'A read key opens to read, and your PIN stays with keys that write',
    entries: [
      {
        id: 'read-key-no-pin',
        title: 'A read key needs no PIN, and Atlas never sends one with it',
        body: 'A read key pasted into Download a world now opens the world to read, with no PIN asked. Atlas no longer sends your PIN with a key that can only read, so a mistyped PIN there can never count against your account. Test connection on a world that reads says the key works and reads only, and a world downloaded earlier with a read key now opens to read. When you download, link or open a world, put in or make a new key, or make a new world on OnlyWorlds, the PIN you typed is saved for your other worlds only once OnlyWorlds has accepted it: beside a key that can write, or when it makes the world. The PIN field in Settings still saves what you type there. If a key that can only read meets an edit, Atlas says the key reads only and where a write key goes, instead of asking about your PIN.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.124.30',
    date: '2026-11-20',
    theme: 'A copy restored from a backup waits for you',
    entries: [
      {
        id: 'restored-copy-waits',
        title: 'A copy restored from a backup or another computer waits for you to choose',
        body: 'When a file comes back without its record of what OnlyWorlds held, from a backup, a zip, an older commit, a copy of the folder on another computer or a world file opened again, and OnlyWorlds holds a different version of that element, Atlas no longer sends the file over it. The element waits in Review conflicts under every sync setting, with each field that differs shown both ways: Keep this copy sends it, Keep the OnlyWorlds copy takes the online one. A copy that holds the same as OnlyWorlds settles on its own, and nothing is sent.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'removed-on-disk-words',
        title: 'Files removed outside Atlas: the note says how they come back',
        body: 'The note for files another program removed from a linked world\'s folder no longer promises that a refresh brings them back. They stay on your OnlyWorlds account; one comes back when it changes there, and putting the files back brings them now.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.124.29',
    date: '2026-11-20',
    theme: 'The stand-ins for a missing name',
    entries: [
      {
        id: 'unnamed-stand-ins',
        title: 'This character, (unknown), (home) and the delete notes say the unnamed form',
        body: 'A delete asks with the type\'s word and the name in quotation marks, such as Delete map "Harbour"?, the same from every place it is asked, and the note after it says the name plainly: Deleted Harbour. A narrative is asked by its room\'s word: Delete chapter "One"? in the writing room, Delete entry "Debt"? among the knowledge entries, Delete page "Arrival"? among the pages. An element with no name is asked and told in its unnamed form, Delete the unnamed map? and Deleted the unnamed map, never empty quotation marks. That now holds for maps, zones from a map\'s list and from their own page, an element\'s page, the writing tree and a chart, whose note no longer says Removed, Zone deleted, Deleted element or Deleted zone. Where Atlas said this character, this location, this element, it, (unknown), (home) or the type\'s word alone for an element with no name, it now says the unnamed form, with a capital where it starts a line: the home page\'s guide and its cards (The unnamed character\'s place was deleted.), the home grid and its picture, the notes that follow your first steps, the Web\'s names, its links to and its way back home, a charter\'s mark, Home\'s charter, guide and domains, a map\'s tab, the map a pin is on, the maps a zone is drawn on, the door to a map within a map, the Link and Dismiss of a suggestion, the banner while a pin is placed, a known-of element\'s note, the note when only a keeper may delete, the note when a file is added or a picture could not be set, a chart\'s focus, the note when an alias could not be saved, and the line naming whose view a world file holds. A name that is not text, as a hand-edited file may hold, reads as none in the Maps list (its rows, its folds and their delete) and in the writing tree (its order, its search, a drag to reorder and its add buttons), where it could stop the list from drawing. An element that is not in the world at all keeps words that say it is missing. A new map of a place with no name starts as New map. An undated chip on a chart\'s card ends its second sentence with a full stop. Not changed yet: the label a new link writes into a story for an element with no name; the words for an element that is not in the world at all, which still take several forms, such as (unknown), (unknown map), (missing) and a missing location; the label of a pin on the map, which stays empty for an element with no name; a page\'s revoke, which asks with the name alone; and some other stand-in words in other places.',
        tags: ['accessibility', 'editor'],
      },
    ],
  },
  {
    version: '1.124.28',
    date: '2026-11-19',
    theme: 'The other words for a missing name',
    entries: [
      {
        id: 'unnamed-other-words',
        title: 'Unnamed, (untitled) and the other words for a missing name say the unnamed form',
        body: 'Where Atlas still said Unnamed, unnamed pin, unnamed zone, (untitled), this entry or an unnamed element for an element with no name, it now says the unnamed form the other rooms use: the unnamed character, the unnamed zone, the unnamed page. That covers the strand on the home page and its cards, the lenses on the Web, a work packet\'s list, the pins and markers that link to an element, the notes after Make online and after a sync problem, the files removed on disk, a picture\'s removal, a chart\'s delete, a page\'s and a knowledge entry\'s delete and the note after it, a page\'s revoke, the title of a published page, and the knowledge room\'s chips for who holds an entry and what it is about. A knowledge entry with no name is no longer saved as Unnamed knowledge: Create asks for a name first, as the create dialog and the home page\'s cards do. A lens kept on an element with no name is named for its unnamed form, such as The unnamed character\'s world, and a split offers New chapter as the new part\'s name where it offered Unnamed chapter. A link that stands alone after a label, as under Linked from and in a message\'s From and To, now starts with a capital. A saved page or knowledge entry with no name is headed by its unnamed form, not by the prompt to type one. The chips on a chart\'s card are named for what a press does, such as Show Ada (character) on the chart, and the scroll card\'s chips, the knowledge rows and their From links say in their tooltip what they open. Not changed yet: the label a new link writes into a story, and other stand-ins for a missing name in other places, such as this character, (unknown), (home) and Deleted element.',
        tags: ['accessibility', 'editor'],
      },
    ],
  },
  {
    version: '1.124.27',
    date: '2026-11-19',
    theme: 'The unnamed, said one way',
    entries: [
      {
        id: 'unnamed-one-form',
        title: 'A missing name is said one way in the rooms that showed (unnamed)',
        body: 'The rooms that showed (unnamed) now say one form instead: an element with no name, or a name of only spaces, reads as the unnamed character, the unnamed map or the unnamed event. That holds on its own page and its header, in the sidebar, the command palette and the pickers, in the writing and knowledge rooms, on the maps and their tooltips, on the charts, on the home page and on a shared page, in the world\'s own word for the type. Where a room has its own word, it keeps it: the writing room says the unnamed chapter, the calendar menu the unnamed calendar, the pages list the unnamed page. Where the form stands alone, as a heading, a row, a tab or a chip, it starts with a capital, The unnamed event; inside a longer line it stays lower case, Open the unnamed event. The linked chips on a chart\'s card are now named for what a press does, such as Open Ada, and a chip on the home page reads Open the unnamed character where it said Open (unnamed). Not changed yet: the label a new link writes into a story, and a few other words for a missing name, such as Unnamed and (untitled).',
        tags: ['accessibility', 'editor'],
      },
    ],
  },
  {
    version: '1.124.26',
    date: '2026-11-19',
    theme: 'Each name said one way',
    entries: [
      {
        id: 'names-one-way',
        title: 'A fold is named for what it folds, and a missing name is said one way',
        body: 'A fold in the Maps tab or a map\'s zones list is now named for what it folds, such as The 3 maps under Sikelia, with no verb in its name; whether it is open comes from the fold\'s own state. Its tooltip still says what a press does, such as Show the 3 maps under Sikelia, or why a press does nothing while a search holds it open, and a screen reader may read that tooltip too. Something with no name is said the same way everywhere, on its button, card or link as in the controls beside it: the unnamed map, the unnamed event, never a blank. A field\'s remove reads Remove the field Tally for every kind of field. A map\'s location chip is named for what it does, such as Open Syracuse, and the setting for element images reads Show element images, on an element\'s page and in the web pane.',
        tags: ['accessibility', 'maps', 'editor'],
      },
    ],
  },
  {
    version: '1.124.25',
    date: '2026-11-19',
    theme: 'Each control says its own name',
    entries: [
      {
        id: 'controls-say-their-names',
        title: 'Folds, rows and buttons say what they do',
        body: 'In the Maps tab, a map\'s name is its own button with its fold beside it, so Tab reaches each once and the map is named once. The folds there and in a map\'s zones list say what a press does, such as Show the 3 maps under Sikelia or Hide the list of the 2 Border zones, in their tooltips too; while a search holds them open, they say so and a press changes nothing. A zone\'s delete, a map\'s delete, a field\'s remove and a card\'s Open in the charts\' scroll view name what they act on, such as Delete the zone the north march. After hiding element images, the note says how to bring them back in the same words as the button: Show element images.',
        tags: ['accessibility', 'maps', 'editor'],
      },
    ],
  },
  {
    version: '1.124.24',
    date: '2026-11-18',
    theme: 'More of the page by keyboard',
    entries: [
      {
        id: 'keyboard-chips-folds',
        title: 'Link chips, folds, zones and chart cards work from the keyboard',
        body: 'Tab now reaches the name on a link chip and on a Referenced by chip, and Enter or Space opens that element with focus on its name. A field section folds and unfolds by keyboard, and Show element images beside an element\'s name works by keyboard too, with the hide button then one press away. On a map, a zone kind folds and a zone opens from its name in the zones list, and the Maps tab folds a map\'s children. In the charts\' scroll view, a card opens and closes from its name. When the page redraws after such a key press, focus stays on what you pressed, and a held key presses once; a mouse click leaves focus as it always did. Escape in the zones list closes it and puts focus back on its button. A zone kind holding the selected zone can now be folded as well, and selecting the zone again opens it.',
        tags: ['accessibility', 'editor', 'maps'],
      },
    ],
  },
  {
    version: '1.124.23',
    date: '2026-11-18',
    theme: 'One verb, one tense',
    entries: [
      {
        id: 'sync-pill-one-verb',
        title: 'While sync runs, the pill uses one verb',
        body: 'The pill\'s label, its tooltip and the refresh button\'s name all say Saving or Fetching. They used to say Saving, Syncing 3/10 and Syncing with OnlyWorlds now for the same moment. With the keyboard on the faint refresh button while sync runs, its focus ring now shows at full strength.',
        tags: ['sync', 'accessibility'],
      },
      {
        id: 'sync-words-one-tense',
        title: 'Sync messages promise the same thing in the same words',
        body: 'The message after a sync said Atlas will try again where Settings and the element\'s mark said Atlas tries again; now every place says tries again. An element OnlyWorlds kept when it was deleted here is described that way in the message too, so it no longer reads as OnlyWorlds keeping it deleted.',
        tags: ['sync'],
      },
      {
        id: 'share-copy-address-name',
        title: 'The copy button on a published page has a name',
        body: 'On the Pages room, the button that copies a published page\'s address now tells a screen reader what it does. It used to read out the name of its icon.',
        tags: ['accessibility'],
      },
    ],
  },
  {
    version: '1.124.22',
    date: '2026-11-18',
    theme: 'Sync says it once, and truly',
    entries: [
      {
        id: 'sync-busy-retry-words',
        title: 'A file in use says what OnlyWorlds has, and tries again by itself only when it will',
        body: 'When OnlyWorlds took a change and a file in use elsewhere stopped Atlas writing that down here, Settings, the element\'s mark and the message after a sync said only that the file was in use; now they say what OnlyWorlds has first (a change it took, or an element it kept). "Tries again by itself" is said only when Atlas has in fact set itself to try again: a file in use while saving this world\'s own settings or its conflicts now sets that too, as does one the browser reported without its usual name, and after five tries in a row the words say your next save instead. A copy Atlas could not remove after it left what OnlyWorlds shows you says it stays here as it was.',
        tags: ['sync'],
      },
      {
        id: 'sync-pill-one-name',
        title: 'The sync pill says one thing at a time',
        body: 'While sync runs, the refresh button stays in its place, faint, says so and is marked unavailable; it used to vanish, taking the keyboard\'s place with it, and the pill\'s tooltip offered a refresh that did nothing. A waiting save is called a save on the button, in the pill\'s tooltip and in the message if it fails. When sync stops, the pill says Sync stopped and its button See why in Settings, where it said Error beside Sync stopped.',
        tags: ['sync', 'accessibility'],
      },
      {
        id: 'one-name-per-button',
        title: 'Buttons with one name each',
        body: 'A writing suggestion\'s dismiss button, the rename on Home and the buttons on a page block each say the same words to a mouse\'s tooltip and to a screen reader. The dismiss button\'s focus ring now shows at full strength, as the others do.',
        tags: ['accessibility'],
      },
    ],
  },
  {
    version: '1.124.21',
    date: '2026-11-18',
    theme: 'An element\'s fields keep your place',
    entries: [
      {
        id: 'fields-keyboard-place',
        title: 'Fields by keyboard keep your place',
        body: 'With some of a field\'s value selected, Enter or Space on it opened nothing; now it opens the editor (a mouse click after selecting still leaves your selection alone). In the in-place edit modes, a save or Escape brings focus back to the field, and after removing a link, focus moves to a neighbouring link\'s remove mark, or to the field\'s pick button when none is left. A screen reader hears a value\'s line breaks as spaces, no doubled full stop, and an unnamed linked element by its type.',
        tags: ['editor', 'accessibility'],
      },
    ],
  },
  {
    version: '1.124.20',
    date: '2026-11-18',
    theme: 'More doors by keyboard',
    entries: [
      {
        id: 'keyboard-doors-home-tabs-panes',
        title: 'Home\'s name and description, map tabs, the pane dividers and page blocks by keyboard',
        body: 'On Home, Tab reaches the world\'s name and description, and Enter or Space opens their editor. Delete closes the map tab that has focus. The dividers between the panes take focus and move with the arrow keys (Shift for a bigger step). A block on a page you are building has an Edit button beside Move up and Move down. In the writing room, a suggestion\'s Link and dismiss are real buttons a keyboard reaches.',
        tags: ['accessibility'],
      },
    ],
  },
  {
    version: '1.124.19',
    date: '2026-11-18',
    theme: 'Sync says what it will do',
    entries: [
      {
        id: 'sync-disk-step-words',
        title: 'A change Atlas could not write here says what OnlyWorlds has',
        body: 'When OnlyWorlds took a change and Atlas then could not write that down in the folder or this browser, Settings and the element\'s mark said Atlas tries again by itself. Only a file in use elsewhere is retried on its own; the words now say what happens next for each case, most often with your next save. A change or a delete OnlyWorlds already has says so, where it used to read as a change that did not sync.',
        tags: ['sync'],
      },
      {
        id: 'sync-pill-names',
        title: 'The sync pill\'s refresh button is named for what it does',
        body: 'With a save waiting, the refresh button sends it now, and with sync stopped it opens Settings; its name now says so, for a screen reader and the keyboard. Each warning badge has one name, the element\'s mark no longer says Click or names Settings twice, and when a badge goes away while it has focus, focus moves to the refresh button.',
        tags: ['sync', 'accessibility'],
      },
    ],
  },
  {
    version: '1.124.18',
    date: '2026-11-17',
    theme: 'An element\'s fields by keyboard',
    entries: [
      {
        id: 'fields-keyboard',
        title: 'Edit a field, its aliases and its links from the keyboard',
        body: 'On an element\'s page, a field\'s value and the aliases row opened their editor on a mouse click alone, and a link\'s remove mark answered only a mouse. Tab now reaches each, Enter or Space opens the editor or removes the link, a screen reader names the field and its value, and focus comes back to the field when the editor closes or saves. Values stay selectable with a drag. The same remove mark in the map dialog works by keyboard too.',
        tags: ['editor', 'accessibility'],
      },
    ],
  },
  {
    version: '1.124.17',
    date: '2026-11-17',
    theme: 'The sync pill by keyboard',
    entries: [
      {
        id: 'sync-pill-keyboard',
        title: 'The sync pill\'s badges and refresh work from the keyboard',
        body: 'The warning badges on the sync pill (conflicts to review, changes not syncing) and its refresh mark answered only a mouse, and reviewing conflicts opens from that badge alone. They are now buttons: Tab reaches them, Enter or Space presses them, and a screen reader names each one. Focus stays on the badge when the pill updates.',
        tags: ['sync', 'accessibility'],
      },
    ],
  },
  {
    version: '1.124.16',
    date: '2026-11-17',
    theme: 'Not syncing, said truly',
    entries: [
      {
        id: 'sync-issue-disk-words',
        title: 'Settings no longer says OnlyWorlds has a change it never got',
        body: 'When Atlas could not write an element to this browser or the folder during sync, Settings said "OnlyWorlds has it" for every such element. That is true only for an element just made online. For the rest, such as an element put back after OnlyWorlds refused its delete, it now says Atlas could not write it, and that Atlas tries again by itself.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.124.15',
    date: '2026-11-17',
    theme: 'An element that cannot sync says so',
    entries: [
      {
        id: 'sync-dot-not-syncing',
        title: 'The sync mark on an element says when it is not syncing',
        body: 'In a world linked to OnlyWorlds, the small mark beside an element\'s name said "Pending sync" even when OnlyWorlds had refused the change, for as long as it kept being refused. It now shows a warning mark that says the element is not syncing and why, the same words Settings gives, and a click opens Settings, under This world, where the fix is.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.124.14',
    date: '2026-11-17',
    theme: 'A map keeps its view after a reload',
    entries: [
      {
        id: 'map-measure-kept',
        title: 'A map with no size of its own keeps where you left it',
        body: 'A map whose width or height is not written above 0 is drawn at its picture\'s own size. Atlas measured that picture again on every load and, as the map changed shape under it, threw away where you had zoomed and panned, so the map opened fitted each time. Atlas now remembers the measure in this browser, and the map opens where you left it. The picture is still measured on each load, so one replaced at the same address takes its new size.',
        tags: ['maps', 'fix'],
      },
    ],
  },
  {
    version: '1.124.13',
    date: '2026-11-17',
    theme: 'A refused name gets advice it can follow',
    entries: [
      {
        id: 'host-refused-names',
        title: 'A name the web host refuses gets advice you can follow',
        body: 'When the web host in front of OnlyWorlds refuses a world\'s name at Make online or New online world, a player\'s name at an invitation, or your name on an invite link, usually because it holds a command between code marks, such as `python -m`, Atlas now says only to write it without the marks: a name has no room for a code block. Making an invite link used to say "Try again in a moment" for that refusal, which never helps; it now says the host refused it and why.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.124.12',
    date: '2026-11-17',
    theme: 'The web host\'s refusal said for what it is, everywhere',
    entries: [
      {
        id: 'host-refused-everywhere',
        title: 'A refusal by the web host is no longer called a problem in Atlas or a wrong PIN',
        body: 'Since 1.124.11 a change the web host in front of OnlyWorlds refuses waits in its own words while your world syncs. A few other places still read that refusal wrongly: making a world online with a name that holds a command between code marks said Atlas had run into a problem it did not expect, and a player\'s name refused the same way at an invitation asked you to check your PIN. Now each says the web host refused it before it reached OnlyWorlds, and why when the host says so.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.124.11',
    date: '2026-11-16',
    theme: 'A change the web host refuses is said for what it is',
    entries: [
      {
        id: 'host-refused-change',
        title: 'A change the web host refuses no longer stops your world from syncing',
        body: 'The web host in front of OnlyWorlds refuses some writes before they reach OnlyWorlds, usually text holding a command between code marks, such as `python -m`. Atlas read that as a refused key: it asked you to check your PIN and stopped syncing the whole world. Now only that change waits, Atlas says the host refused it and why, and every other change keeps going up. Write the command without the code marks, or in a code block that names its language, and it goes up too. Publishing a page and adding a file say the same.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'home-counts-wrap',
        title: 'The counts on a world\'s home no longer leave a dot at the edge of a line',
        body: 'When the line of counts under a world\'s name wraps, on a phone or in a narrow middle pane, a separating dot could hang at the end of a line or start the next one. Now a dot only ever stands between two counts on the same line, and the last "1 each" part reads from the left like the rest.',
        tags: ['home', 'fix'],
      },
    ],
  },
  {
    version: '1.124.10',
    date: '2026-11-16',
    theme: 'A map keeps the size its file gives it',
    entries: [
      {
        id: 'map-size-as-written',
        title: 'Opening a map no longer writes over a size of 0 or below',
        body: 'A map whose file gives a width or height of 0 or below, written by another tool or by hand, now keeps those numbers. Atlas draws its picture at the picture\'s own size, or the plain square when it has none, and leaves the file as it is. Before, the first open wrote the picture\'s size over them. A map with no size at all is filled in as before.',
        tags: ['maps', 'fix'],
      },
    ],
  },
  {
    version: '1.124.9',
    date: '2026-11-16',
    theme: 'A linked world keeps its own settings until you choose',
    entries: [
      {
        id: 'link-keeps-world-settings',
        title: 'Linking a folder no longer replaces a world\'s own settings unasked',
        body: 'When you link a folder to an online world that already has its own description, picture or time settings, and the two differ, Atlas now treats each one as a conflict. With Pause and review, it waits for you to choose which to keep; with Local wins, the folder\'s value goes up, as that setting says. Before, the folder\'s value went up at the next open even under Pause and review.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.124.8',
    date: '2026-11-15',
    theme: 'The new globe on a shared link',
    entries: [
      {
        id: 'link-card-true-curves-globe',
        title: 'A shared Atlas link shows the new OnlyWorlds globe',
        body: 'The picture a chat or a social site shows beside an atlas.onlyworlds.com link now carries the OnlyWorlds globe drawn in true curves, the same mark as the tab and the app icon.',
        tags: ['sharing'],
      },
    ],
  },
  {
    version: '1.124.7',
    date: '2026-11-14',
    theme: 'Each element once in a list of links',
    entries: [
      {
        id: 'links-each-element-once',
        title: 'A list of links names each element once',
        body: 'The OnlyWorlds standard now says a list of links names each element once. When a list names one element twice, the world\'s picture and its link counts read it once. When elements get new ids, after an import that matched an element by name or a sync that joined two copies, a list that held both the old and the new id now keeps one of them. New world folders are format 0.3.24.',
        tags: ['folders', 'fix'],
      },
    ],
  },
  {
    version: '1.124.6',
    date: '2026-11-14',
    theme: 'A link glued to a word is part of the word',
    entries: [
      {
        id: 'prose-links-glued-start',
        title: 'A link written straight after a letter or an underscore is plain text',
        body: 'A link to an element that starts right after a letter, an accent mark or an underscore is now part of the sentence, as the OnlyWorlds standard reads it: elbow://object/... names nothing, and a link written between underscores for emphasis (_ow://object/..._) links nothing either. Such a link adds nothing to the scene, shows in no element\'s mentions and keeps its id when elements get new ids. A link after a space, a hyphen, a digit, a bracket or a quote reads as before, and so does a link between asterisks (*ow://object/...*). A published page still leaves such a link out when its element is not on the page. It now also leaves out a link whose id is written in capital letters when that element is not on the page, even when the world holds an element with the same id in small letters that is.',
        tags: ['writing', 'fix'],
      },
    ],
  },
  {
    version: '1.124.5',
    date: '2026-11-14',
    theme: 'Edit times read as times',
    entries: [
      {
        id: 'edit-times-any-offset',
        title: 'An edit another tool writes now syncs, whatever its time offset',
        body: 'Atlas compared edit times as text, so an edit another tool made in your folder with a time like 00:10:00-05:00 could read as older than the copy online, stay unsynced and be replaced by the next pull. Atlas now reads every edit time as the moment it names, so that edit uploads like any other.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.124.4',
    date: '2026-11-14',
    theme: 'Folders stamped as the folder check reads them',
    entries: [
      {
        id: 'folder-format-back-to-0-3-22',
        title: 'New world folders are format 0.3.22 again',
        body: 'Atlas 1.124.3 wrote new world folders as format 0.3.23, a version the OnlyWorlds folder check does not know yet, so checking a new folder printed a warning to update a check that has no newer version. Nothing a folder holds differs between the two versions, so Atlas writes 0.3.22 again, the version the check reads.',
        tags: ['folders', 'fix'],
      },
    ],
  },
  {
    version: '1.124.3',
    date: '2026-11-14',
    theme: 'An empty link or mark is none',
    entries: [
      {
        id: 'empty-string-link-is-none',
        title: 'A link left as an empty text is read as no link',
        body: 'A world folder written by another tool can hold a link as an empty text, such as a pin whose map is "" or a map whose parent map is "". Atlas now reads it as no link when the world opens, as the OnlyWorlds standard says, so the element shows no target and saving it online sends nothing the site would refuse. The file keeps its empty text until Atlas next writes it: when you edit the element, after a sync, or when Atlas gives the file its usual name.',
        tags: ['folders', 'fix'],
      },
      {
        id: 'empty-mark-is-none',
        title: 'An empty mark is no mark',
        body: 'A Charter whose charter mark, or a room element whose room mark, holds an empty list or an empty set of fields is now read as unmarked, as the OnlyWorlds standard says: the Charter no longer leads Home and the element reads as lore. Marking a Charter in Atlas writes a real mark, as before.',
        tags: ['world', 'fix'],
      },
      {
        id: 'tour-folder-file-opens',
        title: 'A tour world zipped by hand opens',
        body: 'A world file made by zipping the folder of an Atlas tour world was refused as "not a world Atlas can open". It now opens as a world of your own; the mark that told Atlas it was the tour\'s practice world is left out, as an import already leaves it out.',
        tags: ['world-file', 'fix'],
      },
      {
        id: 'folder-format-0-3-23',
        title: 'New world folders are format 0.3.23',
        body: 'Atlas writes new world folders as format 0.3.23, the newest version of the OnlyWorlds folder format. No file changes its shape.',
        tags: ['folders'],
      },
    ],
  },
  {
    version: '1.124.2',
    date: '2026-11-14',
    theme: 'Links in your writing read by the OnlyWorlds address rules, everywhere in Atlas',
    entries: [
      {
        id: 'prose-links-address-rules',
        title: 'A link to an element in your writing is read the way every OnlyWorlds tool reads it',
        body: 'Atlas now reads a link to an element in a story with the OnlyWorlds address rules, the same in the writing room, the context pane, the compiled view and a published page. A link whose type word starts with a capital (ow://Character/...), whose id is not a whole id (ow://character/abc), or that starts with OW:// is plain text: it links nothing and adds nothing to the scene. Letters written straight after a link\'s id are part of the sentence, so the link names the id before them; before, the letters were read as part of the id and the link named nothing.',
        tags: ['writing'],
      },
      {
        id: 'prose-links-moment-lens-rekey',
        title: 'An id in capital letters names its element, and a link with a moment or a lens follows new ids',
        body: 'An id written in capital letters in a link names the element whose id is written that way, and otherwise the element with the same id in lowercase, so a scene that names an element that way now adds it to the scene\'s characters, places and other links. Atlas keeps the id as the link wrote it, in the editor too. A link written with a moment (@12) or a lens (?lens=) stays a link in the editor with both kept, rather than an element chip. When elements get new ids (making a world online, an import, or a merge), those links now move with them; before, they kept the old id and pointed at nothing.',
        tags: ['writing', 'fix'],
      },
      {
        id: 'share-scrub-every-address',
        title: 'A published page leaves out every link it does not show',
        body: 'A published page now takes out a link to any element or lens that is not on the page, however the link is written: with a moment or a lens, to another world, copied from onlyworlds.com, in capital letters, or with a type word Atlas does not read as a link. A link written as [label](...) becomes its label, with a title, an address in angle brackets or brackets inside the label too, and a bare address is left out. The name of an element that is not on the page is never written in its place; before, a bare address was replaced by the element\'s name, and a link could carry the id of a lens that was not on the page.',
        tags: ['sharing', 'fix'],
      },
      {
        id: 'import-ids-lowercase',
        title: 'An import writes a new element\'s id in lowercase',
        body: 'When an import makes a new element from a file whose id is written in capital letters, Atlas writes the id in lowercase, and every link to it in the same import follows, however the link spells the id. An element already in your world keeps its id exactly as it is. An incoming element whose id differs from one here only in capitals is that element, not a second copy, when their names agree or the file is this world\'s own; otherwise it gets a new id.',
        tags: ['folders'],
      },
      {
        id: 'light-theme-mark-and-names',
        title: 'In the light theme, the OnlyWorlds mark, the Web\'s small names and Create a world read more clearly',
        body: 'In the light theme, the OnlyWorlds mark in the sidebar footer is darker and stronger at rest, and still lifts under the pointer. The small names round the Web\'s centre, of the elements that link to it, are darker, and the Create a world button darkens under the pointer instead of turning paler, so its white word stays easy to read. The dark theme is unchanged.',
        tags: ['layout'],
      },
      {
        id: 'paste-address-as-prose',
        title: 'A pasted address ends where the address ends',
        body: 'Pasting an OnlyWorlds address with words straight after it, such as a comma and the next word, now opens it. A link cut short or written in capitals is still refused in words.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.124.1',
    date: '2026-11-14',
    theme: 'The maps tree in the standard\'s groups, an empty list said in words, and an icon safe to mask',
    entries: [
      {
        id: 'map-tree-standard-groups',
        title: 'The maps tree orders maps in the groups the standard names',
        body: 'Under a map, the maps whose parent map is that map come first, then the maps Atlas places there by their location, each location\'s maps together. At the top of the list, the world\'s own maps come first, then maps of a place with no map above them, then maps whose parent map is missing. The hierarchy number orders the maps inside each group, as the OnlyWorlds standard now says, and dragging a map in the list reorders it within its own group. Before, one sort by the number mixed the groups. When two places are each set inside the other, the list of their maps now draws, with every map in it once; before, it could not draw.',
        tags: ['maps'],
      },
      {
        id: 'empty-list-in-words',
        title: 'A custom field holding an empty list says so',
        body: 'A custom field written by another tool that holds an empty list now reads "an empty list" on the element\'s page, and an empty group of fields reads "an empty set of fields". Before, it showed the raw [] or {}. It is still shown: an empty list can be true, such as nothing amended yet.',
        tags: ['editor'],
      },
      {
        id: 'icon-safe-to-mask',
        title: 'The installed app\'s icon keeps its whole ring',
        body: 'An installed Atlas now has an icon made for phones that crop icons to a circle or a rounded square: the OnlyWorlds mark sits inside the crop on Atlas\'s dark ground. Before, the crop cut off the ring. The OnlyWorlds mark in the sidebar footer is also easier to see at rest, in the dark and the light theme, so it reads as clearly as the buttons beside it.',
        tags: ['layout'],
      },
      {
        id: 'sdk-4-162-standard-00-34-01',
        title: 'A downloaded world names the standard 00.34.01',
        body: 'Atlas moves to the newest OnlyWorlds SDK, which carries the standard\'s version 00.34.01. Its one change is the description of a map\'s hierarchy, and the text Atlas shows when you hover the field\'s name now says the same. A world downloaded from Atlas now names this version.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.124.0',
    date: '2026-11-13',
    theme: 'The OnlyWorlds mark in true curves, the most detailed map first, and new ids that reach every link',
    entries: [
      {
        id: 'sdk-4-160-mark-in-curves',
        title: 'The OnlyWorlds mark beside a name is drawn in true curves',
        body: 'Atlas moves to the newest OnlyWorlds SDK. The mark beside a world\'s or an element\'s name is drawn with exact curves instead of short straight lines, so it stays smooth at any size. A Character\'s records name Subs by its name, and the mark\'s Open with list can offer Subs beside a Character and the OnlyWorlds mapper beside a world. Beside an element whose id is written in capital letters (such ids come only from files made elsewhere) the mark is drawn with no Open with rows, since no address can name it.',
        tags: ['world'],
      },
      {
        id: 'ow-icon-in-curves',
        title: 'Atlas\'s OnlyWorlds icon is the same smooth drawing',
        body: 'The OnlyWorlds icon in the sidebar footer, the browser tab and the installed app is redrawn from the same true curves. It looks the same at a glance and is crisper at small sizes.',
        tags: ['layout'],
      },
      {
        id: 'map-pick-deepest-first',
        title: 'A place\'s maps list the most detailed map first',
        body: 'When a place or a zone has several maps, its map buttons and the doors into its maps now put the map nested deepest under other maps first. Among maps at the same depth, a lower hierarchy number comes first, as it does in the maps tree. Before, the highest hierarchy number came first.',
        tags: ['maps'],
      },
      {
        id: 'times-as-instants',
        title: 'Times are compared as exact instants',
        body: 'The list of tools that wrote an element now compares its times to the microsecond, as other OnlyWorlds tools do, so a newer write within the same millisecond is no longer taken for the one already read. In the writing tree, two narratives set under each other that tie on everything else are now told apart by id in one fixed order, whatever your language settings.',
        tags: ['sync'],
      },
      {
        id: 'home-grid-times-as-instants',
        title: 'Home\'s grid reads when an element was made to the microsecond',
        body: 'Home\'s grid places elements in the order they were made. Two made within the same millisecond now keep their true order, and a creation time written in another form now counts as unknown: a date alone, a time without its seconds, a space in place of the T, or an offset without its colon (+0200 for +02:00). In a folder another tool wrote that way, those elements move to the front of the grid once. An element with no readable time still stands first, so a new element never moves the others, and the line about the newest element linked to nothing never names one with no readable time. Home\'s suggestions, which name the newest place or character, Home\'s list of what you edited last, and a Character\'s older battles read times the same way, so a time written with another offset sorts where it truly falls.',
        tags: ['home'],
      },
      {
        id: 'rekey-nested-x-ids',
        title: 'New ids reach links kept deep inside custom fields',
        body: 'When elements get new ids (making a world online, an import, or a merge), a link to one of them kept inside a custom x_ field\'s nested values now moves too. A laid-out map keeps standing on its ground map, where before it lost it, and a game record keeps the seat it names for each Character (such as "as General").',
        tags: ['sync', 'fix'],
      },
      {
        id: 'folder-format-0-3-22',
        title: 'New world folders are format 0.3.22',
        body: 'Atlas writes new world folders as format 0.3.22, the newest version of the OnlyWorlds folder format. No file changes its shape.',
        tags: ['folders'],
      },
    ],
  },
  {
    version: '1.123.27',
    date: '2026-11-12',
    theme: 'A link to an element waits for your answer',
    entries: [
      {
        id: 'open-landing-waits-for-answer',
        title: 'An element link still lands on its element when you answer later',
        body: 'A link to one element of a world opens that world and then shows the element. If you took more than fifteen minutes to answer Atlas\'s question to open the world, it opened at its home and the element was not shown. The wait now starts again when you press Open.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.123.26',
    date: '2026-11-12',
    theme: 'A world\'s own settings go online when it opens',
    entries: [
      {
        id: 'world-settings-at-open',
        title: 'Settings in world.json go up at open, not at the next edit',
        body: 'When a world opens, Atlas now sends the settings its world.json holds that onlyworlds.com does not have yet: its description and time settings, and its own x_ keys such as a time unit. Two cases waited before: a world just made online, whose settings stayed in the folder, and a world.json changed by another tool while Atlas was closed. Both waited until you changed an element.',
        tags: ['sync'],
      },
      {
        id: 'web-backlink-label-contrast',
        title: 'The small Web\'s labels for links in are easier to read',
        body: 'On a world\'s home, the names of the elements that link to the one in the middle of the small Web were faint enough to fall under the contrast a reader needs. They are a step stronger now, beside the names it links to.',
        tags: ['ui'],
      },
    ],
  },
  {
    version: '1.123.25',
    date: '2026-11-11',
    theme: 'A review mark names only someone still in the world',
    entries: [
      {
        id: 'review-mark-removed-member',
        title: 'A mark that names a former member says no name',
        body: 'A proposed element\'s line names the person its review mark records only when Atlas can place them. Someone removed from the world is no longer one of its members, so a mark that records them now says no name, as for any value Atlas cannot place; the value stays in the mark itself. A Character of the world with that id is still named.',
        tags: ['sync'],
      },
      {
        id: 'review-mark-id-spellings',
        title: 'A mark\'s id is read the way OnlyWorlds reads it',
        body: 'Atlas matched a review mark\'s id to a member in more spellings than OnlyWorlds itself reads, such as a doubled "urn:" prefix or hyphens in odd places. It now reads the same four as OnlyWorlds: the id as given, without hyphens, in one pair of braces, or after "urn:uuid:". Any other spelling names nobody.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.123.24',
    date: '2026-11-11',
    theme: 'A message reads its words first, and a review mark says only what it holds',
    entries: [
      {
        id: 'review-mark-names',
        title: 'A proposed element says whom its mark names, never who proposed it',
        body: 'A review mark records the writer\'s own word for who made it, which is a claim and not proof. The line on a proposed element now reads "Proposed and not yet reviewed", then "The mark names Ada" only when Atlas can place the name: a member of the online world, with its kind if it is an AI\'s seat or a player\'s seat, the world\'s owner, or a Character of the world. Any other value is left in the mark itself, and Atlas no longer says "a member" when it cannot tell. This replaces the "Proposed by Name, a player" wording of 1.123.23.',
        tags: ['sync'],
      },
      {
        id: 'message-story-leads',
        title: 'A message shows its words right under its description',
        body: 'A message keeps its words in its story, and the story row used to sit lower down the page with the other story fields. On a message the story now stands right after the description, below From and To. Other stories keep their order.',
        tags: ['editor'],
      },
    ],
  },
  {
    version: '1.123.23',
    date: '2026-11-11',
    theme: 'Review marks: who made them, and who may send them',
    entries: [
      {
        id: 'proposed-by-player',
        title: 'A proposal from a player says so',
        body: 'An element proposed by a player in an online world now reads "Proposed by Name, a player," as one proposed by an agent already said "an agent". A player names itself, so the kind beside the name tells you what wrote it. One proposed by the world\'s owner says "Proposed by the world\'s owner".',
        tags: ['sync'],
      },
      {
        id: 'review-mark-by-another',
        title: 'A review mark made by someone else no longer stops the sync',
        body: 'In an online world where you are a contributor, OnlyWorlds now takes a review mark (proposed or checked) only with your own name on it. An element whose mark was made by someone else used to stop the whole sync with a message about your PIN. Now only that element waits, Settings, under This world, says why (the owner or a co-builder can send such a mark), and the rest syncs.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.123.22',
    date: '2026-11-10',
    theme: 'Who checked an element stays as it was',
    entries: [
      {
        id: 'checked-mark-kept',
        title: 'Saving an element no longer sends who checked it',
        body: 'When someone with the right to check marks an element as checked on onlyworlds.com, Atlas keeps that mark as it is: saving an edit sends your changes and never an older copy of the check, so a save after the check can no longer undo it or be refused for it.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.123.21',
    date: '2026-11-10',
    theme: 'A picture can be a file on an element',
    entries: [
      {
        id: 'image-files',
        title: 'An image can be added to an element as a file',
        body: 'In an online world, the Files section of an element now takes images too: png, jpg, webp and avif, up to 25 MB each, as OnlyWorlds now keeps them.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.123.20',
    date: '2026-11-10',
    theme: "A room's reports stay with the room",
    entries: [
      {
        id: 'room-reports',
        title: "A report the parlor's room left stays with the room",
        body: "A report a talk in the parlor's room left behind is now part of the room: hidden from the lists, Charts and Search with its messages and work items until you show the room. A story that is simply called a report stays in the world.",
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.123.19',
    date: '2026-11-10',
    theme: "A report's key is kept for it",
    entries: [
      {
        id: 'report-keys-kept',
        title: "The report profile's key is kept for it",
        body: 'Custom field names that start with x_report_ are kept for the report profile other tools read: shown read only, never typed as a custom field. When a world gets new ids, the work items a report answers follow them, as its other links do.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.123.18',
    date: '2026-11-10',
    theme: 'A pin you place by hand stays put',
    entries: [
      {
        id: 'layout-hand-pin',
        title: 'A pin you place or move on a laid-out map is marked as placed by hand',
        body: 'On a map laid out by a method, a pin you place, create or drag in Atlas is now marked as placed by hand, so the next time the map is laid out again it stays where you put it. A pin\'s page shows the mark as a card, and removing it lets the layout place that pin again. On an ordinary map nothing changes: every pin there is yours already.',
        tags: ['maps'],
      },
    ],
  },
  {
    version: '1.123.17',
    date: '2026-11-09',
    theme: 'A laid-out map stands on its ground',
    entries: [
      {
        id: 'layout-ground-underlay',
        title: 'A laid-out map draws its ground map under its pins',
        body: 'A map laid out by a method names the map it stands on. When the laid-out map has no picture of its own, Atlas now draws that ground map under its pins: its picture, and its rivers, roads and regions as faint lines and areas, where the layout placed them. A map with its own picture keeps it. The card on the map\'s page says when the ground is drawn.',
        tags: ['maps'],
      },
    ],
  },
  {
    version: '1.123.16',
    date: '2026-11-09',
    theme: 'A laid-out map says how',
    entries: [
      {
        id: 'layout-recipe-card',
        title: 'A map laid out by a method says how its pins were placed',
        body: 'Some maps are laid out by a method rather than by hand: each pin placed by a rule, on the ground of another map. Such a map\'s page used to show the method\'s recipe as raw data under Custom fields. It now reads as a short card: the method, the map it stands on, and that Atlas draws the map flat. The recipe as written is one press away, and Atlas never rewrites it.',
        tags: ['maps'],
      },
    ],
  },
  {
    version: '1.123.15',
    date: '2026-11-09',
    theme: 'One name for a published page',
    entries: [
      {
        id: 'published-page-words',
        title: 'Pages call what they publish a published page, at its own address',
        body: 'The Pages room named one published thing four ways: a public page, a published page, a public link and a public URL. It now says a published page, and where it lives is its address. "Public page" is kept for a world\'s own page on onlyworlds.com, the one Settings links to.',
        tags: ['copy', 'pages'],
      },
    ],
  },
  {
    version: '1.123.14',
    date: '2026-11-08',
    theme: 'A world opens whole',
    entries: [
      {
        id: 'open-store-and-world-together',
        title: 'Opening a world moves its data and its name on screen in one step',
        body: 'When a world was opened from OnlyWorlds, a world file or a link, there was a brief moment where its data had arrived while the screen still named the world before it. The two now change in one step.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.123.13',
    date: '2026-11-08',
    theme: 'Each world keeps its own',
    entries: [
      {
        id: 'write-after-world-switch',
        title: 'A change that finishes after you switch worlds stays in its own world',
        body: 'When a change (a new element, an edit, a delete, a pin moved) was still being saved as you opened another world, the world you left could show its elements in the new one\'s lists and pickers until the next refresh. The change is still saved where you made it; the world on screen now shows only its own.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.123.12',
    date: '2026-11-08',
    theme: 'A book under its own chapter',
    entries: [
      {
        id: 'writing-parent-cycle',
        title: 'A book set under its own chapter stays in the writing room',
        body: 'A narrative\'s Containing narrative can name any narrative, even one below it. When a book was set under its own chapter, both left the writing room\'s tree with everything under them, and opening either one stopped the room. The tree now keeps them: the highest of the two stays at the top, the other under it, and the compiled view reads them once. Nothing in the world is changed.',
        tags: ['writing', 'fix'],
      },
    ],
  },
  {
    version: '1.123.11',
    date: '2026-11-08',
    theme: 'A zone\'s markers where they are',
    entries: [
      {
        id: 'zone-marker-buttons-read-now',
        title: 'A zone\'s marker buttons use the marker as it is now',
        body: 'On a zone\'s page, a marker\'s Delete asked about its point and Pan went to it as the list had drawn them, so a marker moved at the moment you pressed was named, or panned to, at its old place. Both now read the marker when you press. Delete always removed the right marker.',
        tags: ['maps', 'fix'],
      },
    ],
  },
  {
    version: '1.123.10',
    date: '2026-11-08',
    theme: 'Back means back',
    entries: [
      {
        id: 'element-page-follows-back',
        title: 'Back with a field selected shows the element you went back to',
        body: 'Going back (a mouse\'s back button, Alt and Left) while a field on an element\'s page was selected kept the old element on the page under the new one\'s name in the address and the list, its Delete button included, until you clicked elsewhere. The page now follows at once, and what you had typed in the field is saved first.',
        tags: ['editor', 'fix'],
      },
    ],
  },
  {
    version: '1.123.9',
    date: '2026-11-08',
    theme: 'A press on an element that lands',
    entries: [
      {
        id: 'element-page-keeps-press',
        title: 'A press on an element\'s page no longer lost to a change elsewhere',
        body: 'An element\'s page redrew whenever anything in the world changed (another element saved, a sync marking this one as sent, the folder edited outside Atlas), so a press on its name, a field or a link that fell on that moment did nothing. The page now waits for the press to finish. A change to the element you are on still shows at once, so you never edit a value someone else has just replaced.',
        tags: ['editor', 'fix'],
      },
      {
        id: 'rename-escape-keeps-change',
        title: 'A change that arrives while you rename shows when you stop',
        body: 'A change that arrived while you were renaming an element waited for the rename to end, and a rename ended with Escape or left unchanged dropped it until the next change. It now shows as soon as the rename closes.',
        tags: ['editor', 'fix'],
      },
    ],
  },
  {
    version: '1.123.8',
    date: '2026-11-08',
    theme: 'One key per world',
    entries: [
      {
        id: 'lost-mint-taken-back',
        title: 'A key whose answer was lost is taken back',
        body: 'When Atlas makes a world\'s key from your account and the answer never arrives (the connection drops at that moment), OnlyWorlds had still made the key, and trying again made a second. Atlas now asks OnlyWorlds which key that try made and takes it back, so your account\'s keys page keeps one key for this browser, not a spare nobody holds.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.123.7',
    date: '2026-11-08',
    theme: 'A press on a file that lands',
    entries: [
      {
        id: 'files-card-keeps-press',
        title: 'Download and Remove on a file no longer lost to a late read',
        body: 'An element\'s Files card redrew itself whenever a read landed (its list, the world\'s total, another file\'s upload), so a press on Download or Remove that fell on that moment did nothing. The card now waits for the press to finish before it redraws.',
        tags: ['files', 'fix'],
      },
      {
        id: 'files-try-again-reads',
        title: 'Try again on the Files card reads the files at once',
        body: 'When the files could not be read, Try again did nothing for a minute after the failed read. It now asks OnlyWorlds again straight away.',
        tags: ['files', 'fix'],
      },
    ],
  },
  {
    version: '1.123.6',
    date: '2026-11-08',
    theme: 'A click that lands',
    entries: [
      {
        id: 'quiet-sync-keeps-list',
        title: 'A click in the element list no longer lost to a sync check',
        body: 'In a world synced with OnlyWorlds, every check for changes redrew the element list and the open element, even when nothing had changed, so a click that fell on that moment did nothing. A check that finds nothing new now leaves both as they are.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.123.5',
    date: '2026-11-07',
    theme: 'The next step, said where it is',
    entries: [
      {
        id: 'make-online-new-ids-button',
        title: 'Give new ids from the Make online message',
        body: 'When Make online cannot upload elements because their ids already belong to another OnlyWorlds world, its message now carries a Give new ids button, as the sync message does, and says where the fix lives: Settings, under This world.',
        tags: ['sync', 'fix'],
      },
      {
        id: 'held-seat-middle',
        title: 'A world waiting to download is named on the first screen',
        body: 'When the only world in the list is one you joined by a link and have not downloaded yet, the middle of the screen now says it waits in the sidebar and that pressing it downloads it. It used to say to make a world.',
        tags: ['worlds', 'fix'],
      },
    ],
  },
  {
    version: '1.123.4',
    date: '2026-11-07',
    theme: 'What the first steps did, kept',
    entries: [
      {
        id: 'whole-strand-asks-copy',
        title: 'A whole strand asks you to keep a copy',
        body: 'A world that lives only in this browser, with no copy online or exported, now asks for a copy once its strand is whole, however small the world is. The first steps used to ask this as their last step; since they made way for the strand, a small world went unasked until it held 25 elements or a written scene.',
        tags: ['home', 'onboarding'],
      },
      {
        id: 'skip-to-the-strand',
        title: 'Skip to the strand',
        body: 'While Home\'s strand asks for something, the first press of Tab offers Skip to the strand, which goes straight to the question past the toolbar and the lists. In a new world it reaches the story\'s name.',
        tags: ['home', 'onboarding'],
      },
      {
        id: 'notes-speak-after-old-card',
        title: 'Notes speak again in worlds where the old first steps card was closed',
        body: 'Closing the old first steps card with its × also kept every small note quiet in that world, and the way to undo it went with the card. That close no longer silences anything.',
        tags: ['home', 'fix'],
      },
    ],
  },
  {
    version: '1.123.3',
    date: '2026-11-07',
    theme: 'A wrong PIN makes no world',
    entries: [
      {
        id: 'make-online-wrong-pin',
        title: 'Make online checks your PIN before it makes the world',
        body: 'With Create new, a mistyped PIN used to make the world on your account and then fail to send its elements, leaving an empty world behind. Atlas now sends the PIN with the request to make the world, so OnlyWorlds checks it first: a wrong PIN says so and nothing is made.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.123.2',
    date: '2026-11-07',
    theme: 'Make online sends a copied world',
    entries: [
      {
        id: 'make-online-copied-world',
        title: 'Make online sends the elements of a copied world',
        body: 'A world copied from OnlyWorlds, such as the Moppetopia copy from Explore Moppetopia or a world file saved from an online world, made online with Create new sent none of its elements: Atlas said 0 elements uploaded and linked it to an empty world. Its elements now go up. When their ids already belong to another OnlyWorlds world, as the Moppetopia copy\'s do, Atlas says so, they stay in your copy, and Settings can give them new ids. While an id update in the world is unfinished, Create new now says to finish or undo it first, instead of making an empty world.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.123.1',
    date: '2026-11-06',
    theme: 'A clearer arrival from a link',
    entries: [
      {
        id: 'public-link-asks-in-the-middle',
        title: 'A link to a public world asks in the middle of the page',
        body: 'A link that opens a public world now asks in a card in the middle of the page, with Not now beside Open, instead of in a small message in a corner. On a touch screen, the buttons on a message and on this card are now large enough for a finger. The line that says the copy opened puts the world\'s name in quotes, and so do the copy\'s lines on Home and in the list of worlds. A chapter\'s compiled view now shows only the stories in the book\'s outline, so a story kept outside it, such as a telling under a scene, no longer repeats inside the chapter or adds to its word count. Give such a story a writing label, such as Scene, to bring it back.',
        tags: ['world', 'writing'],
      },
    ],
  },
  {
    version: '1.123.0',
    date: '2026-11-06',
    theme: 'Open a public world from a link',
    entries: [
      {
        id: 'public-world-open-link',
        title: 'A link opens a public world, with no account',
        body: 'A link to open a world in Atlas now works without an account when the world\'s owner has made it public on OnlyWorlds. Atlas asks first, then brings the world into this browser as a view-only copy: you can read and explore what its owner made public (hidden elements and files are left out), and nothing goes back to OnlyWorlds. If the world is yours, Sign in opens it as your own instead. The same link again opens the copy you already have, and says so if the world is no longer public.',
        tags: ['world'],
      },
      {
        id: 'open-link-writing-room',
        title: 'A link can open the writing room on a chapter',
        body: 'A link can now open a world straight into its writing room, on one chapter or scene or at the start, and it still lands there after you sign in with OnlyWorlds on the way.',
        tags: ['writing'],
      },
      {
        id: 'view-only-writing-without-setup',
        title: 'A view-only world reads its stories without the writing setup',
        body: 'A world you can only read stopped at "Set up writing" when one of its stories carried a label of its own. When the usual Book, Chapter and Scene labels read its stories, the writing room now opens straight onto them, and the other stories stay outside the outline. Writing settings still brings the setup back.',
        tags: ['writing'],
      },
    ],
  },
  {
    version: '1.122.2',
    date: '2026-11-05',
    theme: 'Links a screen reader hears as links',
    entries: [
      {
        id: 'link-buttons-heard-as-links',
        title: 'Links in a sentence that take you somewhere are announced as links',
        body: 'Words drawn as a link inside a line, such as a strand line\'s "the writing room" or "Their page", a box\'s name, "the Web", "Pick on Home" or "Open Settings, OnlyWorlds", were announced as buttons by a screen reader. Each one that takes you to a page, a room or a tab is now announced as a link, and Enter opens it. Those that act where you are, such as Undo, Copy our prompt or Create a map, stay buttons.',
        tags: ['accessibility'],
      },
    ],
  },
  {
    version: '1.122.1',
    date: '2026-11-04',
    theme: 'Home keeps your place',
    entries: [
      {
        id: 'home-keeps-scroll-on-redraw',
        title: 'Home keeps your place when it redraws',
        body: 'Scrolled down on Home, a change arriving from elsewhere, making a part of the strand or hiding one of its lines could throw the page back toward the top. Home now keeps your place through each of these, as it already did when you switched between Picture and Strand. Opening another world still starts at the top.',
        tags: ['home'],
      },
    ],
  },
  {
    version: '1.122.0',
    date: '2026-11-03',
    theme: 'The strand says what each part is for',
    entries: [
      {
        id: 'strand-lines-above-boxes',
        title: 'A short line above each part of the strand takes you where it can grow',
        body: 'On the Strand tab the story, the event, where it happened and the main character each have an italic line above their box, and the words in it are the link: "In the writing room you can shape it into chapters and scenes.", "Their page holds everything about them.", "Give it a date to place it on the timeline in Charts." (once the event has a date: "Its year puts it on the timeline in Charts."), and "Create a map to pin it in place." or "Pin it on a map." for the location. The story\'s line goes once you open the writing room on it, the main character\'s once you open their page, the location\'s once it is pinned on a map, and any line when you press its ×, only in this world and this browser. The space a line took stays until you next open Home, so nothing below it moves. Readers who cannot change an element see no line.',
        tags: ['home'],
      },
      {
        id: 'strand-box-buttons',
        title: 'Each box keeps its actions in its ⋯ menu',
        body: 'A box on the Strand tab no longer has a row of buttons under it. Its name still opens its page (a story kept in the writing room, Knowledge or Pages opens there), and the ⋯ beside the name holds Edit here (in place, as before), the room that edits it (Edit in the writing room for the story, Edit in Charts for the event, Pin it on a map for where it happened, or Create a map while the world has none, with nothing filled in), Open its page for a story whose name opens its room, then Use another. Someone who can only read the world finds Open in the writing room and Open its page on such a story, and See it in Charts on an event with a date.',
        tags: ['home'],
      },
      {
        id: 'home-tabs-keep-scroll',
        title: 'Switching between Picture and Strand keeps your place on Home',
        body: 'Pressing Picture or Strand on Home used to throw the page back toward the top. Home now stays where you had scrolled it, or at the end of the shorter tab when the new one is shorter.',
        tags: ['home'],
      },
      {
        id: 'strand-whole-rows-close',
        title: 'Once the strand is whole, its rows close up',
        body: 'While the Strand tab still asks, each row keeps its height so the boxes already made stay put. Once the last part is made there is nothing left to ask, so the rows now close up in a short slide (at once if your system reduces motion), leaving no empty band between the event and the main character.',
        tags: ['home'],
      },
      {
        id: 'strand-card-words',
        title: 'Each question on the Strand tab says what its kind of element is for',
        body: 'Under each question one line now says what it asks for: "Narratives are stories or tellings of any kind.", "Characters drive your stories: start with its main character.", "Events are happenings of any size, each a part of a larger story.", "Locations are where your stories happen." The event\'s question is always "What happens in" the story, and the last one asks "Where is" the main character now, noting that the event may be long past.',
        tags: ['home'],
      },
      {
        id: 'strand-born-founded',
        title: 'Born and Founded on the main character\'s and the location\'s cards',
        body: 'The main character\'s card has an optional Born and each location\'s card an optional Founded, read in your world\'s calendar as the event\'s When is. Edit here shows and changes them, and their boxes say "Born" or "Founded" under the text. A date given puts the element on the timeline in Charts, and a location\'s Founded also hides its pin before that date on the map\'s date bar.',
        tags: ['home'],
      },
      {
        id: 'open-with-tangle',
        title: 'Tactical Tangle is in the OnlyWorlds mark\'s Open with',
        body: 'In a world on OnlyWorlds, the mark beside the world\'s name on Home and beside a character\'s name on their page now offers Tactical Tangle among the tools that open it.',
        tags: ['sharing'],
      },
      {
        id: 'writing-empty-book-tiers',
        title: 'An empty book in the writing room says how narratives nest',
        body: 'Before a book has its first chapter, the line at its top now reads "Narratives nest as books, chapters and scenes, and you can rename these tiers in Settings. Press + to add the first.", in your world\'s own names for the three tiers.',
        tags: ['writing'],
      },
      {
        id: 'strand-event-no-character',
        title: 'Making the event no longer adds the main character to it',
        body: 'The main character is the story\'s, and the event keeps only what you put in it, whichever you make first. Worlds that already have the character in the event keep it. When the main character is now where the event happened, the story always says they are still there.',
        tags: ['home'],
      },
    ],
  },
  {
    version: '1.121.2',
    date: '2026-11-03',
    theme: 'The boxes stay where they are',
    entries: [
      {
        id: 'strand-rows-keep-their-height',
        title: 'Making the next part of a story no longer moves the boxes already made',
        body: 'On Home\'s Strand tab, making the Event or the location pulled the main character\'s box below it up the page, since the question gave way to a shorter box. Each row now keeps its height until you next open Home, so the boxes stay put, and none of them jumps for a moment while a part is being made.',
        tags: ['home'],
      },
    ],
  },
  {
    version: '1.121.1',
    date: '2026-11-03',
    theme: 'Still there, or somewhere else',
    entries: [
      {
        id: 'now-card-somewhere-else',
        title: 'Asked whether the main character is still there, the card says both answers',
        body: 'Under "Still at" the card now says "Or somewhere else:" before the fields for a new location, so Create reads as making the new place, not as a yes.',
        tags: ['home'],
      },
    ],
  },
  {
    version: '1.121.0',
    date: '2026-11-02',
    theme: 'The strand draws in its own shape',
    entries: [
      {
        id: 'strand-on-the-picture',
        title: 'The story and its parts stand first on Home\'s Picture, in the same places every time',
        body: 'The story sits at the top left, its event under it with the location beside it, the main character under the event with where they are now beside them. Everything else in the world starts beside and below them, and no line runs through a square or a name, at a larger browser font too. While the story itself is hidden, the Picture is drawn as before.',
        tags: ['home'],
      },
      {
        id: 'picture-hold-line',
        title: 'Something standing under another is joined to it by one short line',
        body: 'A character under their location, or an event under its story, was joined by a rail down the side of the column with a tick to each one. Each now has one straight line from the square above it.',
        tags: ['home'],
      },
      {
        id: 'strand-boxes-open-rooms',
        title: 'Each part of the strand says where it goes next',
        body: 'On the Strand tab every filled box has one line under its text with a way there: the story opens in the writing room, an event with a year on the timeline, a location with the map (where you can pin it), a character on their page. Back returns to the same box.',
        tags: ['home'],
      },
      {
        id: 'empty-book-line',
        title: 'A book with no chapters yet says what a chapter can be',
        body: 'Open a book in the writing room before it has a chapter and one line at the top says a chapter can be any part you like, in your world\'s own words for its parts. It goes once the first one exists.',
        tags: ['writing'],
      },
      {
        id: 'story-card-holds-still',
        title: 'The story\'s box keeps room for its second line',
        body: 'Once the story\'s box has its first line, it keeps room for the second while that one can still come, so creating the event no longer pushes the boxes below it down.',
        tags: ['home'],
      },
      {
        id: 'strand-asks-who-first',
        title: 'A new world asks who its story is about before what happens',
        body: 'The strand\'s questions now come in this order: the story, who it is about, what happens to them, where it happened, and whether they are still there. The event you then create or pick lists the main character among its characters. The button on each question now says Create.',
        tags: ['home'],
      },
      {
        id: 'first-element-click-to-edit',
        title: 'Your first element says how to open it',
        body: 'In Home\'s recent list, the line under a world\'s first element now reads "click here to edit".',
        tags: ['home'],
      },
    ],
  },
  {
    version: '1.120.2',
    date: '2026-11-02',
    theme: 'Open with, for a reader without an account',
    entries: [
      {
        id: 'keep-safe-after-the-strand',
        title: 'A new browser world asks for a copy once its story is whole',
        body: 'The card that says this world lives only in this browser showed as soon as the story had its first words. It now waits until the story, its event, the location and the main character are all filled in, unless the world has another written story, a map with a picture, or 25 elements.',
        tags: ['onboarding'],
      },
      {
        id: 'strand-says-location',
        title: 'The story journey says location, the name of the type',
        body: 'The journey\'s questions called a Location a place. They now say location, as everywhere else in Atlas.',
        tags: ['home'],
      },
      {
        id: 'open-with-needs-an-account',
        title: 'A world opened with a read key or a player\'s link lists every tool in Open with',
        body: 'The OnlyWorlds mark\'s Open with now shows Atlas as where you are, and Lantern greyed with the words Needs an account, since its link opens only for someone signed in. Before, both rows were left out for a reader without an account.',
        tags: ['sharing'],
      },
    ],
  },
  {
    version: '1.120.1',
    date: '2026-11-02',
    theme: 'Unlinked means unlinked',
    entries: [
      {
        id: 'unlinked-counts-links-out',
        title: 'A character with a link of their own is no longer listed as unlinked',
        body: 'Home\'s unlinked characters counted only the links pointing at a character, so someone whose only link was their own (a friend named on their page) was listed as unlinked while Home\'s grid drew them connected. Both now read one rule: a link out counts as much as a link in.',
        tags: ['home'],
      },
    ],
  },
  {
    version: '1.120.0',
    date: '2026-11-02',
    theme: 'The strand as a journey',
    entries: [
      {
        id: 'strand-journey',
        title: 'A new world\'s Home asks for its story, one question at a time',
        body: 'An empty world\'s Home is now the strand alone: it asks for a story (a name and its text), then one event in it, where that happened, who was involved and where they are now. Each answer becomes a box beside the one it joins, and the story\'s box says in two lines how the parts link, each name a chip that brings its box into view.',
        tags: ['home'],
      },
      {
        id: 'strand-journey-cards',
        title: 'Each step takes a name and a few lines, and can wait',
        body: 'Each card takes a name and a text, written where the kind keeps it (a story\'s text, everything else\'s description), and the event takes When. What you type stays while Home redraws, until you make it or press Escape. Skip for now sets a step aside; Add brings it back. Or pick one from your world appears when there is one to pick.',
        tags: ['home'],
      },
      {
        id: 'strand-journey-boxes',
        title: 'Edit a part in place, or use another from its menu',
        body: 'A filled box shows the first lines of its text, Edit opens it in place and saves only what you changed (if it changed meanwhile, nothing is written, Home says so and keeps what you typed for a second Save), and its menu holds Use another. Making or picking the main character on its step also lists them on the strand\'s event.',
        tags: ['home'],
      },
      {
        id: 'strand-plain-words',
        title: 'The strand\'s words: Event, Character, main character',
        body: 'The strand now says Event and Character, its main character and where they are now, and an event "happened in or at" its place. Picture and Strand appear as tabs once the world holds more than the strand, from the next time Home opens; Pick on Home beside the writing room asks for that very part.',
        tags: ['home', 'writing'],
      },
    ],
  },
  {
    version: '1.119.1',
    date: '2026-11-02',
    theme: 'Home stays on the strand',
    entries: [
      {
        id: 'new-world-story-keeps-strand',
        title: 'Making a new world\'s story keeps Home on the strand',
        body: 'In a new, empty world, making the story from Home\'s Strand tab switched Home to the Picture tab, and it stayed there. Home now stays on the strand you are filling.',
        tags: ['home'],
      },
    ],
  },
  {
    version: '1.119.0',
    date: '2026-11-02',
    theme: 'A place inside a ship',
    entries: [
      {
        id: 'location-vehicle',
        title: 'A Location can name the vehicle it is inside',
        body: 'A Location has a new link, Vehicle, right after Parent location: the Object a place is the inside of, such as a ship, a train or a walking city, so the place moves with it. A place inside another place still uses Parent location. The link is part of the OnlyWorlds standard from version 00.34.00, which a world downloaded from Atlas now names.',
        tags: ['editor'],
      },
      {
        id: 'records-review-mark-settled',
        title: 'A record whose review mark holds no proposal is listed',
        body: 'A game\'s run or story whose review mark is empty, or holds no proposal, now shows under the Character\'s Records, as the OnlyWorlds record rules read it. Only a real proposal holds one back.',
        tags: ['editor'],
      },
    ],
  },
  {
    version: '1.118.2',
    date: '2026-11-02',
    theme: 'A marker from another tool links one zone',
    entries: [
      {
        id: 'marker-both-spellings-one-zone',
        title: 'A marker or pin that names its map or zone twice links only the one the map draws',
        body: 'A file from another tool can name a marker\'s zone both as zone and as zone_id, with different values. The references, the Web and Home now read only the one the map draws, so the marker no longer shows under two zones, and its map is listed once.',
        tags: ['editor'],
      },
    ],
  },
  {
    version: '1.118.1',
    date: '2026-11-02',
    theme: 'Linked from, grouped by relationship, lists each link once',
    entries: [
      {
        id: 'linked-from-one-group-per-relationship',
        title: 'Linked from lists each relationship once, and no element twice',
        body: 'With Linked from grouped by relationship (Settings, Elements), an Event and a Character that both name a place as their location now share one Location of group. A Character already listed under Located here appears in Linked from only for its other links, such as Birthplace of.',
        tags: ['editor'],
      },
    ],
  },
  {
    version: '1.118.0',
    date: '2026-11-02',
    theme: 'References read the same links as the Web',
    entries: [
      {
        id: 'references-read-the-standard-links',
        title: 'Referenced by, Linked from and Home\'s loose threads read the links the standard names',
        body: 'An element\'s page lists what links to it by the same links the Web reads: the standard\'s link fields pointing at the right type, and the links a profile declares. Pins and markers still show under their map and zone, pages under Featured in, and a chapter\'s scenes under Mentioned in. A suggestion you dismissed in the writing room no longer lists the element under Mentioned in, and a reference an import kept under its own x_ name no longer counts as a link, so Home\'s loose threads count the same way.',
        tags: ['editor'],
      },
      {
        id: 'writing-cast-every-link',
        title: 'The writing pane\'s Cast holds every element the scene links',
        body: 'The protagonist, antagonist, narrator, conservator, zones and every other link of the scene now show in its Cast, and Suggested follows the same links of each cast member. The parent chapter stays in the writing sidebar.',
        tags: ['writing'],
      },
    ],
  },
  {
    version: '1.117.0',
    date: '2026-11-01',
    theme: 'The Web reads links the way every OnlyWorlds tool does',
    entries: [
      {
        id: 'web-reads-the-standard-links',
        title: 'The Web draws the links the standard names, and only those',
        body: 'The Web around an element now reads its links with the same reader the other OnlyWorlds tools use: each link field of the standard, pointing at an element of the type the field names, and the links a profile declares, such as a lens\'s next lens. A value that only looks like an id is no longer a line: the elements a page\'s blocks show (the page itself still lists them), a suggestion you dismissed, or a reference an import kept under its own x_ name. A link to an element of another type than its field asks for draws nothing. Proposed and hidden elements are still drawn and marked, pins and markers still join their map to what they place, and a chapter\'s scenes stay in the writing sidebar rather than the Web.',
        tags: ['web'],
      },
      {
        id: 'home-picture-ranks-by-the-web',
        title: 'Home\'s picture centres on what the Web draws most around',
        body: 'The element Home\'s picture is drawn around is now the one with the most around it in the Web itself. A world with many books and chapters no longer loses its picture to a book whose chapters the Web leaves to the writing sidebar.',
        tags: ['home'],
      },
      {
        id: 'mark-offers-only-tools-that-open-it',
        title: 'The OnlyWorlds mark offers only the tools that open this element',
        body: 'Beside a hidden, proposed or room element, the mark leaves out a tool whose element page would not show it, as the tools list says of each tool.',
        tags: ['editor'],
      },
    ],
  },
  {
    version: '1.116.1',
    date: '2026-11-01',
    theme: 'Records, read in one pass',
    entries: [
      {
        id: 'records-one-pass',
        title: 'A Character\'s Records draw quickly on a large world',
        body: 'The records are read in one pass over the world, however many runs a Character has, and two runs played at the same moment keep the same order in every tool.',
        tags: ['editor'],
      },
    ],
  },
  {
    version: '1.116.0',
    date: '2026-11-01',
    theme: 'Records: what a character did in a game',
    entries: [
      {
        id: 'character-records',
        title: 'A Character\'s page shows their Records',
        body: 'A game that keeps its runs in your world, such as a Tactical Tangle battle, marks each one, and the Character\'s page lists the runs they took part in, newest first, with the game, the day it was played, the outcome, their seat and the stories about them or told by them. A run still waiting for review shows once it is accepted. Battles Tactical Tangle wrote before the mark show below under their own heading.',
        tags: ['editor'],
      },
      {
        id: 'records-from-the-mark',
        title: 'Recorded from play is read from the mark, not the label',
        body: 'The quiet glyph in the element list and on the chart marks a run\'s Event from its record mark, for any game, and Tactical Tangle\'s older battles by their own battle data; it no longer marks the chronicle, the stories or the trophy, which are the ordinary elements they are. A story of yours labelled Chronicle now counts as your own story, while a story that names a run\'s Event belongs to that run: it shows under the Records of the Character it is about or told by, and is left out of Home\'s suggestions. Links written as objects with an id, as some other tools write them, do not count toward a record. The record mark, and any field of your own named Record, shows read only.',
        tags: ['editor'],
      },
    ],
  },
  {
    version: '1.115.2',
    date: '2026-11-01',
    theme: 'The OnlyWorlds mark: Little Lens, and the keyboard in Safari',
    entries: [
      {
        id: 'waymark-little-lens',
        title: 'The OnlyWorlds mark offers Little Lens',
        body: 'The list beside a world or an element name now offers Little Lens, which shows the world as a web of its elements and links and opens the same world or element there.',
        tags: ['sharing'],
      },
      {
        id: 'waymark-tab-safari',
        title: 'The OnlyWorlds mark\'s list takes Tab in Safari',
        body: 'With the list beside a name open, Tab now moves through its rows in Safari as it does in other browsers, and the list closes when focus leaves it.',
        tags: ['sharing'],
      },
    ],
  },
  {
    version: '1.115.1',
    date: '2026-10-31',
    theme: 'The OnlyWorlds mark, a little quieter',
    entries: [
      {
        id: 'waymark-smaller-new-tab',
        title: 'The OnlyWorlds mark beside a name is smaller, and its web links open in a new tab',
        body: 'The globe beside a world or an element name is now about the height of the name\'s capitals, with the same space to tap. A place it offers on the web opens in a new tab, so Atlas stays open behind it, and the row for Atlas itself is grey, as where you already are.',
        tags: ['sharing'],
      },
      {
        id: 'download-a-world-words',
        title: 'Download a world says whose key and PIN it asks for',
        body: 'Under a new world\'s Strand, the line beside Download a world now says it asks for the API key and PIN of a world on OnlyWorlds. It read as if the world in front of you already had them.',
        tags: ['home'],
      },
    ],
  },
  {
    version: '1.115.0',
    date: '2026-10-31',
    theme: 'A new world starts on its strand',
    entries: [
      {
        id: 'first-steps-are-the-strand',
        title: 'A new world starts on its strand, and the first steps card is gone',
        body: "Home no longer shows the five first steps (Step 1 of 5 and the rest), which stayed on any world whose events had no year. Every world's Home now has its Picture and Strand tabs from the first view, and a new world opens on Strand: its five boxes (Story, Happening, Where it happened, Hero, Where the hero is now) are where a world begins. Bring in a file sits under them while the world is empty.",
        tags: ['world', 'home'],
      },
    ],
  },
  {
    version: '1.114.3',
    date: '2026-10-31',
    theme: 'Four buttons in their place',
    entries: [
      {
        id: 'strand-charter-buttons-styled',
        title: 'The strand\'s and the charter\'s buttons look like Atlas again',
        body: "Make this the world's strand, Clear the strand, Mark as this world's charter and Retire it showed as the browser's own grey button, a different one in each browser, with a focus ring that was hard to see. They now wear Atlas's buttons: the first three the everyday one, Retire it the quiet one.",
        tags: ['world', 'writing'],
      },
    ],
  },
  {
    version: '1.114.2',
    date: '2026-10-31',
    theme: 'The strand says what it does',
    entries: [
      {
        id: 'strand-buttons-say',
        title: 'The strand\'s buttons say what they do',
        body: "On a story's page, Clear the strand takes the world's strand away, where it read Not the strand. Changing who fills a box now confirms with Replace and the name it replaces.",
        tags: ['world', 'writing'],
      },
    ],
  },
  {
    version: '1.114.1',
    date: '2026-10-31',
    theme: 'Where an element has been, whole',
    entries: [
      {
        id: 'door-trail-whole',
        title: 'The trail names every tool again after a sync',
        body: "An element's page says where it was last shaped on OnlyWorlds and the tools before that. After a change came in by sync it named only the last one; it now asks OnlyWorlds for the element when the page opens, so the whole trail shows.",
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.114.0',
    date: '2026-10-31',
    theme: "The world's strand",
    entries: [
      {
        id: 'world-strand',
        title: "Choose your world's strand",
        body: "Home has a Strand tab beside its picture: one story in five boxes, the story, a happening in it, where it happened, its hero and where the hero is now, each made or picked in place. A story's page and the writing room can make it the world's strand, and while you write it, its hero, happening and places sit beside the text.",
        tags: ['world', 'writing'],
      },
    ],
  },
  {
    version: '1.113.1',
    date: '2026-10-31',
    theme: 'The world kept whole in its file',
    entries: [
      {
        id: 'export-world-keys',
        title: 'Saving a world to a file keeps its own keys',
        body: 'Save to file and Copy JSON in the Data room now keep the extra keys a world carries, such as its own words for the element types, so bringing that file back in gives the world as it was.',
        tags: ['data'],
      },
    ],
  },
  {
    version: '1.113.0',
    date: '2026-10-30',
    theme: 'A quieter Home',
    entries: [
      {
        id: 'cast-retired',
        title: 'No protagonist or home place on Home',
        body: 'Home no longer shows a protagonist and a home place. Any you picked are kept in the world folder.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.112.1',
    date: '2026-10-30',
    theme: 'The mark offline',
    entries: [
      {
        id: 'waymark-offline',
        title: 'The OnlyWorlds mark without a connection',
        body: 'With no connection, the menu beside a name says which ways to open it need one and leaves them still, so a press never leads to a page that cannot load; Copy link still works. On a phone, the menu keeps clear of the home bar.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.112.0',
    date: '2026-10-30',
    theme: 'Open it elsewhere',
    entries: [
      {
        id: 'waymark-open-with',
        title: 'The OnlyWorlds mark beside a name',
        body: 'In a world on OnlyWorlds, the mark beside the world\'s name on Home and beside an element\'s name opens a short menu: open it on onlyworlds.com or in another tool, or copy its link. It shows who last shaped the element. The page on onlyworlds.com opens when you are signed in there, or for anyone when the world\'s public page is on; where neither is true, there is no mark.',
        tags: ['world'],
      },
      {
        id: 'home-grows-name-room',
        title: 'Room between a name and a line on Home',
        body: 'A square\'s name keeps clear of its column\'s edges, so a line running down between two columns never brushes a long name.',
        tags: ['world', 'layout'],
      },
    ],
  },
  {
    version: '1.111.1',
    date: '2026-10-30',
    theme: 'Quieter squares',
    entries: [
      {
        id: 'home-grows-quiet-press',
        title: 'A press on Home\'s squares reads cleanly',
        body: 'On a phone, pressing a square no longer flashes a filled box over it. While a press says what it would write, the step\'s own hint steps aside, so the card reads one thing at a time. Place and Undo are a thumb\'s size.',
        tags: ['world', 'layout'],
      },
      {
        id: 'home-grows-clear-lines',
        title: 'Lines on Home go around the squares',
        body: 'A link between two squares further apart runs above the row and down the gap between columns, so it never crosses another square or a name.',
        tags: ['world', 'layout'],
      },
    ],
  },
  {
    version: '1.111.0',
    date: '2026-10-30',
    theme: 'Every link a square can make',
    entries: [
      {
        id: 'home-grows-every-link',
        title: 'Link any two squares on Home that can be linked',
        body: 'On a small world\'s Home, drag a character onto an event, or any other pair OnlyWorlds links, and the line is drawn, with Undo. By presses, the first press on such a square says what it would write, with Place, so looking around never changes your world. Two squares that cannot be linked say so. With the keyboard, Tab moves through the squares a held one can go to.',
        tags: ['world'],
      },
      {
        id: 'home-grows-plain-plus',
        title: 'Add any kind from Home\'s + square',
        body: 'After the first steps, or wherever a step asks for nothing in particular, the + square says "add" and offers a character, a location, an event, a story or another kind. While the first steps are open, nothing above the squares moves as your world grows, and the steps\' card says what its button does when the world outgrows the squares.',
        tags: ['world', 'layout'],
      },
    ],
  },
  {
    version: '1.110.0',
    date: '2026-10-30',
    theme: 'A home that grows with your world',
    entries: [
      {
        id: 'home-that-grows',
        title: 'A new world grows on its Home, one square at a time',
        body: 'A new world opens straight on its first steps. Press the + square and type a name to make someone, somewhere, something that happened and a story. Drag a character onto a location, or press one and then the other, to put them there; the line under the picture says what changed, with Undo.',
        tags: ['world'],
      },
      {
        id: 'home-grid-picture',
        title: 'A small world draws as squares on Home',
        body: 'While a world is small, Home shows each element as a square in its colour, a character under the place it is in and an event under the story that tells it. A bigger world keeps the picture centred on its best-linked element.',
        tags: ['world', 'layout'],
      },
      {
        id: 'first-steps-again',
        title: 'Show the first steps again',
        body: 'Settings, World, brings the first steps back to Home after you closed them.',
        tags: ['world'],
      },
      {
        id: 'ids-carry-time',
        title: 'New elements get time-ordered ids',
        body: 'An element made in Atlas now gets an id that says when it was made, the kind onlyworlds.com already gives. Nothing you have changes.',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.109.3',
    date: '2026-10-30',
    theme: 'A lens reads only what its fields can hold',
    entries: [
      {
        id: 'lens-reads-by-target-type',
        title: 'A lens and the Web follow a link only to its own kind',
        body: 'A link that names an element of another kind than its field holds no longer draws a line or brings that element into a lens. A lens that points at something no longer in the world now counts it, and its line under the Web says missing or not yet accepted.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.109.2',
    date: '2026-10-30',
    theme: 'Enter makes it',
    entries: [
      {
        id: 'empty-world-enter-creates',
        title: 'Enter in an empty world\'s box makes the element',
        body: 'In a world with no elements yet, the box beside the element list is named Create an element. Pressing Enter there now opens New element with what you typed as its name, as the + beside it does. In a world with elements the box searches, as before.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.109.1',
    date: '2026-10-30',
    theme: 'Named for a screen reader',
    entries: [
      {
        id: 'element-box-name',
        title: 'The element list\'s box keeps its name while you type',
        body: 'The box beside the element list\'s + was named only by its placeholder, which a screen reader loses once text is typed. It now carries its own name, Search elements, or Create an element in an empty world.',
        tags: ['fix'],
      },
    ],
  },
  {
    version: '1.109.0',
    date: '2026-10-30',
    theme: 'A way back',
    entries: [
      {
        id: 'guide-room-bar',
        title: 'The chart and the writing room lead back to the first steps',
        body: 'When a new world\'s first steps send you to the chart or the writing room, the room now says which step you are on and offers Back to Grow your world, which returns you to the steps with Next ready.',
        tags: ['onboarding'],
      },
    ],
  },
  {
    version: '1.108.2',
    date: '2026-10-30',
    theme: 'By keyboard',
    entries: [
      {
        id: 'guide-skip',
        title: 'A new world\'s first steps are one Tab away',
        body: 'While a new world shows its first steps, the first press of Tab offers Skip to the first steps, which goes straight to them past the toolbar and the lists. The Web and Maps tabs show a clear ring when you reach them by keyboard.',
        tags: ['onboarding'],
      },
    ],
  },
  {
    version: '1.108.1',
    date: '2026-10-29',
    theme: 'Clearer steps',
    entries: [
      {
        id: 'guide-card-words',
        title: 'The first world\'s card says more plainly what each step does',
        body: 'The chart step says to open the chart before going on, the question about an Event names it, and the three ways to keep a copy each say where the copy goes. On a phone every button in the card, and Anything else, takes a thumb, and the step names no longer run together.',
        tags: ['onboarding'],
      },
      {
        id: 'world-file-without-author-fields',
        title: 'A world file leaves out who wrote each element',
        body: 'Download the whole world now leaves out the record of which member and which tool last wrote each element, as the JSON export already does: it means nothing to the person a file is handed to. The world itself keeps it.',
        tags: ['import'],
      },
    ],
  },
  {
    version: '1.108.0',
    date: '2026-10-29',
    theme: 'A first screen that leads',
    entries: [
      {
        id: 'first-screen-two-doors',
        title: 'A new world starts with two doors',
        body: 'An empty world now asks one question with two answers: Start from nothing, or Bring in a world I have. Each opens in place, and Back returns to the choice.',
        tags: ['onboarding'],
      },
      {
        id: 'guide-step-card',
        title: 'One card leads you through your first world',
        body: 'Under the five steps, one card says what to do now and holds the button for it. When a step is done, Next takes you on, so you choose when to move. The small notes stay quiet while the card leads, and the block keeps its place on the page.',
        tags: ['onboarding'],
      },
    ],
  },
  {
    version: '1.107.0',
    date: '2026-10-29',
    theme: 'Where it has been',
    entries: [
      {
        id: 'element-door-trail',
        title: 'An element says which tools last shaped it',
        body: 'In a world on OnlyWorlds, the foot of an element\'s page now says where it was last changed, such as in Atlas, in Lantern, on onlyworlds.com, in code or with an AI, and the tools before that, each with its time. It names tools, never people.',
        tags: ['sync'],
      },
      {
        id: 'export-without-author-fields',
        title: 'An export leaves out who wrote each element',
        body: 'A JSON export from the Data room no longer carries OnlyWorlds\' record of which member and which tool last wrote each element. That record describes the account world for its members and means nothing to whoever receives the file. Your world\'s folder keeps it.',
        tags: ['world'],
      },
      {
        id: 'icons-whole-again',
        title: 'Icons are whole again',
        body: 'Since 1.87.1 the icons in the room bar, the sidebar\'s type filters and a few other narrow buttons lost a sliver of their right side. They are drawn whole again.',
        tags: ['layout', 'fix'],
      },
      {
        id: 'link-icons-say-what-can-link',
        title: 'A link field shows whether there is anything to link',
        body: 'On an element\'s page, the icon at the end of an empty link field is now plainly brighter when the world has something to link there, and quieter when it has nothing yet. A click on the quiet one still makes one.',
        tags: ['editor'],
      },
    ],
  },
  {
    version: '1.106.2',
    date: '2026-10-29',
    theme: 'A copy stays a copy',
    entries: [
      {
        id: 'copy-stays-view-only-after-reload',
        title: 'A view-only copy stays view-only after a reload',
        body: 'Opening a world file as a copy beside its world and reloading within a moment could, in Firefox, open the copy again as an ordinary world you could edit. It now stays a view-only copy.',
        tags: ['world', 'fix'],
      },
      {
        id: 'folder-format-0-3-21',
        title: 'New world folders are format 0.3.21',
        body: 'Atlas moves to the newest OnlyWorlds SDK and writes new world folders as format 0.3.21, the version in which a world\'s files keep the record of which tools wrote each element.',
        tags: ['folders'],
      },
    ],
  },
  {
    version: '1.106.1',
    date: '2026-10-29',
    theme: 'A newer build',
    entries: [
      {
        id: 'vite-8-build',
        title: 'Atlas is built with Vite 8',
        body: 'Nothing you see changes. The first screen\'s scripts are about 5% smaller, and the offer to reload when a new version is ready is now checked against a real build before each release.',
        tags: ['performance'],
      },
      {
        id: 'doors-server-field',
        title: 'Which tools wrote an element stays OnlyWorlds\' own word',
        body: 'OnlyWorlds now records each tool that wrote an element. Atlas keeps that record as it arrives and never sends it back, a conflict never lists it as a change, and bringing in an online world\'s file no longer flags it as an unknown field on every element.',
        tags: ['sync', 'fix'],
      },
    ],
  },
  {
    version: '1.106.0',
    date: '2026-10-29',
    theme: 'Say what you cannot see',
    entries: [
      {
        id: 'message-someone-you-cannot-see',
        title: 'A message says when someone in it is hidden from you',
        body: 'When OnlyWorlds leaves out a sender or recipient your key may not see, the message\'s line now says "someone you cannot see" instead of "nobody", and never says who or how many.',
        tags: ['messages', 'sync'],
      },
      {
        id: 'lens-keep-held-back',
        title: 'The Lens list says why Keep a lens is not offered',
        body: 'In Moppetopia, a demo or a view-only world, the Lens list now says that Keep a lens works in a world of your own, or one you can write to.',
        tags: ['web', 'lens'],
      },
    ],
  },
  {
    version: '1.105.1',
    date: '2026-10-29',
    theme: 'The first screen\'s links take a thumb',
    entries: [
      {
        id: 'landing-links-thumb',
        title: 'Watch how it works and Other ways in take a thumb',
        body: 'On a phone, the two links under Create a world and Explore answer a tap over a strip about as tall as a fingertip, centred on their words. They look the same as before.',
        tags: ['layout'],
      },
      {
        id: 'tour-pin-two-clicks',
        title: 'The tour says both clicks that place the Consul\'s pin',
        body: 'At the map in Watch how it works, the step now says to click the + pin icon and then the map. The pin lands on that second click, and the step read as stuck to someone who stopped after the first.',
        tags: ['tour'],
      },
    ],
  },
  {
    version: '1.105.0',
    date: '2026-10-29',
    theme: 'Read your world through a lens',
    entries: [
      {
        id: 'web-lens',
        title: 'Read your world through a lens on the Web',
        body: 'The Web has a Lens choice: None, or any lens in your world, such as one made on the Lenses page of onlyworlds.com. With a lens chosen the Web shows what that lens keeps, and a line under it says how many it keeps and why the rest were left out. A lens\'s own page has Read this lens. The choice is kept on this computer for each world and never changes the world.',
        tags: ['web', 'lens'],
      },
      {
        id: 'keep-a-lens',
        title: 'Keep a lens on someone',
        body: 'On the Web of an element you opened, the Lens list offers Keep a lens on <name>. It saves a lens of that element and what links to it or from it, as a Construct in your world, and the Web reads through it at once. A world of forty or more elements with no lens yet says so once.',
        tags: ['web', 'lens'],
      },
      {
        id: 'home-picture-link-below',
        title: 'See a world\'s link answers a thumb under its words too',
        body: 'On a phone, the link above the picture on a world\'s home now answers a tap a little under its words as well as above them, where the picture\'s edge used to take it.',
        tags: ['home', 'layout'],
      },
      {
        id: 'calendar-odd-format',
        title: 'A calendar from another tool with an unusual format opens and saves',
        body: 'A calendar whose date format was set by another tool to something other than text now opens in the calendar builder with the format blank, prints dates in the default way, and saves without an error. The stored value stays until you type a format of your own.',
        tags: ['calendar', 'fix'],
      },
    ],
  },
  {
    version: '1.104.0',
    date: '2026-10-29',
    theme: 'Help for the room you are in',
    entries: [
      {
        id: 'help-room-by-room',
        title: 'Help shows the room you are in first',
        body: 'Help (the ? key, or Help in the sidebar) now opens wider on a desktop: the room\'s own lines on the left and the shortcuts that room uses on the right, so most rooms need no scrolling. The shortcuts for other rooms are folded under "Shortcuts in other rooms". On a narrow window the room\'s lines come first.',
        tags: ['help', 'layout'],
      },
      {
        id: 'home-picture-link-target',
        title: 'See a world\'s link is easier to tap on a phone',
        body: 'On a phone, the link above the picture on a world\'s home (in Moppetopia it reads See Puddle Navy\'s world) now answers a tap anywhere in a taller strip around its words. The words look as they did.',
        tags: ['home', 'layout'],
      },
    ],
  },
  {
    version: '1.103.0',
    date: '2026-10-29',
    theme: 'Bring in your notes before you have a world',
    entries: [
      {
        id: 'bring-in-door',
        title: 'Bring in a file, notes or JSON from the first screen',
        body: 'Other ways in now has Bring in a file, notes or JSON. It opens the Data room with no world made yet: a world file opens as it is, and OnlyWorlds JSON is reviewed first, then Create world makes the world from it, named from the file or by you. Loose elements, such as the JSON an AI assistant makes from your notes, become a new world too, and in a world\'s own Data room they still merge into it by default. The atlas.onlyworlds.com/#/bring-in link opens the same room without asking for a world first.',
        tags: ['import', 'onboarding'],
      },
      {
        id: 'guide-notes-plain',
        title: 'The guide\'s notes for a Character and a Narrative say it plainly',
        body: 'The note after your first Character now reads "Ada is someone.", and after your first Narrative "A Narrative is a story that is told.", in the same plain voice as the others, and the guide\'s list of steps says the same.',
        tags: ['onboarding', 'copy'],
      },
    ],
  },
  {
    version: '1.102.2',
    date: '2026-10-29',
    theme: 'An empty review mark is no proposal',
    entries: [
      {
        id: 'empty-review-mark',
        title: 'An element with an empty review mark reads as settled',
        body: 'A proposal waiting for the keeper\'s review is marked on the element. A mark left empty by another tool (an empty list, an empty object or blank text) used to count as a proposal; it now reads as no mark at all, as the OnlyWorlds review rules say, so the element is counted and listed like any other, and its page shows no empty mark among its fields.',
        tags: ['world', 'fix'],
      },
    ],
  },
  {
    version: '1.102.1',
    date: '2026-10-29',
    theme: 'The standard\'s colours',
    entries: [
      {
        id: 'standard-colours',
        title: 'Constructs are pink and Abilities amber, as the standard now draws them',
        body: 'An element\'s colour says its group, and its icon says its type. The OnlyWorlds standard moved Construct into the pink group and Ability into the amber one, and Atlas now reads every type\'s group and colour from the standard itself.',
        tags: ['world'],
      },
    ],
  },
  {
    version: '1.102.0',
    date: '2026-10-29',
    theme: 'A character\'s world, and the world\'s picture',
    entries: [
      {
        id: 'see-their-world',
        title: 'See a character\'s world, the moment it has two links',
        body: 'When placing a character, or giving a year to an Event they were in, first links them to two things, the note that follows offers See Ada\'s world (by their name). It opens the Web on them beside their page, or its drawer on a phone. It is offered once in this browser, and never in the demo world.',
        tags: ['home', 'world'],
      },
      {
        id: 'home-picture',
        title: 'Home draws the best-linked element and what it touches',
        body: 'A world with an element linked to three or more shows the Web around its best-linked one on Home, under the cover. A press on the centre, or See its world beside the title, opens the Web on it. The page scrolls past it as before.',
        tags: ['home'],
      },
      {
        id: 'drawer-escape',
        title: 'Escape closes a side panel and stays on the page',
        body: 'In a narrow window, Escape over an open side panel closed it and also went back to Home. It now only closes the panel.',
        tags: ['layout', 'fix'],
      },
    ],
  },
  {
    version: '1.101.0',
    date: '2026-10-28',
    theme: 'A world\'s reading aids at its door',
    entries: [
      {
        id: 'reading-aids-door',
        title: 'Home shows a world\'s charter, its guide and its domains first',
        body: 'A world can carry three reading aids for whoever enters it: the charter (the rules here), the guide (start here) and the domains (the places in the world, each with one line). Home shows them first, in that order, each a link. A Construct with the supertype Guide or Domain can be marked as one from its own page, as a charter can.',
        tags: ['home'],
      },
      {
        id: 'reading-aids-lists',
        title: 'The lists, Charts and Search leave the reading aids out unless you ask',
        body: 'Like the parlor\'s room, the charter, guide and domains stay out of the element list, the counts, Search and Charts, so the world reads as its story. One line on Home and a chip in the list show them, in this world only. A guide\'s or a domain\'s own page still links anything in the world.',
        tags: ['home', 'world'],
      },
      {
        id: 'reading-aids-retire',
        title: 'A keeper can change which charter or guide leads',
        body: 'The newest marked charter leads, or the one a world folder names. Its page now offers Retire it: its mark comes off and it stays in the world as an ordinary element. A newer charter can be marked in its place, and Home then offers to retire the old one; an older one says to retire the leading one first. The same holds for a guide.',
        tags: ['home'],
      },
    ],
  },
  {
    version: '1.100.0',
    date: '2026-10-28',
    theme: 'A world\'s charter, by its mark',
    entries: [
      {
        id: 'charter-by-mark',
        title: 'A world\'s charter is the one marked as its charter, and a keeper can mark it',
        body: 'OnlyWorlds now counts a Law with the supertype Charter as a world\'s house rules only when it carries the charter mark; without it, it is a charter in the story. Home shows the newest marked one, as onlyworlds.com does. Charters made on onlyworlds.com by a world\'s owner or co-builders already carry the mark, so an account world\'s Home shows the same charter as before. Where no marked charter leads yet, the owner or a co-builder sees Mark as this world\'s charter on an unmarked one\'s page.',
        tags: ['home', 'sync'],
      },
      {
        id: 'sdk-4-100',
        title: 'Atlas reads the newest OnlyWorlds rules',
        body: 'Atlas moves to the newest OnlyWorlds SDK and writes new world folders as format 0.3.20. A parlor\'s room mark counts as other tools read it now, a number included, and a custom field cannot take a name that a shared field other tools read already uses (the charter and lens marks among them).',
        tags: ['sync'],
      },
    ],
  },
  {
    version: '1.99.0',
    date: '2026-10-28',
    theme: 'A world in this browser opens before it is saved',
    entries: [
      {
        id: 'open-then-save',
        title: 'A world from OnlyWorlds or a world file opens at once in this browser, and saves behind you',
        body: 'Explore Moppetopia, viewing or linking a world, bringing one down again and opening a world file now open the world as soon as it has downloaded, then save its files to this browser while you look around. Its home says "Saving this world in this browser" with a count until it is done; keep the tab open until then. Firefox saves each file slowly, so there Moppetopia opens in a few seconds where it took about 20.',
        tags: ['sync', 'performance'],
      },
      {
        id: 'guide-labels-column',
        title: 'The guide\'s labels no longer run into each other on a new world\'s home',
        body: 'Under What do you have?, the five marks sat in the narrow label column and their names overlapped. They now sit in the wide column beside Nothing yet.',
        tags: ['home', 'onboarding'],
      },
      {
        id: 'front-door-words',
        title: 'The first screen says Create a world and Explore',
        body: 'Start a world is now Create a world, here and wherever Atlas offers it, with the shorter line "In a folder or in this browser". Explore Moppetopia is now Explore, "An example world". The line under Atlas reads "Worldbuilding on an open standard."',
        tags: ['onboarding'],
      },
    ],
  },
  {
    version: '1.98.1',
    date: '2026-10-28',
    theme: 'A shared world comes down faster',
    entries: [
      {
        id: 'first-download-in-memory',
        title: 'Viewing or linking a world into this browser is several times faster',
        body: 'A world from OnlyWorlds now downloads whole first and is then saved to this browser in one pass, as Explore Moppetopia already did. A world of 300 elements opens in a few seconds in Chrome, where it took about 15, and faster in Firefox too. The dialog says when it is saving.',
        tags: ['sync', 'performance'],
      },
      {
        id: 'demo-line-shows',
        title: 'Moppetopia\'s home now shows how to leave it',
        body: 'The line under its name, start a world of your own or delete this copy, was listed in 1.98.0 but did not show on Moppetopia. It does now.',
        tags: ['home', 'onboarding'],
      },
      {
        id: 'guide-year-empty',
        title: 'A new Event from the home starts with no year in a world without dates',
        body: 'Something happened on the home used to fill the year in as 1. In a world with no dates yet the box now starts empty, so the year is yours to type.',
        tags: ['home', 'onboarding'],
      },
    ],
  },
  {
    version: '1.98.0',
    date: '2026-10-28',
    theme: 'A guide that follows what you make',
    entries: [
      {
        id: 'guide-strip',
        title: 'Five dots on the home show what your world can do',
        body: 'Someone, somewhere, something happened, a story and a copy. Each lights up when the world has it, however it got there, so an imported world is lit for what it holds. Press one to make that thing, or to open it.',
        tags: ['home', 'onboarding'],
      },
      {
        id: 'guide-notes',
        title: 'A short note after what you just made',
        body: 'Make a Character, a Location, an Event or a story and one quiet line says what it is and offers the next step: place Ada at Hollow Keep, give the Event a year, write the story as a book. Each shows once. Settings, OnlyWorlds turns them off, or shows them again.',
        tags: ['onboarding'],
      },
      {
        id: 'waypoints-from-the-world',
        title: 'The waypoints list what your world can do now',
        body: 'Settings, OnlyWorlds reads each waypoint from the open world itself, with no count to chase. The small messages that popped up for each waypoint are gone.',
        tags: ['settings', 'onboarding'],
      },
      {
        id: 'first-screen-stacked',
        title: 'The first screen leads with Start a world',
        body: 'Explore Moppetopia sits under it, the tour is offered as Watch how it works, and a world folder you already have opens from Other ways in.',
        tags: ['onboarding'],
      },
      {
        id: 'demo-way-out',
        title: 'Moppetopia says how to leave it',
        body: 'Its home has one line under its name: start a world of your own, or delete this copy.',
        tags: ['home'],
      },
    ],
  },
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
        body: 'In a synced world, when an agent made the last change to an element (an agent\'s own seat, MCP, or a tool that says it is an agent), a small mark sits after its name. Point at it or tap it to read who: "Last changed by Sable, an agent". A person\'s change carries none, and your own edit takes the mark away.',
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
        tags: ['sync', 'fix'],
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
      // make its link until keel's Open in Atlas button is live
      // (2026-10-10). Its entry lands with that button.
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
