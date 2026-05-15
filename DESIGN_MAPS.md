# Atlas — Maps Subsystem Design

**Version**: 1.0 (2026-05-15) — foundation design
**Status**: Design phase. No code yet. Bout plan in §10.
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
10. [Bout sequence](#10-bout-sequence)

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

### 3.4 Lock toggle

Small lock icon in the map tab header (next to the close ×). Unlocked by default.

- **Unlocked** → selecting an element (via sidebar OR pin click) that has an associated map auto-loads that map per §3.6.
- **Locked** → selection events do NOT change the current map. User can still manually open other maps from the maps tab.

State persists per-tab while the world is active. Doesn't survive a world switch (each world's tabs come back unlocked).

### 3.5 Inline "map presence" widget in element-detail

A new section in the middle-pane element detail, rendered for any element whose context relates to maps. Two variants:

**For Location elements** — "Maps related to this place":
- Maps directly OF this location (where `Map.location == this.id`)
- Maps within descendant locations (via Location's parent_location subtree)
- Optionally: ancestor maps that contain this location (where this location's parent chain reaches a map's location)

**For other content elements** — "Appears on maps":
- All maps where a pin exists with `element_id == this.id`
- Click → open that map (with pin focused — future enhancement)

Render as a compact list with thumbnails (when available). One row per related map. Click row → open map tab.

If the list is empty, the section doesn't render. No empty-state noise.

### 3.6 Pin click-through and element selection

Unified rule for both pin clicks and sidebar selections (treat as the same intent: "I want to look at this thing"):

Element has N maps where N = count of maps with `location == element.id` (for Location elements) OR count of distinct maps in this element's pins (for others):

| N | Behavior (unlocked tab) | Behavior (locked tab) |
|---|---|---|
| 0 | open element-detail in middle pane | open element-detail in middle pane |
| 1 | auto-open that map on the right; element-detail in middle pane | element-detail only; current map stays |
| ≥2 | small picker overlay listing maps (default highlight: highest hierarchy = top of stack); on picker confirm, behave as N=1 | element-detail only |

Picker can be skipped by holding Shift on click (advanced affordance, not in v1).

---

## 4. Image source rules

**Two slots per map**: `image_url` (string, schema field, canonical, syncs to API) and `image_media_id` (atlas-extension, references a local file in `media/`, never syncs).

**Display precedence** (same in local-only AND api-linked worlds):
1. If `image_url` is non-empty → load and display it.
2. Else if `image_media_id` is set → load the local blob and display it.
3. Else → fall back to grid canvas (today's behavior).

**Edge-color extraction** runs on whichever image actually rendered. Cached per URL (avoid network re-fetch on every mount).

**UI badges**:
- Map index row with image badge → tooltip "image: URL" or "image: local file" depending on which is rendering.
- Map create modal — see §3.2 hint dynamics.
- Map detail — when both are set, show a small indicator near the image_url field: *"local image stored as fallback (not shown while URL is set)."*

**Push behavior on api-linked worlds** (already correct in atlas-extension layer): `image_url` syncs. `image_media_id` and the actual media blob stay local. Other machines accessing the same api-linked world only see whatever `image_url` provides.

**Implication**: a user with only `image_media_id` (no URL) on an api-linked world has a map that displays locally but shows as image-less on other machines. We surface this in the maps tab row as a soft hint: *"local-only image — set a URL to share."* Same hint used for orphan loc-bound surfaces — non-blocking, just informational.

---

## 5. Tab state across world switches

(Foundational fix needed before the map index UI work — see Issue C from the design conversation.)

**Current state** (broken): `state.ui.rightTabs` is global. Switching worlds carries stale tab references; the right pane goes blank because `lastTabKey` short-circuits remount when the world changes but the active tab key doesn't.

**Fix shape**:

1. Make `rightTabs` and `rightActiveIndex` per-world. Persist via `WorldRegistryEntry.right_tabs?: { tabs: RightTabRef[]; activeIndex: number }`. Restored from registry on world activation, snapshotted to registry when leaving a world.
2. In `activateWorld` (`worlds-sidebar.ts`), after the existing data-clear logic:
   - Snapshot current world's `ui.rightTabs` + `ui.rightActiveIndex` to its registry entry.
   - Save registry.
   - On the new world's activation, hydrate `ui.rightTabs` + `ui.rightActiveIndex` from its registry entry, defaulting to `[{kind:'map-index'}]` + `0` if absent.
3. In `right-pane.ts`, when `lastWorldId !== worldId`, reset `lastTabKey = null` BEFORE the early-return check so the body remounts.
4. On `mountMapTab`, if the map id doesn't exist in current `data.elements`, render a friendly "this map was deleted in another world / no longer here" state — not the silent black we ship today.
5. Cascade-delete cleanup: when a map is deleted, scrub its id from the active world's `rightTabs` (handled in `map-index-tab.ts` already) — no cross-world cleanup needed because each world has its own tab list.

This is foundation-grade work and gets done in Bout 2 before any map-index tree rendering.

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

These are explicitly OUT of v1 scope but parked for later consideration. Not foundation work, not required for the bouts in §10.

- **Zone-targets-map**: revisit using zones to express "this region of the parent map IS sub-map X." Requires either a schema field on Zone (`target_map`) or atlas-extension fields. Decision deferred until the map foundation has shipped and the use case sharpens.
- **Pin styling pass for map-having elements**: small icon decoration on pins whose target element has maps. Visual cue that clicking will offer to open a map.
- **"Maps within" inverse search performance**: for very large worlds, the inline widget's descendant-map search could get slow. Cache by location-id if needed. Profile first.
- **Map locking via URL / shareable**: locked map state should not be URL-encoded yet — it's local UX preference. Reconsider if "share this view" becomes a feature.
- **Picker keyboard shortcut**: Shift-click to skip the picker on multi-map elements. Wait for user feedback to decide if needed.
- **Drag-to-reorder hierarchy**: dragging map rows in the index to set hierarchy values. Defer until users complain about the numeric field.
- **Map subtype as visual filter** (e.g. "show only political maps"): filter chips on the maps tab. Defer.

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

## 10. Bout sequence

Foundation work BEFORE feature work, per Captain's instruction. Each bout ends at a typecheck-green, vitest-green, build-green, manually-pokeable seam.

### Bout M1 — Schema-honesty foundation (small, low risk)

- Extend `WorldMap` interface in `core/types.ts` with `hierarchy`, `parent_map`, `depth`, `background_color` (`image_url` already lives on `Element` via the index signature; type it explicitly here too for autocomplete).
- Add `field-descriptions.ts` entries for the newly-typed fields (sourced from §1.1 + §7).
- No UI change. Just type coverage so all subsequent bouts have autocomplete and the tree-build can use field names.

**Deliverable**: type-level coverage of all Map schema fields. Tests: just typecheck.

### Bout M2 — Bug-fix triplet (Issues A + B + C)

Three independent fixes that don't depend on each other but ship together.

- **Issue A** — element-create map post-modal. After `store.createElement` succeeds with `type='map'`, open `MapCreateModal` in configure-existing mode (modal extension: support "update an existing map" alongside "create new"). Cancel = the bare map stays (already works); submit = location/image fields apply.
- **Issue B** — image precedence swap. In `map-tab.ts`, prefer `image_url` over `image_media_id`. Update the maps tab row title/badge to signal which is rendering. Add the precedence hint in the create modal per §3.2.
- **Issue C** — per-world tab persistence + `lastTabKey` reset, per §5.
- **Quiet hygiene** — `Math.round` pin coordinates on create/update/drag (SDK requires integers; out-of-scope item from §9).

**Deliverable**: bugs gone. Regression tests for each (mock-folder-store scenarios for tab persistence; unit test for image precedence; integration test for element-create → map-modal handoff).

### Bout M3 — Tree-builder as pure function

Implement `buildMapTree(maps, locations)` per §2 in `tabs/right/map-tree.ts` as a pure function. No UI integration yet.

- Unit tests for World A, World B, World C fixtures (§6) — full structural assertion of root order, children, dangling/orphan handling.
- Skeld receives the fixture spec via `/message` and creates the three test worlds via API (parallel work; doesn't block).

**Deliverable**: 100% test-covered tree-builder, fixtures locked.

### Bout M4 — Map index tree rendering

Replace the alpha-sorted flat list in `map-index-tab.ts` with a tree renderer driven by `buildMapTree`.

- Per-row affordances per §3.1 (indent, location chip, badges, delete).
- Collapse/expand state persisted per-world (atlas-extension on registry).
- Visual polish to match the OW dark glass aesthetic.

Manual test against all three test worlds (Skeld's API worlds should be live by this bout).

**Deliverable**: maps tab as a tree. The first user-visible foundation win.

### Bout M5 — Simplified create modal

Rebuild `map-create-modal.ts` per §3.2 — collapsed advanced section, image-source hint dynamics, hierarchy/parent_map override fields. Modal extension from Bout M2 stays compatible (configure-existing mode is the same fields, different submit handler).

**Deliverable**: minimum-setup map creation.

### Bout M6 — Lock toggle + pin click-through unified rule

- Add lock icon to map tab headers per §3.4.
- Refactor pin click and sidebar selection into a single `selectElement(elementId, source)` handler per §3.6.
- Picker overlay for N≥2 case.

**Deliverable**: smart map-following behavior with explicit user control.

### Bout M7 — Inline "map presence" widget

Add the §3.5 widget to element-detail middle pane. Type-aware content: Location vs other. Tested against the three fixture worlds.

**Deliverable**: map-related context surfaces during element browsing.

### Bout M8 — Schema description council motion

After M1-M7 ship and feel stable in real use, draft and submit the §7 council motion. Likely a single bundled motion.

---

## 11. Sign-off

This doc is the source of truth for the map subsystem foundation. Bouts execute against it. If a decision proves wrong during implementation, the doc gets updated FIRST and then the code follows — never the reverse.

Companion file: `tools/atlas/PROGRESS.md` will track operational state per bout.
Companion file: `tools/atlas/tests/fixtures/map-worlds/` will hold the JSON fixtures.

When all bouts ship and the schema motion lands, this doc transitions from "active design" to "reference."
