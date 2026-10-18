# Atlas — Progress Log

Operational state. Architecture: **DESIGN.md** is the index (since S366), with the conventions in `DESIGN_LAWS.md`, the folder in `DESIGN_FOLDER.md`, sync in `DESIGN_SYNC.md`, the shell in `DESIGN_SHELL.md`, fields in `ATLAS_FIELDS.md`; per-room design in `DESIGN_{MAPS,ZONES,WRITING,KNOWLEDGE,SHARING,HOME,IMPORT,CHARTS,TOUR}.md`; the doc-system map lives in **README.md** ("Notes decide, DESIGN docs hold"). Sync lessons in **SYNC_NOTES.md**. Sharing contracts: **`SHARING_CONTRACT.md`** + **`SHARING_CF_DELIVERY.md`**. Superseded docs live in `docs-archive/` (incl. session history `PROGRESS-history.md`).

---

## CURRENT STATE (2026-10-18, SESSION 428: **1.53.1 LIVE** (`6d130c7`, Boss h11 #7069, main `main-C_F1jfxy.js`; walked live in Chromium and Firefox, h11 #7071: signed in as crew-walk-b on a browser world, Make online's Create new pane shows Display name and PIN only, says "On your account, crew-walk-b", no page errors, nothing made online, both tokens read back 401; "it's live" in h20 #7072); gates as S427 ran them on this tree: typecheck 0 + 3007 vitest + 537 e2e (536 passed, 1 flaky), exit 0; S427's block is the newest entry in `docs-archive/PROGRESS-history.md`)

- No Atlas code changed this session. The walk script is the gitignored `Notes/ui-snapshots/2026-10-18-s428/makeonline.mjs` (reads the crew file, revokes what it mints).
- **Seen on the S427 shoot, not changed**: at the itinerary map's fit zoom the density layer hides both roads' names; "The road of 1849-50" stayed hidden at every zoom tried; a Pages map block draws without the map's style; Trace from a scripted drag kept 9 points.
- **Known gaps** (from S426, unchanged): G9, G12, G14, G13's light-mode strip contrast; Trace on a real phone; a name along a line can cross a pin; the island-capitals guard is order-dependent under its revert; EB Garamond not bundled; `front-door.spec:181` (keep its `test-failed-1.png` and run `--retries=0 --trace=retain-on-failure` when it loses).
- ⚡ **NEXT**: (1) Whether a page's map block should follow the map's style: a question, not yet an item. (2) When v1 goes (Q7): Make online signed out moves to sign-in only. (3) #350 on its talk. (4) Seethe's Atlas board for #388 (L7's reshoot offered, h57 #7056).
---

Earlier session entries (S253 to S376, newest first, moved verbatim 2026-10-05, with the July `BANKED / TODO` standing queue that sat among them) are at the bottom of `docs-archive/PROGRESS-history.md`.
