# Atlas — Progress Log

Track what's done, what's coming, rough edges, deferred decisions.
Architecture lives in **DESIGN.md**. This file is operational — read it to know where we are.

---

## Current State

**Phase 0 — Foundation: complete (session 197).**
**Phase 1 — Sync foundation + real FolderStore: ~95% complete (sessions 197-198).**
**Phase 1.5 — Architecture-agnostic UI primitive ports: complete (session 197).**
**Phase 2 — Minimal UI bootstrap: complete (session 198, Bout 3).** First hands-on testable build.

Skeleton package green across the board. Architecture locked. Full sync contract (push + pull + conflict detection on UPDATE) proven against MockFolderStore + FakeOwApiClient. Real OwApiClient adapter wraps the SDK; tested end-to-end via MSW with real `@onlyworlds/sdk`.

Session 198 (Bout 1) added: cascade-delete in FolderStore contract + `findDependents` preview helper, `syncNow` concurrency mutex, order-independent `deepEqual` in conflict diff (no more spurious field-list churn from key-order differences), policy rename `server-wins` → `pause-on-conflict` (matches the actual code behavior; old name lied), Route 2 policy (a) dropped (full-overwrite footgun), lock-file format specced in conventions.

Session 198 (Bout 2) added: real FolderStore backed by File System Access API. `fs-utils.ts` (atomic write via tmp+verify+promote, corruption-tolerant readJson, dir helpers), `idb.ts` (minimal promise IDB), `handle-vault.ts` (FileSystemDirectoryHandle persistence + permission re-grant helper), `folder-store-fs.ts` (full FsFolderStore impl with layout setup, heartbeat lock, all CRUD, media sidecar, sync-state file). One-file-per-element on disk for everything (content + spatial), no bundle-per-map. Playwright drives it via OPFS — same FS Access API interface as a user-chosen folder, so the real impl is exercised end-to-end.

Session 198 (Bout 3) added: Phase 2 minimal UI. App shell (3-pane, draggable dividers, ratios persisted), observable state store, hash router, worlds sidebar with create-local + per-world activate, create-world modal (name + folder picker, test-injectable directory source), welcome panel (active world stats), settings panel (PIN + email + forget-world). Real `FsFolderStore` wired throughout — clicking create opens a real folder via FS Access API and writes a real `world.json`. Two lock-correctness fixes also landed: per-tab stable id via `sessionStorage` (reload reclaims own lock) + prior-store close in `createLocalWorldFlow` (defensive). 7 new Playwright specs cover the full flows (shell mount, create, settings, reload, forget, cancel, multi-world switching).

Session 198 (Bout 4) added: atlas-root concept. Single user-chosen folder that holds all atlas-managed worlds; one-time setup. New worlds become subfolders (`<slug>-<uuid-prefix>`). Sidebar swaps `[ + create local ]` for `[ set up atlas ]` until root is configured. Welcome panel mirrors the same first-launch CTA. Settings shows + lets you change the atlas folder. Each world still has its OWN handle in the vault — atlas root is a creation convenience, not a storage layer. Existing test worlds keep working as "external" worlds. Three small fixes also landed: `loadRegistry` was hand-picking fields and silently dropping new ones (including `atlas_root` on reload) — now spreads; `slugify()` for filesystem-safe folder names; `.atlas-root` marker file dropped in each root for future "import existing atlas folder" detection.

Session 198 (Bout 5) refined Bout 4: atlas root now uses the "library wrapper" convention. When user picks a folder, atlas creates `atlas-worlds/` inside it (matching legacy) UNLESS the picked folder is already an atlas root (`.atlas-root` marker present) or already contains one. Three cases handled by `resolveOrCreateRoot()`: (1) pick a folder with marker → use directly; (2) pick a folder containing `atlas-worlds/` with marker → use that subfolder; (3) pick a generic folder → create `atlas-worlds/` inside. Picking the user's Documents folder no longer pollutes it with world subfolders. State + UI show `pathHint` (parent/atlas-worlds when wrapped, picked-folder-name when re-used).

UI primitives ported verbatim (modal-base, toast-manager, field-edit-popover, field-schema, Leaflet2DManager + spatial siblings, pin-visuals, edge-color). Full atlas.css styling in place (1491 lines). These ports are sitting unreferenced until Phase 2 wires them into the shell.

Local git: 8 commits on master (origin pushed via force to GitHub main by Captain in session 197). Session 198 work uncommitted.

**Bundle**: 33.52 KB JS / 10.18 KB gzipped. CSS 29.20 KB / 5.56 KB gzipped.
**Tests**: 96 vitest + 24 Playwright = 120 total.
**Type-check**: clean. **Build**: clean. **E2E**: 24 Playwright specs (12 FsFolderStore + 11 Phase 2 UI + 1 shell smoke), all chromium.

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

### Next bouts (post Phase 2)

**Bout 4 — Sync polish** (~45min)
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

- **2026-05-12 (session 198, Bout 6)** — Three fixes. `#/settings` standalone route (gear icon now works without an active world). `discoverWorldsInRoot()`: setup scans the atlas root for subfolders with valid `world.json` and imports them — critical after localStorage wipe + re-pick. Migration note added to settings ("changing this folder doesn't move existing worlds"). 2 new Phase 2 specs.
- **2026-05-12 (session 198, Bout 5)** — Atlas-root refinement: wrap-by-default with re-use detection. Picked folder becomes parent; atlas creates `onlyworlds-atlas/` inside (renamed from `atlas-worlds/` for brand clarity, with legacy detection). Display switched to pathHint (parent/wrapper) for context. 2 new Phase 2 specs.
- **2026-05-12 (session 198, Bout 4)** — Atlas-root concept. One-time folder setup before world creation. New: `src/setup/atlas-root-flow.ts` (setup + hydrate + createWorldInRoot + slugify), atlas_root field in registry + state, sidebar/welcome/settings all switch on root presence. Modal becomes name-only when root is set. Each world keeps its own handle so root is a creation convenience, not storage. Fixed `loadRegistry` field-dropping bug. New tests: 9 Phase 2 UI specs (rewritten) + 7 atlas-root unit tests. 96 vitest + 22 Playwright = 118 total.
- **2026-05-12 (session 198, Bout 3)** — Phase 2 minimal UI. New: `core/state.ts`, `core/router.ts`, `layout/app-shell.ts`, `sidebar/worlds-sidebar.ts`, `middle/welcome-panel.ts`, `middle/settings-panel.ts`, `ui/directory-picker.ts`, `ui/create-world-modal.ts`, `app.ts`. `main.ts` boots `startApp(root)`. Toast singleton wired. Two lock-correctness fixes: per-tab `sessionStorage` id (reload reclaims own lock); prior-store close on create flow (defensive). Bundle 1.14 KB → 29.21 KB (full UI). 7 new Playwright specs (89 vitest + 20 e2e = 109 total). First user-testable build.
- **2026-05-12 (session 198, Bout 2)** — Real FolderStore via FS Access API. New: `fs-utils.ts`, `idb.ts`, `handle-vault.ts`, `folder-store-fs.ts`, `vite-env.d.ts`. Dev-only test harness on `window.__atlasTestApi` (tree-shaken from prod). 12 Playwright specs drive the real impl against OPFS — same `FileSystemDirectoryHandle` interface as a user-chosen folder. All green: layout creation, round-trip CRUD, cross-session persistence, cascade delete, tombstone durability, sync state round-trip, lock file write/clear, live-lock rejection, stale-lock recovery. Total tests: 89 vitest + 13 Playwright = 102.
- **2026-05-12 (session 198, Bout 1)** — Foundation polish before more building. Five decisions locked (cascade-delete in FolderStore; lock-file heartbeat 30s/90s TTL; policy rename `server-wins` → `pause-on-conflict`; Route 2 policy (a) dropped; email global). Four code changes: deepEqual diff, cascade-delete contract + `findDependents`, syncNow mutex, policy rename. 22 new tests (67 → 89). Typecheck + build clean.
- **2026-05-12 (session 197)** — Phase 0 foundation + Phase 1 sync. 8 bouts, 67 tests, 5 git commits, clean build. Refactor pivot from legacy IDB-cached atlas. New atlas at `tools/atlas/`; legacy archived at `tools/atlas-deprecated/`. Local git initialized; remote pointed at https://github.com/OnlyWorlds/atlas.git (legacy still on main, Captain force-pushes when ready).
