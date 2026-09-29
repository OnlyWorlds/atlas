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
