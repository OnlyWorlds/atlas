# Phase 3 — API Flows Brief

**Created**: 2026-05-12 (end of session 199)
**Status**: ready for fresh session
**Goal**: bring atlas to full OnlyWorlds-story parity — Make-Online (create new api world from local), Link-Existing-API (initial download into folder), sync indicator wired to real SyncEngine state, autosave on edits. After this, atlas is feature-complete except for Phase 3.5 polish (conflict UI, multi-image, etc.).

---

## How to start the next session

1. `/wake` — loads identity + recent reflection
2. `/atlas-tool` — loads DESIGN.md + PROGRESS.md + PORTED.md
3. Read THIS file
4. Skim `tools/atlas-deprecated/src/ui/link-world-modal.ts` (251 lines) for the Link API surface
5. Skim `tools/atlas/src/sync/sync-engine.ts` + `ow-client-adapter.ts` to remember the SyncEngine API
6. Begin with **Bout E** (below) — link-existing-api-world modal

---

## Foundation already in place (do NOT touch unless broken)

- **SyncEngine** (`src/sync/sync-engine.ts`) — full push + pull + conflict detection, three policies wired, syncNow mutex. Tested via 28 vitest integration cases.
- **OwClientAdapter** (`src/sync/ow-client-adapter.ts`) — wraps `OnlyWorldsClient` via raw `client.request`. `adaptRecord` stamps type field, unwraps nested relations. Pin write bypasses prepareRelations.
- **FsFolderStore** — all CRUD complete with cascade. `addMedia` for blob uploads.
- **Registry helpers** — `attachApi`, `detachApi` for state transitions. `setPin`, `setEmail` for global credentials.
- **MSW handlers** (`tests/msw-handlers.ts`) — reusable stateful OW API simulation. Use for E2E specs.
- **Sync indicator pill** — cosmetic v1 rendered to document.body. data-state="local|api|none". Bout E wires real SyncEngine state into the pill.
- **All UI** from Phases 4+5+6 — elements browse/edit/relation, maps, pins, timeline, favorites. Sync is the only thing missing.

---

## Bouts

### Bout E — Link Existing API World (~90min)

**Files to create**:
- `src/ui/link-world-modal.ts` — BaseModal subclass. Form fields: api_key, pin (pre-fill from registry.pin), display-name override (optional). Submit → validate via `client.worlds.get()` → progress UI → fetch all elements/maps/pins/zones/markers → write each to folder via FolderStore with stamped `server_updated_at` → register entry as `api-linked` → attach SyncEngine → close.
- `src/sync/initial-download.ts` — Helper: given an OwClientAdapter + FolderStore, fetch all elements per type, call `folder.applyServerRecord` for each. Returns counts for the progress UI.

**Files to modify**:
- `src/sidebar/worlds-sidebar.ts` — Add a `+ link api` button in the header next to `+ new local`. Legacy worlds-sidebar.ts (line 39-46) has the reference markup.
- `src/middle/welcome-panel.ts` — Add "or link an existing world" CTA when atlas root is set but no worlds exist.
- `src/setup/atlas-root-flow.ts` — Add `linkExistingApiWorldInRoot({apiKey, pin, name?})` parallel to `createWorldInRoot`. Creates the world's subfolder, opens a fresh `FsFolderStore`, writes meta with `api: {world_id, api_key}`, runs initial download, sets active.

**Behavior**:
- Pre-fill PIN from `state.registry.pin` if set; otherwise prompt and persist to registry.
- During initial download, show progress: "downloading 47 of 412 elements…" with a spinner.
- Partial download is OK — folder has what it has. User can resume via "refresh from API" (Bout G).
- On success, world becomes active with sync indicator showing `synced`.

**E2E spec** (`tests/e2e/phase3-link-api.spec.ts`):
- Use MSW handlers as the OW backend. Seed the mock world with 3 elements + 1 map + 2 pins.
- Click `+ link api` → fill credentials → submit → verify progress UI → verify world appears in sidebar with `api` badge → verify all elements rendered correctly → verify `world.json` on disk has `api.world_id` and `api.api_key`.

---

### Bout F — Make-Online Route 1 (create new api world) (~75min)

**Files to create**:
- `src/ui/make-online-modal.ts` — BaseModal subclass. Two tabs/sections: "create new" (Route 1) and "link existing" (Route 2 — Bout G handles the merge policy). Route 1 fields: display name (default from world.name), email (pre-fill from registry.email or prompt), PIN (pre-fill from registry.pin).
- `src/sync/make-online.ts` — Helpers: `createApiWorld({name, email, pin})` calls `POST /api/worldsync/create-world-external/` → returns `{api_key, world_id}`. Then `pushAllToApi(folder, adapter)` iterates all local elements and pushes via SyncEngine's push path (creates everything, stamps `server_updated_at`).

**Files to modify**:
- `src/middle/settings-panel.ts` — Settings panel for active local-only world gets a "Make Online" section with the modal trigger.
- Registry: when transitioning, call `attachApi(reg, worldId, {world_id, api_key})` and `writeWorldMeta({api: {...}})` on the FolderStore.
- Sync indicator: should now show synced state immediately after the push completes.

**Behavior**:
- Validation: world must have at least one element OR user confirms creating an empty api world.
- Maps without `image_url` are pushed with empty url; the map index will show a warning indicator on those maps.
- On full success: toast "{name} is online" + sync pill flips to `linked` + SyncEngine starts auto-debounced push.

**Reference**: `Development/OnlyWorlds/obsidian-plugin/Commands/CreateWorldCommand.ts` for the exact POST shape.

**E2E spec**: create a local world with 3 elements → click Make Online → verify POST captured by MSW → verify all elements appear in MSW state → verify registry entry is now `api-linked` → verify `world.json` has `api` field → verify sync pill shows `linked`.

---

### Bout G — Make-Online Route 2 (link existing api world, merge policy) (~60min)

Same modal as Bout F, second section: "link existing". Fields: api_key, pin, merge policy radio (b=overwrite-on-match, c=push-only-new).

**Behavior**:
- Validate credentials, fetch server state.
- Build diff per the policy:
  - (b) Overwrite duplicates: for each local element, find by name+type or id on server. Matched → UPDATE server with local; unmatched → CREATE.
  - (c) Push only new: matched → skip; unmatched → CREATE.
- Apply diff with progress UI.
- On success: flip registry state, attach SyncEngine, stamp `server_updated_at`.

**E2E spec**: seed MSW with 3 server elements, create local world with 5 (2 matching server by name) → submit policy (b) → verify 2 UPDATEs + 3 CREATEs. Then test (c) variant: same setup → verify 0 UPDATEs + 3 CREATEs (matched ones skipped).

---

### Bout H — Sync indicator wired to real SyncEngine + autosave (~75min)

**Files to modify**:
- `src/tabs/right/right-pane.ts` — `renderSyncIndicator` should read `state.sync.byWorld[active.worldId]` (currently only reads registry state). Add `state.sync: SyncSummaryState` slice. Each SyncEngine instance subscribes and pushes its state changes through.
- `src/app.ts` (or new `src/sync/sync-attach.ts`) — When a world becomes active and is `api-linked`, instantiate a SyncEngine for it and wire its `onStateChange` → patchSlice('sync', ...).
- `src/middle/element-detail.ts` — After each field save, the SyncEngine's debounced push fires automatically (5s after the last local write). The pill should reflect: idle → saving (during push) → synced.

**Behavior**:
- Idle pill (synced state): subtle green dot, "synced".
- Saving pill (push in flight): pulsing cyan dot, "saving…".
- Paused (manual / offline): warm dot, "offline · {n} pending".
- Error: red dot, "error — click to retry".

The pill is already rendered via legacy CSS (`.atlas-sync-pill-dot` + `[data-state="synced/saving/pending/offline/error"]` ALREADY have color rules in atlas.css line ~1102). Just need to plumb the engine state through.

**E2E spec**: link an api world → edit an element → verify pill transitions local → saving → synced → verify MSW received the update. Toggle pause → verify pill shows offline with pending count.

---

## Key constraints

1. **MSW is the OW API for tests**. `tests/msw-handlers.ts` already has stateful CRUD against an in-memory state. Use `seedWithWorld({elements, maps, pins})` to bootstrap.
2. **`OwClientAdapter` is the only thing that talks to the SDK**. UI never imports `@onlyworlds/sdk` directly — go through the adapter so the prepareRelations bypass + relation unwrapping stays centralized.
3. **PIN is global** in `registry.pin`. The Link API + Make Online modals should default to the registry value and let the user override per-flow. Save back if they change it.
4. **Email is global** in `registry.email`. Required for `create-world-external` POST.
5. **Client UUIDs are preserved** — local elements created BEFORE Make Online keep their ids on the server. Verified via obsidian-plugin reference.
6. **Maps without image_url** are pushed anyway (with empty string url). The UI shows a warning badge in the map index for those.
7. **Initial download is not yet resumable** — partial failures leave the folder with what it has; clicking "refresh from API" later (Bout H or 3.5) picks up the rest.
8. **drain-blind is the default conflict policy** — push wins, conflict surfaced as info toast. Phase 3.5 adds the per-field diff modal.

---

## Risk areas

- **MSW stateful handlers may need extending** for the new flows. The current `statefulOwHandlers` cover CRUD per type. Add: world creation endpoint, batched element listing if pagination is exercised.
- **Initial download size** — `client.list(type)` returns up to N per page; need to follow pagination cursors. Helper: `fetchAllPages(adapter, type)`.
- **`writeWorldMeta({api: {...}})` is the on-disk transition** — this is what makes the world "online" persistently. Don't forget to write it; otherwise reload loses the api credentials.
- **SyncEngine attachment on world activation** — currently `activateWorld` opens the FolderStore but doesn't attach a SyncEngine. Need to add that for api-linked worlds.
- **Detach api → keep folder** UX — Settings panel "Unlink from API" action. Drop the SyncEngine, clear `world.json.api` field, mark registry entry `local-only`. Folder stays. Confirmation modal probably.

---

## Reference paths

- Legacy link modal: `tools/atlas-deprecated/src/ui/link-world-modal.ts` (251 lines)
- Legacy sync indicator: `tools/atlas-deprecated/src/ui/sync-indicator.ts` (89 lines, cosmetic — most of the logic is dead because the new SyncEngine has a cleaner state shape)
- Create-world endpoint: `Development/OnlyWorlds/obsidian-plugin/Commands/CreateWorldCommand.ts`
- SyncEngine API: `tools/atlas/src/sync/sync-engine.ts` — read the `SyncEngine` class interface
- MSW patterns: `tools/atlas/tests/msw-handlers.ts` + `tests/integration/ow-client-adapter.test.ts` for examples

---

## Done criteria for this session

- ✅ Link Existing API World modal flows end-to-end against MSW
- ✅ Make Online Route 1 (create new) flows end-to-end
- ✅ Make Online Route 2 (link existing, policy b + c)
- ✅ Sync pill shows real SyncEngine state (idle / saving / paused / error)
- ✅ Editing a field in an api-linked world fires a debounced push automatically
- ✅ At least one Playwright spec per major flow
- ✅ Type-check + build clean

**After this session**: smoke test (Bout I) — round-trip against Captain's `5474990854` world. Then cutover to atlas GitHub repo (force-push, archive `tools/atlas-deprecated/`).

---

## Self-check before starting

When you read this file at session start, verify:
- The conventions list in DESIGN.md is unchanged (14 entries)
- `npm run test:run` shows 96 vitest tests, all green
- `npx playwright test --project=chromium` shows 61 specs, all green
- `tools/atlas-deprecated/` is still present (you'll be reading from it)
- Memory `~/.claude/projects/.../memory/project_atlas.md` shows session 199 as the last entry

If any of those don't match, something drifted — investigate before bout E.

This file gets archived to `Notes/Archive/` once Phase 3 ships.
