# Atlas — Progress Log

Operational state. Architecture: **DESIGN.md** is the index (since S366), with the conventions in `DESIGN_LAWS.md`, the folder in `DESIGN_FOLDER.md`, sync in `DESIGN_SYNC.md`, the shell in `DESIGN_SHELL.md`, fields in `ATLAS_FIELDS.md`; per-room design in `DESIGN_{MAPS,ZONES,WRITING,KNOWLEDGE,SHARING,HOME,IMPORT,CHARTS,TOUR}.md`; the doc-system map lives in **README.md** ("Notes decide, DESIGN docs hold"). Sync lessons in **SYNC_NOTES.md**. Sharing contracts: **`SHARING_CONTRACT.md`** + **`SHARING_CF_DELIVERY.md`**. Superseded docs live in `docs-archive/` (incl. session history `PROGRESS-history.md`).

---

## CURRENT STATE (2026-10-14, SESSION 406: **the calendar kernel is the SDK's, committed, no release** (SDK ^4.21.0, the registry's blessed pin; Atlas's own core/calendar.ts deleted, its 15 import sites on `@onlyworlds/sdk`, as told Kael h37 #4302; gates: typecheck 0 + **2794 vitest, exit 0** (`--no-cache`, 2 skipped) + **444 e2e, PLAYWRIGHT_EXIT=0, 444 passed, no flaky** + a production build, `main-BaUyU1uo.js`); **1.35.2 LIVE** (Boss h11 #4424: Pages `cba7809a`, `main-Ch2Dhmen.js`; his throttled Pixel 7 control, 1.35.1 13 to 16 bare-front-door samples, 1.35.2 0, 0 and 0); S405's block is the newest entry in `docs-archive/PROGRESS-history.md`)

**Records**: `Forge/Notes/ui-snapshots/2026-10-14-s406/atlas/` (vitest, e2e and build logs).

- **The calendar import** (S406): the SDK's calendar/calendar.ts is Atlas's old file byte for byte (Kael's record names Atlas 02d6a6d, the file's last change here), so this is the same code from another place, and no version or deploy: it rides with the next real release, as S404's SDK bump did. Atlas's 48 kernel tests (`tests/unit/calendar.test.ts`) stay and now run against the SDK's kernel. `src/core/calendar-lens.ts` stays Atlas's (typed on Atlas's `Element`, the chosen lens in the registry). A kernel change is an SDK release from here (DESIGN_CHARTS "Kernels"). Found on the way: `tests/unit/docs-paths.test.ts` refused my first doc line, which backticked the deleted path.
- **Lantern reads the same kernel** (S406, Lantern `875c765`, `441aaa4`): a world's only calendar names its dates there, and with several the phone offers the choice, kept per phone as Atlas keeps its own.
- **Still from S405** (the history entry): Boss's demo error not reproduced (the console line or the toast's Details names it if it comes again); the census's left `void activateWorld(...)` sites in `worlds-sidebar.ts`; the Captain's phone on the Writing case (1.33.0, #244); keel B4, a wrong PIN on a write key's Test connection.
- ⚡ **NEXT**: (1) The calendar import ships with the next real release. (2) Kael told it is on master (h37), so his copy-drift record can retire. (3) Seethe reads the 1.35 frames (h37 #4283). #198/#199 wait on talks.

---

Earlier session entries (S253 to S376, newest first, moved verbatim 2026-10-05, with the July `BANKED / TODO` standing queue that sat among them) are at the bottom of `docs-archive/PROGRESS-history.md`.
