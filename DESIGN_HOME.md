# Atlas — World Home Design

**Version**: 1.0 (2026-05-18)
**Status**: ⚠️ **PARTIALLY SUPERSEDED (workplan D2)** — home is now the **cover-page × study-desk hybrid**: identity hero (+ cover image), quiet text-links, D2b cast slot (protagonist/home favorites), woven clickable stat line, Continue strip, tight room-routed Recent. The count-card grid, timeline-mini, and boxed quick actions below are GONE (timeline-mini may return post-charts-sitdown as a starred chart). Current truth: `src/middle/world-home.ts` header comment. Sections below remain valid for identity click-edit + onboarding.
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
│  ┌ protagonist ┐  ┌ home ┐             ← Cast slot (D2b)     │
│  │ <char card> │  │ <loc>│               ghost when unset    │
│  └─────────────┘  └──────┘                                   │
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

On an empty (or young) world the onboarding block (`buildTour`) holds the guide's strip: "What do you have?" while the world is empty, then "Grow your world". It renders nothing on a world with all five dots lit (or the block dismissed), never on a view-only world, and never while the guided tour runs. See "The newcomer flow" below.

## The newcomer flow (1.19 and 1.20)

Decided with Titus on 2026-10-09, and built to that record.

- **The landing** (`welcome-panel.ts`): two doors, start a world (primary) and explore Moppetopia, each with its caption; under them one line of links: take the tour, open a world folder (Chromium), other ways in (their hints are `title`s). A window that refuses browser storage drops what needs it (the tour, the demo; without folders also start and other ways in) and says why. Signed in (an account token in the registry), the account's worlds are listed under the doors as "Your worlds on OnlyWorlds" (`landing-account-worlds.ts`, 1.46): the landing has no sidebar, so this is where its On OnlyWorlds rows are offered, and a row opens through the same `openAccountWorld`. The list loading, an error or a row opening repaints only that block, never the landing (the sigil keeps playing, the storage probe's edits stay), and only when the block's markup changed, compared against the string last written, never `innerHTML` (the gate's H1: a re-serialized row never matched, so every notify rebuilt the rows and a focused row lost focus). A token keel refused offers Open Settings, OnlyWorlds (a retry would fail the same way, and this screen has no other way there); any other failure offers Try again. A sign-in from Settings on a browser with no world says where the list is, with Show them, once the list has come with worlds in it (never under the tour).
- **"What do you have?"** (`buildTour`, while the world is empty): optional, never blocking, three quiet rows. Nothing yet: the guide's strip. A world somewhere else: bring it in (this world's Data room), and on Chromium a world folder opens where it is. Just looking: Moppetopia, or watch how it works (the tour). Nothing is chosen or stored. A world started from `#/start` or `#/bring-in` was answered on onlyworlds.com, so its empty home shows the strip alone under "Start here" (`core/newcomer.ts`).
- **The guide** (onboarding step 1, 2026-10-27, ruled by Titus; design and contract in the working notes of that date; conv. 181). The strip (`src/middle/home-guide.ts`): five unnumbered marks, Someone, Somewhere (a Character placed at a Location), Something happened (an Event with a whole-number year, keel's one meaning), A story, A copy (a folder, an online world, a download), each lit from the world (`src/core/guide.ts` `guideDots`), the next one ringed, never a count, then Anything else. A mark always does what its label says: unlit, its one way in (a create that stays on the home, or the place offer); lit, it opens the thing. The × hides the block for this world (`tour_dismissed` holds `home-cards`) and silences its notes. Not on a view-only world, the demo, or under the tour.
- **The notes** (`src/ui/guide-note.ts`): one quiet line after a gesture made by hand (someone, the place offer, placed, an Event with Were there and Set year, dated, a story with Write it as a book, a chapter, a copy), in one slot the shell owns at the middle pane's foot (under the room strip on a narrow window, where the toasts would cover it), once per browser, one at a time; the switch and Show the notes again are on Settings, OnlyWorlds, beside the waypoints, which list the five and four more as the world's memory, lit from the world.
- **Moppetopia's way out**: its home carries one line under its name, a world of your own and Delete this copy (Settings, This world).
- **Layout**: one heading over the block; every row shares one label column (11.5rem), stacked below 460px of block width; the cards are an auto-fill grid (84px minimum), never a scroller.
- **Guards**: `tests/unit/guide.test.ts` (the dots on their exact shapes, what each gesture earns, the migration), `tests/e2e/home-tour.spec.ts` (the strip, the path, a link field's create, a typed year across a rebuild, the negatives beside their twins, 360 px), `tests/e2e/waypoints.spec.ts` (the Settings rows lit from the world, the switch).

The room nav strip is shared across all rooms (see `DESIGN_SHELL.md` Rooms section). It's not "part of" home — home content begins below it.

---

## Sections (shipped)

### 1. Identity (cover) — still valid

Reads `state.active.meta` and renders inside `atlas-home-identity`:
- Optional **cover image** banner (only when `world.image_url` is set — never a placeholder box).
- World **name** (large, cyan accent) — **click to rename** (a local name; the OnlyWorlds world name lives in settings).
- **Description** (text-long, multi-line) — **click to edit**. When empty, an "describe your world…" invite renders (withheld on view-only worlds, where the write would only toast).

**Click-to-edit shipped**: name + description are inline-editable via `openIdentityEdit` (`world-home.ts`). Persists via `FolderStore.writeWorldMeta` + mirrors in `state.active.meta`.

### 2. Cast slot (D2b)

Two quick-action slots — **choose a protagonist** (a Character) and **choose a home** (a Location). Both render as ghost cards when unset; clicking a ghost filters the sidebar to that type so the assignment path is one hop (the actual setter lives on the element-detail header — the person-pin / home-pin, which Titus couldn't find from home, 2026-07-10). When set, the slot shows the favorite's card. Both kinds always render side by side.

**The door's reading aids** (1.101, the charter profile's rule 2): under the world's name, one block (`data-role="reading-aids"`): the world's charter (its linked name and opening), then the guide ("Start here", its linked name and opening), then the domains (each its linked name and the description's first line), read from the SDK's `charterOf` at the owner rung, memoised once per elements array (`readingAids` in `src/core/charter.ts`); world.json's `charter` picks among marked Charters. Nothing absent draws, and the door never asks for one. A keeper's door also names each other marked Charter or Guide ("Another charter is also marked: Old Rules · Retire it"); the press sets its `x_charter_of` to null in one write (Skeld's ruling, 2026-10-28), so it stays as lore, and the same offer sits on its own page. Beside the counts, one line says the aids are not counted or listed, and shows them. A world holding only its aids is not told it holds nothing (the guide's "Grow your world" form). Marking: an unmarked Charter Law, Guide or Domain Construct's page offers the keeper its mark. While another Charter or Guide leads, the offer asks the SDK whether the press would make this one lead (`markWouldLead`: the newest marked one leads, or world.json's pick): if so it says so and Home then offers the other's retire; if not there is no press, and the line says to retire the leading one on its page first (the code gate's C1). The leading one's page offers its own retire, saying what Home then shows, so a keeper can always change which one leads. An aid's page reads the lore with the aids in, the room under its switch (`pageLore`); its picker, and a would-be aid's (an unmarked Guide picks the marked Domains), offers the same (`loreFor`).

**A world at work gets no ghosts** (1.92.0): the ghosts are story prompts, so a world whose Home shows a reading aid at its door (a marked Charter, Guide or Domain, the charter profile, `src/core/charter.ts`) renders neither; a favorite set from an element's header still shows its card. The words are Titus's ("a world for stories and games, or for work?") and the setup skill's packs are the work end, each writing a charter, so the charter is the signal until a world says its kind in a field of its own. Guard: `tests/e2e/message-charter.spec.ts` (the two ghosts, then none; red with the check cut).

### 3. Woven stat line (the counts row)

Element counts per type, rendered as one **woven line** (`atlas-home-statline`) — `24 events · 12 characters · …`, not a card grid. Reads `state.data.elements`, groups by `type`. Each segment is a button: click → flips sidebar to elements mode + applies that type filter. Always rendered (empty with reserved min-height at zero elements, so the first element doesn't shift the layout below). Pin/marker/zone counts excluded (map artifacts, not content).

### 4. Chart strip (the "starred chart", S15)

A **static render of the world's tableau** — the same default the Charts room lands on (`buildChartStrip` → `tableauScope` via `renderChartView(…, {layout:'strip'})`). Cast (protagonist/home) rides into the freeze so it reads cyan; every node carries a ref so a click lands in the Charts room focused on that element. Hidden below 3 dated nodes. This slot is the old timeline-mini's location, now driven by the real chart pipeline. (Saved charts no longer hijack the strip — always the tableau, so home previews exactly what the room opens to.)

**Labels never touch** (Skeld's pre-smoke found Admiral Splashworth over its neighbour): `layoutStrip` in `chart-static.ts` places anchors and cast first, then the rest, each in date order on the nearest free row (centre-out), with its label to the right, else to the left, else none. On a row no label touches a glyph or another label; a node is never dropped, and when every row is full at a node's date, the labels in its way give way, plain names before kept ones. A label paints over a dark knockout, so a range line runs behind a name, not through it. The property is a seeded unit test (`tests/unit/chart-strip-layout.test.ts`).

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
