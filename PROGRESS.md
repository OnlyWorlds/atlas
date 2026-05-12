# Atlas — Progress Log

Track what's done, what's coming, rough edges, deferred decisions.
Architecture lives in **DESIGN.md**. This file is operational — read it to know where we are.

---

## Current State

**Phase 0 — Foundation: complete (session 197).**
**Phase 1 — Sync foundation: ~80% complete (sessions 197-198).**
**Phase 1.5 — Architecture-agnostic UI primitive ports: complete (session 197).**

Skeleton package green across the board. Architecture locked. Full sync contract (push + pull + conflict detection on UPDATE) proven against MockFolderStore + FakeOwApiClient. Real OwApiClient adapter wraps the SDK; tested end-to-end via MSW with real `@onlyworlds/sdk`.

Session 198 (Bout 1) added: cascade-delete in FolderStore contract + `findDependents` preview helper, `syncNow` concurrency mutex, order-independent `deepEqual` in conflict diff (no more spurious field-list churn from key-order differences), policy rename `server-wins` → `pause-on-conflict` (matches the actual code behavior; old name lied), Route 2 policy (a) dropped (full-overwrite footgun), lock-file format specced in conventions.

UI primitives ported verbatim (modal-base, toast-manager, field-edit-popover, field-schema, Leaflet2DManager + spatial siblings, pin-visuals, edge-color). Full atlas.css styling in place (1491 lines). These ports are sitting unreferenced until Phase 2 wires them into the shell.

Local git: 8 commits on master (origin pushed via force to GitHub main by Captain in session 197). Session 198 work uncommitted.

**Bundle**: not yet meaningful (placeholder boot only — ports tree-shaken). CSS 25.58 KB / 4.97 KB gzipped (full styling).
**Tests**: 89 passing across 9 files (was 67).
**Type-check**: clean. **Build**: clean. **E2E**: 1 Playwright spec passes.

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

### Phase 1 remaining (next bouts)

**Bout 2 — Real FolderStore** (browser File System Access API impl)
- `src/store/fs-utils.ts` — path helpers, atomic write (write-temp + rename), JSON read with corruption-recovery
- `src/store/idb.ts` — minimal promise-wrapped IDB primitives
- `src/store/handle-vault.ts` — `FileSystemDirectoryHandle` persistence keyed by `handle_key`
- `src/store/folder-store-fs.ts` — full FolderStore impl backed by FS Access API
- `.atlas/lock` with 30s heartbeat / 90s TTL stale-recovery
- Tested via Playwright (FS Access API isn't in node)

**Bout 3 — Shared contract test suite**
- Extract the existing integration tests into a parameterized contract that runs against MockFolderStore (vitest, fast) AND FsFolderStore (Playwright, real disk).
- Divergence guard. Without this, mock-passes-but-real-fails will bite us mid-Phase 2.

**Bout 4 — Sync polish**
- Per-type download cursor in `sync-state.json` (resumable link-existing)
- Replace per-element pre-update GET with batched listElements baseline check
- Network error handling (pause vs retry vs throw — clarify and test)

### Phase 2 — Minimal UI to test foundation (Bout 5)
- App shell (port from legacy)
- Worlds sidebar (simplified)
- Settings panel with PIN + email
- Sync indicator (attached to SyncEngine state events)
- Welcome panel with create/link/make-online entry points
- First real-user E2E: create local world → pick folder → edit → reopen and persist

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

- **No real FolderStore yet** — only the mock. Real browser impl (FS Access API) is the major remaining Phase 1 piece. Bout 2 work.
- **No handle vault yet** — IDB persistence of FileSystemDirectoryHandle. Bout 2.
- **No lock file yet** — design specced in conventions (heartbeat 30s, TTL 90s, JSON `{tab_id, started_at, last_heartbeat}`). Implemented in Bout 2.
- **No initial-download cursor** — link-existing-API partial failures aren't resumable. Bout 4 adds per-type cursor in `sync-state.json`.
- **Pre-update GET is N+1** — every UPDATE does an extra GET. Acceptable at debounce rates; brutal on "resume after long offline." Bout 4 replaces with a single batched listElements baseline before push.
- **Pull-only conflict tests are weak** — for drain-blind policy, push runs first and overwrites, so a "pure pull-time conflict" requires server-side race hard to simulate. The conflict detection is verified via push-phase pre-update GET tests instead, which is the more important path.
- **Element files lack corruption-recovery on read** — a partial-write JSON file currently throws. Real FolderStore (Bout 2) must catch + skip with a console warn so one bad file doesn't break list ops.
- **Atomic write primitive missing** — write-temp + rename is non-negotiable for the real FS impl. Bout 2.

---

## Deferred Decisions

- **Conflict UI** — Phase 3.5+: full modal with diff + keep-mine/keep-theirs/manual
- **Server-side DELETE detection on pull** — UX TBD when pull lands
- **Multi-image API support** — defer until OW schema supports it
- **Per-world sync policy override** — default global; expose per-world when needed
- **Pagination ceiling** — `listElements` doesn't paginate yet; revisit when real worlds hit limits

---

## Session Log

- **2026-05-12 (session 198, Bout 1)** — Foundation polish before more building. Five decisions locked (cascade-delete in FolderStore; lock-file heartbeat 30s/90s TTL; policy rename `server-wins` → `pause-on-conflict`; Route 2 policy (a) dropped; email global). Four code changes: deepEqual diff, cascade-delete contract + `findDependents`, syncNow mutex, policy rename. 22 new tests (67 → 89). Typecheck + build clean. Bout 2 next: real FolderStore.
- **2026-05-12 (session 197)** — Phase 0 foundation + Phase 1 sync. 8 bouts, 67 tests, 5 git commits, clean build. Refactor pivot from legacy IDB-cached atlas. New atlas at `tools/atlas/`; legacy archived at `tools/atlas-deprecated/`. Local git initialized; remote pointed at https://github.com/OnlyWorlds/atlas.git (legacy still on main, Captain force-pushes when ready).
