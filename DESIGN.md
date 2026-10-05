# Atlas: Design

**Status**: live at atlas.onlyworlds.com since 2026-07-24 (v1.0); current release, gates and queue are in `PROGRESS.md` CURRENT STATE, which wins over any line here.
**Version**: 3.0 (2026-09-29, S366): this file became the index. The pre-split DESIGN.md (1,237 lines, conventions, workflows and history in one place) is `docs-archive/DESIGN-2026-09-29-pre-split.md`.
**Predecessor**: `tools/atlas-deprecated/` (the IDB-cached build, kept as a UI/UX reference only).

---

## Vision

Atlas is the place where you see, explore, create and edit any OnlyWorlds world: local or synced, alone or with collaborators.

**OnlyWorlds is local-first, and atlas honors that.** Every world lives as real files on real disk. Syncing with the OnlyWorlds API is an **opt-in capability**, not a storage mode: users choose when and how to sync, and the data on their machine is always the source of truth.

Atlas serves the same three audiences as the legacy build: the DM prepping a campaign, the worldbuilder, and the developer using OnlyWorlds as a headless backend.

## Foundational Principle

> **The folder is the world. The API is a sync target.**

Every world has a folder on disk. Reads come from the folder. Writes go to the folder first. If api credentials are attached, a `SyncEngine` runs alongside, pushing local changes up and pulling remote changes down.

This is the only architectural decision that matters; everything else falls out of it. The legacy build had two storage layers (a folder for local worlds, IndexedDB for api-linked ones), which made "where does my data live?" depend on "am I synced?". The rebuild has one storage layer and one mental model.

**The local representation invariant**: every world atlas knows about is fully represented in local files, whatever its origin. There is no partial-shadow-of-server mode.
- Linking an existing api world downloads every element BEFORE the world is registered (or stops explicitly partial, by the user's choice).
- Make Online Route 2 is bidirectional: local pushes up AND server-only elements come down.
- A pull reconciles into the folder first; a server-side delete goes to the user's review before anything is deleted locally.
- An api-linked world taken offline indefinitely is still whole on disk and editable.

**Sync orientation, local-first by default**: autosave (a debounced push) is on, because you typed and want it kept. Pulls are off unless the user opts in (pull on activate, a cadence); the manual refresh is always available. Pushes reflect user intent; pulls do not, unless asked. The full engine is DESIGN_SYNC.

## World States

Two states. The difference is **whether sync is wired**, not where the data lives.

| State | Folder | API credentials | SyncEngine attached |
|---|---|---|---|
| `local-only` | yes | no | no |
| `api-linked` | yes | yes (api_key + global PIN) | yes |

There is no api-only mode. If you want a world online, you attach credentials and the engine starts reconciling.

- **View-only worlds** are a FLAG on api-linked, not a third state: `api.read_only` (registry and `world.json`). Linked with a READ key and no PIN; the engine is pull-only and the store refuses every UI write. The sister-shares-with-her-DM flow.
- **local-only to api-linked**: Make Online, two routes (create a new api world, or link into an existing one). DESIGN_SYNC "Make Online".
- **api-linked to local-only**: unlink. The folder stays, sync stops, the baselines are wiped (conv. 24), and the server world id is remembered as `former_api_world_id`.
- **Where a world comes from**: made new in the home folder, downloaded from onlyworlds.com, imported from a file, or any world folder opened in place (DESIGN_FOLDER "Opening a world folder in place"). A browser without the folder picker (Firefox, Safari 26+) gets the guided tour only in 1.16; worlds kept in browser storage are being built as 1.17 (conv. 129, contract `Forge/Notes/2026-10-04-browser-worlds-contract.md`).

## Doc map

The rule (README): Forge/Notes decide, DESIGN docs hold. A dated decision record is folded into the right doc here promptly; these docs are the living truth.

| Doc | Holds |
|---|---|
| `DESIGN.md` | this index: vision, the principle, world states, the map of everything else |
| `DESIGN_LAWS.md` | the numbered Critical Conventions 1-125, grouped by area, with their guards |
| `DESIGN_FOLDER.md` | on-disk layout, the union read, **File naming** (the Folder Format spec source), the atlas root, every `.atlas/` file, media, the FolderStore contract |
| `DESIGN_SYNC.md` | the SyncEngine as built, push and pull triggers, pause and hold, creating and linking worlds, Make Online, ids, the re-key kernel, account mode, world-meta sync |
| `DESIGN_SHELL.md` | the three-pane shell, rooms, the narrow-window layer, the state shape, routes, the context pane |
| `ATLAS_FIELDS.md` | the atlas extension fields (synced versus local-only) and every other place atlas keeps state |
| `DESIGN_MAPS.md` | maps: the map tree, `parent_map` versus `location`, image sources, the density layer |
| `DESIGN_ZONES.md` | zones and markers: the domain model, drawing and editing, world styles, the zone panel |
| `DESIGN_WRITING.md` | the writing room: tiers, TipTap storage, links and aliases, the derive (conv. 47-57) |
| `DESIGN_KNOWLEDGE.md` | the knowledge model and room: entries, knowers, circles, the known-view (conv. 67-72) |
| `DESIGN_SHARING.md` | the Pages room: blocks, themes, the payload, publish (conv. 73-78) |
| `DESIGN_HOME.md` | the world home room |
| `DESIGN_IMPORT.md` | the Data room: import and export (conv. 81-85) |
| `DESIGN_CHARTS.md` | the Charts room: chart configs, the time-states map, calendars, the scroll view |
| `DESIGN_TOUR.md` | the guided Hyperion tour: steps, phases, the bundle, bake traps, browser support |
| `SYNC_NOTES.md` | sync lessons and bug classes, closed bouts, open soft edges (read before touching sync) |
| `SHARING_CONTRACT.md` | the atlas and onlyworlds.com sharing backend contract |
| `SHARING_CF_DELIVERY.md` | the Cloudflare edge-caching design for the page viewer |
| `PROGRESS.md` | operational state: CURRENT STATE and the queue (earlier session entries: `docs-archive/PROGRESS-history.md`) |
| `CHANGELOG.md` | release notes (the public page is generated from `src/changelog/changelog.data.ts`) |
| `PORTED.md` | the port log from the legacy build and zoner |
| `CODEMAP.md` | the per-module map of `src/` and `tests/`, path-checked by the docs guard |
| `README.md` | run commands, stack, the doc-system layers |

Superseded docs live in `docs-archive/`, never the root (session history before the current state: `docs-archive/PROGRESS-history.md`). The per-module file tree is `CODEMAP.md`; the test cadence is "Testing" below.

## The subsystems

**The laws** (`DESIGN_LAWS.md`). The numbered rules every change must keep: state is truth, one writer per folder, tombstones before unlink, writes chained per id and merged into the file as it is on disk, world data is untrusted, a room instance belongs to one world, and 110 more. The numbers are stable citations: "conv. N" in code, tests and notes means that file. New rules take the next number.

**The folder** (`DESIGN_FOLDER.md`). One world per folder: `world.json`, `.atlas/` for atlas's own files, `elements/<type>/` for all 22 types, `media/`. Atlas reads the legacy `spatial/` layout too and never creates it. The filename is presentation and the id inside the file is identity; that contract (the File naming table) is the Folder Format spec's source. The FolderStore (`src/store/folder-store.ts`) is the one seam every read and write goes through; the live folder notices when other tools change the files.

**Sync** (`DESIGN_SYNC.md`). One `SyncEngine` for the active api-linked world, speaking the keel v2 dialect through a thin fetch adapter. A round is the meta step, then push (creates through `/bulk`, then updates and deletes), then (on pull rounds) the `/changes` cursor walk. Pushes come from autosave and eight other named triggers; pulls happen only when asked. The same file covers linking and creating worlds, both Make Online routes (Route 2 moves ids through the re-key kernel before it uploads, S367), the re-key kernel, account mode and world-meta sync. The lessons behind the rules are in `SYNC_NOTES.md`.

**The shell** (`DESIGN_SHELL.md`). Sidebar (worlds or elements), middle (a room nav strip over the active room), right (the Context tab, the map index and one tab per map). Below 1100px and 820px the side panes become drawers. Rooms: welcome, home, element, writing, knowledge, charts, pages, data, settings. State is one observable store; navigation is the URL hash.

**Atlas fields** (`ATLAS_FIELDS.md`). What atlas adds to OnlyWorlds that the schema does not hold: zone visuals and calendar configs ride the wire; rich text, aliases, page composition and media bindings stay local. Plus the register of registry and browser state, and the council-motion candidates (`atlas_shape`, `atlas_aliases`).

**Maps and zones** (`DESIGN_MAPS.md`, `DESIGN_ZONES.md`). Maps live in the right pane and compose with any room (`#/w/<id>/map/<mapId>`). The map tree, image sources (`image_url` wins; a local media binding is the fallback; only the url goes to the API), pins with bottom-left coordinates (conv. 97), zones built from markers, world styles per kind, the density layer.

**Writing, knowledge, pages** (`DESIGN_WRITING.md`, `DESIGN_KNOWLEDGE.md`, `DESIGN_SHARING.md`). Three kinds of Narrative: a story (tiers from the world's writing labels, prose with `ow://` links, the derive), a knowledge entry (who knows what, computed), a page (a block stack, published as a frozen payload to the viewer at show.onlyworlds.com). Plain `story` markdown is what every other tool reads; atlas's rich text is a sidecar that yields to it (conv. 116).

**Home, data, charts** (`DESIGN_HOME.md`, `DESIGN_IMPORT.md`, `DESIGN_CHARTS.md`). The world's identity room; import and export in the keel envelope; charts of the world along time, with calendars as a display layer over integer dates.

**The tour** (`DESIGN_TOUR.md`). The onboarding: the opening sentence of *Hyperion* becomes a linked world while the workspace builds itself around the user, then everything is torn down. Lives in `src/tour/`, bundle in `src/demo/hyperion-world.json`. Guards: `tests/unit/tour-step-ids.test.ts` (data to spec map), `tests/unit/tour-data.test.ts` (bundle invariants), `tests/unit/tour-preview.test.ts`, `tests/unit/tour-copy-hygiene.test.ts` (a scan of all tour copy for concatenation and lost breaks). Boot gating by capability (`src/core/capabilities.ts`) and the bare pre-setup splash (`body.atlas-preroot`) are described there.

**The changelog** (`src/changelog/changelog.data.ts`). The one edit surface for the public changelog page and its RSS feed; every user-visible change lands its entry there in the same commit. `npm run changelog` (run by `predev` and first in `build`) regenerates `changelog.html` and `public/changelog-feed.xml`; entry ids are global permalinks, so a duplicate id fails the build.

## File naming

The File naming table (the invariant, the canonical `<name-slug>--<id-tail8>.json` form, stickiness, case folding, tidy and dedupe) now lives in **`DESIGN_FOLDER.md`, section "File naming"**, moved verbatim. Citations of "atlas DESIGN.md File naming" (the Folder Format spec and other bays) mean that section. Implementation: `src/store/fs-utils.ts`; contract tests `tests/unit/fs-utils.slug.test.ts` and `tests/e2e/folder-store-slug.spec.ts`; the rule in brief is conv. 87.

## Where the old sections went

Code comments and older notes cite pre-split section names; they land here.

| Old DESIGN.md section | Now |
|---|---|
| On-Disk Layout, Directory layout (the union read), The conformance fixture, File naming, Atlas Root, Media, The FolderStore, W9 delete, W11 snapshot, W12 portability | `DESIGN_FOLDER.md` |
| The SyncEngine, Sync algorithm, Sync policies, Pause semantics, Push and Pull triggers, Push resilience, UUIDs, W1-W8 and W10, Account mode, World-meta sync | `DESIGN_SYNC.md` |
| UI Three-Pane Shell, Rooms, Search, State Shape, Routing, Context Pane | `DESIGN_SHELL.md` |
| Critical Conventions | `DESIGN_LAWS.md` (same numbers) |
| Atlas-Specific Fields & Features (the tracking section), Semantic reinterpretations | `ATLAS_FIELDS.md` |
| Calendars | `DESIGN_CHARTS.md` "Calendars: the architecture" |
| The Guided Tour | `DESIGN_TOUR.md` |
| Maps Subsystem | `DESIGN_MAPS.md` |
| Test Strategy | "Testing" below |
| File Layout | `CODEMAP.md` |
| Build History, Tradeoffs Accepted, Open Questions | `docs-archive/DESIGN-2026-09-29-pre-split.md` only (history) |

## Testing

Counts are never pinned here: `npx vitest run` and `npx playwright test --list` give today's (PROGRESS CURRENT STATE records the last gate).

- **Unit and integration** (Vitest, jsdom): `tests/unit/` for pure logic, `tests/integration/` for loops over `FakeOwApiClient`, the MSW handlers and the in-memory store; kernel tests also run the real store on `tests/fixtures/fake-fs.ts`. The full run takes well under a minute; never worth skipping at a bout's end. **Every file runs in ONE fork** (`singleFork` in `vitest.config.ts`), so jsdom's window, `window.location`, localStorage, fake timers and the DOM outlive a file: a file that leaks any of them poisons the files after it. A test that swaps `window.location` puts the real one back; a test that reads the hash or storage sets its own. A test failing only in the full run means bisect by file, not a longer timeout.
- **E2E** (Playwright, the dev server; Chromium for the suite, plus the `firefox` and `firefox-private` projects for the `@firefox`/`@private` tagged specs, so a default run needs `npx playwright install firefox` once): specs boot fresh on OPFS with isolated storage (not the folder picker), and mock the API with `page.route` where a flow needs it. The spec files in `tests/e2e/` are named by area; the width-aware ones are `tests/e2e/narrow-layout.spec.ts` and `tests/e2e/tour-narrow.spec.ts`; the rest run at one width, so layout work still needs own eyes at several widths. `dev/fake-keel.mjs` serves manual checks against a keel stand-in.
- **Reading an e2e run**: 4 workers, `retries: 2`, a 45 s test and 12 s expect timeout (`playwright.config.ts` says why: TipTap chunk compilation starves under load). A `flaky` line (failed, then healed on retry) is GREEN; only `failed` is red. Read the exit code directly (`PLAYWRIGHT_EXIT`), never `$?` after a pipe or a grep of the summary. The count rule is per project: `--list --project=<name>` equals that project's run. If flakiness worsens, bisect with `--workers=1` before touching specs.
- **E2E setup traps**: a world whose narratives are not all tier-labelled opens "Set up writing" instead of the workspace, so a writing spec sets `writing_initialized: true` on the registry entry (or the header never renders and the failure looks like a missing locator). A check right after a world switch reads the OLD room, still on screen: mark the old node and wait for it to go.
- **The cadence**: per edit, `npm run typecheck`; per bout, typecheck + `npx vitest run` + only the affected spec file(s) (or `npx playwright test <file> --grep "<name>"`); at the session close or before a commit, the full `npx playwright test` once; docs-only changes, typecheck alone. The general law (narrowest scope, the revert-check) is `Forge/Knowledge/forge-operations-manual.md`.
- **Checks outside the suites**: the CSP blocks axe-core injection on the production build, so run axe against the dev server. The service worker registers with `registerType: 'prompt'` (`vite.config.ts`): check a service-worker change with two real builds (visit v1, change an asset, build v2, reload). Whether live matches HEAD: compare the `dist/assets/main-*.js` hash of a HEAD build with the one the live index serves, never a handover's claim.
- **The dense-map fixture** is Skeld's Sikelia world (4,771 elements: 196 pins, 332 zones, 3,143 markers on one imageless map): `tools/atlas/Notes/ui-snapshots/sikelia-seed/build_bundle.py` (atlas's own Notes, not Forge's) bundles the world folder for Vite to serve, the page fetches it into OPFS, a home folder is set up first (first launch refuses a world folder), then the open-folder door opens it; a reload reopens it. The script lives in a gitignored folder (this machine only); the run that used it: `Notes/2026-09-11-s356-density-and-zone-panel.md`.
- **The docs guard**: `tests/unit/docs-paths.test.ts` fails when a live doc here cites a `src/` or `tests/` path that does not exist.
- **Smoke** against real OnlyWorlds is manual, recorded in PROGRESS.

## References

- OnlyWorlds build patterns and the Forge-facing wire notes: `Forge/Knowledge/Technical/onlyworlds.md`; the frozen v2 wire facts: `Forge/Notes/Archive/2026-07-12-v2-probed-facts.md`.
- What atlas can do, in quotable form for other bays: `Forge/Knowledge/atlas-capability-card.md`.
- Field schema source: the SDK's `FIELD_SCHEMA` and `ELEMENT_SECTIONS`, adapted in `src/editor/field-schema.ts`.
- The legacy build: `tools/atlas-deprecated/` and its `DEPRECATED.md`.
