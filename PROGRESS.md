# Atlas — Progress Log

Operational state. Architecture in **DESIGN.md** (+ `DESIGN_MAPS.md`, `DESIGN_ZONES.md`). Sync lessons in **SYNC_NOTES.md**. Session-by-session history archived to `docs-archive/PROGRESS-history.md`.

---

## CURRENT STATE (handover snapshot, 2026-05-19 session 224)

Tool is in a tight, healthy state. **589 vitest green + 93 Playwright green.** Typecheck clean. Conventions list 1-39 (full text in DESIGN.md). PWA + offline cache shipped; bundle 521 KB JS / 147 KB gzipped + 4 MB Material Symbols woff2 (precached by SW).

**Writing system redesigned (supertype-tier model).** A Narrative is in the writing tree iff its `supertype` matches one of the four configured tier labels (l1-l4, defaults Book/Chapter/Scene/Draft). Subtype is FREE for user classification. Storage matches display (no canonical/display split); label renames migrate via `applyLabelRenameMigration`. New `writing-setup.ts` setup screen + `writing-promote.ts` migration helpers. See DESIGN_WRITING.md v2.0 for the full model.

**Recent invariants worth knowing**:
- Middle pane: `shell.middleRoomNav` + `shell.middleContent` (renderers MUST target `middleContent`, never `middle` — convention #31)
- Default route bare `#/w/<id>` → home room (was timeline)
- Esc + click-selected-row clear selection + nav home (convention #32)
- Writing supertype = tier label storage (convention #33 v2). Tier semantics: l1/l2/l3/l4 = Book/Chapter/Scene/Draft. Drafts flexible-parent. Convention #34 v2.
- Writing tree membership filter: `isWritingNarrative(el, worldId)` reads `supertype` against `writing_labels` (convention #38).
- Label rename triggers immediate supertype migration on existing narratives (convention #39).
- Showcase config supports `atlas_*` extensions (convention #35)
- Showcases immutable; republish creates new (convention #36)
- Sidebar mode + room are independent dimensions (convention #37)
- Sentence case throughout, slug-prefix filenames (`<slug>--<uuid>.json`)
- Hotkeys MVP wired (`Ctrl/Cmd+E`, `S`, `K`, `?`, `Esc` deselect-to-home, map-tab `F`/`Z`/`L`)
- Map view persists per-map (`{center, zoom}` saved on `moveend`, restored at mount)
- Pin badge accurate (only on Locations that have a sub-map)
- Sync pill shows "synced 3m ago" live (30s tick)
- `atlas_shape` stripped on wire; both fakes (FakeOwApiClient + MSW) strictly reject atlas-local fields in write bodies
- Welcome panel is single CTA for atlas-root setup/recover
- All "engine not ready" toasts route through `surfaceSyncUnavailable` for PIN-aware messages + deep-links
- Self-hosted Material Symbols (npm package) + Vite-PWA service worker for offline-first cold load
- DOM helpers consolidated in `core/dom-utils.ts` (escapeText/escapeAttr/relativeTime); active-store lives in `core/active-store.ts`

---

## Three big projects ahead — session 224 update

- **Writing** — model rebuilt this session (supertype-tier). Tree filter / setup / promote / migration all shipped. **Richtext editor** is now the biggest pillar — TipTap / ProseMirror / Lexical decision still open. See `DESIGN_WRITING.md` v2 "Deferred design questions".
- **Timeline** — `src/visualization/timeline/timeline-bar.ts` ported. Compact mode on Home, expanded mode in `#/w/<id>/timeline`. Narrative bars, zoom/pan, filter toggles, expand-collapse all deferred.
- **Publish** — `src/middle/publish-room.ts` stub. write-tool's `/showcase/publish/` API documented in `DESIGN_PUBLISHING.md`. Atlas extension model (`atlas_*` config keys) locked in convention #35. Actual publish flow + per-element button + showcase modal all deferred.

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
