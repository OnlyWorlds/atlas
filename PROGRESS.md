# Atlas — Progress Log

Track what's done, what's coming, rough edges, deferred decisions.
Architecture lives in **DESIGN.md**. This file is operational — read it to know where we are.

---

## NEXT CHAT PILE (curated 2026-05-16, session 215 close)

Captain-validated work queue for the next chat. Listed in rough do-first order; mix-and-match as smoke surfaces priorities.

### Zone subsystem follow-ups
- **Inline name editing on element-detail header (all element types)**. Replace the popover-edit pattern for the *name* field only with inline edit-in-place: click the name → field becomes editable + select-all-text. Enter commits + exits edit; Escape reverts; click-outside commits. The schema for all OTHER fields stays popover-driven. One-field exception, deliberate.
- **Auto-highlight name on zone create**. After Finish → already auto-selects the new zone. Add: navigate user to element-detail AND put the name field in inline-edit-mode with the placeholder text selected so they can immediately type a real name. Enter saves and deselects-the-field (zone stays selected, just exits the inline editor).
- **Allow moving existing markers while drafting a new zone**. Today drafting suspends other map interaction. Open up: vertex drag on existing selected zones should remain functional while a draft is in progress. Care needed around event-handler precedence — drafting must still capture canvas clicks for placement.
- **Visual polish on draft + edit markers** to match zoner's look. Zoner's numbered cyan markers + dashed preview path have a small visual edge atlas can match (glow, sub-pixel anti-aliasing on the number, finer dashed stroke).

### Visual settings popover follow-ups
- **Pin style / labels / tint live wiring** (V1.5, deferred from session 213). Today these prefs persist but don't render-respond. Wire pin-visuals.ts consumers:
  - `pin_style`: extend the cache key in `pinVisualFor` to include style; draw `round-icon` and `pin-shape` variants alongside the existing `icon` mode.
  - `pin_tint`: cache key + tint resolution (`type-color` / `accent` / `muted`) — return the color string the cache should use.
  - `pin_labels` + `pin_label_threshold`: render a divIcon label below each pin per the mode (always / hover / threshold / never). Lift the ghost-pin label threshold helper.
- **Popover label capitalization** — minor styling pass to match the rest of atlas (lowercase section labels with cyan accent chips).

### Sync / API
- **Repair existing server markers** pushed during the pre-migration broken window (their `order` is null server-side because atlas was stripping). Atlas's local data has order intact, so atlas renders fine; but other tools (or atlas-after-fresh-relink) might not. **Repair path**: enter edit mode on each affected zone → drag any marker a pixel and release → `updateMarker` PATCH now includes order → server updates → done. Alternative: wipe + redraw. Future zones push correctly from the start.
- **Verify zoner discrepancy resolved**. Pre-migration: zoner showed atlas-pushed polygons mangled because server had no order data and zoner's read pipeline didn't fall back to insertion order. Post-migration + after the marker repair above, both tools have explicit order from the server → zoner should render correctly. Smoke this: push a fresh zone from atlas, open in zoner, verify polygon outline is correct.

### Smaller items
- **ESC cancel during edit mode is shipped** (S4) but unverified in smoke. Quick test: enter edit, drag a vertex, hit ESC → vertex should snap back to original. If it doesn't, that's a bug to file.
- **Centroid drag handle** (zoner has a center dot that bulk-shifts the whole zone). Deferred; vertex-by-vertex covers v1.
- **Snap-to-existing-vertex** during draw/edit (zoner Ctrl+hover snaps onto another marker's coord). Polish, not v1.
- **DESIGN_ZONES.md cleanup** — §3 prose still mentions some not-shipped variants; the as-shipped behavior is mostly in §3.1-3.5 but a re-read pass would catch drift.

---

## Session 215 (2026-05-16) — Smoke fixes for zone subsystem

**Headline**: Captain smoked session 214's zone work. Five bug-fix bouts landed: image background z-stacking + popover-image collision + edit-handle positioning + selection-state cleanup + zone top-bar + on-map presence + the big one — marker read-side wire-shape preservation (made pulled zones invisible after relink). 477/477 vitest, bundle 447.04 → 448.55 KB JS, CSS 73.88 → 74.02 KB.

### Bug fixes

**Image disappears on popover open**. `setBackgroundGrid` was calling `backgroundLayer.clearLayers()` → wiped the image. Fix: separate `gridLayer` from `backgroundLayer` in Leaflet2DManager; new `setGridOverlay()` / `clearGridOverlay()` methods don't touch the background image.

**Canvas panels rendered behind the bg image**. Leaflet's pane z-indexes (180-700) bled up into the wrapper's stacking context because `.atlas-map-canvas-container` had no z-index. Fix: `z-index: 0` on the container — establishes a self-contained stacking context bounding all Leaflet z-indexes inside. Panels above (toolbar z=2, popover z=10, drawing overlay z=9) trivially beat container's z=0. Pre-fix also added: a custom Leaflet pane `atlasBgImagePane` at z=180 so the image renders below all other Leaflet panes regardless of DOM order. Both stay.

**Edit handle position off relative to read-only dots**. `margin: 0 !important` on the vertex-dot and edit-handle CSS was clobbering Leaflet's inline `margin-left: -anchor.x` / `margin-top: -anchor.y` (how it centers icons on latlng). Marker rendered with top-left at latlng instead of center. Edit handles' 7px offset was clearly visible. Fix: drop the margin/width/height `!important` overrides; let Leaflet's inline styles win.

### S6 — Selection state cleanup + vertex unification

Three coupled fixes:
- **Zone click on canvas didn't update sidebar/midpanel**: I was patching `selectedElementId` but not `navigate()`-ing to the element route. URL-driven middle pane stayed put. Pin click does both; zone click now does too (patch + navigate + sidebarMode: 'elements'). Chip click also navigates for consistency.
- **Two sets of vertex markers visible during edit**: S3 used `L.circleMarker` (SVG/overlayPane); S4 used `L.marker + divIcon` (HTML/markerPane). Different panes → different sub-pixel snapping. Switched S3 to `L.marker + divIcon` (same primitive as edit handles). Added `setVertexDotsSuppressed(zoneId, true)` to ZoneOverlay — edit module calls on entry to hide read-only dots while its handles take over at the same coords. On exit, dots unsuppress (zone still selected).
- **Edit state persisted when selecting another zone**: `syncEditMode` only handled "edited zone deleted." Added: exit edit when `selectedElementId !== editingZoneId` (selection change at any layer — chip, canvas, sidebar, midpanel — supersedes edit). Edit state is now genuinely a layer ON TOP OF selection.

### S7 — Zone top-bar maps + on-map presence badge

**Zone top bar**: extended `getAssociatedMaps` to handle zone type — returns distinct maps that have markers for the zone (cross-map zones surface multiple icons). Element-detail header for zones now renders `[map]` icons for each. Click → opens the map AND pans to the zone's centroid (average x/y of its markers on that map). No pin icons cluttering things up.

**On-map presence badge in sidebar**: new small cyan `place` icon rendered left of the type chip in elements-sidebar rows when the element has presence on the currently-active map. Two presence kinds:
- Element has a pin on the active map (any element type)
- Element is a zone with a marker on the active map

Computed once per render from `state.data.elements` + the active map tab. Distinct from the existing Location "has anchored maps" badge — this one says "currently visible on the open map."

### S8 — Marker read-side wire-shape preservation (the big one)

**Symptom** (Captain smoke): pushed markers to OW successfully; server confirmed map/zone links + coords correct; but neither zoner nor atlas-after-relink could see the zones on the map.

**Root cause**: `adaptRecord` was hardcoded `isPin = type === 'pin'` for the "preserve wire-shape" branch. Markers fell through to the non-pin path — `_id` suffix stripped to bare names on read. So disk got `{map: 'x', zone: 'z'}` instead of `{map_id, zone_id}`. Every atlas helper (`zone-derived`, `syncZones`, chip strip, edit mode) checks `marker.map_id` / `marker.zone_id` — undefined after pull → markers don't match any map+zone → no zones rendered.

**Fix**: renamed `isPin → wireShape`, included both `pin` AND `marker` in the bypass. Symmetric to the write-side convention #8 — pin and marker are both wire-shape on disk, both ways. Added 3 regression tests covering server response in nested form (`{map: {id, name}}`), flat form (`{map_id: 'x'}`), and null-zone-id (free marker case).

**Zoner-side note**: zoner displays the same server data messed up. Server is correct (atlas confirms). Zoner-side investigation deferred — see Next Chat Pile.

### S9 — Marker visuals (order labels) + Anchor migration + final centering

**Visual order labels** (1-indexed numbers inside the cyan circles):
- Read-only vertex dots (selected zone): 12×12 with 8px number.
- Edit-mode draggable handles: 16×16 with 10px number.
- Draft-mode markers: 18×18 with 10px number (unchanged from S2).
Three states share the same visual language: numbered cyan circles that grow as interaction deepens.

**Anchor server migration** (the real fix): atlas was workarounding a `422 Unknown field 'order'` from live OW via a per-type wire-strip. After messaging Anchor with the exact failing body + asymmetry vs zoner, Anchor identified the missing server-side write validator entry and **deployed the migration 2026-05-16**. Atlas now sends `order` on both CREATE and PATCH; server stores it; pulls return it. Strip removed permanently. `SERVER_UNKNOWN_FIELDS_BY_TYPE` in `ow-client-adapter.ts` is empty (hook retained for future cases). Multi-machine sync of zones is now order-stable.

**Chronology kept honest** in DESIGN_ZONES.md §8.0 — S1 strip → S9 attempted-remove (wrong, hit 422 again) → re-strip → messaged Anchor → migration deployed → strip dropped → verified. Lesson: trust the live 4xx, but raise it to Anchor for the real fix rather than long-lived workarounds.

**Centering fix** (final pass): the original number-centering pattern (`position: absolute; top/left: 50%; transform: translate(-50%, -50%)`) plus a defensive `position: relative !important` on the parent broke marker positioning in two ways:
- `position: relative !important` clobbered Leaflet's inline `position: absolute`, which broke the iconAnchor margin-based centering — markers rendered with top-left at the latlng instead of center.
- The percentage-based absolute centering inside a 12-16px parent with `box-sizing: border-box` + 2px border had a padding-box vs border-box percentage edge case that shifted the number bottom-left.

**Rebuilt** using flex centering on the parent (`display: flex; align-items: center; justify-content: center`). No `position: relative` override — Leaflet's inline `position: absolute` stays intact and the iconAnchor margin centers the marker on its latlng correctly. The number sits dead-center via flex, robust against pixel rounding.

**Visual fix**: restored 1-indexed order number labels inside vertex visuals:
- **Read-only vertex dots** (selected zone, not editing): 12×12 with 8px number, absolute-centered.
- **Edit-mode draggable handles**: 16×16 with 10px number, absolute-centered.
- **Draft-mode markers** already had numbers from S2; unchanged.
Three states now share the same visual language: "numbered cyan circle, gets bigger as you go deeper into interaction." `position: absolute; top/left: 50%; transform: translate(-50%, -50%)` pattern — defeats Leaflet's div-icon defaults reliably.

### Pokeable for next smoke:
- **Push a zone with markers** to api-linked world → no 422, server has the data with `order` populated, atlas pulls back correctly after unlink+relink. Server `GET /marker/?map_id=X` should now return each marker with its `order` value.
- **Zoner should now also render the polygon correctly** since markers carry explicit order on server.
- **Click any zone on canvas** → element-detail middle pane updates + sidebar reflects selection (the S6 fix).
- **Enter edit mode** → vertex handles appear at exactly the same positions the read-only dots were (S6 unification + edit-handle margin fix).
- **Switch from editing zone A to selecting zone B** (any path — chip click, canvas click, sidebar) → edit mode dissolves cleanly on A; B is just selected, not auto-edited.
- **Open a zone's element-detail** → top bar shows map icon(s) for each map with the zone's markers. Click → opens map + pans to zone centroid.
- **Browse the elements sidebar with a map tab open** → any element with a pin or zone-marker on that map shows the small cyan place badge next to its type chip.

### Known not-yet-shipped from the pile (see top of file):
Inline name editing, auto-highlight on create, marker drag during draft, pin style/tint/labels live preview, council motion for `Marker.order`.

---

## Session 214 (2026-05-16) — Zone smoke fixes + edit mode

**Headline**: Captain smoked session 213's zone work. Five fixes/features landed in one session, addressing real bugs (image background + canvas panel z-stacking + marker push 422), polish (draft label centering), and the largest missing piece (shape edit mode with drag/insert/delete). Zone subsystem is now end-to-end usable: create, view, sync, edit. 474/474 vitest green throughout (+2 new for the marker order strip; selection/edit visuals verified by smoke). Bundle 439.58 → 447.04 KB JS / 122.60 → 124.82 KB gzipped (+7.5 KB for edit mode). CSS 72.31 → 73.88 KB.

### Bug fixes from smoke

**Image disappears on visual settings popover open**. Root cause: my V1 `applyGrid` called `manager.setBackgroundGrid()` which calls `backgroundLayer.clearLayers()` — wiping the image. For URL images the destruction was synchronous; for local-image uploads, the blob loaded async after the clear so the image survived. Opening the popover triggered `applyLivePrefs` → `applyGrid(false)` → clear → image gone. **Fix**: separate `gridLayer` from `backgroundLayer` in `Leaflet2DManager`. New methods `setGridOverlay(spacing, color)` (non-destructive grid overlay above whatever background is set) and `clearGridOverlay()` (only touches the grid). `setBackgroundGrid` retained for the no-image fallback case. `applyGrid` in the popover now uses these clean methods.

**Canvas panels rendered behind the bg image**. Root cause: `.atlas-map-canvas-container` was `position: relative` but had no z-index, so it didn't create a stacking context. Leaflet's pane z-indexes (atlasBgImagePane=180, tilePane=200, overlayPane=400, markerPane=600) bled up into the wrapper's stacking context and competed with toolbar (z=2), popover (z=10), drawing overlay (z=9). Image at z=180 beat popover at z=10 → image rendered over the popover. **Fix**: added `z-index: 0` to `.atlas-map-canvas-container` — establishes a self-contained stacking context, bounding all Leaflet z-indexes inside. The wrapper's panels just need to beat container's z=0 as a whole (which they all do). Also added `overflow: hidden` on the container as belt-and-braces against oversized image overlay leaking into toolbar/zone-strip rows. **Pre-fix** I also added a custom low-z Leaflet pane (`atlasBgImagePane` at z=180) so the image renders below all other Leaflet panes regardless of DOM insertion order — that part stays; it solves a parallel issue (zone polygons in overlayPane at z=400 should sit above the image, and now they do).

**Marker push 422 "Unknown field 'order'"**. Root cause: OW server schema rejects `order` on marker writes despite SDK FIELD_SCHEMA declaring it (server schema lags SDK). **Fix**: new `SERVER_UNKNOWN_FIELDS_BY_TYPE` map in `ow-client-adapter.ts` keyed by ElementType — entries are stripped from wire body but preserved on disk. `marker → {order}` is the inaugural entry. Disk retains `order` for local geometry reconstruction (zone-derived.ts).`FakeOwApiClient` + `statefulOwHandlers` now both 422 on marker writes containing `order` (Convention #20: encode the rule in fakes before the caller). 2 new integration tests in `ow-client-adapter.marker.test.ts` lock the contract — marker bodies omit `order` on push regardless of caller input. Existing marker drawing flow updated: `zone-drawing.ts` finish still writes `order` to disk (it just doesn't reach the API). Bundle into M8 council motion (DESIGN_ZONES.md §7) — ask Anchor when/if marker.order will be settable server-side.

### S1 — Marker order strip (bout above)
### S2 — Draft marker label centering

Number labels on draft markers (cyan dots while drawing) were rendering bottom-left of the circle instead of centered. Root cause: my flex centering was losing to Leaflet's default `.leaflet-div-icon` background/padding rules. **Fix**: switched the inner `.atlas-zone-draft-marker-num` to `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%)` — reliable absolute centering that doesn't compete with Leaflet defaults.

### S3 — Proper selection visual: glow + vertex dots

DESIGN_ZONES.md §4.3's "selected zone visual" was underbuilt. Shipped:
- **Drop-shadow glow** on the SVG path via CSS class `.atlas-zone-selected` toggled in `ZoneOverlay.applyStyle`. `filter: drop-shadow(0 0 4px rgba(34, 211, 238, 0.85))`.
- **Vertex dots** at each marker position when zone is selected. Read-only in S3 (interactive in S4). Rendered as `L.circleMarker` (4px radius, cyan fill, white border) per point. `showVertexDots/hideVertexDots` lifecycle in `ZoneOverlay`.

Now when you click a zone chip, the canvas clearly shows: glowing outline + every marker as a visible dot. You can see what you've got. Sets up S4 (dots become drag handles).

### S4 — Shape edit mode (the big one)

Full implementation of DESIGN_ZONES.md §3, modeled on zoner with cleanups. New module `src/tabs/right/zone-edit-mode.ts` (~370 LOC). Captain's pattern locked: **single click selects, double click enters edit mode**; "Edit shape" button in element-detail Markers section is the alias entry; **ESC cancels (restores snapshot), Enter commits**.

**Entry**:
- **Dblclick zone polygon/polyline on canvas** → `enterEditMode(zoneId, mapId, toasts)`. New `onZoneDoubleClick` callback on `ZoneOverlay` wired to Leaflet's native `dblclick` event (which natively suppresses the preceding `click`, so no 200ms timeout dance — zoner's pattern was flagged janky in the second audit; atlas does it right).
- **"Edit shape" button** in element-detail Markers section (added in S4). Finds the first map this zone has markers on, opens the map tab if needed, enters edit mode there. Button label flips to "Done editing" + a Cancel ✗ button appears next to it while editing.

**During edit**:
- Vertex dots become draggable `L.Marker` instances (cyan circles, slightly larger, `cursor: grab`). Drag commits to folder-store on `dragend` (not during drag — `drag` is preview-only).
- Segment hover overlays — invisible 20px-weight polylines between consecutive markers (wrapping last→first for polygon zones). On hover, opacity 0 → 0.3 (cyan dashed). Click → insert marker at the **midpoint** of that segment (zoner pattern; not projection foot of click point) at order `i+1`, with renumber-all bumping every subsequent marker's order +1.
- **Right-click vertex** → delete marker. Refuses if it would drop below shape minimum (3 polygon / 2 line); toasts info.
- Map's `doubleClickZoom` is disabled on entry, restored on exit (avoids zooming when user dblclicks for another reason).
- Canvas container gets `.atlas-zone-editing` class → `cursor: crosshair`.

**Exit**:
- **Enter** key or **"Done editing"** button → commits (no-op since autosaved) + exits.
- **ESC** key or **Cancel ✗** button → cancel. Restores snapshot via 3-way diff: markers added during edit → delete; markers deleted during edit → recreate with original id/order; matched markers with mutated position/order → revert.
- **Map tab disposed** while editing → `abortEditModeForMap(mapId)` exits without restoring (the map's gone anyway).
- **Edited zone deleted from elsewhere** → `syncEditMode()` (in the global subscribe loop) detects it and exits cleanly.

**State**: new `ui.zoneEditing: { zoneId, mapId } | null` slice. Single global slot — entering another zone's edit commits-and-exits the current one first.

### Visual settings panel — confirmation
Yes, popover IS functional (per PROGRESS session 213): grid + pin drag lock are wired live, others persist correctly but don't render-respond yet. V1.5 follow-up will wire pin style/labels/tint to `pin-visuals.ts` (cache key expansion) when prioritized.

### Pokeable for next smoke:

- **Marker sync**: create a zone with N markers, push to online — no more 422. Server stores marker with map_id + zone_id + x/y but no order. Local file retains order. Multi-machine pull (if simulated): server markers come back without order; atlas reconstructs via created_at fallback.
- **Image still shows after popover open**: open visual settings cog, grid toggle on/off, image background remains untouched.
- **All panels render above the image**: toolbar, popover, drawing overlay, zone chip strip all visibly on top of the canvas.
- **Draft marker numbers centered**: while drawing a zone, each cyan dot has its order number centered inside.
- **Selection visual**: click a zone chip → polygon glows + vertex dots appear at each marker position. Switch to a Character → glow + dots disappear. Switch back via chip → reappear.
- **Edit mode entry**: dblclick a zone on canvas → vertex dots become draggable + segment hover overlays appear + cursor becomes crosshair + "Edit shape" button in element-detail header flips to "Done editing" + a Cancel ✗ appears.
- **Drag a vertex** → it moves, autosaves; polygon outline follows on dragend.
- **Hover over a segment** → cyan dashed line appears. Click → new marker inserted at the segment midpoint; subsequent markers' orders bumped.
- **Right-click a vertex** → marker deleted. Refuses if zone would drop below 3 (polygon) or 2 (line).
- **ESC during edit** → toast "edit cancelled"; all your drags/inserts/deletes from this edit session are rolled back.
- **Enter or "Done editing" button** → exits cleanly, changes preserved.
- **Cross-zone edit switch**: dblclick another zone while editing → first edit commits, second enters edit.

### Known rough edges (deferred):
- **Pin style/tint/labels live preview** (V1.5 — popover persists but consumer wiring deferred to follow-up).
- **Capitalization in popover labels** — minor styling consistency pass; bundle with future visual polish.
- **Centroid drag handle** (zoner has this — drag the whole zone at once via a center dot). Deferred; vertex-by-vertex is sufficient for v1.
- **Multi-machine marker order ambiguity**: when atlas A pushes markers (server has no order field), atlas B pulls them; B reconstructs order by created_at. If two atlas instances edit the same zone simultaneously, order might drift. Solo case is fine; multi-instance edit is a known limitation pending server schema update (M8 motion).
- **`order` field server motion** — bundle into M8 council motion.

---

## Session 213 (2026-05-16) — Zones subsystem foundation + features

**Headline**: The zone subsystem landed in one autonomous session. Pure-markers model (OW canon, no spurious map_id/coordinates on Zone), full drawing flow, chip strip, element-detail visuals + markers list, canvas toolbar with show/hide + fit-to-image. 13 bouts, all green at typecheck + vitest + build at every seam. 385 → 472 vitest tests (+87 — Zone CRUD, derived views, marker SDK, geometry math, prefs, drawing helpers). Bundle 410.21 → 439.58 KB JS / 114.85 → 122.60 KB gzipped (+29 KB across foundations + features). CSS 61.38 → 72.31 KB.

**Captain was off**. Work proceeded autonomously after design alignment. No commits — Captain will commit on return after smoke.

### Design (D1, D2)

**D1 — DESIGN_ZONES.md (new, 12 sections + bouts).** Full architectural reference for the zone subsystem: domain model (Zone = pure metadata, Markers = the only spatial truth — map relationship + zone relationship + x/y/order all on Marker), drawing flow (transient in-memory → materialize Zone + N Markers in one batch on Finish), edit flow (explicit Edit entry, handles, segment insertion, drag, delete, Done/Cancel with HistoryManager), UI surfaces (canvas toolbar + transient overlay + chip strip + element-detail zone sections), atlas-extension visual fields (atlas_color, atlas_opacity, atlas_label_visible — folder-only), cascade rules (map delete tombstones markers but preserves zones as orphan metadata), hit testing (20px invisible polyline overlay for lines), test fixture specs (Worlds D/E/F), and the F0→V5 bout sequence.

**D2 — DESIGN_MAPS.md §11-13 added.** New sections for the map visual settings popover, the canvas toolbar surface (settings/draw/show-hide/fit-to-image), and the zone chip strip docking model. Cross-references DESIGN_ZONES.md for zone-specific behavior. Existing §1-§10c untouched.

### Foundation (F0 — F5)

**F0 — Zone type cleanup**. Removed spurious `map_id` and `coordinates` fields from atlas's `Zone` interface. Added `zone_id?`, `z?`, `order?` to `Marker`. Updated FolderStore `listZones()` signature (no mapId — zones don't carry map relationship; derived view `listZonesOnMap` lives at the UI layer). Updated `findDependents` cascade: map-delete returns pins + markers (NOT zones — orphan zones preserved as metadata per DESIGN_ZONES.md §6.1). Migrated cascade tests to the new shape.

**F1 — Zone/marker cascade + CRUD tests** (+28 vitest). New `src/tabs/right/zone-derived.ts` with pure functions: `listZonesOnMap`, `markersForZoneOnMap`, `zoneGeometry`, `isOrphanZone`, `partitionZonesAndMarkers`. 13 unit tests cover the derived views including cross-map zones (one Zone with markers on two different maps surfaces correctly on both). 15 integration tests cover Zone CRUD, marker CRUD (mapId/zoneId/both filter), zone-delete cascades markers, marker-delete is a leaf, map-delete cascade preserves zone metadata, orphan zone survival.

**F2 — Marker SDK adapter (no bypass needed — finding)**. Initial assumption was that markers would need the same prepareRelations bypass as pins (Convention #8). Investigation showed otherwise: pin's SDK FIELD_SCHEMA has `element_id` as a literal single_link (so prepareRelations would re-suffix to `element_id_id` → bug). Marker's schema uses BARE names (`map`, `zone`) — atlas disk shape uses wire-shape (`map_id`, `zone_id`), prepareRelations sees fields not in the schema and leaves them alone. The server receives wire-shape, is happy. No code change required. Defense encoded in `FakeOwApiClient` + `statefulOwHandlers`: any pin or marker write body containing `*_id_id` / `*_ids_ids` keys now triggers a 400 in the fakes, so a future regression fails its tests immediately. 5 new integration tests in `ow-client-adapter.marker.test.ts` cover marker create/update/free-marker AND zone create/update (the latter verifying prepareRelations correctly suffixes `phenomena → phenomena_ids` etc.). Adapter comment block updated with the rationale.

**F3 — Leaflet2DManager polygon/polyline support** (+28 vitest). New `src/visualization/leaflet-2d/ZoneGeometry.ts` — pure geometry helpers ported from zoner's `ZoneCanvas.ts` (audit session pre-build): `distanceToSegment`, `distanceToSegmentSquared`, `projectToSegment`, `findClosestSegment` (with closed-polygon support), `polygonCentroid`, `polylineLabelAnchor`, `pointInPolygon`, `snapAngleTo45`, `snapToAxis` (the shift-snap math — projects click onto nearest 45° axis from anchor, clamped to non-negative distance), `pointListsEqual`. 28 unit tests cover edge cases including degenerate segments, point on segment, clamped projections, closed-vs-open polylines, label-anchor on longest segment. Decision: keep Leaflet2DManager pin-focused (already 895 lines); zones live in a sibling `ZoneOverlay.ts` class that takes the L.Map handle and manages its own LayerGroup. Polygons use Leaflet's native fill click; lines get an invisible 20px-weight polyline hit-overlay. Z-order naturally correct via Leaflet's `overlayPane` (zones, z=400) sitting below `markerPane` (pins, z=600).

**F4 — map_view_prefs storage** (+18 vitest). New `src/core/map-view-prefs.ts`. Two localStorage slices: `atlas_map_view_defaults` (atlas-global) + `atlas_map_view_prefs` (Record<mapId, Partial<MapViewPrefs>>). Schema: pin_style (icon/round-icon/pin-shape), pin_labels (always/hover/threshold/never) + pin_label_threshold number, pin_tint (type-color/accent/muted), show_grid + grid_spacing (50/100/200), lock_pin_drag, zone_fill_opacity (0..1), zone_labels (always/hover/never). Helpers: `getAtlasDefaults`, `setAtlasDefaults`, `resetAtlasDefaults`, `getMapOverride`, `setMapOverride` (undefined removes a field), `resetMapOverride`, `getEffectiveMapPrefs` (factory → atlas defaults → per-map merge), `saveMapPrefsAsDefault` (promotes effective prefs to atlas-wide and clears the map's override). Atlas-extension fields added to `ATLAS_LOCAL_EXTENSION_FIELDS`: `atlas_color`, `atlas_opacity`, `atlas_label_visible` (Zone-specific). 18 unit tests cover storage round-trips, merge precedence, partial-merge accumulation, the save-as-default + reset flows, and corrupt JSON fallback.

**F5 — Canvas toolbar scaffold**. New `src/tabs/right/map-tab-toolbar.ts` — `buildCanvasToolbar()` returns DOM refs for 6 buttons (settings cog, draw polygon, draw line, show/hide zones, show/hide pins, fit-to-image) plus dividers. `MapTabCacheEntry` extended with `wrapper` (the new vertical flex column wrapping toolbar + canvas container) and `toolbar` (the toolbar div). `mountMapTab` restructured: pane now hosts the wrapper, wrapper hosts toolbar (flex 0) above the leaflet canvas container (flex 1, position relative, preserves the existing absolute overlays). `disposeMapTab` removes the wrapper as one unit. Toolbar buttons stub with `data-action` attributes; behavior wires in V1-V5. CSS: `.atlas-map-tab-wrapper`, `.atlas-map-canvas-container`, `.atlas-map-toolbar`, `.atlas-map-toolbar-btn` (with `is-active` state for drawing-mode highlight), `.atlas-map-toolbar-divider`.

### Features (V1 — V5)

**V1 — Visual settings popover**. New `src/tabs/right/map-visual-settings-popover.ts` — left-anchored floating panel (~320px wide), opens on settings-cog click. Contents per DESIGN_MAPS.md §11: pin style 3-way, pin labels mode + threshold input, pin tint 3-way, grid toggle + spacing radio, pin drag lock, zone fill opacity slider, zone labels mode. Footer: "Save as default" + "Reset this map". Live consumers wired in V1: **grid (show/hide + spacing) via `manager.setBackgroundGrid()`** and **pin drag lock via `marker.dragging.enable/disable()` on all existing pins**. The other prefs (pin style, labels, tint, zone fill opacity, zone labels) persist correctly but their consumers ship in follow-up bouts — V3 wires zone_fill_opacity + zone_labels via ZoneOverlay; pin-style/tint/labels live wiring deferred to V1.5 (per the bout's "MUST/NICE/DEFER" budget). Outside-click + Escape close the popover; settings cog re-click toggles.

**V2 — Zone drawing on canvas**. New `src/tabs/right/zone-drawing.ts` + `zone-drawing-overlay.ts`. Module-level singleton draft state (only one in-progress zone across atlas at a time). Toolbar's Polygon/Line buttons enter draw mode → cursor flips to crosshair → toolbar button gets `is-active` highlight → transient overlay strip mounts below the toolbar (count + shift-snap hint + undo/finish/cancel). Click on canvas appends a marker (clamped to canvas bounds, integer-rounded). **Shift-snap** (DESIGN_ZONES.md §2.4): hold Shift while clicking → new marker snaps to nearest 45° axis from the previous → perfect rectangles via 4 shift-clicks. Live preview: numbered cyan DivIcon markers (ported zoner pattern) + dashed cyan polyline (for line) or polygon-fill ghost (for polygon, once ≥3 markers). Undo pops last marker. Cancel (button or ESC) discards. **Finish**: in one batch, `createZone({ name, supertype })` (no map_id — pure metadata) → `createMarker({ map_id, zone_id, x, y, order: i })` × N → patch elements → `requestPushIfLinked` → select the new zone (lands user in element-detail). Auto-numbered name: `findUniqueZoneName('new zone'|'new line', zones)` walks `<base>` / `<base> (2)` / `<base> (3)` series — 6 unit tests cover the helper. Min-marker gate enforced (3 polygon, 2 line). On dispose-map-tab, any in-flight draft on that map cancels automatically.

**V3 — Zone chip strip + canvas rendering** (the canvas-side ZoneOverlay finally lights up). New `src/tabs/right/map-tab-zones.ts`. `syncZones(entry)` reads `state.data.elements`, derives zones-on-this-map via `listZonesOnMap`, computes geometry per zone from `markersForZoneOnMap`, calls `overlay.addZone/updateZone/removeZone`. Effective color/opacity per zone uses `atlas_color` / `atlas_opacity` with fallback to the map's `zone_fill_opacity` pref. Label text from `atlas_label_visible` + map's `zone_labels` mode. Below-canvas chip strip rendered for each zone: shape glyph (hexagon/show_chart) + color dot + name + on-hover delete-X. Click chip → select zone (sets `selectedElementId` → chip + canvas outline both highlight). Right-click chip → context menu (Rename / Delete) via prompt/confirm. Delete cascades markers per DESIGN_ZONES.md §6.2. Hooked into the global subscribe loop so any element change re-syncs zones on the active map; selection changes also trigger re-sync so canvas highlight reflects element selection from anywhere. ZoneOverlay disposed BEFORE manager.destroy in `disposeMapTab`.

**V4 — Element-detail Zone sections**. New `src/middle/element-detail-zone-sections.ts`. When `selectedElementId` is a Zone, element-detail injects two new sections AFTER the standard schema sections and BEFORE Referenced-By. "Zone visuals (local)" — color picker (HTML5 color input + text mirror, validates 6-digit hex), opacity slider 0–100% with live readout, label-visible checkbox. All write via `store.updateZone` → atlas-extension fields stripped from API push by adapter. "Markers" — for zones with no markers, friendly empty state with hint. For populated zones: grouped by map (small per-map header with map icon + name + count), then ordered list of marker rows (order # + (x,y) coords + pan-to button + delete trash). Pan-to opens the map tab if not already open then calls `panMapTabTo` to center on the marker. Delete cascades nothing (markers are leaves) but bumps subsequent markers' implicit order (display only — disk order stays as-is). All wired with event delegation.

**V5 — Remaining toolbar buttons**. New methods on Leaflet2DManager: `fitToCanvas(padding)` (fits view to full canvas dimensions, not just pin bounds) and `setPinsLayerVisible(visible)` (bulk toggle of pinsLayer + labelsLayer attach/detach). Toolbar buttons wired: Show/hide zones → `zoneOverlay.setLayerVisible()` with glyph-swap visibility↔visibility_off + button is-active state. Show/hide pins → `manager.setPinsLayerVisible()` same pattern. Fit-to-image → `manager.fitToCanvas()`. Both visibility toggles are transient (not persisted to prefs — they're quick declutters, not preferences).

### Cleanup
- `_isDrawing` import in map-tab.ts pruned (never called externally; module's `getActiveDraft()` covers the access pattern).
- DESIGN_ZONES.md §8.1 rewritten to reflect F2's actual finding (marker doesn't need bypass).

### Pokeable for next smoke (Captain's return):

**Zone drawing**:
- Open a map with an image → toolbar shows ⚙ ⬡ ╱ 👁zones 👁pins ⤢ buttons.
- Click ⬡ Polygon → cursor flips crosshair, transient overlay strip appears top-center ("0 markers • hold shift to snap • undo finish cancel").
- Click around 3+ times on the canvas → numbered cyan dots appear, dashed cyan polygon preview connects them.
- Hold Shift + click → next marker snaps to 0/45/90° axis from previous. Click 4 times at right angles → perfect rectangle.
- ↶ Undo button enabled after first marker; pops last.
- ✓ Finish button disabled until ≥3 markers (polygon) or ≥2 (line); enabled → click → zone + markers persist with auto-named "new zone" / "new zone (2)" / etc; canvas now renders the real cyan polygon outline + fill; element-detail in middle pane jumps to the new zone.
- Same with Line tool (╱) — 2-marker min, polyline preview, no fill.
- ESC at any point or ✗ Cancel discards the draft.

**Zone chip strip**:
- A zone exists on this map → strip appears below the canvas with a chip showing shape glyph + color dot + name.
- Click chip → middle pane navigates to that zone's element-detail; canvas outline thickens (selection style).
- Right-click chip → menu with Rename / Delete. Rename uses a prompt. Delete confirms and cascades markers.
- Hover chip → small × appears on the right; click → same delete confirm.

**Element-detail Zone sections** (when a Zone is selected):
- "Zone visuals (local)" section with `local only` chip in the header (tooltip explains: stored locally, not synced to API).
- Color picker → live update + autosave. Hex text input mirror works; invalid hex reverts.
- Opacity slider → live update with % readout.
- Show-label checkbox → toggles a divIcon label rendered at the polygon centroid / line midpoint.
- "Markers" section grouped by map with per-marker pan-to (crosshair icon) and delete (trash).

**Visual settings popover** (⚙ cog):
- Click ⚙ → left-anchored floating panel slides in over the canvas. Map stays visible to its right.
- Grid toggle + spacing (50/100/200) → live applies to canvas. Pin drag lock → all existing pins go un-draggable / re-draggable.
- Pin style / labels / tint / zone fields persist but live preview for pin-style/tint/labels is deferred — V1.5 will wire those consumers.
- Save as default → promotes current effective prefs to atlas-wide defaults; clears this map's override.
- Reset this map → clears the per-map override; effective prefs fall back to atlas defaults.
- Re-click ⚙ or Escape or click outside → close.

**Show/hide layers + fit-to-image**:
- Click 👁 zones → all zone polygons/polylines vanish from canvas; button gets active state; glyph swaps to visibility_off. Re-click restores.
- Same for 👁 pins.
- Click ⤢ → camera animates to fit the full map image (not just pins).

### Known rough edges (intentional v1 deferrals):
- Pin style / labels / tint live preview deferred to V1.5 (popover writes through but pin-visuals layer doesn't yet listen).
- Zone shape editing (drag handles, segment insertion, marker delete via canvas right-click) is unwired in v1 — markers can be deleted from the element-detail Markers section, but in-place edit needs a future bout (DESIGN_ZONES.md §3, marked for after smoke).
- HistoryManager (zoner audit identified for port) is not yet imported. Edit-mode cancel-via-undo lands with that port.
- Zone canvas right-click context menu (Edit shape) is unimplemented (DESIGN_ZONES.md §3.1 lists this as a future entry-point).
- Grid "off" path uses a max-spacing render (effectively invisible) rather than a proper layer clear. A future `Leaflet2DManager.clearGrid()` method would be cleaner; deferred.
- Trash-zone drag for chips not implemented — chip click-X + right-click delete cover the gesture.

### Continuity threads:
- Zone subsystem is feature-complete for drawing + viewing + visual editing. **Edit-shape mode is the next major bout** (handles, segment insert, HistoryManager-backed cancel).
- Schema/council motion still pending (DESIGN_ZONES.md §10 lists Open Extensions). M8 in DESIGN_MAPS.md bundles zone field description updates.
- Atlas-extension visual fields are now established for Zone (atlas_color / atlas_opacity / atlas_label_visible) — same pattern can extend to other element types as desired.

---

## Session 212 (2026-05-16) — Recovery, polish, and the map-tab split

Ten bouts, all green at typecheck + vitest + build at each step. 385 → 385 vitest (UI/behavior changes verified by existing coverage + smoke; no new tests). Bundle 400.21 → 409.16 KB JS / 110.85 → 114.56 KB gzipped (+9 KB across all bouts).

**Bout R1 — Atlas root recovery.** New `atlasRootRecoverable` state slice. `hydrateAtlasRoot` now detects the "orphan handle" case (registry has no `atlas_root` but the vault still holds the handle under `ATLAS_ROOT_HANDLE_KEY` — typical after localStorage clear). Surfaces as a recoverable signal. New `recoverAtlasRoot()` flow: loads orphan handle → `ensureWritable` (user gesture from the recover button) → validates `.atlas-root` marker → restores registry entry → runs `discoverWorldsInRoot` to rebuild the world list from disk. Sidebar header swaps to `↻ Recover atlas folder` button when recoverable; welcome panel shows "Welcome back" CTA with folder name. Marker-gone case purges the orphan and toasts "folder no longer looks like an atlas root — pick again." Also extended `discoverWorldsInRoot` to register api-linked worlds (read `world.json`'s `api` block) instead of always-local-only — fixes a latent bug where recovered api-linked worlds lost their sync wiring. Post-recovery URL hygiene: if hash is deep (`#/w/<id>/...`) from before the clear, reset to `#/` so sidebar lands on worlds mode without requiring a tab click.

**Bout R2 — Map tree polish.** New `atlas-map-tree-row-open` class: open-tab map names (active OR background) get cyan + medium weight, distinct from `.selected` which is active-tab-only. Distinguishes "loaded but not focused" from "currently focused." Location chip icon swapped from `location_on` (pin-shape glyph) to `castle` (matches SDK `ELEMENT_ICONS.location` used everywhere else — sidebar, pin canvas). Chip now reads as "this is a Location" rather than "this is a pin."

**Bout R3 — Map create modal fixes.** Hint warning now only fires when BOTH a local file is uploaded AND a URL is typed (was firing on URL-only, which is the canonical path). Auto-open the new map's tab on create when the map has any image source — image-less maps skip auto-open (user likely still configuring).

**Bout R4 — Map element top-bar self-open.** Map detail header gets a single `map` icon button → opens (or focuses) this map's right-pane tab. Cyan tint when image present. Symmetric with the location-Map affordance pattern but distinct: this one is for the map element viewing its own detail.

**Bout R5 — Drag elements from sidebar onto map (DESIGN_MAPS.md §8, deferred → shipped).** Element rows in elements-sidebar are now `draggable=true` (except `map`, which can't be a pin target per §1.4). Custom MIME `application/x-atlas-element` carries `{id, type}`. Map tab container is a drop target with cyan dashed outline on dragover. Drop handler: gates on image presence (§4.1), projects drop event to image coords via Leaflet's `mouseEventToLatLng`, writes pin through the same `createPin` path used by right-click + placement-banner — element_type included from the drag payload so the OW server-validation rule (convention #19) is honored.

**Bout F1 — Folder-gone auto-cleanup.** Activating a world whose folder was deleted outside atlas now: catches the `NotFoundError` from `store.open` → deletes the dead handle from vault → removes the registry entry → surfaces a toast "<name> folder is gone — removed from atlas" → reverts URL to priorHash. No new buttons; the user's natural "click to open" gesture triggers cleanup. Click-time covers the 95% case; mid-session sweep is heavier than the payoff.

**Bout DR — Drag-to-reorder maps in tree (DESIGN_MAPS.md §8, deferred → shipped).** Tree rows are `draggable=true`; on drop, source and target must share `data-parent-id` (rendered-tree parent — same explicit `parent_map` OR same location-inferred parent). Cross-parent drag refused with toast directing to the create-modal's parent_map override. Drop position (above/below) computed from cursor-Y vs target row midpoint. New cyan drop-indicator line via `::after` pseudo-element. After drop, hierarchy is re-stamped 0,1,2,... on all affected siblings — many writes but siblings count is usually small, single `requestPushIfLinked` at the end coalesces into one autosave window.

**Bout SP — `map-tab.ts` split (long-term health refactor).** The file had grown to 858 lines doing 5 concerns. Split into:
- `map-tab.ts` (470 lines) — mount/dispose/pan + interaction wiring (click, contextmenu, drag, drop) + the subscribe hot path
- `map-tab-cache.ts` (45 lines) — `MapTabCacheEntry` type + shared `mapTabCache` Map
- `map-tab-pins.ts` (149 lines) — `syncPins`, `refreshChipStrip`, `refreshActiveMapPins`
- `map-tab-pin-drag.ts` (129 lines) — `enablePinDrag`, `isInsideZone`, `clampToCanvas`
- `map-tab-backgrounds.ts` (144 lines) — `applyMapBackground`, `sourceKey`, `refreshCachedBackgrounds`, `decodeImageDims`
- `map-tab-tooltip.ts` (32 lines) — `buildPinTooltipHtml`, `escapeHtml`

Public surface unchanged (`mountMapTab` / `disposeMapTab` / `disposeAllMapTabs` / `panMapTabTo`). Internal: `pin-drag.test.ts` updated to import `enablePinDrag` from the new submodule. All 385 tests still pass. Unlocks per-concern unit tests in future bouts (e.g. chip-strip ordering, drop-on-trash predicate).

**Two right-click select tweaks** — right-clicking a map in the tree row OR a map tab in the right-pane tab bar now selects the map ELEMENT (navigate to element-detail in middle). Left-click still opens the tab. Right-click is the "edit this map's fields" gesture. Stale tabs skipped (no element to select). Symmetric across both surfaces.

**Late addition — imageless maps don't open tabs + greyed tree label.** Map subsystem completion touch. Two coordinated changes:
- `openMapTab` gates at the funnel: if the map has neither `image_url` nor `image_media_id`, toast "set a map image to view its canvas" and (if no `preserveElementId`) divert the user to the map's element detail. No tab added. Catches every caller automatically — tree row click, top-bar self-open icon, Location top-bar `[map]` icon, any future invocation. Removes the jarring empty-canvas state when clicking an imageless map.
- New `.atlas-map-tree-row-imageless` CSS class on the row's name span: muted white (35%) + italic. Pairs with the open-tab cyan state — three orthogonal row states now (open, imageless, selected) that compose cleanly. Imageless can't be open after this change, so those two never co-occur in practice.

**Pokeable for next smoke:**
- Clear localStorage → reload → welcome shows "Welcome back" → recover → worlds list populates AND URL resets to `#/` → sidebar already on Worlds mode (no need to click Worlds tab).
- Activate a world whose folder you've deleted in OS → toast "folder is gone — removed from atlas" → entry disappears from sidebar.
- Drag any element row from sidebar onto a map → cyan dashed outline → drop → pin placed.
- Drag a map tree row up/down within the same group → cyan drop-indicator line → release → hierarchy re-stamped, push fires.
- Right-click any map tree row OR map tab → middle pane flips to that map's element detail, right pane unchanged.
- Click an imageless map (no `image_url`, no upload) in the tree → toast + middle flips to its element detail, NO tab added. Its tree label renders muted+italic so you can spot which maps still need configuration.

**Next chat pile:**
- Zones port (the "fun stuff" — fresh design conversation up-front, like the map foundation)
- M8 council motion (paperwork — map field descriptions + pin coord origin)

---

## Session 210 (2026-05-15) — Map subsystem MW/NPM/XR layer

Five bouts, all green at typecheck + vitest + build at each step. 347 → 375 vitest (+28). Bundle 380.40 → 390.05 KB JS (+9.65 KB across new features).

**Bout L0 — doc reconciliation + lock cleanup.** DESIGN_MAPS.md updates: §3.4 (lock toggle) struck — auto-open is removed, lock had nothing to gate; §3.6 rewrote to reflect the no-auto-open model; §3.8 added (ghost pins / cross-element rendering). §10c updated with the session 210 bout sequence. Deleted dormant lock code: `RightTabRef.locked` field on map tabs, `isActiveMapTabLocked()`, `maybeAutoOpenMapFor()`, `MapPickerModal` (entire file), lock CSS block, lock-related comments/handlers in right-pane.ts and map-tab.ts. `auto-open-map.ts` rewritten down to just `getAssociatedMaps()` + `getLocationMapPresence()` — both still used by MW. Tests pruned: `auto-open-map.test.ts` lost the lock-gate test; `sync-attach.idSwap.test.ts` renamed the "preserves locked flag" case to "preserves worldId stamp." Net -1 vitest from removed lock test.

**Bout S — Maps Settings tab.** `'maps'` added to `SETTINGS_TABS` between `'sync'` and `'world'`. New registry shape `maps_settings: { show_map_names_in_header?: boolean }` (atlas-level, not per-world). Registry helpers `setMapsSettings` / `getMapsSettings` (partial-merge writer + defaults reader). New `renderMapsTab()` + `wireMapsTab()` in settings-panel.ts. First toggle: "Show map names alongside map icons in element header" (default OFF). 4 new vitest in registry.test.ts (defaults, round-trip, partial-merge, save/load persistence). 351 vitest.

**Bout MW — top-bar map+pin affordances.** Element-detail header now carries two new clusters per DESIGN_MAPS.md §3.5:
- For Locations: `[map][map] | [pin][pin] | [+map] [+pin] [sync-dot] [trash]`
- For other elements: `[pin][pin] | [+pin] [sync-dot] [trash]`

`[map]` icons render only for Locations (one per anchored map). Click → `openMapTab(m)`. Cyan tint when the map has an image (`atlas-map-tree-icon-has-image` reused). Optional name label appears when Maps Settings toggle is ON.

`[pin]` icons render for ALL element types (one per existing pin). Click → opens that pin's map tab AND camera-pans to the pin's stored coords. New `panMapTabTo(mapId, x, y)` exported from map-tab.ts; waits on `entry.ready` so freshly-opened tabs settle before the camera moves.

`[+map]` button renders only for Locations. Click → opens `MapCreateModal` with location pre-filled (new `initialLocationId` option on `MapModalOptions` + `createMapDialog`) and suggested name `Map of <Location Name>`.

`[+pin]` keeps existing gating (only renders when a map tab is active in the right pane) but moves into the new create-cluster zone.

The M7 inline `renderMapPresence` widget + `buildMapPresenceChip` helper deleted from element-detail.ts (~80 LOC removed). New CSS for `.atlas-header-cluster`, `.atlas-header-existing`, `.atlas-header-create`, `.atlas-header-cluster-divider`, `.atlas-header-map-affordance`, `.atlas-header-pin-affordance`, `.atlas-header-map-label`. 351 vitest (no new tests — visual changes will be exercised by smoke). Bundle 381.36 → 383.11 KB JS.

**Bout NPM — new-pin modal autocomplete (DESIGN_MAPS.md §3.7).** `ElementCreateModal` extended with two options: `enablePlaceExisting: boolean` and `onPlaceExisting?: (id, type) => void` (plus a `title?: string` override). When `enablePlaceExisting` is set, the NAME field gains a ghost-line autocomplete pattern mirroring the existing category-input ghost: typing scans elements of the currently-selected category whose name starts with the typed text; TAB at end of input accepts → button label flips `Create → Place` + a cyan chip appears next to the modal title (`"placing existing · <category>"`). Submit Place calls `onPlaceExisting(id, type)` instead of creating a new element. Multi-match tiebreaker: latest `local_updated_at` wins. Category change while in Place mode reverts to Create mode (the held id belongs to the prior category). Editing the name away from the accepted suggestion also clears Place mode.

The matcher extracted to a pure helper `src/ui/element-name-match.ts` for unit testing. 7 new vitest in `element-name-match.test.ts` covering case-insensitive prefix match, strict-length-required, category filter, tiebreaker, defensive paths. Wired into map-tab.ts right-click contextual flow: modal title becomes "New pin"; both `onCreated` and `onPlaceExisting` share a `writePin(elementId, elementType)` closure for the actual pin write. 358 vitest. Bundle 386.89 KB JS.

**Bout XR — ghost pins (DESIGN_MAPS.md §3.8).** New `src/tabs/right/ghost-pins.ts`:
- Pure helpers: `computeGhostCandidates(sourceElementId, mapId, elements)` returns siblings sharing the same `location` (excluding source itself, excluding elements already pinned on this map, restricted to eligible types). `computeGhostPositions(sx, sy, n, radius)` places N ghosts evenly around source at fixed radius (default 70px), first ghost at 12 o'clock, walking clockwise. `isGhostEligible(type)` reads SDK `FIELD_SCHEMA` at runtime — types with `location: single_link → location` qualify, except `'map'` (per §1.4). Currently resolves to `character, creature, object`.
- Stateful side: module-level cache keyed `mapId → { layer: L.LayerGroup, markersBySource: Map<sourcePinId, GhostMarkerEntry[]> }`. `toggleGhostsAtSourcePin()` is the single entry point: returns 0 to signal toggle-off (source had active ghosts → cleared); returns > 0 to signal toggle-on (computed candidates and spawned markers). `pruneSingleGhost(mapId, ghostId)` removes one ghost; the cache cleans up the source bucket when it empties. `disposeGhostsForMap()` runs from `disposeMapTab` to release the Leaflet layer.
- Visuals: same icons as real pins (via `pinVisualFor`), 40% opacity, `zIndexOffset: 500` so ghosts sit above real pins for click hit-testing.
- Interactions: left-click ghost → `selectedElementId` + element-detail navigation (same as real pin click). Right-click ghost → prune just that ghost. `L.DomEvent.stop` on both so the underlying map-level contextmenu (the "New pin" modal trigger) doesn't double-fire.

`Leaflet2DManager` gained a `pin-contextmenu` event — emitted from the marker's contextmenu handler with `L.DomEvent.stop()` on the original event so map-level contextmenu doesn't also fire when right-clicking on a real pin. `pin-contextmenu` added to `Leaflet2DEventType` + `EventCallbacks` type registry. `map-tab.ts` subscribes and calls `toggleGhostsAtSourcePin()` with the pin's coords.

17 new vitest in `ghost-pins.test.ts` (eligibility, same-location filter, source-exclusion, already-pinned-exclusion, other-map-pinned still qualifies, ineligible-types skipped, missing-location source returns empty, position math at 1/4 angles, deterministic ordering, default radius). 375 vitest. Bundle 390.05 KB JS / 109.67 KB gzipped.

**Pokeable surfaces (session 210):**
- Settings → Maps tab → toggle "Show map names alongside map icons in element header" → map icons in element-detail top bar grow name labels.
- Open any Location detail → top bar shows `[map]` icons for its anchored maps + `[+map]` button → `[+map]` click opens a pre-filled MapCreateModal (location chip set, name "Map of <X>").
- Open any element with existing pins → top bar shows `[pin]` icons → click one → opens that pin's map and pans to it.
- Right-click an empty area of a map → modal title "New pin" → type a prefix matching an existing same-category element → ghost suffix appears → TAB → button flips to "Place" + chip "placing existing · <category>" → submit → pin dropped at click point pointing at existing element.
- Right-click an existing real pin on a map → ghost pins appear in a circle around it for all other Characters/Creatures/Objects sharing the same `location` AND not already pinned on this map. Right-click same pin → ghosts disappear. Right-click a ghost → that one ghost goes away. Left-click a ghost → element-detail opens for that element.

**Next session pile:**
- M8 council motion (paperwork — map field descriptions + pin coord origin)
- Zoner port (the "fun stuff" Captain flagged for later)
- Anything that smoke surfaces from this session's work

---

## Session 211 (2026-05-15 cont.) — first MW/NPM/XR smoke round

Captain's first-pass smoke on session 210 work surfaced 10 issues. All shipped in this round; typecheck/vitest/build green throughout. 375 → 377 vitest (+2 new ghost-pins tests for Location sources). Bundle 390 → 393 KB JS.

**SMK-1 + SMK-5: Top-bar `[map]` / `[pin]` clicks lost element selection.** Root cause: `openMapTab(m)` navigated to `#/w/<id>/map/<mid>` — bare map hash → middle pane fell through to welcome stat-panel. Fix: `mapHash(worldId, mapId, elementId?)` overload + new `preserveElementId` arg on `openMapTab(m, preserveElementId?)`. Element-detail's `buildMapAffordance` and `buildPinAffordance` now pass `el.id` so the chained `/map/<mid>/element/<eid>` URL keeps element-detail mounted in middle while the map opens on the right.

**SMK-2: Welcome stat-panel shouldn't be a default destination.** `app.ts:renderMiddle` flipped: when a world is active and the route doesn't otherwise pin a mode, default to `'timeline'` instead of `'welcome'`. Welcome remains only for the no-active-world root. Applies to map routes without an elementId too — falls back to timeline rather than welcome.

**SMK-3: `[+map]` icon looked like a pin.** Was `add_location_alt` (pin glyph). Replaced with two-glyph composition: small `add` + normal `map`, distinct from `[+pin]` (`push_pin`) and from existing `[map]` icons (just `map`). New `.atlas-header-add-map` + `.atlas-add-map-plus` + `.atlas-add-map-glyph` CSS rules.

**SMK-4: Map name labels didn't show with toggle ON.** Root cause: `.atlas-icon-btn-sm` is fixed 22×22px square — label was being clipped. Added explicit override on `.atlas-header-map-affordance.atlas-header-map-affordance-labeled` to set `width: auto; min-width: 22px; height: 22px` so labeled variant widens to fit the inline name text.

**SMK-6: Map detail middle pane shows pinned-element strip.** New `renderMapPinnedElementStrip(mapEl, elements, header)` renders a cluster of category icons (one per element pinned on this map, deduped) in the top bar — up to 12 visible inline; if more, a `+K more` chip opens `ElementPickerModal` filtered to the remaining pinned-element ids. Each icon click navigates via chained `#/w/<id>/map/<mid>/element/<eid>` so the map stays open. New `restrictToIds?: string[]` option added to `PickElementOptions`. New CSS for `.atlas-header-map-pinned-strip`, `.atlas-header-pinned-icon`, `.atlas-header-pinned-more`.

**SMK-7: Middle-mouse-button closes map tabs.** Auxiliary `mousedown` (`e.button === 1`) on a map tab calls `closeMapTab` — standard browser-tab QOL. `auxclick` also blocked to suppress OS-level autoscroll cursor / paste-on-middle. Map-index tab is untouched (it's pinned). Right-pane.ts:171-189.

**SMK-8: `[pin]` camera-pan was zoomed too far out.** `panMapTabTo` was using `manager.panTo(x, y)` which preserves current (zoomed-out) zoom level. Changed to direct `lMap.setView(latlng, 1, {animate, duration: 0.4})` — zoom level `1` (vs the default `initialZoom: -1`) lands the pin comfortably mid-zoomed.

**SMK-9: Right-click on a Location pin said "no location set."** Root cause: code reached for `source.location`, but Location elements have `parent_location` not `location`. Fix: new `resolveSourceLocationId(source)` helper — for Location sources, the locId IS the source's own id (since other elements' `location` fields point AT it); for content-element sources, use `source.location` as before. `computeGhostCandidates` and the toggle's source check both go through this helper. 2 new tests in `ghost-pins.test.ts` covering Location-pin case + mixed eligible types under a Location source.

**SMK-10: Pin delete via drag-to-trash.** New trash drop-zone div added to each map tab's container (top-right, hidden by default). `enablePinDrag` now wires three marker events: `dragstart` reveals the zone, `drag` live-updates a `data-hover` attribute as the marker passes over the zone bounding rect, `dragend` checks whether the drop fell inside the zone via `latLngToContainerPoint` + `getBoundingClientRect` overlap test. Inside zone → `store.deletePin(pinId)` → refresh elements → `requestPushIfLinked` (existing tombstone + sync path). Outside zone → existing coord-update path. New `.atlas-pin-trash-zone` CSS with red-dashed border, opacity/transform reveal, hover highlight. Pin-drag unit test updated with `getMap: () => null` and `trashZone: document.createElement('div')` on the mock entry.

**Pokeable for next smoke:**
- Click a `[pin]` or `[map]` icon in any element-detail top bar → map opens, middle pane KEEPS showing the element (no welcome panel jump).
- With a world active and an unrecognised URL (`#/w/<id>`), middle defaults to timeline (not welcome).
- `[+map]` button on Locations shows a small "add+map" two-glyph icon, not a pin.
- Toggle Maps Settings → "Show map names alongside…" → reload an element-detail with map icons → labels appear inline.
- View any Map element → top bar shows category icons for every pinned element; +N more chip opens picker filtered to remaining pins.
- Click any pin's `[pin]` icon → map opens, camera centers on pin at moderate zoom (zoom level 1).
- Right-click a pin pointing at a Location → ghost pins now appear (was broken before).
- Drag any pin → trash zone appears top-right → drop on it → pin deleted (verify with sync to api-linked world that the DELETE propagates via the existing tombstone flow).
- Middle-click a map tab → tab closes.

---

## Session 211 cont. — second smoke round (label split + ghost + trash polish)

Six items from Captain's smoke after session 211's first round. All shipped, typecheck/vitest/build green, 377 → 379 vitest (+2 ghost tests). Bundle 393.20 → 395.11 KB JS.

**SMK2-1: Three-way split of label toggles.** `maps_settings` now carries three boolean toggles instead of one: `show_map_names_in_header` (existing), `show_pin_map_names_in_header` (new), `show_pinned_element_names_in_header` (new). All default OFF — pre-existing toggle's behavior preserved. `getMapsSettings` returns all three with defaults applied. Settings → Maps tab shows three independent checkboxes. `wireMapsTab` factored as a per-toggle wireToggle helper. Tests updated for new shape; partial-merge across multiple toggles verified.

**SMK2-2: Labels rendered in two more contexts.**
- `[pin]` icons in element-detail header now optionally carry the pin's map name as an inline label (driven by `show_pin_map_names_in_header`).
- Map detail's pinned-element category icons strip optionally carries the element name (driven by `show_pinned_element_names_in_header`).

Both reuse the existing `.atlas-header-map-affordance-labeled` CSS pattern (auto-width override of the 22×22 fixed-square base button). `buildPinAffordance` gains `showMapName: boolean` arg; `buildPinnedElementIcon` gains `showName: boolean`; `renderMapPinnedElementStrip` plumbs through.

**SMK2-3: `[+pin]` two-glyph composition.** Matches `[+map]` shape: small `add` + `push_pin` rendered inline. Shared CSS class `.atlas-header-add-glyph` (with `.atlas-add-glyph-plus` / `.atlas-add-glyph-main` sub-classes) — `[+map]` migrated to the same shape, so the two buttons feel like a coherent pair.

**SMK2-4: Category-icon click pans+zooms.** `navigateToPinnedElement` now also finds the first pin on this map for the pinned element and calls `panMapTabTo(mapEl.id, pin.x, pin.y)`. Same zoom-and-center behavior as the element-detail top-bar `[pin]` click — fresh map opens get the moderate zoom (level 1) view centered on the pin rather than the wide default.

**SMK2-5: Ghost pin labels (when ≤6) + tighter radius.**
- `GHOST_RADIUS_PX`: 70 → 45. Ghosts cluster much closer to the source pin.
- New `GHOST_LABEL_THRESHOLD = 6`. When candidate count is at or below the threshold, each ghost gets a non-interactive Leaflet divIcon label rendered below the icon with the element name (pill chrome, 10px font, ellipsis at 110px wide). Above the threshold: no labels — the ring is the read; hover tooltips remain for individual names.
- `GhostMarkerEntry.labelMarker?: L.Marker` added; toggle-off and pruneSingleGhost remove both marker + label. New CSS for `.atlas-ghost-pin-label`. New regression test pins the radius ceiling at ≤ 50.

**SMK2-6: Trash zone polish + tooltip-stuck bug.**
- Visual: bg `rgba(239,68,68,0.15)` → `0.28`; hover `0.32` → `0.5`; icon `font-size 18 → 22 + color white + font-weight 600`. Padding `8/14 → 10/16` for a more substantial drop target. Border opacity bumped to make the dashed edge clearer against busy map backgrounds.
- Bug fix: when the user starts dragging a pin while the hover tooltip is visible, no mouseout fires for the duration of the drag → tooltip would hang after delete (the pin's gone). Now `dragstart` explicitly hides `entry.tooltip` via `style.display = 'none'`, and `dragend` keeps it hidden defensively. Resolves Captain's "text label gets stuck / shows twice / hangs after delete" report.

**Total bundle this round**: 393.20 → 395.11 KB JS, 110.51 → 110.85 KB gzipped. 377 → 379 vitest.

**Pokeable:**
- Settings → Maps → three independent toggles. Flip combinations; element-detail headers respect each independently.
- Click any pinned-element category icon on a Map detail → map opens, camera centers at zoom 1 on that pin's position (was: stayed at wide default).
- Right-click a real pin pointing at a Character with 3-4 same-location siblings → ghosts appear close in around the source AND have name labels by default. Right-click a Location pin with 20+ at-this-location candidates → ghosts still appear but without labels (above threshold).
- Drag any pin to the (now more visible) trash zone → drop → pin deletes cleanly; no hover tooltip hangs after.

---

## Session 211 cont. — map subsystem finishing push (MZ + PB + PD)

Three independent bouts to close out the map subsystem before moving on to zoner. All green at typecheck + vitest + build at each step. Tests count unchanged at 379 (no new tests this round — all UI-side changes verified via existing pure-function coverage + the upcoming next-smoke). Bundle 395 → 397 KB JS.

**Bout MZ — Maps tree expand/collapse (resolves the M4 TODO).** Map index tab nodes with children now render a chevron prefix (`expand_more` when expanded, `chevron_right` when collapsed). Click toggles, persisted per-world in `localStorage.atlas_map_tree_collapsed_v1` as `{ [worldId]: string[] }`. Leaf nodes get a same-width placeholder span so icons stay vertically aligned across mixed-arity sibling groups. Lazy-loaded module-local Map, saved on every toggle. Pure UI pref — kept out of the registry (no cross-machine sync surface). When a node is collapsed, `renderTree` skips its subtree entirely.

**Bout PB — Pin styling pass for map-having elements (DESIGN_MAPS.md §8).** Pins whose target element has at least one anchored map (i.e. `getAssociatedMaps(pin.element_id, elements).length > 0`) now render with a small cyan map-glyph badge in the bottom-right corner of the pin icon. Telegraphs "drill-in available — open this pin's element to see its maps." Implementation: `pinVisualFor(type, hasMapBadge?: boolean)` extended cache key with `|mapbadge` suffix; `renderIcon` paints the badge after the main glyph. Wired through `syncPins` which computes `hasMapBadge` per pin at sync time — badge updates live when an element gains/loses maps. SVG fallback (the brief pre-font window) is unchanged; the badge appears once the high-quality render lands via the `onPinVisualsReady` upgrade path.

**Bout PD — Right-click [pin] icon to delete pin.** Symmetric with both the drag-to-trash on the map canvas and the right-click-ghost prune behavior. `contextmenu` listener on each `[pin]` affordance in element-detail headers calls `store.deletePin(pinId)` directly, refreshes elements, triggers `requestPushIfLinked`. Toast confirms. No modal — the action is mild and reversible (re-place the pin) and a confirmation here would dilute the gesture. Title attribute updated to surface the right-click affordance ("click to open and center, right-click to delete pin").

**Pokeable for next smoke:**
- Deep map tree (Skeld's World C / multi-level parent_map nesting): chevrons appear on nodes with children; click to collapse → subtree disappears. Reload page → collapsed state persists. Switch worlds → each world has its own collapsed set.
- Open any map containing pins pointing at Locations that have their own maps anchored to them: those pins now carry a small cyan map badge in the corner.
- Open an element with existing pins → right-click any `[pin]` icon in the top bar → pin deletes, toast confirms.

---

## Session 211 cont. — map subsystem polish push (ID + MS + PF)

Three independent bouts after the three finishing ones. All green at typecheck + vitest + build at each step. 379 → 385 vitest (+6 filter-tree tests). Bundle 397 → 400 KB JS.

**Bout ID — Image dimension auto-detect on URL paste/edit.** Pure helpers extracted to new `src/ui/image-dims.ts` (`readImageDimsFromFile`, `readImageDimsFromUrl`) — previously local helpers in `map-create-modal.ts`. Element-detail's `persistFieldPatch` now hooks the `el.type === 'map' && fieldName === 'image_url'` case: after the field write lands, fires a hidden `Image()` load against the new URL, reads `naturalWidth`/`naturalHeight`, calls `store.updateMap` with the detected dims, refreshes elements, fires autosave. Info toast confirms (`"map dimensions updated to 1920×1080"`). Silent on load failure (CORS, 404) — pins keep working with stale dims; user can manually edit width/height. Resolves the friction case where editing an existing map's image_url left the canvas at old dimensions, causing pins to land off-image.

**Bout MS — Maps tree search/filter.** Search input renders above the tree when ≥3 maps exist (below that, scannability is trivial). Case-insensitive substring match on map name. A node renders if its own name matches OR any descendant matches — ancestry preserved so context for a hit is always visible. During active search, collapsed state is overridden (every match is visible and reachable); clearing the search restores collapsed state. Clear button surfaces when typed text exists. Pure `filterTreeByName(nodes, term)` helper lives in `map-tree.ts` alongside `buildMapTree`; 6 new vitest cases cover empty term, ancestry preservation, case-insensitivity, no-match, substring (not just prefix), and non-mutation of input. Input focus is preserved across re-renders via a queried-fresh-then-focus pattern.

**Bout PF — Pin filter chip strip on map canvas.** New overlay at top-left of each map tab: one chip per distinct element type present in this map's pins, in alpha order by singular label. Each chip shows the category icon + count. Click chip → toggle visibility for that type on this tab. Per-tab state lives as `Set<string>` on `MapTabCacheEntry.hiddenPinTypes`, cleared on dispose. `syncPins` filters `allMinePins` by `!hiddenPinTypes.has(pin.element_type)` so hidden-type pins are treated as removed (manager removes the markers). Chip strip refreshes on every `syncPins` call. Strip self-hides when 0 or 1 distinct types are present (nothing to filter). Defensive: pins missing `element_type` (legacy/in-flight) resolve via the referenced element's type for counting purposes.

**Pokeable for next smoke:**
- **Image-dim auto-detect**: Open an existing map element with a 2000×2000-default canvas. Edit `image_url` field → paste a real URL. Within ~1s, an info toast confirms the new dims and the canvas resizes. Map tab background re-applies. (Did NOT auto-detect before — manual width/height edit was the only path.)
- **Tree search**: Open a world with ≥3 maps. Search bar appears above the tree. Type a partial name → tree filters to matches + their ancestry. Collapsed nodes auto-expand to reveal hits. Clear (× button or empty the input) → tree returns to previous state. With <3 maps the search bar stays hidden.
- **Pin filter chips**: Open a map with pins of 2+ distinct element types. Top-left chip strip appears, one chip per type with count. Click a chip → those pins disappear from the map (strikethrough + dimmed chip). Click again → back. Per-tab; switching worlds or closing the tab resets. Other tabs unaffected.

---

## Session 211 cont. — third smoke fixes (SMK3-1 + SMK3-2)

Two quick fixes from Captain's smoke after the polish push. Both green at typecheck/vitest/build, no test count change. Bundle 400.14 → 400.21 KB JS.

**SMK3-1: Map clicks shouldn't change middle pane.** Regression from SMK-2's "default to timeline when active world has no specific route mode" — clicking a map in the map-index navigated to `/map/<mid>`, which set `route.mode = 'map'` with no `elementId`, which flipped middle to timeline. Captain's report: clicking ANY map opens timeline. Fix: `openMapTab(m, preserveElementId?)` only navigates URL when `preserveElementId` is set. Bare calls (from map-index click, from createMapDialog success, from `ensureMapTabOpen` URL→state path) only mutate `rightTabs` / `rightActiveIndex`. The URL stays whatever it was; the middle pane keeps rendering its prior route. Map tabs are ephemeral session state — not reflecting them in the URL is fine. Element-detail top-bar `[map]` / `[pin]` clicks (which DO pass `preserveElementId`) still navigate to the chained `/map/<mid>/element/<eid>` form so the route fully describes both panes.

**SMK3-2: Zoom widget moved to bottom-right.** Default Leaflet zoom control rendered at top-left, colliding with the new pin filter chip strip from bout PF. Disabled `zoomControl` in `Leaflet2DManager`'s map options; added `L.control.zoom({ position: 'bottomright' }).addTo(this.map)` post-init (gated on `!fixedZoom` so the fixed-zoom mode behaves as before — no controls at all).

---

## Current State

**Phase M (Maps subsystem rebuild) — in progress (session 208, 2026-05-15).** Design doc `DESIGN_MAPS.md` (573 lines) drafted from foundation conversation with Captain. Hierarchy reframed as sibling-order only; parent_map = "within boundaries"; pin-targets-map disallowed (zones deferred); image_url wins over image_media_id with both stored; per-world tab persistence via registry. Bout sequence M1-M8. Test world fixtures A/B/C — Skeld messaged 2026-05-15 to populate via API once Captain hands them keys.

**Bout M1 — Schema-honesty foundation (session 208).** `core/types.ts` WorldMap interface extended with `hierarchy`, `parent_map`, `depth`, `background_color` (image_url typed explicitly too, was previously only present via Element index signature). Atlas-extension `image_media_id` retained with a clarifying comment. Field-descriptions for the MAP type sharpened per the new semantics (sibling-ordering, within-boundaries, location-OF). No UI change — type coverage only. 287 vitest. 364.78 KB JS / 102.91 KB gzipped. Build clean.

**Bout M2 — Issues A + B + C + pin coord rounding (session 208).** Four-fix bug payload:
- **Issue A** (element-create map post-modal): `MapCreateModal` extended with a configure-existing mode (constructor takes `existingMapId`; submit updates instead of creates). New `configureMapDialog(toasts, mapId)` helper. `ElementCreateModal` opens it post-create when type=`map` AND no caller-provided `onCreated` (so the global element-create grid lands users into configuration). Added `excludeTypes` option to `ElementCreateModal`; the contextual right-click-on-map flow in `map-tab.ts` now passes `excludeTypes: ['map']` since pins don't target maps (DESIGN_MAPS.md §1.4).
- **Issue B** (image precedence): swapped — `image_url` now wins over `image_media_id` in both local-only and api-linked worlds. Extracted to a pure helper `pickMapImageSource` in `tabs/right/map-image-source.ts` so the rule is unit-testable. Map-index row title text reflects which source is rendering (URL, local, or URL-shown-with-local-fallback). Map-create modal hint dynamically updates: when a URL is typed, the local-image field's hint becomes a warm warning ("URL is set — local will be stored but URL will display").
- **Issue C** (per-world tab persistence): `RightTabRef` moved to `core/types.ts` (avoids cycle); new `RightTabsSnapshot`; `WorldRegistryEntry.right_tabs?` field; `getWorldRightTabs` + `setWorldRightTabs` helpers in `registry.ts` (defensive validation against corrupted localStorage). `activateWorld` in `worlds-sidebar.ts` now snapshots the outgoing world's tabs to its registry entry BEFORE state changes, and a new `hydrateRightTabsFromRegistry` restores the incoming world's tabs (filtering out stale map ids whose maps no longer exist). `right-pane.ts` resets `lastTabKey = null` on `worldId` change so the body remounts even when the active tab kind is the same.
- **Pin coord rounding**: `Math.round` on every pin x/y at create/update/drag (SDK requires integers).

New tests: +8 registry tab persistence (round-trip, isolation, malformed-payload defense, structural-invalid null) + 7 image source (precedence in all combinations + whitespace) = +15. 302 vitest (was 287). 367.86 KB JS / 103.61 KB gzipped (+3 KB from configure-existing modal branch).

**Bout M3 — Tree-builder pure function (session 208).** Per DESIGN_MAPS.md §2. New `src/tabs/right/map-tree.ts` exports `buildMapTree(maps, locations) → MapTreeNode[]`. Three phases: (1) explicit parent_map edges with cycle defense + dangling reference handling, (2) location-inferred placement walking the Location parent chain to find ancestor maps, (3) sort siblings by hierarchy ascending then alphabetically. Nodes annotated with `brokenParent` (dangling/cycle) and `inferred` (Phase 2 placement). No UI integration yet — pure function.

Fixtures: `tests/fixtures/map-worlds/{shared,world-a,world-b,world-c}.ts`. World A (pure parent_map nesting, 9 maps), World B (pure location-based, 4 maps + 7 locations with intermediate-no-map hops), World C (messy mix, 8 maps + 4 locations covering override, orphan, dangling, multi-sibling hierarchy sort).

Tests: 27 in `tests/unit/map-tree.test.ts`. Full structural snapshots for each world; sibling sort by hierarchy+alpha; cycle defense (2-node A↔B); self-referential parent_map rejection; multi-map ancestor location prefers un-parented sibling for inference target; empty inputs; determinism. 329 vitest (was 302, +27). Same bundle (367.86 KB / 103.61 KB) — tree-builder is unused so vite tree-shakes it until M4 wires it in.

Regression-verify confirmed: cycle test depends on `wouldCreateCycle` (reverting fails); World C snapshot depends on both Phase 2 inference AND hierarchy sort (reverting either breaks it).

**Bout M4 — Map index tree rendering (session 208).** Per DESIGN_MAPS.md §3.1. `map-index-tab.ts` now drives off `buildMapTree(maps, locations)` instead of the alpha-sorted flat list. Each row carries a depth-based indent spacer, optional location chip (loc-bound maps), optional broken-parent warn chip, pin count badge, image badge, hover-delete. All nodes render expanded (collapse/expand affordance deferred to a later bout, TODO in code). New CSS: `.atlas-row-chip`, `.atlas-row-chip-location`, `.atlas-row-chip-warn`, `.atlas-map-tree-indent`. Locations imported from `state.data.elements` filtered by type with `parent_location` read via the Element index signature. 329 vitest unchanged. 370.84 KB JS / 104.52 KB gzipped (+3 KB renderer + tree wiring).

**Live test worlds delivered (Skeld, 2026-05-15).** Three OW worlds populated per §6 spec: AAARGAAAA (pure parent_map), AAARGBBBB (pure location-based), AAARGCCC (messy mix). 31 elements, all image_urls set, zero retries. Structurally matches fixtures. UUIDs + API keys captured in `tests/fixtures/map-worlds/LIVE_WORLDS.md`. Skeld confirmed no schema surprises; OW API write-side uses `parent_map_id`/`location_id`, read-side returns nested `{id,name}` objects (same pattern atlas's adapter already handles).

**M4 follow-ups (session 208, captain feedback).** (1) **id-swap-during-modal-gap bug**: post-`createElement` autosave fired the debounced push while user was filling the configure modal; server reassigned the id, the closure held the stale id, `updateMap` threw `element <old-id> not found`. Fix: defer `requestPushIfLinked` until after the configure dialog closes (success OR cancel). Generalizable concern: any modal holding an element-id reference across an async gap is vulnerable to id-swap; future modals should either subscribe to engine `onIdSwap` or defer the push. (2) **Location chip clickable**: click navigates to the location's element-detail; added `location_on` material icon prefix so the chip disambiguates from other glyphs. (3) **Image badge → icon tint**: removed the explicit image badge; the map row's leading map-icon now carries a subtle cyan tint when an image source exists (URL or local), with hover-readable tooltip explaining which.

**Bout M5 — Simplified map create modal (session 208).** Per DESIGN_MAPS.md §3.2. Added collapsible "advanced" section to `map-create-modal.ts` covering parent_map override (element picker restricted to type=map, self-excluded in configure mode), hierarchy numeric field, and background_color text input. Section auto-expands in configure mode when any advanced field is already populated; collapsed by default for create. New `renderParentMapChip` method mirrors `renderLocationChip`. Submit handler patches all three advanced fields; hierarchy is validated as a finite number. New CSS for `.atlas-modal-advanced-toggle` + body. 329 vitest unchanged. 375.07 KB JS / 105.40 KB gzipped (+4 KB).

**Bout M6 — Lock toggle + unified click-through (session 208).** Per DESIGN_MAPS.md §3.4 + §3.6. (1) `RightTabRef` map tabs gain optional `locked?: boolean`. Lock icon (`lock`/`lock_open`) in the map tab header — click toggles. Locked state is cyan-tinted; unlocked is muted. Persisted via the per-world tab snapshot from M2. (2) New `tabs/right/auto-open-map.ts` with pure `getAssociatedMaps(elementId, elements, lockedActive)` — Locations resolve to `map.location === id`; other types resolve to maps with pins targeting them. Sorted hierarchy DESC, alpha-tied. Orchestrator `maybeAutoOpenMapFor(elementId)` reads live state, applies the §3.6 0/1/≥2 rule, opens single map directly or shows `MapPickerModal` for multi-map cases (with up/down arrow nav + Enter to pick). Lock-on-active-tab fully suppresses auto-open. (3) Wired into pin click in `map-tab.ts` AND element-row click in `elements-sidebar.ts` — both call sites do the same `selectElement → maybe auto-open` dance. Uses dynamic import to keep the picker out of the main bundle. (4) New `MapPickerModal` (~140 LOC, code-split into its own 2.57 KB chunk). New CSS for `.atlas-tab-lock`. New tests: 9 in `auto-open-map.test.ts` (location case, pin-targeting case, hierarchy DESC sort, alpha tie-break, defensive paths). 338 vitest (was 329). 377.19 KB JS / 106.14 KB gzipped (+2 KB main bundle + 2.57 KB picker chunk).

**Bout N1 — Safe knock-outs batch (session 209).** Per DESIGN_MAPS.md §10b. Five mechanical fixes from Captain's smoke against live worlds. (1) **Picker→sidebar mode**: `syncModeFromRoute` in `sidebar.ts` now keeps sidebar on `elements` for `map` and `timeline` routes too (was only kept for `element` and `elements`). Sidebar no longer jumps to "worlds" when picker resolves and openMapTab navigates to a map hash. (2) **Map tab id-swap**: extended `handleIdSwap` in `sync-attach.ts` to walk `ui.rightTabs` and rewrite mapIds when a map's id swaps server-side (post make-online). `locked` flag preserved across migration. 4 new vitest. (3) **Map tab refresh on image edit**: extracted `applyMapBackground` to module scope + added `sourceKey` helper; cached entries now store `lastBg` snapshot. New `refreshCachedBackgrounds` runs in the existing subscribe loop, re-applying when the source diff'd. Handles in-place edits to `image_url` / `image_media_id` from element-detail field editing. (4) **Sidebar Location auto-open removed** (§3.6 revision): dropped the `maybeAutoOpenMapFor` dynamic import in `elements-sidebar.ts`. Pin-click auto-open retained. (5) **Location sidebar map badge**: small cyan map glyph (right-anchored, before type chip) on Location rows whose `id` matches any map's `location` field. Built once per render via a `Set<string>` index. New `.atlas-elements-row-mapbadge` CSS. 348 vitest (was 344). 380.24 KB JS / 106.89 KB gzipped (+1 KB).

**Bout MR — Map tab system refresh refactor (session 209).** Per DESIGN_MAPS.md §10b. (1) **Stale-tab UX**: when a tab's mapId isn't in `data.elements` (deleted elsewhere, world switched without the per-world snapshot catching it, sync swap that missed migration), the tab gets `atlas-tab-stale` class — darkened, italic label, `cloud_off` icon, lock control hidden. Click anywhere on the stale tab closes it (vs activating into a dead-end pane). The pane itself shows a friendly "this map isn't in the current world" state with an explicit Close button. (2) **Hot-path narrowing**: `map-tab.ts` subscribe now tracks `lastElementsRef` and short-circuits when `data.elements` reference hasn't changed. Filter chip clicks, sidebar mode toggles, every keystroke in element-detail edits no longer pay the cost of pin-sync + background-diff loops. (3) New CSS: `.atlas-tab-stale`, `.atlas-map-stale-pane`. (4) Verified: tab label updates flow through right-pane's existing re-render on subscribe (no change needed). World-switch cleanup unchanged (disposeAllMapTabs runs on world change, which is enough). 348 vitest unchanged (no new tests — behaviors covered by manual smoke). 381.36 KB JS / 107.17 KB gzipped (+1 KB).

**Session 209 final pass (after multiple smoke rounds + cleanup).**
- **Pin flicker on reload fix**: `syncPins` no longer overwrites an existing marker's name/icon when the element lookup briefly misses (transient sync race window). Position is still updated; the label stays as-is until the next subscriber tick resolves. New markers fall back to `(loading…)` instead of the raw `(element)`.
- **Map create flow simplified**: type=map in the element-create grid now delegates directly to `createMapDialog({initialName})` BEFORE creating any element. Cancelling leaves no bare empty map behind. Cursor in the pre-filled name field is placed at end so the user types in continuation, not in front.
- **0 pin count badge**: map index always renders a pin badge (including zero) for label alignment across rows. Zero gets a `data-empty="true"` muted variant.
- **Per-world tab persistence reverted to global**: tabs now stay across world switches by design. Tabs from another world render via the existing MR stale-tab treatment (darkened, click-to-close). Removed the snapshot/hydrate calls from `activateWorld`; the registry helpers (`setWorldRightTabs`/`getWorldRightTabs`) are retained as dormant code in case future UX wants per-world mode again.
- **World name in stale tab pane**: `RightTabRef` for maps now carries an optional `worldId` stamped at `openMapTab` time. The stale pane resolves the owning world's name from the registry and shows "this map belongs to **<World>** (\"Map Name\") — switch to that world to view it." plus the existing Close button.
- **Staleness flip → forced body remount**: right-pane tracks `lastActiveStale` and invalidates `lastTabKey` when the active tab's staleness changes. Fixes the "switched back to a world but the map tab stays dark" bug — `data.elements` patches in after `active` patches, so the tabKey-based short-circuit was skipping the body remount.
- **Camera recenter + maxBounds reset on image apply**: `applyImage` in `applyMapBackground` now calls `lMap.setMaxBounds(bounds)` and `lMap.fitBounds(bounds, { padding, animate: false })` whenever the image is applied. Fixes the "camera too far top right after adding image URL" issue, which was the root cause of out-of-bounds pin placements (user clicking from a miscentered view produced clicks outside the new image area).
- **Leaflet maxBounds + clamp on pin write**: Leaflet2DManager now constructed with `maxBounds: [[0, 0], [width, height]]`; `applyImage` resets maxBounds to image dims when image is applied. All three pin-write paths (placement-banner click, contextual right-click create, drag end) now run coords through `clampToCanvas` defense-in-depth. 348 vitest unchanged. 380.17 KB JS / 106.83 KB gzipped.

**Session 209 follow-ups (after N1+MR+N2 smoke).**
- **World-switch tab close bug fix**: `activateWorld` was reading `state.registry` from a stale local capture when calling `setActiveWorld`, clobbering the just-saved per-world tab snapshot. Switched to `getState().registry` for the live registry. Also: replace `ui.rightTabs` with default `[{kind:'map-index'}]` synchronously at world-switch start, eliminating the brief "stale tab" flicker before hydrate restores the new world's snapshot.
- **Auto-open removed entirely**: Captain confirmed pin-click auto-open is also unwanted. `maybeAutoOpenMapFor` no longer called from any UI surface; the helper + map-picker modal stay in the codebase for a possible future opt-in setting. Pin click now just sets `selectedElementId` and navigates.
- **Lock UI hidden**: with auto-open gone, lock has no observable effect. The `RightTabRef.locked` state and the single-locked machinery remain in code; the icon and click handler are removed from the rendered tab. Re-enable by restoring both when auto-open returns.
- **Pin placement gated on image presence**: per Captain's strict rule. Both the placement-banner `map-click` handler and the right-click `contextmenu` handler now early-return with a toast ("set a map image first — pins anchor to the image") if the map has neither `image_url` nor `image_media_id`. Fixes the root cause of the "pin renders below the image" bug — pins were being placed on the 2000-default canvas before image dims were set, then canvas resized when image arrived, leaving pin coords outside the image bounds. Existing broken pins are NOT auto-migrated; user accepts "weird positions but didn't move technically" per the design rule (DESIGN_MAPS.md §4.1). 348 vitest unchanged. 380.40 KB JS / 106.78 KB gzipped.

**Bout N2 — Lock UX rework (session 209).** Per DESIGN_MAPS.md §3.4 (revised). (1) **Hidden-by-default lock icon**: `.atlas-tab-lock` ships with `opacity:0`; revealed on `.atlas-tab:hover`. Always visible when `data-locked="true"`. Layout stable across hover (no width shift). (2) **Single-locked invariant**: clicking the lock toggle now rebuilds rightTabs such that locking a new tab auto-unlocks any other map tab whose `locked` was previously true. The active tab stays whatever it was. (3) **Locked tab color**: switched from cyan to muted white (rgba 0.65) — the locked state is now signalled by the always-visible solid `lock` icon rather than by hue, matching Captain's "grey" preference. 348 vitest unchanged. 381.39 KB JS / 107.18 KB gzipped (~unchanged).

---

**Session 209 — three bouts shipped (N1 + MR + N2).** Captain's smoke pile of ~12 issues collapsed into the three bouts above. Map foundation now more resilient: stale tab handling, id-swap propagation, image-edit refresh, simpler lock model, sidebar location map badge, no surprise auto-open from sidebar.

**Pokeable surfaces:**
- Make-online a local world with an open map tab → tab id-migrates seamlessly (no "map not found" panel)
- Switch worlds while a map tab is open → the stale tab darkens with italic label; click anywhere on it to close
- Edit a map's image_url via element-detail → the open map tab re-applies the background without close-and-reopen
- Hover any map tab → lock icon reveals; click to lock; lock a different tab → first one auto-unlocks
- Locations in elements sidebar with at least one map → small cyan map glyph appears

**Next session pile (preserved in DESIGN_MAPS.md §10c):**
- **MW** — top-bar map+pin affordances widget (replaces M7 inline body widget)
- **NPM** — new-pin modal with TAB-autocomplete for placing existing elements
- **Maps Settings** — first toggle for map-name labels alongside icons
- **Pin coord investigation** — Leaflet2DManager coord/canvas-resize behavior
- **Cross-element rendering** — design conversation
- **M8** — schema description council motion (after all above stable)

**Bout M7 — Inline element-detail map presence widget (session 208).** Per DESIGN_MAPS.md §3.5. (1) New pure helper `getLocationMapPresence(locationId, elements)` in `auto-open-map.ts` walks the location subtree via `parent_location` (BFS with visited-set defense against pathological cycles), returns `{direct, descendants}` lists each sorted hierarchy DESC + alpha. (2) New `renderMapPresence` in `element-detail.ts` adds a "Maps" section before "Referenced By". For Locations: "Maps of this place" + "Maps within this place". For other content elements: "Appears on maps" (resolved via pins through `getAssociatedMaps`). Map elements themselves skip the widget (their canvas is the right pane). Chips reuse the `atlas-link-chip` style + the cyan-tinted map-icon-with-image affordance. Click chip → opens the map tab. (3) Section renders nothing when empty — no empty-state noise. (4) Tests: 6 new in `auto-open-map.test.ts` covering direct, descendants via parent chain, intermediate-no-map hopping, hierarchy DESC sort with alpha tie-break, lonely-subtree empty case, pathological cycle defense. 344 vitest (was 338). 379.60 KB JS / 106.67 KB gzipped (+2 KB widget + helper).

---

**Map foundation bouts M1-M7 complete (session 208).** What remains in the bout sequence:

- **M8 — Schema description council motion**: paperwork-only. Updates to OW field descriptions for `Map.hierarchy`, `Map.parent_map`, `Map.location` per DESIGN_MAPS.md §7. Defer until M1-M7 have stabilized in real use — live testing may surface additional prose tweaks worth bundling into the same motion.

Captain's pokeable seams for visual smoke right now:
- Tree-organized maps tab (M4) with click-through location chips and image-aware icon tint.
- Create modal: name + location + image fields by default; "advanced" reveals parent_map override / hierarchy / background_color (M5).
- Map tab lock toggle in header (M6). Click element in sidebar → auto-open associated map per §3.6 rules (skipped when active tab is locked). Multi-map elements show a picker.
- Element detail middle pane (M7): on a Location, see "Maps of this place" + "Maps within this place." On a Character (or any other type), see "Appears on maps" via its pins. Section hidden when empty.

Three live test worlds (Skeld's `AAARGAAAA` / `AAARGBBBB` / `AAARGCCC`) ready for end-to-end smoke against real API data — see `tests/fixtures/map-worlds/LIVE_WORLDS.md` for keys and UUIDs.

---

**Phase 0 — Foundation: complete (session 197).**
**Phase 1 — Sync foundation + real FolderStore: ~95% complete (sessions 197-198).**
**Phase 1.5 — Architecture-agnostic UI primitive ports: complete (session 197).**
**Phase 2 — Minimal UI bootstrap: complete (session 198, Bout 3).** First hands-on testable build.
**Phase 3 — API flows: complete (session 200, Bouts E-H).** Link-existing-API + Make-Online (both routes) + autosave debounce + sync pill state mapping.
**Phase 4 — Content UI: Bouts A+B complete (session 199, 2026-05-12).** Elements sidebar mode, create modal, schema-driven element detail (FIELD_SCHEMA + ELEMENT_SECTIONS), element-picker modal, single/multi-link fields with picker, collapsible sections, Referenced-By reverse-link section.
**Phase 5 — Spatial UI: Bout C complete (session 199, 2026-05-12).** Right-pane tab bar, map-index tab pinned, per-map Leaflet tabs with cache lifecycle, map-create modal with image upload via FolderStore.addMedia, pin placement flow (element-detail pin button → map click → createPin), pin tooltip on hover, contextual right-click element-create + pin drop, map cascade-delete closes open tabs.
**Phase 6 — Polish: Bout C.5 + Bout D complete (session 199, 2026-05-12).** Visual alignment to legacy aesthetic (worlds/elements/maps now use `.atlas-list`/`.atlas-row`; sidebar mode toggle uses `.atlas-mode-btn` with cyan underline; element-detail uses `.atlas-middle-header` + delete/pin via `.atlas-icon-btn-sm`). Timeline view (`#/w/<id>/timeline`) + `+ event` button. Sync indicator pill (fixed bottom-right, legacy `.atlas-sync-pill` reused). Worlds favorites star toggle with favorites-first sort.

**Phase 3.5 — Local-first polish + sync controls: feature-complete pending Captain's final smoke run (session 201, 2026-05-13).** Bouts J–U shipped — see `Session Log` below for granular detail. Live testing against real OW `5474990854` drove 19 interlocking bug fixes (Bout T) and two final features (Bout U — double-link block + match-by-name). Captain's smoke confirmed: link-existing works, edits push, link-creation chains succeed, conflict review under both policies works, pull-conflict under local-wins immediately converges via auto-push, merge with bidirectional FK refs lands correctly server-side.

**Bout V — pre-smoke hardening (session 202, 2026-05-13).** Agent-verified fix pass closing 4 issues across the data-protection surface: applyServerRecord now preserves atlas-extension fields (image_media_id); server-delete detection skips paginated types; merge's chain-CREATE FK is corrected via in-body id-swap; conflict-toast defer captures worldId.

**Bout V.5 — pin element_type wire fix (session 202, smoke-driven).** Captain's cascade-delete smoke surfaced 400 from real OW on every pin push (server requires `element_type` when `element_id` is set). Five-part fix: map-tab placement + contextual create now populate element_type; ElementCreateModal.onCreated extended to provide type; engine pushPhase self-heals legacy pins (looks up referenced element's type, writes back, pushes); MSW + FakeOwApiClient enforce the rule so future regressions fail tests. 194 vitest. 340KB JS / 94KB gzipped. Pickup for next chat: resume Tier B2 cascade-delete smoke against hardened code.

**Bout W — pre-smoke hardening round 2 (session 203, 2026-05-14).** Four parallel fixes: H1 pin-drag autosave missing → dragend now calls `requestPushIfLinked()`; H2 orphan tombstones for never-synced deletes → engine clears tombstone on DELETE 404, fakes mirror real-OW 404-on-unknown; M1 worldId-capture race regression-tested via `__test_emitConflictToasts` seam; M2 stale `engine.resume()` comment corrected. 204 vitest (was 194). Same session also bouts W5 + W6: flush-on-attach (pending writes lost on reload now recover via `pushOnce` at engine attach) + cadence visibility fix (interval keeps running while hidden, ticks skip; catch-up pull on becoming visible). 212 vitest.

**Bouts 7-9b — UX polish + UPDATE-404 routing + id-swap UI propagation (session 204, 2026-05-14).** Bout 7: `pullNowAndRefresh` now toasts pulled counts (cadence/pull-on-activate land visibly); spammy reconcile log removed; cloud icon swaps to `cloud_off` when world or global paused. Bout 8: server-delete modal `keep + re-push` triggers `pushOnce` immediately; engine `pushPhase` routes UPDATE 404 (pre-GET null OR PATCH throws) to `sync_state.server_deletes` — same review modal as pull-time detection; `resolveConflict('overwrite-mine')` 404 also routed silently. Bout 9: engine emits `onIdSwap` callback on push CREATE id-swap; sync-attach migrates `selectedElementId` + URL hash. Bout 9b: atomic `setState` transition prevents the "element not found in this world" flash that two separate `patchSlice` calls would produce. 234 vitest (was 212). 343 KB JS / 95.6 KB gzipped. Smoke doc rewritten as `BOUT_R_SMOKE.md` with Tier 1-4 structure.

**Bouts FF + GG + HH + II — UI/UX polish pass (session 207, 2026-05-14).**

- **FF (capitalization)**: Removed 9 `text-transform: lowercase` rules in `atlas.css` (settings sections/fields/tabs, modal fields, modal titles, ow-btn). Updated source content to Sentence case throughout modals, settings, sidebar buttons, welcome panel, right-pane labels. Tests updated for capitalized strings in `phase2-ui`, `phase4-elements`, `phase5-maps`, `phase-bout-cc`.
- **GG (field row UX)**: Tightened `.atlas-field` padding 7px → 4px, gap 12px → 18px (more space label↔value). Widget-aware empty placeholders via `data-widget` attr: number → `#`, text-long → `——`, default → `—`. Link fields use a soft-grey `+` icon as the empty placeholder/affordance (replaces the bare em-dash); the icon `margin-left: auto` slides it past chips for multi-link. Map pin-count badge replaced `.atlas-row-meta` with a properly-styled `.atlas-pin-count-badge` chip (cyan-tinted, readable).
- **HH (field tooltips + clickable labels)**: New `src/editor/field-descriptions.ts` — comprehensive dictionary sourced from `OnlyWorlds/toolkit/knowledge/schema-reference.md`, covering all 22 element types + base fields. `getFieldDescription(type, field)` falls back from per-type → base → undefined. Wired into `element-detail.ts:renderField`: hover the field label for a description tooltip; click the label to trigger the same edit affordance as clicking the value (popover for text/number, picker for links). Clickable-label styling via new `.atlas-field-label-clickable` class.
- **II (per-element sync indicator)**: New `.atlas-element-sync-dot` in the element-detail header. Reads world.state + element's `local_updated_at` vs `server_updated_at`. States: `local` (save icon, muted — local-only worlds are always saved synchronously to disk), `synced` (`cloud_done` muted — api-linked and in sync), `dirty` (`cloud_upload` cyan with subtle pulse — pending push from autosave debounce). Hover shows a state-specific tooltip.

287 vitest unchanged. 86 e2e passing (was 86 after EE; same after fixes to two assertions invalidated by GG's badge selector rename + multiple atlas-pane-empty surfaces). Bundle: 364.42 KB JS / 102.75 KB gzipped (was 350.79 / 97.65 — +13.6 KB JS dominated by the field-descriptions dictionary).

**Bout CC — Sidebar tabs + selection UX + instant-feel switch (session 207, 2026-05-14).** Three intertwined UX changes Captain flagged during smoke. (1) Sidebar mode toggle renamed `[OW · <world>] / [elements]` → `[worlds] / [<world-name>]`. Right tab is hidden entirely when no world is active. OW icon removed. Toggle reads world name from registry+URL (not state.active) so the right-tab label flips synchronously when a world is activated. (2) Gear becomes a toggle: clicking from any non-settings route opens Settings; clicking from Settings closes Settings and restores the right-tab context (selected element if any, else elements list). Same logic powers clicking the right tab while on Settings. (3) Instant-feel world switch: `activateWorld` now clears `data.elements` + `ui.selectedElementId` synchronously and navigates the URL BEFORE the slow FS work (handle resolve, permission re-grant, listElements). The sidebar toggle, body, and middle pane re-render against the new URL in the same frame as the click; FS work bleeds into a brief empty state instead of a frozen UI. Failure paths revert URL to priorHash. 5 new e2e tests in `tests/e2e/phase-bout-cc.spec.ts` cover the new toggle behaviors. Also fixed a pre-existing race in `phase35-settings.spec.ts:153` (unlink test was reading registry before async handler completed). 86 e2e total (was 81). 287 vitest unchanged.

**Bout DD — Three small fixes (session 207).** (1) Self-link disallow: element-detail single-link + multi-link pickers now include `el.id` in `excludeIds` so a Character can't pick itself as a friend, a Location can't be its own parent, etc. (2) Cancel hidden during modal load: 5 modals (create-world, link-world, map-create, element-create, new-api-world) + both make-online routes hide their Cancel button during in-flight submission. Hidden > disabled — user doesn't see an affordance for an action that would leave the system mid-state. Restored on failure. (3) Reset-layout icon next to gear in sidebar footer: new `view_column_2` button calls `shell.resetRatios()` which restores `DEFAULT_RATIOS` and removes the persisted value from localStorage. Wired via new `AppShell.resetRatios` + `SidebarMount.onResetLayout`.

**Bout EE — Sync pill + toast repositioning (session 207).** Sync pill relocated from fixed bottom-right to inside the sidebar footer as a flex sibling of the gear and reset buttons. `margin-left: auto` anchors it right within the footer. CSS swapped fixed-positioning + opacity-hide for in-flow + `display: none` when `data-state="none"`. Toast container relocated top-right → bottom-right via `index.html` inline style + `atlas.css` override. Flex direction reversed (`column-reverse`) so newest toasts appear at the bottom and stack upward. Existing e2e visibility check (`phase6-polish.spec.ts:74`) still passes.

**Bout BB — Pre-T2-smoke foundation fixes (session 207, 2026-05-14).** Critical pre-smoke review surfaced two latent foundation issues; shipped both as a single bout before resuming smoke. **F1 (HIGH)**: `attachSyncEngine` fired pull-on-activate and flush-on-attach as two separate fire-and-forget paths that raced for the engine's shared `inFlight` lock. The pull always won (its `pullNow()` is synchronous through inFlight assignment, while flush awaits two folder reads first), so flush's `pushOnce()` returned the pull's promise — `pushed.* === 0`, no "synced N pending change(s)" toast, stranded edits never reached the server until the next user-driven write re-armed the autosave debounce. T2.3 smoke would have silently failed if Captain had pull-on-activate enabled. **Fix**: single async IIFE in `attachSyncEngine` awaits flush first, then pull-on-activate. Pending writes encode older user intent and should land server-side before pull looks for newer remote changes. **F2 (M7 cosmetic)**: `engine.resume()` synchronously emitted `{kind:'idle', last_sync_at: null}` even after a successful prior sync. The pill's "synced X min ago" tooltip briefly read "never synced" between resume and the post-resume push completing. **Fix**: engine tracks the most recent successful `last_sync_at` in a private field updated by `setState`; `resume()` restores it. Convention #25 + #26 added to DESIGN.md. 5 new vitest in `tests/integration/sync-attach.flushBeforePull.test.ts` (3) + `tests/integration/sync-engine.resumePreservesLastSyncAt.test.ts` (2). Per-bout regression-verified: reverting F1's sequencing fails 2 flushBeforePull tests; reverting F2's preservation fails the "resuming after successful sync" test. 287 vitest (was 282). 349.26 KB JS / 97.25 KB gzipped.

**Bout S — Pressure-test fixes round 1: field-clear propagation (session 205, 2026-05-14).** Five-agent pressure-test (3 thematic + skeptic + invariant) verified pre-cutover concerns; cross-check refuted 2 false positives (skeptic was wrong on H1/H3, right on M6). First fix round closes the highest-confidence finding: clearing a field through the UI (× chip / blank popover) now actually propagates to the server. Root cause: `undefined` gets dropped by `JSON.stringify` at every layer (disk + wire), and real PATCH treats a missing key as "no change" — the server kept the old value. Fix: UI sends `null` for relations/numbers, `''` for text; `FakeOwApiClient` now strips undefined to mirror JSON-wire semantics (fakes-mirror-real discipline #20). Touches: `element-detail.ts:289` (single-link `×`), `field-edit-popover.ts:108` (number empty), `:115` (text empty), `tests/fixtures/fake-ow-client.ts` (rule encoding), `tests/integration/sync-engine.fieldClear.test.ts` (7 new tests — trap + contract). Convention #21 added to DESIGN.md. Per-bout regression-verified: reverting the fake's undefined-strip fails the 2 trap tests, restore returns 241 green. 241 vitest (was 234). 343.59 KB JS / 95.60 KB gzipped (unchanged).

**Bout U — Topo-sort CREATEs by FK dependency (session 205, smoke-driven, 2026-05-14).** Captain made a world online via Make-Online Route 1 with a Character whose `birthplace` referenced a local Location. Character pushed first → real-OW `400 Invalid FK: birthplace_id — referenced Location with id 'xxx' does not exist`. The chain self-healed on the next round via `rewriteIdReferences`, but console showed the 400 prominently for ~5s. Fix: pushPhase now topologically sorts the CREATE batch before iterating. Scan every string + string-array field; any value matching another candidate's id is a dep edge. Kahn's algorithm orders dependencies first, references second. Cycles fall back to input order (rare; safety preserved — same as old behavior). Schema-agnostic (mirrors `rewriteIdReferences`'s approach, no FIELD_SCHEMA dependency). New `sortCreatesByDependencies` private method (~50 LOC). 5 new tests in `tests/integration/sync-engine.createOrder.test.ts` cover: 2-element chain, longer chain (Pin→Map→Location + Character→Pin), id-swap interaction with sort, cycle fallback safety, no-deps no-op. Per-bout regression-verified: disabling the sort fails 3 of 5 (the dependency-required cases); 2 still pass (cycle + no-deps, expected to not depend on sort). Convention #23 added to DESIGN.md. 258 vitest (was 253). 346.96 KB JS / 96.46 KB gzipped (+1KB).

**Bout T — Auth-failed rounds bail + surface (session 205, smoke-driven, 2026-05-14).** Captain hit the "lying pill" case during Bout-S smoke: made a world online via Make-Online, deleted it server-side on onlyworlds.com web. Atlas's api_key became dead, subsequent edits returned 401, pill went `saving → synced` because `pushPhase` collected per-element failures but the engine still transitioned to idle. User thought work saved; it hadn't. Three-layer fix: (1) `isAuthError(err)` helper added (401/403 detector, exported); (2) `pushPhase` / `pullPhase` track `authBlocked` and bail-on-first to avoid retry storm; partial sync-state writes are skipped on bailed rounds. (3) New private `setAuthError()` transitions engine to `{kind: 'error', message: 'auth failed...', recoverable: true}` AND sets `paused=true` so debounce no-ops. `runSync` skips pull-phase when push auth-blocks. `SyncResult.auth_blocked` flag surfaces to `sync-attach.emitConflictToasts` which now fires a dedicated "sync paused: authentication failed..." toast and routes around the conflict-handling path. `flushPendingOnAttach` also surfaces failures via toast (was console-only). Fakes-mirror-real: `FakeOwApiClient.__inject_auth_failure()` + `statefulOwHandlers` `authState.blocked` option simulate dead-creds end-to-end. Recovery is a fresh engine — settings PIN change already calls `attachSyncEngine` which constructs a new instance, error state doesn't bleed. 12 new tests in `tests/integration/sync-engine.authBlocked.test.ts` cover: isAuthError detector, push/pull/sync transitions, no-retry-storm, no-state-bleed-after-recovery, non-auth pull throws still propagate, no stuck "fetching..." state. Convention #22 added to DESIGN.md. Per-bout regression-verified: disabling `setAuthError` call in `runPushOnly` fails 3 tests; restore returns 253 green. 253 vitest (was 241). 345.89 KB JS / 96.06 KB gzipped (+2KB for auth detection).

Skeleton package green across the board. Architecture locked. Full sync contract (push + pull + conflict detection on UPDATE) proven against MockFolderStore + FakeOwApiClient. Real OwApiClient adapter wraps the SDK; tested end-to-end via MSW with real `@onlyworlds/sdk`.

Session 198 (Bout 1) added: cascade-delete in FolderStore contract + `findDependents` preview helper, `syncNow` concurrency mutex, order-independent `deepEqual` in conflict diff (no more spurious field-list churn from key-order differences), policy rename `server-wins` → `pause-on-conflict` (matches the actual code behavior; old name lied), Route 2 policy (a) dropped (full-overwrite footgun), lock-file format specced in conventions.

Session 198 (Bout 2) added: real FolderStore backed by File System Access API. `fs-utils.ts` (atomic write via tmp+verify+promote, corruption-tolerant readJson, dir helpers), `idb.ts` (minimal promise IDB), `handle-vault.ts` (FileSystemDirectoryHandle persistence + permission re-grant helper), `folder-store-fs.ts` (full FsFolderStore impl with layout setup, heartbeat lock, all CRUD, media sidecar, sync-state file). One-file-per-element on disk for everything (content + spatial), no bundle-per-map. Playwright drives it via OPFS — same FS Access API interface as a user-chosen folder, so the real impl is exercised end-to-end.

Session 198 (Bout 3) added: Phase 2 minimal UI. App shell (3-pane, draggable dividers, ratios persisted), observable state store, hash router, worlds sidebar with create-local + per-world activate, create-world modal (name + folder picker, test-injectable directory source), welcome panel (active world stats), settings panel (PIN + email + forget-world). Real `FsFolderStore` wired throughout — clicking create opens a real folder via FS Access API and writes a real `world.json`. Two lock-correctness fixes also landed: per-tab stable id via `sessionStorage` (reload reclaims own lock) + prior-store close in `createLocalWorldFlow` (defensive). 7 new Playwright specs cover the full flows (shell mount, create, settings, reload, forget, cancel, multi-world switching).

Session 198 (Bout 4) added: atlas-root concept. Single user-chosen folder that holds all atlas-managed worlds; one-time setup. New worlds become subfolders (`<slug>-<uuid-prefix>`). Sidebar swaps `[ + create local ]` for `[ set up atlas ]` until root is configured. Welcome panel mirrors the same first-launch CTA. Settings shows + lets you change the atlas folder. Each world still has its OWN handle in the vault — atlas root is a creation convenience, not a storage layer. Existing test worlds keep working as "external" worlds. Three small fixes also landed: `loadRegistry` was hand-picking fields and silently dropping new ones (including `atlas_root` on reload) — now spreads; `slugify()` for filesystem-safe folder names; `.atlas-root` marker file dropped in each root for future "import existing atlas folder" detection.

Session 198 (Bout 5) refined Bout 4: atlas root now uses the "library wrapper" convention. When user picks a folder, atlas creates `atlas-worlds/` inside it (matching legacy) UNLESS the picked folder is already an atlas root (`.atlas-root` marker present) or already contains one. Three cases handled by `resolveOrCreateRoot()`: (1) pick a folder with marker → use directly; (2) pick a folder containing `atlas-worlds/` with marker → use that subfolder; (3) pick a generic folder → create `atlas-worlds/` inside. Picking the user's Documents folder no longer pollutes it with world subfolders. State + UI show `pathHint` (parent/atlas-worlds when wrapped, picked-folder-name when re-used).

UI primitives ported verbatim (modal-base, toast-manager, field-edit-popover, field-schema, Leaflet2DManager + spatial siblings, pin-visuals, edge-color). Full atlas.css styling in place (1491 lines). These ports are sitting unreferenced until Phase 2 wires them into the shell.

Local git: 8 commits on master (origin pushed via force to GitHub main by Captain in session 197). Session 198 work uncommitted.

Session 199 (Bout A — Phase 4 minimum) added: sidebar mode toggle (worlds ↔ elements, lives in `shell.sidebarToggle`), `state.data.elements` cache (array, force-rerender via new ref on mutation), `state.ui.{sidebarMode, selectedElementId, elementFilters, search}`, `parseHash` extended for `#/w/<id>/elements` + `#/w/<id>/element/<eid>`. New `sidebar/sidebar.ts` driver dispatches body and owns the footer gear; `worlds-sidebar.ts` refactored to body-only (`mountWorldsBody`). New `sidebar/elements-sidebar.ts` (filter strip + search + create + list). New `middle/element-detail.ts` (header + name/description fields with popover edit + delete button with dependent-count confirm). New `ui/element-create-modal.ts` (BaseModal subclass, name + 18-type grid, FolderStore-backed). `activateWorld` and `createWorldInRoot` both prime `data.elements` and reset `selectedElementId` so the new world's view is clean. Delete-world also clears the elements cache.

Session 199 (Bout B — Phase 4 schema editor) added: full schema-driven detail rendering via `sectionsFor(type)` (Base + ELEMENT_SECTIONS), collapsible sections persisted in module-level `collapsedSections` Set, three widget renderers (text-short/text-long/number → popover edit; single-link → chip + pick; multi-link → multi chips + add). New `ui/element-picker-modal.ts` (BaseModal subclass, `pickElement({restrictToType, excludeIds, title})` Promise API, FolderStore-backed, search + type strip + 200-row cap). Referenced-By section uses SDK-shape-agnostic reverse scan (convention #5) — iterates all field values for string/array/object id matches. Chip click navigates; chip × removes via patchField. `humanizeFieldName` + ACRONYMS uppercase preserved from legacy.

Session 199 (Bout C — Phase 5 spatial UI) added: state extensions (`ui.rightTabs: RightTabRef[]`, `ui.rightActiveIndex`, `ui.pinPlacement`), router `#/w/<id>/map/<mid>` route (+ optional `/element/<eid>` chained), right-pane driver with tab bar (map-index pinned, per-map tabs as close-able groups). Map-index reads from `data.elements` (no separate `data.maps`), shows pin counts and image badges. Map tab: full Leaflet2DManager wiring with module-level cache, image preference (local media → image_url → grid), pin sync from `data.elements` (filter type === 'pin' && map_id), pin click → element detail nav, pin hover → tooltip, right-click → contextual element-create + pin drop, drag-from-list deferred. Pin placement flow: element-detail header gets a push_pin button when a map tab is active; click toggles `ui.pinPlacement`; map click while placement is active creates pin via FolderStore. Map cascade-delete also closes the open tab. `closeMapTab` navigates away from /map/<mid> route before splicing the tab so ensureMapTabOpen doesn't immediately re-add it.

Session 199 (Bout C.5 — Visual polish) replaced bespoke component classes (atlas-world-row, atlas-element-row, atlas-map-row, atlas-detail-header/body/field) with legacy `.atlas-row`/`.atlas-list`/`.atlas-middle-header` and dropped ~270 lines of duplicate CSS. The sidebar mode toggle, worlds list, elements list, map index, element-detail header, and element-detail field rows all now render with the legacy markup. Updated e2e selectors across all spec files to match.

Session 199 (Bout D — Polish features) added: `middle/timeline.ts` ported from legacy, route `#/w/<id>/timeline`, "view timeline →" CTA in welcome panel. Sync indicator pill — reuses legacy `.atlas-sync-pill` (fixed bottom-right) with `data-state` modifier (local/api/none) and `.atlas-sync-pill-dot` child. Worlds sidebar: favorite-star toggle in `.atlas-inline-actions` with favorites-first sort; star is yellow when active. App-shell tab bar got an `.atlas-right-tab-bar` class for proper flex display.

**Bundle**: 271.68 KB JS / 75.20 KB gzipped. CSS 46.78 KB / 12.16 KB gzipped.
**Tests**: 96 vitest + 61 Playwright = 157 total.
**Type-check**: clean. **Build**: clean. **E2E**: 61 Playwright specs (12 FsFolderStore + 14 Phase 2 UI + 10 Phase 4 elements + 9 Phase 4 schema + 9 Phase 5 maps + 6 Phase 6 polish + 1 shell smoke), all chromium.

### What's live

**Phase 0 — Foundation**
- `tools/atlas/` package skeleton: package.json, vite.config, tsconfig, vitest.config, playwright.config
- Test infrastructure: Vitest + jsdom + MSW + fake-indexeddb + Playwright Chromium
- DESIGN.md (~600 lines): folder-first architecture, all workflows, conventions, file layout, phased plan
- Core types: `src/core/types.ts` — Element, WorldMap, Pin, Zone, Marker, Conflict, SyncEngineState, SyncResult, Tombstone, SyncState, WorldRegistryEntry, WorldsRegistry
- Core constants: `src/core/constants.ts` — storage keys, folder layout, IDB names
- `src/store/folder-store.ts` — FolderStore interface (contract, no impl yet)
- `tests/fixtures/mock-folder-store.ts` — in-memory FolderStore for tests
- `tests/fixtures/fake-ow-client.ts` — in-memory OwApiClient with call capture + `__server_mutate` test helper
- `tests/fixtures/monotonic-clock.ts` — strictly-increasing ISO timestamps for tests
- Placeholder `src/main.ts` + base atlas.css

**Phase 1 — Sync foundation (in progress)**
- `src/registry/registry.ts` — full registry helpers (loadRegistry, save, create local/api-linked, attachApi/detachApi for Make-Online transitions, rename/delete with re-parenting, setActive/setFavorite/setParent cycle-safe, setPin/setEmail)
- `src/sync/sync-engine.ts` — push + pull + conflict detection complete:
  - Push: CREATE / UPDATE (with pre-update GET conflict check) / DELETE-via-tombstone
  - Pull: list per type, applyServerRecord for new+server-newer, conflict on dual-change
  - syncNow dedups push+pull conflicts by element_id
  - Policies: drain-blind (default) / server-wins / ask (Phase 3.5 placeholder)
- `src/sync/ow-client-adapter.ts` — OwClientAdapter wraps OnlyWorldsClient via raw `client.request` (no prepareRelations mangling). `adaptRecord` stamps type field, unwraps nested relation objects/arrays.
- `tests/msw-handlers.ts` — reusable statefulOwHandlers (CRUD against in-memory state, optional nested-relation response mode)

### Test layers (89 tests)

| File | Count | Focus |
|---|---|---|
| `tests/smoke.test.ts` | 3 | Foundation: jsdom + fake-idb + onLine pin |
| `tests/unit/registry.test.ts` | 25 | All registry helpers, persistence, nesting, Make-Online transitions |
| `tests/unit/deep-equal.test.ts` | 9 | Order-independent value equality for conflict diff |
| `tests/integration/sync-engine.push.test.ts` | 9 | CREATE / UPDATE / DELETE / paused / no-op / preserve-uuid |
| `tests/integration/sync-engine.pull.test.ts` | 9 | Empty-pull / no false re-push / server-newer / tombstone-skip / multi-type / last_pull_at |
| `tests/integration/sync-engine.conflict.test.ts` | 7 | All three policies / pre-update GET / mixed / fields list |
| `tests/integration/sync-engine.mutex.test.ts` | 3 | Concurrent syncNow returns shared in-flight result |
| `tests/integration/folder-store.cascade.test.ts` | 10 | findDependents + cascade-delete contract |
| `tests/integration/ow-client-adapter.test.ts` | 14 | adaptRecord unit + MSW + real SDK roundtrip / pin no-mangle / 404→null |

### Verified

- `crypto.randomUUID()` available in jsdom + browser (no shim needed)
- OW API accepts client-provided UUIDs (verified earlier via obsidian-plugin reference)
- SyncEngine push correctly distinguishes CREATE vs UPDATE based on presence of `server_updated_at`
- Tombstone flow: delete → tombstone → server DELETE → tombstone cleared
- Paused state blocks pushes; resume re-enables

---

## Next Up

### Next session: UI port

**Read `UI_PORT_BRIEF.md`** at session start. Dedicated session to bring atlas to visual + functional parity with `tools/atlas-deprecated/`. Covers Phase 4 (content UI: elements sidebar, schema-driven editor, picker) and Phase 5 (spatial UI: map tabs, pin placement, Leaflet wiring). Brief includes per-bout file lists, key constraints, risk areas, done criteria.

After that session: Phase 3 (api flows — Make-Online, Link existing, sync indicator wired) is next.

### Lower-priority bouts (deferred)

**Sync polish** (~45min, defer until api flows land)
- Per-type download cursor in `sync-state.json` (resumable link-existing)
- Replace per-element pre-update GET with batched listElements baseline check
- Network error handling (pause vs retry vs throw — clarify and test)
- `syncNow` lock semantics test against real FS (port the OPFS-backed test from Bout 2 spec)

**Bout 5 — Phase 3: API flows** (~90min)
- Link existing API world modal (initial download with progress)
- Make-Online Route 1 (create new api world via `POST /api/worldsync/create-world-external/`)
- Make-Online Route 2 (link existing with merge policy b or c — full overwrite (a) was dropped)
- Sync indicator wired to real SyncEngine state events
- E2E: end-to-end smoke against MSW-mocked OW API

**Deferred — Shared contract test suite**
The parameterized "runs against mock + fs" suite is nice but lower ROI right now: the same scenarios already exist on both sides written by the same author. Re-evaluate when Phase 3 brings divergence pressure.

**Phase 4 — Content UI (later)**
- Elements sidebar (mode toggle, filter chips, search, list)
- Element detail (schema-driven editor, popover field edit)
- Create modal, picker modal

**Phase 5 — Spatial UI (later)**
- Map tabs (Leaflet), pin placement, zone editor

**Phase 7 — Smoke against real OW + cutover**

---

## Done

### 2026-05-12 — Session 197: foundation + Phase 1 sync + UI primitive ports

Ten bouts, 67 tests, 8 commits on local master (pushed to GitHub main).

- **Bout 1**: deprecation. `tools/atlas/` → `tools/atlas-deprecated/`. tools.json, README, CLAUDE.md, .gitignore, memory MEMORY.md + project_atlas.md → project_atlas_deprecated.md updated. Skill renamed `atlas-tool` → `atlas-deprecated-tool` with deprecation framing. DEPRECATED.md written with port list + drop list.
- **Bout 2**: package skeleton. Fresh `tools/atlas/`, vite/tsc/vitest/playwright all green on empty.
- **Bout 3**: DESIGN.md written. Architecture, all workflows, conventions, file layout, phased plan, tradeoffs, open questions.
- **Bout 4**: SyncEngine push contract. Types, FolderStore interface, SyncEngine class, MockFolderStore, FakeOwApiClient, MonotonicClock. 9 integration tests.
- **Bout 5**: Registry helpers + 25 unit tests. Persistence, create, attach/detach, rename/delete with re-parenting, active/favorite/parent (cycle-safe), setPin/setEmail.
- **Bout 6**: SyncEngine pull phase + 9 integration tests. applyServerRecord prevents false re-push. Conflict on dual-change. Tombstone skip.
- **Bout 7**: Push-phase conflict detection + 7 tests. Pre-update GET. Three policies (drain-blind / server-wins / ask). syncNow dedups push+pull conflicts.
- **Bout 8**: OwApiClient adapter wrapping real SDK + 14 tests. Raw `client.request` sidesteps prepareRelations pin quirk. adaptRecord stamps type + unwraps nested relations. MSW handlers exercise round-trip.
- **Bout 9**: Port 5 UI primitives verbatim. modal-base, toast-manager, field-edit-popover, field-schema, atlas.css (full 1491 lines).
- **Bout 10**: Port spatial primitives. Leaflet2DManager + siblings, pin-visuals, edge-color. ELEMENT_ICONS added to constants.

Also: new `atlas-tool` skill (replaces deprecated reference). Fresh `project_atlas.md` memory file. Local git initialized. Captain force-pushed to GitHub `main` overwriting legacy.

---

## Known Issues / Rough Edges

- **No initial-download cursor** — link-existing-API partial failures aren't resumable. Bout 4 adds per-type cursor in `sync-state.json`.
- **Pre-update GET is N+1** — every UPDATE does an extra GET. Acceptable at debounce rates; brutal on "resume after long offline." Bout 4 replaces with a single batched listElements baseline before push.
- **Pull-only conflict tests are weak** — for drain-blind policy, push runs first and overwrites, so a "pure pull-time conflict" requires server-side race hard to simulate. The conflict detection is verified via push-phase pre-update GET tests instead, which is the more important path.
- **OPFS != disk for some edge cases** — concurrent multi-tab race semantics differ slightly (OPFS is isolated per origin so the heartbeat tests use forged stale locks, not real cross-tab contention). Smoke against real disk-backed FS Access in Bout 5 will confirm.
- **Permission re-prompt every session** — FS Access API requires user gesture per session. `handle-vault.ensureWritable()` does the re-grant; UX needs an "Open all" or per-card grant button in Phase 2.

---

## Deferred Decisions

- **Conflict UI** — Phase 3.5+: full modal with diff + keep-mine/keep-theirs/manual
- **Server-side DELETE detection on pull** — UX TBD when pull lands
- **Multi-image API support** — defer until OW schema supports it
- **Per-world sync policy override** — default global; expose per-world when needed
- **Pagination ceiling** — `listElements` doesn't paginate yet; revisit when real worlds hit limits

---

## Session Log

- **2026-05-13 (session 202, Bout V.5 — pin element_type wire fix, smoke-driven)** — Captain's cascade-delete smoke surfaced a 400 from real OW on every pin push: `element_type must be provided when element_id is specified`. The pin write paths in `map-tab.ts` (manual placement + contextual create) were constructing pin bodies with `element_id` but no `element_type`. Real OW rejects; fakes didn't enforce. Five-part fix:

  1. **map-tab.ts manual pin placement** (`map-click` handler) — resolves `element_type` from the cached element (state.data.elements) or fallback store.getElement before createPin.
  2. **map-tab.ts contextual right-click create** — uses extended `ElementCreateModal.onCreated(id, type)` callback to pass the selected type into the pin body.
  3. **ElementCreateModal.onCreated** signature extended to `(id: string, type: ElementType)` — callers that need the type for downstream pin creation get it without a store roundtrip.
  4. **Engine pushPhase self-heal** — for any pin on disk lacking `element_type` (legacy pins placed before this fix), engine looks up the referenced element's type, writes it back via `folder.updateElement`, then pushes. Users don't have to re-place pins to recover sync. Defense: if the referenced element is missing locally, push fails per-element (no silent ghost pin on server).
  5. **MSW + FakeOwApiClient enforcement** — both server simulators now reject `POST /pin/` with `element_id` but no `element_type` (status 400). Locks the rule in: any code path that creates a pin without `element_type` fails its tests immediately, preventing regression.

  Existing pin tests updated to include `element_type`. Three new tests cover the engine push path (success with element_type, self-heal of legacy pin, failure when referenced element gone). **Tests**: 194 vitest (was 189; +5 for pin push coverage). Bundle: 339.67 KB JS / 94.46 KB gzipped. **Typecheck + build**: clean.

  This is the kind of bug only real-server smoke would have caught — fakes can't simulate every backend validation rule. Encoding it in the fakes after-the-fact closes the loop. Lesson: when real-server smoke surfaces a 400 with a clear message, encode the validation rule in the fakes so the regression is one test away.

- **2026-05-13 (session 202, Bout V — pre-smoke hardening)** — Verification-driven pre-smoke pass. After Phase 3.5 closed, Temper produced a list of 10 candidate issues at mixed confidence. Rather than fix-and-pray, ran a 4-agent verification exo (Explore subagents) covering: data-loss vectors, merge correctness, skeptical second-pass, and local-data-protection invariant. Cross-verified findings against each other; agents disagreed on several concerns and made technical errors that synthesis caught. Net result: 4 verified issues fixed; 6 deferred as overstated/perf/race-mitigated. All four fixes touch the data-protection surface — the foundational "folder is the world" invariant is now harder to silently violate.

  1. **applyServerRecord preserves atlas-extension fields** — silent-data-loss vector. Server's pull response never carries `image_media_id` (or any other atlas-only field), so overlaying the response directly destroyed the local image binding. New `ATLAS_LOCAL_EXTENSION_FIELDS` constant in `core/constants.ts` shared between adapter (strips on write) and stores (preserves on overlay). Both `FsFolderStore` and `MockFolderStore` updated to read existing first and preserve listed fields. Closes pull-update, resolveConflict pull-theirs, and Route 2 matched-same-id+matched-swap policy-b paths in one fix.

  2. **Pagination guard for server-delete detection** — silent-data-loss vector under default settings. When server has >200 elements of a type, atlas saw only page 1, then flagged the unseen page-2+ elements as "vanished from server" → auto-modal opened → user clicks delete-locally → silent destruction of alive-on-server data. New optional `getPaginatedTypes()` on `OwApiClient` interface; `OwClientAdapter` tracks per-type pagination state from the `count > results.length` envelope check; `SyncEngine.pullPhase` reads it and skips server-delete detection for paginated types. Non-paginated types in the same pull still get full detection (per-type granularity).

  3. **Body-rewrite for chain-CREATE FK in merge** — silent server-side staleness. Inside `mergeLocalIntoApi`'s phase 4b-2 CREATE loop, no file-level rewrite ran between iterations. CREATE #2 referencing CREATE #1's old local id sent the stale FK to the server even after CREATE #1's id-swap. Phase 4b-3 corrected the LOCAL file but not the server. Now `applyIdSwapsToBody` runs on the in-memory body before each adapter call — covers CREATE branch and (defensively) both matched-update branches. Engine's `pushPhase` is unaffected — it already calls `rewriteIdReferences` within each iteration after a swap.

  4. **Capture worldId in setTimeout conflict-toast defer** — narrow race fix. The `setTimeout(0)` that defers `pushOnce()` past the pull's in-flight cleanup reads `currentEngine` at fire time. If the user switches worlds between schedule and fire, the push lands on the wrong world's engine and the original world's conflict never converges. Now compares `currentWorldId` at fire vs schedule, bails gracefully if changed.

  **Verification rigor**: agents had to verify-or-refute each concern with file:line evidence, not just confirm. Cross-check caught: one agent mishandling JavaScript closure semantics, two agents dismissing concerns without grep'ing call sites, one agent claiming a fix-side-effect that doesn't actually happen. The synthesis step is irreplaceable — agents are evidence-gatherers, not oracles.

  **Tests**: 189 vitest (was 179). 10 new tests across 3 files:
  - `tests/integration/folder-store.applyServerRecord.test.ts` (NEW, 5 tests) — field preservation across pull update, multiple updates, missing local, server-ghost value, pull-theirs path.
  - `tests/integration/sync-engine.serverDelete.test.ts` (+3) — pagination suppression, mixed types in same pull, resumption after pagination clears.
  - `tests/integration/make-online.test.ts` (+2) — two-link and three-deep chain-CREATE FK with server-assigned ids.

  **Fixture extensions**: `FakeOwApiClient.getPaginatedTypes()` + `__force_paginated()` test seam. `MockFolderStore.applyServerRecord` updated to mirror the field-preservation contract.

  **Bundle**: 339.18 KB JS / 94.31 KB gzipped (was 337/93 — +1KB for the fixes). **Typecheck + build**: clean.

  **Deferred (confirmed acceptable by agents)**:
  - `getElement` O(types) directory probe — perf; defer to 3.6.
  - `rewriteIdReferences` bumping `local_updated_at` — contingent on chain-CREATE fix; mostly benign re-pushes.
  - Async write race on the same file — mitigated by single-tab lock + JS single-threading + engine in-flight dedup.
  - `maybeAutoOpenServerDeleteModal` flag leak — theoretical, page reload clears.
  - Pre-update GET N+1 — perf, already in SYNC_NOTES as 3.6 work.
  - Policy mid-sync race — theoretical, sub-millisecond window.

- **2026-05-13 (session 201, Bout U — double-link block + match-by-name checkbox)** — User-facing safety/flexibility. (1) `registry.findLinkedWorld(reg, apiWorldId, exceptId?)` — locates any registered world already linked to a given api world. (2) `linkExistingApiWorldInRoot` blocks (throws inline error) if found — refuses to create a second local linked to the same api world. (3) `MakeOnlineModal` both routes: same block applied after `client.worlds.get()` validates creds. Friendly error pointing user to the existing world. (4) `mergeLocalIntoApi` gained `MergeOpts.matchByName: boolean` (default true, back-compat) — when false, only id matches count as duplicates; name collisions push as fresh elements. Useful for worlds with intentional name dupes ("John the merchant" vs "John the bandit"). (5) Modal UI: checkbox under the policy radios in the link-existing tab, default checked. Wired through merge call. (6) 3 new vitest cases: matchByName=false coexistence on server, findLinkedWorld basic + self-exclusion. **Tests**: 179 vitest. **Typecheck + build**: clean.

- **2026-05-13 (session 201, Bout T — sync smoke fixes, the long debugging arc)** — Real-OW smoke against `5474990854` surfaced a dense stack of bugs across the adapter, engine, and merge layers. Fixed in series:
  1. **Adapter wire format**: server response normalized to bare-name fields (matching FIELD_SCHEMA + UI reads); pin keeps `_id` suffix. Write side runs SDK `prepareRelations` to add wire suffix (bypass for pins to avoid `element_id_id`). Strips server-managed (`type`, `world`, `created_at`, `updated_at`) and atlas-local (`local_updated_at`, `server_updated_at`, `image_media_id`) from write bodies. Keeps `id` on CREATE (client UUID preserved), strips on UPDATE (path param). Each failed write logs the wire body to console.
  2. **CREATE id-swap (engine)**: when server assigns its own id (real OW behavior — overrides client v4 uuids with v7), engine re-keys local file to server's id, removes the old file silently (no tombstone), rewrites foreign-key references across all local elements via `rewriteIdReferences`. UPDATE branch re-fetches from folder before sending body to capture in-loop ref rewrites.
  3. **Push order**: CREATEs partition before UPDATEs in pushPhase (handles `create Location → set Character.birthplace_id` FK chain that 400'd before).
  4. **Two-policy conflict model**: simplified to `local-wins` (default) + `pause-and-review`. Symmetric across push + pull. Engine internally normalizes legacy aliases. Skip action removed from conflict modal (no-op confusing UX).
  5. **`onSyncResult` callback** on engine fires after each round with (phase, result). sync-attach wires it to emit one-shot toasts under `local-wins`. Quiet under `pause-and-review` (badge + modal handle it).
  6. **Live policy update**: `SyncEngine.setPolicy(p)`. Settings change handler calls it on active engine. No more page-refresh required for setting changes.
  7. **Pill state override**: when `activeConflictsCount > 0` AND engine state is idle, pill renders with `data-state="pending"` + label `review N` (warm orange) instead of misleading green-synced.
  8. **Badge refresh after resolve**: modal handler calls `refreshConflictsCount()` post-action. Badge clears immediately.
  9. **Dedup conflicts on pull persist**: pullPhase's sync-state write filters new conflicts against existing element_ids (was appending, causing 1→2→3 growth on repeated refresh).
  10. **`writeJsonAtomic` hardening**: explicit `truncate(0)` before write (Chromium FS Access API quirk where shorter new content left trailing stale bytes). Post-write read-back verify on final file with diagnostic log if disk content diverges from intent.
  11. **`applyServerRecord` readback diagnostic**: logs disk content immediately after write for forensic comparison against intended content.
  12. **Pull-conflict under local-wins triggers immediate push**: emitConflictToasts fires `engine.pushOnce()` via `setTimeout(0)` (defers past the in-flight pull's `.finally` cleanup, otherwise the shared inFlight promise dedup would silently no-op the push).
  13. **Pill click double-toast removed**: the pill's onclick was firing its own "review pending" toast in addition to the engine's policy-aware one. Now pill only toasts the clean cases (pulled N, already up to date).
  14. **Server-managed field strip**: pre-existing bug — body sent `id`, `type`, `world`, `created_at`, `updated_at` causing server 422 on PATCH. Now stripped properly differentiated CREATE vs UPDATE.
  15. **Merge matched-element uses server PATCH response**: PATCH is partial; sending only user-set fields leaves server's untouched fields alone. We now apply the FULL response body to local so local mirrors server's actual post-merge state.
  16. **Merge bidirectional FK ordering (5-phase)**: matched element refs new locals via FK, new locals ref matched. Old order pushed Splashworth's body with new-locals' stale ids. New phases: (1) match-phase rewrite, (2) CREATEs (with rewritten FKs), (3) re-rewrite, (4) matched UPDATEs (now refs land correctly), (5) final rewrite cleanup. Each decision re-fetches the local element before sending.
  17. **Browser-check landing page**: ported from atlas-deprecated. Firefox/Safari users see a friendly "atlas needs chromium" page instead of broken UI.
  18. **Permanent delete world**: Settings → World tab → "delete world + folder" button. `deleteWorldFolderUnderRoot` recursively removes the world's subfolder from atlas root + clears registry + vault. Confirms before destroying.
  19. **OW server-side fix coordinated with Skeld** (m2m `updated_at`): Django `auto_now` doesn't fire on m2m_changed signals → multi-link changes on web app didn't propagate to atlas pull. Skeld shipped a signal receiver that bumps `updated_at` on m2m changes. Atlas-side: nothing to change; pull now sees the bump and applies normally.

  Each fix has a regression test in `tests/integration/*.test.ts`. **Tests**: 176 vitest (was 159). **Bundle**: 337 KB JS / 93 KB gzipped. **Build**: clean.

- **2026-05-13 (session 201, Bout S — two-policy conflict model + symmetric push/pull handling + post-write verify)** — Mid-3.5 redesign after Captain hit the muddled three-policy semantics in smoke. (1) `ConflictPolicy` simplified to `'local-wins' | 'pause-and-review'`. Engine internally normalizes legacy aliases (`drain-blind` → `local-wins`; `pause-on-conflict`/`ask` → `pause-and-review`). (2) Push-time conflict: `local-wins` pushes anyway (server overwritten, NOT persisted to sync-state); `pause-and-review` skips push + persists. (3) Pull-time conflict (NEW — was always skip-apply regardless of policy): `local-wins` skips apply + NOT persisted; `pause-and-review` skips apply + persisted. Symmetric across both directions. (4) `SyncEngineOptions.onSyncResult(phase, result)` callback added. sync-attach wires it to emit one-shot toasts under `local-wins`: push → "saved over server change(s)"; pull → "skipped pulling N elements you also edited locally". Quiet under `pause-and-review` (badge + modal handle surfacing). (5) Registry `loadRegistry` migrates legacy policy values on load. (6) Settings UI: simplified to 2 radio options with clearer hint text. (7) Conflict modal: `skip` action removed (was no-op confusing UX). Two clear choices left: overwrite-mine / pull-theirs. Close button = "decide later". (8) `writeJsonAtomic` hardened: explicit `truncate(0)` before write (avoids Chromium FS Access API quirk where shorter new content left stale bytes), post-write read-back verify on final file, throws diagnostic error if disk content diverges from intent. `applyServerRecord` also does a post-write content readback log for debugging. (9) Adapter: server `_id`/`_ids` suffix → bare names on read (matches FIELD_SCHEMA + UI); bare names → wire shape via SDK `prepareRelations` on write. Pin keeps `_id` suffix locally + skips prepareRelations (the existing element_id_id quirk). (10) Server-managed fields (`type`, `world`, `created_at`, `updated_at`) stripped from write bodies. `id` kept on CREATE (client UUID preserved or server-assigned with swap), stripped on UPDATE. (11) Push order in pushPhase: CREATEs partition before UPDATEs (handles FK chains like new Location → character with new birthplace_id). (12) CREATE id-swap when server assigns its own id: local file re-keyed to server's id, old file removed silently, foreign-key references rewritten across all local elements. (13) Diagnostic `[atlas:sync]` console logging at every key operation. (14) New `sync-engine.pullConflictPolicy.test.ts` (5 tests) verifying push + pull policy behavior + legacy alias mapping + push-conflict persistence semantics. (15) Registry test: legacy policy migration verified. **Tests**: 172 vitest (was 159). **Bundle**: 336 KB JS / 93 KB gzipped. **Typecheck + build**: clean.

- **2026-05-13 (session 201, Bout Q — pagination warning + new-api shortcut)** — (1) `OwClientAdapter.listElements` now detects the paginated envelope (`{ count, results }`) and logs a console warning if `count > results.length` — signals the user we've hit the listElements page cap on a type. Full pagination wiring deferred to 3.6. (2) `src/ui/new-api-world-modal.ts` — single-form `+ new api world` shortcut. Asks name+email+pin, then internally chains `createWorldInRoot` → `createApiWorld` → `client.worlds.get` → `attachApi` + `writeWorldMeta` + `attachSyncEngine`. (3) Sidebar header gains `+ new api` button between `+ new local` and `+ link api`. Lazy-loaded modal so initial bundle stays trim. (4) Bundle: 327 KB JS / 91 KB gzipped + 3.4 KB new-api-modal chunk + 3.2 KB server-delete-modal chunk (both lazy). **Tests**: 159 vitest. **Typecheck + build**: clean.

- **2026-05-13 (session 201, Bout P — server-side delete detection + review modal)** — Local-rep invariant gets its mirror: server-side deletes are detected during pull and surfaced to user. (1) `SyncState.server_deletes: ServerDeleteRecord[]` new field. (2) `pullPhase` tracks `seenLocalIds` (every server-listed id, across all types) — any local element with `server_updated_at` not seen + no pending tombstone is recorded as server-deleted. Dedupes against existing entries. (3) `FolderStore.clearServerBaseline(id)` — clears `server_updated_at` on a local element (used by the `keep` action so next push CREATEs it back). Implemented in both MockFolderStore and FsFolderStore. (4) `SyncEngine.resolveServerDelete(id, action)` — `delete-locally` calls `deleteElement(id, { silent: true })` (no tombstone since server already deleted); `keep` calls `clearServerBaseline(id)`. Either clears the record from sync-state. (5) `SyncEngine.listServerDeletes()`. (6) `src/ui/server-delete-modal.ts` — per-row review modal with delete-locally / keep + re-push buttons. Refreshes `state.data.elements` after each resolution. (7) Auto-open hook in `pullNowAndRefresh` — if `registry.sync_confirm_server_deletes !== false` AND there are pending records, modal opens automatically post-pull. Idempotent guard prevents double-open. (8) 7 new vitest cases: detection on previously-synced absent, no-flag on never-synced, no-flag on tombstoned, dedupe, delete-locally clears silently, keep clears baseline + push re-creates, no-op on unknown id. **Tests**: 159 vitest (was 152). **Typecheck + build**: clean.

- **2026-05-13 (session 201, Bout O — conflict review modal + push-conflict persistence fix)** — Conflicts are now actionable. (1) Fixed latent bug: `pushPhase` returned conflicts but never persisted them to `sync-state.json` — only pull-phase did. Now `runSync` and `runPushOnly` call `persistConflicts` after push, deduped by element_id. Pull then merges its own findings on top. (2) `SyncEngine.resolveConflict(id, action)` — three actions: `skip` clears entry; `overwrite-mine` re-pushes local (CREATE if no baseline, UPDATE otherwise) + stamps; `pull-theirs` GETs server + applies. (3) `SyncEngine.listConflicts()`. (4) `state.sync.activeConflictsCount` new slice field. (5) `refreshConflictsCount()` helper in sync-attach.ts — called after every idle transition + after attach + after detach. (6) Sync pill renders a warm `⚠ N` badge when count > 0; click → opens conflict-review-modal (with stopPropagation so the parent refresh handler doesn't fire). (7) `src/ui/conflict-review-modal.ts` — per-row resolve buttons. Refreshes `state.data.elements` after each `pull-theirs` / `overwrite-mine`. Auto-closes when list empties. (8) 5 new vitest cases: skip-clears-no-side-effects, overwrite-pushes-and-clears, pull-overwrites-local, no-op on unknown id, listConflicts returns recorded. **Tests**: 152 vitest (was 147). **Typecheck + build**: clean.

- **2026-05-13 (session 201, Bouts M + N — Settings tabbed redesign + Pause/Unlink + PIN re-attach)** — One big round of UI: (1) Router `parseHash` gained `settingsTab` (`'identity' | 'atlas' | 'sync' | 'world' | 'about'`). Helper `settingsHash(worldId, tab)`. Default tab is `identity`. URL examples: `#/settings/sync`, `#/w/<id>/settings/world`. (2) Settings panel rewritten as tab rail + content area. All existing fields (PIN, email, atlas root, world rename/delete) distributed into the right tabs. New tab `about` for version + links. (3) Sync tab gets: pause-all toggle, default conflict policy radios (drain-blind / pause-on-conflict / ask), pull-on-activate toggle, cadence dropdown, confirm-before-server-deletes toggle. All wire to registry helpers + persist immediately. (4) World tab (active world required): rename input, state label, api credentials read-only, per-world `stay offline` toggle, `refresh from api` / `test connection` / `unlink from api` (api-linked only), `make online` (local-only only), `delete world` (forget; folder preserved). (5) PIN/email change in Identity tab detaches + immediately re-attaches the active engine if api-linked (fixes the stale-creds bug from Bout J). (6) `unlink from api` confirms via window.confirm, runs `detachApi` + `detachSyncEngine`, leaves folder untouched. (7) Sidebar world widget gains hover-reveal mini-actions (api-linked only): pause/play icon (stay-offline toggle), refresh icon. Click delegation routed via `data-role`. Paused icons stay visible (signal) with warm color. (8) `+ link api` and `+ new local` and `+ new api` (added in Q) all in sidebar header. (9) Settings panel subscribes to BOTH `subscribe(state)` AND `onHashChange(...)` so tab clicks re-render. (10) `phase35-settings.spec.ts` — 6 new Playwright tests covering tab defaults, URL deep-linking, sync toggles persistence, world tab rename + stay-offline, api-linked-specific actions, unlink flow. (11) Updated existing `phase2-ui` (4 tests) and `phase3-make-online` (5 tests) Playwright tests to navigate to the right tab before asserting world-or-atlas-specific content. (12) CSS additions: settings shell, vertical tab rail, toggles, radios, fieldset, danger-actions divider, conflict modal, sync-action hover-reveal in worlds list. **Tests**: 147 vitest + 75 Playwright (33 new + updates) all green. **Typecheck + build**: clean.

- **2026-05-13 (session 201, Bout L — bidirectional Route 2 merge + id-swap + reference rewrite)** — Local-representation invariant now enforced in Route 2 merge. (1) `mergeLocalIntoApi` restructured: match phase computes three decision buckets (`create`, `matched-same-id`, `matched-swap`), then download phase pulls server-only elements via `applyServerRecord`, then apply phase handles each local decision per policy. (2) When name+type match has different ids, id-swap: server.id wins. Local file is re-saved at server.id; the old local file is removed silently (`deleteElement(id, { silent: true })`) so no DELETE is queued for the server. (3) New `MergeResult.downloaded` count for the server-only bucket. (4) `rewriteIdReferences` walks every local element scanning string and string-array fields for any old-id value and rewriting it to the new id. Handles single-link and multi-link foreign keys without hardcoding `_ids` suffix. (5) `FolderStore.deleteElement` gained `opts.silent: boolean` — removes file without tombstones. Implemented in `MockFolderStore` and `FsFolderStore`; silent implies non-cascade. (6) `make-online-modal` refreshes `state.data.elements` after merge so downloaded + swapped elements appear in UI immediately. Toast format updated to include all four counts (pushed/updated/skipped/downloaded). (7) 6 new vitest cases: server-only download, id-swap policy b, id-swap policy c, single-link reference rewrite, array reference rewrite, multi-type triple-bucket scenario. **Tests**: 147 vitest (was 141). **Typecheck**: clean.

- **2026-05-13 (session 201, Bout K — periodic auto-pull + visibility + network events)** — Background scheduler for opt-in periodic pulls. (1) `src/sync/auto-pull-scheduler.ts` — module-level singleton. Reads `registry.sync_cadence_ms` (null/0 = off, default). Calls `pullNowAndRefresh()` every cadence-ms while eligible. (2) Eligibility check (`reconcileScheduler`): cadence set + visible + engine attached + engine not paused + global pause off. (3) Listens for `visibilitychange` (pause on hidden, resume on visible), `online` (resume engine if it was network-paused), `offline` (pause engine with reason='network'). (4) Wired into `app.ts` boot via `initAutoPullScheduler()` — idempotent. (5) Subscribes to state changes so cadence/pause-flag edits trigger reconcile. (6) Test seam: `__test_reconcile`, `__test_isRunning`, `__test_currentCadence`, `__test_stop`. (7) 9 new vitest cases: off when null/0, off without engine, on with cadence+engine, stops on global pause / engine pause / detach / document hidden, restarts on cadence change. **Tests**: 141 vitest (was 132). **Typecheck**: clean.

- **2026-05-13 (session 201, Bout J — pullNow + manual refresh + pull-on-activate)** — Phase 3.5 kicks off. (1) `SyncEngine.pullNow()` public method — pull-only path, no-op while paused, in-flight dedupe via shared promise. (2) Registry sync settings: `sync_pull_on_activate`, `sync_cadence_ms`, `sync_default_policy`, `sync_confirm_server_deletes`, `sync_pause_all` (all global, default-off). (3) Per-world `WorldRegistryEntry.sync_paused` for stay-offline toggle. (4) Registry helpers: `setSyncPullOnActivate`, `setSyncCadenceMs`, `setSyncDefaultPolicy`, `setSyncConfirmServerDeletes`, `setSyncPauseAll`, `setWorldPaused`. (5) `attachSyncEngine` now: applies default conflict policy from registry, starts paused if global-pause OR per-world-pause flag is set, fires `pullNowAndRefresh()` if `sync_pull_on_activate` is set. (6) `pullNowAndRefresh()` helper in sync-attach.ts wraps pullNow + re-reads folder elements into `state.data.elements` so pulled-in content shows up in UI. (7) Sync pill is now clickable when api-linked — click triggers pullNowAndRefresh, surfaces results via toasts (already up to date / pulled N new + M updated / N conflicts detected). Pill grows a refresh icon on hover; CSS adds `data-clickable` cursor + animated icon. (8) DESIGN.md: documented local-representation invariant, local-first sync orientation, new pull triggers section. (9) Vitest: 6 new pullNow tests + 7 new registry sync-settings tests. (10) BOUT_I_SMOKE.md marked superseded by PHASE3.5_BRIEF.md. **Bundle**: 305.77 KB JS / 84.56 KB gzipped. **Tests**: 132 vitest (was 119). **Typecheck + build**: clean. — Final Phase 3 plumbing. (1) `SyncEngine.requestPush()` schedules a debounced push (default 5s, `setDebounceMs(ms)` for tests). Coalesces bursts of edits into one push. No-op while paused. (2) `SyncEngine.stop()` cancels pending push timer + pauses. Called from `detachSyncEngine` on world switch. (3) `requestPushIfLinked()` convenience helper in sync-attach.ts — no-ops if no engine is attached (local-only). (4) Wired into every folder-write call site: element-detail field-save + delete, element-create modal, map-create modal, map-tab pin placement (manual + right-click contextual), map-index map delete. Each call schedules a debounced push if an engine is attached. Local-only worlds: no-op (engine is null). (5) Vitest integration `sync-engine.autosave.test.ts` (4 cases): debounce fires after window, multiple calls coalesce, no-op while paused, stop() cancels pending. (6) Conflict review UI deferred to Phase 3.5 per the brief — conflicts still persist to sync-state.json for later. (7) Full test suite green: 119 vitest + 75 Playwright = 194 tests across 14 vitest files + 7 e2e files. Bundle: 304 KB JS / 84 KB gzipped.

  **Phase 3 status: feature-complete pending smoke test (Bout I).** Local-only + api-linked + Make-Online (both routes) + Link-Existing-API + autosave + sync pill state mapping all working. Captain's manual smoke against `5474990854` is the next step; cutover (force-push atlas/, archive atlas-deprecated/) follows.

- **2026-05-12 (session 200, Bouts F+G — Make-Online (Route 1 + Route 2))** — Both routes for flipping a local-only world to api-linked. (1) `src/sync/make-online.ts` — `createApiWorld({name, email, pin})` POSTs to `/worldsync/create-world-external/` (derived from worldapi base by stripping the suffix; the SDK doesn't expose this endpoint), `mergeLocalIntoApi(folder, adapter, policy, onProgress)` handles Route 2 with per-element resilience. Match strategy: id first, name+type fallback. Policy b = overwrite-on-match, c = push-only-new (stamp baseline without push). `setMakeOnlineBaseUrl` for test seam. (2) `src/ui/make-online-modal.ts` — BaseModal subclass with two tabs (create new / link existing) and per-route forms. Pre-fills email + pin from registry. Route 1: createApiWorld → client.worlds.get for server world_id → temp SyncEngine.pushOnce → registry.attachApi → writeWorldMeta → attachSyncEngine. Route 2: validate → mergeLocalIntoApi → registry.attachApi → writeWorldMeta → attachSyncEngine. Both routes show progress, error inline, toast on close. (3) Settings panel — "make online" button appears only for local-only active worlds; hidden for api-linked. (4) CSS additions: `.atlas-modal-tab-bar`, `.atlas-policy-fieldset`, `.atlas-policy-option` for the dual-route layout. (5) Vitest integration (8 cases): createApiWorld success + missing-fields + unreachable URL, mergeLocalIntoApi policy b + policy c + id-match + per-element resilience (MSW 500 mid-stream) + progress callback. (6) Playwright (6 cases): settings shows button, modal opens with tabs, tab switching, cancel, link-route validation, hidden for api-linked. Bundle: 303 KB JS / 84 KB gzipped. 115 vitest + 12 phase3 e2e green.
- **2026-05-12 (session 200, Bout E — Link Existing API World)** — Full link flow. (1) `src/sync/initial-download.ts` — fetches every element type from the OW API, writes to folder via `applyServerRecord`, per-element resilience (failures returned, not thrown), progress callback with `phase: 'list' | 'write'`. (2) `linkExistingApiWorldInRoot(opts)` in atlas-root-flow.ts — validates creds via `client.worlds.get()`, friendly errors for 401/403/404/network, creates subfolder + handle, opens FolderStore, writes meta with `api: {world_id, api_key}`, runs initial download, registers as api-linked, sets active, attaches SyncEngine, primes elements cache. Persists global PIN if registry didn't have one. (3) `src/ui/link-world-modal.ts` — BaseModal subclass using new `buildModalShell`. Form: api-key + pin (pre-filled from registry) + display-name (optional). Submit disables form + shows progress box. On success: toast + navigate to elementsHash. On error: inline error, form re-enabled. (4) `+ link api` button added to worlds-sidebar header next to `+ new local` (only shown when atlas root is set). (5) `.atlas-modal-progress` CSS — cyan-tinted info box for the download progress indicator. (6) Vitest integration tests (5 cases) verify initial-download against MSW + MockFolderStore: empty server, populated server, progress callback shape, per-element write resilience, multi-type coverage. Required new `__inject_apply_failure` hook on MockFolderStore. (7) Playwright spec (6 cases): button visibility, modal layout, PIN pre-fill, cancel, Escape, validation error. Skipped end-to-end network flow (Captain's smoke test in Bout I covers it). Bundle: 292 KB JS / 81 KB gzipped. 107 vitest + 6 phase3-link-api e2e green.
- **2026-05-12 (session 200, Bout Modal — base modal scaffolding + consolidation)** — Captain flagged that the (future) link modal would drift from existing modal styling and asked for a proper base. (1) `BaseModal.buildModalShell({title?, panelClass?, dataModal?})` now owns the standard overlay+panel+title+body scaffolding. Returns `{overlay, panel, body}` — subclass fills `body.innerHTML` (or appendChild) with content + actions row. (2) `title` is optional — the picker keeps its custom title-row (title + count badge). (3) Removed the dead `modalClass` constructor param from BaseModal (was passed by every subclass but never used). All four current modals refactored: create-world-modal, element-create-modal, map-create-modal, element-picker-modal. ~15 lines of duplicate chrome per modal removed. (4) New `.atlas-modal-body` CSS hook (flat flex column) so the wrapper div has consistent layout without disturbing existing spacing. Bundle unchanged (~286 KB JS). 44 e2e tests across all modal-touching specs (phase2-ui + phase4-elements + phase4-schema + phase5-maps) all green. **Future modals (link-world, make-online) will inherit consistent chrome from `buildModalShell`.**
- **2026-05-12 (session 200, Bout Scroll — element-detail scroll preservation)** — Port of craft #104 from legacy atlas. Module-level `scrollMemory: Map<elementId, scrollTop>` in element-detail.ts. (1) `captureScrollBeforeRender()` reads the old body's `data-element-id` + scrollTop BEFORE `target.innerHTML = ''`. (2) New body element gets a passive scroll listener that live-tracks scrollTop into the map. (3) After render, `queueMicrotask` restores scrollTop (synchronous set on un-rendered nodes is silently dropped). (4) `resetElementDetailScrollMemory()` exported and called on world switch in `activateWorld`. Fix for Captain's bug: field link/delink no longer jumps scroll to top. Survives field edits, picker resolves, link removes, back-navigation (A → B → back → A's scrollTop restored). Reset only on world-switch + page refresh (intentional). New Playwright spec verifies behavior. 11 phase4-schema tests green.
- **2026-05-12 (session 200, Bout E.0 — Phase 3 infrastructure)** — Plumbing for the upcoming api flows. (1) `state.sync: SyncSummaryState` slice added — `{byWorld: Record<id, SyncEngineState>, activeSync: SyncEngineState | null}`. (2) `src/sync/sync-attach.ts` — module-level singleton manager. `attachSyncEngine(entry, folder)` creates an OW SDK client from entry.api + registry.pin, wraps in OwClientAdapter, constructs SyncEngine with `onStateChange → patchSlice('sync')`. Auto-detaches the previous engine. Local-only worlds get null (no engine, but detach still fires). `detachSyncEngine()`, `getCurrentSyncEngine()`, `getCurrentSyncWorldId()` exposed for downstream callers. (3) Wired into `activateWorld` (worlds-sidebar.ts) and `createWorldInRoot` (atlas-root-flow.ts) so any world activation/creation re-attaches correctly. (4) MSW handler `POST /worldsync/create-world-external/` added — derives worldsync base from worldapi base (different path prefix). Returns `{success, api_key}` for valid requests, 400 with `{message}` for missing fields. Exposes `worldCreations[]` capture for test assertions. (5) `renderSyncIndicator` now reads `state.sync.activeSync` for api-linked worlds — maps `SyncEngineState.kind` to pill dataState (idle→synced, syncing→saving, paused→pending/offline, error→error) with stateful labels and tooltips. Local-only path unchanged. Bundle: 286 KB JS / 79 KB gzipped (SDK now actually imported; previously tree-shaken). 102 vitest + 6 phase6 e2e all green.
- **2026-05-12 (session 200, Bout Resilience — engine push tolerates per-element errors)** — Foundational for Make-Online which uploads many elements at once. (1) New `PerElementFailure` type in core/types. (2) `SyncResult.failures: PerElementFailure[]` added. (3) `pushPhase` wraps each create/update/delete iteration in try/catch — 4xx, validation, transient network failures are recorded in `failures` but do NOT abort the whole push. (4) `pushOnce()` public method on the engine — push-only path with progress reporting (no pull). Used by Make-Online flows that want progress UI without a pull cycle. (5) `onPushProgress(done, total)` option in SyncEngineOptions fires once per element (success OR failure). (6) `__inject_failure(op, id, msg)` added to FakeOwApiClient for resilience tests. (7) New `sync-engine.resilience.test.ts` (6 tests): CREATE-failure-mid-batch, UPDATE-failure, DELETE-failure, progress callback counts, pushOnce shape, pushOnce honors failure tolerance. Tests now 102 vitest (was 96). Typecheck + build clean.
- **2026-05-12 (session 200, Bout State 1 — URL-restore + click→elements)** — Three state-shape fixes before Phase 3. (1) `queryWritable(handle)` added to handle-vault: silent permission check (no gesture needed). (2) `activateWorld` now takes opts `{silent, preserveSelection, permissionMode}`. Default behavior unchanged for sidebar-click path; new boot-time path uses `permissionMode: 'query'` + `silent: true` + `preserveSelection: true`. (3) `tryAutoActivateFromUrl(toasts)` added to app.ts boot: if URL names a world and queryPermission returns 'granted' (e.g. recent session, OPFS in tests), silently activate so reload preserves state. If not granted, no-op — sidebar click remains the explicit-gesture re-grant path. (4) `navigateAfterActivate(worldId)` preserves deep URL when it already names the world; otherwise navigates to `elementsHash` for legacy "click world → see its elements" parity. (5) Two test updates: `two worlds...` and `reload+click...` now assert that the elements toggle becomes active (sidebar flips to elements mode on click) and toggle back to verify the selected row. (6) New test `reload with world in URL hash → silent auto-activate preserves state` verifies the auto-restore path against OPFS auto-grant. 96 vitest + 25 phase2/4 Playwright = all green, typecheck clean.
- **2026-05-12 (session 199, Bout C.7 — element create UX polish)** — Two cleanups matching legacy: (1) Elements sidebar header dropped; the `+ new element` button is now an `.atlas-create-btn` icon-button INSIDE the search row (matches legacy `atlas-deprecated/src/sidebar/elements.ts`). (2) Element-create modal regained the category autocomplete bar: a text input below name with ghost-text suffix completion, Tab/RightArrow-at-end to accept. Best-match strategy = exact → startsWith → includes. Type grid below is unchanged; grid button click fills the input + highlights. Also: added `.playwright-mcp/` to `.gitignore` (ephemeral MCP browser snapshots).
- **2026-05-12 (session 199, Bout C.6 — second polish pass)** — Three remaining visual gaps closed: (1) Filter strip + create grid now show 20 element types (added `zone`, matching legacy's "all 22 except pin/marker" rule). (2) Modal styling aligned to legacy: `ow-btn` / `ow-input` → `atlas-btn-ghost` / `atlas-btn-primary` / `atlas-input` across `create-world-modal`, `element-create-modal`, `map-create-modal`. (3) Right-pane tab bar refactored to use legacy `.atlas-tab-bar` / `.atlas-tab` / `.atlas-tab-close` (with `min-height: 32px`) instead of bespoke `.atlas-right-tab*` system. Stripped another ~80 lines of duplicate CSS. CSS bundle dropped from 48.20 KB → 46.78 KB. Same root pattern as Bout C.5: I'd invented parallel CSS instead of using canonical legacy classes already present in the ported atlas.css.
- **2026-05-12 (session 199, body+font reset)** — Two CSS regressions diagnosed and fixed in `index.html`. (1) Body had default 8px margin (no html/body reset → shell overflowed → thin light-gray border visible right+bottom). (2) Body had no `font-family` → `<h2>` titles fell back to Times New Roman serif and the rest of the UI lacked antialiasing. Both root-caused to Phase 2 rebuild dropping the legacy inline `<style>` block. Restored system-font stack + smoothing + reset.
- **2026-05-12 (session 199, Bout D)** — Polish features. New `middle/timeline.ts` (port from legacy adapted to array-shaped data.elements). Router gained `timeline` mode + `timelineHash` helper. Welcome panel got a "view timeline →" CTA. Sync indicator pill: reuses pre-existing legacy `.atlas-sync-pill` CSS (fixed bottom-right with backdrop blur); rendered to document.body so position is independent of tab bar. Worlds sidebar favorites: star toggle via `.atlas-inline-actions`, persists via `setFavorite`, favorites-first sort. Tab bar got `.atlas-right-tab-bar` class for explicit flex layout. 6 new Playwright specs (61 e2e total).
- **2026-05-12 (session 199, Bout C.5)** — Visual polish pass. Replaced all bespoke list markup (`.atlas-world-row`, `.atlas-element-row`, `.atlas-map-row`) with legacy `.atlas-row` + `.atlas-list`. Sidebar mode toggle uses legacy `.atlas-mode-btn` with `.active` modifier + OW icon for worlds tab. Element-detail header reverted to legacy `.atlas-middle-header` markup (icon + h2 + spacer + icon buttons). Stripped ~270 lines of duplicate CSS. Updated ~30 e2e selectors. All tests green; bundle CSS shrank from 52.96 KB to 47.44 KB.
- **2026-05-12 (session 199, Bout C)** — Phase 5 spatial UI. State extensions: `ui.rightTabs`, `ui.rightActiveIndex`, `ui.pinPlacement`. Router: `#/w/<id>/map/<mid>[/element/<eid>]`. New files: `tabs/right/right-pane.ts` (driver: tab bar + body dispatch), `tabs/right/map-index-tab.ts` (list + favorites stub deferred), `tabs/right/map-tab.ts` (Leaflet wiring, ~290 lines, ported with arch changes), `ui/map-create-modal.ts` (BaseModal subclass, FolderStore-backed). Element-detail header gains pin button when map tab is active. Test harness extended (`getState`, `getActiveStore`, `patchData`). 9 new Playwright specs (55 e2e total). Typecheck + build + all tests green.
- **2026-05-12 (session 199, Bout B)** — Phase 4 schema editor. Rewrote `middle/element-detail.ts` to full schema-driven (sectionsFor → header+body→fields, collapsible toggle, link chips, picker dispatch, Referenced-By scan, footer with id+timestamps). New `ui/element-picker-modal.ts` (search + type strip + row cap + Promise resolve). CSS additions ~130 lines for picker panel/list/chips, referenced-by styling. Updated 2 Bout A tests to match new schema-driven DOM. 9 new Playwright specs (46 e2e total). Typecheck + build + all tests green.
- **2026-05-12 (session 199, Bout A)** — Phase 4 minimum. Sidebar mode toggle + Elements mode + minimum element detail + create modal. New files: `sidebar/sidebar.ts` (driver), `sidebar/elements-sidebar.ts`, `middle/element-detail.ts`, `ui/element-create-modal.ts`. Refactored: `sidebar/worlds-sidebar.ts` → body-only (`mountWorldsBody`); `app.ts` mounts new sidebar driver + element middle. State shape extended (`data.elements`, `ui.{sidebarMode, selectedElementId, elementFilters, search}`). Router extended for `#/w/<id>/elements` + `#/w/<id>/element/<eid>`. CSS additions ~210 lines for elements list, detail field rows, mode toggle, empty states. 10 new Playwright specs (37 e2e total). Typecheck + build + all tests green.
- **2026-05-12 (session 198, Bout 6)** — Three fixes. `#/settings` standalone route (gear icon now works without an active world). `discoverWorldsInRoot()`: setup scans the atlas root for subfolders with valid `world.json` and imports them — critical after localStorage wipe + re-pick. Migration note added to settings ("changing this folder doesn't move existing worlds"). 2 new Phase 2 specs.
- **2026-05-12 (session 198, Bout 5)** — Atlas-root refinement: wrap-by-default with re-use detection. Picked folder becomes parent; atlas creates `onlyworlds-atlas/` inside (renamed from `atlas-worlds/` for brand clarity, with legacy detection). Display switched to pathHint (parent/wrapper) for context. 2 new Phase 2 specs.
- **2026-05-12 (session 198, Bout 4)** — Atlas-root concept. One-time folder setup before world creation. New: `src/setup/atlas-root-flow.ts` (setup + hydrate + createWorldInRoot + slugify), atlas_root field in registry + state, sidebar/welcome/settings all switch on root presence. Modal becomes name-only when root is set. Each world keeps its own handle so root is a creation convenience, not storage. Fixed `loadRegistry` field-dropping bug. New tests: 9 Phase 2 UI specs (rewritten) + 7 atlas-root unit tests. 96 vitest + 22 Playwright = 118 total.
- **2026-05-12 (session 198, Bout 3)** — Phase 2 minimal UI. New: `core/state.ts`, `core/router.ts`, `layout/app-shell.ts`, `sidebar/worlds-sidebar.ts`, `middle/welcome-panel.ts`, `middle/settings-panel.ts`, `ui/directory-picker.ts`, `ui/create-world-modal.ts`, `app.ts`. `main.ts` boots `startApp(root)`. Toast singleton wired. Two lock-correctness fixes: per-tab `sessionStorage` id (reload reclaims own lock); prior-store close on create flow (defensive). Bundle 1.14 KB → 29.21 KB (full UI). 7 new Playwright specs (89 vitest + 20 e2e = 109 total). First user-testable build.
- **2026-05-12 (session 198, Bout 2)** — Real FolderStore via FS Access API. New: `fs-utils.ts`, `idb.ts`, `handle-vault.ts`, `folder-store-fs.ts`, `vite-env.d.ts`. Dev-only test harness on `window.__atlasTestApi` (tree-shaken from prod). 12 Playwright specs drive the real impl against OPFS — same `FileSystemDirectoryHandle` interface as a user-chosen folder. All green: layout creation, round-trip CRUD, cross-session persistence, cascade delete, tombstone durability, sync state round-trip, lock file write/clear, live-lock rejection, stale-lock recovery. Total tests: 89 vitest + 13 Playwright = 102.
- **2026-05-12 (session 198, Bout 1)** — Foundation polish before more building. Five decisions locked (cascade-delete in FolderStore; lock-file heartbeat 30s/90s TTL; policy rename `server-wins` → `pause-on-conflict`; Route 2 policy (a) dropped; email global). Four code changes: deepEqual diff, cascade-delete contract + `findDependents`, syncNow mutex, policy rename. 22 new tests (67 → 89). Typecheck + build clean.
- **2026-05-12 (session 197)** — Phase 0 foundation + Phase 1 sync. 8 bouts, 67 tests, 5 git commits, clean build. Refactor pivot from legacy IDB-cached atlas. New atlas at `tools/atlas/`; legacy archived at `tools/atlas-deprecated/`. Local git initialized; remote pointed at https://github.com/OnlyWorlds/atlas.git (legacy still on main, Captain force-pushes when ready).
