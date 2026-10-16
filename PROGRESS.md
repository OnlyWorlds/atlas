# Atlas — Progress Log

Operational state. Architecture: **DESIGN.md** is the index (since S366), with the conventions in `DESIGN_LAWS.md`, the folder in `DESIGN_FOLDER.md`, sync in `DESIGN_SYNC.md`, the shell in `DESIGN_SHELL.md`, fields in `ATLAS_FIELDS.md`; per-room design in `DESIGN_{MAPS,ZONES,WRITING,KNOWLEDGE,SHARING,HOME,IMPORT,CHARTS,TOUR}.md`; the doc-system map lives in **README.md** ("Notes decide, DESIGN docs hold"). Sync lessons in **SYNC_NOTES.md**. Sharing contracts: **`SHARING_CONTRACT.md`** + **`SHARING_CF_DELIVERY.md`**. Superseded docs live in `docs-archive/` (incl. session history `PROGRESS-history.md`).

---

## CURRENT STATE (2026-10-16, SESSION 417: **1.50.2 LIVE** (Boss flew `56df41d`, `main-C_5ROwEi.js`, seen on atlas.onlyworlds.com 2026-10-16; walked live on crew-walk-b: no PIN question, the world opens to read) (gates: typecheck 0 + **2908 vitest, exit 0** + **506 e2e, PLAYWRIGHT_EXIT=0, 503 passed, 3 flaky** `tour-keep:182`, `tour-keep:305`, `tour-narrow:97` (run beside Lantern walks; 9 of 9 alone, retries off)); **1.50.1 LIVE** (Boss h11 #5969, deployment `e246246d`, carrying 1.50.0); S416's close block is the newest entry in `docs-archive/PROGRESS-history.md`)

- **#294's receipt** (h57 #5975, closed by Skeld #5976): a person's invite end to end on live through all three doors (Atlas's person door, Lantern's join, the site's Join and the member page's Open in Atlas), crew-walk-a owning 'Temper walk', crew-walk-b a fresh account with no PIN. 1.50.1's toast fix seen live. A16 (Invite someone) holds on live; the QR missed once in a tab loaded during Boss's cut-over, drawn on the next load.
- **1.50.2, P1**: a member is asked for the PIN only after keel's mint (`openAccountWorldOnce`, `src/sync/account-worlds.ts`): 409 pin_required opens to read with no question; a write key means the account has a PIN, asked then with the overlay hidden (`LoadingOverlayHandle.hide/show`), and a Cancel takes the key back (`AccountClient.revokeWorldKey`, keel's `DELETE /account/worlds/{id}/keys/{key_id}`). The owner's order is unchanged. Guards in `tests/e2e/account-mode.spec.ts` (three member tests; the prompt order, the revoke and the overlay each red when cut).
- **P2** is Lantern's (`8643e9c`). **P3** (a removed-and-rejoined member's copy keeps a dead key, and the message blames the PIN or a deletion) is a note on #198: signed in, Atlas could make a fresh key itself; not built, for his talk.
- **Harness traps met** (not Atlas defects): a killed browser leaves the world lock for 90 s, and Playwright dismisses the take-over `confirm` by default, so the world reads "No world open"; an empty world shows no elements search (wait for the home's "No maps yet").

- ⚡ **NEXT**: (0) **#198, the Captain's go** (terminal, 2026-10-16 ~16:10; the item's note, h20 #6013): a linked world takes a new key in place, never Unlink. Signed in and an account world: Atlas mints the fresh key itself when keel refuses the old one (P3, Skeld's rotation h16 #5923); otherwise Settings, This world swaps a pasted key; the refused-key message names the real cause. (1) When v1 goes (the Captain's Q7, not ruled): Make online signed out moves to sign-in only (h29 #5947). (2) #350, the ruling's second half (a made-by filter, the mark in Knowledge and Pages), on its talk. #198 (with P3 beside it) on his talk list.

---

Earlier session entries (S253 to S376, newest first, moved verbatim 2026-10-05, with the July `BANKED / TODO` standing queue that sat among them) are at the bottom of `docs-archive/PROGRESS-history.md`.
