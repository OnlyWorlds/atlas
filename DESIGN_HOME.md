# Atlas — World Home Design

**Version**: 1.0 (2026-05-18)
**Status**: Locked. Building this session.
**Related**: `DESIGN.md` (Rooms model), `DESIGN_WRITING.md`, `DESIGN_PUBLISHING.md`

---

## Vision

When you open a world in atlas, you should land somewhere that says *this is your world* — not a blank pane or an event-axis viewer with no events.

World Home is the **base room** for an active world. It's where you orient when you don't have a specific destination, where you see your world's identity, where you get to the other rooms.

The legacy atlas defaulted to a Timeline view for active worlds (with no events visible if no Events existed). That was a missed identity moment. World Home replaces it.

---

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│ 🏠 ✎ 🕓 ⌕ ⬆ ⬇ 🧩 ⚙           ← Room nav strip (~32px)      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  <world name — large>                                        │
│  <description>                                               │
│  [world-type · age · tags]               ← Identity strip   │
│                                                              │
│  ─────────────────────────────────────────────────           │
│                                                              │
│  📜 24   👤 12   🏛 8   📍 15   🗺 3   ...                  │
│                                          ← Stats spread     │
│                                                              │
│  ─────────────────────────────────────────────────           │
│                                                              │
│  ◇──◆────◇──◆──◆────────◇──◆──◇─→                          │
│  (compact timeline strip — click dot or expand)             │
│                                                              │
│  ─────────────────────────────────────────────────           │
│                                                              │
│  Recent activity                                             │
│   • elementName (Character) — 3m ago                         │
│   • elementName (Location) — 14m ago                         │
│   ...                                    ← Recent (last 5)  │
│                                                              │
│  ─────────────────────────────────────────────────           │
│                                                              │
│  [+ new element]  [open writing]  [open map]                 │
│  [refresh from API]  [settings]          ← Quick actions    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

The room nav strip is shared across all rooms (see `DESIGN.md` Rooms section). It's not "part of" home — home content begins below it.

---

## Sections

### 1. Identity strip

Reads `state.active.meta` and renders:
- World **name** (large, sentence case, cyan accent)
- **Description** (text-long, multi-line)
- **World type** / **age** / **tags** (whatever metadata exists on `world.json`)

v1: read-only. Click-to-edit deferred — user navigates to settings to edit world meta. Inline-edit is a polish bout.

### 2. Stats spread

Element counts per type. Reads `state.data.elements`, groups by `type`, renders icon + count row.

Click a type icon → flips sidebar to elements mode + applies that type filter. Bridges home and elements discovery.

Visual: horizontal row of compact `<icon><count>` tiles. Wraps if needed. Pin/marker/zone counts hidden (they're map artifacts, not content elements).

### 3. Compact timeline

Embedded `timeline-bar` component (see `src/visualization/timeline-bar.ts`, ported from `tools/little-element-viewer/src/timeline/`).

Compact mode: ~100px tall. Multi-row dot binning across temporal elements. Click dot → element room. Click empty axis (or "expand" affordance) → full timeline room (`#/w/<id>/timeline`).

v1 features: temporal field extraction + axis + dot placement + click + hover tooltip. Deferred: narrative bars, zoom/pan, filter toggles, expand-collapse.

### 4. Recent activity

Reads `state.data.elements`, sorts by `local_updated_at` descending, takes top 5.

Each row: element type icon + name + relative time ("3m ago"). Click → element room.

Excludes pins/markers/zones (less useful for "what was I working on" UX).

### 5. Quick actions row

Buttons:
- **+ new element** → opens `ElementCreateModal`
- **open writing** → navigates to `#/w/<id>/writing`
- **open map** → if any maps exist, opens the first one as a right-pane tab; else opens map-create modal
- **refresh from API** → visible only if world is api-linked, calls `engine.pullNow()`
- **settings** → navigates to `#/w/<id>/settings`

Visual: row of compound icon buttons (icon + label), matches existing button patterns.

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

- **#31** (in DESIGN.md): Room nav strip mounts to `shell.middleRoomNav`, room content to `shell.middleContent`. Middle pane is a flex column.
- **#32** (in DESIGN.md): Esc clears `selectedElementId` and navigates to home. Clicking the selected element row in sidebar toggles off (same effect).

---

## Deferred for future bouts

- **Click-to-edit identity** (name, description inline edit)
- **Pinned/featured element** card on home
- **Mini graph preview** (relationship visualization snippet)
- **Customize home layout** (which sections, in what order, hide/show)
- **Empty-world onboarding** (when `state.data.elements` is empty, show "your world is empty — start here" with create CTAs)
- **Multi-world overview** (Worlds mode in sidebar already covers this; not a home concern)

---

## What home is NOT

- Not a dashboard with editable widgets — fixed sections, opinionated layout
- Not a feed of API activity / sync log — that lives in settings
- Not a search surface — search has its own room
- Not a kitchen sink — anything that doesn't fit the "world identity at a glance" frame goes in its own room
