# Atlas: Code Map

**What it is**: the per-module map of `src/` and `tests/`: where each concern lives and the one thing to know before touching it. Moved from the atlas-tool skill 2026-10-05. Kept true by `tests/unit/docs-paths.test.ts`: every backticked `src/` or `tests/` path here must exist, so paths stay in prose and lists, never in code fences (the guard skips fences). A module renamed or deleted fails that test until this file follows.

Not a complete listing: modules a doc names elsewhere are found from that doc (DESIGN.md's doc map). Add a line here when a new module is load-bearing.

---

## src/core

- `src/core/problems.ts`: ERRORS (S368, conv. 125): `classifyError` / `problemFor` / `buildDetails` / `scrubForReport`; UI never shows `err.message`.
- `src/core/plain-error.ts`: `PlainError`, a message already written for users (the refusal classes extend it).
- `src/core/types.ts`: Element, Conflict, SyncEngineState, Registry types, `SyncResult.pulled_ids`.
- `src/core/constants.ts`: storage keys, folder layout, `ATLAS_WIRE_EXTENSION_FIELDS` (sent) + `ATLAS_LOCAL_ONLY_FIELDS` (stripped); see ATLAS_FIELDS.md.
- `src/core/state.ts`: the observable store.
- `src/core/router.ts`: hash router, `settingsHash(world, tab)` deep-link helpers. The route table is DESIGN_SHELL "Routes".
- `src/core/map-view-prefs.ts`: per-map visual prefs (grid, pin style/labels/tint, zone opacity/labels; 'auto' = the density layer, S356).
- `src/core/world-styles.ts`: WORLD STYLES (S356): rules per kind (type + supertype/subtype) to colour/fill/weight/dash/label priority; `.atlas/styles.json` via `src/core/world-styles-state.ts` + `FolderStore.readStyles/writeStyles`; DESIGN_ZONES §5b.
- `src/core/type-mutes.ts`: MUTED TYPES (S356): `ui.mutedTypes`, per world in localStorage; pin + marker by default.
- `src/core/map-camera-persist.ts`: per-map {center, zoom} restore on mount.
- `src/core/knowledge.ts`: the knowledge model: `isKnowledgeNarrative`, `heldByOf`, `ABOUT_FIELDS` (derived), the known-view scans (`knowledgeHeldBy` / `elementsKnownAboutBy`), `lensKnownSet` (sidebar dimming).
- `src/core/sharing.ts`: the page model (subtype 'page'): blocks heading/prose/element-card/circle; `blocksOf()` heals card + circle ids from the `atlas_page_refs` mirror; `pageBlocksPatch` keeps blocks + refs + derived story in lockstep (conv. 73-78); `pagePubOf` (the `atlas_page_pub` published-state mirror).
- `src/core/share-payload.ts`: `buildPagePayload()`, the §5 publish payload (schema_version, disclosure tokens ref-only-when-included, `freezeCircleBlock`, `freezeMapBlock`: the ONE y-origin conversion on the publish path).
- `src/core/narrative-kind.ts`: `narrativeKindOf`: story | knowledge | page, the three-kind seam.
- `src/core/narrative-fields.ts`: `NARRATIVE_RELATION_FIELDS`, the canonical Involves map (writing derive + knowledge).
- `src/core/narrative-delete.ts`: a count shown to the user mirrors the cascade, never the tree; its test asserts the two walks agree.
- `src/core/taxonomy.ts`: `suggestionsForField` (derive-from-world autocomplete) + `reservedValueHint`/`reservedRowHint` (writing tier CASE-SENSITIVE; knowledge/page/circle case-insensitive, mirroring the semantic sites).
- `src/core/hotkeys.ts`: the declarative binding dispatcher (Ctrl+E/S/K; `?` opens the room-aware help overlay).
- `src/core/live-folder.ts`: THE LIVE FOLDER (S364, conv. 111): when to rescan, flush first, notices, linked-world rulings.
- `src/core/world-prefs.ts`: notes/cast/calendar/labels mirrored to `.atlas/world-prefs.json` (S364, conv. 112).
- `src/core/grounded.ts`: `isAtlasGrounded`: a root OR any non-demo world (S365, conv. 114).
- `src/core/browser-worlds.ts`: BROWSER WORLDS (1.17, conv. 129): `where` / `isBrowserWorld` / `isAtlasOnlyStorage`, `worldHandleFor` (derived), `removeBrowserWorldDir`, `filesWhereOf` (where the copy says the files are).
- `src/core/browser-home.ts`: the browser home: nonced names, the make protocol (`openBrowserMake`: Web Lock + `.atlas/making`), boot `reconcileBrowserHome`.
- `src/core/capabilities.ts`: boot gating by capability (folder picker, OPFS); `opfsStatus` (ok / refused / full / absent); DESIGN_TOUR "browser support".
- `src/core/theme.ts`: dark + light (`data-theme`, the ink/accent/scrim RGB-triplet system; conv. 90 for the two token pairs).
- `src/core/element-colors.ts`: the four-family palette: colour carries FAMILY, the icon carries TYPE. Cross-surface (the ow.com about page): change only with Skeld.
- `src/core/prose-autolink.ts`: `promotionLabel` is the one site of the label law (DESIGN_WRITING #49b).
- `src/core/pin-uniqueness.ts`: the one-pin-per-element-per-map predicate. Guarded at `createElement` in `src/store/folder-store-fs.ts`, not `createPin` (the import applier bypasses the wrapper); `tests/fixtures/mock-folder-store.ts` runs the same predicate at its own `createElement`: change one guard, change both.
- `src/core/leave-flush.ts`: leaving a world flushes the rooms (conv. 95): a room with a debounced save registers `onLeaveWorld`.
- `src/core/map-flip.ts`: "Flip pins and zones", the remedy for maps placed before y went bottom-left (conv. 97).
- `src/core/dom-utils.ts`: `escapeText` and the other untrusted-data helpers (conv. 93).

## src/store

- `src/store/folder-store.ts`: the FolderStore INTERFACE, the seam (`updateSyncState` mutator, conv. 86).
- `src/store/folder-store-fs.ts`: FsFolderStore: body-based fileIndex + id-sorted tidy + sticky writes (conv. 87), 30 s lock heartbeat, tombstone + sync-state chains.
- `src/store/write-chain.ts`: `PerIdWriteChain`, per-id update/delete serialization (conv. 79; both stores use it).
- `src/store/sync-stamp.ts`: `stampedBody`: a push stamp keeps an edit made IN FLIGHT dirty (conv. 96).
- `src/store/disk-link-names.ts`: pin/marker link fields read under BOTH disk spellings (`map`/`map_id`); per-FILE spelling recorded in fileIndex and written back the way it came (conv. 8).
- `src/store/fs-utils.ts`: `writeJsonAtomic` (ONE writable + read-back verify, busy files retried about 2 s; conv. 123), slugify / idTail / elementFilename / validElementFilenames / `sameFsName` (the File-naming contract).
- `src/store/scrub-links.ts`: a delete removes the dead ids from every link (conv. 101).
- `src/store/world-tree.ts`: a world as a tree of files: `isTransientPath` (the ONE skip predicate), `walkWorld`, `copyWorldTree` (byte copy, the move token first, `world.json` last), `verifyWorldTree`, `unportableName`, `worldFileName` (1.17, conv. 129).
- `src/store/world-file.ts`: the world file: `collectWorldFiles` (the portable copy: no `api`, no sync files, no transient file), `zipWorld`, `portableStamps`/`sameStamps` (the two-walk torn check), `readWorldZip` (the reader that refuses before anything is written). fflate, a lazy chunk.
- `src/store/rekey.ts`: THE RE-KEY KERNEL: journaled new ids, recovery, `rollbackRekey` (conv. 105).
- `src/store/rekey-body.ts`: `rekeyBody`, the reference id transform (chips, `ow://`, page blocks; conv. 106).
- `src/store/handle-vault.ts`: FileSystemDirectoryHandle persistence, over `src/store/idb.ts` (promise-wrapped IDB, handle-vault only).

## src/sync

- `src/sync/sync-engine.ts`: push (`/bulk` for 2+ CREATEs; topo-sort only as fallback) + pull (`/changes` cursor, full-list fallback) + conflict detect; auth bail, transient bail, `hold()`. FK constraint detection routes orphan peers to server_deletes.
- `src/sync/sync-attach.ts`: the singleton; `flushPendingOnAttach` BEFORE pull-on-activate; `diagnoseSyncUnavailable()` for engine-not-ready UI.
- `src/sync/sync-failure-copy.ts`: what a failed sync SAYS (foreign ids, 64 KB, held files; push vs pull side); once per set per session.
- `src/sync/sync-issues.ts`: NOT SYNCING (conv. 126): per world, session only, replaced per side; Settings › This world + the pill's warning count.
- `src/sync/ow-v2-client-adapter.ts`: the keel v2 dialect, a thin fetch (no SDK in the sync path); spatial disk rename (`map_id`/`map`); strips `ATLAS_LOCAL_ONLY_FIELDS` (WIRE extensions are sent); lists walk `?cursor=`. Wire facts: DESIGN_SYNC "The shape".
- `src/sync/make-online.ts`: Route 1 (`createApiWorld` + pushOnce) + Route 2 (`mergeLocalIntoApi`: plan, re-key kernel, server phase; conv. 122).
- `src/sync/plan-merge.ts`: `planMerge`: pure, per type, ids first then unique names; ambiguous names skipped and reported.
- `src/sync/make-online-run.ts`: the Route 2 runner: id-move lock, inert, flush, retry-as-recovery, link inside the lock.
- `src/sync/rekey-run.ts`: the re-key from the app: hold, flush rooms, guards, kernel, live pass, release (single-flight; Settings is the only launcher, conv. 105).
- `src/sync/rekey-route.ts`: `rekeyRouteHash`, the URL after ids change.
- `src/sync/foreign-ids.ts`: ids another world holds, recorded on evidence (conv. 108).
- `src/sync/account-client.ts`: signed-in account calls (v2 `POST /account/worlds` with the PIN dance for Route 1).
- `src/sync/sharing-client.ts`: the typed client for the sharing API (SHARING_CONTRACT §4): publish/getPublic/republish/revoke/list/slug-check, error-enum mapping, `SHARING_BASE_URL`.
- `src/sync/auto-pull-scheduler.ts`: opt-in periodic pull with visibility/error-state gates.

## src/registry, src/demo, src/editor, src/layout

- `src/registry/registry.ts`: the localStorage registry + helpers (two-tab merge, conv. 115; `setWorldFavoriteElement` for the protagonist/nexus).
- `src/demo/hyperion-world.json`: the TOUR bundle, baked from demo key 0000000000 (its ids are the live demo world's). Re-bakes follow DESIGN_TOUR's trap list.
- `src/demo/demo-page.json`: the example share page (`#/demo`).
- `src/demo/demo-view.ts`: `mountDemo` / `unmountDemo` / `isDemoMounted`, the view-only example page. A demo origin must NEVER complete waypoints.
- `src/editor/field-schema.ts`: the SDK `FIELD_SCHEMA` + `ELEMENT_SECTIONS` adapter; `src/editor/field-descriptions.ts`: per-field tooltips.
- `src/layout/app-shell.ts`: the three-pane shell with `resetRatios`; sidebar default 20%. `src/layout/narrow-layout.ts`: the drawers (conv. 89).

## src/sidebar

- `src/sidebar/sidebar.ts`: the mode toggle [Worlds | <WorldName>]; gear-as-toggle.
- `src/sidebar/worlds-sidebar.ts`: the world list + `activateWorld` (room-stable, lock take-over); the add-world icon row + the labelled "add a world" chooser; the recoverable-root state; account worlds.
- `src/sidebar/elements-sidebar.ts`: filter strip + search + element list + right-click refresh + flash buffer.

## src/middle

- `src/middle/element-detail.ts`: the schema-driven editor; widget-aware empty placeholders. Its concerns split into `src/middle/element-detail-header.ts`, `src/middle/element-detail-fields.ts` (`linkIdsOf` reads {id} objects and a lone id string), `src/middle/element-detail-refs.ts`, `src/middle/element-detail-zone-sections.ts`, `src/middle/element-detail-custom-fields.ts`, `src/middle/element-detail-map-image.ts` (a map's Local image row).
- `src/middle/editable-title.ts`: `makeEditableTitle`, the shared click-to-edit entity title (conv. 80).
- `src/middle/settings-panel.ts`: the orchestrator over per-tab modules: `src/middle/settings-general.ts`, `src/middle/settings-onlyworlds.ts`, `src/middle/settings-storage.ts`, `src/middle/settings-elements.ts`, `src/middle/settings-maps.ts`, `src/middle/settings-world.ts`, `src/middle/settings-writing.ts`, `src/middle/settings-context.ts` (tab id 'context' is LABELED "Web").
- `src/middle/writing-workspace.ts`: the TipTap prose editor + its `writing-workspace-*` concern modules (DESIGN_WRITING).
- `src/middle/knowledge-room.ts`: list / draft (localStorage stash) / in-room entry editor.
- `src/middle/share-room.ts`: the Pages room: page list / block builder / payload-true preview / publish section; serialized writes.
- `src/middle/share-editor.ts`: the LAZY page-prose TipTap embed (mentions/chips, NO derive; conv. 76).
- `src/middle/share-page-render.ts`: the STORE-FREE renderer, two paths: world-backed (builder) and payload-backed (`renderPayloadPage`: preview + the viewer's path; conv. 78).
- `src/middle/welcome-panel.ts`: first launch: the doors (tour, set up a folder, open a world folder, example page), "Re-link OnlyWorlds folder" when recoverable.
- `src/middle/story-sidecar.ts`: `storyOutranksSidecar`: plain text wins at open (conv. 116); `src/middle/story-notice.ts`: the once-per-element notice.
- `src/middle/timeline.ts`: the Charts room (owns ChartConfig, control bar, gallery; DESIGN_CHARTS).
- `src/middle/world-home.ts`: the world home (cover, intro cards, the keep-safe band, charts strip, desk, loose threads; memoised on its inputs, conv. 103); `src/middle/home-keepsafe.ts`: the keep-safe card's rules, pure (contract §6.1).

## src/tabs/right, src/visualization

- `src/tabs/right/right-pane.ts`: tab bar + sync pill + popover retarget on tab switch.
- `src/tabs/right/map-index-tab.ts`: the map tree + per-map camera cleanup on delete.
- `src/tabs/right/map-tab.ts`: a Leaflet manager per mapId, camera restore, hotkeys, zone overlay. Concern-split into `src/tabs/right/map-tab-pins.ts`, `src/tabs/right/map-tab-backgrounds.ts`, `src/tabs/right/map-tab-zones.ts`, `src/tabs/right/map-tab-pin-drag.ts`, `src/tabs/right/map-tab-tooltip.ts`, `src/tabs/right/map-tab-cache.ts`, `src/tabs/right/map-tab-toolbar.ts`, `src/tabs/right/map-tab-interactions.ts`, `src/tabs/right/map-tab-stale.ts`.
- `src/tabs/right/map-label-density.ts`: THE DENSITY LAYER (S356): collision-pruned labels + the icon-scale rule; DESIGN_MAPS §11.
- `src/tabs/right/map-zone-panel.ts`: THE ZONE PANEL (S356): kinds / legend / browser; DESIGN_ZONES §4.5.
- `src/tabs/right/map-visual-settings-popover.ts`: docked at midpanel-right; retargets across a map switch.
- `src/tabs/right/zone-drawing.ts` (draft state machine), `src/tabs/right/zone-edit-mode.ts` (per-world snapshot store, vertex/centroid drag), `src/tabs/right/zone-derived.ts` (`getZoneShape`).
- `src/visualization/leaflet-2d/Leaflet2DManager.ts` (Leaflet wrapper, lifecycle cache, fitToCanvas), `src/visualization/leaflet-2d/ZoneOverlay.ts`, `src/visualization/leaflet-2d/ZoneGeometry.ts`, `src/visualization/leaflet-2d/CoordinateUtils.ts` (stored x/y ARE CRS.Simple lat/lng: `lat = y`).

## src/ui

- `src/ui/modal-base.ts`: `BaseModal.buildModalShell` (every modal uses it); `dismissLocked` for long flows; topmost-only Escape via `isTopmost()`.
- `src/ui/problem-fixes.ts`: `showProblem(err, {doing, retry, dedupeKey, savedLocally, folder})`: sentence + fix buttons + Details (conv. 125, 127).
- `src/ui/toast-manager.ts`: queue, max 3, XSS-safe; opts {actions, details, sticky} + Dismiss.
- `src/ui/where-choice.ts`: THE WHERE-QUESTION (1.17, conv. 129): the rows, `takeWhereInClick` (persist in the gesture), `readyWhere`, `askWhere` for doors without a dialog.
- `src/ui/delete-browser-world-modal.ts`: the Delete dialog for a browser world.
- `src/ui/move-browser-world-modal.ts`: Move to a folder: step 1 inside the click (the home folder, writable), then a locked run with progress; `start(ready)` runs it at once with a home folder readied in an earlier click (a world file opened into a folder).
- `src/ui/bring-down-again-modal.ts`: the Cleared row's "Bring it down again": what comes back and what does not, then the restore with progress.
- `src/ui/download-world.ts`: Download the whole world from a click (the save picker inside the gesture), one path for Settings, the keep-safe card and Delete's "Download it first".
- `src/ui/open-world-file.ts`: the Open a world file door: the file input inside the click, `isWorldFile`, `openWorldFileFrom` (on Chromium with a home folder, a new world asks where through `askWhereWithHome`; a folder answer is the move after it opens).
- `src/ui/unexpected-errors.ts`: unhandled rejections said once, max 3 a session.
- `src/ui/sync-toasts.ts`: `surfaceSyncUnavailable()`, the one helper for engine-not-ready toasts.
- `src/ui/icon-a11y.ts`: stamps `aria-hidden` on every icon ligature span at boot.
- `src/ui/document-title.ts`: the tab title follows world/room/element.
- `src/ui/conflict-review-modal.ts` and `src/ui/server-delete-modal.ts`: per-row resolve, worldId captured at open.
- `src/ui/make-online-modal.ts` (Route 1 + Route 2 entry), `src/ui/new-api-world-modal.ts` (sidebar shortcut for Route 1), `src/ui/link-world-modal.ts` (link an existing API world).
- `src/ui/element-create-modal.ts`, `src/ui/element-picker-modal.ts`, `src/ui/zone-create-modal.ts`, `src/ui/map-create-modal.ts` (its configure-existing mode has no callers: DESIGN_MAPS).
- `src/ui/field-edit-popover.ts` (commits changed non-empty text on outside click), `src/ui/field-edit-inline.ts` (Shift+Enter saves in multi-mode).
- `src/ui/colour-popover.ts`: the atlas colour picker (presets + hex + Apply).
- `src/ui/help-overlay.ts` (the `?` overlay) over `src/ui/help-content.ts` (ALL per-room help strings, one file).
- `src/ui/room-tabs.ts` (the room-section tab pattern), `src/ui/drill-in.ts` (the `‹ Room` back band on entity views).
- `src/ui/shortcuts-content.ts`; `src/ui/hotkey-reference-modal.ts` is DORMANT (superseded by the help overlay).

## src/tour

The guided tour (DESIGN_TOUR).
- `src/tour/tour-engine.ts`: boot/reveal/teardown, step state, routeFor. `startTour` CLEARS THE STAGE (route, active world, sidebar mode, right tabs). `resolveRef` resolves against the BUNDLE, so a route must also check the element is ON DISK.
- `src/tour/tour-data.ts`: `TOUR_STEPS`, the script (phases, spans, reveal/creates, route, handsOn).
- `src/tour/tour-bar.ts`: the docked narrator + forward gate. Each `handsOn` kind needs its OWN branch or the step is un-advanceable forever.
- `src/tour/tour-view.ts` (derived phases + suspension), `src/tour/tour-world.ts` (scaffolds the demo world), `src/tour/tour-keep.ts` (keep the tour world: K1-K4, Save it to a folder), `src/tour/tour-heal.ts` (link strip/heal as elements reveal), `src/tour/tour-door.ts` (the scripted create door), `src/tour/tour-exit-modal.ts` over `src/tour/tour-exit-summary.ts`, `src/tour/tour-flag.ts` (`isTourFlagActive`).

## src/setup, src/import, src/changelog, the rest

- `src/setup/atlas-root-flow.ts`: `setupAtlasRoot` + `recoverAtlasRoot` + `discoverWorldsInRoot` + `openWorldFolder` + the link flow; browser-world scaffolding (1.17).
- `src/setup/world-doors.ts`: THE WORLD DOORS (conv. 114): open a picked world in place; `ensureAtlasRoot`; `runAddWorldAction`.
- `src/setup/world-parent.ts`: where a new world goes (1.17): `defaultWorldWhere`, the persist ask, the where captions.
- `src/setup/browser-world-delete.ts`: Delete for a browser world (1.17, conv. 129): close first, remove, then drop the entry; a failure keeps both.
- `src/setup/browser-world-move.ts`: Move to a folder (1.17, conv. 129): the registry journal, the moving lock, copy and verify, the one-save commit, the browser copy removed; `recoverBrowserMove` finishes a crashed move at boot and at open.
- `src/setup/world-download.ts`: the download: `pickSaveTarget`, `downloadWorld` (push then hold for a linked world, two walks, `kept_download_at`).
- `src/setup/world-file-open.ts`: open a world file: a new browser world through the make protocol (`chooseWhere` asked for a new world only, before any write), the same world refused, a cleared one restored under its own entry (`api` back from the registry, `review_first_sync`).
- `src/setup/bring-down-again.ts`: Bring it down again: a cleared linked browser world restored from onlyworlds.com under the SAME entry, a fresh directory, world.json with its own id (`ownWorldIdOf`) and its `api`, the first sync reviewed.
- `src/setup/key-check-errors.ts`: `keyCheckError`: a refused key / unknown world / offline as PlainErrors.
- `src/import/`: the Data room engine: parse, normalize, validate, reconcile, `src/import/apply-import-plan.ts`, `src/import/export-world.ts` (the keel envelope).
- `src/changelog/changelog.data.ts`: the ONE edit surface for the public changelog; `src/changelog/render-changelog.ts` renders it.
- `src/styles/atlas.css`: one stylesheet. Sentence case throughout.
- `src/app.ts` (the app: boot-time `reconcileBrowserHome`, then activation), `src/core/activation-chain.ts` (ONE serializer for every flow that opens, closes or sets the active store), `src/main.ts` (boot).

## tests

- `tests/setup.ts`: MSW + jsdom + fake-indexeddb.
- `tests/msw-handlers.ts`: `statefulOwHandlers` (paginate option, strict unknown-field validator).
- `tests/fixtures/mock-folder-store.ts`: the in-memory FolderStore (no directories: kernel tests also need fake-fs).
- `tests/fixtures/fake-fs.ts`: an in-memory FS so the REAL FsFolderStore runs in vitest (lastModified, touch, read counter, `hold()/release()`, byte writes).
- `tests/fixtures/fake-locks.ts`: a Web Locks API for vitest (`hold(name)` plays another tab).
- `tests/fixtures/fake-ow-client.ts`: `FakeOwApiClient`: speaks `/changes` by default; rejects LOCAL_ONLY fields + stamps.
- `tests/fixtures/monotonic-clock.ts`: strictly increasing ISO timestamps.
- `tests/fixtures/folder-conformance/`: the Folder Format conformance fixture (an ecosystem artifact). `tests/fixtures/map-worlds/`: map fixture worlds.
- `tests/unit/`: pure logic. Guards worth knowing: `tests/unit/docs-paths.test.ts` (this file), `tests/unit/no-raw-error-in-copy.test.ts` (the raw-error ratchet, conv. 125, 128), `tests/unit/name-sort-guarded.test.ts` (a source scan: `Element.name` is typed `string` but a foreign file may have none).
- `tests/integration/`: loops over the fakes, named `<subject>.<case>.test.ts` (sync-engine, sync-attach, make-online, folder-store, rekey, initial-download, bulk-link-halves, ...). Real-store kernel tests run on `tests/fixtures/fake-fs.ts`.
- `tests/e2e/`: Playwright specs named by area. Width-aware: `tests/e2e/narrow-layout.spec.ts`, `tests/e2e/tour-narrow.spec.ts`. The bootstrap recipe for a populated world (`freshBoot` / `setupWorld` / `createElement`) is in `tests/e2e/knowledge.spec.ts`.

## Related tool

`tools/show/` (the page viewer at show.onlyworlds.com, own README): its `render.ts` and `payload-types.ts` are deliberate COPIES of `src/middle/share-page-render.ts` and `src/core/share-payload.ts`. When the payload schema or the renderers change, re-lift them there and redeploy, or published pages keep the old behaviour (`schema_version` is the compatibility gate).
