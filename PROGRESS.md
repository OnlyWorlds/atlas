# Atlas — Progress Log

Operational state. Architecture: **DESIGN.md** is the index (since S366), with the conventions in `DESIGN_LAWS.md`, the folder in `DESIGN_FOLDER.md`, sync in `DESIGN_SYNC.md`, the shell in `DESIGN_SHELL.md`, fields in `ATLAS_FIELDS.md`; per-room design in `DESIGN_{MAPS,ZONES,WRITING,KNOWLEDGE,SHARING,HOME,IMPORT,CHARTS,TOUR}.md`; the doc-system map lives in **README.md** ("Notes decide, DESIGN docs hold"). Sync lessons in **SYNC_NOTES.md**. Sharing contracts: **`SHARING_CONTRACT.md`** + **`SHARING_CF_DELIVERY.md`**. Superseded docs live in `docs-archive/` (incl. session history `PROGRESS-history.md`).

---

## CURRENT STATE (2026-10-10, SESSION 387: **1.24.1 PUSHED** (#141, the Web tab's knot; gates: typecheck 0 + **2708 vitest** (286 files, 2 skipped, exit 0) + **431 e2e (= `--list`, PLAYWRIGHT_EXIT=0, 3 flaky: `phase6-polish:154`, `tour-narrow:97`, `writing-workspace:1497`, 9 of 9 alone with retries off, 3 each; none touches the graph)** + a production build); **1.24.0 LIVE** (Boss 53a58849, #140, Fully forget); 1.23.0, 1.22.1, 1.22.0 live (S386's block, the newest entry in `docs-archive/PROGRESS-history.md`, keeps their records, the join door's and the forget's named risks, and what was not walked live)

**Records**: walk script and evidence `tools/atlas/Notes/ui-snapshots/2026-10-10-s387/walk.mjs` (gitignored), frames `Forge/Notes/ui-snapshots/2026-10-10-s387/`.

- **1.24.1 BUILT** (#141): Admiral Fluffington's web on Moppetopia piled into one knot. Two causes: the sim had no step limit, so two nodes passing close flung a third far out (Medal of Damp Valor at x -986 against a median radius of 174) and the fit to the pane shrank the rest into the middle; and labels had only a count budget (14 by degree), no placement. Now: a step cap (`maxStep`), collision 64 apart (was 56), a slot under the centre kept clear for the subject's label; the label pass `src/tabs/right/graph-labels.ts` (pure): first clear side of eight or hover, the subject and selection always print. Conv. 134; DESIGN_SHELL "The graph".
- **Measured by ink** (the walk, Moppetopia's demo copy, Fluffington): at 1440, depth 1, HEAD drew 51 label-over-label, 139 label-over-node, 307 overlapping node pairs; 1.24.1 draws 0, 0, 0 in Chromium and Firefox, and 0 at 1000 too. 19 of 31 labels print at depth 1, the rest on hover. **Left as is**: at 1200 the pane is 342 wide and the subject's label grazes up to 3 nodes at depth 2, one node pair touching by a pixel; the slot is an estimate at scale 0.75.
- **Guards**: `tests/unit/graph-labels.test.ts`, `tests/unit/context-pane-graph-knot.test.ts` on `tests/fixtures/moppetopia-fluffington-web.json` (his two hops, names and links only). Revert-checked red: the step cap (the outlier test, both depths), the label slot (the slot test, and depth 2's spacing), the label pass's node test (three rows).
- **Split**: #171 (Quillon's "Linked from (118): (unnamed)" in the lists under the graph).
- ⚡ **NEXT**: Boss deploys 1.24.1, check the version line and Fluffington's web live; walk 1.24.0's Fully forget live (a fresh profile, one browser world, forget, the landing); the real upload on the Manifest portrait (the Captain's go, h20 #2335); then #139, #126, #171; the live join check when a pass exists. Keel's side of #104: Skeld.

---

Earlier session entries (S253 to S376, newest first, moved verbatim 2026-10-05, with the July `BANKED / TODO` standing queue that sat among them) are at the bottom of `docs-archive/PROGRESS-history.md`.
