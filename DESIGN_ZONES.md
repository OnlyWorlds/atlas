# Atlas — Zones Subsystem Design

**Version**: 1.0 (2026-05-16) — foundation design
**Status**: All foundation + visual bouts (F0-F5, V1-V5, Z + ZC1-ZC10 + ZD1-ZD6) shipped sessions 213-218. Bout history archived to `docs-archive/PROGRESS-history.md`.
**Scope**: The zone/marker subsystem — domain model (zone vs marker, OW-canonical), drawing flow, edit flow, UI surfaces, atlas-extension visual prefs, cascade rules, hit-testing, test fixtures, deferred work.
**Companion**: `DESIGN_MAPS.md` owns map-level surfaces (canvas toolbar, visual settings popover, chip-strip docking). This doc owns zone-specific behavior. Cross-reference where needed.

---

## Why this doc exists

Zones are not maps. The temptation is to bolt zones into `DESIGN_MAPS.md` because they live on maps. But:

- **Zones are pure metadata** in OW schema — no map field, no geometry. They are conceptual elements (a Kingdom, a Forest, a Trade Route).
- **Markers** carry both the map relationship and the geometry. A zone's spatial existence is reconstructed from its markers.
- **Drawing and editing** is interaction-heavy and warrants its own design conversation — distinct from map-tab tabs or map-tree UI.

Cramming this into the maps doc would conflate two clean models. Separate file.

---

## Table of contents

1. [Domain model](#1-domain-model)
2. [Drawing flow](#2-drawing-flow)
3. [Edit flow](#3-edit-flow)
4. [UI surfaces (zone-specific)](#4-ui-surfaces-zone-specific)
5. [Atlas-extension visual fields](#5-atlas-extension-visual-fields)
6. [Cascade rules](#6-cascade-rules)
7. [Hit testing](#7-hit-testing)
8. [Sync semantics](#8-sync-semantics)
9. [Test world fixtures](#9-test-world-fixtures)
10. [Out of scope](#10-out-of-scope)
11. (Bout sequence — archived to `docs-archive/PROGRESS-history.md`)

---

## 1. Domain model

### 1.1 The OW canonical truth

Verified against `@onlyworlds/sdk` (Zone: index.d.ts:429-439, Marker: 541-548):

```ts
// SDK shape
interface Zone extends BaseElement {
  role?: string;
  start_date?: number;
  end_date?: number;
  phenomena?: ElementIds<Phenomenon>;
  linked_zones?: ElementIds<Zone>;
  context?: string;
  populations?: ElementIds<Collective>;
  titles?: ElementIds<Title>;
  principles?: ElementIds<Construct>;
}

interface Marker extends BaseElement {
  map?: ElementId<Map>;
  zone?: ElementId<Zone>;
  x?: number;
  y?: number;
  z?: number;
  order?: number;
}
```

**Read this carefully**:
- `Zone` has NO map field. NO coordinates. NO geometry. It is pure metadata.
- `Marker` carries BOTH the map relationship AND the zone relationship AND the spatial coords.

The geometric existence of a zone is **emergent**: a zone "appears" on a map IF AND ONLY IF at least one marker references both that zone and that map. The shape of that appearance is reconstructed from sorting those markers by `order`.

A zone can technically span multiple maps (markers across maps, all pointing at the same zone). Atlas v1 UX assumes the common case (zone-per-map drawing) but does not enforce single-map. Cross-map zones are valid storage; rendering shows the zone on every map that has markers for it.

### 1.2 Atlas's current Zone type is wrong — fix in F0

`src/core/types.ts:88-92` declares:

```ts
export interface Zone extends Element {
  type: 'zone';
  map_id: string;          // ← NOT in OW schema
  coordinates?: number[][]; // ← NOT in OW schema
}
```

Both extra fields are removed in F0. Zone becomes:

```ts
export interface Zone extends Element {
  type: 'zone';
  // All other fields come from the SDK schema via the index signature
  // on Element — no explicit listing needed since the schema editor
  // reads from SDK FIELD_SCHEMA.
}
```

`coordinates` was never sync-able and never persisted in a meaningful way. `map_id` was a pre-design speculative addition that the OW schema does not support.

### 1.3 Atlas's Marker type is correct

`src/core/types.ts:94-99`:

```ts
export interface Marker extends Element {
  type: 'marker';
  map_id: string;
  x: number;
  y: number;
}
```

This is mostly aligned — though it's missing `zone_id`, `order`, and `z`. F0 also adds those:

```ts
export interface Marker extends Element {
  type: 'marker';
  map_id: string;
  zone_id?: string;   // optional — a marker can exist without a zone (rare; for orphan-marker support)
  x: number;
  y: number;
  z?: number;
  order?: number;
}
```

`zone_id` is wire-shape (matches OW write API + obsidian-plugin convention + atlas Pin pattern). On read the SDK returns `zone: {id, name}`; the adapter's `adaptRecord` unwraps to `zone_id` per Convention #5.

### 1.4 Derived views

Two derived views matter for UI:

```ts
// Zones present on this map (chip strip filter, etc.)
function listZonesOnMap(mapId: string, markers: Marker[], zones: Zone[]): Zone[] {
  const zoneIds = new Set(
    markers.filter(m => m.map_id === mapId && m.zone_id).map(m => m.zone_id!)
  );
  return zones.filter(z => zoneIds.has(z.id));
}

// A zone's geometry on a given map (the polygon/polyline points, in order)
function zoneGeometry(zoneId: string, mapId: string, markers: Marker[]): Point[] {
  return markers
    .filter(m => m.zone_id === zoneId && m.map_id === mapId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(m => ({ x: m.x, y: m.y }));
}
```

Both are pure functions over `state.data.elements`. No new store API needed beyond the existing `listMarkers` + `listZones`.

### 1.5 Shape kind: polygon or line

OW Zone schema does NOT carry a "polygon vs line" field directly. Pre-ZD6 convention (inherited from zoner) put it in `Zone.supertype`, but that conflated shape with OW's free-text taxonomy field.

**As of session 218 (ZD6)** atlas stores shape in a local-only extension field `atlas_shape: 'polygon' | 'line'`. The field persists on disk so reloads see it. `Zone.supertype` is now free user-meaningful text again (e.g. "regions", "districts", "biomes"), as is `subtype` ("forest", "road", "plaza").

**Session 221 fix**: `atlas_shape` was originally treated as a "convention" — atlas wrote it locally, but the wire-strip set in `OwClientAdapter.toWireShape` didn't filter it. Real OW rejects unknown fields with 400, so live zone CREATEs failed silently and dependent markers FK-failed (Captain's smoke). The field is now part of `ATLAS_LOCAL_EXTENSION_FIELDS` in `src/core/constants.ts` — same machinery that strips `atlas_color`, `atlas_opacity`, `atlas_label_visible`, `image_media_id` on write and preserves them on pull. The fakes (`statefulOwHandlers` + `FakeOwApiClient`) now mirror real OW's strict-unknown-field validator so regressions of this class surface in tests.

**Cross-tool consequence**: because `atlas_shape` doesn't reach the server, other OW tools (zoner, web app) have no way to know whether a zone is polygon vs line and will guess. A canonical OW schema field is the proper long-term fix (council motion deferred per Captain session 221). For atlas-internal rendering, this is moot — `getZoneShape(zone)` returns the correct value from the local file.

> **SUPERSEDED BY v2 (keel), corrected 2026-07-26.** The two paragraphs above describe the **v1** dialect and are kept as history. Under v2 the extension list is SPLIT (`src/core/constants.ts`): `ATLAS_LOCAL_ONLY_FIELDS` are still stripped on write, but **`ATLAS_WIRE_EXTENSION_FIELDS` — `atlas_color`, `atlas_opacity`, `atlas_label_visible`, `atlas_shape` — now RIDE THE WIRE** via keel's extension passthrough, so zone visuals sync across devices and other tools CAN read the shape. Reading the v1 rule as current would build the opposite behaviour, which is why this note exists rather than a quiet edit.

Reads go through `getZoneShape(zone)` (in `tabs/right/zone-derived.ts`) which checks `atlas_shape` first and falls back to legacy `supertype` = line/polygon **in any casing** for zones created before ZD6 or by another tool. Default for ambiguous: `'polygon'`. **Never read `zone.supertype` directly to decide rendering** — go through the helper.

> **S356, the other writers.** Only atlas writes `atlas_shape`. zoner writes `supertype: "line"`; Skeld's Sikelia writer wrote `supertype: "Line"` (318 rivers and routes), and atlas's case-sensitive fallback drew every one as a filled polygon. The fallback is case-folded now. The cross-tool truth stands as written above: a zone from any other tool has nothing but `supertype` to say what it is, and a canonical schema field is still the proper fix (Council motion, deferred S221). Reported to Skeld with the recommendation that writers also stamp `atlas_shape` (it rides the v2 wire) until the schema has a field.

Polygons: ≥3 markers, last connects to first (visually closed).
Lines: ≥2 markers, open path.

A zone with 0 or 1 marker is **degenerate** — atlas renders it as a single point marker (the lone marker as a small ring) or nothing (if zero). Doesn't crash. The drawing flow's finish-gate prevents creating these degenerate cases through normal UX.

---

## 2. Drawing flow

### 2.1 State

A transient drafting slice on `state.ui`:

```ts
interface ZoneDraftingState {
  mode: 'polygon' | 'line';
  mapId: string;            // the map being drawn on (the active map tab)
  points: Point[];          // transient markers (NOT yet persisted)
  templateId?: string;      // reserved for future templates (deferred)
}

interface UiState {
  // ... existing fields
  zoneDrafting?: ZoneDraftingState;
}
```

While `ui.zoneDrafting` is present, the canvas is in drawing mode for that map. Other interactions (pin placement, ghost pins, normal click-to-select) suspend.

### 2.2 Entry

User clicks ⬡ Draw Polygon or ╱ Draw Line in the canvas toolbar (DESIGN_MAPS.md §12). Drawing works on **imageless maps too** — the no-image gate was **removed in S300** (markers anchor to the map's stored `width`/`height`, which every map now carries; see DESIGN_MAPS.md §4.2) (corrected 2026-07-22, S309).

`ui.zoneDrafting = { mode, mapId, points: [] }`. The drawing overlay strip mounts (see §4.2). Cursor changes (crosshair). Toolbar buttons reflect active state.

### 2.3 Marker placement

Each click on the canvas:
1. Project click event to image coordinates (via Leaflet's `mouseEventToLatLng` + `leafletToStorage` from CoordinateUtils).
2. Round to integer (SDK requires integer coords).
3. If shift-snap is active and `points.length >= 1`: snap the new point to be axis-aligned (0°/45°/90°) relative to the last point. Implementation: compute angle from last point, snap to nearest 45° multiple, project the click distance along the snapped angle.
4. Append to `points`. Re-render preview.

Visual feedback during draw:
- Each placed marker rendered as a numbered cyan circle (DivIcon: cyan filled, white border, ~18px, with order number 1-indexed inside). Port verbatim from zoner's `createMarkerIcon` pattern.
- Live preview path connects markers in order, dashed cyan stroke. For polygon mode: closes back to the first marker when `points.length >= 3`. For line mode: open path.
- Preview layer sits above the zones layer but below the markers layer (zoner z-order convention).

### 2.4 Shift-snap (perfect rectangles)

Captain's request. With shift held during click:
- Compute the angle `θ` from `lastPoint` to `clickPoint`.
- Snap `θ` to the nearest of `0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°`.
- Project `clickPoint` onto the snapped angle ray: new point's distance from `lastPoint` is the projection of the click vector onto the snapped direction.

Perfect rectangle: shift-click four times at right angles → rectangle as a polygon. No special shape type needed.

Live preview reflects snap when shift is held (cursor-follow showing the snapped target).

### 2.5 Drawing overlay strip

A small floating control strip near the top-center of the canvas (transient, mounts only while `ui.zoneDrafting` is set):

```
┌─────────────────────────────────────────────────────────┐
│  3 markers • [⇧ snap]  [↶ undo]  [✓ finish]  [✗ cancel] │
└─────────────────────────────────────────────────────────┘
```

- "N markers" — live count
- ⇧ snap — toggle (or just label hinting that shift-snap is available)
- ↶ undo — pops the last marker from `points`
- ✓ finish — gated. Disabled if `mode === 'polygon' && points.length < 3` or `mode === 'line' && points.length < 2`. Enabled otherwise.
- ✗ cancel — ESC also.

### 2.6 Finish

User clicks ✓ Finish, hits Enter (ZC1), or — when the click is close to an existing edge (ZD5) — gets shape-preserving auto-insert instead of an append. As of session 217 (ZC10), Finish opens a create modal before writing:

1. Compute default name: `findUniqueZoneName(mode)` — "new zone" / "new zone (2)" / "new line" / etc.
2. Open `ZoneCreateModal` with the locked shape badge + name (auto-selected) + supertype text + subtype text. Cancel = keep draft active; submit = proceed.
3. `store.createZone({ name, supertype, subtype, atlas_shape: draft.mode })` — shape lives in the atlas-local field (ZD6); supertype + subtype are whatever the user typed. No map_id, no coordinates.
4. For each `points[i]`: `store.createMarker({ name: '', map_id, zone_id: zone.id, x, y, order: i })`. Marker names default to empty string.
5. Patch `data.elements` with the new zone + markers (single combined render).
6. `requestPushIfLinked()` — autosave debounce coalesces the burst.
7. Clear `ui.zoneDrafting`. Set `selectedElementId = zone.id` AND navigate to `elementHash(worldId, zone.id)` so the user lands in element-detail.

### 2.7 Cancel

User hits ESC or clicks ✗. Clear `ui.zoneDrafting`. Discard all transient points (nothing persisted). Cursor returns to normal.

### 2.8 What zoner does differently (and why we improve)

| Zoner | Atlas (this design) | Why change |
|---|---|---|
| Auto-save on every marker change during draw | Batch save on Finish only | Draw is transient by nature — committing nothing until Finish is cleaner. Avoids dozens of writes + autosave debounce churn. Matches `pin-placement` semantics (no pin exists until the user places it). |
| `originalEditPoints` state backup | HistoryManager snapshot for edit-cancel | One mechanism, not two. HistoryManager already handles undo. |
| Implicit double-click to edit | Explicit "Edit zone shape" button in element-detail | More discoverable. Reduces accidental edit entries. |
| `clickTimeout` debounce for single vs double click | Use Leaflet's native `dblclick` event with click suppression | Cleaner state model, no global timeout to manage. |

---

## 3. Edit flow (as shipped S4)

### 3.1 Entry

Single click selects the zone (highlight + element-detail in middle). Double click enters edit mode. The "Edit shape" button in element-detail's Markers section is an explicit alias for users who don't know the double-click gesture.

Entry points:
- **Double click on the zone polygon/polyline on canvas** (primary gesture, zoner-compatible muscle memory).
- **"Edit shape" button in element-detail Markers section** (alias). Opens the first map this zone has markers on if not already open, then enters edit mode there.

Leaflet's native `dblclick` event natively suppresses the preceding `click`, so no 200ms timeout disambiguation is needed — single click and double click are cleanly distinguished. Atlas does not use zoner's clickTimeout pattern.

On entry:
1. Snapshot all markers belonging to this zone-on-this-map: `Map<markerId, {x, y, order}>`. Stored in the EditSession for cancel restoration.
2. Set `ui.zoneEditing = { zoneId, mapId }`.
3. Map's `doubleClickZoom` disabled (avoids accidental zoom during edit; restored on exit).
4. Canvas container gets `.atlas-zone-editing` class → `cursor: crosshair`.
5. Canvas renders draggable vertex handles (16×16 cyan circles with `cursor: grab`, numbered with the marker's 1-indexed order) at each marker's coords. Replaces the read-only vertex dots from S3 — same visual language, larger size signals interactivity. ZoneOverlay's read-only dots are suppressed for this zone while editing (`setVertexDotsSuppressed(id, true)`); restored on exit.
6. Segment overlays render: 20px-weight invisible polyline between every consecutive pair of markers (including last→first for polygon zones). Opacity 0 by default, 0.3 cyan dashed on hover.
7. Element-detail header's "Edit shape" button flips to "Done editing" + a Cancel ✗ button appears.

```
┌────────────────────────────────────────────────────┐
│  Editing • 5 markers  [↶ undo]  [✓ done]  [✗ cancel] │
└────────────────────────────────────────────────────┘
```

### 3.2 Interactions during edit

- **Drag marker handle** — `dragstart` suppresses subsequent click handlers (50ms guard) so the released marker doesn't fire a stale click. `drag` is preview-only (handle visually follows cursor). `dragend` projects the new latlng back to storage coords, rounds to integer, calls `store.updateMarker(id, {x, y})`, refreshes state, fires `requestPushIfLinked()`, and rebuilds handles+overlays so segment overlays follow the new vertex position.
- **Hover over segment** — overlay opacity 0 → 0.3 (cyan dashed). Mouseout returns to invisible.
- **Click on segment** — compute the midpoint of the two endpoints (`(a.x+b.x)/2, (a.y+b.y)/2`, rounded), bump every marker with order ≥ `i+1` up by one (processed in reverse to avoid collisions), then `createMarker({ map_id, zone_id, x: midX, y: midY, order: i+1 })`. Refresh + rebuild.
- **Right-click on marker handle** — `store.deleteMarker(id)`. Refuses if zone would drop below shape minimum (3 polygon, 2 line) — toasts info instead. Remaining markers' orders renumbered to close the gap.
- **ESC key** — cancel (restore snapshot, see §3.4).
- **Enter key** or **"Done editing" button** — commit + exit (no-op since everything autosaved).

Every action is per-action autosave + `requestPushIfLinked` — no batching, no "Save" button. Cancel via snapshot is the only way to revert.

### 3.3 Done (commit)

`exitEditMode('commit')`:
- Clear `ui.zoneEditing`.
- Remove the edit layer group (handles + segment overlays) from the map.
- Restore default `doubleClickZoom`.
- Remove `.atlas-zone-editing` class from canvas container.

Nothing to "commit" — autosave already persisted every action.

### 3.4 Cancel (restore snapshot)

`exitEditMode('cancel')` → 3-way diff against the snapshot:

1. **In current but NOT in snapshot** — marker was added during edit → `deleteMarker(id)`.
2. **In snapshot but NOT in current** — marker was deleted during edit → `createMarker(id, x, y, order)` to restore.
3. **In both** — if `x`/`y`/`order` mutated, `updateMarker(id, {…revert…})`.

Then tear down overlays + restore map state.

**Edge case**: writes already flushed to server via autosave during the edit. Cancel only undoes locally — the cancel's revert-writes flow to the server on next autosave. Net effect: server eventually converges to the pre-edit state, just with extra updated_at noise. Acceptable tradeoff for v1.

**Aborted edit** (map tab closed mid-edit): `abortEditModeForMap(mapId)` clears `ui.zoneEditing` without running the snapshot restore — the map is gone anyway, restoration would be pointless. Local writes from before the close remain committed.

### 3.5 Renumber-all (chosen approach)

Atlas v1 uses **renumber-all** for marker insertion (not fractional). When inserting between order=2 and order=3, every marker with order ≥ 3 bumps to ≥ 4. The write batch is small (markers in one zone, typically <20) and only happens on explicit insert actions. All bumps coalesce into a single `requestPushIfLinked` debounce window so push hits the server once per insert action.

Renumber on delete too: when a marker is deleted from edit mode, remaining markers' orders close the gap (becomes 0, 1, 2, …).

---

## 4. UI surfaces (zone-specific)

Map-level toolbar/popover/chip-strip surfaces live in DESIGN_MAPS.md §11-13. This section covers zone-specific renderings inside those surfaces.

### 4.1 Canvas zone rendering

`Leaflet2DManager` is extended in F3 with a `zonesLayer: L.LayerGroup`. Z-order: `background < connections < zones < pins < labels < drawing-preview < edit-handles`.

For each zone with markers on the active map:
- **Polygon** (supertype === 'polygon'): `L.polygon(latLngs, options)` with `fillColor = atlas_color ?? '#22d3ee'`, `fillOpacity = atlas_opacity ?? mapPrefs.zone_fill_opacity ?? 0.4`, `color = atlas_color ?? '#22d3ee'`, `weight = selected ? 3 : 2`, `opacity = 0.9`.
- **Line** (supertype === 'line'): `L.polyline(latLngs, options)`. Plus a `L.polyline(latLngs, {weight: 20, opacity: 0})` invisible hit-overlay (per §7).

Rendering reads from `state.data.elements`; subscribes to changes; re-renders only zones whose markers changed (diff-based). Pure-function helpers in F3 (zone-geometry, point-list-equal) make this efficient.

### 4.2 Drawing overlay (transient)

See §2.5 for the strip during draw, §3.1 for edit-mode. Same DOM mount point — a floating div positioned near the top-center of the canvas container, `position: absolute`, dark glass aesthetic.

### 4.3 Zone selection highlight

When `selectedElementId` points at a zone:
- That zone's polygon/polyline renders with `weight: 3` (vs 2 default) and a drop-shadow glow via the `.atlas-zone-selected` class (`filter: drop-shadow(0 0 4px rgba(34, 211, 238, 0.85))`).
- Read-only vertex dots (12×12 cyan circles with the marker's 1-indexed order number) render at each marker point. They share the same numbered cyan visual language as edit handles and draft markers — only the size changes as interaction depth grows (12 read-only → 16 edit handle → 18 draft).
- The dots are NOT interactive outside edit mode (`interactive: false` on the L.Marker). Click on a dot does nothing. To manipulate vertices, enter edit mode (double-click polygon).

### 4.4 Element-detail sections

When the selected element is a Zone, element-detail mounts in middle pane with the standard schema-driven editor PLUS two new sections (V4):

**Zone visuals (local)** — atlas-extension fields, never pushed:
- Color picker (writes `atlas_color`)
- Opacity slider 0–100% (writes `atlas_opacity`, normalized to 0–1)
- Label visible toggle (writes `atlas_label_visible`)
- Hint text: "Visuals are stored locally and not synced to the API."

**Markers**:
- For each marker (sorted by order): row with 1-indexed order # + (x, y) readout + "pan to" button + delete trash icon. Multi-map zones group markers under per-map sub-headers.
- "Edit shape" button at the top — enters edit mode (§3). Flips to "Done editing" + a Cancel ✗ button while editing.
- No "Add marker" button shipped — segment-click insertion (during edit mode) covers single-marker addition naturally. Standalone insert-mode was scoped out as redundant.

When the selected element is a Marker (rare — atlas excludes pin/marker/zone from elements-sidebar but a marker can be reached via the parent zone's Markers list):
- Standard schema editor.
- Plus: "Go to zone" button → selectedElementId = marker.zone_id.

### 4.5 Zone chip strip → toolbar dropdown (ZC9, session 217)

The bottom-of-canvas chip strip from sessions 213-216 was replaced in session 217 (ZC9) with a right-anchored dropdown on the canvas toolbar. The chip rendering is the same; only the container changed.

**Toolbar trigger** (in `map-tab-toolbar.ts`): a "Zones (N)" button shows count badge + caret; click toggles a floating panel anchored top-right under the button. Hidden entirely when no zones on this map. `wireZonesDropdown` (in `map-tab.ts`) handles open/close + outside-click + Escape close.

**Chip rendering** (`renderChipStrip` in `map-tab-zones.ts`):
- Shape glyph: `hexagon` for polygon, `show_chart` for line — resolved via `getZoneShape(zone)` (ZD6), NOT direct supertype read.
- Color dot: small filled circle showing `atlas_color ?? '#22d3ee'`.
- Name: flexes to fill row width.
- Trash icon (ZD2) for delete, hover-revealed. Click → confirm → `store.deleteZone(id)` → syncZones drops the polygon from canvas immediately (ZD2 also fixed a stale-overlay bug where deleted zones lingered until reload).
- Click chip → selectedElementId = zone.id, navigates to element-detail. sidebarMode is left alone — route change drives `sidebar.syncModeFromRoute` as the single source.
- Right-click → context menu: Rename, Delete.

DESIGN_MAPS.md §13 should be updated to match — the chip-strip docking convention is dropped.

Filter: only zones returned by `listZonesOnMap(activeMapId, markers, zones)`. Re-derived on every elements change.

---

## 5. Atlas-extension visual fields

Zones support three atlas-extension fields, stored on disk in the element JSON but stripped from API push by the adapter (must be added to `ATLAS_LOCAL_EXTENSION_FIELDS` in `core/constants.ts`):

| Field | Type | Default | Meaning |
|---|---|---|---|
| `atlas_color` | string (hex) | `'#22d3ee'` | Zone outline + fill color |
| `atlas_opacity` | number 0–1 | `0.4` | Zone fill opacity |
| `atlas_label_visible` | boolean | `false` | Zone name renders as label on canvas |

These are stored on the Zone element itself (single source of truth per zone), folder-only. Multiple atlas instances accessing the same api-linked world each maintain their own per-zone visuals — like image_media_id today.

Map-wide defaults (DESIGN_MAPS.md §11 visual settings popover): `zone_fill_opacity`, `zone_labels` ('always'|'hover'|'never'), **`zone_label_position` ('below'|'center', default 'below' — S313)**. A zone's `atlas_opacity` overrides the map default; if unset, map default applies. Same pattern as pin label threshold. `zone_label_position` 'below' anchors the label at the zone's bottom-centre (bounding-box max-y) so it hangs off the shape instead of sitting on the fill/markers (`ZoneOverlay.labelAnchorFor`/`bottomCenter`); it's a view pref only (never on the element).

---

## 6. Cascade rules

Atomic operations from the user perspective, executed inside FolderStore.deleteElement's cascade logic (already present per `findDependents`).

### 6.1 Delete map

1. Tombstone every Pin with `map_id === deletedMapId`.
2. Tombstone every Marker with `map_id === deletedMapId`. (Markers carry the map relationship, not zones.)
3. **Zones are NOT cascaded.** They are pure metadata. A zone whose only markers were on the deleted map is "orphaned" — it has no spatial existence anywhere — but the metadata persists. The user may re-acquire geometry by adding new markers on another map.
4. Tombstone the Map itself.

The orphan-zone state is detected at render time: if `listMarkers({zone}).length === 0`, the zone has no geometry. It still appears in the elements list (as a non-spatial conceptual element) and in `selectedElementId` flows. It just doesn't appear on any map's chip strip.

### 6.2 Delete zone

1. Tombstone every Marker with `zone_id === deletedZoneId`. (Markers without a zone become free markers — usually we never have these; zones are the primary owner of markers.)
2. Tombstone the Zone itself.

### 6.3 Delete marker

Leaf operation. No cascade. The marker disappears from its zone's geometry. If the zone drops below minimum markers, the zone becomes degenerate but is NOT auto-deleted (user might be mid-edit; explicit delete-zone is the gesture for removing zones).

### 6.4 Existing FolderStore.findDependents

`folder-store-fs.ts:271+` currently special-cases pin/zone/marker as leaf types. With F0's removal of `Zone.map_id`, the existing logic that finds "zones on a deleted map by Zone.map_id field" must change to "zones reached transitively through markers." Actually re-examining: the cascade for delete-map should not return zones at all (per §6.1 above). The dependents-for-map are pins and markers only. F0 strips zone-finding from the map-delete path. Tests get updated.

---

## 7. Hit testing

### 7.1 Polygons

Click directly on the polygon fill area. Leaflet handles it natively. The polygon's `interactive: true` (default) plus a click handler on the layer.

### 7.2 Lines

Lines are 1-3px wide visually but the click target needs to be ~20px wide for usability. Implementation (per zoner pattern, port-adapted): for each line zone, render TWO polylines:
- The visible one (weight=2, color=atlas_color, opacity=0.9)
- An invisible hit-overlay (weight=20, opacity=0, with click handler)

The hit-overlay's click handler delegates to the visible line's selection logic. Both share the same `zoneId` data attribute. CSS cursor on the hit-overlay is `pointer` to signal interactivity.

### 7.3 Markers (during edit)

Marker handles are leaflet markers with their own click + drag + right-click handlers. Standard Leaflet event model.

### 7.4 Click priority during draw/edit

While `ui.zoneDrafting` is set: canvas clicks go to placement, NOT to existing zone selection. While `ui.zoneEditing` is set: clicks on the canvas (away from handles) do nothing (could be reserved for "Done" or just ignored); clicks on handles go to drag/delete.

---

## 8. Sync semantics

Zones and markers sync through the standard SyncEngine push/pull paths (no zone-specific logic in sync). One gotcha that F2 addresses:

### 8.0 Marker `order` field — write-allowed since 2026-05-16

**Status: shipped.** Anchor deployed the server migration adding `order` to the marker write validator on 2026-05-16. Atlas sends `order` on both CREATE and PATCH; server stores it; pulls return it. Adapter passes it through (it's a plain number — no relation handling needed).

Atlas's vertex visuals (read-only dots + edit handles + draft markers) all display 1-indexed order numbers inside the cyan circles, driven directly by the disk `order` field. Multi-machine sync of the same zone is now order-stable — both atlas instances pulling from the same server see the same explicit order, polygons reconstruct identically.

Earlier session-215 chronology (kept for future-me as a lesson):
- S1: stripped `order` after first 422 from live OW.
- S9: removed the strip thinking the server accepted it (Captain saw the field on the schema page).
- S9 follow-up: live OW 422'd again → re-stripped.
- S9 final: messaged Anchor; Anchor deployed the missing write-side migration; verified the push works without the strip → strip dropped permanently.

The takeaway for future server-schema-lag triage: the SDK and read-side schema can both declare a field that the write validator hasn't been deployed for. Trust the live 4xx, but also raise it to Anchor — usually a fast server fix is the right answer rather than a long-lived atlas-side workaround.

`SERVER_UNKNOWN_FIELDS_BY_TYPE` in `ow-client-adapter.ts` is now empty. The hook stays as the established pattern for future cases.

### 8.1 Marker SDK adapter — bypass NOT required (verified in F2)

Initial design assumption was that markers would need the same `prepareRelations` bypass as pins. Investigation in F2 showed otherwise.

**Why pin needs the bypass**: pin's `FIELD_SCHEMA` literally names the foreign-key field `element_id` (single_link). prepareRelations sees that name in the schema, matches it against the body, and re-suffixes → `element_id_id`. The server rejects.

**Why marker doesn't**: marker's `FIELD_SCHEMA` uses BARE relation names — `map` (single_link → map) and `zone` (single_link → zone). Atlas's marker disk shape uses wire-shape (`map_id`, `zone_id`) per the consistent spatial-element pattern. When prepareRelations processes a marker body, it looks up `map_id` and `zone_id` in the schema — neither exists (only `map` and `zone` do) — so it leaves both keys untouched. The server receives `{map_id, zone_id, x, y, order}` and is happy.

**Why zone doesn't**: zone's relations are all bare-name multi_link arrays (`phenomena`, `linked_zones`, `populations`, `titles`, `principles`). prepareRelations correctly converts each to its `_ids` wire form. No bypass needed.

**Defense encoded in fakes** (Convention #20): FakeOwApiClient and statefulOwHandlers reject any pin or marker write body containing `*_id_id` / `*_ids_ids` keys. If a future refactor accidentally routes a marker through prepareRelations-with-bare-names (which WOULD double-suffix), the regression fails its tests immediately.

Verified by `tests/integration/ow-client-adapter.marker.test.ts`.

### 8.2 Read-side unwrap

SDK returns Marker with `{map: {id, name}, zone: {id, name}, x, y, ...}`. The adapter's `adaptRecord` already unwraps both via `unwrapId` (Convention #5 — SDK-shape-agnostic). On disk we get `map_id` and `zone_id`. Verified during F2 with a roundtrip test.

### 8.3 Atlas-extension fields stripped on push

Per §5: `atlas_color`, `atlas_opacity`, `atlas_label_visible` are added to `ATLAS_LOCAL_EXTENSION_FIELDS` so the adapter's `toWireShape` drops them. No code change beyond constants.ts. *(v1 behaviour. Under v2 these three are in `ATLAS_WIRE_EXTENSION_FIELDS` and are SENT, not dropped — see the correction in §5.)*

### 8.4 Atomic batched creates (drawing finish)

A drawing finish creates 1 Zone + N Markers in quick succession. The SyncEngine's `pushPhase` already topologically sorts the never-synced batch (Convention #23) so Markers (which reference Zone via zone_id) push AFTER their zone. No new logic needed; the existing topo-sort handles it.

---

## 9. Test world fixtures

Three OW worlds covering the geometric scenarios. Created by Skeld via API or manually after F0 lands.

### World D — Simple polygons

```
Maps:
  Region Overview    (image, 2000×2000)

Zones:
  Forest             supertype=polygon
  Lake               supertype=polygon
  Mountain Pass      supertype=line

Markers:
  forest:    (200,200), (600,200), (600,600), (200,600)   — square forest
  lake:      (1000,1000), (1100,950), (1200,1000), (1150,1100), (1050,1100)
  mountains: (50,50), (1900,1900)                          — diagonal line
```

Expected: All three zones render on Region Overview. Forest is a clean square (4 markers, polygon, closed). Lake is a polygon with 5 points (pentagon-ish). Mountain Pass is a 2-point line.

### World E — Multi-map zone

Tests zones spanning maps.

```
Maps:
  North Map
  South Map

Zones:
  Trade Route        supertype=line

Markers:
  trade-route: order=0 (50,50) map=North
               order=1 (500,500) map=North
               order=2 (50,50) map=South
               order=3 (500,500) map=South
```

Expected: Trade Route appears on BOTH maps (in each chip strip). On each map, the line has 2 markers. listZonesOnMap('North') and listZonesOnMap('South') both return Trade Route.

### World F — Orphan + degenerate

Tests edge cases.

```
Maps:
  Active Map

Zones:
  Lonely Zone        supertype=polygon       (no markers anywhere — orphan from creation)
  Half-Drawn         supertype=polygon       (only 1 marker — degenerate)
  Empty Line         supertype=line          (0 markers)

Markers:
  half-drawn: order=0 (100,100) map=Active
```

Expected: Active Map's chip strip shows only Half-Drawn (the one with a marker). Lonely Zone and Empty Line appear in the elements list / referenced-by panels but not on any map. Half-Drawn renders as a single dot on canvas. No crashes.

### Fixture format

`tools/atlas/tests/fixtures/zone-worlds/world-{d,e,f}.json` — same pattern as map-worlds fixtures. Importable into unit tests and Skeld's API-population path.

---

## 10. Out of scope

For v1. Parked for later consideration.

- **Zone templates** (user-defined preset shape+supertype+subtype+visuals). Defer; build base UX first; revisit once usage data informs.
- **Customizable supertype/subtype registry** across all element types (Construct-as-registry pattern). Bigger thought, separate design pass.
- **Per-pin color**. Skipped per Captain.
- **Circle/ellipse zones**. No OW schema support; not in v1.
- **Multi-select zones / box-select / bulk operations**. Defer.
- **Undo/redo at session level**. HistoryManager exists per edit-mode session; global undo across edits is a separate concern.
- **Copy zone between maps** (transplant). Future.
- **Snap-to-existing-vertex** (ctrl+hover to snap onto another marker). Defer.
- **Map subtype filtering on zones** (show only "road" subtype). Filter chips on zone strip. Defer.
- **Cross-map zone visualization aggregation**. A zone spanning maps currently shows independently on each; no consolidated "zone X spans maps A and B" view. Defer.
- **Zone z-index ordering** (which zone renders on top when overlapping). Use a stable per-zone `atlas_z_order` extension field later. v1: insertion order via Leaflet's layer ordering.

---

## 12. Sign-off

This doc is the source of truth for the zone subsystem foundation. Bouts execute against it. If a decision proves wrong during implementation, the doc gets updated FIRST and the code follows — never the reverse (per the maps doc's doc-first discipline).

Companion files:
- `tools/atlas/PROGRESS.md` — operational state per bout
- `tools/atlas/tests/fixtures/zone-worlds/` — JSON fixtures (created in F1/F3)

When all bouts ship, this doc transitions from "active design" to "reference."
