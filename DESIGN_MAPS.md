# Atlas — Maps Subsystem Design

**Version**: 1.1 (2026-05-18) — foundation design; bout-sequence history archived to `docs-archive/PROGRESS-history.md`.
**Status**: All M1-M7 + N1/N2/MR + L0/S/MW/NPM bouts shipped (sessions 208-210). XR (ghost pins) **shipped** — see §3.8 (`src/tabs/right/ghost-pins.ts`) (corrected 2026-07-22, S309; the earlier "dropped session 221" line was stale).
**Supersedes**: the "Map Images in API Mode" section in `DESIGN.md` (image precedence has changed — `image_url` now wins).
**Scope**: The map subsystem — domain model, tree organization, UI surfaces, image sources, test fixtures, and the deferred-work pile. Does not cover pin styling (a later pass), zone semantics beyond deferral notes, or marker work.

---

## Why this doc exists

The map subsystem touches four schema relations (`parent_map`, `location`, `hierarchy`, pin-element-link), the Location hierarchy that Maps optionally anchor to, and a UI tree view that has to merge two organizing principles cleanly. Cramming that into `DESIGN.md` would dilute its architectural focus. This file is the stable reference for everything maps; `DESIGN.md` keeps a one-paragraph pointer.

The same pattern fits future subsystems (`DESIGN_TIMELINES.md`, `DESIGN_WRITING.md`) as they reach foundation-design weight.

---

## Table of contents

1. [Domain model](#1-domain-model)
2. [Tree-build algorithm](#2-tree-build-algorithm)
3. [UI surfaces](#3-ui-surfaces)
4. [Image source rules](#4-image-source-rules)
5. [Tab state across world switches](#5-tab-state-across-world-switches)
6. [Test world fixtures](#6-test-world-fixtures)
7. [Schema-updates pile](#7-schema-updates-pile)
8. [Open extensions](#8-open-extensions)
9. [Out of scope](#9-out-of-scope)

(Section numbers §10/§10b/§10c — the original bout sequence — are vacant; content archived to `docs-archive/PROGRESS-history.md`. Renumbering would break ~25 cross-references in `src/`; numbering retained for stability.)

11. [Map visual settings](#11-map-visual-settings-per-map-prefs-popover)
12. [Canvas toolbar](#12-canvas-toolbar-always-visible-above-the-leaflet-canvas)
13. [Zone chip strip → toolbar dropdown](#13-zone-chip-strip--toolbar-dropdown-revised-session-217-zc9)
15. [Map styles: a map drawn from its own zones](#15-map-styles-a-map-drawn-from-its-own-zones-365-153-s423-s426)

---

## 1. Domain model

### 1.1 Map fields and their meaning

Atlas uses these OW Map schema fields (confirmed in SDK `index.d.ts:528-536, 1900-1926`):

| Field | Source | Atlas semantic |
|---|---|---|
| `id`, `name`, `description`, `supertype`, `subtype` | BaseElement | standard |
| `image_url` | BaseElement | **canonical** image. If set, displayed. Pushed to API. |
| `width`, `height`, `depth` | Map | canvas dimensions (depth reserved, unused) |
| `background_color` | Map | fallback canvas color; atlas auto-extracts edge color from image too |
| `hierarchy` | Map | **sibling ordering only** — see §1.3 |
| `parent_map` | Map | "this map is geographically within the parent's bounds" — see §1.2 |
| `location` | Map | "this map is OF this place" — see §1.2 |

Atlas-extension fields (stored on disk, not pushed to API):

| Field | Purpose |
|---|---|
| `image_media_id` | Reference to a local media item (the local-image fallback) |

### 1.2 The two linking relations

A map can have `parent_map`, `location`, both, or neither.

**`parent_map`** — explicit nesting. Means "this map is geographically within the parent map's boundaries." Example: a Castle Interior map's parent_map is the City map. Not a zoom — different content, different scale, but the castle is geographically inside the city. Renders as direct nesting in the tree.

**`location`** — anchors a map to a Location element. Means "this map is OF this place." Example: the Eldoria City map has `location = Eldoria` (a Location element). The map doesn't claim to BE Eldoria — it's the map artifact representing Eldoria.

**When both are present, `parent_map` wins for tree placement.** Location still appears as a chip on the map row (informational), but the explicit parent_map link controls where the map sits in the tree. This lets a user override the inferred placement when needed.

**When only `location` is present, tree placement is INFERRED** from the Location's parent chain — see §2.

### 1.3 Hierarchy is sibling order — nothing else

`hierarchy` is a number on each map. Its only meaning: ordering among siblings.

- **Siblings under a `parent_map`** are sorted by ascending `hierarchy`. Ties broken alphabetically.
- **Siblings co-located** (multiple maps with the same `location` and no `parent_map`) are sorted the same way.

There is no absolute-scale semantic ("hierarchy 0 = multiverse, 1 = universe..."). That convention emerges naturally from a properly-nested parent_map tree without atlas enforcing field meaning. Users who want explicit scale-tagging can use `supertype`/`subtype` on the map.

The legacy maptool's mixed semantics (scale magnitude AND ordering) collapse into one rule here. Schema description update is queued — see §7.

### 1.4 Pins and zones

**Pins target locations and other content elements only — NOT maps.** Schema permits pin-to-map; atlas UI does not encourage or surface it. Click-through behavior (§3.6) opens a Location's primary map when relevant — no need for direct map-pins.

**Zones currently target only the map they're drawn on** (`Zone.map`). No `target_map` field exists on Zone in the SDK. We considered using zones as "this region IS sub-map X" but **defer** that decision until after the map foundation ships — see §8.

### 1.5 What atlas infers, what the user sets

**Principle: minimize user setup.** Most maps should be creatable with name + location + image. Atlas infers placement from there.

Required at create time:
- `name` (string)

Optional, common:
- `location` (single-link picker)
- `image_url` (text)
- `image_media_id` (file upload, atlas-local)

Advanced (collapsed by default in create modal):
- `parent_map` (override the inferred placement)
- `hierarchy` (only matters when 2+ siblings exist)
- `width`, `height`, `background_color`

---

## 2. Tree-build algorithm

The maps tab renders ONE unified tree built from maps + locations.

**Inputs**:
- `maps: Map[]` — all maps in the world
- `locations: Location[]` — all locations in the world (needed for parent chain walking)

**Output**: `TreeNode[]` where `TreeNode = { map, children: TreeNode[] }`. Tree is ordered.

**Algorithm**:

```
function buildMapTree(maps, locations):
    # Phase 1: explicit parent_map edges
    nodes = {}
    for each map m in maps:
        nodes[m.id] = { map: m, children: [] }

    roots = []
    for each map m in maps:
        if m.parent_map and nodes[m.parent_map]:
            nodes[m.parent_map].children.append(nodes[m.id])
        else if m.parent_map and NOT nodes[m.parent_map]:
            # dangling parent_map — treat as root, attach a "broken link" warning
            roots.append(nodes[m.id])
        else:
            roots.append(nodes[m.id])

    # Phase 2: location-inferred placement
    # Loc-bound maps without explicit parent_map can be slotted under
    # the nearest ancestor-location's map.
    for each node in roots (snapshot before mutation):
        m = node.map
        if m.parent_map:
            continue                               # already placed
        if not m.location:
            continue                               # truly orphan
        inferredParent = findInferredParent(m, maps, locations)
        if inferredParent and inferredParent != m.id:
            nodes[inferredParent].children.append(node)
            roots.remove(node)
        # else: stay at root with location chip (orphan loc-bound — §2.2)

    # Phase 3: sort siblings within every group
    sortRecursively(roots)
    for each node in nodes:
        sortRecursively(node.children)

    return roots


function findInferredParent(m, maps, locations):
    # Walk Location.parent_location chain from m.location upward.
    # The first ancestor location that has any map (by Map.location)
    # supplies that map as inferred parent_map.
    locId = m.location
    while locId:
        loc = locations.find(id == locId)
        if not loc: break
        locId = loc.parent_location
        if locId:
            ancestorMap = maps.find(m2 => m2.location == locId)
            if ancestorMap:
                return ancestorMap.id
    return null


function sortRecursively(siblings):
    siblings.sort by ascending hierarchy (default 0), then alphabetical by name
```

**Properties**:
- Pure function. Given the same inputs, same output. Unit-testable.
- Stable: idempotent across calls.
- Handles cycles defensively (a future hazard if `parent_map` ever forms a loop — see §2.3).
- Dangling `parent_map` (points to a deleted map) doesn't crash; the map surfaces at root with a warning chip.

### 2.1 Worked examples

**World A — pure parent_map** (no locations):

```
Multiverse (hierarchy=0)
├── Universe Alpha (parent_map=Multiverse, hierarchy=0)
│   └── Continent Aurora (parent_map=Universe Alpha)
│       └── Eldoria City (parent_map=Continent Aurora)
│           └── Castle Interior (parent_map=Eldoria City)
└── Universe Beta (parent_map=Multiverse, hierarchy=1)
    └── ... (similar chain)
```

**World B — pure location-based** (no parent_map set):

```
Locations: Country → Province → City → District → Building (parent chain)
Maps: Country Map (location=Country), City Map (location=City), Building Map (location=Building)

Tree (via inference):
Country Map [location=Country]
├── City Map [location=City]     (inferred: City's parent_location chain hits Country)
│   └── Building Map [location=Building]   (inferred: chain Building→District→City)
```

Province and District have no maps; tree-build hops over them transparently.

**World C — messy mix** (orphan loc-bound, multi-map locations, explicit override):

```
Maps:
- World Overview (no location, no parent_map)
- Eldoria City (location=Eldoria, no parent_map; Eldoria.parent_location=Aurora; Aurora has no map; Aurora.parent_location=null)
- Castle Floor 1 (location=Castle, no parent_map; Castle.parent_location=Eldoria)
- Castle Floor 2 (location=Castle, hierarchy=1)
- Throne Room (location=Castle, hierarchy=2)
- Unrelated Tavern Interior (no location, parent_map=Eldoria City)    # explicit override

Tree:
World Overview
Eldoria City [location chip: Eldoria]
├── Castle Floor 1 [location chip: Castle]
├── Castle Floor 2 [location chip: Castle]
├── Throne Room [location chip: Castle]
└── Unrelated Tavern Interior     # explicit parent_map override
```

Eldoria City surfaces at root because Aurora (its location's parent) has no map. The location chip carries the placement signal. The three Castle maps are siblings under Eldoria City (inferred via chain Castle → Eldoria), sorted by hierarchy.

### 2.2 Orphan loc-bound maps

A "loc-bound" map whose location's ancestor chain has no map ends up at root with a location chip. No "uncategorized" section. The chip is enough — it signals "this map is anchored to a place, just doesn't fit anyone else's tree yet."

### 2.3 Cycle defense

If `parent_map` ever forms a loop (A → B → A), build with a visited-set short-circuit: when assembling Phase 1 edges, detect when assigning a node would create a cycle and surface those maps at root with a "broken parent_map" warning chip. Better to render imperfectly than crash.

---

## 3. UI surfaces

### 3.1 Map index tab

The first tab in the right pane (pinned). Renders the tree from §2.

Row shape (per map):

```
[icon] [hierarchy depth indent] [name] [location chip if loc-bound] [pin count badge if >0] [image badge if has image]
                                                                                              [delete on hover]
```

Click row → open or focus the map's tab.
Collapse/expand affordance per node with children (saved per-world in registry).
Sort: tree-imposed; no user-controlled re-sort in v1.

Header: `Maps` title + `+ New map` button (same as today).

Empty state: same as today — guidance to create the first map.

### 3.2 Map create modal — simplified

Today's modal collects name, location, image_url, image_file. The new modal collects:

```
Name *                  [_____________]
Location (optional)     [+ pick location]
Image URL (optional)    [https://___]
Local image (optional)  [Choose file]
                        ⓘ Used as fallback when URL is empty. Stored locally only.

[advanced ▾]
  Parent map (override)   [+ pick map]
  Hierarchy (sibling order)  [____]
  Background color           [____]

[Cancel]  [Create]
```

Advanced section is collapsed by default. The hint text under "Local image" updates dynamically — if URL has text, the hint becomes a warning chip: *"URL is set — local image will be stored but the URL will display."*

### 3.3 Map detail / settings

When a map is the selected element, the middle pane shows the standard element-detail editor (works today). All map fields edit-in-place via the schema-driven editor. The map's tab on the right shows the canvas.

### 3.4 Lock toggle — REMOVED (session 210)

Lock semantics existed to suppress pin-click auto-open. Auto-open itself was removed at the end of session 209 (both sidebar-click and pin-click paths). With auto-open gone, lock had no observable behavior to gate, so the icon, the single-locked-at-a-time logic, and the per-tab `locked` field have been deleted.

If auto-open returns later (e.g. as an opt-in setting), revive the lock model from git history. Until then: explicit clicks via the top-bar affordances in §3.5 are the only path to opening a map from an element, and locking has nothing to constrain.

### 3.5 Map affordances in element-detail top bar (revised session 209)

The v1.0 inline "map presence" widget at the BOTTOM of the element-detail body was implemented in M7. Smoke testing showed it was buried — visible but easy to miss, and the visual weight felt wrong for what is core navigation. Replacement: **fold map and pin affordances into the element-detail top bar**, the existing icon row that currently carries save/trash/create-pin.

**Revised layout (reading left → right):**

For **Location elements**:
```
[map] [map] [map]  |  [pin] [pin] [pin]  |  [+ map]  [+ pin]  [save]  [trash]
   ↑ existing maps      ↑ existing pins      ↑ create   ↑ create
   anchored here        for this element     map        pin
   (cyan map icons,     (subtler, smaller    (solid,    (existing)
    click to open)      pin icons, click     same
                        opens map +          weight as
                        camera-pans to       create-pin)
                        pin)
```

For **non-Location elements** (Character, Object, etc.):
```
[pin] [pin] [pin]  |  [+ pin]  [save]  [trash]
   ↑ existing pins      ↑ create
   only                 pin
```

**Rules**:
- `[map]` icons render only for Locations. Click → open that map tab.
- `[pin]` icons render for ALL element types. Click → open the pin's map AND camera-pan to that pin's coords. Less visual weight than the create-pin button (smaller, muted-cyan).
- `[+ map]` button renders only for Locations. Click → opens MapCreateModal pre-filled with this location selected, and a suggested name like `Map of <Location Name>` (user editable).
- `[+ pin]` button retains existing behavior.
- When a Location has 0 maps AND 0 pins, the `[+ map]` button still renders (it's the affordance to start), but no existing-icon clusters render.
- Visual ordering invariant: existing affordances on the LEFT, create buttons in the MIDDLE, file/state actions (save / trash) anchored RIGHT.

**Maps Settings section** (new, in the existing Settings panel):
- Toggle: "Show map names alongside map icons in element header" — default OFF. When ON, each `[map]` icon in the top bar gets a small name label.
- Future toggles for atlas map behavior live here too (e.g. "auto-show characters at location on maps" once §8 lands).

**Inline body widget removed**: the M7 "Maps" section in the element-detail body is deleted. Top bar carries all map affordances.

**Why the redesign**: the top bar is where the user's eye lands after navigating to an element. Putting map navigation there makes it discoverable in-flow. The inline section was too easy to miss past a long body of fields.

### 3.6 Pin click-through and element selection (revised session 210)

**Auto-open is REMOVED entirely** (both sidebar-click and pin-click). Clicking an element anywhere in atlas — sidebar row, pin on a map, ghost pin, chip in element-detail — sets `selectedElementId` and navigates to the element-detail route. The right pane does NOT change unless the user explicitly clicks a `[map]` or `[pin]` affordance in the element-detail top bar (§3.5).

Rationale: smoke showed that auto-opening the right pane on element selection was disorienting — users wanted to read element details, not have their map view jump around. Making "open this element's map" an explicit gesture (§3.5 cluster click) keeps the right pane stable until the user asks for a change.

Pin-click flow today:
1. User clicks a pin on a map → `selectedElementId` patched, route changes to `#/w/<id>/element/<eid>` (or `#/w/<id>/map/<mid>/element/<eid>` if a map tab is active).
2. Middle pane re-renders to element-detail.
3. Right pane stays put.

To navigate the user TO a map, see §3.5 (top-bar `[map]` / `[pin]` clusters).

**Into a submap and back up** (1.25, #139, the Captain's ask; `src/tabs/right/map-submap-door.ts`). The click still only selects. While the selected element is a Location with maps of its own (`map.location`, other than the map on screen) and has a pin on the visible map, a door floats above and right of that pin: "Open <map>", up to three, in `getAssociatedMaps` order. The pin's map badge (`hasLinkedSubMap`) says a door exists before the click. A map with a parent in the tree (explicit `parent_map`, else inferred, §2) heads its toolbar with "↑ <parent>". Both swap the CURRENT map tab in place (`swapMapTab`), so a walk down and back up keeps one tab; a target already open in another tab is focused. Guards: `tests/unit/map-submap-door.test.ts`, `tests/e2e/submap-door.spec.ts` (revert-checked red).

### 3.7 Right-click on map — place existing OR create new (planned, session 209)

Current behavior: right-click → opens element-create modal → new element + drops pin pointing at it. Renamed and extended to support **placing existing elements**:

**Modal name**: "New pin" (was "New element from map").

**Form** (same shape as ElementCreateModal):
- Name field (autofocus)
- Category ghost-autocomplete field (the existing type-input)
- Type grid

**Ghost-completion behavior**:
- As user types in the name field, scan elements of the currently-selected category whose name starts with the typed text.
- If a match exists: render a ghost suffix in the name field (mirroring the type-field ghost pattern).
- **TAB at end of typed input** accepts the ghost → name input shows full element name, button label flips `Create` → `Place`, a small chip near the modal title signals `placing existing · <category>`.
- **Multi-match tiebreaker**: prefer the element with the latest `local_updated_at`. (TAB-to-cycle deferred.)
- **Submit `Place`**: drops a pin pointing at the existing element. No element creation.
- **Submit `Create`** (default): creates new element AND drops pin. Current behavior.

**Category filter**: only matches within the currently-selected category. (Maps category is excluded entirely per §1.4 — pins don't target maps.)

---

### 3.8 Ghost pins — right-click pin to reveal related elements

**Concept**: a real pin marks "this element is here." A **ghost pin** is a translucent, computed-display marker showing "this OTHER element is also at this location." Ghosts are ephemeral — visual scaffolding for exploration, not stored data.

**Trigger**: right-click on a real (non-ghost) pin.
- The pin's referenced element must itself have a `location` field set. If absent, toast: *"this pin's element has no location set — nothing to ghost."*
- Atlas looks up the pin's element's `location` → finds all elements (across the world) whose `location` field points at the same location, AND who don't already have a real pin on this map.
- For each candidate, spawn a ghost pin in a circle around the source pin (radius ~70px, angles evenly spaced).
- If the same source pin is right-clicked again AND it currently has active ghosts → clear all ghosts spawned from this pin (toggle off).

**Eligible element types**: those with a `location: single_link → location` field in the SDK FIELD_SCHEMA. Verified at runtime; no hardcoded list. Currently (SDK 2.2.x): `character, creature, object`. `map` also has the field but is excluded since pins don't target maps (§1.4).

**Visual treatment**:
- Same canvas icon as real pins (via `pin-visuals.ts`), rendered at ~40% opacity.
- No name label by default. Hover reveals a tooltip with the element name + type.
- Visually distinct from real pins (translucent = "not committed").

**Interactions on a ghost pin**:
- **Left click**: selects the element (sets `selectedElementId`, navigates to element-detail in middle pane). Does NOT remove the ghost. Does NOT open another map.
- **Right click**: prunes just that single ghost from the cache. Other ghosts (from this source or others) remain.
- **Drag**: not supported. Ghosts are not placeable — they're a discovery affordance. Users who want a real pin at a specific spot use the existing pin-placement flow.

**Persistence**:
- In-memory per map tab. Stored as a module-level cache keyed by `mapId → { ghosts: Map<ghostId, {sourcePinId, elementId, x, y}> }`.
- Cleared automatically on: map tab close, world switch (`disposeAllMapTabs`), map element delete.
- NOT persisted to disk, NOT synced to OW, NOT stored in localStorage. Reload = ghosts gone. Map tab close + reopen = ghosts gone.
- Multiple source pins can have their own ghost groups active simultaneously. Each source pin's group toggles independently.

**Spatial layout**: ghosts circle the source pin at fixed radius. For N candidates, angles = `(2π/N) * i` starting from due north (i.e. straight up from the source pin). If N is small (1-2), this leaves the layout sparse; if N is large (10+), ghosts cluster tightly but evenly. No collision avoidance against existing pins — ghosts overlap if they must (they're ephemeral; user can prune).

**Why no toggle in Settings or on map canvas**: the right-click gesture is itself the toggle. Adding a settings toggle would create two sources of truth ("default state" vs "current state per-tab") that would conflict. The simplest mental model: ghosts only exist while you're actively exploring; they appear when you ask, disappear when you don't.

**Edge cases**:
- Source pin's element has `location` set, but no OTHER elements share that location → toast: *"no other elements at this location."*
- Source pin's element has a `location` that points at a now-deleted Location → still works; we match by location id, not by location existence.
- The map's anchored location (`map.location`) is NOT auto-included as a ghost candidate — that's the map's own context, not a discovery.

---

## 4. Image source rules

**Two slots per map**: `image_url` (string, schema field, canonical, syncs to API) and `image_media_id` (atlas-extension, references a local file in `media/`, never syncs).

**Display precedence** (same in local-only AND api-linked worlds):
1. If `image_url` is non-empty → load and display it.
2. Else if `image_media_id` is set → load the local blob and display it.
3. Else → the sized FLAT CANVAS (§4.2) — imageless maps are first-class since S300 (the pre-S300 grid fallback + view/placement refusals are retired).

**Edge-color extraction** runs on whichever image actually rendered. Cached per URL (avoid network re-fetch on every mount).

**UI badges**:
- Map index row with image badge → tooltip "image: URL" or "image: local file" depending on which is rendering.
- Map create modal — see §3.2 hint dynamics.
- Map detail — when both are set, show a small indicator near the image_url field: *"local image stored as fallback (not shown while URL is set)."*

**Local image on EXISTING maps (S253)**: the element editor shows a maps-only "Local image" row directly under Image URL (`src/middle/element-detail-map-image.ts`): choose/replace/clear a folder-stored file (addMedia 'base-image' → `image_media_id`). Same primitives as the create flow. Note: the create modal's configure-existing mode has zero callers (dead path — do not wire without exercising it first).

**Push behavior on api-linked worlds** (already correct in atlas-extension layer): `image_url` syncs. `image_media_id` and the actual media blob stay local. Other machines accessing the same api-linked world only see whatever `image_url` provides.

**Implication**: a user with only `image_media_id` (no URL) on an api-linked world has a map that displays locally but shows as image-less on other machines. We surface this in the maps tab row as a soft hint: *"local-only image — set a URL to share."* Same hint used for orphan loc-bound surfaces — non-blocking, just informational.

### 4.1 Pin coordinates anchor to the stored canvas dims (session 209, reshaped S300)

**Origin (S361, atlas 1.8)**: `x`/`y` run from the map's BOTTOM-left, the schema's origin, and ARE Leaflet CRS.Simple `lng`/`lat` (`CoordinateUtils.ts`, no height in the conversion). Before 1.8 atlas stored y top-down; the map gear popover's "Flip pins and zones" mirrors one map once. DESIGN_LAWS convention 97.

Pins anchor to the map's coordinate system, whose size is the stored `width`/`height`. The session-209 image gate ("pin placement refused without an image") existed to prevent the "pins-placed-on-default-2000-grid-then-canvas-shrinks-to-image" bug; since S300 that protection comes from **durable stored dims** instead of a refusal — every map carries `width`/`height` (decoded from its image, or the §4.2 imageless default), so the coordinate space never silently changes shape under the pins. The gate and its toasts are removed from all four sites (placement click, contextual right-click, sidebar drag-drop, zone drawing).

**Implication when changing an image**: pins keep their stored coordinates (measured from the bottom edge since 1.8). If the new image has different dimensions, pin display positions may look "off" relative to image content — but the pins didn't move; the world under them did. Atlas does not auto-rescale pin coords on image change, by design. Users can manually adjust or accept the new positions.

**Adding an image to a blank canvas (S300b — the ONE exception to coords-kept)**: the blank square was never geography, so the sketch's RELATIVE layout is its meaning. Pins AND zone markers scale proportionally (`core/map-spatial-scale.ts` kernel, applied via `middle/map-attach-scale.ts` through the per-id chains) from the old canvas into the decoded image dims — no options fork (border-clamp piles pins on edges, keep-outside strands them invisibly, remove is what delete is for; Captain's call 2026-07-20). The local-image row (which can veto pre-write) confirms first ("N pins and M zone points will scale with the canvas onto the image"); the `image_url` field edit (already committed at hook time) scales after decode and toasts. Both paths re-persist `width`/`height` from the decoded image (the local-attach path previously skipped this when dims were already stored — the stretch trap, closed in S300). Image→image swaps still never scale.

**Small images (S300, Freek)**: when an attached image's shorter side is under `SMALL_MAP_IMAGE_MIN_SIDE` (600px), attach paths show a soft "pin placement will be coarse" hint. Never a block.

### 4.2 Imageless maps — the flat canvas (S300)

An imageless map is a first-class working surface, not a config-pending state:

- **Stored size**: maps created without an image are stamped `width = height = IMAGELESS_MAP_SIZE` (2000, square — Captain's call 2026-07-20). Legacy imageless maps get the same dims persisted once on first tab open (mirrors the URL-decode persist). Stored dims make the space identical on every device; the constant can change without moving anyone's pins.
- **Backdrop**: one flat rectangle spanning the canvas — `background_color` when set, a quiet translucent panel tone otherwise, hairline cyan edge marking the bounds. No default grid (flat, Captain's call); the ⚙ "Show grid" pref composes a grid overlay on top for users who want scaffolding. `sourceKey` includes `background_color` so edits re-apply live.
- **Full capability**: the tab opens normally (openMapTab refusal + element-detail divert removed; the S254 `ensureMapTabOpen` recursion guard is gone with it), pins place, zones draw, drag-drop works. The map-index row's muted-imageless treatment is retired.
- **Create flow**: the create modal auto-opens the tab with or without an image ("place pins now, add art later" — and when the art arrives, the sketch scales onto it, §4.1).
- **Broken image URLs** (S300b): when the browser can't load a map's `image_url` (404, CORS, dead host), the tab falls back to the flat canvas + an honest chip instead of Leaflet's white void (`setBackgroundImage`'s `onError`). Stored dims keep the coordinate space; nothing moves.
- **Dims-flip remount** (right-pane `lastActiveMapDimsKey`): when the active map's stored dims change, the tab disposes + remounts so the manager/interactions/zone overlay convert in the new space; the saved camera is CLEARED first (it targeted the old space — S300b). Background tabs get cache-evicted by `refreshCachedBackgrounds` instead; do not add a second active-tab remount path (it races this one into an empty pane — S300 close-gate follow-up).
- **Sharing**: unchanged — `freezeMapBlock` ships only maps with a public `https` image_url (D3), so imageless maps don't publish as map blocks; local-media maps were already in that boat. Revisit if a "flat canvas on the published page" ask ever sharpens.

**Placement-mode feedback (S299)**: arming placement (the +pin button, or the tour) now gives real feedback — the +pin icon lights cyan (`[data-action="pin-element"].active`), a "Click the map to place <name>" banner floats over the active map (`src/tabs/right/map-placement-hint.ts`, a boot-installed state watcher), the map cursor becomes a crosshair (`body.atlas-placing` — the class was defined since session 219 but never applied until now), and **Esc cancels** (owned via a skip in the deselect-to-home hotkey guard). Before S299 clicking +pin gave no visible state at all.

**Pin labels default (S299)**: `FACTORY_DEFAULTS.pin_labels` is now `'always'` (was `'hover'`), matching `zone_labels` — pins are discoverable at a glance out of the box. Per-map ⚙ / the settings Maps-defaults editor can dial back to `'hover'`/`'threshold'`/`'never'`; existing saved user defaults are untouched.

---

## 5. Tab state across world switches (revised session 209)

**Decision**: `ui.rightTabs` is GLOBAL across world switches. Tabs persist when changing worlds; tabs whose `mapId` isn't in the current world's `data.elements` render as stale (darkened, italic, cloud_off icon, click anywhere on the tab to close). User decides when to close cross-world tabs.

**Why this model**: per-world tab persistence (the original M2 attempt) auto-replaced tabs on world switch, which felt like "tabs closing" to the user even though they were technically being snapshotted. The global model with stale-rendering matches the user's mental model: "my open tabs stay where I put them; ones from other worlds are dimmed but recoverable."

**Implementation** (current):
- `right-pane.ts` checks each tab's mapId against `data.elements` on every render. Missing → `atlas-tab-stale` class + click handler that closes (vs activates).
- Stale tab body pane (`map-tab.ts`) shows a friendly "this map isn't in the current world" state with an explicit Close button.
- `activateWorld` does NOT touch `ui.rightTabs` on world switch. Tabs persist.
- Per-world snapshot helpers (`setWorldRightTabs` / `getWorldRightTabs`) were removed in the 2026-07-10 dead-export cleanup (dead-by-design since tabs went global in session 209); `right_tabs` stays on `WorldRegistryEntry` as a documented-but-unused field if per-world persistence is ever revived.

---

## 6. Test world fixtures

Three OW worlds. Skeld creates them via API after this doc lands. Each is a self-contained test case for the tree-builder.

### World A — Pure parent_map nesting (sci-fi multiverse)

No Location elements. Pure parent_map chain.

```
Maps:
  Multiverse                          hierarchy=0
  Universe Alpha    parent=Multiverse hierarchy=0
  Universe Beta     parent=Multiverse hierarchy=1
  Continent Aurora  parent=Alpha      hierarchy=0
  Continent Borealis parent=Alpha     hierarchy=1
  Continent Caelum  parent=Beta       hierarchy=0
  Eldoria City      parent=Aurora     hierarchy=0
  Twin City         parent=Aurora     hierarchy=1
  Castle Interior   parent=Eldoria    hierarchy=0
```

Tree-build expected output: 1 root (Multiverse), full 4-deep tree.

### World B — Pure location-based (TTRPG city)

Maps anchor to Locations only; no explicit parent_map.

```
Locations (with parent_location):
  Region        parent=null
  City          parent=Region
  District N    parent=City
  District S    parent=City
  Block A       parent=District N
  Tavern        parent=Block A
  Castle        parent=City

Maps:
  Region Overview    location=Region
  City Map           location=City
  Tavern Interior    location=Tavern
  Castle Map         location=Castle
```

Tree-build expected output: 1 root (Region Overview). City Map under it (chain City→Region). Tavern Interior under City Map (chain Tavern→Block A→District N→City). Castle Map under City Map (chain Castle→City). Districts and Block A have no map; the algorithm hops past them.

### World C — Messy mix

Combines explicit overrides, orphans, multi-map locations, dangling references.

```
Locations:
  Aurora       parent=null
  Eldoria      parent=Aurora
  Castle       parent=Eldoria
  Tavern Loc   parent=null (orphan branch)

Maps:
  World Overview                                                     (general, no location)
  Eldoria City        location=Eldoria                                (loc-bound, Aurora has no map → surfaces at root with chip)
  Castle Floor 1      location=Castle                                 (inferred under Eldoria City)
  Castle Floor 2      location=Castle  hierarchy=1
  Throne Room         location=Castle  hierarchy=2
  Free-floating Tavern  parent=Eldoria City                            (explicit override; no location field)
  Orphan Map          location=Tavern Loc                              (orphan branch, surfaces at root with chip)
  Broken Child        parent=<nonexistent uuid>                        (dangling parent_map → root + warning)
```

Tree-build expected output:
- 4 roots, sorted by hierarchy (all 0 here) then alpha: `Broken Child`, `Eldoria City`, `Orphan Map`, `World Overview`.
- Under Eldoria City: Castle Floor 1, Free-floating Tavern (both hierarchy 0, alpha-tied), then Castle Floor 2 (h=1), then Throne Room (h=2).
- See `tests/unit/map-tree.test.ts` for the formal expectation (a snapshot string).

Edge cases this exercises: location-inferred placement, hierarchy sort, explicit override coexisting with inferred siblings, orphan loc-bound, dangling parent_map.

**Sibling ordering reminder**: the algorithm sorts every sibling group by `hierarchy` ascending then `name` alphabetically. There's no separate "location-inferred first, explicit parent_map second" grouping — they're peers in the same sibling group. A description's prose hint should never be load-bearing; the tests are the contract.

### Fixture format

Each world's fixture lives at `tools/atlas/tests/fixtures/map-worlds/world-{a,b,c}.json` — pure data, importable into both unit tests and Skeld's API-population script.

---

## 7. Schema-updates pile

To submit after maps work stabilizes. Likely a single council motion bundling the description updates.

| Field | Current description (assumed) | Proposed description |
|---|---|---|
| `Map.hierarchy` | (scale magnitude / mixed) | "Sibling ordering within a parent_map group or among maps sharing the same location. Lower comes first." |
| `Map.parent_map` | (zoom / unclear) | "Reference to a map that geographically contains this one. Used for explicit map nesting." |
| `Map.location` | (vague) | "Reference to the Location this map represents. Atlas infers placement in the map tree from this when parent_map is absent." |
| `Pin.element_type` | (technical) | possibly note that atlas-style UIs may restrict to non-spatial targets |

Pure documentation pass — no field changes, no schema breakage. Council briefing draft to come after the bouts land.

---

## 8. Open extensions

These are explicitly OUT of v1 scope but parked for later consideration. Not foundation work.

- ~~**Drag-to-reorder hierarchy**~~ — **Shipped session 212** as Bout DR. Same-sibling-group only; drop above/below computed from cursor-Y vs row midpoint.
- ~~**Pin styling pass for map-having elements**~~ — **Shipped sessions 219+221**: map glyph on pins whose linked element has a sub-map. Session 221 fixed an over-eager match (was firing on all pinned elements; now correctly Locations-with-submap only).

The following were considered and explicitly dropped by Captain (session 221) — kept here for historical context, do NOT re-add to the backlog without a fresh design conversation:

- ~~**Zone-targets-map**~~ — dropped. Captain: bring up again if the use case ever sharpens.
- ~~**Map subtype as visual filter**~~ — dropped.
- ~~**Cross-element rendering on maps**~~ — dropped (ambient/ephemeral pins of "all Characters at this location"; out of scope for v1).
- ~~**Map locking via URL / shareable**~~ — dropped. Map state stays local UX pref.
- ~~**"Maps within" inverse search performance**~~ — dropped. Profile first if a real perf problem ever surfaces.
- ~~**Picker keyboard shortcut**~~ — dropped.
- ~~**Pin coord council motion**~~ — dropped (origin convention is already documented in the OW Pin schema field descriptions).

---

## 9. Out of scope

For total clarity, the following are NOT covered by this design and have separate ownership:

- Pin creation UX (already shipped — right-click + placement banner).
- Pin styling (its own future pass).
- Marker rendering and editing (separate spatial element class, not in this doc).
- Zone drawing and editing (separate, see §8 for zone-vs-map future thoughts).
- Pin coordinate rounding (`Math.round` to satisfy SDK integer requirement — minor fix, ships with Bout 2 quietly).
- Sync behavior of map fields (handled by the generic sync engine — no map-specific sync logic needed).
- Background-image upload to third-party hosting (out of scope; user pastes URL).
- Multi-floor 3D maps (`depth` field stays unused for now).

---

## 11. Map visual settings (per-map prefs popover)

Replaces the "no per-map controls" state that has stood since map work started. Per-map preferences for pin and zone rendering, accessible from a settings cog on the canvas toolbar (§12). Each map can override atlas-global defaults; defaults can be promoted from any map's current state.

### 11.1 Storage shape

Two localStorage keys:

```
atlas_map_view_defaults: MapViewPrefs     ← atlas-global defaults (single object)
atlas_map_view_prefs:    Record<mapId, Partial<MapViewPrefs>>  ← per-map overrides
```

Schema:

```ts
interface MapViewPrefs {
  pin_style:         'icon' | 'round-icon' | 'pin-shape';   // default: 'icon'
  pin_labels:        'auto' | 'always' | 'hover' | 'threshold' | 'never';  // default: 'auto' (S356; was 'always' S299)
  pin_label_threshold: number;                              // default: 6 (used iff pin_labels === 'threshold')
  pin_tint:          'type-color' | 'accent' | 'muted';     // default: 'type-color'
  show_grid:         boolean;                               // default: false
  grid_spacing:      50 | 100 | 200;                        // default: 100
  lock_pin_drag:     boolean;                               // default: false
  zone_fill_opacity: number;                                // default: 0.4
  zone_labels:       'auto' | 'always' | 'hover' | 'never'; // default: 'auto' (S356)
}
```

**`'auto'` = the density layer (S356, `tabs/right/map-label-density.ts`).** Born on Sikelia (196 pins, 319 zones, one canvas): every label that has room is shown, and a label that would overprint a higher-ranked one drops. Rank: the selected element, then pins by world degree (incoming links + log of description length, the charts room's weight), then polygon zones, then line zones, bigger screen extent first. A pin label tries below, right, left, above its icon before dropping, and never covers another pin's icon or crosses the map's edge; a dropped pin label comes back as the hover tooltip. A map prints a name once: a zone and the pin of the same name share one label, the pin's if it has room, else the zone's. (S382, #121, show's rule from a327199: S356 let the top tenth of pins by weight cover a lighter icon as a last resort, which at fit zoom on Moppetopia put Feltropolis and USS Fuzzball over their neighbours; the published page and the share preview follow the same rule in `share-page-render.ts` `declutterMapLabels`.) Re-run on every settled pan/zoom and after every pin/zone sync; boxes are computed from projected anchors + canvas-measured text (one calibration rect read per pass, zero forced layouts after), so a pass costs single-digit ms. Culling is a class (`atlas-label-culled`), never `display`, so it cannot fight the mode toggle or the hover fade. On a sparse map `'auto'` renders exactly as `'always'`.

**Label priority from world styles (S356, DESIGN_ZONES §5b)**: a zone kind whose rule sets `label_priority` competes in the pin tier (priority 1) instead of after every pin, so the big rivers keep their names at fit.

**The icon-scale rule (same module, unconditional):** a pin icon is never wider than ~70% of the median gap between this map's pins at the current zoom (`pinScaleForSpacing`, floor 0.4). Sparse maps measure a gap wider than the icon and keep scale 1, so nothing existing changed; Sikelia's pins are 17px at fit and 32px one zoom in. Re-scaling patches the rendered `<img>` in place (no `setIcon`, which would replace 196 elements a zoom).

`getEffectiveMapPrefs(mapId)` merges atlas-global defaults with the per-map partial override. UI reads only the effective object.

### 11.2 Popover surface

Click the ⚙ settings cog on the canvas toolbar → left-anchored floating panel (~320px wide, full canvas height, dark glass aesthetic matching atlas conventions). Map remains visible to its right — the user sees changes apply live.

Layout:

```
┌─ Map visual settings ────────────────────────┐
│                                              │
│  Pin style                                   │
│  ( ) icon  ( ) round + icon  ( ) pin shape   │
│                                              │
│  Pin labels                                  │
│  (•) fit  ( ) always  ( ) hover  ( ) ≤ [6] visible  ( ) never │
│                                              │
│  Pin tint                                    │
│  (•) type color  ( ) accent  ( ) muted       │
│                                              │
│  ☐ Show grid                                 │
│     Spacing: ( ) 50  (•) 100  ( ) 200 px     │
│                                              │
│  ☐ Lock pin dragging                         │
│                                              │
│  ── Zones ──                                 │
│                                              │
│  Zone fill opacity   ━━━●━━━━━━━━━━  40%     │
│                                              │
│  Zone labels                                 │
│  (•) fit  ( ) always  ( ) hover  ( ) never   │
│                                              │
├──────────────────────────────────────────────┤
│  [ Save current as default for new maps ]    │
│  [ Reset to defaults ]                       │
└──────────────────────────────────────────────┘
```

Toggle interactions apply live — every change patches state and triggers re-render. `Reset to defaults` clears the per-map override (effective prefs become atlas-global defaults). `Save current as default for new maps` copies effective prefs into atlas-global defaults.

Close: click ⚙ again, click outside the popover, or hit Escape.

### 11.3 Pin rendering response

Pin visuals layer must re-render when `pin_style`, `pin_tint`, `pin_labels`, or `pin_label_threshold` change. The `pin-visuals.ts` cache key already includes badge state (Bout PB); extend it with style + tint composition. Labels render via Leaflet's tooltip/divIcon depending on `pin_labels` mode.

### 11.4 Grid rendering

When `show_grid === true`, render a `L.GridLayer` (or a custom canvas overlay) at the configured spacing. Subtle stroke (`rgba(255,255,255,0.08)`), 1px. Visually behind the image background where present.

### 11.5 Pin drag lock

When `lock_pin_drag === true`, the pin marker creation in `map-tab-pin-drag.ts` skips wiring drag events (or the drag handler short-circuits). User can still click pins, just can't move them. Useful for "published" maps where positions should be stable.

### 11.6 Zone opacity + labels

`zone_fill_opacity` applies as default to every zone on this map. Individual zones can override via the `atlas_opacity` extension field (DESIGN_ZONES.md §5). Zone labels (rendered above the centroid as a divIcon) follow `zone_labels` mode; individual zones with `atlas_label_visible === true` may force visibility.

---

## 12. Canvas toolbar (always visible above the leaflet canvas)

> **Order as shipped (S356, Captain):** left set = settings | show zones · show pins | draw polygon · draw line (looking before making, dividers kept); right set = zones fold-out (the zone panel, DESIGN_ZONES §4.5) · fit-to-image (a view-state control, so it lives right) · open-map-element.


A thin row (~36px tall) docked at the top of each map tab's body, above the leaflet container. Map index tab (the pinned first tab) does NOT get a toolbar.

```
┌─ map tab body ─────────────────────────────────────────────────┐
│ [⚙] | [⬡ polygon] [╱ line] | [👁 zones] [👁 pins] | [⤢ fit]     │ ← toolbar (~36px)
├────────────────────────────────────────────────────────────────┤
│                                                                │
│                                                                │
│                   leaflet canvas                               │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 12.1 Buttons

| Button | Tooltip | Behavior |
|---|---|---|
| ⚙ | "Map visual settings" | Toggles the §11 popover |
| ⬡ | "Draw polygon" | Enters drawing mode (DESIGN_ZONES.md §2). Active state styled when `ui.zoneDrafting?.mode === 'polygon'`. Always enabled — the no-image gate was **removed in S300** (zones draw on imageless maps; stored dims replace the refusal, see §4.2) (corrected 2026-07-22, S309). |
| ╱ | "Draw line" | Same, for line mode. |
| 👁 zones | "Show/hide zones" | Toggles zonesLayer visibility on Leaflet2DManager. Transient (not persisted). |
| 👁 pins | "Show/hide pins" | Toggles pinsLayer visibility. Transient. |
| ⤢ | "Fit to image" | Camera animates to fit the map's image bounds. |

Dividers between conceptual groups (settings | drawing | visibility | camera).

### 12.2 Drawing-mode toolbar state

When `ui.zoneDrafting` is set, the corresponding draw button gains an `.active` state. Clicking the active button again cancels drawing (ESC also).

### 12.3 DOM placement and flex layout

Toolbar mounts in `mountMapTab` inside `.atlas-tab-body`. The body becomes a vertical flex: toolbar (flex: 0 0 auto), leaflet container (flex: 1 1 0, min-height: 0). Disposal in `disposeMapTab`. Toolbar element gets `data-map-tab-toolbar` for test selectors.

---

## 13. Zone chip strip → toolbar dropdown (revised session 217, ZC9)

**Original v1 design**: a bottom-of-canvas chip strip mirroring the pin chip strip pattern.

**Shipped instead** (session 217): a right-anchored dropdown on the canvas toolbar (see DESIGN_ZONES.md §4.5 for full rendering details). Trade-off: better canvas real estate, slight loss in at-a-glance scanning. Captain confirmed this direction; the strip is gone.

Mount: the toolbar button `zonesDropdownBtn` lives in `map-tab-toolbar.ts` (anchored right via a flex spacer). The dropdown panel is the same DOM element that was the chip strip (`entry.zoneStrip` in cache) — re-purposed via CSS class `.atlas-zones-dropdown-panel`. Hidden until the button toggles `.is-open`.

The §13.1-13.3 detail below is the original spec. Keep for archaeology; the as-shipped behavior is in DESIGN_ZONES.md §4.5.

---

### Original v1 spec (archaeology — not as-shipped)

Mirrors the existing pin chip strip pattern. Mounts at the bottom of each map tab's body, BELOW the leaflet canvas. Only renders when `listZonesOnMap(activeMapId, markers, zones).length > 0`.

### 13.1 Chip shape

```
┌─────────────────────────┐
│ ⬡ • Forest         × │
└─────────────────────────┘
```

- Shape glyph (⬡ for polygon, ╱ for line)
- Filled color dot (`atlas_color ?? '#22d3ee'`)
- Name (truncated at ~20 chars with ellipsis)
- Optional `×` on hover (alternate delete affordance besides drag-to-trash)

### 13.2 Interactions

- **Left click**: `selectedElementId = zone.id`, navigates to element-detail in middle pane. Zone outline gets selection highlight on canvas.
- **Right click**: context menu — Rename, Duplicate, Edit shape, Delete.
- **Drag**: drag-to-trash zone (same drop-zone pattern as pins from Bout SMK-10). Drop on trash = `deleteZone(id)` cascading marker tombstones per DESIGN_ZONES.md §6.2.

### 13.3 Strip layout

Horizontal scrollable strip, ~32px tall. Selected zone's chip gets a stronger border + slight scale-up. CSS subscribes to `data.elements` changes — chips appear/disappear when zones are added/deleted in another flow (drawing, element-create modal, deletion from element-detail).

If the chip strip ever grows too wide for the canvas width, it horizontally scrolls. Future: overflow chip "+N more" opening a picker (deferred).

---

## 15. Map styles: a map drawn from its own zones (#365, 1.53, S423-S426)

The Captain's lead (h20 #6442); the research, trial and session record: `Forge/Notes/2026-10-17-s423-map-from-zones-design.md`. Notes decide, this section holds.

**The line**: the stored shape is the meaning; the look is the renderer's reading of it. Jitter, patterns, shore bands, paper and lettering are computed at render time from the zone's points and its kind, never stored. Choosing a style writes one field on the Map and nothing else. Never in scope: brushes, a symbol library, painted relief, a base-map painter.

- **The kind** (Skeld h20 #6449): read from the zone's **subtype**, trimmed, case-insensitive (`zoneKindOf`, `core/map-ink.ts`). Areas `Landmass`, `Sea`, `Lake`, `Range`, `Forest`, `Marsh`, `Desert`, `Territory`; lines `River`, `Road` (`Route`, `Path` read as roads), `Wall`, `Border`, `Coast`. A subtype written `Class: kind` is tried by its halves, the class first (Skeld h58 #6762: Blood Meridian's "Border: treaty line" draws as a border). Any other subtype draws exactly as on a Plain map. The supertype carries the shape (DESIGN_ZONES §1.5); `role` is the author's own words and no style reads it. The New zone step offers the kind words on the subtype (a datalist), never requires them.
- **The style** (`atlas_map_style` on Map, a wire extension, ATLAS_FIELDS; null = Plain): `ink` (Ink on parchment), `atlas` (Modern atlas, Seethe h20 #6542), `hatched` (Seethe h20 #6572). A preset is a table per kind: stroke, fill, a pattern, shore bands, a wobble, a region (`land` or `water`) and whether a line clips to land. The **Map style** row sits on the map's page under Background colour. An unknown value reads as Plain. On an imageless map (§4.2) the flat canvas takes the style's sea and edge when the map has no `background_color` of its own; on a map with a picture the picture is the ground (`overPicture`, the S426 gate's G3): the zones keep their ink, patterns, lettering and names, and cover nothing (land and water lose their fill and shore bands, a pattern its tint), so Blood Meridian's territories, borders and roads draw over its relief, and an Ink landmass never paints paper over a photograph. World styles (DESIGN_ZONES §5b) do not override a styled kind: the style is the register.
- **The ink holds still**: `inkPoints` is seeded midpoint displacement keyed to each segment's endpoints in world coordinates, never a vertex index, so a redraw, a pan or an inserted vertex elsewhere leaves the rest of the coast alone, and zooming in keeps every coarser ink point (`tests/unit/map-ink.test.ts`). The bulge side is taken from the endpoints in one fixed order, so an edge two zones share draws as one line whichever way each runs it (G5). Re-inked on `zoomend`. A zone being edited draws its stored points plain, so the handles sit on them.
- **The renderer** (`ZoneOverlay`): patterns are `<pattern>` defs in the zone renderer's own svg, one per shape and colour (`inkPatternId`); shore bands under a landmass; `applyInkOrder` stacks seas, land and shore, areas, plain zones, lines, names. A river is cut to land (`clipLineToLand`, `ZoneGeometry.ts`): inside some landmass (anywhere, with none on the map), inside no sea or lake, against each region's outline as drawn at this zoom; a river with no land under it draws whole. The cost is bounded (G2): each ring's edges sit on a 64 x 64 grid, a segment tests only the edges near it, land is carried between outlines, and the overlay keeps the inked regions while the zoom and the regions' shapes stay the same. After Plain the zones take their plain order again (`applyPlainOrder`, G4).
- **Names**: an area's name sits at its pole of inaccessibility (the point farthest inside), in the style's lettering (`.atlas-map-style-<id>`, a face per kind); a line's name runs along it on a `<textPath>`, left to right. Both join the density layer (§11.6): metrics per label face, cached per map; a name along a line tries five shares of the line, middle first, and drops when an area name or a pin is in the way.
- **Pins** on a styled map print in its ink (one `atlas-map-ink` class on the container, the icon filtered, so it still carries its type); on Hatched in a washed sepia (Seethe h57 #6789).
- **Trace** (DESIGN_ZONES §2.5): a toggle on the drawing strip; while on, a drag lays a stroke instead of panning, and on release `simplifyStroke` (a five-sample moving average, then Douglas-Peucker at 3 screen px) puts its points into the ordinary draft, which finishes through the usual modal. A click still places one point, and so does a press that moves under 8 screen px. Each vertex is a Marker file, so the point budget is the design: at most 60 points a stroke (the tolerance grows by a quarter until it fits), and the raggedness comes from the renderer. While Trace is on the container takes `touch-action: none`, so a finger's drag is the stroke's; the stroke follows one pointer, a second finger drops it, and a cancelled stroke lands nothing (G6).
- **Not taken** (from Seethe's tables): her pin ring and dot, the wall's ticks, the sea's rhumb lines. EB Garamond is not bundled (Georgia stands in). **Later, only when asked**: "Download as picture" with a key box; never "set as the map's picture".
- **Guards**: `tests/e2e/map-ink.spec.ts` (the style row, Plain restoring, rivers ending at the coast, a name sliding clear, capitals never over a pin, a hatched map), units `map-ink`, `zone-clip-to-land`, `map-label-along`, `zone-label-pole`, `zone-trace-simplify`.

---

## 14. Sign-off

This doc is the source of truth for the map subsystem foundation. Bouts execute against it. If a decision proves wrong during implementation, the doc gets updated FIRST and then the code follows — never the reverse.

Companion file: `tools/atlas/PROGRESS.md` will track operational state per bout.
Companion file: `tools/atlas/tests/fixtures/map-worlds/` will hold the JSON fixtures.

When all bouts ship and the schema motion lands, this doc transitions from "active design" to "reference."
