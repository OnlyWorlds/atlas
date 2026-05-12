# Atlas — Port Log

Tracks what code/conventions were ported from `tools/atlas-deprecated/` into the new atlas, and HOW.

Each entry: source file, destination, treatment (verbatim, adapted, rewritten), why.

---

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

- `src/layout/app-shell.ts` — 3-pane shell
- `src/layout/tab-bar.ts`
- `src/sidebar/{worlds,elements}.ts`
- `src/middle/{element-detail,timeline,settings}.ts`
- `src/tabs/right/{map-index-tab,map-tab,pin-visuals,edge-color}.ts`
- `src/visualization/leaflet-2d/Leaflet2DManager.ts`
- `src/media/media-section.ts`
- `src/editor/field-schema.ts`
- `src/ui/{element-create-modal,field-edit-popover,element-picker-modal,map-create-modal,modal-base,toast-manager}.ts`
- `src/router.ts`
- `src/styles/atlas.css` (only base tokens are in new copy so far)

Storage layer is NOT ported — fully rewritten:

- `src/store/api-store.ts` (~700 lines) → REPLACED by `src/sync/sync-engine.ts`
- `src/store/api-cache.ts` (~400 lines) → REPLACED by folder + timestamps
- `src/store/pending-ops-queue.ts` (~200 lines) → REPLACED by timestamp diff + tombstones
- `src/store/router.ts` (WorldStoreRouter) → no longer needed (one store)
- `src/store/api-client-factory.ts` → REPLACED by SyncEngine ow-client-adapter (Phase 1)
- `src/store/world-store.ts` → REPLACED by `src/store/folder-store.ts` (renamed, narrowed contract)
- `src/store/local-store.ts` → DROPPED (orphaned Phase 1 IDB experiment)
- `src/store/idb.ts` → MINIMAL (only for handle-vault, not world data)
- `src/store/fs-utils.ts` — will port adapted in Phase 1

UI rewrites (architecture-coupled, can't port verbatim):

- `src/ui/link-world-modal.ts` → REWRITE in Phase 3 (now does initial download, not just registry add)
- `src/ui/sync-indicator.ts` → REWRITE in Phase 2 (attaches to SyncEngine, not ApiStore)
- `src/middle/settings.ts` (sync section) → REWRITE in Phase 2

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
