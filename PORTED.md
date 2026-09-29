# Atlas — Port Log

Tracks what code/conventions were ported from `tools/atlas-deprecated/` into the new atlas, and HOW.
Also tracks ports from other tools (e.g. zoner) where their patterns informed atlas modules.

Each entry: source file, destination, treatment (verbatim, adapted, rewritten), why.

---

## Zones subsystem foundation (2026-05-16 session 213)

The zone/marker subsystem is largely a fresh build for atlas — but several pure-function helpers were adapted from zoner's `canvas/ZoneCanvas.ts` (audit log captured pre-build, summarized in `DESIGN_ZONES.md` §1.1 and the zoner-audit agent report).

| Source (zoner) | Dest (atlas) | Treatment | Notes |
|---|---|---|---|
| `zoner/src/canvas/ZoneCanvas.ts:322-347` (distance-to-segment math) | `src/visualization/leaflet-2d/ZoneGeometry.ts` (`distanceToSegment`, `distanceToSegmentSquared`, `projectToSegment`) | adapted to pure functions | Same clamped-projection algorithm. Returns Point shapes instead of mutating Leaflet primitives. Squared-distance variant added for cheap nearest-segment iteration. |
| `zoner/src/canvas/ZoneCanvas.ts:293-316` (`findClosestSegment` proximity scan) | `src/visualization/leaflet-2d/ZoneGeometry.ts` (`findClosestSegment`) | adapted | Added explicit `closed` parameter so polygons include the wrap segment; null return for <2 points. |
| `zoner/src/canvas/ZoneCanvas.ts:745-754` (centroid by vertex averaging) | `src/visualization/leaflet-2d/ZoneGeometry.ts` (`polygonCentroid`) | verbatim algorithm | Simple average. Not area-weighted; matches zoner's pragmatic choice for label/handle placement. |
| (new in atlas) | `src/visualization/leaflet-2d/ZoneGeometry.ts` (`polylineLabelAnchor`) | rewritten | Midpoint of the longest segment — chosen for line-label placement so the label has visual room. |
| (new in atlas) | `src/visualization/leaflet-2d/ZoneGeometry.ts` (`pointInPolygon`) | rewritten | Standard ray-casting algorithm. Used for future hit-testing without Leaflet (zoner had this implicitly via L.Polygon click). |
| (new in atlas, Captain-requested) | `src/visualization/leaflet-2d/ZoneGeometry.ts` (`snapAngleTo45`, `snapToAxis`) | new | Shift-snap math — projects a click vector onto the nearest 45° axis from anchor. Clamps to non-negative projection so the new marker is always forward-of-anchor or AT anchor. Enables perfect rectangles via 4 shift-clicks. |
| `zoner/src/canvas/ZoneCanvas.ts:397-450` (DivIcon marker rendering during draw) | `src/tabs/right/zone-drawing.ts` (preview render via L.DivIcon) | adapted | Cyan circle + numbered order. CSS class `.atlas-zone-draft-marker` mirrors zoner's `.marker-number` visual. Live preview polyline rendered via `L.polyline` with `dashArray: '5, 5'`. |
| `zoner/src/canvas/ZoneCanvas.ts:456-476` (live preview polygon/polyline) | `src/tabs/right/zone-drawing.ts` (rerenderPreview) | adapted | Same dashed-cyan visual. Polygon closes back when ≥3 markers; line stays open. |
| `zoner/src/state/AppState.ts:332-375` (drawing state machine) | `src/tabs/right/zone-drawing.ts` (module-level singleton) | rewritten cleaner | Atlas uses a module-level singleton with `start/place/undo/finish/cancel` API rather than zoner's tangle of `activeMarkers` + `editingZoneId`. **Improvements over zoner**: batch save on Finish (not per-marker autosave), explicit cancel-via-ESC, integrates with state.ui slice. |
| Zoner DESIGN.md (sync pattern: in-memory points → markers at sync time) | atlas folder-first model (markers ARE the disk truth from creation) | rewritten | Atlas materializes markers at write time (folder is the truth, per atlas's folder-first principle); zoner deferred to sync time. Cleaner because atlas always has the canonical representation regardless of api-link state. |
| Auto-numbered name pattern ("new zone", "new zone (2)") | `src/tabs/right/zone-drawing.ts` (`findUniqueZoneName`) | rewritten | Same idea; pure function so it can be unit-tested without UI. 6 unit tests in `tests/unit/zone-drawing.test.ts`. |

**Things from zoner explicitly NOT ported** (yet, or by choice):

- **HistoryManager** (zoner's `zoner/src/state/HistoryManager.ts`): a per-map snapshot stack with JSON clone, max 50 entries. Atlas needs this for shape-edit cancel-via-restore (DESIGN_ZONES.md §3.4). Not in v1; lands with the shape-edit-mode bout.
- **Click-timeout debouncing** for single vs double click (zoner's ZoneCanvas.ts:546-549, 579-584): janky global timeout pattern. Atlas defers to Leaflet's native dblclick event ordering (or skips entirely — atlas doesn't currently bind double-click on zone outlines).
- **Snap-to-existing-vertex** (zoner's ZoneCanvas.ts:1041-1074, ctrl+hover within 20px screen radius): nice UX, deferred to a polish bout.
- **Box-select / multi-zone-move** (zoner's ZoneCanvas.ts:1081-1164): not in v1 scope (DESIGN_ZONES.md §10 out-of-scope).
- **Per-zone z-index ordering** (no zoner equivalent — would need design): deferred.
- **`originalEditPoints` state backup** (zoner's AppState.ts:36, 507): planned replacement is HistoryManager when shape-edit ships.

---

## map-tab.ts split (2026-05-16 session 212 Bout SP)

Long-term-health refactor — not a port from legacy, but a restructure of new-atlas code. `map-tab.ts` had accreted to 858 lines doing 5 concerns; split into single-concern submodules so per-concern unit tests become viable in future bouts.

| File | Lines | Contents |
|---|---|---|
| `src/tabs/right/map-tab.ts` | 470 | Mount/dispose/pan + interaction wiring (click, contextmenu, drag, drop) + subscribe hot path |
| `src/tabs/right/map-tab-cache.ts` | 45 | `MapTabCacheEntry` type + `mapTabCache` Map (shared) |
| `src/tabs/right/map-tab-pins.ts` | 149 | `syncPins`, `refreshChipStrip`, `refreshActiveMapPins` |
| `src/tabs/right/map-tab-pin-drag.ts` | 129 | `enablePinDrag`, `isInsideZone`, `clampToCanvas` |
| `src/tabs/right/map-tab-backgrounds.ts` | 144 | `applyMapBackground`, `sourceKey`, `refreshCachedBackgrounds`, `decodeImageDims` |
| `src/tabs/right/map-tab-tooltip.ts` | 32 | `buildPinTooltipHtml`, `escapeHtml` |

Public surface unchanged: `mountMapTab` / `disposeMapTab` / `disposeAllMapTabs` / `panMapTabTo`. One internal test path updated: `tests/unit/pin-drag.test.ts` imports `enablePinDrag` from `map-tab-pin-drag` instead of `map-tab`. All 385 vitest still pass after split.

---

## index.html inline-style reset (2026-05-12 session 199)

| File | Source | Treatment | Notes |
|---|---|---|---|
| `tools/atlas/index.html` | `tools/atlas-deprecated/index.html` inline `<style>` block | adapted | The Phase 2 rebuild dropped the legacy inline style; restored as a single block. Critical fixes restored: (1) `html, body { margin: 0; padding: 0; height: 100%; overflow: hidden }` — without this, body's default 8px margin makes the shell overflow and leak browser-default body bg as a thin border on right/bottom. (2) System-font stack `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ...` — without this, `<h2>` elements default to Times New Roman serif. (3) `-webkit-font-smoothing: antialiased`, `-moz-osx-font-smoothing: grayscale`, `text-rendering: optimizeLegibility` — font crispness parity with legacy. Belt-and-braces also added `background: #0a0a0a` on body so any future overflow stays dark. |

This duplicates rules that the legacy got via `onlyworlds-base.css` (imported into legacy `main.ts`). The new atlas deliberately doesn't import `onlyworlds-base.css` (too many side-effects for the focused atlas surface) — only the body/font subset that matters is pulled into the inline style.

## Phase 6 Bout D (Timeline + sync pill + worlds favorites, 2026-05-12 session 199)

| File | Source | Treatment | Notes |
|---|---|---|---|
| `src/middle/timeline.ts` | `atlas-deprecated/src/middle/timeline.ts` (254 lines) | adapted | Same layout algorithm (date parse + nice ticks + dot positioning). Reads from `state.data.elements` array (filter type==='event'). Click dot → navigate to element detail. Empty state preserved. |
| `src/middle/welcome-panel.ts` | self | small addition | Active-world view gained a "view timeline →" CTA. |
| `src/sidebar/worlds-sidebar.ts` | self | small addition | Favorites star button in `.atlas-inline-actions` (visible-on-hover or when starred). `setFavorite` registry helper wired. List sort: favorites first, then alphabetical. |
| `src/tabs/right/right-pane.ts` | self | small addition | `renderSyncIndicator(state)` mounts pill to `document.body` (fixed-positioned via legacy CSS). data-state="local|api|none". The legacy `.atlas-sync-pill` CSS expected `.atlas-sync-pill-dot` child — used as-is. |
| `src/layout/app-shell.ts` | self | small addition | `rightTabBar` element gained `.atlas-right-tab-bar` class for explicit flex layout. |

CSS additions (`src/styles/atlas.css`, ~30 lines): new state colors for the sync-pill dot (local=grey, api=cyan), tab bar layout class, welcome action row, favorite-star color states.

## Phase 6 Bout C.5 (Visual polish — align components to legacy aesthetic, 2026-05-12 session 199)

Refactor pass — no new ports, but aligns Bout A/B/C components to use legacy CSS instead of bespoke classes.

| File | Treatment | Notes |
|---|---|---|
| `src/sidebar/sidebar.ts` | adapted | Mode toggle uses `.atlas-mode-btn` (legacy) instead of `.atlas-sidebar-mode-btn` (new). Worlds tab carries OW logo via `.atlas-mode-ow-icon` like legacy. |
| `src/sidebar/worlds-sidebar.ts` | adapted | List uses `.atlas-list` + `.atlas-row` + `.atlas-row-main` markup. Folder/cloud icon based on state. State chip `.atlas-world-state-chip api-linked`. |
| `src/sidebar/elements-sidebar.ts` | adapted | Same `.atlas-list` + `.atlas-row` swap. Header is `.atlas-elements-header` (slim flex row). Search row uses `.atlas-search-row`. Empty state uses `.atlas-pane-empty`. |
| `src/tabs/right/map-index-tab.ts` | adapted | Same. Header uses `.atlas-section` + `.atlas-section-title`. Rows use `.atlas-row`. Inline action for delete in `.atlas-inline-actions`. |
| `src/middle/element-detail.ts` | adapted | Header now uses legacy `.atlas-middle-header` (icon + h2 + spacer + icon-btn-sm). Body uses `.atlas-middle-body` + `.atlas-detail`. Pin button uses `.atlas-icon-btn-sm` with `.active` modifier (matches legacy). |

CSS cleanup: stripped ~270 lines of duplicate component CSS that conflicted with legacy. Bundle CSS dropped from 52.96 KB to 47.44 KB. Test selectors updated across `phase2-ui`, `phase4-elements`, `phase4-schema-editor`, `phase5-maps` to match new class structure.

## Phase 5 Bout C (Map tabs + Leaflet + pin placement, 2026-05-12 session 199)

| File | Source | Treatment | Notes |
|---|---|---|---|
| `src/tabs/right/right-pane.ts` | new | rewritten | Right-pane driver. Tab bar + body dispatch. Wraps each map tab in a `.atlas-right-tab-group` div so the close button is a SIBLING (not nested inside another button) — avoids nested-button DOM and event-bubbling complications. `closeMapTab` navigates away from `/map/<mid>` first if the URL still names this map (prevents `ensureMapTabOpen` from re-adding the tab on the next state tick). |
| `src/tabs/right/map-index-tab.ts` | `atlas-deprecated/src/tabs/right/map-index-tab.ts` (316 lines) | adapted | Simpler — drops location-group sections and per-world favorites for v1 (defer to Bout D polish). Reads from `state.data.elements` filtered by `type === 'map'`. Pin counts via `type === 'pin'` matching `map_id`. `openMapTab(m)` exported for app.ts auto-open on `/map/<mid>` route. |
| `src/tabs/right/map-tab.ts` | `atlas-deprecated/src/tabs/right/map-tab.ts` (506 lines) | adapted | Full Leaflet wiring. Module-level cache keyed by mapId. Background prefers local media (FolderStore.getMediaBlob) → image_url → grid. `syncPins(entry)` reads pins from `state.data.elements`. Pin click → element detail nav. Hover → tooltip. Right-click → contextual element-create + pin drop. `disposeAllMapTabs` called on world switch in right-pane. Drag-from-list deferred (`atlas/pin-placement` button is the primary flow for v1). |
| `src/ui/map-create-modal.ts` | `atlas-deprecated/src/ui/map-create-modal.ts` (331 lines) | adapted | BaseModal subclass. FolderStore.createMap + addMedia for local image. Location field uses element-picker-modal with `restrictToType: 'location'`. Image dims decoded before create so initial record carries them. |
| `src/middle/element-detail.ts` | self | small addition | Header gets a pin button when `ui.rightTabs[rightActiveIndex]` is a map tab. Click toggles `ui.pinPlacement`; map click while placement is active drops the pin. |
| `src/main.ts` (test harness) | self | small addition | Exposes `getState`, `getActiveStore`, `patchData` so Playwright specs can verify state and inject FolderStore-derived element lists. |

State extensions (`src/core/state.ts`): `ui.rightTabs: RightTabRef[]` (always begins with implicit `map-index`), `ui.rightActiveIndex`, `ui.pinPlacement`. `RightTabRef` discriminated union: `{kind: 'map-index'}` | `{kind: 'map', mapId, label}`. Router (`src/core/router.ts`): `mode === 'map'` with optional chained `/element/<eid>` parsing.

CSS additions (`src/styles/atlas.css`, ~150 lines): right-pane tabs + close button + tab group wrapper, map index pane + rows + pin-count badge, map-create-modal location row, active pin button highlight.

## Phase 4 Bout B (Schema-driven detail + picker + relations, 2026-05-12 session 199)

| File | Source | Treatment | Notes |
|---|---|---|---|
| `src/middle/element-detail.ts` | `atlas-deprecated/src/middle/element-detail.ts` (502 lines) | adapted (rewrite of Bout A's minimum) | Same shape as legacy: header + sections (Base always-expanded + schema sections collapsible) + Referenced-By + footer. Per-field dispatch by widget (text-short / text-long / number → popover; single-link / multi-link → chip + picker). Reads schema via `sectionsFor(el.type)` from already-ported `field-schema.ts`. Persists via FolderStore.updateElement → refresh `data.elements` with new array ref. `collapsedSections` Set at module level (survives re-render). `forceRerender` helper emits `data.elements` with a new array ref to trigger subscribers after collapse-toggle. Reverse-scan for "Referenced By" walks all fields per SDK-shape-agnostic convention #5 (string/array-of-strings/array-of-objects-with-id/object-with-id). |
| `src/ui/element-picker-modal.ts` | `atlas-deprecated/src/ui/element-picker-modal.ts` (266 lines) | adapted | BaseModal subclass (consistent with new modal patterns). `pickElement(opts) → Promise<Element\|null>` API preserved. Reads from `state.data.elements` (array, not Record). Search + type strip + 200-row cap intact. Escape/click-outside both resolve null. Excludes pin/marker/zone from type strip (they're map artifacts). |

CSS additions (`src/styles/atlas.css`, ~130 lines): picker panel layout, picker title/search/strip/list/row, referenced-by chip refinements with type-colored leading icon, refs count badge.

Legacy `state.data.elements` was `Record<id, Element>`; new is `Element[]`. All reads via `.find(e => e.id === id)` or `.filter(...)`. No noticeable perf cost at OW worldscale.

## Phase 4 Bout A (Elements sidebar + minimum detail + create modal, 2026-05-12 session 199)

| File | Source | Treatment | Notes |
|---|---|---|---|
| `src/sidebar/sidebar.ts` | new (informed by legacy `app-shell.ts` sidebar wiring) | rewritten | Mode-toggle driver lives in `shell.sidebarToggle`. Mounts/unmounts body component by mode. Owns footer gear (extracted from worlds-sidebar). Mode is derived from URL; toggle button just navigates. |
| `src/sidebar/worlds-sidebar.ts` | self | refactored | Renamed `mountWorldsSidebar` → `mountWorldsBody`, dropped footer gear (now in sidebar driver). Also primes `data.elements` cache + resets selection on `activateWorld`. All `data-action` attributes preserved (tests pass unchanged). |
| `src/sidebar/elements-sidebar.ts` | `atlas-deprecated/src/sidebar/elements.ts` (196 lines) | adapted | Same shape (filter strip + search + list) but reads from FolderStore-backed `state.data.elements` instead of api-store. Sort by name. Pin/marker/zone excluded from list (those are map artifacts). Filter strip covers 18 content types + map. |
| `src/middle/element-detail.ts` | `atlas-deprecated/src/middle/element-detail.ts` (502 lines) | adapted, MINIMUM CUT | Bout A version handles name + description only via popover edit. Header with type icon + delete button (uses `findDependents` for confirm count, follows cascade-delete contract). Bout B will expand to schema-driven rendering with ELEMENT_SECTIONS + FIELD_SCHEMA + relation pickers. |
| `src/ui/element-create-modal.ts` | `atlas-deprecated/src/ui/element-create-modal.ts` (322 lines) | adapted | BaseModal subclass (matches new modal pattern). FolderStore.createElement instead of api-store. Patches `data.elements` with a new array reference (force-rerender). Type grid covers all 18 content element types (no autocomplete ghost yet — defer to polish bout). |
| `src/setup/atlas-root-flow.ts` | self | small fix | `createWorldInRoot` now also resets `data.elements: []` + `selectedElementId: null` on world switch. |
| `src/middle/settings-panel.ts` | self | small fix | Delete-world flow also clears the elements cache + selection. |

State shape extended (`src/core/state.ts`): added `data: DataState` slice (`{ elements: Element[] }`) and `ui: UiState` slice (`sidebarMode`, `selectedElementId`, `elementFilters`, `search`). `MiddleMode` gained `'element'`. Router (`src/core/router.ts`) extended with `elements`/`element` route modes + helpers `elementsHash`, `elementHash`.

CSS additions (`src/styles/atlas.css`, ~210 lines): mode toggle in sidebar header, elements list rows, detail field rows, generic empty state, ow-btn-ghost variant.

## Phase 2 polish (Bouts 4-6 — Atlas root + refinements, 2026-05-12 session 198)

| File | Source | Treatment | Notes |
|---|---|---|---|
| `src/setup/atlas-root-flow.ts` | new | rewritten | `setupAtlasRoot` with wrap-by-default + re-use detection, `discoverWorldsInRoot` (imports world subfolders into a fresh registry), `createWorldInRoot` (name-only creation under root), `slugify`. |
| Registry: `atlas_root` field | new | rewritten | `setAtlasRoot` / `clearAtlasRoot` helpers; `loadRegistry` now spreads parsed payload (was hand-picking and dropping new fields). |
| State: `atlasRoot` slice | new | rewritten | Runtime ref to the configured root; hydrated on boot via `hydrateAtlasRoot`. |
| Router: `#/settings` standalone | new | rewritten | Settings panel reachable without an active world (gear icon now works on first-launch). |
| `core/constants.ts` additions | new | n/a | `ATLAS_ROOT_HANDLE_KEY`, `ATLAS_ROOT_MARKER` (`.atlas-root`), `ATLAS_ROOT_SUBFOLDER` (`onlyworlds-atlas`), `ATLAS_ROOT_SUBFOLDER_LEGACY_NAMES` (`['atlas-worlds']`). |

UI panels (welcome, sidebar header, settings) all switch on `state.atlasRoot` presence: no root → setup CTA, root → create-local / world list.

## Phase 2 (Bout 3 — Minimal UI, 2026-05-12 session 198)

| File | Source | Treatment | Notes |
|---|---|---|---|
| `src/layout/app-shell.ts` | `atlas-deprecated/src/layout/app-shell.ts` | adapted (verbatim minus constant rename) | `SHELL_RATIO_KEY` → `SHELL_RATIOS_STORAGE_KEY`. Otherwise identical 3-pane layout + draggable dividers + ratio persistence. |
| `src/core/state.ts` | new | rewritten | Tiny observable: getState, patchSlice, subscribe. Same idiom as legacy but ~30 lines instead of a class. |
| `src/core/router.ts` | new (inspired by legacy) | rewritten | Hash-based, Phase 2 routes only (`#/`, `#/w/<id>`, `#/w/<id>/settings`). Will extend in later phases. |
| `src/sidebar/worlds-sidebar.ts` | new | rewritten | Different from legacy — registry-driven, no api-store coupling, FsFolderStore activation flow. |
| `src/ui/create-world-modal.ts` | new | rewritten | Legacy's link-world-modal handled api/local elsewhere; new is single-purpose with `pickDirectory()` injection seam. |
| `src/ui/directory-picker.ts` | new | rewritten | Single indirection over `window.showDirectoryPicker` with test-API override. |
| `src/middle/welcome-panel.ts` | new | rewritten | Replaces legacy's timeline-as-default with a stat-based welcome (placeholder until Phase 4). |
| `src/middle/settings-panel.ts` | new | rewritten | Identity + active-world meta + forget-world. Make-Online actions arrive in Phase 3. |
| `src/app.ts` | new | rewritten | Smaller than legacy `app.ts`; orchestrates shell + sidebar + routed middle. |

UI primitives `modal-base.ts`, `toast-manager.ts`, `field-edit-popover.ts` were already ported verbatim in Bout 9 of session 197. This bout's only modification: exported `ToastManager` class (was private) so subsystems can hold a typed reference to the singleton.

CSS additions: ~190 lines appended to `atlas.css` for Phase 2 components (sidebar worlds list, welcome panel, settings, modal fields, button primitives `.ow-btn`).

## Phase 1 (Bout 2 — Real FolderStore, 2026-05-12 session 198)

The legacy had no real FolderStore — its store layer was IDB-cached, not folder-first. So these are **fresh writes**, not ports. Logged here so future-readers know what landed when.

| File | Source | Notes |
|---|---|---|
| `src/store/fs-utils.ts` | new | Atomic write (tmp + verify + promote), corruption-tolerant `readJson`, dir helpers. `idFromFilename` roundtrip. |
| `src/store/idb.ts` | new | Minimal promise-wrapped IDB primitives. **Only** used by handle-vault — world data stays in the folder. |
| `src/store/handle-vault.ts` | new | `FileSystemDirectoryHandle` persistence keyed by `handle_key`. `ensureWritable` does the per-session permission re-grant. |
| `src/store/folder-store-fs.ts` | new | Full FsFolderStore. One-file-per-element on disk (content + spatial uniformly). 30s heartbeat lock with 90s stale TTL. Media sidecar `*.meta.json` for browsable filenames. |
| `src/vite-env.d.ts` | new | `/// <reference types="vite/client" />` — enables `import.meta.env.DEV` for the dev-only test harness. |

**Layout decision**: pins/zones/markers stored as one file per element under `spatial/<type>/<id>.json` (not bundled per map as the legacy DESIGN suggested). Bundle-per-map was never implemented; uniform one-file-per-element is simpler and works fine for OW scale.

> **SUPERSEDED 2026-07-28 (S334)**, recorded rather than rewritten because this file is a decision log. The one-file-per-element half stands and is now the format. The `spatial/` directory half was overturned: `elements/<type>/` is the Folder Format for all 22 types, atlas reads both as a union and writes `elements/` for new worlds. The split was never semantic, and it silently hid maps, pins, zones and markers in worlds written by any other tool. See DESIGN_FOLDER.md "The union read".

---

## Phase 1.5 (UI primitive ports, 2026-05-12)

Mechanical ports of architecture-agnostic UI primitives. All files have zero coupling to storage or sync layers — port verbatim and they slot under any future shell.

### UI primitives + schema

| Source | Dest | Treatment | Notes |
|---|---|---|---|
| `src/ui/modal-base.ts` | `src/ui/modal-base.ts` | verbatim | BaseModal class — extends pattern, ESC + click-outside, smooth cleanup |
| `src/ui/toast-manager.ts` | `src/ui/toast-manager.ts` | verbatim | Queue-based, max 3, XSS-safe message escape, success/error/info |
| `src/ui/field-edit-popover.ts` | `src/ui/field-edit-popover.ts` | verbatim | Floating popover anchored to field, Enter to save, Esc cancel, smart viewport positioning |
| `src/editor/field-schema.ts` | `src/editor/field-schema.ts` | verbatim | SDK FIELD_SCHEMA + ELEMENT_SECTIONS adapter, BASE_FIELDS, resolveWidget |
| `src/styles/atlas.css` | `src/styles/atlas.css` | verbatim (replaced base) | 1491 lines — full 3-pane shell styling, color tokens, components |

### Spatial primitives

| Source | Dest | Treatment | Notes |
|---|---|---|---|
| `src/visualization/leaflet-2d/Leaflet2DManager.ts` | same | verbatim | 895 lines — Leaflet wrapper, lifecycle cache, pin/zone/marker layers, fitBounds, zoom defaults |
| `src/visualization/leaflet-2d/CoordinateUtils.ts` | same | verbatim | Leaflet ↔ storage coord transforms, generateId helper |
| `src/visualization/leaflet-2d/types.ts` | same | verbatim | Spatial type definitions |
| `src/visualization/leaflet-2d/index.ts` | same | verbatim | barrel exports |
| `src/tabs/right/pin-visuals.ts` | same | verbatim | Canvas-rendered Material Symbols per element type |
| `src/tabs/right/edge-color.ts` | same | verbatim | Image edge sampling for pane background |

### Constants / SDK re-export

| Source | Dest | Treatment | Notes |
|---|---|---|---|
| `src/core/constants.ts` ELEMENT_ICONS | added to existing constants.ts | adapted | Re-export from `@onlyworlds/sdk` with strict typing |

### Verification
- typecheck clean
- 67 tests passing (no functional change — ports aren't yet wired into main.ts so they're tree-shaken from the bundle, will land when Phase 2 imports them)
- vite build clean: 25.58 KB CSS / 1.14 KB JS (bundle unchanged — ports unreferenced until shell wires up)

## Phase 0 (foundation, 2026-05-12)

### Configuration files (verbatim or near-verbatim)

| Source | Dest | Treatment | Notes |
|---|---|---|---|
| `vite.config.ts` | `vite.config.ts` | verbatim | `base: './'`, port 3045 |
| `tsconfig.json` | `tsconfig.json` | near-verbatim | added `types: ['node']`, included `tests/`, excluded `tests/e2e/` |
| `vitest.config.ts` | `vitest.config.ts` | adapted | added `tests/e2e/**` to exclude |
| `index.html` | `index.html` | adapted | linked `src/styles/atlas.css` directly (legacy embedded styles inline) |
| `public/favicon.{ico,png}` | same | verbatim | copied |
| `public/owlogo.png` | same | verbatim | copied |

### Test infrastructure (adapted)

| Source | Dest | Treatment | Notes |
|---|---|---|---|
| `tests/setup.ts` | `tests/setup.ts` | adapted | Same pattern (MSW + fake-IDB + onLine pin). Comment refreshed for folder-first reality |

### Conventions (re-stated in new DESIGN.md)

All 10 critical conventions from legacy DESIGN.md were carried into new DESIGN.md verbatim (with minor wording polish). Plus 4 new ones for folder-first model:

- 11: FolderStore stamps `local_updated_at` on every write
- 12: Tombstones append before file unlink
- 13: One writer per folder via lock file
- 14: Element files are the schema (`type` field authoritative)

### NOT yet ported (deferred to later phases)

Everything UI-side awaits Phase 4-5. These will come in deliberate, file-by-file ports:

- `atlas-deprecated/src/layout/app-shell.ts` — 3-pane shell
- `atlas-deprecated/src/layout/tab-bar.ts`
- `atlas-deprecated/src/sidebar/{worlds,elements}.ts`
- `atlas-deprecated/src/middle/{element-detail,timeline,settings}.ts`
- `atlas-deprecated/src/tabs/right/{map-index-tab,map-tab,pin-visuals,edge-color}.ts`
- `atlas-deprecated/src/visualization/leaflet-2d/Leaflet2DManager.ts`
- `atlas-deprecated/src/media/media-section.ts`
- `atlas-deprecated/src/editor/field-schema.ts`
- `atlas-deprecated/src/ui/{element-create-modal,field-edit-popover,element-picker-modal,map-create-modal,modal-base,toast-manager}.ts`
- `atlas-deprecated/src/router.ts`
- `atlas-deprecated/src/styles/atlas.css` (only base tokens are in new copy so far)

Storage layer is NOT ported — fully rewritten:

- `atlas-deprecated/src/store/api-store.ts` (~700 lines) → REPLACED by `src/sync/sync-engine.ts`
- `atlas-deprecated/src/store/api-cache.ts` (~400 lines) → REPLACED by folder + timestamps
- `atlas-deprecated/src/store/pending-ops-queue.ts` (~200 lines) → REPLACED by timestamp diff + tombstones
- `atlas-deprecated/src/store/router.ts` (WorldStoreRouter) → no longer needed (one store)
- `atlas-deprecated/src/store/api-client-factory.ts` → REPLACED by SyncEngine ow-client-adapter (Phase 1)
- `atlas-deprecated/src/store/world-store.ts` → REPLACED by `src/store/folder-store.ts` (renamed, narrowed contract)
- `atlas-deprecated/src/store/local-store.ts` → DROPPED (orphaned Phase 1 IDB experiment)
- `atlas-deprecated/src/store/idb.ts` → MINIMAL (only for handle-vault, not world data)
- `atlas-deprecated/src/store/fs-utils.ts` — will port adapted in Phase 1

UI rewrites (architecture-coupled, can't port verbatim):

- `atlas-deprecated/src/ui/link-world-modal.ts` → REWRITE in Phase 3 (now does initial download, not just registry add)
- `atlas-deprecated/src/ui/sync-indicator.ts` → REWRITE in Phase 2 (attaches to SyncEngine, not ApiStore)
- `atlas-deprecated/src/middle/settings.ts` (sync section) → REWRITE in Phase 2

---

## How to add to this log

When you port a file:

1. Read the legacy file
2. Decide: verbatim, adapted, or rewritten (rewrite if storage-coupled)
3. Note here under the appropriate phase section: source path, dest path, treatment, notes
4. If adapted, the entry should be enough for a future-reader to know what changed and why

When you reject a file:

1. Add to "NOT ported" / "DROPPED" list with reason
2. If it has a replacement, point to the replacement
