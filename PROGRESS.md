# Atlas — Progress Log

Operational state. Architecture: **DESIGN.md** is the index (since S366), with the conventions in `DESIGN_LAWS.md`, the folder in `DESIGN_FOLDER.md`, sync in `DESIGN_SYNC.md`, the shell in `DESIGN_SHELL.md`, fields in `ATLAS_FIELDS.md`; per-room design in `DESIGN_{MAPS,ZONES,WRITING,KNOWLEDGE,SHARING,HOME,IMPORT,CHARTS,TOUR}.md`; the doc-system map lives in **README.md** ("Notes decide, DESIGN docs hold"). Sync lessons in **SYNC_NOTES.md**. Sharing contracts: **`SHARING_CONTRACT.md`** + **`SHARING_CF_DELIVERY.md`**. Superseded docs live in `docs-archive/` (incl. session history `PROGRESS-history.md`).

---

## CURRENT STATE (2026-10-18, SESSION 431: **1.53.2 LIVE** (`531be61`, Boss h11 #7245, main `main-CJ0wPCIu.js`) and **walked live** in Chromium and Firefox with two crew accounts (h11 #7255, "it's live" h20 #7256); gates as S429 ran them on this tree; S429's block is the newest entry in `docs-archive/PROGRESS-history.md`)

- **The walk** (`Notes/ui-snapshots/2026-10-18-s431/`: setup.mjs, walk.mjs, site-delete.mjs, logs/): crew-walk-a owned a throwaway world, crew-walk-b joined as co_builder through the API (a person link, `acceptJoin`); b opened it in Atlas, changed its description, made a character, another, changed the description again, made a third. 1.53.2: **2 PATCH /world in 5 rounds** (both 403 `owner_only`, one per description edit), one toast, no page errors, in both engines. **Control** 1.53.1 from a worktree at `8fe8d5d` against live keel: **4 PATCH /world**, one every round after the first refusal.
- **What the walk could not show**: the toast repeat. Nothing else failed in the same round, so 1.53.1 told it once too; that half rests on `tests/unit/meta-owner-refusal.test.ts`.
- **Seen on both versions, not a defect**: the first push round after an open seeds the meta baseline and sends nothing, so a description edit made right after opening waits for the next save or pull (kept on disk, never lost).
- **Walk craft**: keel answers 429 after about eight password sign-ins in half an hour; walk.mjs takes `PASTE_TOKEN=1` to paste a setup token into Settings' "I have an account token" instead. Firefox never asks where a world lives (no folders), so that step is optional. Teardown revokes only the session's own tokens (S431's revoked every token on both accounts; owned in h57 #7254).
- **Known gaps** (from S426, unchanged): G9, G12, G14, G13's light-mode strip contrast; Trace on a real phone; a name along a line can cross a pin; the island-capitals guard is order-dependent under its revert; EB Garamond not bundled.
- ⚡ **NEXT**: (1) B12 when he answers (h20; case `Forge/Notes/2026-10-18-s429-two-hands-for-captain.md`). (2) Whether a page's map block should follow the map's style: a question, not an item. (3) When v1 goes (Q7): Make online signed out moves to sign-in only. (4) #350 on its talk. (5) Seethe's Atlas board for #388.
---

Earlier session entries (S253 to S376, newest first, moved verbatim 2026-10-05, with the July `BANKED / TODO` standing queue that sat among them) are at the bottom of `docs-archive/PROGRESS-history.md`.
