# Atlas — Progress Log

Operational state. Architecture in **DESIGN.md** (+ `DESIGN_MAPS.md`, `DESIGN_ZONES.md`). Sync lessons in **SYNC_NOTES.md**. Session-by-session history archived to `docs-archive/PROGRESS-history.md`.

---

## CURRENT STATE (handover snapshot, 2026-05-18 session 223)

Tool is in a tight, healthy state. **572 vitest green + 93 Playwright green.** Bundle 516 KB JS / 146 KB gzipped (+28 KB this session for rooms + timeline-bar). Typecheck clean. Conventions list 1-36 (full text in DESIGN.md).

**Rooms model landed.** The middle pane is now a flex column with a persistent room nav strip + room content. World Home is the default landing for active worlds. See `DESIGN_HOME.md` + `DESIGN_WRITING.md` + `DESIGN_PUBLISHING.md` for the new room-specific docs.

**Recent invariants worth knowing**:
- Middle pane: `shell.middleRoomNav` + `shell.middleContent` (renderers MUST target `middleContent`, never `middle` — convention #31)
- Default route bare `#/w/<id>` → home room (was timeline)
- Esc + click-selected-row clear selection + nav home (convention #32)
- Writing labels customizable in Settings → Writing (`registry.writing_labels`, convention #33), default Book/Chapter/Scene
- Writing depth cap = 3 levels (convention #34)
- Showcase config supports `atlas_*` extensions (convention #35)
- Showcases immutable; republish creates new (convention #36)
- Sentence case throughout, slug-prefix filenames (`<slug>--<uuid>.json`)
- Hotkeys MVP wired (`Ctrl/Cmd+E`, `S`, `K`, `?`, `Esc` deselect-to-home, map-tab `F`/`Z`/`L`)
- Map view persists per-map (`{center, zoom}` saved on `moveend`, restored at mount)
- Pin badge accurate (only on Locations that have a sub-map)
- Sync pill shows "synced 3m ago" live (30s tick)
- `atlas_shape` stripped on wire; both fakes (FakeOwApiClient + MSW) strictly reject atlas-local fields in write bodies
- Welcome panel is single CTA for atlas-root setup/recover
- All "engine not ready" toasts route through `surfaceSyncUnavailable` for PIN-aware messages + deep-links

---

## Three big projects ahead — session 223 update

Foundation landed for all three this session via the rooms model. Each still has its own bigger build ahead.

- **Writing** — `src/middle/writing.ts` shell + Book/Chapter/Scene tree shipped; richtext editor + autolinking + word count + outline mode all deferred. See `DESIGN_WRITING.md` "Deferred design questions" for the next set of decisions.
- **Timeline** — `src/visualization/timeline/timeline-bar.ts` ported from little-element-viewer with multi-row dot binning. Compact mode on World Home, expanded mode in `#/w/<id>/timeline`. Narrative bars, zoom/pan, filter toggles, expand-collapse all deferred.
- **Publish** — `src/middle/publish-room.ts` stub. write-tool's `/showcase/publish/` API documented in `DESIGN_PUBLISHING.md`. Atlas extension model (`atlas_*` config keys) locked in convention #35. Actual publish flow + per-element button + showcase modal all deferred.

Also new this session (smaller):
- **World Home** — `src/middle/world-home.ts` shipped. Identity + stats + timeline preview + recent + quick actions. See `DESIGN_HOME.md`.
- **Search room** — `src/middle/search.ts` shipped. Searches name/description/supertype/subtype. Subtle "search everywhere" icon next to the elements-sidebar search input.
- **Import / Templates rooms** — stubs only.

---

## Items dropped (don't re-add without fresh design conversation)

Per-world conflict policy override, email per-world, zone-targets-map, cross-element pin rendering, map subtype visual filter, map locking via URL, "maps within" inverse search perf, picker keyboard shortcut, pin coord council motion (already in schema), snap-to-existing-vertex for pins (only relevant for markers, already done), repair pre-migration server markers, hotkey undo/redo.

---

## Last session — Rooms model + decoupling + close-out polish (2026-05-18 session 223)

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

## Earlier session — Validation + tuneup (2026-05-18 morning)

Five planned bouts + 6 follow-ups + atlas_shape leak fix. Three rounds of Captain validation feedback landed cleanly.

**Live bugs**:
- **Marker FK push fail**: `parseFkConstraintError` + CREATE-catch routes orphan peer to `server_deletes` review modal. +3 tests in `sync-engine.fkConstraint.test.ts`.
- **`atlas_shape` leak** (the real cause of Captain's smoke FK error — discovered after B1 fix didn't take): `atlas_shape` added to `ATLAS_LOCAL_EXTENSION_FIELDS`; both fakes now strictly reject atlas-local fields in write bodies. Convention #20 applied retroactively. +4 tests in `ow-client-adapter.atlasLocal.test.ts`.
- F hotkey: `fitBounds` → `fitToCanvas`
- Pin badge: `getAssociatedMaps` → `hasLinkedSubMap` (only Locations with sub-maps)
- "Engine not ready" → PIN-aware via `surfaceSyncUnavailable`

**Maps + camera**:
- Visual settings popover persists across map switch (`retargetVisualSettingsPopover`)
- Map view preserve via `src/core/map-camera-persist.ts` — saves `{center, zoom}` per mapId; restored at mount before fit-to-canvas
- **fitToCanvas-after-restore gate** (W6 round 2): `manager.fitToCanvas(20)` at end of `entry.ready` was overwriting the W6 setView restore. Gated behind `!savedAtMount`.
- Camera state migrates on map id-swap (lives alongside rightTabs + selectedElementId + URL migration)

**UX polish**:
- "Synced 3m ago" live on pill (30s tick interval)
- Right-click filter chip → type-scoped pull
- Auto-pulled element flash via `atlas:pulled-ids` CustomEvent + `data-flash` survives sidebar re-render
- Sidebar setup/recover-atlas buttons removed; welcome panel is single CTA
- Make-Online modal pre-validates email + PIN before any server call
- Stronger unlink-from-API confirmation with element count
- Context-aware empty state in elements-sidebar

**Sync hardening (M-series + pagination)**:
- M2: pill click toast gated on push+pull deltas
- M3: pull race-overwrite — re-read element before `applyServerRecord`
- M4: stale conflicts cleared on `pause-and-review → local-wins` flip
- M5: modal `worldId` captured at open
- H3: `pinPlacement.elementId` migrated on id-swap
- P4: full pagination (`?offset=N` until count reached, 100-page cap)

**Lessons (durable)**:
- Wrong-root-cause fixes feel like real fixes. Tests passing for a fake scenario that doesn't match production = misleading. **When the test passes but production behavior doesn't change, the test is the suspect.**
- When adding a new step to an existing async chain, **audit everything AFTER your insertion point**. Finalizers can silently override earlier steps.
- Three rounds of Captain validation feedback isn't a failure — it's the system working. Each round caught something self-assessment couldn't.

---

## Previous session — Tuneup (2026-05-17)

Slug-prefix filenames (`<slug>--<uuid>.json`), hotkeys MVP dispatcher, sentence-case scrub (~250 user-visible strings), 14 stale Playwright tests fixed, docs hygiene (4 transitional docs archived). Conventions #28-30 added. See git log + `docs-archive/PROGRESS-history.md` for detail.
