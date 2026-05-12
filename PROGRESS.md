# Atlas — Progress Log

Track what's done, what's coming, rough edges, deferred decisions.
Architecture lives in **DESIGN.md**. This file is operational — read it to know where we are.

---

## Current State

**Phase 0 — Foundation: complete (session 197).**
**Phase 1 — Sync foundation + real FolderStore: ~95% complete (sessions 197-198).**
**Phase 1.5 — Architecture-agnostic UI primitive ports: complete (session 197).**
**Phase 2 — Minimal UI bootstrap: complete (session 198, Bout 3).** First hands-on testable build.
**Phase 4 — Content UI: Bouts A+B complete (session 199, 2026-05-12).** Elements sidebar mode, create modal, schema-driven element detail (FIELD_SCHEMA + ELEMENT_SECTIONS), element-picker modal, single/multi-link fields with picker, collapsible sections, Referenced-By reverse-link section.
**Phase 5 — Spatial UI: Bout C complete (session 199, 2026-05-12).** Right-pane tab bar, map-index tab pinned, per-map Leaflet tabs with cache lifecycle, map-create modal with image upload via FolderStore.addMedia, pin placement flow (element-detail pin button → map click → createPin), pin tooltip on hover, contextual right-click element-create + pin drop, map cascade-delete closes open tabs.
**Phase 6 — Polish: Bout C.5 + Bout D complete (session 199, 2026-05-12).** Visual alignment to legacy aesthetic (worlds/elements/maps now use `.atlas-list`/`.atlas-row`; sidebar mode toggle uses `.atlas-mode-btn` with cyan underline; element-detail uses `.atlas-middle-header` + delete/pin via `.atlas-icon-btn-sm`). Timeline view (`#/w/<id>/timeline`) + `+ event` button. Sync indicator pill (fixed bottom-right, legacy `.atlas-sync-pill` reused). Worlds favorites star toggle with favorites-first sort.

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
