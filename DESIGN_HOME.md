# Atlas — World Home Design

**Version**: 1.0 (2026-05-18)
**Status**: ⚠️ **PARTIALLY SUPERSEDED (session 248, workplan D2)** — home is now the **cover-page × study-desk hybrid**: identity hero (+ cover image), quiet text-links, D2b cast slot (protagonist/home favorites), woven clickable stat line, Continue strip, tight room-routed Recent. The count-card grid, timeline-mini, and boxed quick actions below are GONE (timeline-mini may return post-charts-sitdown as a starred chart). Current truth: `src/middle/world-home.ts` header comment + PROGRESS.md session-248 entries. Sections below remain valid for identity click-edit + onboarding.
**Related**: `DESIGN_SHELL.md` (Rooms model), `DESIGN_WRITING.md`, `DESIGN_SHARING.md`

---

## Vision

When you open a world in atlas, you should land somewhere that says *this is your world* — not a blank pane or an event-axis viewer with no events.

World Home is the **base room** for an active world. It's where you orient when you don't have a specific destination, where you see your world's identity, where you get to the other rooms.

The legacy atlas defaulted to a Timeline view for active worlds (with no events visible if no Events existed). That was a missed identity moment. World Home replaces it.

---

## Layout (shipped — corrected 2026-07-22, S309)

The home that renders today is the **cover-page × study-desk hybrid** (bout H rebuild, workplan D2, session 248). Source of truth: `src/middle/world-home.ts` header comment. Top to bottom:

```
┌──────────────────────────────────────────────────────────────┐
│ 🏠 ✎ 🕓 ⬆ ⬇ 🧩 ⚙                      [ ⌕ search this world ]│  ← Room nav strip (~32px); S309 search pill anchored right
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

On an empty (or young) world the desk and stat line give way to the onboarding (`buildTour`): "What do you have?" on an empty world, the core pair until a character and a location exist, then the next steps. It renders nothing on a world with every step done (or the list dismissed), never on a view-only world, and never while the guided tour runs. See "The newcomer flow" below.

## The newcomer flow (1.19, #127)

Decided with the Captain (h37 #2015, his answers to `Forge/Notes/2026-10-09-s382-atlas-flow/MAP.md`); built as recorded in `Forge/Notes/2026-10-09-s383-newcomer-flow-design.md`.

- **The landing** (`welcome-panel.ts`): two doors, start a world (primary) and explore Moppetopia, each with its caption; under them one line of links: take the tour, open a world folder (Chromium), other ways in (their hints are `title`s). A window that refuses browser storage drops what needs it (the tour, the demo; without folders also start and other ways in) and says why.
- **"What do you have?"** (`buildTour`, zero elements): optional, never blocking, three quiet rows. Nothing yet: the core tiles (character, location, anything else). A world somewhere else: bring it in (this world's Data room), and on Chromium a world folder opens where it is. Just looking: Moppetopia or the tour. Nothing is chosen or stored; the sidebar + and every room work as before. A world started from `#/start` or `#/bring-in` was answered on onlyworlds.com, so its empty home shows only the tiles (`core/newcomer.ts`, in memory for the page session).
- **The core pair**: while a character or a location is missing, its highlighted tile, plus "anything else"; "Every world starts with someone, somewhere." once the world is not empty.
- **The next steps** (`home-tour.ts` kernel, `buildNextSteps`): the waypoints are the one track (thirteen since 1.19: story and knowledge joined, so the rooms the old CTA cards taught are still taught). After the core pair the home shows the next three undone steps in `HOME_STEPS` order (links, taxonomy, time, story, maps, knowledge, share, keep-copy, ecosystem, import, council), one line each: glyph, name, the waypoint's action; each opens the place the step is done (`runNextStep`). A step is done on this home when its waypoint is completed OR the world holds it (`worldHolds`: a story, a pin, a knowledge entry, a page, a copy outside this browser, a link to OnlyWorlds), so a world that arrived with stories is not asked for one; the gesture-only waypoint contract stands. "see all" opens Settings, OnlyWorlds (the whole track); the × hides the list for this world (`tour_dismissed` holds `next-steps`).
- **No toast on the home**: the waypoint queue drops what completes while the world home is the route (`waypoints.ts` `drain`): the list is the receipt. This is also why creating a world no longer toasts "Your world, your files" over the question.
- **Guards**: `tests/unit/home-tour.test.ts` (the kernel), `tests/unit/waypoints.test.ts` (the home rule, with a control), `tests/e2e/home-tour.spec.ts` (the question, the steps, the deep links; its no-toast checks take focus away and count once, since a retrying `toHaveCount(0)` outwaits a toast's 7 s life).

The room nav strip is shared across all rooms (see `DESIGN_SHELL.md` Rooms section). It's not "part of" home — home content begins below it.

---

## Sections (shipped)

### 1. Identity (cover) — still valid

Reads `state.active.meta` and renders inside `atlas-home-identity`:
- Optional **cover image** banner (only when `world.image_url` is set — never a placeholder box).
- World **name** (large, cyan accent) — **click to rename** (a local name; the OnlyWorlds world name lives in settings).
- **Description** (text-long, multi-line) — **click to edit**. When empty, an "describe your world…" invite renders (withheld on view-only worlds, where the write would only toast).

**Click-to-edit shipped (session 223)**: name + description are inline-editable via `openIdentityEdit` (`world-home.ts`). Persists via `FolderStore.writeWorldMeta` + mirrors in `state.active.meta`.

### 2. Cast slot (D2b)

Two quick-action slots — **choose a protagonist** (a Character) and **choose a home** (a Location). Both render as ghost cards when unset; clicking a ghost filters the sidebar to that type so the assignment path is one hop (the actual setter lives on the element-detail header — the person-pin / home-pin, which Captain couldn't find from home, 2026-07-10). When set, the slot shows the favorite's card. Both kinds always render side by side.

### 3. Woven stat line (the counts row)

Element counts per type, rendered as one **woven line** (`atlas-home-statline`) — `24 events · 12 characters · …`, not a card grid. Reads `state.data.elements`, groups by `type`. Each segment is a button: click → flips sidebar to elements mode + applies that type filter. Always rendered (empty with reserved min-height at zero elements, so the first element doesn't shift the layout below). Pin/marker/zone counts excluded (map artifacts, not content).

### 4. Chart strip (the "starred chart", S15)

A **static render of the world's tableau** — the same default the Charts room lands on (`buildChartStrip` → `tableauScope` via `renderChartView(…, {layout:'strip'})`). Cast (protagonist/home) rides into the freeze so it reads cyan; every node carries a ref so a click lands in the Charts room focused on that element. Hidden below 3 dated nodes. This slot is the old timeline-mini's location, now driven by the real chart pipeline. (Saved charts no longer hijack the strip — always the tableau, so home previews exactly what the room opens to; S256.)

**Labels never touch** (S382, #121; Skeld's pre-smoke found Admiral Splashworth over its neighbour): `layoutStrip` in `chart-static.ts` places anchors and cast first, then the rest, each in date order on the nearest free row (centre-out), with its label to the right, else to the left, else none. On a row no label touches a glyph or another label; a node is never dropped, and when every row is full at a node's date, the labels in its way give way, plain names before kept ones. A label paints over a dark knockout, so a range line runs behind a name, not through it. The property is a seeded unit test (`tests/unit/chart-strip-layout.test.ts`).

### 5. The desk — Continue + Recent

One list (`buildDesk`), newest first. A **Continue strip** surfaces the last writing narrative, last map, and last edited element; the remaining recent elements join the SAME row style below. Each row's verb comes from the room it opens — **Write** for tree narratives, **Map** for maps, **Edit** otherwise (**Created** when the element was never touched since birth). Rows route via `openElementTarget(el, worldId)` to the room the element actually lives in. Excludes pins/markers/zones.

---

## Superseded layout (historical)

*The sections below describe the pre-D2 home (count-card grid, compact timeline-mini, boxed quick actions). They were removed at session 248 (workplan H2-H6); the timeline-bar module (src/visualization/timeline-bar.ts) was later deleted (see DESIGN_CHARTS.md). Kept for design history — not what renders today.*

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

Embedded `timeline-bar` component (was src/visualization/timeline-bar.ts, ported from `tools/little-element-viewer/src/timeline/` — **deleted**; the strip now runs the chart pipeline / `tableauScope`).

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
