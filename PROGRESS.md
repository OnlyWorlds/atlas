# Atlas — Progress Log

Operational state. Architecture: **DESIGN.md** is the index (since S366), with the conventions in `DESIGN_LAWS.md`, the folder in `DESIGN_FOLDER.md`, sync in `DESIGN_SYNC.md`, the shell in `DESIGN_SHELL.md`, fields in `ATLAS_FIELDS.md`; per-room design in `DESIGN_{MAPS,ZONES,WRITING,KNOWLEDGE,SHARING,HOME,IMPORT,CHARTS,TOUR}.md`; the doc-system map lives in **README.md** ("Notes decide, DESIGN docs hold"). Sync lessons in **SYNC_NOTES.md**. Sharing contracts: **`SHARING_CONTRACT.md`** + **`SHARING_CF_DELIVERY.md`**. Superseded docs live in `docs-archive/` (incl. session history `PROGRESS-history.md`).

---

## CURRENT STATE (2026-10-11, SESSION 393: **1.32.0 PUSHED** (#201, Sentence case for the rest of Atlas; gates: typecheck 0 + **2786 vitest, exit 0** + **442 e2e (= `--list`), PLAYWRIGHT_EXIT=0, 1 flaky `tour-narrow:97`** + after the last CSS fix the 16 home, palette and cast specs green + a production build, `main-Ciulvdt4.js`); Boss briefed in h11; **1.31.0 LIVE** (Boss h11 #3020: Pages 3faf57d2, `main-BY9_IQ4z.js` byte-identical); S392's block is the newest entry in `docs-archive/PROGRESS-history.md`)

**Records**: the walk `Forge/Notes/ui-snapshots/2026-10-11-s393/` (`w2-*.png`, log `w2-walk.md`; script `tools/atlas/Notes/ui-snapshots/2026-10-11-s393/case-walk.mjs`, gitignored); the sweep table `Forge/Notes/2026-10-11-copy-pass/wave2-sentence-case.md` (147 rows, all applied).

- **1.32.0, #201**: the 147 rows of wave 2 in Sentence case (command palette, Settings, colour picker names, zone line styles, the chart menu and its toasts, calendar checks, the Worlds list, home, the tour's exit page, the right pane's captions, the two sync-key tooltips). 127 rows by a script that edits only a line whose old text occurs once and outside an attribute; 9 by hand; 11 palette labels by hand; every row's word diff read. The prose naming the "Add a world" button follows it (welcome panel, Settings General, help). Stored defaults decided: a nameless world is "Untitled world" (as browser-home already said) and a split piece "Unnamed <tier>" (as knowledge already said); only new ones.
- **The palette lowercases its names** (`command-palette.ts`, `.map(normalize)` on label and aliases): the query was always lowercased, so a capital label would stop `wri` finding Writing. Guard `tests/unit/command-palette.test.ts` "Sentence-case labels, lowercase queries": 7 red without the fix, 20 green with it. Conv. 30 grown with the rule.
- **Found by own eyes, not by any suite**: `.atlas-home-onboarding-tile span:last-child { text-transform: lowercase }` (meant for the type label) lowercased the line under an unmade Grow tile, so "Put places on it" rendered "put places on it" beside "See it on a chart". Scoped with `:not(.atlas-home-tile-line)`; the line now also keeps its own 10.5px. The other six `text-transform: lowercase` rules in src are tags or values the ruling keeps lowercase.
- `tests/e2e/command-palette.spec.ts` had mixed line endings in the working copy (172 CRLF) hidden by git's normalization; made LF.
- **Waiting on the Captain**: #198 and #199 (new key controls, design), #203 the mobile editor (h37 board B26), Skeld's Keel board B4.
- ⚡ **NEXT** (front door `Forge/Notes/2026-10-11-s392-handover.md` "Next" 3, and this block): #24's last two, labels on icon rows (Seethe's lens `Studio/desk/docs/2026-10-11-atlas-labels-findings.md`) and plain Settings copy.
---

Earlier session entries (S253 to S376, newest first, moved verbatim 2026-10-05, with the July `BANKED / TODO` standing queue that sat among them) are at the bottom of `docs-archive/PROGRESS-history.md`.
