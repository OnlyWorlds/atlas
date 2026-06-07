# Atlas — Progress History (Archive)

Session-by-session detail from **sessions 197-233** (2026-05-12 to 2026-05-25).
Sessions 197-222 archived 2026-05-18; 229-233 (appended at the bottom)
archived 2026-06-07 during the session-235 scrub.

This is archaeology — for what we built and why. Use git log + `.temper/reflections/` for similar coverage.
For current state, see `../PROGRESS.md`. For architecture, see `../DESIGN.md`. For sync lessons, see `../SYNC_NOTES.md`.

---

## CURRENT STATE (handover snapshot, session 221 close)

Tool is in a tight, healthy state. 553 vitest + 93 Playwright e2e, all green. Bundle 488 KB JS / 137 KB gzipped. Sentence case throughout. Slug-prefix filenames. Hotkeys MVP. Map view persists per-map. Pin badge accurate. Sync pill shows "synced 3m ago" live. atlas_shape stripped on wire. All "engine not ready" toasts route through `surfaceSyncUnavailable` (`src/ui/sync-toasts.ts`) for PIN-aware messages + deep-links. Welcome panel is the single CTA for atlas-root setup/recover (sidebar version dropped session 221 W2). Sentence case throughout. Slug-prefix filenames on disk. Hotkeys MVP wired. Modal styling unified. Per-map camera state persists across reloads. Pin badge accurate. Sync pill shows "synced 3m ago" live.

Session 221 was a 5-bout validation+strengthening pass. Live FK bug surfaced + handled. Map view preserve done. Pin badge bug fixed. Soft-edges cleaned. Polish UX landed. No new features beyond what the work list required.

**Open candidates (none blocking)**:
- Pin STYLE visual specs (V1.5 STYLE deferred from session 216) — not pressing per Captain
- A11y keyboard-only walkthrough (explicitly deferred)
- Hotkeys grow: `Ctrl/Cmd+M` new map, `Ctrl/Cmd+Backspace` delete, Tab nav in modals — design discussion needed
- Cascade-delete crash recovery (FS Access API has no transactions; worst case is recoverable today)
- Stuck-pin auto-cleanup after N failures (low-frequency edge case)
- Per-element refresh API method (per-type is the workaround today via right-click filter chip)
- Conflict log review UI for resolved/historical conflicts (active conflicts already have a modal)

**Major subsystems**: foundation + sync + map + zone all shipped and working. Phase 3.5 + zones era closed. No "phase brief" docs active.

**Items dropped from backlog (Captain session 221)**: per-world conflict policy override, email per-world, zone-targets-map, cross-element pin rendering, map subtype visual filter, map locking via URL, "maps within" inverse search perf, picker keyboard shortcut, pin coord council motion (already in schema), snap-to-existing-vertex for pins (only relevant for markers, already done), repair pre-migration server markers, hotkey undo/redo (too complex for now).

---

## ZONE SUBSYSTEM STATE (handover snapshot, session 218 close — kept for reference)

Quick-grasp doc for the next-chat me. The zone subsystem has been the spine of the last 6 sessions (213-218). Architecture is stable; the next batch is polish + cross-cutting concerns.

### Current architecture (as-shipped)
- **Domain model** (DESIGN_ZONES §1): Zone = pure metadata (no map_id, no coords). Markers carry map_id + zone_id + x/y/order. Geometry is emergent: a zone "appears on map M" iff at least one marker references both.
- **Shape storage**: `atlas_shape: 'polygon'|'line'` extension field (local-only, never synced). Read via `getZoneShape(zone)` helper which falls back to legacy `supertype` for pre-ZD6 zones. **Never read `zone.supertype` for shape — always go through the helper.**
- **Supertype / subtype**: free user-meaningful text (OW canon). Empty input → undefined.

### Drawing flow (sessions 213/217/218)
- Toolbar ⬡ / ╱ buttons → `startDrawing(entry, mode, toasts)` in `zone-drawing.ts`. Cursor crosshair, draft overlay mounts.
- Map clicks → `placeMarkerAt`. Shift snaps to 45° axis from last marker. **Close-to-edge clicks splice into the right segment** (ZD5 — `findClosestSegment` with 20-storage-unit threshold).
- Draft markers are **draggable** (SB3); polygon outline follows live (ZC2). Numbers are bold + haloed (SB4/B4).
- **Enter** finishes (ZC1) or click ✓ Finish. **Escape** cancels.
- Finish → opens **ZoneCreateModal** (ZC10). Shape badge (read-only), name (auto-selected), supertype text, subtype text. Submit writes `atlas_shape: draft.mode` + user text. Cancel keeps draft active.

### Edit flow (sessions 214/217/218)
- Double-click polygon OR "Edit shape" button → `enterEditMode(zoneId, mapId, toasts)` in `zone-edit-mode.ts`.
- ZoneOverlay outline goes **dashed** (ZC6), vertex dots suppressed, **numbered draggable handles** appear, **centroid drag handle** at center (ZC7, `open_with` glyph).
- **Live outline** during vertex OR centroid drag (ZD4) — `ZoneOverlay.setZonePointsLive` uses `setLatLngs` to mutate SVG path in place per frame.
- Click anywhere on canvas → insert marker at click point at nearest segment (ZC8).
- Hover segment → cyan dashed overlay; click → midpoint insert.
- Right-click vertex → delete (refuses if shape would drop below min).
- Enter or "Done" commits; Escape or "Cancel ✗" restores from snapshot (3-way diff).

### View flow
- Zone selected (not editing) → glow + plain cyan vertex dots, **no numbers** (ZC4). Outline solid.
- **Toolbar dropdown** (ZC9, ZD2/ZD3) replaces the bottom chip strip. Right-anchored button shows count; click opens panel listing chips. Trash icon (ZD2) deletes; **canvas updates immediately** after delete (ZD2 fixed the orphan-overlay bug via new `ZoneOverlay.getZoneIds()` accessor).

### Element-detail surface
- Standard schema-driven editor + two zone-specific sections (DESIGN_ZONES §4.4):
  - "Zone visuals" — atlas_color, atlas_opacity, atlas_label_visible (all local-only)
  - "Markers" — per-map grouped list with pan/delete buttons, "Edit shape" button
- Header `[map]` icons via `getAssociatedMaps` → click pans to centroid.

### Key files (zone subsystem)
- `src/tabs/right/zone-drawing.ts` — draft state, placeMarkerAt, finishDrawing → modal
- `src/tabs/right/zone-edit-mode.ts` — enterEditMode, handles, centroid, click-anywhere insert, live outline
- `src/tabs/right/zone-derived.ts` — listZonesOnMap, markersForZoneOnMap, partitionZonesAndMarkers, **getZoneShape**
- `src/tabs/right/zone-drawing-overlay.ts` — draft DOM strip
- `src/tabs/right/map-tab-zones.ts` — syncZones, renderChipStrip (now → dropdown), chip click handlers
- `src/visualization/leaflet-2d/ZoneOverlay.ts` — addZone/updateZone, setZoneSelected, setZoneEditing, setVertexDotsSuppressed, setZonePointsLive, getZoneIds
- `src/visualization/leaflet-2d/ZoneGeometry.ts` — findClosestSegment, projectToSegment, snapToAxis, polygonCentroid, polylineLabelAnchor, distanceToSegment
- `src/middle/element-detail-zone-sections.ts` — visuals + markers sections
- `src/ui/zone-create-modal.ts` — create modal (ZC10/ZD6)
- `DESIGN_ZONES.md` + `DESIGN_MAPS.md` §11-13 — design reference

### Known gaps / open work (Captain's next-chat dump)
Captain will re-paste the full list next chat. Themes that emerged:
- **Map view preserve on reload** — currently resets to too-far-out zoom; should fit-to-image instead.
- **Cursor STILL hand** — my ZD1 !important fix may not have caught all cases. Re-investigate (could be an inline style from leaflet's interaction state).
- **Visual settings popover** — move from on-canvas overlay to anchored-right inside the middle panel (or compact it). Several pin/zone visual prefs still don't render-respond (pin shape, pin color, zone opacity, zone labels — need to audit + wire). Grid is faint, 50px is large, allow custom size. Save-as-default shouldn't propagate to maps with their own override (currently does — bug).
- **Modal consistency audit** — some modals have white inputs that don't match. Need a uniform modal base + list of all modals.
- **New-X buttons** (new local world, new map, etc) — visual unification needed.
- **Hotkeys + accessibility** — Ctrl+E for create element, Ctrl+S for save, tab-fillable modals.
- **Element file naming**: prepend slug to filename instead of just UUID (audit + smoke for any path-parsing breakage).
- **Inline edit option for text fields** (alternative to modal): setting with three modes — modal / single-line inline / 4-line inline.
- **Text selection inside fields** — currently left-to-right selection triggers field-edit; right-to-left doesn't. Inconsistent. Fix to allow free text selection.
- **Link-field icons** — after a recent change, category icons in link fields are missing until ≥1 link exists. Should always be visible (anchored right) and clickable to open picker.

### Deferred (still standing)
- Pin STYLE variants (V1.5 STYLE) — needs visual specs.
- Snap-to-existing-vertex during draw/edit — polish.
- Popover label capitalization — minor styling.
- map-tab.ts size watch — 657 lines, still under 858 threshold but creeping. Consider extracting drop/contextmenu handlers if we touch maps work.

### Sync/API smoke (Captain's tasks, still open)
- Repair pre-migration server markers (manual: enter edit, nudge a marker, release).
- Verify zoner cross-tool render of atlas-pushed zones.

---

## Session 221 Bout 6 (2026-05-18) — Validation feedback repairs

After Captain re-tested the Bout 4 polish UX items, six items needed fixing or refining. All landed in ~1 hour.

### W1: Popover survives map tab switch

Real cause: `outsideClickListener` in `map-visual-settings-popover.ts` closed the popover when the click target was a different map tab button (because the click was "outside" the popover wrapper). The right-pane subscriber's retarget code then no-op'd because `openPopover` was already null.

Fix: added `.atlas-tab` to the bail-out list inside `outsideClickListener`. The right-pane subscriber retains responsibility for retarget/close; the outside-click listener defers when the click is on a tab.

### W2: Sidebar setup/recover-atlas buttons removed

The sidebar header's single-icon button for `setup-atlas` / `recover-atlas` looked orphaned vs. the compound-icon column it sits in once an atlas root is set. Welcome panel (middle pane) is now the sole CTA for both. Sidebar empty-state copy updated to "Use the welcome panel to ..." instead of "above".

Dropped: ~20 lines of header markup + click handlers + `setupAtlasRoot` / `recoverAtlasRoot` imports in `worlds-sidebar.ts`. Welcome panel (`welcome-panel.ts`) handles both paths unchanged.

### W3: Toast sweep — engine-not-ready → PIN guidance

Captain hit "Refresh is only available on API-linked worlds" on an api-linked world that simply had no PIN configured. Multiple sites had the same mis-diagnosed toast.

Consolidated into a single helper:

- `sync-attach.ts`: new `diagnoseSyncUnavailable()` returns a structured reason (`'no-active-world' | 'local-only' | 'pin-missing' | 'attached-but-paused' | 'engine-not-ready'`).
- `src/ui/sync-toasts.ts` (new): `surfaceSyncUnavailable(toasts)` emits the right toast for each reason. For `pin-missing` it also `navigate(settingsHash(worldId, 'identity'))` to deep-link the user.

Call sites updated:
- `right-pane.ts` pill click (refactor of the B4 inline logic into the helper)
- `worlds-sidebar.ts` refresh button
- `settings-panel.ts` refresh-from-API
- `conflict-review-modal.ts` open
- `server-delete-modal.ts` open
- `elements-sidebar.ts` filter-chip right-click refresh

### W4: Right-click refresh in-flight lock

`elements-sidebar.ts` gained a module-level `refreshInFlight` flag. Spam right-clicks now toast `"Refresh already in progress…"` instead of stacking pulls.

### W5: Flash survives sidebar re-render

Captain reported: manual pulls didn't flash the affected element. Root cause: `pullNowAndRefresh` dispatches `atlas:pulled-ids` (sidebar adds `data-flash`), then `patchSlice('data', { elements })` triggers a re-render via `listEl.innerHTML = ...` — which blows away the `data-flash` attribute before CSS animation completes.

Fix: track flashing ids in a module-level `Map<string, timeoutHandle>` keyed at `triggerFlashForIds`. `renderElementRow` reads from the Map and emits `data-flash="true"` on each render. When the timer fires, the id is removed from the Map AND the body re-renders to drop the attribute. Flash now survives any number of intervening re-renders.

Bonus: works across MULTIPLE mounted elements bodies via `mountedRerenders: Set<() => void>` (in case of split-pane futures). Each mount adds + removes itself from the Set in mount/unmount.

### W6: Camera persist on page refresh + diagnostic logs

Captain reported the camera state restored on tab switch (already worked via cached entry) but NOT on page refresh. Investigation showed the code was correct in principle but lacked observability — added `console.info('[atlas:map] camera restored', { mapId, savedAtMount })` on successful restore and `console.info('[atlas:map] no saved camera for', mapId, '— using fit-to-image')` when no state exists. Also added a microtask-debounced save (idempotent for rapid moveends from a single gesture).

If the issue persists on Captain's next test, the console log will pinpoint whether the bug is on the save side (no entry in localStorage) or the restore side (entry exists but setView doesn't take). Defer further work until evidence arrives.

### Tests + bundle

553/553 vitest still green (no new tests for this bout — all changes are wiring/cosmetic). Bundle 487.51 KB JS / 137.40 KB gzipped (essentially flat from session 221 main).

### Post-Bout-6 follow-ups

After Captain re-tested Bout 6, three small things needed a final pass:

- **W2 follow-up — context-aware empty state**: the elements-sidebar empty-state message said "No active world. Pick one from the Worlds tab." even when no atlas root existed (no worlds list to pick from). Branched the message on `(atlasRoot, atlasRootRecoverable, worlds.length)` so users see "Use the welcome panel to recover/set up your atlas folder" when that's the actual next step.
- **W3 follow-up — Make-Online modal pre-validates email + PIN**: the modal previously let `createApiWorld({name, email, pin})` throw "Email is required" after the submit button changed to "Creating…". Now the submit handler validates all three required fields up front, focuses the first empty one, and bails before any server call. Matches the discipline already in `new-api-world-modal.ts`.
- **W6 follow-up — camera state migrated on map id-swap**: the saved camera state is keyed by `mapId`. When a map is id-swapped server-side (Make-Online assigns v7 IDs), the save remained under the pre-swap v4 id. After page refresh, the lookup used the post-swap v7 id and missed. `handleIdSwap` in `sync-attach.ts` now migrates camera state in lock-step with the rightTabs + selectedElementId + URL migration that was already there. Dynamic import to avoid a top-level dep cycle.
- **W6 round 2 — fitToCanvas at end of mount was overwriting restore**: Captain reported "zooms to old state, then zooms out" — diagnostic: a `manager.fitToCanvas(20)` call at the END of `entry.ready` (added session 218→219 to fix half-screen-on-refresh) was running AFTER my W6 setView restore, blowing it away. Gated the fit-to-canvas behind `!savedAtMount` so it only runs when no saved view exists. `invalidateSize` still runs unconditionally to force a Leaflet re-measure of the container without changing the view.

553/553 still green.

---

## Session 221 follow-up (2026-05-18) — `atlas_shape` leak fix

After Bout 1 shipped the marker-FK detection + server-delete routing path, Captain re-tested with a fresh world: same FK error still firing. Re-investigation surfaced the **actual** root cause: `atlas_shape` was being sent to real OW on zone CREATEs, which rejects unknown fields with 400. Zone push failed silently → markers then FK-failed against the absent server zone.

The B1 fix (FK detection + routing) still has value as a safety net for the previously-synced-then-deleted-peer scenario, but Captain's smoke was actually the "zone push silently rejected" class. Two follow-ups:

1. **Added `atlas_shape` to `ATLAS_LOCAL_EXTENSION_FIELDS`** in `src/core/constants.ts`. Both the write-strip path (`toWireShape`) and the pull-preserve path (`applyServerRecord`) now handle it. Symmetric with the existing atlas_color / atlas_opacity / atlas_label_visible / image_media_id treatment.
2. **Strict-field validation in fakes** (`statefulOwHandlers` + `FakeOwApiClient`). Both now 400 on atlas-local fields in write bodies. Tests pre-empt the "fakes silently accept unknown fields" gap that hid this bug. Pattern matches the existing `rejectDoubleSuffix` discipline (Convention #20 — encode real-OW validation in fakes).

+4 regression tests in `tests/integration/ow-client-adapter.atlasLocal.test.ts`. Total: 553 vitest green.

This is the same lesson SYNC_NOTES already captured under "Encode real-server validation rules in fakes BEFORE fixing the caller" — applied again, but in reverse: the caller was already buggy in production, fakes get the rule retroactively so it can't regress.

---

## Session 221 (2026-05-18) — Validation, strengthening, fix-it bouts

**Headline**: Five-bout pass to verify and shore up everything that had accreted concerns since session 219+220. 546/546 vitest green (+14 new tests across the bouts). Bundle 488 KB JS / 137 KB gzipped. Live marker FK push bug surfaced AND wired through to the existing server-delete review modal. No new features beyond the work list.

### Bout 1 — Live bugs

- **Marker FK push fail** (live, from Captain smoke): real OW returns 500 MySQL 1452 when a marker references a zone the server deleted out-of-band. Pre-existing topo-sort handles in-batch FK ordering but can't help when the peer has `server_updated_at` and is therefore already "synced" locally. Added `parseFkConstraintError(err)` + a CREATE-catch branch in `pushPhase`: detect the error, look up the orphan peer locally, route to `server_deletes` review. User clicks `keep + re-push` → peer re-CREATEs next round → marker succeeds. Conventions land via 3 regression tests in `tests/integration/sync-engine.fkConstraint.test.ts`.
- **F hotkey wrong fit semantics**: was calling `manager.fitBounds(40)` which fits to visible pins (silent no-op with 0 pins, max-zoom with 1). Changed to `manager.fitToCanvas()` to match the toolbar button.
- **Pin badge appears on all pins**: `getAssociatedMaps()` returns the maps an element appears on via pins, which is always ≥1 if we're rendering a pin of it. Wrong semantic for the badge — should mean "this element has a sub-map." Added `hasLinkedSubMap(elementId, elements)` helper (only true for Locations with `map.location === el.id`) and updated all 3 pin-render sites.
- **"Engine not ready" toast on pill click without PIN**: now detects the api-linked-no-PIN case specifically and emits "Enter your PIN in settings to enable sync" + deep-links to `settings/identity`.

### Bout 2 — Small UX

- **Visual settings popover persists across map switch**: added `retargetVisualSettingsPopover(entry)` so the popover keeps its open state and re-renders with the new map's prefs on tab switch. Closes automatically when leaving any map context (map-index tab).
- **Map view preserve on reload/switch**: new `src/core/map-camera-persist.ts` (~85 LOC + 8 unit tests). Saves `{center, zoom}` per mapId on every settled `moveend`. Restores in `applyLivePrefs` mount path; falls back to fit-to-image when no saved view exists. Cleared when a map is deleted.
- **Pin tooltip categories capitalized**: `map-tab-tooltip.ts` runs supertype/subtype/type through a tiny `sentenceCase` helper.
- **Shift+Enter saves in inline-multi field-edit**: `field-edit-inline.ts` accepts `Shift+Enter` as a save trigger alongside Ctrl/Cmd+Enter. Plain Enter still inserts a newline.
- **Recover/setup-atlas sidebar buttons → compound icon style**: replaced `atlas-btn-ghost` text buttons with `atlas-create-icon-btn` housing single Material Symbols glyphs (`restart_alt` for recover, `create_new_folder` for setup). Visual coherence with the rest of the sidebar header.

### Bout 3 — Soft-edges

- **F1: pinPlacement id-swap migration**: `handleIdSwap` now migrates `ui.pinPlacement.elementId` alongside `selectedElementId` and rightTabs[].mapId. +2 regression tests.
- **F2: stale conflicts cleared on policy flip**: settings-panel detects `pause-and-review → local-wins` transition and writes `sync-state.conflicts: []` so the badge doesn't lie.
- **F3: pill click toast gated on push+pull deltas**: when `pullNowAndRefresh` returns a push-shaped result (in-flight dedup race), "Already up to date" no longer fires if `pushed.*` moved records.
- **F4: modal worldId capture**: `ConflictReviewModal` and `ServerDeleteReviewModal` capture `worldId` at open and validate on each resolve action; bail with an info toast if user switched mid-modal.
- **F5: user edit during pull race**: `pullPhase` re-reads each element via `getElement` just before `applyServerRecord` and skips the overwrite if `local_updated_at` advanced; next pull picks it up cleanly.
- **F7: snapshot recovery per-world**: zone-edit snapshots migrated from a single-slot key (`atlas_zone_edit_snapshot_v1`) to a per-world map (`atlas_zone_edit_snapshot_v2`). Legacy v1 entries migrate automatically on first read. Each world's activation picks up its own pending snapshot independently — switching worlds no longer destroys an in-flight edit elsewhere.
- **P4: pagination beyond 200/page**: `OwClientAdapter.listElements` now walks DRF pages by `?offset=N` until `count` is reached. Safety cap at 100 pages (20,000 elements per type). When the cap is hit, the type stays flagged paginated (server-delete detection skipped). MSW gained a `paginate: { type: pageSize }` option for tests. +1 regression test.

### Bout 4 — Polish UX

- **F9: stronger unlink-from-API confirmation**: the confirm dialog now spells out the consequences (element count, sync stops, sync history cleared, server world untouched, reversibility).
- **P2: "Synced X ago" prominent on pill**: `mapEngineStateToPill` renders relative time inline (just now / Ns / Nm / Nh / date). A module-level 30s interval re-renders the pill so the timestamp ages naturally without state churn.
- **P1: per-type refresh via right-click filter chip**: right-click on a filter-strip chip in the elements sidebar fires a pull and toasts a type-scoped result. Engine still pulls globally; framing is by user intent.
- **P3: auto-pulled element flash**: `SyncResult.pulled_ids` carries the ids `pullPhase` actually applied to local. `sync-attach.emitConflictToasts` dispatches `atlas:pulled-ids` CustomEvent; the elements-sidebar listens and adds `data-flash="true"` to matching rows for ~1.4s. CSS adds a brief cyan ring with `atlas-row-pulled-flash` animation. Decoupling via CustomEvent keeps sync-attach from importing UI modules.

### Bout 5 — Stale state + docs cleanup

- **Stale TBD comments**: `map-view-prefs.ts` zone_labels:hover and `map-visual-settings-popover.ts` pin_style consumers — both wired in session 219 but comments still claimed TBD. Updated to reflect actual state.
- **Cosmetic log cleanup**: `sync-attach.ts` default policy fallback was logging `'drain-blind'` (legacy name) when the registry had no policy set. Replaced with `'local-wins'` (current name) in both the doc-comment and the log line. The migration code in `registry.ts` that converts legacy values stays.
- **Bundle audit recon**: 488 KB JS / 137 KB gzipped is healthy. Leaflet (~150 KB) and SDK (~70 KB tree-shaken) are the heavyweights. No quick wins.
- **PROGRESS doc cleanup**: drop-list explicitly captured in CURRENT STATE so it doesn't ghost-haunt the backlog.

### Files touched (high level)

- New: `src/core/map-camera-persist.ts`, `tests/unit/map-camera-persist.test.ts`, `tests/integration/sync-engine.fkConstraint.test.ts`.
- Modified (sync): `src/sync/sync-engine.ts` (+FK parser, +pulled_ids tracking, +pull race guard, +pagination loop), `src/sync/ow-client-adapter.ts` (pagination walk), `src/sync/sync-attach.ts` (pinPlacement migration, default policy log, pulled-ids CustomEvent dispatch).
- Modified (UI): `src/tabs/right/right-pane.ts` (pill toast gating, sync engine no-PIN guidance, retarget popover, relative-time pill, syncPillTicker), `src/tabs/right/map-tab.ts` (F hotkey → fitToCanvas, camera persist mount), `src/tabs/right/map-visual-settings-popover.ts` (retargetVisualSettingsPopover), `src/tabs/right/map-tab-pins.ts` + `auto-open-map.ts` + `map-tab-tooltip.ts` (badge logic + capitalization), `src/sidebar/elements-sidebar.ts` (right-click refresh, atlas:pulled-ids listener), `src/sidebar/worlds-sidebar.ts` (recover/setup compound icons), `src/ui/conflict-review-modal.ts` + `src/ui/server-delete-modal.ts` (worldId capture), `src/ui/field-edit-inline.ts` (Shift+Enter), `src/middle/settings-panel.ts` (stronger unlink + clear-conflicts on policy flip).
- Modified (state/store): `src/core/types.ts` (+pulled_ids), `src/core/constants.ts` (+MAP_CAMERA_STATE_KEY), `src/tabs/right/zone-edit-mode.ts` (per-world snapshot store + v1 migration), `src/tabs/right/map-index-tab.ts` (clearCameraState on delete).
- Tests: 14 new tests across FK constraint (3), camera persist (8), pinPlacement migration (2), pagination (1).

### Pokeable for next smoke

1. **Marker FK fix**: trigger the original error condition — delete a zone server-side, draw new markers locally referencing it, push. Expect: server-delete modal opens for the zone with `keep + re-push` / `delete locally` choices. `keep + re-push` should make markers succeed on the subsequent round.
2. **F hotkey**: focus the map canvas, press F. View fits to the image. Repeat — idempotent.
3. **Pin badge**: pin a Character (or any non-Location) on a map. Pin renders without the map-corner glyph. Pin a Location that HAS a sub-map. Pin renders WITH the glyph.
4. **No-PIN pill click**: api-linked world without PIN set; click the pill. Toast says "Enter your PIN in settings to enable sync" and lands on the identity tab.
5. **Visual popover persistence**: open the visual settings popover on map A, click map B's tab. Popover stays open, shows map B's prefs.
6. **Map view preserve**: pan + zoom map A, reload page. Map reopens at the same view.
7. **Sync pill timestamp**: pill reads "Synced just now" right after a pull; "Synced 3m ago" three minutes later (timestamp ticks every 30s).
8. **Right-click filter chip**: right-click on the Character icon in the sidebar filter strip; pull fires, toast scoped to "Characters" (or the equivalent type).
9. **Auto-pull flash**: cause a pull to apply a remote change; the affected element row briefly glows cyan.
10. **Unlink confirmation**: settings → world → unlink. Confirm dialog shows element count + spelled-out consequences.
11. **Snapshot recovery**: enter zone-edit on world A, refresh mid-edit, choose Cancel from the next session — revert applies. Repeat with world B for an independent edit; world A's snapshot survives across world B's edit.
12. **Pagination**: worlds with >200 of any type now download all pages on link/refresh (verify against your largest type — could be Events or Locations).

### Process notes

- The five-bout structure (live bugs → small UX → soft-edges → polish UX → cleanup) held all session. Each bout had tests run between items; full vitest at end of each bout.
- The fakes-mirror-real discipline kept working: the FK test needed only the MSW handler's verbatim 1452 message + an existing `__inject_failure` to trigger the regression test.
- CustomEvent decoupling for `atlas:pulled-ids` (P3) mirrors the existing `atlas:save-request` pattern from hotkeys — modules emit, UI listens, no cross-layer imports.
- Camera persist + visual settings popover retarget are both keyed on the map-tab cache entry; the persistence and the popover both live in the right-pane subsystem so they evolve together.

---

## Session 220 (2026-05-17) — Tuneup pass: slug-prefix, hotkeys, scrub, e2e fixes

**Headline**: Cross-cutting cleanup session. 532/532 vitest, 93/93 Playwright e2e all green. Bundle 481.29 KB JS / 135.07 KB gzipped. Significant doc + CSS hygiene.

### Slug-prefix element filenames

`<slug>--<uuid>.json` on disk for browsability. Single helper centralizes filename composition in `fs-utils.ts`; FsFolderStore gained a lazy-populated `fileIndex` cache (`id → {type, filename}`) so reads stay O(1) after warm-up. Double-hyphen separator unambiguous regardless of id shape (UUIDs OR test-fixture short ids like `char-1`). Rename-on-save in `writeElementAndRename` writes new file first then deletes old; crash window covered by `ensureIndexFor` dedupe (latest `local_updated_at` wins, losers removed on next open). Server-side rename via `applyServerRecord` flows through the same path so pulls renaming an element also rename the file. No legacy fallback (no data to preserve — fresh format only). 21 unit tests + 7 e2e tests; all 12 existing FS folder-store e2e tests still pass.

### Hotkeys MVP

New `src/core/hotkeys.ts` dispatcher with declarative binding table + context-aware predicates. Cross-platform (`mod` = Cmd on Mac, Ctrl elsewhere). Save-request decoupling via `atlas:save-request` CustomEvent — editors register a listener while open, dispatcher doesn't import editor modules. Bindings:
- `Ctrl/Cmd+E` — new element (gated on active world, disabled in modal/text-input)
- `Ctrl/Cmd+S` — save active editor (popover/inline name — both listen for save-request)
- `Ctrl/Cmd+K` — focus elements search (auto-flips sidebar to elements mode)
- `?` — open reference modal (disabled in text input so it doesn't hijack typing)

Map-tab single-letter hotkeys (F/Z/L) wired in map-tab.ts keydown listener (scoped to the canvas container, not global — bare letters don't hijack typing). F fits bounds, Z toggles polygon draw, L toggles line draw.

### Shortcuts reference unified

`src/ui/shortcuts-content.ts` produces a single DOM tree used by BOTH the sidebar footer `?` icon popover AND the `?` keyboard reference modal. Auto-generates the keyboard section from `getInstalledBindings()` so adding to the dispatcher table surfaces it for free; merges with hardcoded gestures (Esc, Enter, Shift+click, right-click variants, drag-to-trash). Old "More shortcuts coming next session" footer dropped. Old `.atlas-hotkey-*` CSS (duplicate of `.atlas-shortcuts-*`) purged.

### Lowercase-everywhere → sentence case

Agent-driven scrub: 28 source files, ~250 user-visible strings touched. Acronyms preserved (API, PIN, ID, URL, JSON, UI, OnlyWorlds, Chrome, Atlas as product name, etc.). 7 `text-transform: lowercase;` CSS rules removed. The genesis-era "lowercase everywhere" convention is gone — standard sentence case is now the default.

### Banned legacy classes + dead CSS purge

New `tests/unit/legacy-classes-banned.test.ts` scans `src/**/*.{ts,css,html}` for `ow-input`, `ow-btn`, `ow-btn-primary`, `ow-btn-secondary`, `ow-btn-ghost` and fails the suite if any reintroduce. No new tooling — runs in the existing vitest run. Dead `.atlas-shell .ow-input/textarea/select` overrides + the unused `.ow-btn*` family deleted from atlas.css; -1.1 KB CSS.

### Polish fixes

- **Link-field pick icon always right-anchored**: dropped left-alignment for empty rows; muted opacity marks empty state without moving the affordance.
- **Text-selection double-gate**: existing mouseup discriminator was missing some asymmetric drag cases; added a click-time check that bails when ANY non-empty selection touches `valueEl`.

### Playwright stale-test fixes (14 → 0)

Three classes of pre-existing bit-rot, all resolved:
1. **Stale `data-action="create"` selectors** (phase5-maps): map-create-modal uses `data-action="submit"` (vs `create` in other create modals). Tests updated.
2. **`.atlas-middle-header h2` world-name expectations** (phase2-ui, phase4-elements): post-activation routes to timeline, not welcome — the world name lives in the sidebar mode toggle's right-tab label. Assertions updated to `[data-action="mode-elements"] .atlas-mode-btn-label`.
3. **`open-timeline` button missing post-activation** (phase6-polish): button only ever rendered on welcome panel. After world creation middle is already timeline. Tests rewritten to assert directly.
4. **Sentence-case scrub fallout**: a handful of `toContainText('lowercase')` assertions broke when the underlying strings became "Sentence case". Converted to case-insensitive regex (`/.../i`).

### Console.info noise demotion

- `auto-pull-scheduler` tick "skipping" logs (no engine / hidden / busy / paused) → `console.debug`. Tick "firing pullNow" stays at info.
- `applyServerRecord` post-write readback OK → `console.debug`. The DIFFERS branch stays at warn.

### Docs hygiene

Four transitional Phase 3 → Phase 3.5 → smoke docs moved to `docs-archive/`: `BOUT_I_SMOKE.md`, `BOUT_R_NEXT.md`, `BOUT_R_SMOKE.md`, `PHASE3.5_BRIEF.md`. Archive README documents what each was for. Atlas root is now: `DESIGN.md`, `DESIGN_MAPS.md`, `DESIGN_ZONES.md`, `PROGRESS.md`, `PORTED.md`, `SYNC_NOTES.md`, `README.md` — current, load-bearing only.

### Files touched (high level)

- New: `src/core/hotkeys.ts`, `src/ui/hotkey-reference-modal.ts`, `src/ui/shortcuts-content.ts`, 4 test files (slug unit + e2e, hotkeys unit, legacy-class ban)
- Modified: `src/store/fs-utils.ts`, `folder-store-fs.ts`, `app.ts`, `field-edit-popover.ts`, `element-detail.ts`, `sidebar.ts`, `tabs/right/map-tab.ts`, ~25 user-visible TS files (scrub), `styles/atlas.css`, `sync/auto-pull-scheduler.ts`
- Test files updated: phase2-ui, phase3-make-online, phase4-elements, phase5-maps, phase6-polish, make-online integration

### Conventions added

28. **Slug-prefix on-disk filenames** (`<slug>--<uuid>.json`) — `--` separator unambiguous because slugify collapses non-alphanumeric runs to a single `-`. Rename happens on element-name change; crash-dedupe in `ensureIndexFor`. File index is in-memory only.

29. **Hotkey actions never import editor modules** — save-request fires a `atlas:save-request` CustomEvent; editors that have a save handler register a document-level listener while open and remove on close. Lets any future editor opt in with one line, no central registry to maintain.

30. **Sentence case for user-visible strings, acronyms preserved** — the genesis-era lowercase convention is replaced. New code adds `Capital first letter`, leaves `API` / `ID` / `URL` / `PIN` / `JSON` / `UI` / `OnlyWorlds` etc. alone. `humanizeFieldName` already handles labels via the ACRONYMS set; new prose should match the same shape manually.

### Pokeable for next smoke

1. Slug-prefix: create element named "Alice" → check disk file is `alice--<uuid>.json` (case-folded). Rename to "Aliyah" → file becomes `aliyah--<uuid>.json`, old gone.
2. Hotkeys: `Ctrl/Cmd+E` opens element create (when a world is active). `?` opens reference modal. `Ctrl/Cmd+K` focuses search. `Ctrl/Cmd+S` saves an open field popover or inline name input.
3. Sidebar `?` icon popover: lists Global / Sidebar / Editor / Map / Mouse sections, no "coming next session" footer.
4. Map-tab keys: focus the canvas, press F (fits to image), Z (start polygon draw / cancel), L (start line draw / cancel).
5. Text selection in any field value (LTR or RTL drag): popover does NOT open, your highlight survives.
6. Link-field pick icon: appears anchored right on empty link rows too (muted color).
7. Modal text everywhere: sentence case, acronyms ALL-CAPS, no lowercase-forcing CSS.

### Known not-yet-shipped

- Pin STYLE variants (V1.5 STYLE) — needs visual specs. (Still standing from session 218.)
- Snap-to-existing-vertex during draw/edit — polish. (Still standing.)
- A11y keyboard-only walkthrough through major modals — Captain explicitly deferred.
- Map view preserve on reload — not addressed this session.
- Visual settings popover wiring audit (pin shape, pin color, zone opacity, zone labels live-respond) — still standing from session 218 inventory.
- Make-online modal walkthrough — 5 visual items Captain flagged in session 219 modal audit; he confirmed they look fine.
- `Ctrl/Cmd+Backspace` (delete element), Tab nav in modals, conflict-modal hotkeys — full kit from hotkeys proposal still has these deferred.

### Process notes

- The lowercase scrub ran in parallel with Playwright e2e fixes — initially caused detached-element errors because vite HMR was firing during test runs. Lesson: file-edit agents and e2e tests don't mix unless the dev server is paused. Sequenced the work (agent first, then e2e) to get clean signal.
- Used a vitest-based "ban list" test instead of pulling eslint into the project. Saves a dep + works in the existing CI surface. Convention worth carrying — any "never reintroduce this string" check fits the same pattern.

---

## Session 219 (2026-05-17) — Polish wave: 18 commits, 6 smoke waves

**Headline**: Captain dropped a 17-item polish list before going out for the day. 8 autonomous bouts (A-H) then 6 waves of iterative smoke fixes when he returned. 478 tests green every commit. Atlas significantly tighter on zone editing, pin styling, modal consistency, and a handful of small bug surfaces.

### Autonomous bouts (A-H, before Captain returned)

Mechanical fixes: refresh-fit (zoom-to-image on reload), grid spacing (5→10→25→50→100 multi-step), zone opacity + zone label rendering, save-as-default rule (does NOT propagate to maps with per-map overrides), link icon always-shown, cursor saga round 3 closed (compound selectors — `.atlas-map-canvas-container .leaflet-grab` is descendant not compound; SAME element needs the chain form), pin style + tint full wiring, text-selection bug fix + 3-mode field-edit setting, visual settings popover docked at midpanel right edge via fixed positioning + ResizeObserver, modal audit + `ow-` → `atlas-` class unification across all 10 modals, compound icon buttons for `+ new X` actions, three deliverable design docs (slug-prefix brief, hotkeys proposal, modals audit).

### Smoke-driven waves (1-6, after Captain returned)

**Wave 1 — `dashArray` canvas renderer fix**: Leaflet's `L.canvas()` default renderer doesn't reliably stroke dashed polygons. Forced `L.svg()` explicitly for the zone-create-mode preview. The new SVG renderer is exported as `getZoneSvgRendererForMap(map)` so segment overlays + edit-mode handles can share the same SVG context (critical for the wave 5/6 bringToFront fix).

**Wave 2 — Zone edit data integrity**: Three coupled fixes. (a) Right-click during zone-edit no longer triggers the map context-menu (added `L.DomEvent.stopPropagation`). (b) Dragend race guard — if a marker drag's commit fires after the engine has exited edit mode, the commit no-ops cleanly. (c) Edit-mode autosave + refresh-revert: enter edit → snapshot persisted to localStorage; recovery sweep on world activation replays the 3-way diff revert if the user reloaded mid-edit.

**Wave 3 — Pin shape iconAnchor + `?` shortcuts popover + zone hover-labels + (default) pill**: Pin variants (icon / round-icon / pin-shape) finally render correctly per the iconAnchor math. Help button + popover in the sidebar footer. Zone label-visible "hover" mode wired (fade in on canvas hover). "(default)" pill marker on settings rows whose value matches the global default.

**Wave 4 — Edit-mode snappiness via rAF batching + optimistic insert**: Drag handlers fire on every mousemove; non-trivial work in the handler delays the next paint. Refactor: handler sets a dirty flag (O(1)) and schedules rAF idempotently. rAF callback reads positions + applies updates. Marker's CSS transform commits to paint immediately; the live SVG path catches up one frame later (invisible at 60Hz). Marker insertion is now optimistic — mint client UUID, patch state synchronously, run FS writes in background, revert via re-prime on failure. UI snaps instantly.

**Wave 5 — Drag lerp single CSS line fix**: After waves of rAF batching, the marker STILL trailed cursor. Root cause: a single CSS line — `transition: ... transform 120ms ease` on `.atlas-zone-edit-handle`. Leaflet's L.Draggable sets `transform: translate3d(...)` on every mousemove; the transition was animating each translate over 120ms. Marker was literally lerping. The fix was one CSS-line deletion. Empirical inspection > cascade reasoning.

**Wave 6 — Cross-renderer hit testing**: `bringToFront()` only reorders within a single renderer's DOM element. Segments used the default canvas renderer while the zone polygon used a forced SVG renderer (from wave 1). Two different DOM elements in `overlayPane` → bringToFront couldn't move across them. Solution: export ZoneOverlay's renderer, reuse for segments, now they share one `<svg>`.

### Files touched

Many. The big-ticket ones: `src/styles/atlas.css` (~25 places — popover docking, pin/zone styling, transitions), `src/middle/element-detail.ts` (inline-name editor, text-selection gates, field-edit-mode setting consumer), `src/middle/settings-panel.ts` (Editing tab, "default" pills, audit tab content), `src/tabs/right/map-tab.ts` + `map-tab-zones.ts` + `zone-edit-mode.ts` + `zone-drawing.ts` (most of the wave fixes), `src/ui/map-visual-settings-popover.ts` (docking), `src/ui/zone-create-modal.ts` (shape badge + cleaner inputs), `src/sidebar/sidebar.ts` (footer help button), modal audit touched every modal file (legacy class purge).

### Pokeable for next smoke

(Already smoked live by Captain during this session — all 17 items verified working.)

### Process notes

- Four CSS/Leaflet "reasoning surprise" finds across the session — promoted to craft.md as a category. The pattern: my reasoning about cascade / hit-testing / draggable internals was technically correct but missed the actual mechanism. Empirical inspection (DOM, computed styles, where renderer paths live) would have caught each one in two minutes. When CSS or Leaflet behavior surprises, FIRST move = inspect, not reason.
- Per-bout commits paid off in waves 5-6 specifically: the bringToFront-only attempt didn't work, but it was a discrete commit; rolling it back would have been messier if bundled.
- `optimisticInsertMarker` is a generalizable pattern for FS-Access-backed apps where writes are slow but UI should feel instant. Mint id, patch state sync, write background, revert on failure via re-prime.

---

## Session 218 (2026-05-17) — Zone smoke batch (ZD1-ZD6)

**Headline**: Captain's smoke after session 217. Six fixes/refactors. 477/477 vitest still green, typecheck + build clean. Bundle 460.52 → 460.90 KB JS (negligible) / CSS 78.30 → 78.18 KB.

### Smoke fixes

**ZD1 — Cursor override didn't take.** ZC5 added `.atlas-map-canvas-container .leaflet-grab { cursor: default }` (2-class, should beat leaflet's 1-class). Captain still saw the open-hand cursor. Root cause: leaflet ships vendor-prefixed `-webkit-grab` declarations alongside `grab` and the cascade resolves them per-declaration — overriding only the bare `cursor: default` lost on platforms where the `-webkit-grab` line still applied. Fix: `!important` on both the default + dragging state, covering `.leaflet-container` and `.leaflet-grab`. Grabbing during actual pan preserved via `.leaflet-dragging`.

**ZD2 — Dropdown chip × → delete icon + visual sync after delete.** Two fixes:
- Glyph swap: `close` → `delete` on the chip's per-row × button, matching elements-sidebar trash affordance.
- Bug: deleting a zone from the dropdown left the polygon on canvas until page reload. Cause: `syncZones` iterated state.data.elements.zones to decide what to remove from the overlay — but a just-deleted zone isn't IN that list, so the loop never visited its id. Fix: added `ZoneOverlay.getZoneIds()` accessor; syncZones now iterates the OVERLAY's known ids and drops anything not in the present-on-this-map set.

**ZD3 — Draft overlay layout (Captain's sshot fix).** The hint and keys clusters were wrapping into vertical stacks ("hold shift to snap to 45° axis" broke into 5 lines). Added `white-space: nowrap` + `flex-shrink: 0` to both clusters and to the mode/count labels. Replaced fixed-width spacer with `flex: 1 1 auto` so unused space pushes the buttons right cleanly.

### Medium

**ZD4 — Live polygon outline in edit mode.** ZC7's named-and-skipped tradeoff. Vertex drag + centroid drag now update the polygon outline live, not just on dragend. Mechanism: new `ZoneOverlay.setZonePointsLive(id, points)` uses Leaflet's `setLatLngs` to mutate the existing SVG path in-place (no rebuild). Each drag frame: read every vertex handle's CURRENT latlng (`collectLivePointsFromHandles` helper), convert to storage coords, push to the overlay. Cheap enough to fire per-frame; hit-overlay (lines) gets the same update so click targets stay accurate during drag.

**ZD5 — Auto-insert in create mode.** Ports edit-mode's segment-insert into the create-mode click flow. When drafting and clicking near an existing segment (`findClosestSegment` with `CREATE_INSERT_THRESHOLD = 20` storage-space units), the new marker splices into the points array between the segment's endpoints instead of appending to the end. Polygons include the wrap segment (last→first) once 3+ markers exist. Shape-preservation: realizing mid-draw that you need a marker between earlier ones is now a single click instead of "undo all → re-place."

### Refactor

**ZD6 — Shape storage decoupled from supertype + modal cleanup.** Captain: the create modal's polygon/line radio felt messy; supertype and subtype should be free user-text fields (their OW canon role). Atlas had been misusing `Zone.supertype` to store 'polygon'/'line', conflating shape with taxonomy.

Refactor:
- New local-only field `atlas_shape: 'polygon' | 'line'` (extension, never synced — but on disk so it survives reload).
- New helper `getZoneShape(zone)` in zone-derived.ts: reads `atlas_shape` first, falls back to legacy `supertype === 'polygon' | 'line'` for pre-ZD6 zones. Defaults to 'polygon' for anything else.
- All 6 read sites refactored to use `getZoneShape` (map-tab-zones × 2, zone-edit-mode × 3, zone-drawing × 1 was inside the now-removed re-check block).
- Modal rewritten: dropped the shape radio entirely, added a read-only shape badge at top ("polygon" or "line" pill, locked from draft mode). Replaced with two free-text inputs: supertype + subtype, both optional.
- `finishDrawing` writes `atlas_shape: draft.mode` on createZone; supertype + subtype come from user input.
- Legacy zones with shape in supertype keep rendering correctly via the fallback — no migration script needed.

### Files touched

- `src/styles/atlas.css` — cursor !important override, chip delete glyph (no CSS change for that), draft overlay nowrap, shape badge styling, dropped shape-radio rules
- `src/tabs/right/map-tab-zones.ts` — chip glyph, getZoneShape for tree-build, fix syncZones remove loop
- `src/tabs/right/zone-edit-mode.ts` — live outline via setZonePointsLive in vertex + centroid drag, getZoneShape for isPolygon checks, `collectLivePointsFromHandles` helper
- `src/tabs/right/zone-drawing.ts` — create-mode auto-insert (ZD5), modal call signature update, writes atlas_shape on create
- `src/tabs/right/zone-derived.ts` — `getZoneShape` helper + `ZoneShape` type
- `src/visualization/leaflet-2d/ZoneOverlay.ts` — `getZoneIds`, `setZonePointsLive`
- `src/ui/zone-create-modal.ts` — rewritten: shape badge + supertype/subtype text fields

### Pokeable for next smoke

1. **Cursor**: default arrow over map, grabbing only during active pan. (ZD1)
2. **Dropdown**: delete a zone via the chip × → polygon disappears from canvas immediately (no reload). Icon is `delete`, not `close`. (ZD2)
3. **Draft widget**: hint + keys clusters stay single-line. (ZD3)
4. **Edit mode**: drag a vertex → polygon outline follows live. Drag the centroid → outline follows live too. Release → outline + handles snap to committed positions. (ZD4)
5. **Create mode**: draft a polygon with 4-5 markers. Click near an existing edge (within ~20 storage units) → marker inserts between, polygon stays tidy. Click far from any edge → appends to end (old behavior). (ZD5)
6. **Modal**: after Finish, modal shows shape badge (read-only "polygon" or "line"), name (selected), supertype (text), subtype (text). No more polygon/line radio. Supertype + subtype get saved to the zone as user-meaningful taxonomy. (ZD6)
7. **Legacy zones**: pre-ZD6 zones (where supertype = 'polygon' or 'line') still render correctly via fallback. New zones store shape in atlas_shape; supertype is whatever the user wrote.

### Not done from list

Nothing — all 6 items shipped.

### Process notes

- `getZoneShape` fallback means we don't need a migration. Old zones keep working; new zones use the cleaner separation. Captain can leave existing zones as-is or manually clear their supertype (re-purpose for taxonomy text) without breaking the canvas.
- One typecheck run segfaulted (node bug, not code) — re-ran clean.

---

## Session 217 (2026-05-17) — Zone create/edit batch (ZC1-ZC10)

**Headline**: Captain's second smoke batch on the zone subsystem — 10 tweaks knocked off in one chat. 477/477 vitest green, typecheck + build clean. Bundle 450.51 → 460.52 KB JS (+10 KB) / CSS 75.27 → 78.30 KB (+3 KB). No commits — Captain pushes when ready. Supersedes B3 from session 216 (auto-rename in element-detail) with a proper modal flow (ZC10).

### Quick wins

**ZC1 — Enter confirms zone create.** Bug. ensureKeyListeners had Escape but no Enter handler. Wired Enter→finishDrawing; added a guard so Enter/Escape don't hijack input typing (the inline name editor + future modal inputs). Shift handling moved above the input guard so modifier tracking works regardless of focus.

**ZC4 — Vertex number labels only in edit mode.** Read-only vertex dots (showVertexDots in ZoneOverlay) used to render a 1-indexed order number. Captain: visual noise outside edit. Dropped the inner span entirely; dots are now plain 10×10 cyan circles. Numbers stay in edit-mode handles (16×16) + draft markers (18×18) where order matters operationally.

**ZC5 — Default arrow cursor over canvas.** Leaflet's default `.leaflet-grab { cursor: grab }` over-promised pan. New override: `.atlas-map-canvas-container .leaflet-grab { cursor: default }`. Special states (`.atlas-placing` crosshair, `.atlas-zone-editing` crosshair, `.leaflet-dragging` grabbing) still win via their own selectors. Pin/zone hover pointers unchanged.

**ZC6 — Dashed polygon outline in edit mode.** New `setZoneEditing(id, editing)` method on ZoneOverlay flips the outline to `dashArray: '5, 5'` matching the create-mode preview. Wired from zone-edit-mode enterEditMode / exitEditMode. Visual continuity: dashed = mutable.

**ZC3 — Shift-snap diagnose + clarify.** Snap math (snapToAxis) was correct. Captain couldn't tell shift was registering. Three fixes: (1) shift state tracked regardless of focus (modifier, not command); (2) draft overlay gains a `.shift-held` class that turns the hint cyan + bold when shift is down — live visual feedback before the click; (3) hint copy upgraded to "hold shift to snap to 45° axis" with a tooltip explaining the rectangle pattern. Also added a keyboard cluster showing Enter/Esc shortcuts.

### Medium

**ZC2 — Live polygon preview during draft marker drag.** SB3 (session 216) made draft markers draggable but only rebuilt the path on dragend. Now `drag` events also trigger `rebuildPreviewPath()` — same path render path, just swaps the L.Polygon/L.Polyline without touching marker DOM (which would abort the in-progress drag). Path layer tracked separately on the ActiveDraft as `pathLayer: L.Layer | null` for cheap remove/re-add.

**ZC8 — Click anywhere in edit mode inserts at nearest segment.** New `insertMarkerAtClick(point)` in zone-edit-mode uses the ported `findClosestSegment(pts, closed)` helper. Inserts a marker AT the click point (per Captain: "places the marker exactly there", not the projection foot), with order = segIdx + 1, renumbers subsequent. Wired into map-tab.ts's map-click handler between draft + pin-placement branches. Clicks on existing vertex handles (no listener) and segment overlays (`L.DomEvent.stop`) don't double-fire.

**ZC7 — Centroid drag handle in edit mode.** Zoner pattern ported. New `buildCentroidHandle(center, height)` renders a 22×22 cyan ring with an `open_with` glyph at the polygon centroid (`polygonCentroid`) or polyline label anchor (`polylineLabelAnchor`). Dragstart snapshots every marker's position; drag updates every vertex handle's latlng in-place for live feedback; dragend computes the delta and batches updateMarker calls. zIndexOffset: 100 so it grabs above overlapping vertices. **Tradeoff documented**: the polygon OUTLINE stays in original position during live drag (ZoneOverlay subscribes to state.data.elements, which doesn't change mid-drag). Outline snaps to the new shape on dragend commit. Future polish could call ZoneOverlay.updateZone during drag.

### Larger UX

**ZC9 — Zone chips → toolbar dropdown.** Removed the bottom-of-canvas chip strip. New right-anchored toolbar button (`zonesDropdownBtn`) with hexagon glyph + count badge + caret. Click → toggles a floating dropdown panel anchored top-right under the button. Chips render as full-width rows inside the panel (vs content-width in the old horizontal strip). Outside-click + Escape close the dropdown (wireZonesDropdown). All chip click/contextmenu/delete behavior preserved — `renderChipStrip` now also updates the toolbar button (count + visibility) and the panel renders the same chips into the same DOM element (just repurposed via CSS class swap from `.atlas-zone-chip-strip` → `.atlas-zones-dropdown-panel`).

**ZC10 — Zone create modal on Finish.** New `ZoneCreateModal` (BaseModal subclass) opens after Finish on a draft. Fields: name (auto-focused + auto-selected), shape radio (polygon | line, pre-filled from draft mode but switchable), subtype (free text, optional). Enter or "create zone" submits; Esc or "cancel" or outside-click resolves null and keeps the draft active so the user can keep editing. Submit creates the zone with the modal's values (re-validates the min-markers count if the user switched supertype), then materializes N markers as before, navigates to element-detail. **Supersedes B3 (session 216 auto-rename in element-detail)** — the modal captures intent up front. requestInlineNameEditOnNextRender helper still exists in element-detail.ts for future flows but isn't called from zone-drawing anymore.

### Files touched

- `src/tabs/right/zone-drawing.ts` — Enter handler, modifier-aware key gating, shift indicator class, live drag preview path, pathLayer tracking, modal integration on finish
- `src/tabs/right/zone-drawing-overlay.ts` — hint copy + keys cluster
- `src/tabs/right/zone-edit-mode.ts` — setZoneEditing, insertMarkerAtClick (ZC8), centroid handle (ZC7), getEditingMapId export
- `src/tabs/right/map-tab.ts` — wireZonesDropdown, edit-mode click-insert branch in map-click, import insertMarkerAtClick + getEditingMapId
- `src/tabs/right/map-tab-toolbar.ts` — zonesDropdownBtn + spacer
- `src/tabs/right/map-tab-zones.ts` — renderChipStrip syncs toolbar button + panel
- `src/visualization/leaflet-2d/ZoneOverlay.ts` — setZoneEditing, dashArray in applyStyle, vertex dots no-number
- `src/styles/atlas.css` — default cursor, dropdown panel + button, draft hint shift state + keys, centroid handle, zone-create modal radios, deprecated chip-strip selector hidden
- `src/ui/zone-create-modal.ts` — new file (ZoneCreateModal class, openZoneCreateModal helper)

### Pokeable for next smoke

See chat for the full ordered list. Key new flows:
1. Draw zone → Enter finishes (ZC1) → modal opens with name selected (ZC10) → adjust shape/subtype → create.
2. Drag a draft marker → polygon outline follows live (ZC2).
3. Hold Shift while drafting → hint goes cyan + bold (ZC3); shift-click snaps to 45° axis from last marker.
4. Select existing zone → vertex dots are plain cyan, no numbers (ZC4). Polygon outline is solid.
5. Double-click → enter edit mode → outline goes dashed (ZC6) + numbers appear on draggable handles + centroid handle (open_with glyph) appears in center.
6. Drag the centroid → all vertices follow live; release → batch commit.
7. Click anywhere on canvas in edit mode → marker inserts at the click point at the nearest segment's position (ZC8).
8. Canvas cursor is default arrow (ZC5); zone hover pointer; edit mode crosshair.
9. Bottom chip strip is gone. Look for the "Zones (N)" button on the right side of the toolbar (ZC9). Click → dropdown.

### Not done from list

Nothing — all 10 items shipped.

### Process notes

- ZC10 superseded B3 cleanly: removed the requestInlineNameEditOnNextRender call from zone-drawing but kept the export in element-detail (cheap, future-proofing).
- Type system note: @types/leaflet parameterizes Polyline/Polygon with incompatible GeoJSON generics — `pathLayer: L.Layer | null` is the practical common ancestor.
- Centroid handle outline-during-drag staleness named explicitly in code comment; not worth fixing without a clean ZoneOverlay.updateZone live-call path.

---

## Session 216 (2026-05-16) — Smoke fixes from sessions 213-215 + pile bouts B1-B5

**Headline**: Captain smoked sessions 213-215 → four bugs flagged. Fixed them, then knocked out five pile bouts in the same chat. 477/477 vitest still green, typecheck clean. Bundle 448.55 → 450.51 KB JS / CSS 74.02 → 75.27 KB. No commits — Captain pushes when ready.

### Smoke bugs (SB1-SB4)

**SB1 — Zone chip click "toggles categories, not zones."** Root cause hypothesis: the chip's `.is-selected` styling was too subtle to distinguish from `:hover`, so the user couldn't see the selection land. Compounded by `sidebarMode: 'elements'` being explicitly patched in the chip handler — redundant (the navigate already triggers `sidebar.syncModeFromRoute` to flip to elements mode), and it created a confusing "things change but the zone doesn't visibly select" moment. Fix: stronger `.is-selected` style (solid cyan border, white bold text, double-ring box-shadow); removed the redundant sidebarMode patch; added defensive `e.stopPropagation()` on the chip handler so the click is contained.

**SB2 — Edit-handle number labels render bottom-left.** Real cause: `.leaflet-marker-icon { display: block }` (from leaflet.css, loaded after atlas.css via the JS-import path) ties source-order with our `.atlas-zone-edit-handle { display: flex }` and wins. Flex centering never took effect; the span fell back to inline rendering at the top-left of the element box (visually bottom-left after the iconAnchor margin-offset). Fix: chain `.leaflet-marker-icon` into the selector for 2-class specificity. Wins cleanly without `!important` and without touching `position` (which was the S5 trap). Applies to both edit handles AND read-only vertex dots — Captain only complained about handles because they're bigger (16×16 vs 12×12) so the offset is more visible there.

**SB3 — Cannot drag markers while drafting; map drags instead.** Root cause: `.atlas-zone-draft-marker { pointer-events: none }`. Mousedown on a draft marker passes through to the leaflet canvas, which starts a pan. Fix: remove `pointer-events: none`, add `cursor: grab` for affordance, and wire `draggable: true` on the L.Marker in `rerenderPreview()`. Drag-end writes the new position back into `active.points[idx]` and re-renders the preview path. Shift-snap is intentionally placement-only (drag is for pixel-level correction).

**SB4 — Bolden draft marker number labels.** Folded into SB3's draft-marker CSS pass: 10px → 11px, font-weight 700 → 800, added a soft white text-shadow halo so the dark number stays legible over the cyan disc edge.

### Pile bouts (B1-B5)

**B1 — Pin tint + labels live wiring (V1.5 partial).** `pinVisualFor(type, hasMapBadge, tint)` extended with the third argument. Cache key includes tint so per-map tint settings coexist cheaply (no thrash on map-switch). `syncPins(entry)` reads `getEffectiveMapPrefs(entry.mapId)` once per call, passes `pin_tint` into every pin's visual. Labels: new `applyLabelVisibility(entry, mode, threshold, visiblePinCount)` toggles each pin's existing label DOM display per mode — `always` shows all, `never` hides all, `hover` hides all (the existing custom `.atlas-pin-tooltip` covers hover-time naming), `threshold` shows iff `visiblePinCount ≤ threshold`. `applyLivePrefs` now calls `syncPins` so the popover triggers immediate re-skin. **Pin STYLE deferred** — needs visual specs for the three variants (icon-only / round+icon / pin-shape) and isn't a clear win without them. Popover still persists the pref so a follow-up bout can land the consumer cleanly.

**B2 — Inline name editing on element-detail header.** Click the h2 in the header (any element type) → it swaps to an `<input>` with the current name + select-all. Enter commits, Escape reverts, blur commits. Empty rename is a no-op (won't blank out the name). Hover gives a subtle background hint + `cursor: text`. Edits go through `FolderStore.updateElement` → autosave debounce → push. Schema-driven body fields keep the popover pattern — only the header's name field is inline. Module-level `pendingAutoEditNameForId` + `requestInlineNameEditOnNextRender(id)` export gives other modules a one-shot signal to drop straight into rename mode after the next render.

**B3 — Auto-highlight name on zone create.** `zone-drawing.finishDrawing` now navigates to the new zone's element-detail route and calls `requestInlineNameEditOnNextRender(zone.id)`. The user lands on the zone with the name field already in inline-edit mode, placeholder text ("new zone" / "new line") selected — type-to-replace. Enter commits + exits, Escape reverts to the auto-name.

**B4 — Visual polish on edit handles + vertex dots.** Edit handles gain a 120ms transition + hover-scale (1.12) + brighter shadow (cyan halo widens 6→12px on hover) + active-state scale (1.18). Vertex dots gain an inner-shadow ring for depth. Both share the visual language with draft markers (cyan + numbered) but progress in size: 12 read-only → 16 edit handle → 18 draft. Draft polish from SB4 (bolder number, halo).

**B5 — DESIGN_ZONES.md cleanup pass.** §3.1, §4.3, §4.4, §4.5 reconciled with as-shipped reality:
- §3.1: edit handles are 16×16 (not 14px), numbered, and ZoneOverlay suppression is explicit.
- §4.3: vertex dots are 12×12 numbered (not 6px), share visual language with edit handles.
- §4.4: "Add marker" button removed from the spec — segment-click insertion in edit mode covers single-marker addition; standalone insert-mode was scoped out as redundant.
- §4.5: chip context menu is Rename + Delete only (Duplicate + Edit-shape entries dropped from v1); drag-to-trash is pin-only.

### Files touched

- `src/styles/atlas.css` — zone chip selected state, edit-handle specificity fix, draft marker (cursor + bolder number), edit-handle hover/active scale, inline name edit input styling
- `src/tabs/right/map-tab-zones.ts` — chip click: removed redundant sidebarMode patch, added stopPropagation
- `src/tabs/right/zone-drawing.ts` — draft markers draggable; auto-rename signal on finish
- `src/tabs/right/pin-visuals.ts` — tint resolution + cache key extension
- `src/tabs/right/map-tab-pins.ts` — syncPins reads prefs, passes tint, applies label visibility
- `src/tabs/right/map-visual-settings-popover.ts` — applyLivePrefs calls syncPins
- `src/middle/element-detail.ts` — inline name edit + auto-edit signal
- `DESIGN_ZONES.md` — drift cleanup §3.1/§4.3/§4.4/§4.5

### Pokeable for next smoke

See the curated smoke list in chat — covers the four SB fixes (chip click select, edit-handle label centering, draft marker drag, draft number weight), the B1 popover wiring (cycle tint + labels modes), B2 inline name edit (click name in any element), B3 zone create auto-name (draw zone → land in rename mode), and B4 edit handle hover-scale polish.

### Not done from pile (named-and-skipped)

- **Pin style variants** (V1.5 STYLE). Persisted but consumer pending — needs visual specs.
- **Popover label capitalization** — minor styling, skipped for time.
- **Repair existing server markers** — Captain's manual edit-drag flow per pile note.
- **Verify zoner discrepancy resolved** — Captain's smoke task.
- **ESC cancel during edit** — Captain's smoke verification (S4 shipped, unverified live).
- **Centroid drag + snap-to-vertex** — true polish, deferred.

### Process notes

- Single Playwright UI repro attempted for SB1 (zone chip click), abandoned after ~15 min of test-API bootstrapping for diminishing returns — committed to fix-by-evidence instead. Time-budget discipline from session 212 ("don't invent work") served well; same logic applied to skipping the STYLE wiring without visual specs.
- All bouts ended at typecheck-green + vitest-green seams. Final build verified clean.

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

### 2026-05-17 — Session 219: smoke-driven polish (8 bouts, autonomous)

Captain dumped a fat pile of polish/style/bug items from session 218 smoke and went out for the day. Ran 8 self-paced bouts.

- **Bout A — Mechanical wins** (6 fixes in one): always-fit-to-canvas on map mount (refresh used to zoom out too far); grid opacity 0.18 → 0.32; custom grid spacing input (widened `GridSpacing` to `number`, added 20px preset); zone fill opacity + labels wire live through `applyLivePrefs → syncZones`; `ZoneOverlay.updateZone` dynamically creates/destroys labelMarkers on labelText flip (was a no-op on already-rendered zones); `saveMapPrefsAsDefault` snapshots source map's prefs into its own override (Captain rule: "as soon as a map has ANY of its own settings, it can NOT be overwritten"); link-field pick button always shows type-specific icon (was `+` when empty, hiding category). `zone_labels` default flipped 'hover' → 'always'.
- **Bout B — Cursor saga round 3** (closed): empirical Playwright check showed `.leaflet-grab`, `.leaflet-container`, `.leaflet-dragging` are all on the SAME DOM node. The descendant selector `.atlas-map-canvas-container .leaflet-grab` (with space) NEVER matched. Compound selectors (no space) required. Cursor now `default` at rest, `grabbing` during drag. Two prior attempts (ZC5 + ZD1) failed because cascade reasoning was right but the actual mechanism was a selector mismatch — empirical inspection wins over cascade reasoning.
- **Bout C — Pin style + tint fix**: `pin_style` had been persisted since session 211 but never read. Implemented three variants in `pin-visuals.ts`: `icon` (filled disc, current), `round-icon` (translucent disc + bright ring + tint-colored glyph), `pin-shape` (teardrop with white glyph). Also fixed a tint regression: `onPinVisualsReady` callback called `pinVisualFor(type)` with default args, silently reverting tint/style every time a canvas-rendered icon arrived post-font-load. Now reads `getEffectiveMapPrefs(entry.mapId)` and passes the full prefs set.
- **Bout D — Text selection bug + 3-mode field edit setting**: (1) mousedown captures coords; mouseup checks drag distance + `window.getSelection()`; if either signals selection, the click handler bails. Text now freely selectable in both directions. (2) New `editor_settings.field_edit_mode` registry slice with three options (`modal` default, `inline-single`, `inline-multi`). New `src/ui/field-edit-inline.ts` mounts an input/textarea directly into the value cell. Blur saves; Enter (or Ctrl+Enter for multi) saves; Escape cancels. Settings UI under Atlas tab → Editing section.
- **Bout E — Visual settings popover relocation**: Captain wanted the panel off the map canvas. Popover now appends to document.body with `position: fixed`, coords computed each frame from `.atlas-middle`'s bounding rect. Docks at the right edge of the midpanel (~340px slice). ResizeObserver on `.atlas-middle` handles divider drags + sidebar mode toggles. Map remains fully visible in the right pane; popover overlays element-detail content instead.
- **Bout F — Modal audit + ow-/atlas- unification**: audited 10 modals (Notes/2026-05-17-atlas-modals-audit.md). Found `ow-input` in 3 surfaces (element picker + new-api-world-modal + settings panel) and `ow-btn` variants in 5. Replaced everything: `ow-input` → `atlas-input`; `ow-btn ow-btn-primary` → `atlas-btn-primary`; `ow-btn ow-btn-secondary` → `atlas-btn-ghost`; `ow-btn atlas-btn-X` → `atlas-btn-X` (drop redundant co-class). Convention enforced going forward.
- **Bout G — Compound icon-buttons for "+ new X"**: world sidebar header buttons `+ New local` / `+ New API` / `+ Link API` and map index `+ New map` all converted from text buttons to compound `[add][target]` glyph icons (matching the [+map]/[+pin] pattern in element-detail headers). New `.atlas-create-icon-btn` CSS class unifies the family. Tooltips on hover surface the action name.
- **Bout H — Next-session deliverables (no code)**: `Notes/2026-05-17-atlas-hotkeys-proposal.md` — full hotkeys map with global / element-detail / map-tab / sidebar contexts, MVP ship list (Ctrl/Cmd+E + Ctrl/Cmd+S + `?` ref modal). `Notes/2026-05-17-atlas-slug-prefix-brief.md` — full design + risk audit + estimate for `<slug>-<uuid>.json` filename overhaul; explicitly NOT shipped this session (read-time fallback pattern recommended, ~3.5h estimate).

After Captain returned and started testing, six follow-on waves of smoke-driven fixes:

- **Wave 1 (post-A-H)** — three issues from initial test: pin-shape glyph white-on-near-white invisible → changed to dark; edit-mode dragend flicker → ZoneOverlay.updateZone uses setLatLngs in-place for points-only changes instead of removeZone+addZone; create-mode dashed lines turned solid after marker move → root cause was Leaflet2DManager's `renderer: L.canvas()` which doesn't reliably support dashArray for polygons. Forced SVG renderer on both draft preview (zone-drawing.ts) AND published zones (ZoneOverlay.ts) via dedicated per-map renderer accessors.
- **Wave 2** — zone-edit data integrity bugs: (1) right-click during edit mode created pin AND broke edit state — now refused with toast. (2) "extra marker on vertex move" race — module-level `markDragInProgress`/`markDragEnded`/`isMidDragSuppression` guard, 150ms post-dragend suppression window catches the trailing mouseup click. (3) refresh-during-edit persisted changes — added localStorage snapshot persistence (`EDIT_SNAPSHOT_KEY`); on enter-edit, write snapshot; on exit (commit OR cancel), clear; new `recoverFromOrphanSnapshot` wired into `activateWorld` after element prime, replays 3-way diff revert with toast. Plus polish: pin-shape iconAnchor 'bottom-tip' (tip now lands on latlng instead of hovering above); ? help button in sidebar footer → keyboard shortcuts popover listing today's working gestures; zone hover-labels actually implemented via `labelHoverOnly` shape field + mouseover/out → opacity fade; "(default)" pill on radio settings (modal field-edit, local-wins policy); make-online link route polish (strong-title + em-hint layout for radios + checkbox, dropped inline style).
- **Wave 3** — pin "icon" + "round-icon" looked the same. Captain: "icon should be JUST icon, no circle around it, darker not white." Replaced filled-disc style with glyph-only (just the Material Symbol in tint color). Initial version had wide white halo + thin dark inner stroke; Captain (wave 4) corrected to wide DARK halo only.
- **Wave 3 — zone-edit snappiness**: vertex marker drag lagged behind cursor; create-mode drag was snappy by contrast. Two-part fix: (a) rAF-throttled `setZonePointsLive` via scheduleLivePointsApply — batch SVG re-projection one per animation frame. (b) optimistic marker insert — `optimisticInsertMarker` helper patches `state.data.elements` synchronously (UI snaps immediately), FS-Access store writes happen async in background, revert via re-prime-from-disk on failure. The 1s "wait for marker to appear" lag vanished. Also bumped segment hover hit zone from 20px @ opacity 0 → 32px @ opacity 0.01 for reliable cross-browser pointer events.
- **Wave 4** — drag still trailed cursor even after rAF batching. Root cause turned out to be a SINGLE CSS line: `.atlas-zone-edit-handle` had `transition: ... transform 120ms ease`. Leaflet's L.Draggable sets `transform: translate3d(...)` on every mousemove; the CSS rule lerped each translate over 120ms. Removed `transform` from the transition list. Same fix on `.atlas-zone-centroid-handle`.
- **Wave 5/6 — hover detection inside polygon**: Captain: "in zoner, hover triggers JUST INSIDE the line too; atlas only outside." First attempt bumped segment weight + bringToFront — didn't help. Real cause: segment overlays were using Leaflet's DEFAULT canvas renderer while the zone polygon used the forced SVG renderer. Canvas and SVG are DIFFERENT DOM elements in overlayPane; bringToFront can only reorder within ONE renderer. Fix: exported `getZoneSvgRendererForMap` from ZoneOverlay, reused it for segment overlays. Now both share the same `<svg>` and bringToFront() actually promotes segments above the polygon at the per-path level. Hovers from inside the polygon edge now reach the segment hit zone. Also reduced segment weight 32 → 18 per Captain's "smaller highlight visuals."

**Tests**: 478 vitest green throughout. **Typecheck + build**: clean on every commit.
**Bundle**: 473.79 KB JS / 132.33 KB gzipped (was 461.63 at session 218 start; +12KB net for all the wave fixes + new features).
**Commits**: 17 (docs + Bouts A-H + waves 1-6), all on local master, no pushes — Captain's hand.

**Three "CSS/Leaflet reasoning surprise" lessons** worth promoting to craft.md:
1. **Cursor selector mismatch** (Bout B): when CSS doesn't take despite correct cascade reasoning, FIRST check if the selector actually matches. Same DOM element + multiple classes needs compound (`.foo.bar`), not descendant (`.foo .bar`).
2. **Canvas renderer dashArray** (Wave 1): Leaflet's `L.canvas()` renderer has unreliable dashArray support, especially for polygons. Force `L.svg()` renderer explicitly when dash patterns matter.
3. **Transform transition lerp on draggables** (Wave 4): a `transition: transform` on any Leaflet-draggable element will animate every translate over the transition duration → visible lag. NEVER include transform in transitions on draggable handles.
4. **Cross-renderer hit testing** (Wave 5/6): `bringToFront()` only reorders within a single renderer's DOM element. Layers in different renderers (canvas vs svg, OR two svg instances) are siblings in their pane and ordered by DOM-insertion-order. Share renderers across related paths if you need bringToFront to work between them.

**Notes for next-chat me**: Slug-prefix overhaul is the next priority refactor (Captain flagged) — brief at `Notes/2026-05-17-atlas-slug-prefix-brief.md`, read-time-fallback pattern, ~3.5h. Hotkeys MVP next (Ctrl/Cmd+E, Ctrl/Cmd+S, enriched `?` modal) — full proposal at `Notes/2026-05-17-atlas-hotkeys-proposal.md`. Full inventory of remaining work at `Notes/2026-05-17-atlas-next-session-inventory.md`.

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

---

# Maps subsystem build history (pulled from DESIGN_MAPS.md, 2026-05-18)

Below are the bout-sequence sections that were originally in `DESIGN_MAPS.md` — operational content (what was built, when) that doesn't belong in a stable design doc. Preserved here as reference for "what shipped in which session" and as fixit context if any of the maps work needs revisiting.

## §5-deprecated. Legacy per-world plan (replaced by global tabs in session 209)

This was the planned per-world `rightTabs` snapshot/hydrate approach. Replaced by global tabs with stale-tab darkening when the active world doesn't own a tab's map. Registry helpers (`setWorldRightTabs`/`getWorldRightTabs`) remain dormant in code for possible future opt-in.

Original text:

> (Foundational fix needed before the map index UI work — see Issue C from the design conversation.)
>
> **Current state** (broken): `state.ui.rightTabs` is global. Switching worlds carries stale tab references; the right pane goes blank because `lastTabKey` short-circuits remount when the world changes but the active tab key doesn't.
>
> **Fix shape**: Make `rightTabs` and `rightActiveIndex` per-world. Persist via `WorldRegistryEntry.right_tabs?`. Restored from registry on world activation, snapshotted to registry when leaving a world. In `activateWorld`, snapshot current world's tabs before clearing; hydrate new world's. In `right-pane.ts`, when `lastWorldId !== worldId`, reset `lastTabKey = null` BEFORE the early-return check. On `mountMapTab`, if the map id doesn't exist in current `data.elements`, render a friendly empty state. Cascade-delete cleanup: scrub deleted map's id from active world's `rightTabs`.

## §10. Bout sequence M1-M8 (sessions 208-210)

Foundation work before feature work. Each bout ended at a typecheck-green, vitest-green, build-green, manually-pokeable seam.

- **Bout M1 — Schema-honesty foundation**: extended `WorldMap` interface with `hierarchy`, `parent_map`, `depth`, `background_color`. Added field-descriptions.
- **Bout M2 — Bug-fix triplet (Issues A + B + C)**: element-create map post-modal (configure-existing mode), image precedence swap (`image_url` wins), per-world tab persistence (later reverted to global, session 209), pin coord rounding.
- **Bout M3 — Tree-builder as pure function**: `buildMapTree(maps, locations)` in `tabs/right/map-tree.ts`. World A/B/C fixtures.
- **Bout M4 — Map index tree rendering**: replaced flat list with tree renderer driven by `buildMapTree`. Per-row affordances (indent, location chip, badges, delete).
- **Bout M5 — Simplified create modal**: collapsed advanced section, image-source hint dynamics, hierarchy/parent_map override.
- **Bout M6 — Lock toggle + pin click-through**: lock icon to map tab headers, `selectElement` handler, picker overlay for N≥2. (Auto-open later removed; lock UI dropped.)
- **Bout M7 — Inline "map presence" widget**: §3.5 widget in element-detail middle pane (later moved to header in Bout MW).
- **Bout M8 — Schema description council motion**: deferred until after MW/NPM/XR stable.

## §10b. Smoke-driven follow-on bouts (session 209)

After M1-M7 landed, Captain's smoke against Skeld's live test worlds (AAARGAAAA/BBBB/CCC) surfaced bugs + design adjustments.

- **Bout N1 — Safe knock-outs**: picker → sidebar mode preservation, map tab id-swap propagation in `sync-attach.ts`, map tab refresh on image edit (cache invalidation via `applyMapBackground` + `sourceKey`), sidebar Location auto-open removed, sidebar Location row map icon indicator.
- **Bout MR — Map tab system refresh refactor**: subscribe to `data.elements` per cached map entry with field diff (`name`, `image_url`, `image_media_id`, `width`, `height`). Stale-tab darkening for tabs whose mapId left the world. Subscribe hot path narrowed.
- **Bout N2 — Lock UX rework**: hide lock icon by default, hover-reveal, single-locked-at-a-time. (Lock ultimately dropped session 210 when auto-open removed.)

## §10c. Session 210 work

- **Bout L0 — Doc reconciliation + lock cleanup**: removed §3.4 (lock was tied to auto-open) and §3.6 auto-open logic. Deleted `RightTabRef.locked`, `isActiveMapTabLocked`, lock CSS, `MapPickerModal`, `maybeAutoOpenMapFor`.
- **Bout S — Maps Settings tab**: new `'maps'` entry in `SETTINGS_TABS`. First toggle: "Show map names alongside map icons in element header" (default OFF).
- **Bout MW — Map affordances in element-detail top bar**: §3.5 widget moved from body to header. `[+map]` for Locations opens `MapCreateModal` with location pre-filled. Reads Maps Settings for name-label toggle.
- **Bout NPM — New-pin modal with TAB-autocomplete**: contextual `ElementCreateModal` (right-click on map) ghost-line name autocomplete against existing elements of selected category. TAB accepts → button flips Create → Place.
- **Bout XR — Ghost pins (cross-element rendering)**: dropped session 221.
- **Pin coord origin council motion**: closed as investigation (session 208's fix + §4.1 invariant resolved it). Paperwork bundles with M8.
- **Bout M8 — Schema description council motion**: still deferred until subsystems stable in real use.

---

# Zone subsystem build history (pulled from DESIGN_ZONES.md, 2026-05-18)

## §11. Bout sequence F0-Z (sessions 213-218)

Foundation BEFORE features. Each bout ended at typecheck-green + vitest-green + build-green seam.

- **Bout F0 — Zone type cleanup**: removed `map_id` and `coordinates` from `Zone` interface; added `zone_id`, `z`, `order` to `Marker`. Updated `folder-store-fs.ts` cascade so delete-map dependents are pins+markers (not zones). Types now align with OW canon.
- **Bout F1 — Cascade + CRUD tests** for zones/markers.
- **Bout F2 — Marker SDK adapter bypass**: same pattern as pin (bypass `prepareRelations` to avoid `_id_id` double-suffix).
- **Bout F3 — Leaflet2DManager polygon/polyline + pure helpers**: ZoneGeometry exports (`distanceToSegment`, `findClosestSegment`, `polygonCentroid`, etc.).
- **Bout F4 — `map_view_prefs` storage**: per-map visual prefs (grid, pin style/labels/tint, zone opacity/labels).
- **Bout F5 — Canvas toolbar DOM scaffold**.
- **Bout V1 — Visual settings popover** (per-map prefs UI; docked at midpanel-right since session 219).
- **Bout V2 — Zone drawing on canvas**: draft state machine, marker placement, live preview polygon/polyline.
- **Bout V3 — Zone chip strip + drag-to-trash** (later replaced by toolbar dropdown ZC9, session 217).
- **Bout V4 — Element-detail Zone visuals + Markers section**: per-zone atlas_color, atlas_opacity, atlas_label_visible; per-map grouped marker list with pan/delete.
- **Bout V5 — Toolbar behavior**: show/hide zones, show/hide pins, fit-to-image.
- **Bout Z — Pokeable smoke + PROGRESS.md update**.

Subsequent smoke-driven work (ZC1-ZC10, ZD1-ZD6, S series, B series) is captured in the session-by-session log earlier in this file. The bout-sequence framework above was the original plan; reality involved many more rounds of smoke + polish.


---

## Sessions 223–227 (archived from PROGRESS.md, 2026-05-24)

## Session 223 (2026-05-18) — Rooms model + decoupling + close-out polish

Long autonomous session + on-return polish round + close-out feature bouts with Captain. ~15 bouts total. All green.

### Close-out features (final hour)

- **Writing room modal** (`src/ui/writing-create-modal.ts`): replaced `window.prompt` in writing.ts with a proper BaseModal subclass. Name input + Enter/Esc + inline error. Used for "+ new book/chapter/scene" flows.
- **Empty-world onboarding** (world-home.ts): when `totalElements === 0`, home shows a CTA card with 4 quick-create tiles (character / location / event / narrative) wired to `ElementCreateModal` with `initialType` preselected.
- **Click-to-edit world name + description** on home identity strip — uses the existing `field-edit-popover` pattern. Persists via `FolderStore.writeWorldMeta` + mirrors in `state.active.meta`. Placeholder text "add a description…" when description is empty.
- **Notes overlay** (`src/ui/notes-overlay.ts`): per-world freeform notes, atlas-local (never synced). Lives on `WorldRegistryEntry.notes`. Modal with auto-saving textarea, ~600ms debounce, save-on-blur. Accessible via sidebar footer button (sticky_note_2 icon) and `N` hotkey.

### Decoupling polish (post-autonomous)

Captain identified inconsistency: room nav highlight + sidebar mode were coupled to the URL via `syncModeFromRoute`. Some room icons would auto-flip sidebar; others wouldn't — depending on whether their route was tagged "contenty". Decoupled the two dimensions:

- `state.ui.sidebarMode` is now pure UI state, persisted via new `core/ui-prefs.ts` → `localStorage["atlas_ui_prefs"]`
- Toggle clicks update state directly — no URL navigation
- `syncModeFromRoute` removed from sidebar.ts
- `activateWorld` navigates to `worldHash(id)` (home) instead of `elementsHash(id)`
- `element-detail` delete navigates to `homeHash` instead of `elementsHash`
- `link-world-modal` post-link navigates to `homeHash`
- `rightTabHashFor` falls back to home (not elements) when no selection
- Home icon in room nav matches `elements` route as well as `home` (legacy /elements URL still resolves to middle=home)
- Sidebar mountBody falls back to worlds when mode='elements' but no active world
- Element header bumped 40 → 48px; "char1" felt cramped under the room nav strip
- Convention #37 added

Test updates (5 specs touched):
- `phase-bout-cc.spec.ts:62, 109` — gear-toggle + sidebar-toggle no longer dictate URL
- `phase4-elements.spec.ts:53, 192` — toggle/delete navigation
- `phase2-ui.spec.ts:151` — activation doesn't auto-flip sidebar

### Original autonomous session (10 bouts)

Long autonomous session (Captain swimming). 10 bouts. All landed cleanly.

**Foundation**:
- Middle pane split into `[middleRoomNav | middleContent]` flex column. Convention #31.
- `MiddleMode` extended: `welcome | home | element | writing | timeline | search | publish | publish-detail | import | templates | settings`.
- Router additions: `homeHash`, `writingHash`, `searchHash`, `publishHash`, `publishDetailHash`, `importHash`, `templatesHash`. Full route parsing for nested writing/publish paths.
- Default landing for bare `#/w/<id>` flipped from `timeline` → `home`.
- Esc + click-already-selected-row both clear `selectedElementId` + navigate home. Convention #32.

**World Home (`src/middle/world-home.ts`)**:
- Identity strip (world name + description + state badge + total elements count)
- Stats spread (element type icons + counts, click → flip sidebar to elements + filter)
- Compact timeline-bar embedded (canvas-based, multi-row dot binning)
- Recent activity (last 5 by `local_updated_at`)
- Quick actions row (+ new element, open writing, settings)

**Writing room (`src/middle/writing.ts`)**:
- Tree (left) + element-detail (right) layout
- Book/Chapter/Scene labels customizable in Settings → Writing (`registry.writing_labels`)
- Three-level depth cap enforced via UI. Convention #34.
- Contextual "+ new X" buttons based on selected node depth.
- Reuses existing element-detail for the editor surface (no new richtext yet).

**Timeline (`src/middle/timeline.ts` + `src/visualization/timeline/`)**:
- Lifted core algorithm from `tools/little-element-viewer`: `temporal-fields`, `axis-calculator`, `data-normalizer`, `timeline-bar`.
- Multi-row dot binning; click → element nav; hover → tooltip with name + type + date range.
- Two modes: compact (~100px, World Home) + expanded (~240px, full timeline room).
- Deferred: narrative bars, narrative filter, zoom/pan, expand/collapse toggle, narrative-aware row affinity.

**Search room (`src/middle/search.ts`)**:
- Search across name + description + supertype + subtype for all elements
- 200ms debounce, query in URL, match excerpt with highlight, click → element room
- "Search everywhere" icon in elements-sidebar opens the room with the sidebar's current query

**Publish (`src/middle/publish-room.ts` + `publish-detail.ts`)**:
- Stub home page lists `registry.worlds[i].showcases` (empty list → explanation copy).
- Per-showcase detail route with public URL display + back nav.
- Atlas extension model documented in `DESIGN_PUBLISHING.md`. Conventions #35, #36.

**Import + Templates stubs** — explanatory copy, "coming soon".

**Tests**: 572 vitest green (+12 timeline-axis + 7 deselect-conventions added). 93 Playwright green after 3 spec updates for new default route + canvas-based timeline.

**Lessons (durable)**:
- Foundation-laying via rooms model worked cleanly in one big session because the existing `MiddleMode` switch architecture was already in place — the refactor was extension, not rewrite.
- Reusing element-detail as the writing editor surface bought us a working writing room without a new editor library decision. Real richtext lands later; the data model + tree are stable.
- Timeline-bar port reused the multi-row binning algorithm directly and deferred narrative-aware affinity — that complexity is worth its own bout when narrative bars land.
- `.atlas-search-row` class collision (sidebar search input vs search-room results) caught early — namespace room-specific styles with `atlas-{room}-{element}` to keep CSS isolated.

---

Earlier sessions (217-222) archived to [`docs-archive/PROGRESS-history.md`](docs-archive/PROGRESS-history.md) — sync hardening, FK-constraint detection, atlas_shape leak fix, sentence-case scrub, slug-prefix filenames, hotkeys MVP, map camera persistence, and the rest of the Phase 3.5+ work. Architectural rules from those sessions live in DESIGN.md conventions; sync lessons in SYNC_NOTES.md.
## Three big projects ahead — session 227 update

- **Writing workspace v1 — SHIPPED** (session 227). Major v2 follow-ups: code-split TipTap, e2e specs, alias editor row in element-detail, first-mention auto-link extension, hover preview card on chips, focus mode, backlinks pane on element-detail. Full v2 roadmap in DESIGN_WRITING.md.
- **Timeline** — `src/visualization/timeline/timeline-bar.ts` ported. Compact mode on Home, expanded mode in `#/w/<id>/timeline`. Narrative bars, zoom/pan, filter toggles, expand-collapse all deferred.
- **Publish** — `src/middle/publish-room.ts` stub. Backend already exposes `POST /showcase/publish/`; atlas-extension model (`atlas_*` config keys) locked in convention #35. Showcase config modal, element-detail publish button, list rendering, bundle UX for books, richtext piping — all deferred.

## Session 226 (2026-05-20) — Polish day: chip + decay ring + writing/selection decoupling

Captain-driven polish day across the whole tool. 8 items from his fix list, then 5 follow-ups from his eye-on-it review, then a writing/selection decoupling that came out of the chip work.

### The 8 from the fix list

- **#1 File-picker styled** — `map-create-modal.ts` raw `<input type="file">` replaced with a custom button + hidden input + filename text (`.atlas-file-picker`).
- **#2 Pin label tightened** — `defaultLabelOffset: 12 → 7` in `map-tab.ts`.
- **#3 Hold-Alt label cluster** — attempted, then reverted same session (Captain: "labels overlapping, no real need"). `src/ui/hold-labels.ts` deleted.
- **#4 Field-edit popover matches field width** — `field-edit-popover.ts:positionPopover` sets inline `width` from `anchorRect.width` (with 24px inset for breathing room and `MIN_WIDTH=280` floor); overrides CSS `max-width` to allow wide fields.
- **#5 Selected-element chip in room-nav-strip** — `src/middle/room-nav.ts`. Far-right chip showing icon + truncated name + ×. Click → element room; × → clear. Highlights when route mode is 'element'. Style mirrors `.atlas-room-nav-btn` (transparent default, cyan-tint active). **Convention #45.**
- **#6 Sync pill decay ring + customizable autosave** — `SyncEngine.getPendingPush()` / `flushPendingPush()`, emits `atlas:pending-push` CustomEvent on arm/cancel/fire. Pill renders conic-gradient ring via `--decay-fraction` driven by rAF. Settings → Sync gets a number input (1–3600s, persisted as `registry.sync_debounce_ms`); engine reads at attach and live via `setDebounceMs`.
- **#7 Marker delete: tooltip + drag-to-trash** — vertex handle gets a native `title` ("drag to move · drop on trash to delete · right-click to delete"). Trash-zone affordance ported from `map-tab-pin-drag.ts`. Floor guard added on revisit (see follow-ups below).
- **#8 Click-anywhere marker insert removed** — `zone-edit-mode.ts` `insertMarkerAtClick` deleted along with the call site in `map-tab.ts`. Map background click in edit now clears `selectedElementId` (→ `syncEditMode` exits edit). Inserts only via segment-overlay clicks.

### 5 follow-ups from Captain feedback

- **Hold-Alt reverted** (see above).
- **Popover narrowed** by 24px inset so it sits inside the field row instead of edge-to-edge.
- **Chip visuals tightened then re-rounded** — three rounds of dialing. Final: 26px height, 13px border-radius (rounded pill), transparent default chrome, cyan-tint active. Icon 16px + × 15px, scoped with two-class specificity to outrank the `material-symbols` package's 24px default.
- **Autosave delay swapped slider → number input** (1–3600s). Captain wanted values past 30s.
- **Zone-draft overlay wraps on narrow panes** — `flex-wrap: wrap` + `max-width: calc(100% - 32px)` so the create-zone widget reflows into multiple rows instead of being clipped.

### Writing / selection decoupling

Tracked the chip work to its conclusion: writing room's `mountEditor` was mirroring the active narrative into `state.ui.selectedElementId` on every URL change, which clobbered any prior global selection. Fixed:

- `writing.ts` no longer patches `selectedElementId` when entering writing or navigating between narratives.
- `element-detail.ts:getSelectedElement` derives the target element from the URL hierarchy (`route.sceneId ?? chapterId ?? bookId`) when `route.mode === 'writing'`. Otherwise unchanged.
- Result: select a Character → go to writing → chip still shows the Character → click chip → return to Character. Writing tree still highlights the active narrative (it always read URL, never `selectedElementId`). **Convention #46.**

### Esc refinement (convention #32 amendment)

Esc was firing `deselectToHome` from anywhere with a selection — after decoupling, Esc would pull the user out of writing AND clear the persisted global selection. Now gated: `hotkeys.ts` skips the deselect hotkey when `hash.includes('/writing')`. Writing room owns its keyboard.

### Marker drag-to-trash floor guard

Originally the drag-to-trash always armed the trash zone, deferring to `deleteMarkerInEdit`'s min-vertex toast on refusal — which looked like "drop succeeds then snaps back" jank. Now `buildVertexHandle` computes the floor at dragstart (3 polygon / 2 line) and suppresses trash-zone arming when at floor. User can still move the marker; right-click still deletes (and surfaces the floor toast for that path).

### Tests + bundle

- 615 → 634 vitest (19 new in `writing-helpers.test.ts` covering `buildNarrativeIndex` / `ancestorIds` / `findAncestry` / `nextOrder` — F24 from session 225's sweep)
- 93 Playwright unchanged
- Typecheck + production build clean
- Bundle 548 KB JS / 102 KB CSS / 155 KB gzipped (slight shrink from removing hold-labels CSS, slight grow from chip + decay ring + settings input)

### Lessons (durable)

- **`material-symbols` package's `.material-symbols-outlined` rule is single-class specificity (0,1,0).** Single-class overrides from atlas.css tied on specificity, so load-order decided which won — not deterministic. Two-class scoping (`.atlas-room-nav-selected .atlas-room-nav-selected-icon`) forces a win.
- **URL is the source of truth for room navigation.** When writing room tried to MIRROR its URL state into a global UI slice, the mirror became the bug. The fix was to read the URL directly where needed, not propagate.
- **Iteration-rhythm bouts benefit from Captain in the loop.** Visual fixes need his eye — three rounds on the chip ("works but too cyan" → "works but icons too big" → "works but icons still big" → "looks right") landed faster than any single-shot guess.

---

## Session 225 (2026-05-20) — Stewardship pass

Audit + four targeted refactors. See `SWEEP-2026-05-20.md` for the full triage (26 findings, 0 high / 6 med / 20 low).

### Refactors landed

- **`element-detail.ts` split 1444 → 162 + 789 + 450 + 117 lines** across `element-detail.ts` (dispatcher), `-header.ts`, `-fields.ts`, `-refs.ts` (and the pre-existing `-zone-sections.ts`). Clears the path for the writing-workspace redesign.
- **Writing tree helpers consolidated** into `writing-helpers.ts` (`buildNarrativeIndex`, `NarrativeNode`, `NarrativeIndex`, `ancestorIds`, `findAncestry`, `nextOrder`). Previously duplicated between `writing.ts` and `writing-sidebar.ts` with subtle differences.
- **`refreshElementsAfterWrite(store)` helper** added to `sync-attach.ts`, applied to 19 sites across 11 files. Replaces the 3-line `await store.listElements(); patchSlice('data', { elements }); requestPushIfLinked();` pattern.
- **Small follow-ups**: removed `maybeAutoActivate` no-op stub, replaced `setTimeout(0)` with `queueMicrotask` in field-edit-popover, added 21 unit tests for the newly-extracted pure helpers.

### Docs synced

- `DESIGN.md`: ACRONYMS additions (PIN, GPS), convention #41 (45px → 36px), shell ratio ASCII (18/52/30 → 19/51/30).
- `DESIGN_WRITING.md`: 45px → 36px references.
- `DESIGN_HOME.md`: identity click-to-edit marked shipped, quick-actions list reduced to shipped 3 buttons.

### Tests

- 594 → 615 vitest (21 new for pure helpers in `element-detail-helpers.test.ts`)
- 93 Playwright unchanged

### Decisions made

- **Writing workspace redesign will use Option A**: new `writing-workspace.ts` module parallel to element-detail, NOT a writing-mode branch inside element-detail. The split was prep for this.
- **`element-detail.ts` split landed BEFORE workspace redesign** so the new workspace can import a clean `renderHeader`.
- **`refreshElementsAfterWrite` lives in `sync-attach.ts`**, co-located with `requestPushIfLinked` rather than a new file.

---

## Session 224 continued (2026-05-20) — Sidebar takeover + header unification + drag-reorder

Continuation of the writing-pillar work after Skeld's fill on AtlasMoppetopia validated the new model with real data. Conversation-heavy day with iterative polish.

### Sidebar takeover
- New `src/sidebar/writing-sidebar.ts` — the writing tree, mounted into `.atlas-sidebar-content` when route is `writing`. Bands and tree append directly (no wrapping flex div) so the shell-level scrollbar gutter aligns with the elements sidebar pixel-perfectly.
- Two-band header mirrors elements sidebar exactly: create-row in filter-strip slot (stacked `+ new <l1>` / `+ new <l4>` buttons, height-locked to 67px to match), then search-row reusing `.atlas-search-row` (`[input] [magnifier] [tune]`).
- Override mechanism: `state.ui.sidebarWritingOverride: boolean`. Set when user toggles to Worlds/Elements while in writing. Clears on route in/out of writing OR on writing-icon re-click.
- Middle pane in writing mode dropped its tree column — now single-column, just element-detail.
- Drag-reorder: every tree row `draggable=true`, sibling-only (same `parent_narrative`), sequential `order` writes, cyan inset box-shadow drop indicator (top or bottom edge based on mouse y vs row midpoint).

### Header unification
- Tier badge + child-create buttons moved INTO `.atlas-middle-header` (icon-only, `.atlas-icon-btn-sm`-style). New helper `renderWritingTierActions(el, header)` in element-detail.
- Header locked at 45px with `!important` on every height channel + defensive child rule. Captain reported variable heights in prior bouts — investigation showed it was likely visual-weight misperception, but the lock makes it impossible by construction.
- Tier rule final (Captain): l1 → {l2, l4}, l2 → {l3, l4}, l3 → nothing, l4 → nothing (drafts don't nest from UI).

### Narrative cascade delete
- Extended `findDependents` for `narrative` type in both `folder-store-fs.ts` and `mock-folder-store.ts`.
- BFS-walks `parent_narrative` chain → collects descendants + pins referencing target or descendants.
- Confirm dialog shows total count.
- Delete from writing room stays in writing (route check in `onDelete`).

### Polish trio
- **Pin nav respects room**: `buildPinAffordance` click handler checks current route mode. In writing → `openMapTab(m)` no URL change; elsewhere → `openMapTab(m, sourceElementId)` with element-preserved URL.
- **Optimistic save**: `field-edit-popover.ts` calls `cleanup()` BEFORE awaiting `opts.onSave`. UI stays interactive during save. Failures surface via toast.
- **Last-narrative restore**: `WorldRegistryEntry.last_writing_narrative_id` writes on every selection change (deferred via `queueMicrotask`). Writing icon in room nav reads it on click and navigates via new `writingHashForNarrative` helper.

### Bug fixes
- **Duplicated detail panel** (recursive render): `patchSlice('ui')` mid-render was firing subscribers synchronously → recursive render → two detailMounts in detailCol. Fixed by deferring the selection patchSlice via `queueMicrotask`.
- **Supertype field unclickable**: I'd used `require('./writing-helpers')` in element-detail.ts — `require` doesn't exist in browser ESM. Replaced with static import.
- **Gear icon does nothing**: outer mountWriting subscribe was a no-op in tree mode. Now calls `render()` unconditionally; `mountMode` early-returns when mode unchanged.
- **Book chevron not folding when chapter selected**: `render()` was force-expanding ancestors on EVERY render. Now tracks `lastExpandedForActiveId` and only force-expands on activeId change. User's explicit chevron toggle wins on subsequent renders.

### Code tidying (cleanup pass before reflect)
- Removed dead `findAncestry` and `createNarrativeAtTier` in writing.ts (orphaned by the toolbar→header move).
- Dropped dead CSS: `.atlas-writing-tree-list`, `.atlas-writing-detail`, `.atlas-writing-detail-mount`, `.atlas-writing-context-toolbar`.
- Added 5 unit tests for `writingHashForNarrative` covering all depth levels + broken parent chains.

### Test count
- 589 → 594 vitest (5 new for `writingHashForNarrative`)
- 93 Playwright e2e unchanged
- Production build clean

## Session 224 — Writing system redesign + offline + tidying

Long autonomous session covering:

### Writing redesign (the big one)
- **Model**: Narrative belongs to writing tree iff `supertype ∈ {l1, l2, l3, l4}`. Tier = supertype value. Subtype is FREE (user classification like "flashback", "vision"). No canonical/display split.
- **Helpers**: `src/middle/writing-helpers.ts` — `getWritingLabels`, `isWritingNarrative`, `getTierForNarrative`, `isWritingInitialized` (smart detection), tier constraints + icons.
- **Setup screen**: `src/middle/writing-setup.ts` — shown when `isWritingInitialized` is false. Configures labels, detects existing supertype groupings ("Adopt detected: Plot Arc"), offers pre-checked promote.
- **Promote**: `src/middle/writing-promote.ts` — BFS from parent-chain roots, assigns supertype by depth, fills missing `order`. Idempotent. Depth-3+ become Drafts (l4).
- **Label-rename migration**: `applyLabelRenameMigration` rewrites old supertype values to new. Triggered from Settings → Writing change-event AND setup screen on save.
- **Drafts (l4)**: flexible-parent joker tier. Can root, sit under any tier, nest other drafts. Italic in tree. Always enabled.
- **Element-detail autocomplete**: supertype field on Narratives shows the four labels as suggestion chips + Tab autocomplete. Free-text override still allowed (escape hatch).
- **Writing room**: 1) Tree filtered by `isWritingNarrative`. 2) Tier-aware icons (l1=book, l2=article, l3=short_text, l4=edit_note). 3) Contextual create per tier (l1→l2+l4, l2→l3+l4, l3→l4, l4→l4). 4) Footer adds "+ new book" + "+ new draft". 5) Header gear re-opens setup. 6) Setup screen shown via mode-switching mount.
- **DESIGN_WRITING.md v2.0** completely rewritten. Conventions #33, #34 updated; #38, #39 added.

### Offline polish (Bout D from earlier in session)
- Self-hosted Material Symbols via `material-symbols` npm package (no Google CDN)
- `vite-plugin-pwa` configured — generates `sw.js` + `manifest.webmanifest`, precaches 17 entries (~4.9 MiB)
- New `src/core/offline.ts` registers SW in production
- Atlas is now installable as a PWA on Chromium

### Code tidying (Bouts A-C from earlier)
- `core/dom-utils.ts` — `escapeText`, `escapeAttr`, `relativeTime` deduped from 20+ files
- `core/active-store.ts` — relocated from `ui/create-world-modal.ts`; 19 files updated
- World Home: timeline-bar mounts ONCE per world activation (was destroy+recreate per render)
- Search room: memoizes runSearch by `(query, elements ref)`
- Writing tree: per-node chevron collapse persisted in `registry.worlds[i].writing_tree_collapsed`

### Test infrastructure
- 17 new unit tests in `tests/unit/writing-helpers.test.ts` covering `isWritingInitialized`, `buildPromoteCandidates`, `detectExistingLabels`, `applyPromote`, `applyLabelRenameMigration`, and supertype-based classification.
- Total: 589 vitest + 93 Playwright. All green.

### What changed in registry/types
- `writing_labels` expanded to include `l4` (Draft)
- New `writing_initialized: boolean` flag
- `writing_tree_collapsed: string[]` unchanged from session 223

---

## Sessions 227–228 (archived from PROGRESS.md, 2026-05-24, session 231)

These two sessions delivered the writing workspace from scratch — design + v1 + v1.5 polish (227) and the v2 batch (228). Architecture moved fast and largely held; the writing-context pane introduced in session 229 (kept in PROGRESS.md) and globalized in session 231 sits ON TOP of this foundation.

## Session 227 (2026-05-20) — Writing workspace v1 + v1.5

Long autonomous build after the design conversation. 9 planned bouts; 8 landed, 1 deferred. Followed by ~12 rounds of Captain-feedback polish (v1.5) the same day.

**Core build**: TipTap-based writing workspace replacing element-detail when route is `writing` AND a narrative is active. New modules: `writing-workspace.ts` (orchestrator), `-editor.ts` (TipTap config), `-element-chip.ts` (custom Mention extension), `-mention.ts` (@ picker UI), `-markdown.ts` (custom JSON → markdown serializer), `-load.ts` (markdown → JSON post-processor), `-derive.ts` (UNION-on-save extract). Two-representation storage: `story` (markdown for OW interop) + `atlas_richtext_json` (TipTap JSON, atlas-local).

**Library choice**: TipTap 3 chosen over Lexical (memory leak), ProseMirror raw (boilerplate), Quill/Editor.js/CKEditor (size/markdown issues).

**Linking model** (conventions #47-50):
- `atlas_richtext_json` on Narrative as atlas-local extension
- Chips serialize as markdown `[Name](ow://<type>/<uuid>)` — display text resolved dynamically at render
- `atlas_aliases: string[]` on any element; @ picker + autolink match `name` ∪ `atlas_aliases`
- On save, auto-derive scans prose for `ow://` links and writes UNION into Narrative relation fields

**URL shortened** (post-build): `#/w/<worldId>/writing/<narrativeId>` (one UUID instead of three). Legacy nested form still parses.

**v1.5 polish** (Captain-driven): chip preview hover card, aliases editor modal, @ picker recents tracker, Cmd+Shift+F focus mode (`:has()`-driven shell collapse), per-world prose font-size + warm vignette + off-white text, settings tab persistence, layout-shift fix via shared `--atlas-writing-content-width: 760px`. Convention #52 (scope `.material-symbols-outlined` overrides under a parent class for two-class specificity) coined here after the second time it bit.

Tests: 629 → 672 vitest (+43). Bundle: 298 KB gzipped single chunk (workspace was static-imported pre-v2 split).

## Session 228 (2026-05-20) — Writing v2 batch: 10 autonomous bouts

Long autonomous bout after a v2-roadmap conversation. Captain locked scope at 10 bouts; all 10 shipped with tests green at session close.

| # | Bout | Approx LOC | Tests |
|---|------|------------|-------|
| 1 | Cleanup (e2e + Element type + OW_LINK_RE + flush) | ~120 | 6 e2e |
| 2 | Backlinks polish (Mentioned-in + self-heal) | ~80 | 2 e2e |
| 3 | Word goal (popover + progress ring) | ~200 | 12u + 1e |
| 4 | Find/replace (Ctrl+F / Ctrl+H bar) | ~440 | 2 e2e |
| 5 | Font picker (4 system stacks) | ~70 | 1 e2e |
| 6 | Character cast strip (5-type pivot) | ~190 | 1 e2e |
| 7 | Inline element creation (Ctrl+Shift+E + right-click) | ~140 | 1 e2e |
| 8 | Split-into-sibling (Ctrl+Shift+D + modal) | ~290 | 1 e2e |
| 9 | Autolink (TipTap plugin + Tab handler) — Convention #53 | ~280 | 9u + 2e |
| 10 | Code-split TipTap (dynamic import + race guards) | ~50 | held |

**Convention #53** (autolink): case-sensitive `\b...\b` matches against name + alias index, min 3 chars, ambiguity-suppressed, first-mention rule, `@` picker takes priority. Index rebuilt only when `state.data.elements` ref swaps.

**Bundle impact**: code-split landed in Bout 10. Main JS gzipped dropped 298 KB → 157 KB (47% reduction). Writing-room visit now pays an extra ~149 KB chunk fetch once per session (cached after).

Tests: 672 → 693 vitest, 93 → 110 Playwright. All green.

**Durable lessons** (now in `.temper/grow/craft.md`):
- ProseMirror's EditorState selection doesn't sync from DOM selection on demand — dispatch `selectionchange` event manually in e2e tests
- Dynamic `import()` race guards are non-optional — generation counter + targetId capture minimum
- `pagehide` is the modern `beforeunload` for save-before-close
- `Element` type extension with named optional fields catches typos at compile time
- One source of truth for regex patterns: factory function for `/g` regexes to avoid `lastIndex` state-share

(Sessions 229-230 — writing-room redesign + initial context pane — kept in PROGRESS.md as proximate context for session 231's tool-global refactor.)

---



---

# Sessions 229-233 (2026-05-23 → 2026-05-25) — context-pane era + maintenance

Archived 2026-06-07 during the session-235 PROGRESS scrub. Entries verbatim from PROGRESS.md.

---

## Session 233 (2026-05-25) — Maintenance: settings split, map-tab re-trim, default-create-type, flake fix

Captain framed another maintenance session ("stable, longterm, clean codebase; if stuff can be fixed or done better, take time first") and went autonomous for the arc. The codebase audit found it well-tended — no TODO/FIXME litter, 2 intentional `@deprecated`, modest `as any` (TipTap/SDK interop), deliberate forensic console logging. So the work was structural hardening + one greenlit feature, not cleanup-of-rot. Five bouts, each typecheck + targeted e2e gated; full suite at the end.

### Bout 1 — Settings split + `updateWorldEntry` DRY (convention #65)
`settings-panel.ts` 1175 → 210 lines (pure orchestrator: rail, last-tab restore, dispatch). Six per-tab modules: `settings-account.ts`, `settings-storage.ts` (device + sync), `settings-editing.ts` (field-mode + maps), `settings-world.ts`, `settings-writing.ts`, `settings-context.ts`. Flat `settings-*.ts` files match the `writing-workspace-*`/`map-tab-*` precedent (identical import depth). Cleaner than the s232 writing-workspace split — these were already standalone `renderXTab`/`wireXTab` pairs, not closure-bound. New `updateWorldEntry(reg, worldId, patch)` registry helper absorbs the inline `findIndex` + `worlds.map` boilerplate that had drifted into the context/writing wire handlers (+2 registry unit tests). Public surface (`mountSettingsPanel`) unchanged → `app.ts` untouched. 21 settings e2e green.

### Bout 2 — Default new-element type (convention #66)
`ui-prefs.defaultCreateType` (localStorage, default 'character'). ElementCreateModal preselects it when opened without an explicit `initialType` (sidebar +, home, hotkey, writing inline-create, map contextual). Surfaced as a "Default new-element type" dropdown in Settings → Editing. Guard in `buildModal`: re-validates the preselected type against the effective (post-`excludeTypes`) set, so an excluded default (e.g. 'map' in the map contextual flow) falls back to the first offered type. Fixed `setSidebarModePref` to load-merge-save (was clobbering — now both prefs survive). +1 phase4-elements e2e.

### Bout 3 — map-tab.ts re-trim (806 → 388)
The s212 split (858→470) had re-accreted to 806 — one giant `mountMapTab` closure. Extracted three modules via verbatim lifts: `map-tab-interactions.ts` (335 — all the `manager.on`/`container` gesture handlers behind a deps object: map-click, pin click/hover/contextmenu, contextual create, hotkeys, drag-drop), toolbar wiring folded into `map-tab-toolbar.ts` (now 233, holds `wireCanvasToolbar` + `wireZonesDropdown`), `map-tab-stale.ts` (40, the cross-world stale-pane). Reconciled ~15 now-dead imports + removed a vestigial `void isEditing` suppression block. Lifecycle (manager init, background, camera restore, zone-overlay creation) stays in mount. 9 phase5-maps e2e green; typecheck guarantees the closure captures survived.

### Bout 4 — Split-test flake fixed (the s230/231 follow-up #5)
Reproduced under `--repeat-each` stress: the test positioned the cursor with 28 rapid `ArrowLeft` presses, but in a contenteditable under load Playwright "occasionally moves focus instead of dispatching to ProseMirror" (the autolink test already documents this for Tab) — leaving the cursor at doc-end where `openSplitDialog` *correctly* bails ("nothing after the cursor"). The app was never wrong; the test's caret positioning was brittle. Fixed by setting the selection via the DOM Selection API (focus + `range` to end of first paragraph + `selectionchange` nudge to ProseMirror's DOMObserver) — deterministic, focus-safe. Verified 6× stress: 18/18.

### Bout 5 — Docs + full suite
DESIGN conventions #64 (settings scope-grouping) updated — per-tab split no longer "pending"; #65 (per-tab module pattern + `updateWorldEntry`) and #66 (`defaultCreateType` in ui-prefs) added. Full suite: **713 vitest + 127 Playwright + typecheck + production build green.**

### Smoke checklist (Captain — pending visual test)
1. **Settings — every tab renders + persists**: Account (email/PIN); Storage (folder + sync toggles/cadence/policy/debounce); Editing (field-edit mode radios, refs-grouping toggle, confirm-delete toggle, **new** default-create-type dropdown, map-label toggles); World (rename, online/unlink actions, delete flows); Writing (tier labels + migration, font, spellcheck); Context (hop/lock/edge-color). Legacy deep-links (`#/w/<id>/settings/identity` etc.) still resolve.
2. **Default create type**: set it in Settings → Editing → open "New element" via sidebar +, home button, and Ctrl+K hotkey — all preselect your chosen type. Map right-click contextual create with default = 'map' falls back gracefully (no broken grid).
3. **Map tab (the re-trim — exercise every gesture)**: open a map; toolbar (settings cog, zones/pins visibility toggles, fit, draw-polygon, draw-line, zones dropdown); left-click pin placement (with element selected); pin click → element nav; pin hover → tooltip; pin right-click → ghost pins; right-click empty map → contextual create + Place existing; **F/Z/L hotkeys** in canvas; **drag element from sidebar → drop on map**; stale tab (open map, switch worlds → "map from another world" pane + close).
4. **Writing split**: open a narrative, type two paragraphs, cursor between them, Ctrl+Shift+D → split modal → confirm.

## Session 232 (2026-05-25) — Maintenance: writing-workspace split, settings reorg, element-detail refs

Captain framed a maintenance session ("stable, longterm, clean codebase; if stuff can be fixed or done better, take time for that first"). Three workstreams, all behavior-preserving / additive, validated per bout (typecheck + targeted e2e each, full vitest + writing/settings e2e at the end).

### Writing-workspace.ts split (1286 → 647 lines)
Extracted into 4 single-concern modules, each declaring deps explicitly (pure fns or a `deps`-object factory — convention #37 testable-seams):
- `writing-workspace-mention-items.ts` — @-picker scoring (pure, no closure deps)
- `writing-workspace-word-count.ts` — ambient word-count widget (factory over root + editor accessor)
- `writing-workspace-sticky-bar.ts` — breadcrumb + date + action buttons + view-mode toggle (factory)
- `writing-workspace-context-menu.ts` — right-click menu + inline-create + split + unlink-chip (factory; owns its listeners + `destroy()`)
Save controller deliberately left in place (most coupled to mount-local mutable state — `pendingSnapshot`/`mountedForId`/`lastSavedMarkdown`). 711 vitest + 33 writing e2e green.

### Focus-mode exit affordance
Focus mode hides the sticky bar (which holds the focus button), so only Esc exited. Added a floating cyan focus icon (`.atlas-writing-focus-exit`, top-right) created on `document.body` while focus mode is on; shared `exitFocusMode()` keeps Esc + button in sync; torn down on unmount.

### Settings reorg (8 tabs → 6, scope-grouped)
- Rail grouped via `SETTINGS_TAB_GROUPS` (router.ts): **Atlas** (account, storage, editing) + **This world** (world, writing, context), each with an icon+label header.
- `identity`→`account`; `atlas`+`sync` merged → **storage** ("On this device" folder section + sync section); new **editing** tab (field-edit mode + map header-label toggles); **about** dropped → version/links footer in the rail.
- Route keys renamed; `parseSettingsTab` maps legacy keys (identity/atlas/sync/maps/about) so old deep-links + stored last-tab resolve.
- Recomposed in-place: reuses `renderSyncTab`/`renderMapsTab`/`wireSyncTab`/`wireMapsTab` verbatim; intricate world-tab logic untouched. **NOT yet split into per-tab modules** (deferred). e2e updated (phase2-ui, phase35-settings).

### Element-detail "Referenced by" / "Mentioned in" + delete confirm
- Category labels title-cased ("Narratives", "Locations").
- "Mentioned in" narratives grouped by writing tier (Books/Chapters/Scenes/Drafts; non-tree → "Narratives").
- New `editor_settings.refs_group_by_field` (Editing tab, default off): groups "Referenced by" as SINGULAR "<Field> of" ("Rival of", "Friend of" — not "Friends of"; we view one element) via `humanizeFieldName` + `singularizeLabel`. Live-updates via the registry-slice subscription.
- New `editor_settings.confirm_before_delete` (Editing tab, default on): gates the element-delete `window.confirm` (which still surfaces the cascade count); off lets power users skip it.

### Deferred to next session
1. **Settings-panel per-tab module split** — the hygiene match to the writing-workspace split (settings-panel.ts is ~1180 lines).
2. **Default element create type** — Captain greenlit, but `ui.defaultCreateType` is unbuilt (DESIGN doc only) → a small feature, not just a toggle. (confirm-before-delete shipped this session.)
3. Minor DESIGN.md settings tab-key text refresh (router is source of truth; descriptive text lags).
4. Decide whether settings scope-grouping / the deps-factory extraction earn a formal DESIGN.md convention (currently craft-level).

### Smoke checklist (Captain — pending visual test)
1. **Writing room**: open narrative → sticky bar (breadcrumb/date/actions); type → word count + goal; @-picker; right-click (create / split / unlink / link-to); Ctrl+Shift+E + Ctrl+F; focus mode → top-right cyan icon exits (+ Esc); reading mode; view-mode toggle on a parent narrative.
2. **Settings**: rail shows Atlas / This world groups w/ icons; Storage = folder + sync controls; Editing = field-mode radios + map-label toggles + refs-grouping toggle; version footer; world/writing/context greyed without a world.
3. **Element detail**: "Mentioned in" split by tier; "Referenced by" capitalized; flip Editing → refs-grouping → labels become "<Field> of".

---

## Session 231 (2026-05-24) — Context pane goes tool-global: 6-bout arc

Captain framed the session: take the writing-context pane shipped in 229, broaden it into a tool-global Context tab that lives in the right pane alongside Maps. Six bouts of design conversation + autonomous build + checkpoint validation between each.

### Bouts shipped

| # | Bout | Net LOC | Tests added |
|---|------|---------|-------------|
| 1 | Structural refactor: `writing-context` → `context` kind, route-driven content, permanent leftmost tab, no auto-open | ~140 | 4 e2e |
| 2 | Element route content (graph + preview); empty-state copy for unfocused routes; preview narrative→subject + mode refactor | ~120 | (existing) |
| 3 | Recent-centers breadcrumb (replaces back pill); mouse-back button intercept; right-click node menu (Open / Copy ID / Add to story) | ~250 | 3 e2e |
| 4 | Toolbar: type-filter chips + lock-icon + 1/2-hop pill; per-world persistence via new registry fields | ~280 | 3 e2e |
| 5 | Free zoom/pan (wheel + drag) with cursor-anchored zoom; fit-to-view button; Settings → Context page | ~220 | 2 e2e |
| 6 | Edge type coloring + hop expansion to 1/2/3/4 with per-ring caps; one-direction prefs sync refactor | ~200 | 2 e2e |

Plus inter-bout fixes:
- **Mouse-back STILL did browser back**: moved listeners from `root` to `window` capture phase + added `mouseup` (browser fires nav on mouseup) + `auxclick`. preventDefault on all three. Always intercepts inside pane, never outside.
- **Center node off-center bug**: CSS center node is 44×44 but JS positioned all nodes using `NODE_DIAMETER = 36`. Added `CENTER_NODE_DIAMETER` + `diameterFor(n)` helper used in initial paint AND resize re-projection.
- **Lock-layout setting**: when on, filter toggles hide via CSS without sim re-run. Surviving nodes don't jump. Toolbar lock icon + Settings checkbox.
- **Lock-layout 4px wobble**: spurious `setHiddenTypes(empty)` on lock toggle was re-running the sim. Diff-aware syncPrefsToGraph only calls setters for fields that actually changed; `setLockLayout` sequenced first so subsequent setters see the new flag.

### New modules

- `src/tabs/right/context-tab.ts` (~270) — orchestrator: route → subject derivation, unified `onSelect`, one-direction prefs sync, mouse-back intercept
- `src/tabs/right/context-tab-lifecycle.ts` (~50) — ensures permanent context tab at index 0 per active world
- `src/tabs/right/context-pane-toolbar.ts` (~150) — type chips + lock icon + hop pill (4 segments)

### Renamed / removed

- `src/tabs/right/writing-context-tab.ts` → replaced by `context-tab.ts`
- `src/tabs/right/writing-context-lifecycle.ts` → replaced by `context-tab-lifecycle.ts`

### Touched modules

- `src/core/types.ts` — `RightTabRef` kind `writing-context` → `context` (no narrativeId on ref); new registry fields `context_filters_off`, `context_hop_depth` (widened 1-4), `context_lock_layout`, `context_edge_color`; `writing_context_auto_open` marked @deprecated
- `src/core/constants.ts` — `ELEMENT_TYPE_COLORS` map added (palette from dcc-viewer / element-viewer-trial)
- `src/core/router.ts` — `SettingsTab` adds `'context'`
- `src/tabs/right/context-pane-graph.ts` — major rewrite: rings-based hop computation, edge coloring, dynamic setters (`setHiddenTypes`/`setHopDepth`/`setLockLayout`/`setEdgeColor`), `goBack()`, breadcrumb render, right-click node menu, free zoom/pan (`userScale`/`userTx`/`userTy` on top of base fit projection), fit-to-view button, per-paint listener stacking bug fixed (handlers attached once at mount)
- `src/tabs/right/context-pane-preview.ts` — `narrative` → `subject` + new `mode: 'writing' | 'element'`; Featured + add-to-story gate on writing mode; "open in detail" hides when previewing self in element mode
- `src/tabs/right/context-pane-lists.ts` — unchanged (writing-mode only)
- `src/tabs/right/right-pane.ts` — dispatch on `context` kind; tab button styling
- `src/tabs/right/right-tabs-persistence.ts` — context tab is permanent (no strip-on-save); migration prepends if missing on load; legacy `writing-context` entries dropped silently
- `src/registry/registry.ts` — per-world snapshot loader drops legacy entries
- `src/middle/settings-panel.ts` — new `renderContextTab` + `wireContextTab` with hop depth dropdown (Auto/1/2/3/4), lock layout checkbox, edge-color checkbox
- `src/styles/atlas.css` — toolbar styles (chips, lock, hop pill, right cluster); breadcrumb trail styles (replaces back pill); right-click menu styles; fit-to-view button styles
- `src/app.ts` — wires renamed lifecycle

### New e2e specs

`tests/e2e/context-pane.spec.ts` (15 tests):
- Context tab permanent leftmost on fresh boot
- Element route shows graph + preview (no lists, "open in detail" hidden for self)
- Element route: clicking a neighbor swaps preview + reveals "open in detail"
- Home route shows empty state copy
- Breadcrumb appears after recenter; home chip returns to subject
- Right-click node opens menu (Open as element / Copy ID); Esc closes; "Add to story" hidden in element mode
- Right-click "Add to story" appears in writing mode for non-subject nodes
- Type chip toggles hide that type; chip persists with `is-off`; re-enable returns nodes
- Hop toggle 1-hop hides 2-hop neighbors
- Hop preference persists in registry
- Lock layout: surviving nodes do NOT move when a type is hidden
- Zoom: wheel reveals fit-to-view button; click resets
- Hop: 3-hop reveals a node two rings out from the subject
- Settings: Context tab renders + persists hop depth
- Settings: edge coloring toggle persists and routes back to graph

### Tests + bundle

- vitest: 711 (unchanged — graph refactor was integration-tested via e2e)
- Playwright: 110 → 126 (+15 context-pane specs + 1 existing context-pane spec updated for no-auto-open)
- Typecheck clean
- Production build clean

### Architectural patterns codified (DESIGN.md conventions #58-63)

- **#58**: Context tab is permanent + route-driven (route is the focus source of truth)
- **#59**: One-direction prefs flow (registry → orchestrator → graph → toolbar); toolbar callbacks only persist
- **#60**: Diff-aware sync (only call setters for fields that changed; setLockLayout first)
- **#61**: Window-level capture-phase listeners for mouse buttons that trigger browser defaults
- **#62**: Generalized ring computation with per-ring caps for multi-hop graphs
- **#63**: CSS vs JS coupling lesson — CENTER_NODE_DIAMETER constant must match `.is-center` CSS width/height

### Lessons (durable)

- **Per-paint listener stacking is a real category of bug.** The old graph code added a `click` handler to `target` inside `paint()`, which runs on every renderForCenter call. After N recenters, N handlers all fired on deselect. Moved to mount-time so each handler lives once. Add it to the convention list of things to grep for: never `addEventListener` inside a function that's called more than once per mount.
- **`preventDefault` on `mousedown` is not enough for mouse-back.** Chrome fires history nav on `mouseup`; some browsers use `auxclick`. Listen on all three at window-level capture phase. Inside-pane check via `root.contains(e.target)` keeps it scoped.
- **CSS-JS coupling needs a code-level reminder.** When CSS sets a different size for a special variant of an element (e.g. `.is-center { width: 44px }` overriding `width: 36px`), the JS positioning code MUST be aware. Add a comment in the constant ("CENTER_NODE_DIAMETER MUST match CSS") so the next person who tweaks one tweaks both.
- **Spurious "no-op" setter calls are not no-ops if they trigger re-renders.** `setHiddenTypes(same set)` would have been fine if it just compared and bailed — but it called `renderForCenter` (full sim). Always include a "did anything change?" guard at the call site OR inside the setter when the setter has side effects beyond state mutation.
- **One-direction state flow scales.** Toolbar callbacks went from "persist + apply to graph + refresh toolbar" to "persist, subscriber handles the rest." Less coupling, no duplicate-update races, settings page edits propagate to the toolbar without extra wiring.

### Open follow-ups

1. **Skeld smoke against AtlasMoppetopia** — exercise hop=3/4 + edge coloring against realistic cast sizes (~20+ per scene).
2. **Density slider** — Captain mentioned earlier; per-ring caps tunable beyond tier defaults. Defer until felt.
3. **Edge type coloring v2** — when Relation subtypes get their own palette, color edges by relation type (rivalry red, friendship green) rather than node type.
4. **2-hop visualization at scale** — when cast > 30 + 2-hop adjacents, the layout sim might want auto-scaling rest distance.
5. **Pre-existing Playwright `split` test flake** — passes in isolation, intermittent in suite. Pre-dates this session; worth tracking but not blocking. *(Fixed session 233.)*

---

## Session 230 (2026-05-24) — Context pane polish + chip lifecycle + reading-mode redesign

Refinement bout on the writing-context pane work. Captain's punch list converged on bug fixes (refresh recovery, preview clipping, alias label survival), graph polish (labels, hover-fade, recenter, ResizeObserver, tier density), and behavior changes (Featured/Planned/Potentials clarified, right-click unlink, backspace-on-chip unlinks first, reading mode hides the whole right pane).

### Big batches

**Graph**:
- Click recenters on any node (back-pill returns to narrative-centered view); Ctrl/Cmd+click navigates to that element.
- Hover-fade non-connected nodes (CSS-driven via per-node neighbor set).
- ResizeObserver re-projects layout (no sim re-run) when right pane is dragged.
- Tier-aware density: scene/draft cap 12 + 1-hop; chapter cap 6, direct only; book cap 4, direct only.
- Labels show full names (CSS handles ellipsis at 140px max-width).
- Native browser tooltip = name + description excerpt (200 chars).

**Featured/Planned/Potentials**:
- Cast rows mark Featured (filled cyan dot, sorted to top, full opacity) vs Planned (outlined ring, faded).
- Potentials column renamed from "Suggested" — reads more openly.
- `syncChipLabels` now treats canonical name OR any alias as a valid surface form (aliases survive).

**Chip lifecycle**:
- Backspace on the right edge of a chip → replaces chip with its label as text; subsequent Backspace deletes characters.
- Right-click on chip → "Unlink {label}" menu item. Replaces chip with text; if no other mention of the id remains in prose (chip OR name/alias text match), also removes id from narrative's link field.
- Right-click on autolink hint → "Link to {name}" — mouse alternative to Tab.

**Reading mode redesign**:
- Hides entire right pane via `.atlas-shell:has(.atlas-writing-workspace.is-reading-mode)` projection. Sidebar stays.
- Disables autolink hint underlines; mutes element chips to plain white underline (no cyan).
- No font override (writer's chosen font carries through).
- Esc exits both reading mode and focus mode.

**Spellcheck**:
- Per-world `writing_spellcheck` toggle in Settings → Writing (default true). Applied to contenteditable via `spellcheck` attr on every render.
- Autolink hint spans always carry `spellcheck="false"` so proper-noun element names don't get squiggle-lined.

**Bug fixes**:
- Refresh-while-context-tab-open: tab now subscribes BEFORE narrative-found check; recovers when elements arrive after mount (showed "Loading narrative…" empty state during boot window).
- Preview action buttons clipping: preview-host is now position:absolute with inset:0 over the lists area, giving the card a definite height so header + scrollable body + fixed-footer actions lay out correctly.
- Trailing-space-after-chip: dropped the `{type: 'text', text: ' '}` insert across all chip-insertion paths (Tab autolink, @ picker, add-to-cast selection-wrap, inline-create).
- Selection-as-alias label clobbered: syncChipLabels now preserves alias labels.

**Behavioral changes**:
- "+ add to story" button hides when Featured (already in prose); shown for Planned + Potentials; no-selection inserts chip at cursor (no separate Planned-only path); selection wraps as chip + creates alias.
- Preview closes after "+ add to story" click — lists return to view.
- Compiled view sections collapsible: chevron toggles fold/unfold; title navigates. Tier-specific icons.
- Element images dropped from preview (didn't lay out well at preview width).

**Top bar of context pane removed** — graph extends to the top edge. Tier selector was disabled (v2 feature) and label was redundant with the tab name.

### Touched modules

- `src/tabs/right/context-pane-graph.ts` — major rewrite for recenter + hover-fade + ResizeObserver + tier density + label improvements
- `src/tabs/right/context-pane-preview.ts` — absolute positioning fix + drop images + close-after-add + Featured detection (text-match aware)
- `src/tabs/right/context-pane-lists.ts` — Featured/Planned visuals + Potentials rename
- `src/tabs/right/writing-context-tab.ts` — boot-order recovery + chip-click-selection listener + drop top strip
- `src/middle/writing-workspace.ts` — chip right-click unlink handler + autolink right-click + spellcheck apply + Esc-exits-reading + chip-click dispatcher
- `src/middle/writing-workspace-add-to-cast.ts` — no-selection path now inserts chip (Planned-only field-write removed)
- `src/middle/writing-workspace-element-chip.ts` — Backspace handler unlinks
- `src/middle/writing-workspace-editor.ts` — syncChipLabels takes surface (name + aliases) instead of just name
- `src/middle/writing-workspace-autolink.ts` — exposes `findAutolinkCandidateAt` + `convertAutolinkAt` for the right-click menu; spellcheck=false on decorations
- `src/middle/writing-compiled.ts` — collapsible sections + tier-specific icons
- `src/middle/settings-panel.ts` — spellcheck toggle
- `src/core/types.ts` — `writing_spellcheck` on WorldRegistryEntry
- `src/styles/atlas.css` — all the visual changes above
- `tests/e2e/writing-workspace.spec.ts` — add-to-cast no-selection test rewritten for new semantic

### Tests + bundle

- vitest: 711 passing (unchanged)
- Playwright: 110 of 111 passing; "split: divides current narrative at cursor" intermittently flakes when run after autolink tests but passes consistently in isolation — known pre-existing brittleness, not regression from this bout *(fixed session 233)*
- Typecheck clean
- Production build clean

### Lessons

- **TypeScript JSDoc + angle brackets in comments**: `<id>` inside backticks within a JSDoc block tripped TypeScript's parser into "Type expected" errors at unrelated lines downstream. Lesson: prefer plain `//` comments for inline syntax examples; reserve JSDoc for stable doc surfaces.
- **`position: absolute; inset: 0` beats flex-sibling for slide-in overlays**: when a preview card needs a definite height to constrain its scrollable body + fixed footer, absolute positioning against a `position: relative` parent guarantees the geometry. Flex-sibling layouts can let nested content push the footer off-screen.
- **Alias-preserving label sync**: any "rename propagation" sweep that walks the document needs to know about ALL valid surface forms, not just the canonical name. Aliases are a feature of the chip system; the sync pass was clobbering them.
- **Tier-aware visual rules**: graphs at scene level want richness (1-hop adjacency); graphs at chapter/book level want clarity (direct relations only, smaller cap). One-size-fits-all caps don't work.

### Open follow-ups (next session)

1. **Global context pane** (big refactor) — make the context pane available outside writing mode. *(Shipped session 231.)*
2. **Graph v2 features** queued in DESIGN_WRITING.md: hierarchical tier-zoom (book → chapter → scene drill-down), zoom + pan, filter by element type, search/highlight.
3. **Compiled view editable** — v2 feature, requires range tracking from compiled text → source child for edit routing.

---

## Session 229 (2026-05-23) — Writing-room redesign + Context pane + Compiled view

After a deep design conversation with Captain about writer flows (drafting / contextual exploration / metadata editing) and the world-first vs story-first writer archetypes, agreed to: (1) make the writing room prose-pure, (2) move cast / details / references into a right-pane Context tab, (3) add a graph-central context layout, (4) support compiled view for parent narratives.

Executed 12 of 14 tasks autonomously. Code refactor first (foundation), then UI tightening, then context pane build, then compiled view. File split (#2) partial — extracted add-to-cast handler; deeper split deferred.

### Code quality fixes (foundation)

1. **Over-rendering in `refreshNonEditorSurfaces`** — guarded by el + elements ref identity. UI-only state ticks no longer trigger 6 DOM replacements. Massive reduction in churn during typing.
2. **Stale `(el as any).atlas_aliases` cast dropped** — was a leftover from Bout 1 of session 228.
3. **Cast-strip width fix** — `width: 760px` → `max-width: 760px` (later moot since cast strip moved to context pane, but the fix locked in the responsive-layout principle).

### UI tightening

4. **Sticky bar below header** — combines breadcrumb + date + action icons (focus, reading, open-as-element) in one row. Brighter, more legible. View-mode toggle joins it for parent narratives.
5. **Ambient word count corner** — bottom-right floating widget, always visible. Footer entirely dropped.

### Context pane (right pane, writing mode only)

6. **`writing-context` tab kind** added to `RightTabRef`. Lifecycle module hooks hash changes to insert/remove the ephemeral tab.
7. **Pane shell**: top strip + graph + below-graph (lists or preview).
8. **Force-directed graph** ported from cos-browser. Pure physics, no library, ~290 lines including DOM/canvas layer.
9. **Cast + Suggested lists** with mention counts, "why" tags, per-narrative dismissals.
10. **Element preview slide-in** that snaps snug against graph bottom when active. Backlinks folded in as "Appears in: …".

### Cross-cutting

11. **Add-to-cast unified with aliases** — selection becomes alias automatically. One source of truth for alternate names.
12. **Compiled view** for parent narratives — read-only assembly + clickable child markers. Mini markdown renderer keeps the bundle lean.
13. **Removed old cast/details/refs** from writing room. Files deleted: `writing-workspace-cast-strip.ts`. Functions removed: `renderDetailsDisclosure`, `renderReferencesDisclosure`.

### New / touched modules

- `src/middle/writing-compiled.ts` (295) — compiled view + mini markdown renderer + tree assembly
- `src/middle/writing-workspace-add-to-cast.ts` (130) — extracted handler with alias logic
- `src/tabs/right/writing-context-tab.ts` (171) — orchestrator for the pane shell
- `src/tabs/right/writing-context-lifecycle.ts` (113) — hash-driven tab insert/remove
- `src/tabs/right/context-pane-graph.ts` (293) — force-directed sim
- `src/tabs/right/context-pane-lists.ts` (333) — Cast + Suggested
- `src/tabs/right/context-pane-preview.ts` (214) — slide-in element preview
- `tests/unit/writing-compiled.test.ts` (18 tests) — locks in tree assembly + markdown rendering

### Test count growth

- Vitest: 693 → 711 (+18 for writing-compiled unit tests)
- Playwright: 110 → 110 (1 spec rewritten for context pane; reading-mode spec passes after fixing Esc-exits-reading + sticky-bar visibility)

### Lessons (durable, added this session)

- **Reading mode must keep the exit affordance accessible.** Hiding the sticky bar in reading mode trapped the user. Fix: keep the bar visible (fade the breadcrumb half), keep action icons crisp, AND wire Esc as an alternate exit. Same rule applies to focus mode (already worked because it had Esc; now also has an icon).
- **`display: none` between siblings + slot-snug overlay > absolute-positioned overlay.** The element preview replaces the lists by toggling display between them — no z-index fight, no scroll position loss, no layout shift, perfect seam against the graph's bottom edge. Cleaner than overlay positioning.
- **Pure-physics force sims port cleanly between tools.** The cos-browser pattern (synchronous run + canvas edges + DOM nodes) adapted to atlas in ~290 lines including layout fitting. No dependency added. Sub-50ms simulation cost for typical cast sizes (< 30 nodes).
- **Mini markdown renderer beats hauling in a parser.** ~80 lines covers paragraphs / headings / lists / blockquotes / bold / italic / code / links / chips. Not perfect coverage but matches what narrative prose contains. Adding markdown-it would have been ~30 KB minified.
- **Aliases as the single source of truth for "alternate names" is the right call.** Captain's intuition (add-to-cast on selection creates an alias) collapsed two parallel mechanisms into one. Autolink + @ picker both already consume aliases. The selection-becomes-alias path means writers don't have to open an aliases editor manually for the common case.

### Open follow-ups

1. **Deeper file split for `writing-workspace.ts`** — still ~1090 lines. *(Done session 232.)*
2. **Compiled view: editable mode** — v2 feature. Range tracking from compiled text back to source child + edit-routing. Needs its own design conversation.
3. **Context pane: tier zoom** — selector in the top strip is rendered but `disabled`. v2: at chapter level, graph shows scene clusters; at book level, chapter clusters.
4. **Context pane: relation-type coloring** — currently all edges are cyan. Red for rivalry/conflict, etc. — needs Relation element schema lookup.
5. **DESIGN_WRITING.md** — update with v3 compiled-view section + context-pane architecture. *(Done.)*
6. **Smoke-test against AtlasMoppetopia** — exercise the context pane against Skeld's real-world data. Should confirm graph layout works at realistic cast sizes (~20 characters per scene typical).
7. **Reading + focus mode chrome rules** — verify the new "keep sticky bar visible" rule doesn't make reading-mode feel too busy. May need to further fade the bar's chrome or add a small "thin strip" mode.
