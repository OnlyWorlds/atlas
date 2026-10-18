# Atlas — Progress Log

Operational state. Architecture: **DESIGN.md** is the index (since S366), with the conventions in `DESIGN_LAWS.md`, the folder in `DESIGN_FOLDER.md`, sync in `DESIGN_SYNC.md`, the shell in `DESIGN_SHELL.md`, fields in `ATLAS_FIELDS.md`; per-room design in `DESIGN_{MAPS,ZONES,WRITING,KNOWLEDGE,SHARING,HOME,IMPORT,CHARTS,TOUR}.md`; the doc-system map lives in **README.md** ("Notes decide, DESIGN docs hold"). Sync lessons in **SYNC_NOTES.md**. Sharing contracts: **`SHARING_CONTRACT.md`** + **`SHARING_CF_DELIVERY.md`**. Superseded docs live in `docs-archive/` (incl. session history `PROGRESS-history.md`).

---

## CURRENT STATE (2026-10-18, SESSION 429: **1.53.2 WITH BOSS** (`531be61`, h11 #7237): a refused change to a shared world's own details is sent and told once (Kael's collaborator walk, h57 #7224, finding 6). 1.53.1 is live.)

- **The fix**: a co-builder's edit to the world's description or now is refused by keel (403 `owner_only`). The meta step re-PATCHed it every round and the toast guard re-told it whenever the refusal shared a round with another failure. `SyncEngine.metaOwnerRefusal` remembers an owner_only refusal for exactly those dirty fields: no PATCH again, the same failure object reported (decided once by `failureToastOnce`), the status still not synced; a new edit tries again; other failures retry as before. A reload starts the guard fresh, so it is told once per page load. Guard `tests/unit/meta-owner-refusal.test.ts`, red without the skip, with a 500 control.
- **map-ink's Trace test** gets its own 120 s budget: its 1500-move coast runs ~40 s alone at the suite's 45 s limit, red at HEAD too (5 of 5), green at 39.7 s with room; every assertion held.
- **Gates on `531be61`'s tree**: typecheck 0 · vitest 3009 passed (2 skipped) · build 0 · e2e 536 passed + map-ink 12 of 12 after the budget. Logs `Notes/ui-snapshots/2026-10-18-s429/`.
- **Kael's other two Atlas findings are the Captain's** (B12 orange, h20; case `Forge/Notes/2026-10-18-s429-two-hands-for-captain.md`): Q1 two hands on one element, each save silently replacing the other under Local wins (lean: shared worlds default to Pause and review and pull on open); Q2 a lowered role keeps the whole copy (lean: keep it, say once).
- **Known gaps** (from S426, unchanged): G9, G12, G14, G13's light-mode strip contrast; Trace on a real phone; a name along a line can cross a pin; the island-capitals guard is order-dependent under its revert; EB Garamond not bundled.
- ⚡ **NEXT**: (0) When Boss says 1.53.2 is live: walk it with two crew accounts (claim in h57): owner shares a world, the co-builder edits the description, one toast, no repeat on later saves, a new edit tries again; then "it's live" in h20. (1) B12 when he answers. (2) Whether a page's map block should follow the map's style: a question, not an item. (3) When v1 goes (Q7): Make online signed out moves to sign-in only. (4) #350 on its talk. (5) Seethe's Atlas board for #388.
---

Earlier session entries (S253 to S376, newest first, moved verbatim 2026-10-05, with the July `BANKED / TODO` standing queue that sat among them) are at the bottom of `docs-archive/PROGRESS-history.md`.
