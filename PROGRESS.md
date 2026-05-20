# Atlas — Progress Log

Operational state. Architecture in **DESIGN.md** (+ `DESIGN_MAPS.md`, `DESIGN_ZONES.md`). Sync lessons in **SYNC_NOTES.md**. Session-by-session history archived to `docs-archive/PROGRESS-history.md`.

---

## CURRENT STATE (handover snapshot, 2026-05-20 session 226)

Tool is in a tight, healthy state. **634 vitest green + 93 Playwright green.** Typecheck clean. Conventions list 1-46 (full text in DESIGN.md). PWA + offline cache; bundle ~548 KB JS / 155 KB gzipped + 4 MB Material Symbols woff2 (precached by SW, 17 entries / ~4.93 MiB).

**Writing tool matured + decoupled.** Supertype-tier model + sidebar takeover + unified element-detail header + drag-reorder + cascade delete + last-narrative restore + non-blocking saves. Session 226: writing-room navigation now derives target element from URL hierarchy (book/chapter/scene), NOT from `state.ui.selectedElementId`. The global selection persists across writing visits. DESIGN_WRITING.md v2.1 + new convention #46 capture the contract. The richtext editor is the only major writing pillar still ahead.

**Recent invariants worth knowing** (most-recent-first):
- **Writing room reads URL for active narrative, not selectedElementId** (convention #46). Element-detail's `getSelectedElement` branches on `route.mode === 'writing'`. Global selection chip stays pinned to whatever was selected before writing was opened.
- **Selected-element chip on far right of room-nav-strip** (convention #45). Persistent affordance showing icon + name + ×. Click body → navigate to element room; click × → clear. Highlights cyan when route mode is 'element'.
- **Esc in writing room is a no-op** (convention #32 amendment). Esc only clears selection + navigates home when NOT in writing — writing room owns its own keyboard.
- **Marker delete via drag-to-trash** (zone-edit). Vertex handle drags onto the per-tab trash zone → `deleteMarkerInEdit`. Floor-guarded: at the polygon min (3) / line min (2) the trash zone stays disarmed; user can still right-click delete (which surfaces the floor toast).
- **Click outside zone in edit mode deselects** (no more click-anywhere insert). Inserts happen only via segment-overlay clicks. Click on map background → clear `selectedElementId` → `syncEditMode` exits edit cleanly.
- **Sync pill renders a decay ring during pending debounce.** `SyncEngine.getPendingPush()` + `atlas:pending-push` CustomEvent. Click during pending → `flushPendingPush()`. Window configurable via Settings → Sync → Autosave delay (number input, 1–3600s, persisted as `registry.sync_debounce_ms`).
- Middle pane: `shell.middleRoomNav` + `shell.middleContent` (renderers MUST target `middleContent` — convention #31)
- Default route bare `#/w/<id>` → home room
- Writing supertype = tier label storage (convention #33 v2). Tier semantics: l1/l2/l3/l4 = Book/Chapter/Scene/Draft. Drafts flexible-parent. Convention #34 v2.
- Writing tree membership filter: `isWritingNarrative(el, worldId)` reads `supertype` against `writing_labels` (convention #38).
- Label rename triggers immediate supertype migration on existing narratives (convention #39).
- **Writing tree lives in sidebar** (convention #40). Middle pane single-column in writing mode. Override via `state.ui.sidebarWritingOverride`.
- **Element-detail header locked at 36px** (convention #41). Tier badge + writing actions live inside it.
- **Field edits close optimistically** (convention #42). Popover tears down before awaiting persistence. Width now matches anchor field width with a small inset.
- **Narrative deletes cascade descendants** (convention #43). `findDependents` BFS-walks `parent_narrative` chain.
- **Last-narrative restore from writing icon** (convention #44). `WorldRegistryEntry.last_writing_narrative_id` + `writingHashForNarrative` helper.
- Showcase config supports `atlas_*` extensions (convention #35); showcases immutable, republish creates new (convention #36)
- Sidebar mode + room are independent dimensions (convention #37)
- Sentence case throughout, slug-prefix filenames (`<slug>--<uuid>.json`)
- Hotkeys MVP wired (`Ctrl/Cmd+E`, `S`, `K`, `?`, `Esc` deselect-to-home (except writing), map-tab `F`/`Z`/`L`)
- Map view persists per-map; pin badge accurate; pin label offset 7px (tightened session 226)
- Sync pill shows "synced 3m ago" live (30s tick); pending-push decay ring on the dot
- `atlas_shape` stripped on wire; both fakes strictly reject atlas-local fields in write bodies
- Welcome panel single CTA for atlas-root setup/recover; "engine not ready" toasts route through `surfaceSyncUnavailable`
- Self-hosted Material Symbols + Vite-PWA service worker
- DOM helpers in `core/dom-utils.ts`; active-store in `core/active-store.ts`

---

## Three big projects ahead — session 226 update

- **Writing-workspace redesign** — the next major design conversation. Session 224-226 work matured the tree, the model, and the surface decoupling, but the writing room's middle pane is still a single-column element-detail. The next move is Option A (locked in session 225 handover): new `src/middle/writing-workspace.ts` module parallel to element-detail, reusing the extracted `element-detail-header.ts`. Prose-first layout, story field as primary surface, richtext editor (TipTap / ProseMirror / Lexical — undecided), word count, outline. Open design questions live in `DESIGN_WRITING.md` v2.1 "Deferred design questions".
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

## Items dropped (don't re-add without fresh design conversation)

Per-world conflict policy override, email per-world, zone-targets-map, cross-element pin rendering, map subtype visual filter, map locking via URL, "maps within" inverse search perf, picker keyboard shortcut, pin coord council motion (already in schema), snap-to-existing-vertex for pins (only relevant for markers, already done), repair pre-migration server markers, hotkey undo/redo.

---

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
