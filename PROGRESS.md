# Atlas — Progress Log

Track what's done, what's coming, rough edges, deferred decisions.
Architecture lives in **DESIGN.md**. This file is operational — read it to know where we are.

---

## Current State

**Phase 0 — Foundation: complete (session 197, 2026-05-12).**

Skeleton package green across the board. Architecture locked. SyncEngine push contract proven against MockFolderStore + FakeOwApiClient + MonotonicClock.

**Bundle**: not yet meaningful (placeholder boot only). Empty world placeholder renders.
**Tests**: 12 passing across 2 files (foundation smoke + sync-engine push integration).
**Type-check**: clean. **Build**: clean. **E2E**: 1 Playwright spec passes.

### What's live (Phase 0)

- `tools/atlas/` package skeleton: package.json, vite.config, tsconfig, vitest.config, playwright.config
- Test infrastructure: Vitest + jsdom + MSW + fake-indexeddb + Playwright Chromium
- DESIGN.md (~600 lines): folder-first architecture, all workflows, conventions, file layout, phased plan
- Core types: `src/core/types.ts` — Element, WorldMap, Pin, Zone, Marker, Conflict, SyncEngineState, SyncResult, Tombstone, SyncState, WorldRegistryEntry, WorldsRegistry
- `src/store/folder-store.ts` — FolderStore interface (no real impl yet, just contract)
- `src/sync/sync-engine.ts` — SyncEngine class with push phase implemented; pull phase stubbed
- `tests/fixtures/mock-folder-store.ts` — in-memory FolderStore for tests
- `tests/fixtures/fake-ow-client.ts` — in-memory OwApiClient with call capture
- `tests/fixtures/monotonic-clock.ts` — strictly-increasing ISO timestamps for tests
- `tests/integration/sync-engine.push.test.ts` — 9 tests covering CREATE, UPDATE, DELETE-via-tombstone, paused, resume, no-op
- Placeholder `src/main.ts` + base atlas.css

### Verified

- `crypto.randomUUID()` available in jsdom + browser (no shim needed)
- OW API accepts client-provided UUIDs (verified earlier via obsidian-plugin reference)
- SyncEngine push correctly distinguishes CREATE vs UPDATE based on presence of `server_updated_at`
- Tombstone flow: delete → tombstone → server DELETE → tombstone cleared
- Paused state blocks pushes; resume re-enables

---

## Next Up — Phase 1

### Sync foundation completion

1. **Pull phase**: list server elements per type, write new ones to folder, update locally-stale ones, detect conflicts on dual-changed elements
2. **Conflict detection during push**: pre-fetch server state on update, compare `server.updated_at` vs `server_updated_at` baseline, fire conflict event
3. **Tombstone push for spatial types**: cascade deletes for pins/markers when their referenced element is tombstoned
4. **Network error handling**: pause vs retry vs throw — clarify and test
5. **`syncNow()` lock**: prevent concurrent calls

### Real FolderStore (browser implementation)

1. `src/store/folder-store-fs.ts` — File System Access API backing
2. `src/store/fs-utils.ts` — path helpers, atomic write (write-temp + rename)
3. `src/store/handle-vault.ts` — IDB persistence of FileSystemDirectoryHandle
4. Lock file (`.atlas/lock`) for multi-tab detection
5. Integration tests for the real one (will require Playwright since FS Access API isn't in node)

### Registry

1. `src/registry/registry.ts` — localStorage + helpers
2. `createLocalWorld`, `createApiLinkedWorld`, `attachApi`, `detachApi`
3. Unit tests

### Adapter layer (real OW SDK → OwApiClient interface)

1. `src/sync/ow-client-adapter.ts` — wraps `OnlyWorldsClient`, handles SDK quirks:
   - Pin write bypass (raw `client.request` for /pin/)
   - `unwrapId()` for nested relation objects on read
   - Stamp `type` on element responses (server omits it)
2. Integration test against MSW with the real SDK

---

## Done

### 2026-05-12 — Session 197: foundation

- Bout 1: deprecation. `tools/atlas/` → `tools/atlas-deprecated/`. tools.json, README, CLAUDE.md, .gitignore, memory MEMORY.md + project_atlas.md → project_atlas_deprecated.md updated. Skill renamed `atlas-tool` → `atlas-deprecated-tool` with deprecation framing. DEPRECATED.md written with port list + drop list.
- Bout 2: package skeleton. Fresh `tools/atlas/`, vite/tsc/vitest/playwright all green on empty.
- Bout 3: DESIGN.md written. Architecture, all workflows, conventions, file layout, phased plan, tradeoffs, open questions.
- Bout 4: SyncEngine push contract. Types, FolderStore interface, SyncEngine class, MockFolderStore, FakeOwApiClient, MonotonicClock. 9 integration tests covering the contract.

---

## Known Issues / Rough Edges

- **Pull phase is a stub** — engine's `pullPhase()` returns empty result. Phase 1 fills it in.
- **No real FolderStore yet** — only the mock. Real browser impl is Phase 1 priority.
- **No conflict detection on push** — drain-blind sends updates without checking server state. Phase 1.5 adds pre-update GET.
- **Adapter layer not yet built** — `OwApiClient` interface is satisfied by the fake; real SDK wrapper comes with Phase 1.
- **Sync state isn't yet read by pushPhase** — `last_push_at` is written but not consulted (drain-blind doesn't need it). Will matter for pull phase.
- **No FS Access API code yet** — entire real-folder layer is future work.
- **Registry stub doesn't exist yet** — Phase 1.

---

## Deferred Decisions

- **Conflict UI** — Phase 3.5+: full modal with diff + keep-mine/keep-theirs/manual
- **Server-side DELETE detection on pull** — UX TBD when pull lands
- **Multi-image API support** — defer until OW schema supports it
- **Per-world sync policy override** — default global; expose per-world when needed
- **Pagination ceiling** — `listElements` doesn't paginate yet; revisit when real worlds hit limits

---

## Session Log

- **2026-05-12 (session 197)** — Phase 0 foundation. 4 bouts, 12 tests, clean build. Refactor pivot from legacy IDB-cached atlas. New atlas at `tools/atlas/`; legacy archived at `tools/atlas-deprecated/`.
