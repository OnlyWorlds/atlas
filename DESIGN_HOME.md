# Atlas — World Home Design

**Version**: 1.0 (2026-05-18)
**Status**: ⚠️ **PARTIALLY SUPERSEDED (workplan D2)** — home is now the **cover-page × study-desk hybrid**: identity hero (+ cover image), quiet text-links, woven clickable stat line (the D2b cast slot retired in 1.113, "The cast, retired" below), Continue strip, tight room-routed Recent. The count-card grid, timeline-mini, and boxed quick actions below are GONE (timeline-mini may return post-charts-sitdown as a starred chart). Current truth: `src/middle/world-home.ts` header comment. Sections below remain valid for identity click-edit + onboarding.
**Related**: `DESIGN_SHELL.md` (Rooms model), `DESIGN_WRITING.md`, `DESIGN_SHARING.md`

---

## Vision

When you open a world in atlas, you should land somewhere that says *this is your world* — not a blank pane or an event-axis viewer with no events.

World Home is the **base room** for an active world. It's where you orient when you don't have a specific destination, where you see your world's identity, where you get to the other rooms.

The legacy atlas defaulted to a Timeline view for active worlds (with no events visible if no Events existed). That was a missed identity moment. World Home replaces it.

---

## Layout (shipped — corrected 2026-07-22)

The home that renders today is the **cover-page × study-desk hybrid** (bout H rebuild, workplan D2). Source of truth: `src/middle/world-home.ts` header comment. Top to bottom:

```
┌──────────────────────────────────────────────────────────────┐
│ 🏠 ✎ 🕓 ⬆ ⬇ 🧩 ⚙                      [ ⌕ search this world ]│  ← Room nav strip (~32px); search pill anchored right
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  [ cover image banner — only when world.image_url set ]      │
│                                                              │
│  <world name — large, click to rename>                       │  ← Identity (cover)
│  <description — click to edit, invite when empty>            │
│                                                              │
│  24 events · 12 characters · 8 institutions · …              │  ← Woven stat line (click → sidebar filter)
│                                                              │
│  ◇──◆────◇──◆──◆────────◇──◆──◇─→        ← Chart strip       │
│  (the TABLEAU, static render; hidden below 3 dated nodes)    │
│                                                              │
│  Continue / Recent                                           │  ← The desk
│   ▸ Write  chapterName          3m ago                       │
│   ▸ Map    mapName              14m ago                      │
│   ▸ Edit   elementName          1h ago                       │
│   ...                                                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

On a new world the onboarding block (`buildTour`, `src/middle/home-grow.ts`) is the home that grows: one card right under the world's name with the world's grid inside it. It renders nothing once the path is done (or the block dismissed), never on a view-only world, and never while the guided tour runs. See "The newcomer flow" below.

## The newcomer flow (1.19 and 1.20)

Decided with Titus on 2026-10-09, and built to that record.

- **The landing** (`welcome-panel.ts`): two doors, start a world (primary) and explore Moppetopia, each with its caption; under them one line of links: take the tour, open a world folder (Chromium), other ways in (their hints are `title`s). A window that refuses browser storage drops what needs it (the tour, the demo; without folders also start and other ways in) and says why. Signed in (an account token in the registry), the account's worlds are listed under the doors as "Your worlds on OnlyWorlds" (`landing-account-worlds.ts`, 1.46): the landing has no sidebar, so this is where its On OnlyWorlds rows are offered, and a row opens through the same `openAccountWorld`. The list loading, an error or a row opening repaints only that block, never the landing (the sigil keeps playing, the storage probe's edits stay), and only when the block's markup changed, compared against the string last written, never `innerHTML` (the gate's H1: a re-serialized row never matched, so every notify rebuilt the rows and a focused row lost focus). A token keel refused offers Open Settings, OnlyWorlds (a retry would fail the same way, and this screen has no other way there); any other failure offers Try again. A sign-in from Settings on a browser with no world says where the list is, with Show them, once the list has come with worlds in it (never under the tour).
- **The home that grows** (1.110, a design note of 2026-10-30, three drafts through two contract reviews and a code review), which replaces the doors and the bar-and-card path below: no doors; an empty world opens on the path (`pathShowing`: unless its pointer is `done`). The card: "Step N of 5" with the five dots and the ×, the step's sentence and hint, the grid, a "just now" line with Undo after a placing, the step before's recap (the chart's year, the drag still on offer, the writing room), the copy step's keep ways and Done, and under it all "Already have something written down? Bring it in", which folds the three ways open in place. The card is read from the dots on every draw (`cardStep`: the first unlit, the copy card once all five are lit), whatever made the element, so there is no Next; the pointer keeps only `done` and the restart, and the first make from a + square writes `someone`. Every act is in the grid (`home-grid-acts.ts`): the + square makes the step's kind with its name typed in place (an Event with a year; a story labelled with the world's first writing label); a press selects a square and lights where it can go, a press on a lit square places it (a mouse drag the same; touch never drags; keyboard: one Tab stop, arrows by the grid, Enter, Escape). A placing writes one field (`ui/home-grid-place.ts` `placeIn`, inside the element's lock, never overwriting a single link or repeating a list's id, never on a known-of stub), only where this member may change the element (`core/may-change.ts`: the owner, a co-builder, or `created_by` is this member's own membership, kept from `/me`). 1.110 placed only the pairs that hold; 1.111 places every pair the SDK's `dragField` offers (below). When the grid is not drawn (past its height) the card carries its step's act as a button and Home draws the centred picture under it. Settings, World, "Show the first steps again" restarts the path and clears `home-cards`. **The grid** (`core/home-grid.ts` `gridOf`, pure; drawn by `home-grid-view.ts`): each element a square in its type's colour and icon, nothing naming a set of kinds; where each stands is derived on every draw, never stored: arrival from a UUIDv7 id's milliseconds (the v1 server's draft ids read as 36-bit seconds), else `created_at`, else first; the column is the arrival rank; a held element stands under its holder on a rail (the second level a quarter column in), its own column left empty; columns wrap at the card's width. Being born moves nothing drawn before; named exceptions: a holder that arrives listing older elements takes them, an element entering or leaving the picture reflows the columns after it, a growing stack pushes what stands below. Element ids are UUIDv7 (monotonic per tab; a re-key keeps arrival). Past about 640 px of grid (`HAND_OVER_PX`) Home's picture is the centred one. The room's bar (below) reads the dots since 1.110: shown while that room's dot is lit and the card stands at its step or the one after; Back lands on the grid's Tab stop.
- **Every offered pair** (1.111, a design note of 2026-10-30 through a contract review and a code review). **The table is the SDK's**: `pairWrite` (`core/home-grid-pair.ts`) asks `dragField(a, b)` for the pair's `{on, field, holds}`, null is no target, and `gridOf` decides a hold through the same call per edge (`holdOf` in `core/home-grid.ts`), so the grid and the act cannot disagree; nothing of the table is copied (a canary unit over its holding rows fails when a release adds one). **Which end is held** comes from the field's own kind: a single link puts the element that carries it under its target, a list puts the elements it lists under the one that lists them; a stack through a list keeps the list's order. **Lines** stay every link the world has between two squares; the table decides only what a drop can write. A list write appends to the value as it is (an `{id, name}` entry stays one) and Undo removes only the entry it wrote. **Line pairs**: a drag writes at once; by presses the first press on a line target shows its promise ("The Founding will list Mira") with Place, and only a second press or Place writes, so a browse by presses never writes a line; a pair the table does not offer says "cannot be linked by placing". **The plain +** ("add") stands wherever the step names no kind, after the path too; it opens a kind list (`home-grid-kinds.ts`: a character, a location, an event, a story, Another kind… through the create dialog without leaving Home) and never writes the path's pointer; while its list or a name box is open, Home's redraws wait. **Nothing above the squares moves with an act**: the card is its head (the step and dots, one fixed line), then the grid, then every word and button; while the path is open the cover above holds back the count line and the description prompt, and when the path closes they draw under the grid until Home is next opened. **"just now"** names only the latest act (`justNowIn` answers null once the world's element set changed) and the names as they are now; Undo is a 44 px target. **Tab while a square is held** walks its targets in grid order, each described by its promise; leaving at either end lets go. **The hand-over card** says what its button does and links the Web, decided when the grid gives way. No + and no targets on the demo, Moppetopia or a view-only world (which now draws the grid, without acts).
- **The two doors** (1.108 to 1.109, retired by 1.110; #964, Titus's walk of 2026-10-29; `buildTour`, while the world is empty, `worldIsEmptyForGuide`): "What do you have?" over two equal doors, Start from nothing and Bring in a world I have (stacked below 460 px of block width), each opening in place with Back in the head row. Bring in holds three ways, only those this browser can do: Bring in a file (the Data room), Open a folder (folder mode), Download a world. Which door is open is memory (`core/guide-path.ts` `doorOf`), so a reload shows the doors. Start from nothing writes the path's pointer (`guide_step: 'someone'`); Bring in a file leaves Start from nothing open behind it, so an empty return from the Data room lands there and writes the pointer then. A world started from `#/start` was answered on onlyworlds.com (`core/newcomer.ts`): it opens straight on the path, the pointer written by its creation. One head row in every state (a Back slot that collapses when empty, the heading, the ×); the doors hold the path's height, so a door press never moves the block (the drawn states sheet).
- **The path** (1.108 to 1.109, its bar and Next retired by 1.110; #964; conv. 183). A bar and one card (`src/middle/home-guide.ts`). The bar: the five dots, Someone, Somewhere (a Character placed at a Location), Something happened (an Event with a whole-number year, keel's one meaning), A story, A copy (a folder, an online world, a download), each lit from the world (`src/core/guide.ts` `guideDots`), the current one ringed, a list nothing on which is pressable, and Anything else beside it. The card under it speaks for the current step: a sentence and its buttons (create, Place, Were there, open the chart or the writing room, the keep-safe ways), and Next once the step is done, naming where it goes ("Next: Somewhere", the last "Done"). The chart and the writing room count as seen (`guide_visited`, at the shell's room mount, `noteRoomVisit`) only once their step is lit, and again from the room itself the first time its step lights while it is mounted in a settled world (a room mounted while the world loads, a year given in the chart). **The room's bar** (1.109, #975; `src/middle/guide-room-bar.ts`): while the card's pointer stands at the chart's or the writing room's step with its dot lit, that room's first row says "Step 3 of 5, Something happened" (or "Step 4 of 5, A story") and offers Back to Grow your world, which lands on the home with Next focused and in view. Read from the world on every tick, never from a press, so the room nav, a link or a reload show it too and the room's own moves keep it; it names the step, never the element, and steps aside in writing focus mode. The pointer (`guide_step` on the world's registry entry, per browser, never synced) moves only on Next, forward only, the later of what is stored (another tab), this tab's and the step computed; a step lit before it is reached is skipped. A world never on the path (imported, older) reads its first unlit step, and a press on its card holds the pointer there. While a world walks the path the picture draws below the block and the keep-safe card waits. Done never dismisses; the × (`tour_dismissed` holds `home-cards`) is the only way to hide the block, and it silences the notes. Not on a view-only world, the demo, Moppetopia, while loading, or under the tour (`pathShowing`, the one predicate).
- **The notes** (`src/ui/guide-note.ts`): one quiet line after a gesture made by hand (someone, the place offer, placed, an Event with Were there and Set year, dated, a story with Write it as a book, a chapter, a copy), in one slot the shell owns at the middle pane's foot (under the room strip on a narrow window, where the toasts would cover it), once per browser, one at a time; the switch and Show the notes again are on Settings, OnlyWorlds, beside the waypoints, which list the five and four more as the world's memory, lit from the world. While the path shows, the eight path notes are silent in every room (the card says it; conv. 183); `reading` and `lens` still speak. The last Next stamps the path notes seen.
- **The reward** (onboarding step 2, 1.102.0, conv. 182): the first time placing a Character, or a year on an Event they were in, gives them two links, the note that follows carries See <name>'s world, which opens the right pane's Web on them (`openWebOn`). Once per browser; never in Moppetopia.
- **The world's picture** (1.102.0, `src/middle/home-picture.ts`): after the cover and its lines, above the guide's block, the Web mounted small (260 px, depth 1, a dozen around the centre, no wheel zoom, no node menu) around the world's best-linked element: the SDK's `degreeOf` over the owner's `worldGraph` (no room, proposed, hidden, map space or reading aids) ranks, and the first of the top five the Web draws with three or more around it is the centre. None: no picture. Ranked once per world, what the elements say, the lore's switches and the Web's switched-off types; never while the world opens or under the tour. Its title is "<Name> and what it touches" with See <Name>'s world beside it; a press on the centre opens the Web on it. Home destroys its graph before each rebuild.
- **Moppetopia's way out**: its home carries one line under its name, a world of your own and Delete this copy (Settings, This world).
- **Layout**: one head row over the block, 34 px (44 on a coarse pointer); on a coarse pointer the doors, Back and the card's buttons take 44 px or more.
- **Guards**: `tests/unit/guide-path.test.ts` (the pointer's steps, `pathShowing` in every silent state, the writes forward only and across tabs, the visit), `tests/unit/onboarding-reading.test.ts` and `tests/e2e/onboarding-reading.spec.ts` (the reward on the card's path and past it, `openWebOn`, the picture's centre and lifetime), `tests/unit/guide.test.ts` (the dots on their exact shapes, what each gesture earns, the migration), `tests/e2e/home-tour.spec.ts` (the doors and Back with focus, the path by the card alone with the block's place measured, a step done elsewhere, Bring in's empty return, a stale tab, an older world's first step, the notes past the path, 360 and 390 px), `tests/e2e/waypoints.spec.ts` (the Settings rows lit from the world, the switch).

The room nav strip is shared across all rooms (see `DESIGN_SHELL.md` Rooms section). It's not "part of" home — home content begins below it.

---

## Sections (shipped)

### 1. Identity (cover) — still valid

Reads `state.active.meta` and renders inside `atlas-home-identity`:
- Optional **cover image** banner (only when `world.image_url` is set — never a placeholder box).
- World **name** (large, cyan accent) — **click to rename** (a local name; the OnlyWorlds world name lives in settings).
- **Description** (text-long, multi-line) — **click to edit**. When empty, an "describe your world…" invite renders (withheld on view-only worlds, where the write would only toast).

**Click-to-edit shipped**: name + description are inline-editable via `openIdentityEdit` (`world-home.ts`). Persists via `FolderStore.writeWorldMeta` + mirrors in `state.active.meta`.

### 2. The door's reading aids; the cast, retired

**The cast, retired** (1.113, Titus's call of 2026-10-30: "easier to just scrub that, for now"). From 1.0 to 1.112 a world could name a cast: a protagonist (a Character) and a home (a Location, `nexus` in code), set from a toggle in the element's header or from a ghost card on Home ("Choose a protagonist", "Choose a home") that put the sidebar in an assign mode; Home's cover showed them as cards, the chart strip and the Charts room drew them in cyan and led the tableau with them, the scroll view ringed them. The home that grows took Home's first place, and a world's hero is to be named later in a way of its own, not by this toggle. 1.113 removes all of it: no slot, no ghosts, no header toggle, no assign mode, no cast mark in any chart. **The picks are kept**: `favorites.protagonist_id` and `favorites.nexus_id` stay on the registry entry and in `.atlas/world-prefs.json` (`WORLD_PREF_KEYS`, conv. 112), never written again and never cleared (the old stale-pick cleanup went with the slot), so an older Atlas on the same folder keeps its cast; a re-key still moves their ids with every other stored id (`rekeyRegistryEntry`, the kernel's world-prefs step). Guard: `tests/unit/cast-retired.test.ts` (only the type, the registry, the mirror and the re-key read the fields; none of the UI's classes, icons, state or words is left).

**The door's reading aids** (1.101, the charter profile's rule 2): under the world's name, one block (`data-role="reading-aids"`): the world's charter (its linked name and opening), then the guide ("Start here", its linked name and opening), then the domains (each its linked name and the description's first line), read from the SDK's `charterOf` at the owner rung, memoised once per elements array (`readingAids` in `src/core/charter.ts`); world.json's `charter` picks among marked Charters. Nothing absent draws, and the door never asks for one. A keeper's door also names each other marked Charter or Guide ("Another charter is also marked: Old Rules · Retire it"); the press sets its `x_charter_of` to null in one write (Skeld's ruling, 2026-10-28), so it stays as lore, and the same offer sits on its own page. Beside the counts, one line says the aids are not counted or listed, and shows them. A world holding only its aids is not told it holds nothing (the guide's "Grow your world" form). Marking: an unmarked Charter Law, Guide or Domain Construct's page offers the keeper its mark. While another Charter or Guide leads, the offer asks the SDK whether the press would make this one lead (`markWouldLead`: the newest marked one leads, or world.json's pick): if so it says so and Home then offers the other's retire; if not there is no press, and the line says to retire the leading one on its page first (the code gate's C1). The leading one's page offers its own retire, saying what Home then shows, so a keeper can always change which one leads. An aid's page reads the lore with the aids in, the room under its switch (`pageLore`); its picker, and a would-be aid's (an unmarked Guide picks the marked Domains), offers the same (`loreFor`).

### The strand (1.114)

The world's strand (schema-dist `profiles/strand.md`, serial 99): one story in five boxes, in the story's order, Story, Happening, Where it happened, Hero, Where the hero is now. The mark is `x_strand` on world.json, `{narrative, event, location}`, the story's id from the first press and the other two `null` until chosen; the hero is the story's `protagonist` and where the hero is now is the hero's `location`. It syncs as any World `x_` key (conv. 167) and follows a re-key (`remapStrandMark`).

- **The reading** is the SDK's `strandOf` alone, at the owner rung over this copy's elements less the kept-here copies (conv. 151), never the lore, so the room switch changes nothing (`strandView`, `src/core/strand.ts`). Atlas never decodes the mark; a mark the SDK reads as none draws as no strand, and a write over it starts fresh.
- **Who writes** (`maySetSlot`): Story, Happening, Where it happened, a keeper (the owner or a co-builder by role or seat, a folder world's own owner; never a view-only world) who may also change the element whose list is written; Hero, whoever may change the story; Where the hero is now, whoever may change the hero. A box this person may not write shows its element or "Empty" and no act. A linked world whose role no round has kept yet (before its first `/me`) reads as no keeper: until then its owner gets Hero and Where the hero is now but not the mark's three boxes or Make this the world's strand (accepted, G21; `mayChange` reads the same world as owned).
- **The tab**: Home's render builds a two-tab head, "Picture" and "Strand" (one Tab stop, arrows between), above whichever picture draws (the grid, or the centred picture after the hand-over), never inside it; the panel not chosen is not built. Default: Strand when the story box is filled, else Picture; a world's first draw in a session is recorded as if pressed, so a later pull never switches the tab under the person; kept in module memory, never stored. No tab while the path shows, under the tour or while the world loads; no tab at all when the strand is empty and no box is writable here; with a strand and nothing writable, the boxes draw read-only under "The owner or a co-builder chooses the strand." Where Home draws no picture, the strand draws alone under the heading "Strand".
- **The boxes** (`src/middle/home-strand.ts`): a filled box names its element (a press opens it), with Atlas's hidden word when the element is hidden here, "The same place" on the last box when `same`, and Change. An empty box offers Make one (a name box: Enter makes, Escape leaves) and Pick from the world (that kind by name, filterable, the parent's own first, "In this story" or "In this happening"; never a stub, a proposed element or a room element: `offerable`), and Where the hero is now also Same place once Where it happened is filled. A box whose parent is empty says what it waits for ("After the story", "After the happening", "After the hero"). A Hero or Now field that holds something the strand does not read says what it holds ("Proposed: Mira", "Hidden: Ana", "An id that names nothing here"). Change, and any write over such a field, first says what it will do ("Ilse will be the hero in place of Mira.") and only the second press writes, against the value the promise named. The name box and the pick list hold Home's redraws as the grid's do (`GRID_OPEN_ATTR`, `GRID_CLOSED`); after a write the focus goes to the box it wrote (`data-slot`); every target is 44 px on a coarse pointer; each box takes its kind's family colour and icon.
- **The writes** (`src/ui/strand-write.ts`), one field each: the guard first (world.json's mark must still name the story, and for Where it happened the happening, the box was drawn for, or "The strand changed meanwhile." and nothing is written; Make one asks it before it makes anything), then the link inside the element's lock (a list appends unless the SDK already reads the id as listed, an `{id}` object entry kept beside the bare id; a single link only while it still holds what was drawn), then the mark inside `writeWorldMetaWith` with the guard asked again, then `patchActiveMeta`, the list and a push. A story change keeps the happening only when the new story lists it and the place only with it; a happening change keeps the place only when the new happening lists it. Never through the grid's `placeIn`, so no "just now" or Undo holds a strand link. A Make one whose link was then refused keeps what it made, and says so.
- **Make this the world's strand** (`src/middle/strand-offer.ts`): a keeper's offer on a story Narrative's page (under the name, beside the charter's Mark) and in the writing room's sticky bar, "…instead of <name>" when another story is the strand; one press writes the story change and says "The world's strand · Open it" (Home on the Strand tab; no Open it while the path shows). On the strand's own story the page says "This is the world's strand · Open it · Not the strand"; Not the strand removes the key after a promise line and a second press; the bar shows nothing.
- **The frame** (`src/tabs/right/context-strand-frame.ts`): while the open Narrative is the strand's story, the writing context leads with "This story is the world's strand" and a chip for Hero, Happening, Where it happened and Where the hero is now, each opening its element; an empty one says "Pick on Home" where this person may fill it, else "Empty" (and "Empty" while the path shows). The workspace's refresh gate and the context tab's `maybeRender` read the mark (`strandMarkKey`), so a press, a pull or Not the strand redraws the bar and the frame without a keystroke.
- **Nothing else marks them**: the five elements are ordinary in every list, graph, lens, chart, count and page. The conflict review words a contested `x_strand` "The world's strand", with the story each side names.
- **Guards**: `tests/unit/strand.test.ts` (the fixture's cases through Atlas's adapter, the five bodies against the whole world, who writes, the write plans), `tests/unit/strand-write.test.ts` (one field per write, the link before the mark, the guard before any make, compare-and-set, the guard inside the meta op), `tests/unit/home-strand.test.ts` (the tab's rule and memory, the boxes, what a field holds, Pick, Make this the strand's predicate), `tests/e2e/strand.spec.ts` (the tab's default, each box read back, Change, a second tab refused, a contributor and a view-only world, the path, the page, the bar and the frame without a keystroke, the focus, the keys in Firefox, a phone).

### 3. Woven stat line (the counts row)

Element counts per type, rendered as one **woven line** (`atlas-home-statline`) — `24 events · 12 characters · …`, not a card grid. Reads `state.data.elements`, groups by `type`. Each segment is a button: click → flips sidebar to elements mode + applies that type filter. Always rendered (empty with reserved min-height at zero elements, so the first element doesn't shift the layout below). Pin/marker/zone counts excluded (map artifacts, not content).

### 4. Chart strip (the "starred chart", S15)

A **static render of the world's tableau** — the same default the Charts room lands on (`buildChartStrip` → `tableauScope` via `renderChartView(…, {layout:'strip'})`). Every node carries a ref so a click lands in the Charts room focused on that element. Hidden below 3 dated nodes. This slot is the old timeline-mini's location, now driven by the real chart pipeline. (Saved charts no longer hijack the strip — always the tableau, so home previews exactly what the room opens to.)

**Labels never touch** (Skeld's pre-smoke found Admiral Splashworth over its neighbour): `layoutStrip` in `chart-static.ts` places anchors first, then the rest, each in date order on the nearest free row (centre-out), with its label to the right, else to the left, else none. On a row no label touches a glyph or another label; a node is never dropped, and when every row is full at a node's date, the labels in its way give way, plain names before kept ones. A label paints over a dark knockout, so a range line runs behind a name, not through it. The property is a seeded unit test (`tests/unit/chart-strip-layout.test.ts`).

### 5. The desk — Continue + Recent

One list (`buildDesk`), newest first. A **Continue strip** surfaces the last writing narrative, last map, and last edited element; the remaining recent elements join the SAME row style below. Each row's verb comes from the room it opens — **Write** for tree narratives, **Map** for maps, **Edit** otherwise (**Created** when the element was never touched since birth). Rows route via `openElementTarget(el, worldId)` to the room the element actually lives in. Excludes pins/markers/zones.

### 6. Loose threads (2026-07-24; dates to check, 1.41.0)

The quiet band at the very bottom (`src/middle/home-loose-threads.ts`, `computeLooseThreads`, pure): where the world is thin, each class a count that expands to its exact elements (locations not on a map, undated events, unlinked characters). Renders nothing for a fully woven world.

**Dates to check** lead the band: every other class is the world being thin, this one is the world perhaps contradicting itself. `findDateConflicts` (`src/core/date-continuity.ts`, pure, read-only) lists them on the standard's own fields. Two kinds cannot both be true (`IMPOSSIBLE_KINDS`): a span ending before it starts (event, relation, title, construct, narrative, zone), and an Event's `triggers` (its causes, by the schema's words) beginning after it. Three are links across a birth, which the standard's words make possible (`characters` are "relevant to" an Event or Relation: a historian born after a war; `holders` "hold or represent" a Title: a pretender to an abolished crown) and which are far more often a typed date gone wrong: a character or creature an Event or an ended Relation lists, born once it was over (half-open at the end, Skeld's ruling for every dated type, 2026-10-15; an Event with no end is a moment, a Relation with none still runs, an end that is text is unknown), and a Title's holder born at or after its revoke date. So the band states, never judges: each sentence gives both dates ("Ireena (born 120) is linked to The Battle (ended 105)"), the reader decides. A gate found the first wording ("dates that do not add up", "born after it was over") calling the possible impossible. Not checked, for want of fields: a parent born after a child (Family only), anything after death (no death date). The thread counts pairs; it expands to one sentence each, both elements as chips that open them, both dates in the world's calendar (`worldDateFormatter`, `src/core/world-date-text.ts`, the lens resolved once per expand). Guards: `tests/unit/date-continuity.test.ts` (every rule planted and found; a clean world with every near miss finds none), `tests/unit/home-loose-threads.test.ts`, `tests/e2e/date-continuity.spec.ts`.

---

## Superseded layout (historical)

*The sections below describe the pre-D2 home (count-card grid, compact timeline-mini, boxed quick actions). They were removed in workplan H2-H6; the timeline-bar module (src/visualization/timeline-bar.ts) was later deleted (see DESIGN_CHARTS.md). Kept for design history — not what renders today.*

### ~~1. Identity strip~~ (superseded — see "Identity (cover)" above)

Reads `state.active.meta` and renders:
- World **name** (large, sentence case, cyan accent)
- **Description** (text-long, multi-line)
- **World type** / **age** / **tags** (whatever metadata exists on `world.json`)

### ~~2. Stats spread~~ (superseded — see "Woven stat line" above)

Element counts per type. Reads `state.data.elements`, groups by `type`, renders icon + count row.

Click a type icon → flips sidebar to elements mode + applies that type filter. Bridges home and elements discovery.

Visual: horizontal row of compact `<icon><count>` tiles. Wraps if needed. Pin/marker/zone counts hidden (they're map artifacts, not content elements).

### ~~3. Compact timeline~~ (superseded — module deleted; see "Chart strip" above)

Embedded `timeline-bar` component (was src/visualization/timeline-bar.ts, ported from an older element viewer's timeline — **deleted**; the strip now runs the chart pipeline / `tableauScope`).

Compact mode: ~100px tall. Multi-row dot binning across temporal elements. Click dot → element room. Click empty axis (or "expand" affordance) → full timeline room (`#/w/<id>/timeline`).

v1 features: temporal field extraction + axis + dot placement + click + hover tooltip. Deferred: narrative bars, zoom/pan, filter toggles, expand-collapse.

### ~~4. Recent activity~~ (superseded — folded into "the desk" above)

Reads `state.data.elements`, sorts by `local_updated_at` descending, takes top 5.

Each row: element type icon + name + relative time ("3m ago"). Click → element room.

Excludes pins/markers/zones (less useful for "what was I working on" UX).

### ~~5. Quick actions row~~ (superseded — removed S255v3; room nav + tour cover these)

**Was** (3 buttons):
- **+ new element** → opens `ElementCreateModal`
- **open writing** → navigates to `#/w/<id>/writing`
- **settings** → navigates to `#/w/<id>/settings`

Visual: row of compound icon buttons (icon + label), matches existing button patterns.

**Considered but dropped during build**:
- **open map** — discoverable via the right pane's map index tab; redundant on home.
- **refresh from API** — surfaced on the sync pill instead (always visible); didn't earn a slot on home.

---

## Route

- `#/w/<id>` resolves to home (default landing)
- `#/w/<id>/home` (explicit) is supported but optional — bare path is canonical
- `homeHash(worldId)` helper in `core/router.ts`

When the URL is bare `#/w/<id>`, the router's `parseHash` returns `mode: 'home'`. `app.ts renderMiddle` dispatches to `mountWorldHome(shell.middleContent)`.

---

## State implications

No new state slices required. World Home is a pure read view of:
- `state.active.meta` (world identity)
- `state.data.elements` (counts, recent, timeline data)
- `state.registry` (api-linked check for refresh button visibility)
- `state.sync.activeSync` (engine state for refresh button enable/disable)

Subscribes to state changes via standard `subscribe()` and re-renders on data/active/sync changes.

---

## Conventions added

- **#31** (in DESIGN_LAWS.md): Room nav strip mounts to `shell.middleRoomNav`, room content to `shell.middleContent`. Middle pane is a flex column.
- **#32** (in DESIGN_LAWS.md): Esc clears `selectedElementId` and navigates to home. Clicking the selected element row in sidebar toggles off (same effect).

---

## Deferred for future bouts

- **Click-to-edit identity** (name, description inline edit)
- **Pinned/featured element** card on home
- **Mini graph preview** (relationship visualization snippet)
- **Customize home layout** (which sections, in what order, hide/show)
- **Empty-world onboarding**: built, see "The newcomer flow" (1.19).
- **Multi-world overview** (Worlds mode in sidebar already covers this; not a home concern)

---

## What home is NOT

- Not a dashboard with editable widgets — fixed sections, opinionated layout
- Not a feed of API activity / sync log — that lives in settings
- Not a search surface — search has its own room
- Not a kitchen sink — anything that doesn't fit the "world identity at a glance" frame goes in its own room
